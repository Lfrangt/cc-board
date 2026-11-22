/**
 * [INPUT]: 依赖 config.json 的 accounts 数组（server.mjs 读出来交进来）；依赖 macOS 的 /usr/bin/security 读钥匙串（测试用 CCBOARD_SECURITY 换成假的）；依赖 ~/.claude.json 的 oauthAccount 认出当前登录的号。
 * [OUTPUT]: 导出 parseAccounts、parseFallback、pickDefault、accountState、wrapLaunch、wrapBackground、loginLabel、SERVICE_PREFIX。
 * [POS]: 总控台「新任务选账号」的唯一实现。server.mjs 的 newSession 调 wrapLaunch，没明说账号时先问 pickDefault（默认号到顶才退回 accountFallback.to，11/22）；/api/state 带 accountState 的结果；ui.html 只读结果，不碰钥匙串。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// ───────────── 为什么这样做 ─────────────
// Claude Code 的登录只存一份（钥匙串里的 Claude Code-credentials），所有窗口共用。
// 要让某一个会话用另一个号，给它的进程设 CLAUDE_CODE_OAUTH_TOKEN（`claude setup-token` 生成的长期 token）。
// 只换登录，~/.claude、记忆、对话记录照旧共用；不用另开 CLAUDE_CONFIG_DIR（那会把记忆也拆成两份）。
// token 只放在钥匙串里（service = ccboard-account-<id>），不进 config.json、不进命令行参数：
// tmux 起的是一层 zsh，由它在会话里读钥匙串，再 exec claude。
import fs from 'node:fs';
import path from 'node:path';

export const SERVICE_PREFIX = 'ccboard-account-';
const SECURITY = process.env.CCBOARD_SECURITY || '/usr/bin/security';   // 测试换成假的，真钥匙串碰不到
const ID = /^[A-Za-z0-9][\w.-]{0,39}$/;           // 也要满足 statusline-tap.mjs 的 CCBOARD_ACCOUNT 规则 [\w.@-]{1,40}

// config.json 的 accounts：[{ id, name }]。写错就抛错，交给 server.mjs 的「整份不用」那条路
export function parseAccounts(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('accounts 要是数组');
  const seen = new Set();
  return raw.map((a, i) => {
    if (!a || typeof a !== 'object' || !ID.test(String(a.id || ''))) throw new Error(`accounts[${i}].id 只能是字母数字开头、40 个字符以内的 [\\w.-]`);
    if (seen.has(a.id)) throw new Error(`accounts[${i}].id 重复：${a.id}`);
    seen.add(a.id);
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 40) : a.id;
    return { id: a.id, name };
  });
}

// config.json 的 accountFallback（11/22 Khalil：「我之后新建的任务开到主号」，总管 khalil-4c 定「主号真到顶才退回朋友号」）：
// { to: 退到哪个号, at: 默认号读数到多少算到顶（50–100，不写 95）, toMax: 退回的号自己到多少就不往它那儿退（50–100，不写 = at）, note: 退回时追加一行的文件（完整路径，可不写） }。
// toMax 的起因（11/22 审查）：退回的号可能自己也有一条更低的线，主号到顶时不能把新任务送到同样到顶的号；两个都到顶就照旧开默认号。
// 写错只关掉这一项、说清原因，不连累整份 config（同 remote / apns）：返回 { fb: null | {to, at, note}, error }
export function parseFallback(raw, accounts, defaultAccount) {
  if (raw === undefined) return { fb: null, error: null };
  const bad = (why) => ({ fb: null, error: why });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('要是一个对象');
  const odd = Object.keys(raw).filter((k) => !['to', 'at', 'toMax', 'note'].includes(k));
  if (odd.length) return bad('不认识的键：' + odd.slice(0, 3).join('、').slice(0, 60));   // note 拼成 notes 就悄悄没有记录，所以拼错算写错
  if (!defaultAccount) return bad('没有 defaultAccount，没有可退的');
  if (!accounts.some((a) => a.id === raw.to)) return bad('to 要是 accounts 里登记过的 id');
  if (raw.to === defaultAccount) return bad('to 和 defaultAccount 是同一个号');
  const at = raw.at === undefined ? 95 : raw.at;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 50 || at > 100) return bad('at 要是 50 到 100 之间的数');
  const toMax = raw.toMax === undefined ? at : raw.toMax;
  if (typeof toMax !== 'number' || !Number.isFinite(toMax) || toMax < 50 || toMax > 100) return bad('toMax 要是 50 到 100 之间的数');
  if (raw.note !== undefined && (typeof raw.note !== 'string' || !path.isAbsolute(raw.note))) return bad('note 要是完整路径');
  return { fb: { to: raw.to, at, toMax, note: raw.note || '' }, error: null };
}

// 没明说账号时开哪个号：默认号；默认号这周或这 5 小时的最新读数到了 at 才退回 to。entries 是 limits.mjs 汇总的 Claude 条目。
// 过了截止时间的窗口不算（重置以后照常开默认号）；默认号没有读数 = 不知道到没到顶，照常开默认号（和没这一项时一样）。
// 退回的号自己这周或这 5 小时也到了 toMax：不退，照旧开默认号，返回里带 blocked（服务记一笔）。读数可能带小数：比的是原数，返回的 used 取整（只给人看）。
// 返回 { id, from?, key?, used?, resetsAt? } 带 from 就是退回了；{ id, blocked: { key, used, to, toKey, toUsed } } 是两个号都到顶
export function pickDefault(defaultAccount, fb, entries, now = Date.now()) {
  if (!defaultAccount || !fb) return { id: defaultAccount || '' };
  const over = (account, line) => { const e = (entries || []).find((x) => x && x.account === account); return e && Array.isArray(e.windows) ? e.windows.find((w) => (w.key === 'week' || w.key === 'five_hour') && w.resetsAt > now && w.used >= line) : null; };
  const top = over(defaultAccount, fb.at);
  if (!top) return { id: defaultAccount };
  const full = over(fb.to, fb.toMax === undefined ? fb.at : fb.toMax);
  if (full) return { id: defaultAccount, blocked: { key: top.key, used: Math.round(top.used), resetsAt: top.resetsAt, to: fb.to, toKey: full.key, toUsed: Math.round(full.used) } };
  return { id: fb.to, from: defaultAccount, key: top.key, used: Math.round(top.used), resetsAt: top.resetsAt };
}

// 每个号钥匙串里有没有 token。只问「有没有这一项」，不取值（不带 -w），不会弹授权窗。30 秒内复用上一次的结果
let cache = { at: 0, list: [] };
export async function accountState(accounts, run, now = Date.now()) {
  if (!accounts.length) return [];
  if (now - cache.at < 30000 && cache.list.length === accounts.length) return cache.list;
  const list = [];
  for (const a of accounts) {
    const r = await run(SECURITY, ['find-generic-password', '-s', SERVICE_PREFIX + a.id], { timeout: 5000 });
    list.push({ ...a, ready: r.ok });
  }
  cache = { at: now, list };
  return list;
}
export function forgetState() { cache = { at: 0, list: [] }; }

// 把「claude 及其参数」包一层：会话里先读钥匙串，读不到就停在屏幕上说明原因，读到了再 exec。
// 返回给 tmux new-session 的完整 argv。token 不出现在任何参数里，只有 service 名
const SCRIPT = [
  'export CCBOARD_ACCOUNT="$3"',
  'export CLAUDE_CODE_OAUTH_TOKEN="$("$1" find-generic-password -s "$2" -w 2>/dev/null)"',
  'shift 3',
  'if [[ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]]; then print -u2 "总控台：钥匙串里没有这个账号的 token（$CCBOARD_ACCOUNT）。窗口 2 分钟后关闭。"; sleep 120; exit 1; fi',
  'exec "$@"',
].join('\n');
export function wrapLaunch(account, argv) {
  if (!account) return argv;
  return ['/bin/zsh', '-fc', SCRIPT, 'ccboard', SECURITY, SERVICE_PREFIX + account.id, account.id, ...argv];
}
// 后台调用（判官 judge、自动续跑的小模型）用同一个包法，只是读不到 token 时马上退（码 45）、原因写 stderr：
// 窗口那一版会在屏幕上停 2 分钟给人看，后台调用照搬就白等到 90 秒超时（11/20 judge 换号）
const SCRIPT_BG = SCRIPT.replace('print -u2 "总控台：钥匙串里没有这个账号的 token（$CCBOARD_ACCOUNT）。窗口 2 分钟后关闭。"; sleep 120; exit 1', 'print -u2 "钥匙串里没有这个账号的 token（$CCBOARD_ACCOUNT）"; exit 45');
if (SCRIPT_BG === SCRIPT) throw new Error('accounts.mjs：SCRIPT_BG 没换掉等 2 分钟那一句');
export function wrapBackground(account, argv) {
  if (!account) return argv;
  return ['/bin/zsh', '-fc', SCRIPT_BG, 'ccboard', SECURITY, SERVICE_PREFIX + account.id, account.id, ...argv];
}

// 默认那一项写成「默认（当前登录 ben…）」：从 ~/.claude.json 取邮箱的前 3 个字符，界面只给这么多
export function loginLabel(home) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    const e = String((j.oauthAccount || {}).emailAddress || '');
    return e ? e.slice(0, 3) + '…' : null;
  } catch { return null; }
}
