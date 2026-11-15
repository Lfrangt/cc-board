/**
 * [INPUT]: 依赖 ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl（只读，token_count 事件里的 rate_limits）；依赖 <数据目录>/limits/claude-*.json（statusline-tap.mjs 写的，只读）。不联网，不起进程，不读任何登录凭据。
 * [OUTPUT]: 导出 codexLimits(codexHome, now)、claudeLimits(dir, now)、parseCodexTail(text)、tapFile(dir, session)、purgeTaps(dir, now)、windowKey(minutes)。
 *           每个订阅一条 { id, provider, account, plan, at, windows: [{ key, used, resetsAt }] }：used 是 0 以上的百分数，resetsAt 是毫秒时间戳，key 是 five_hour / week / other。
 * [POS]: 顶栏右上角「各订阅周额度」的唯一数据来源。server.mjs 隔半分钟调一次，结果挂在 /api/state 的 limits 字段；界面只收结果。
 *        两家的来源不同：Codex 自己把额度写进每次 token_count 事件；Claude Code 只在状态栏的 JSON 里给 rate_limits（文档写明只有 Pro / Max / Ultra 订阅有，且要等第一次 API 回复之后），
 *        所以由 statusline-tap.mjs 在会话里取走、存成一个会话一个文件，这里再汇总。一个会话一个文件是为了几十个窗口同时写也不会互相覆盖。
 *        窗口过了 resets_at 就丢掉（Claude Code 自己的状态栏也这么做）：过期的百分比比没有更糟。
 *        同一个号的周窗口截止时间是同一个，所以没标账号的数据按它分组；有标账号的（会话是总控台按账号开的）按账号分，并把同一个截止时间的无标数据认给它。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import fs from 'node:fs';
import path from 'node:path';

export const TAP_PREFIX = 'claude-';
const TAP_KEEP_MS = 14 * 86400000;           // 没人更新超过这么久的取数文件清掉
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;   // 会话号要进文件名，只放行这种
const ACCOUNT_ID = /^[\w.@-]{1,40}$/;         // 账号标记同理：进数据文件、也会显示在界面上
const CODEX_DAYS = 14, CODEX_FILES = 8, CODEX_TAIL = 256 * 1024;

const num = (x) => typeof x === 'number' && Number.isFinite(x);

export function windowKey(minutes) { return minutes === 300 ? 'five_hour' : minutes === 10080 ? 'week' : 'other'; }

// 一个窗口 → { key, used, resetsAt(ms) }；缺哪一项都不要
function codexWindow(w) {
  if (!w || !num(w.used_percent) || !num(w.window_minutes) || !num(w.resets_at)) return null;
  return { key: windowKey(w.window_minutes), used: Math.max(0, w.used_percent), resetsAt: w.resets_at * 1000 };
}

// ───────────── Codex ─────────────

// 一段 jsonl 文本里最后一条 token_count 的 rate_limits。尾巴的第一行常被截断，解析不了就跳过。
export function parseCodexTail(text) {
  let best = null;
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"rate_limits"')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const p = d && d.payload; if (!p || p.type !== 'token_count') continue;
    const rl = p.rate_limits; if (!rl || typeof rl !== 'object') continue;
    if (rl.limit_id && rl.limit_id !== 'codex') continue;     // 别的限额（按模型单列的）不是订阅的周额度
    const at = Date.parse(d.timestamp); if (!Number.isFinite(at)) continue;
    const windows = [rl.primary, rl.secondary].map(codexWindow).filter(Boolean);
    if (best && at < best.at) continue;
    best = { at, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null, windows };
  }
  return best;
}

const pad = (n) => String(n).padStart(2, '0');
// 最近几天的 rollout 文件，按修改时间新的在前。续跑的老会话记录文件在老日期的目录里，所以按修改时间排，不按目录日期排。
function recentRollouts(root, now) {
  const out = [];
  for (let i = -1; i < CODEX_DAYS; i++) {          // 从明天起：目录日期可能按另一个时区算
    const d = new Date(now - i * 86400000);
    const dir = path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    let names; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^rollout-.*\.jsonl$/.test(n)) continue;
      const file = path.join(dir, n); try { const st = fs.statSync(file); out.push({ file, mtimeMs: st.mtimeMs, size: st.size }); } catch {}
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, CODEX_FILES);
}

const codexCache = new Map();                      // 文件 → { mtimeMs, size, rec }：没变的文件不重读
function tailOf(f) {
  const hit = codexCache.get(f.file);
  if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.rec;
  let rec = null;
  try {
    const fd = fs.openSync(f.file, 'r');
    try { const n = Math.min(f.size, CODEX_TAIL); const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, f.size - n); rec = parseCodexTail(buf.toString('utf8')); } finally { fs.closeSync(fd); }
  } catch {}
  codexCache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, rec });
  if (codexCache.size > 64) codexCache.delete(codexCache.keys().next().value);
  return rec;
}

export function codexLimits(codexHome, now = Date.now()) {
  let best = null;
  for (const f of recentRollouts(path.join(codexHome, 'sessions'), now)) { const r = tailOf(f); if (r && (!best || r.at > best.at)) best = r; }
  if (!best) return null;
  return { id: 'codex', provider: 'codex', account: null, plan: best.plan, at: best.at, windows: best.windows.filter((w) => w.resetsAt > now) };
}

// ───────────── Claude Code（状态栏取走的） ─────────────

// 取数文件的路径。statusline-tap.mjs 写、这里读，文件名只在这一处定。
export function tapFile(dir, session) { return typeof session === 'string' && SESSION_ID.test(session) ? path.join(dir, TAP_PREFIX + session + '.json') : null; }   // 不用 String() 转：undefined 会变成 "undefined"，正好够 8 位

// 状态栏 JSON 的 rate_limits → 窗口列表（只认 five_hour 和 seven_day；resets_at 是秒）
export function tapWindows(rl) {
  const out = [];
  for (const [name, key] of [['five_hour', 'five_hour'], ['seven_day', 'week']]) {
    const w = rl && rl[name]; if (!w || !num(w.used_percentage) || !num(w.resets_at)) continue;
    out.push({ key, used: Math.max(0, w.used_percentage), resetsAt: w.resets_at * 1000 });
  }
  return out;
}

function readTaps(dir) {
  let names; try { names = fs.readdirSync(dir).sort(); } catch { return []; }     // 排一下：APFS 不保证目录顺序，结果不能跟着文件系统的心情变
  const out = [];
  for (const n of names) {
    if (!n.startsWith(TAP_PREFIX) || !n.endsWith('.json')) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { continue; }
    if (!d || typeof d !== 'object' || !num(d.at)) continue;
    out.push({ at: d.at, account: typeof d.account === 'string' && ACCOUNT_ID.test(d.account) ? d.account : null, windows: tapWindows(d.rate_limits) });
  }
  return out;
}

export function claudeLimits(dir, now = Date.now()) {
  const live = readTaps(dir).map((t) => ({ ...t, windows: t.windows.filter((w) => w.resetsAt > now) })).filter((t) => t.windows.length);
  const anchorOf = (t) => { const w = t.windows.find((x) => x.key === 'week') || t.windows[0]; return Math.round(w.resetsAt / 60000); };   // 周窗口截止时间（到分钟）：同一个号的所有会话相同
  const named = new Map();                        // 截止时间 → 账号：有标记的会话告诉我们这个截止时间属于谁
  for (const t of live) if (t.account) named.set(anchorOf(t), t.account);
  const groups = new Map();
  for (const t of live) {
    const account = t.account || named.get(anchorOf(t)) || null;
    const id = account ? 'claude:' + account : 'claude:w' + anchorOf(t);
    const g = groups.get(id);
    if (!g || t.at > g.at) groups.set(id, { id, provider: 'claude', account, plan: null, at: t.at, windows: t.windows });
  }
  return [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // 按 id 排：几个窗口轮流更新时，顶栏上的先后不跳
}

// 很久没人更新的取数文件（会话早没了）清掉。返回清了几个。
export function purgeTaps(dir, now = Date.now()) {
  let n = 0, names; try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const f of names) {
    if (!f.startsWith(TAP_PREFIX) || !f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    try { if (now - fs.statSync(p).mtimeMs > TAP_KEEP_MS) { fs.unlinkSync(p); n++; } } catch {}
  }
  return n;
}
