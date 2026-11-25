/**
 * [INPUT]: 依赖 ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl（只读，token_count 事件里的 rate_limits）；依赖 <数据目录>/limits/claude-*.json（statusline-tap.mjs 写的，只读）。不联网，不起进程，不读任何登录凭据。
 *           Gemini：依赖 <数据目录>/limits/gemini-balance.json（人从 AI Studio 结算页读到的余额，手写的「锚点」：{ amount, currency, usdPerUnit, at }），和调用方给的花费账本（网关的 logs/spend.tsv、回调写的 *.jsonl；只读，文件不在 = 没有行）。
 * [OUTPUT]: 导出 codexLimits(codexHome, now)、claudeLimits(dir, now)、geminiLimits(dir, now, { ledgers })、geminiAnchorFile(dir)、limitPins(claude, { pin, defaultAccount })、parseLimitsPin(v)、parseCodexTail(text)、tapFile(dir, session)、purgeTaps(dir, now)、windowKey(minutes)。
 *           每个订阅一条 { id, provider, account, plan, at, windows: [{ key, used, resetsAt }] }：used 是 0 以上的百分数，resetsAt 是毫秒时间戳，key 是 five_hour / week / other。
 *           limitPins：顶栏额度收起时钉住哪几条（条目 id 的数组）：config 的 limitsPin 给了就照它；没给 = 没标账号的 Claude 那条 + defaultAccount 那条（11/24 ng 车）。parseLimitsPin 校验 limitsPin，写错整项不用。
 * [POS]: 顶栏右上角「各订阅周额度」的唯一数据来源。server.mjs 隔半分钟调一次，结果挂在 /api/state 的 limits 字段；界面只收结果。
 *        两家的来源不同：Codex 自己把额度写进每次 token_count 事件；Claude Code 只在状态栏的 JSON 里给 rate_limits（文档写明只有 Pro / Max / Ultra 订阅有，且要等第一次 API 回复之后），
 *        所以由 statusline-tap.mjs 在会话里取走、存成一个会话一个文件，这里再汇总。一个会话一个文件是为了几十个窗口同时写也不会互相覆盖。
 *        窗口过了 resets_at 就丢掉（Claude Code 自己的状态栏也这么做）：过期的百分比比没有更糟。
 *        同一个号的周窗口截止时间是同一个，所以没标账号的数据按它分组；有标账号的（会话是总控台按账号开的）按账号分，并把同一个截止时间的无标数据认给它。
 *        Gemini 不一样：Google 没有查 AI Studio 预付余额的接口（文档里没有，也不读他的网页登录），所以这里是「账本估算」——锚点余额减去锚点之后账本里记的花费，折回锚点的币种。
 *        它是估算，而且只会偏高：别的 key（openclaw、网页、别的机器）花的钱不在账本里。条目没有 windows，数在 balance 里（estimate 恒为 true）；锚点多久前读的由界面按 balance.anchorAt 判。
 *        账本去重：.tsv 是旧记账（second-opinion 直接写），.jsonl 是网关回调写的（网关里每次调用都有，包括 second-opinion 的）；.jsonl 有了以后，比它最早一行更早的 .tsv 行才算，不重复数。
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

// ───────────── 收起时钉住哪几条（11/24 ng 车） ─────────────
// 顶栏额度那一排默认收起，只留「钉住」的几格。原来界面写死作者本机的 claude:main、claude:alt，别人装上以后一格都不钉。
// 现在服务算好交给界面（/api/state 的 limits.pin）：config 的 limitsPin 写了就照它；没写 = 没标账号的那条（没配 accounts 的人只有这一条）+ defaultAccount 那条。
// 两个号都标了账号、又没写 defaultAccount 时一条都不钉：不猜哪个是主号。
export const LIMITS_PIN_MAX = 16;
const PIN_ID = /^(?:claude:[\w.@-]{1,40}|codex|gemini)$/;      // 和条目的 id 同一套：claude:<账号 id>（ACCOUNT_ID）、codex、gemini
export function parseLimitsPin(v) {
  if (v === undefined || v === null) return { pin: null };
  if (!Array.isArray(v)) return { pin: null, error: '要是额度条目 id 的数组' };
  if (v.length > LIMITS_PIN_MAX) return { pin: null, error: '最多 ' + LIMITS_PIN_MAX + ' 个' };
  const bad = v.find((x) => typeof x !== 'string' || !PIN_ID.test(x));
  if (bad !== undefined) return { pin: null, error: '认不出 ' + JSON.stringify(bad).slice(0, 60) + '（要 claude:<账号 id>、codex 或 gemini）' };
  return { pin: [...new Set(v)] };
}
export function limitPins(claude, { pin = null, defaultAccount = '' } = {}) {
  if (Array.isArray(pin)) return [...pin];
  return (claude || []).filter((e) => e.account == null || (defaultAccount && e.account === defaultAccount)).map((e) => e.id);
}

// ───────────── Gemini（API 预付余额的估算） ─────────────

const GEMINI_ANCHOR = 'gemini-balance.json';
const GEMINI_LEDGER_MAX = 16 * 1024 * 1024;       // 账本超过这么大不读（算一个坏的）：每 30 秒整份读一遍，不能无限长
const TSV_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;   // second-opinion 写的本地时间，没有时区
const r6 = (x) => Math.round(x * 1e6) / 1e6;       // 0.7 + 0.1 不能出 0.7999999999999999

// 锚点文件的路径。写的人（set-balance 脚本、手写）和这里读的都用这一个名字。
export function geminiAnchorFile(dir) { return path.join(dir, GEMINI_ANCHOR); }

// 毫秒数或 ISO 串 → 毫秒；小于 1e11（1973 年以前）当作写成了秒，不认：错认成毫秒会把整个账本算到 1970 年去
function stamp(x) {
  const t = num(x) ? x : typeof x === 'string' ? Date.parse(x) : NaN;
  return Number.isFinite(t) && t >= 1e11 ? t : null;
}
function tsvStamp(s) {
  const m = TSV_TIME.exec(String(s).trim()); if (!m) return null;
  if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) return null;   // Date 构造函数遇到 13 月、25 点不报错，会悄悄滚到下一年、下一天
  return stamp(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime());
}

// 一份账本 → { rows: [{ at, usd, kind }], bad }。文件不在是没有行（还没人记过账），读不了 / 太大 / 认不出格式才算 bad。
function ledgerRows(file) {
  const kind = /\.tsv$/i.test(file) ? 'tsv' : /\.jsonl$/i.test(file) ? 'jsonl' : null;
  if (!kind) return { rows: [], bad: 1 };
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > GEMINI_LEDGER_MAX) return { rows: [], bad: 1 };
    text = fs.readFileSync(file, 'utf8');
  } catch (e) { return { rows: [], bad: e && e.code === 'ENOENT' ? 0 : 1 }; }
  const rows = []; let bad = 0, first = true;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const head = first; first = false;
    let at = null, usd = null;
    if (kind === 'tsv') {
      if (head && line.startsWith('time\t')) continue;                  // 表头
      const c = line.split('\t');
      at = tsvStamp(c[0]); usd = c.length >= 6 && c[5].trim() !== '' ? Number(c[5]) : null;
    } else {
      let d; try { d = JSON.parse(line); } catch { bad++; continue; }
      if (d && typeof d === 'object') { at = stamp(d.at); usd = d.usd; }
    }
    if (at == null || !num(usd) || usd < 0) { bad++; continue; }
    rows.push({ at, usd, kind });
  }
  return { rows, bad };
}

// 余额估算。没有锚点、锚点写坏了（币种、金额、汇率、时间任一项不对）都是 null：不猜。
// 币种是 USD 时汇率恒为 1（写了别的也不理）；别的币种要写 usdPerUnit（1 单位折多少美元），由读余额的人带出处，这里不查汇率。
export function geminiLimits(dir, now = Date.now(), opts = {}) {
  let a; try { a = JSON.parse(fs.readFileSync(geminiAnchorFile(dir), 'utf8')); } catch { return null; }
  if (!a || typeof a !== 'object') return null;
  const at = stamp(a.at), currency = typeof a.currency === 'string' && /^[A-Z]{3}$/.test(a.currency) ? a.currency : null;
  const rate = currency === 'USD' ? 1 : a.usdPerUnit;
  if (at == null || !currency || !num(a.amount) || a.amount < 0 || !num(rate) || !(rate > 0)) return null;
  const all = []; let bad = 0, jsonlFrom = Infinity;
  for (const f of Array.isArray(opts.ledgers) ? opts.ledgers : []) {
    if (typeof f !== 'string') continue;
    const r = ledgerRows(f); bad += r.bad;
    for (const x of r.rows) { all.push(x); if (x.kind === 'jsonl' && x.at < jsonlFrom) jsonlFrom = x.at; }
  }
  const floor = Math.floor(at / 60000) * 60000;     // .tsv 只有分钟：锚点那一分钟里的行多半在锚点之后，宁可多算一行（估算本来就偏高，多算让它偏低一点）
  let spentUsd = 0, rows = 0;
  for (const x of all) {
    if (x.kind === 'tsv' ? !(x.at >= floor && x.at < jsonlFrom) : !(x.at >= at)) continue;
    spentUsd += x.usd; rows++;
  }
  const spent = spentUsd / rate;
  return { id: 'gemini', provider: 'gemini', account: null, plan: null, at, windows: [],
    balance: { currency, remaining: r6(Math.max(0, a.amount - spent)), start: a.amount, spent: r6(spent), spentUsd: r6(spentUsd), usdPerUnit: rate, anchorAt: at, estimate: true, rows, bad } };
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
