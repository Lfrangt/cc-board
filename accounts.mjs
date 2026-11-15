/**
 * [INPUT]: 依赖 config.json 的 accounts 数组（server.mjs 读出来交进来）；依赖 macOS 的 /usr/bin/security 读钥匙串（测试用 CCBOARD_SECURITY 换成假的）；依赖 ~/.claude.json 的 oauthAccount 认出当前登录的号。
 * [OUTPUT]: 导出 parseAccounts、accountState、wrapLaunch、loginLabel、SERVICE_PREFIX。
 * [POS]: 总控台「新任务选账号」的唯一实现。server.mjs 的 newSession 调 wrapLaunch，/api/state 带 accountState 的结果；ui.html 只读结果，不碰钥匙串。
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

// 默认那一项写成「默认（当前登录 ben…）」：从 ~/.claude.json 取邮箱的前 3 个字符，界面只给这么多
export function loginLabel(home) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    const e = String((j.oauthAccount || {}).emailAddress || '');
    return e ? e.slice(0, 3) + '…' : null;
  } catch { return null; }
}
