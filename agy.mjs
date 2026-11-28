// Google Antigravity CLI（agy）接进总控台用的纯规则，加一个给 agy 状态栏调用的取数小脚本（node agy.mjs tap <文件>）。
//
// 合规（11/24 订阅条款调研，路线 B）：总控台只替他开一个官方 agy 终端，
// 由他本人用。不碰 agy 的登录凭证、不包 agy -p、不让别的窗口或自动化替他往 agy 里打字。所以：
//   · 开 Antigravity 窗口、往里发话、点它的选择框，只认他本人：带 Origin 的界面请求，或配过对的手机（远程端口）。
//     这是防总控台自己的自动化（自动续跑、保温、别的窗口 curl /api/new）误碰，不是防有人故意伪造 Origin 头。
//   · 自动续跑、保温、自动点信任框都不碰它（autopilot.mjs 只认 claude；保温只看 Claude 的记录；autoTrust 不对它起）。
//
// 忙 / 闲不读屏幕也不猜：agy 1.5.18 的 statusLine 每次状态变就把一份 JSON 从 stdin 交给一条命令（sh -c，≤ 300 ms 一次，5 秒超时）。
// 总控台开窗口时用 --settings <本窗口的设置文件> 只给这一个会话挂上 statusLine（不改他全局的 agy 设置），命令就是下面的 tap：
// 把那份 JSON 去掉邮箱、写成 <数据目录>/agy/<tmux 名>.tap.json（先写临时文件再改名，读的一方读不到半份）。
// 交付的正文读 agy 自己的对话记录 brain/<会话号>/.system_generated/logs/transcript.jsonl（格式出自第三方解析器，本机还没有真样本）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGY_BUSY = new Set(['working', 'tool_use', 'reviewing']);     // reviewing 的意思没核到：先当在忙（它没回到 idle 就不算交付）
export const AGY_IDLE = new Set(['idle', 'initializing', 'authenticating']);
const CID_RE = /^[\w-]{8,80}$/;                                           // 和 server.mjs 的 SID_RE 同一个写法：拼不出上一层

// 状态栏那份 JSON 里总控台要的几栏。email 不要（他的账号邮箱，不落盘、不进 /api/state）
export function slimTap(p, now = Date.now()) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const s = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const m = p.model && typeof p.model === 'object' ? p.model : {};
  const cw = p.context_window && typeof p.context_window === 'object' ? p.context_window : {};
  const quota = {};
  if (p.quota && typeof p.quota === 'object') {
    for (const [k, v] of Object.entries(p.quota).slice(0, 8)) {
      if (!/^[\w-]{1,32}$/.test(k) || !v || typeof v !== 'object') continue;
      quota[k] = { left: num(v.remaining_fraction), resetAt: s(v.reset_time, 40), resetIn: num(v.reset_in_seconds) };
    }
  }
  return {
    at: now, state: s(p.agent_state, 32), cid: s(p.conversation_id, 80) || null, session: s(p.session_id, 80) || null,
    transcript: s(p.transcript_path, 1024) || null, cwd: s(p.cwd, 1024) || s(p.workspace, 1024) || null,
    model: s(m.id, 80) || null, modelName: s(m.display_name, 80) || null, effort: s(m.effort, 32) || null,
    ctx: num(cw.used_percentage), quota, plan: s(p.plan_tier, 40) || null, version: s(p.version, 40) || null,
    confirm: p.tool_confirmation_pending === true, queued: num(p.pending_input_count) || 0, tasks: num(p.task_count) || 0,
  };
}

// 状态栏上显示的那一行（他在 agy 终端底下看到的）：模型、上下文、Gemini 5 小时 / 周额度还剩多少
export function tapLine(t) {
  if (!t) return '';
  const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) + '%' : null);
  const parts = [t.modelName || t.model, typeof t.ctx === 'number' ? '上下文 ' + Math.round(t.ctx) + '%' : null];
  const g5 = t.quota && t.quota['gemini-5h'], gw = t.quota && t.quota['gemini-weekly'];
  if (g5 && pct(g5.left)) parts.push('5h 剩 ' + pct(g5.left));
  if (gw && pct(gw.left)) parts.push('周剩 ' + pct(gw.left));
  return parts.filter(Boolean).join(' · ') + ' · 总控台在看';
}

// tap → 卡片上的状态。confirm（工具在等他点允许）= waiting；error = 闲着、带一条报错。没有 tap = null（还在起，不上墙）
export function agyStatus(t) {
  if (!t || typeof t.state !== 'string') return null;
  const at = new Date(t.at || Date.now()).toISOString();
  if (t.confirm) return { status: 'waiting', busy: true, halt: null };
  if (AGY_BUSY.has(t.state)) return { status: 'busy', busy: true, halt: null };
  if (t.state === 'error') return { status: 'idle', busy: false, halt: { kind: 'error', text: 'Antigravity 报错（去终端看）', at } };
  if (AGY_IDLE.has(t.state)) return { status: 'idle', busy: false, halt: null };
  return { status: 'idle', busy: false, halt: null };                     // 没见过的状态名：当闲着，不当交付（交付要记录里真有一段回复）
}

// /api/new、/api/send、/api/answer 对 Antigravity 的那道闸，和不接的参数。报错不忽略：悄悄丢掉，调用方会以为生效了（和写错档位同一个理由）
export function agyReject(o, human, models = null) {
  if (!human) return 'Antigravity 窗口只能由他本人从总控台界面（或配过对的手机）开、发话、点选择框、接回和停掉：总控台的自动化和别的窗口都不碰它（合规）';
  for (const [k, what] of [['tier', '档位'], ['effort', '强度（Antigravity 的强度写在模型名里）'], ['account', '账号'], ['brief', '派活单'], ['auto', 'auto']]) if (o[k] != null && o[k] !== '') return 'Antigravity 不接' + what + '（' + k + '）';
  if (o.codeMode != null && o.codeMode !== false) return 'Code Mode 只有 Claude Code 有';
  if (o.model != null && o.model !== '') {
    if (typeof o.model !== 'string' || !/^\w[\w.\-]{0,63}$/.test(o.model)) return 'Antigravity 的模型写法不对';   // 不许 - 开头：不然会被 agy 当成一个旗子
    if (Array.isArray(models) && models.length && !models.includes(o.model)) return 'Antigravity 没有这个模型：' + o.model;
  }
  return '';
}

// 开窗口的命令行：agy [--conversation <会话号>] [--model <id>] --settings <设置文件> [-i <任务>]
export function agyArgs({ bin, model, settings, text, cid }) {
  const a = [bin];
  if (cid) a.push('--conversation', cid);
  if (model) a.push('--model', model);
  a.push('--settings', settings);
  if (text) a.push('-i', text);
  return a;
}

// 单引号包起来给 sh -c：数据目录 Application Support 中间有空格
export const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// 本窗口的 --settings 文件内容：只挂一个 statusLine，命令是「node agy.mjs tap <本窗口的 tap 文件>」
export function agySettings(node, script, tapFile) {
  return { statusLine: { type: 'command', command: [node, script, 'tap', tapFile].map(shq).join(' ') } };
}

// agy models 的输出：一行一个「id<Tab>名字」。认不出的行跳过；一行都没认出 = null（当没取到，不当「没有模型」）
export function parseAgyModels(out) {
  const ids = [], labels = {};
  for (const line of String(out || '').split('\n')) {
    const m = line.match(/^(\w[\w.\-]{0,63})\t+(.+?)\s*$/);
    if (!m || labels[m[1]]) continue;
    ids.push(m[1]); labels[m[1]] = m[2].slice(0, 80);
  }
  return ids.length ? { ids, labels } : null;
}

// 记录里「他说的话」：<USER_REQUEST> 里面那段（外面是 agy 附的元数据）；没有这个标签就原样
export function agyUserText(c) {
  const t = agyText(c);
  const m = t.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  return (m ? m[1] : t).trim();
}
export function agyText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(agyText).filter(Boolean).join('\n');
  if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  return '';
}

// 对话记录可能在哪：tap 给的路径优先；再按会话号拼两种目录写法（antigravity-cli 是 1.5.x 的，antigravity 是 tap 在会话号为空时报过的写法）
export function transcriptCandidates(home, cid, tapPath) {
  const out = [];
  if (!cid || !CID_RE.test(cid)) return out;                              // 没有会话号时 tap 给的是 brain/.system_generated/…（拼漏了会话号那一段），不认
  if (typeof tapPath === 'string' && path.isAbsolute(tapPath) && tapPath.startsWith(path.join(home, '.gemini') + '/') && tapPath.endsWith('.jsonl') && tapPath.includes('/' + cid + '/') && !tapPath.split('/').includes('..')) out.push(tapPath);   // 只认 ~/.gemini/ 底下的
  for (const d of ['antigravity-cli', 'antigravity']) out.push(path.join(home, '.gemini', d, 'brain', cid, '.system_generated', 'logs', 'transcript.jsonl'));
  return [...new Set(out)];
}

// 记录里的时间：认得出的日期字符串原样；数字按量级认秒 / 毫秒 / 微秒 / 纳秒；别的写法、超出范围的 = null
export function agyTs(v) {
  if (typeof v === 'string') return Number.isNaN(Date.parse(v)) ? null : v;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const ms = v >= 1e17 ? v / 1e6 : v >= 1e14 ? v / 1e3 : v >= 1e11 ? v : v * 1000;   // 纳秒 / 微秒 / 毫秒 / 秒，按量级认（FIX-1：纳秒原来直接 new Date，toISOString 抛 RangeError，卡片冻住）
  const d = new Date(ms); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// agy 自己记的步骤类型 → 卡片上「在做什么」那一格
const STEP_LINE = { CODE_ACTION: '改文件', VIEW_FILE: '读文件', LIST_DIRECTORY: '看目录', GREP_SEARCH: '搜代码', RUN_COMMAND: '跑命令', SEARCH_WEB: '搜网页', ASK_QUESTION: '问你' };
export const agyStepLine = (d) => STEP_LINE[d.type] || (Array.isArray(d.tool_calls) && d.tool_calls[0] && typeof d.tool_calls[0].name === 'string' ? d.tool_calls[0].name.replace(/_/g, ' ').slice(0, 40) : null);
export const agyEdit = (d) => d.type === 'CODE_ACTION' || (Array.isArray(d.tool_calls) && d.tool_calls.some((x) => x && /write|replace|edit|create/i.test(String(x.name || ''))));

// ── 状态栏调用的那条命令：node agy.mjs tap <文件> ──
// 读 stdin 的 JSON，去掉邮箱写成 <文件>（临时文件 + 改名），打印一行状态给 agy 显示。出了任何错都只打印空串、退出 0：
// 状态栏坏了不能连累他在 agy 里干活
async function tapMain(file) {
  let line = '';
  try {
    const chunks = []; for await (const c of process.stdin) chunks.push(c);
    const t = slimTap(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (t && file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(t)); fs.renameSync(tmp, file);
      line = tapLine(t);
    }
  } catch {}
  process.stdout.write(line);
}
const isMain = () => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };   // 数据目录有空格：import.meta.url 里是 %20，不能拿字符串比
if (process.argv[2] === 'tap' && isMain()) tapMain(process.argv[3]);
