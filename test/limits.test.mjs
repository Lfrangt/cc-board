/**
 * [INPUT]: 依赖 ../limits.mjs（或命令行给的另一份，比如改坏版）和 ../statusline-tap.mjs（端到端那一项）。Codex 记录夹具照真实 rollout 里 token_count 事件的结构手搭（limit_id、primary、plan_type），Claude 的取数文件照 tap 脚本写出来的样子。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造 42 个改坏的 limits.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「各订阅周额度」测试。不起服务，在临时目录里造假主目录和假数据目录，两秒内跑完。
 *        测：Codex 取最后一条而不是第一条、只认订阅那一条限额、截断的行不崩、窗口缺字段就丢、过期窗口丢掉；Claude 的多个窗口按周窗口截止时间分成各自的号、有标记的号认领同截止时间的无标数据、几个会话轮流更新时先后不跳；会话号和账号标记进文件名前要过滤；tap 脚本落盘只有额度、坏输入安静退出。
 *        Gemini 余额估算（11/23）：锚点 − 锚点之后的账本花费，折回锚点币种；没有锚点或锚点写坏了就没有这一项；.tsv 只有分钟（锚点那一分钟算上）；.jsonl 出现后更早的 .tsv 行才算（不重复数）；坏行数进 bad、不算花费；余额封在 0；浮点尾巴去掉；锚点文件和取数文件同目录、互不被清。
 *        收起时钉住哪几条（11/24 ng 车）：limitPins 默认 = 没标账号的那条 + defaultAccount 那条、config 的 limitsPin 压过默认、回拷贝；parseLimitsPin 认得的写法、去重、写错整项不用并说原因。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/limits.test.mjs [limits.mjs 的路径]      node test/limits.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../limits.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'limits-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'any-limit-id':      ["if (rl.limit_id && rl.limit_id !== 'codex') continue;", ''],
    'any-event-type':    ["if (!p || p.type !== 'token_count') continue;", 'if (!p) continue;'],
    'first-record-wins': ['if (best && at < best.at) continue;', 'if (best) continue;'],
    'week-is-other':     ["minutes === 10080 ? 'week' : 'other'", "'other'"],
    'codex-seconds':     ['used: Math.max(0, w.used_percent), resetsAt: w.resets_at * 1000 }', 'used: Math.max(0, w.used_percent), resetsAt: w.resets_at }'],
    'tap-seconds':       ['used: Math.max(0, w.used_percentage), resetsAt: w.resets_at * 1000 }', 'used: Math.max(0, w.used_percentage), resetsAt: w.resets_at }'],
    'codex-keeps-expired': ['windows: best.windows.filter((w) => w.resetsAt > now) }', 'windows: best.windows }'],
    'claude-keeps-expired': ['windows: t.windows.filter((w) => w.resetsAt > now) }', 'windows: t.windows }'],
    'no-account-merge':  ['t.account || named.get(anchorOf(t)) || null', 't.account || null'],
    'oldest-tap-wins':   ['if (!g || t.at > g.at)', 'if (!g)'],
    'no-stable-sort':    ['.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))', ''],
    'path-traversal':    ['const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;', 'const SESSION_ID = /^.+$/;'],
    'coerce-session':    ["typeof session === 'string' && SESSION_ID.test(session) ?", 'SESSION_ID.test(String(session)) ?'],
    'any-account-text':  ['const ACCOUNT_ID = /^[\\w.@-]{1,40}$/;', 'const ACCOUNT_ID = /^.*$/;'],
    'purge-keeps-all':   ['now - fs.statSync(p).mtimeMs > TAP_KEEP_MS', 'false'],
    'corrupt-trusted':   ['if (!d || typeof d !== \'object\' || !num(d.at)) continue;', 'if (!d) continue;'],
    // ── Gemini 余额估算 ──
    'gem-no-clamp':      ['Math.max(0, a.amount - spent)', 'a.amount - spent'],
    'gem-no-round':      ['const r6 = (x) => Math.round(x * 1e6) / 1e6;', 'const r6 = (x) => x;'],
    'gem-tsv-no-floor':  ['x.at >= floor && x.at < jsonlFrom', 'x.at >= at && x.at < jsonlFrom'],
    'gem-no-dedup':      ['x.at >= floor && x.at < jsonlFrom', 'x.at >= floor'],
    'gem-jsonl-before-anchor': [': !(x.at >= at)', ': false'],
    'gem-rate-ignored':  ['const spent = spentUsd / rate;', 'const spent = spentUsd;'],
    'gem-usd-rate-trusted': ["const rate = currency === 'USD' ? 1 : a.usdPerUnit;", "const rate = currency === 'USD' && !num(a.usdPerUnit) ? 1 : a.usdPerUnit;"],
    'gem-rate-guessed':  ["const rate = currency === 'USD' ? 1 : a.usdPerUnit;", "const rate = currency === 'USD' ? 1 : (a.usdPerUnit || 1);"],
    'gem-seconds-accepted': ['return Number.isFinite(t) && t >= 1e11 ? t : null;', 'return Number.isFinite(t) ? t : null;'],
    'gem-tsv-time-unchecked': ['if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) return null;', ''],
    'gem-negative-usd':  ['if (at == null || !num(usd) || usd < 0) { bad++; continue; }', 'if (at == null || !num(usd)) { bad++; continue; }'],
    'gem-negative-amount': ['a.amount < 0 || ', ''],
    'gem-currency-any':  ['/^[A-Z]{3}$/.test(a.currency)', 'true'],
    'gem-size-uncapped': ['|| st.size > GEMINI_LEDGER_MAX', ''],
    'gem-missing-file-bad': ["bad: e && e.code === 'ENOENT' ? 0 : 1", 'bad: 1'],
    'gem-bad-ext-ignored': ['if (!kind) return { rows: [], bad: 1 };', 'if (!kind) return { rows: [], bad: 0 };'],
    'gem-header-is-bad': ["if (head && line.startsWith('time\\t')) continue;", ''],
    'gem-estimate-false': ['estimate: true, rows, bad', 'estimate: false, rows, bad'],
    'gem-purge-eats-anchor': ["if (!f.startsWith(TAP_PREFIX) || !f.endsWith('.json')) continue;", "if (!f.endsWith('.json')) continue;"],
    // 11/24 ng 车：收起时钉住哪几条
    'pin-config-ignored': ['if (Array.isArray(pin)) return [...pin];', ''],
    'pin-not-copy': ['if (Array.isArray(pin)) return [...pin];', 'if (Array.isArray(pin)) return pin;'],
    'pin-no-default-account': [' || (defaultAccount && e.account === defaultAccount)', ''],
    'pin-no-anon': ['e.account == null || ', ''],
    'pin-loose-id': ['const PIN_ID = /^(?:claude:[\\w.@-]{1,40}|codex|gemini)$/;', 'const PIN_ID = /^.+$/;'],
    'pin-no-dedupe': ['return { pin: [...new Set(v)] };', 'return { pin: [...v] };'],
    'pin-max-dropped': ["if (v.length > LIMITS_PIN_MAX) return { pin: null, error: '最多 ' + LIMITS_PIN_MAX + ' 个' };", ''],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const red = r.status !== 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + (r.stdout.trim().split('\n').filter((l) => /FAIL/.test(l)).slice(0, 1).join('') || r.stdout.trim().split('\n').pop() || ''));
  }
  console.log(bad ? bad + ' 个改坏版没让测试变红' : '全部改坏版都让测试变红');
  process.exit(bad ? 1 : 0);
}

const L = await import(SRC);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const same = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), name, JSON.stringify(got));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-limits-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const NOW = Date.UTC(2026, 10, 15, 18, 0, 0), SEC = (ms) => Math.round(ms / 1000);
const WEEK_END = NOW + 3 * 86400000, FIVE_END = NOW + 3600000;

// ── Codex 夹具：和真实 rollout 里的 token_count 同构 ──
const rl = (over = {}) => ({ limit_id: 'codex', limit_name: null, primary: { used_percent: 34.0, window_minutes: 10080, resets_at: SEC(WEEK_END) }, secondary: null, credits: { has_credits: true, unlimited: false, balance: '1' }, plan_type: 'prolite', rate_limit_reached_type: null, ...over });
const tc = (ts, limits, type = 'token_count') => JSON.stringify({ timestamp: new Date(ts).toISOString(), type: 'event_msg', payload: { type, info: null, rate_limits: limits } });

console.log('Codex：从一段 rollout 里取最后一条额度');
{
  const got = L.parseCodexTail(tc(NOW - 60000, rl()));
  same(got && { plan: got.plan, windows: got.windows }, { plan: 'prolite', windows: [{ key: 'week', used: 34, resetsAt: WEEK_END }] }, '周窗口：用了 34%、截止时间换成毫秒、套餐名带出来');
  ok(got && got.at === NOW - 60000, '记录时间取事件自己的时间戳');
  const two = L.parseCodexTail([tc(NOW - 120000, rl({ primary: { used_percent: 20, window_minutes: 10080, resets_at: SEC(WEEK_END) } })), tc(NOW - 60000, rl())].join('\n'));
  ok(two && two.windows[0].used === 34, '两条取靠后的（34，不是 20）');
  const swapped = L.parseCodexTail([tc(NOW - 60000, rl()), tc(NOW - 120000, rl({ primary: { used_percent: 20, window_minutes: 10080, resets_at: SEC(WEEK_END) } }))].join('\n'));
  ok(swapped && swapped.windows[0].used === 34, '行顺序倒过来也取时间戳最新的');
  ok(L.parseCodexTail(tc(NOW, rl({ limit_id: 'codex_other_model' }))) === null, '别的限额（不是订阅的）不认');
  ok(L.parseCodexTail(tc(NOW, rl(), 'agent_message')) === null, '不是 token_count 的事件不认');
  const cut = '":{"used_percent":99}},"rate_limits":{"primary":{"used_perc\n' + tc(NOW, rl());
  ok(L.parseCodexTail(cut) && L.parseCodexTail(cut).windows[0].used === 34, '尾巴第一行被截断也不崩，后面的照常取');
  same(L.parseCodexTail('不是 json\n{"rate_limits":'), null, '全是坏行就是没有');
  const both = L.parseCodexTail(tc(NOW, rl({ primary: { used_percent: 6, window_minutes: 300, resets_at: SEC(FIVE_END) }, secondary: { used_percent: 41, window_minutes: 10080, resets_at: SEC(WEEK_END) } })));
  same(both.windows.map((w) => [w.key, w.used]), [['five_hour', 6], ['week', 41]], '5 小时和周两个窗口都认，各用各的名字');
  const holey = L.parseCodexTail(tc(NOW, rl({ primary: { used_percent: 34, window_minutes: 10080 } })));
  same(holey && holey.windows, [], '窗口缺截止时间就丢（不猜）');
  const over = L.parseCodexTail(tc(NOW, rl({ primary: { used_percent: 104.5, window_minutes: 10080, resets_at: SEC(WEEK_END) } })));
  ok(over && over.windows[0].used === 104.5, '超过 100 的原样给，界面自己封顶');
}

console.log('Codex：在假主目录里找最近的记录');
{
  const home = path.join(TMP, 'home'); const dayDir = (ms) => { const d = new Date(ms); return path.join(home, '.codex/sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')); };
  const put = (ms, name, lines, mtime) => { const dir = dayDir(ms); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, lines.join('\n') + '\n'); if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000); return f; };
  const cx = path.join(home, '.codex');
  same(L.codexLimits(cx, NOW), null, '没有 ~/.codex/sessions 就是没有');
  put(NOW - 5 * 86400000, 'rollout-old.jsonl', [tc(NOW - 5 * 86400000, rl({ primary: { used_percent: 10, window_minutes: 10080, resets_at: SEC(WEEK_END) } }))], NOW - 5 * 86400000);
  const today = put(NOW, 'rollout-today.jsonl', [tc(NOW - 600000, rl({ primary: { used_percent: 30, window_minutes: 10080, resets_at: SEC(WEEK_END) } }))], NOW - 600000);
  // 老日期目录里的文件被续跑了：里面有更新的记录。按记录的时间戳取，不按目录日期
  put(NOW - 2 * 86400000, 'rollout-resumed.jsonl', [tc(NOW - 120000, rl())], NOW - 120000);
  const got = L.codexLimits(cx, NOW);
  ok(got && got.id === 'codex' && got.provider === 'codex' && got.account === null && got.plan === 'prolite', '条目：id、来源、套餐名');
  ok(got && got.windows[0].used === 34 && got.at === NOW - 120000, '续跑的老会话里更新的记录胜出（34，不是今天文件里的 30）');
  // 文件长了：不能还用缓存里的旧读数
  fs.appendFileSync(today, tc(NOW - 30000, rl({ primary: { used_percent: 36, window_minutes: 10080, resets_at: SEC(WEEK_END) } })) + '\n');
  const again = L.codexLimits(cx, NOW);
  ok(again && again.windows[0].used === 36, '文件追加了新记录，下一次读到的是新的（36）');
  const late = L.codexLimits(cx, WEEK_END + 60000);
  ok(late && late.windows.length === 0 && late.at === NOW - 30000, '窗口过了截止时间：窗口丢掉，条目还在（界面显示「没有数据」）');
}

// ── Claude 夹具：tap 脚本写出来的取数文件 ──
const dir = path.join(TMP, 'limits'); fs.mkdirSync(dir, { recursive: true });
const tap = (session, at, { week, five, account, weekEnd = WEEK_END } = {}) => {
  const rate_limits = {}; if (five != null) rate_limits.five_hour = { used_percentage: five, resets_at: SEC(FIVE_END) }; if (week != null) rate_limits.seven_day = { used_percentage: week, resets_at: SEC(weekEnd) };
  fs.writeFileSync(path.join(dir, 'claude-' + session + '.json'), JSON.stringify({ v: 1, at, session, account: account ?? null, rate_limits }));
};
const clear = () => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); };

console.log('Claude：汇总状态栏取走的额度');
{
  same(L.claudeLimits(path.join(TMP, 'nope'), NOW), [], '取数目录不存在就是空');
  tap('aaaa1111-0001', NOW - 5000, { week: 1.4, five: 6.2 });
  let g = L.claudeLimits(dir, NOW);
  ok(g.length === 1 && g[0].provider === 'claude' && g[0].account === null && /^claude:w\d+$/.test(g[0].id), '一个会话 → 一条，没标账号，id 按周窗口截止时间');
  same(g[0].windows, [{ key: 'five_hour', used: 6.2, resetsAt: FIVE_END }, { key: 'week', used: 1.4, resetsAt: WEEK_END }], '两个窗口都带出来，截止时间换成毫秒');
  clear();
  // 同一个号的两个会话：周截止时间相同。文件名靠前的旧、靠后的新（读目录是排过序的，「取第一个」的写法会错）
  tap('aaaa1111-0001', NOW - 90000, { week: 1, five: 5 }); tap('zzzz9999-0002', NOW - 1000, { week: 2, five: 8 });
  g = L.claudeLimits(dir, NOW); ok(g.length === 1 && g[0].windows[1].used === 2, '同一个号的多个会话合成一条，取最近更新的那个（2，不是文件名靠前的 1）');
  // 两个号：周截止时间不同。文件名靠前的反而截止晚，结果要按 id 排而不是按文件顺序
  clear(); tap('aaaa1111-0001', NOW - 1000, { week: 50, weekEnd: WEEK_END + 86400000 }); tap('zzzz9999-0002', NOW - 1000, { week: 7, weekEnd: WEEK_END });
  g = L.claudeLimits(dir, NOW); ok(g.length === 2, '周截止时间不同 = 两个号 = 两条');
  ok(g.length === 2 && g[0].windows[0].resetsAt === WEEK_END && g[1].windows[0].resetsAt === WEEK_END + 86400000, '先后按 id 定，不跟着文件顺序跳');
  // 有账号标记的会话认领同截止时间的无标数据
  clear(); tap('aaaa1111-0001', NOW - 90000, { week: 3 }); tap('zzzz9999-0002', NOW - 1000, { week: 4, account: 'ben' });
  g = L.claudeLimits(dir, NOW); ok(g.length === 1 && g[0].account === 'ben' && g[0].id === 'claude:ben', '标了账号的会话把同截止时间的无标数据认成自己的，不重复出一条');
  clear(); tap('aaaa1111-0001', NOW - 1000, { week: 3, account: 'amy', weekEnd: WEEK_END + 3600000 }); tap('zzzz9999-0002', NOW - 1000, { week: 4, account: 'ben' });
  same(L.claudeLimits(dir, NOW).map((x) => x.account), ['amy', 'ben'], '两个标了账号的各一条');
  // 过期、坏文件
  clear(); tap('aaaa1111-0001', NOW - 1000, { week: 9 });
  same(L.claudeLimits(dir, WEEK_END + 60000), [], '窗口过了截止时间：这条不出现');
  clear(); tap('aaaa1111-0001', NOW - 1000, { week: 5, account: 'bad account!<x>' });
  ok(L.claudeLimits(dir, NOW)[0].account === null, '账号标记里有空格、尖括号就当没标');
  fs.writeFileSync(path.join(dir, 'claude-garbage-0001.json'), '{不是 json');
  fs.writeFileSync(path.join(dir, 'claude-noat-00001.json'), JSON.stringify({ rate_limits: { seven_day: { used_percentage: 99, resets_at: SEC(WEEK_END + 7200000) } } }));   // 截止时间和上面那条不同：认下它就会多出一条
  fs.writeFileSync(path.join(dir, 'other-file.json'), '{}');
  ok(L.claudeLimits(dir, NOW).length === 1, '坏 JSON、没有时间的、别的文件名都不算');
}

console.log('文件名和清理');
{
  ok(L.tapFile(dir, '0a1b2c3d-1111-2222-3333-444455556666') === path.join(dir, 'claude-0a1b2c3d-1111-2222-3333-444455556666.json'), '正常的会话号 → 数据目录里的固定文件名');
  ok(L.tapFile(dir, '../../etc/passwd') === null && L.tapFile(dir, 'a/b/c/d/e/f/g/h') === null && L.tapFile(dir, 'short') === null, '路径穿越、带斜杠、太短的会话号都不给文件名');
  ok(L.tapFile(dir, undefined) === null && L.tapFile(dir, null) === null && L.tapFile(dir, 12345678) === null, '没有会话号、不是字符串的不给文件名（不能被转成 "undefined" 凑出一个）');
  clear(); tap('aaaa1111-0001', NOW, { week: 1 }); tap('zzzz9999-0002', NOW, { week: 1 });
  const old = path.join(dir, 'claude-aaaa1111-0001.json'); const t = (Date.now() - 20 * 86400000) / 1000; fs.utimesSync(old, t, t);
  ok(L.purgeTaps(dir, Date.now()) === 1 && !fs.existsSync(old) && fs.existsSync(path.join(dir, 'claude-zzzz9999-0002.json')), '20 天没动的取数文件清掉，新的留着');
}

console.log('Gemini：账本估算预付余额（Google 没有查余额的接口：锚点 − 锚点之后账本里记的花费）');
{
  const gdir = path.join(TMP, 'glimits'); fs.mkdirSync(gdir, { recursive: true });
  const G = (...a) => { try { return L.geminiLimits(...a); } catch (e) { return { __error: String(e) }; } };   // 没有这个函数也要按「FAIL」报，不是一崩了之
  const lt = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();                            // 本地时间：second-opinion 写 spend.tsv 就是这样，没有时区
  const anchor = (o) => fs.writeFileSync(path.join(gdir, 'gemini-balance.json'), typeof o === 'string' ? o : JSON.stringify(o));
  const lg = (name, text) => { const f = path.join(gdir, name); fs.writeFileSync(f, text); return f; };
  const HEAD = 'time\tsession\tfile\tinput\toutput\tusd\n';
  const row = (t, usd) => t + '\tsess01\t/tmp/x.md\t1000\t2000\t' + usd + '\n';
  const J = (at, usd, extra = {}) => JSON.stringify({ at, usd, ...extra });
  const A0 = lt(2026, 11, 22, 12, 0), CAD = { amount: 8, currency: 'CAD', usdPerUnit: 0.5, at: A0 };   // 汇率 0.5 是夹具，只为算起来好对
  const rows = (g) => g && g.balance && g.balance.rows;

  same(G(path.join(TMP, 'nope'), NOW), null, '数据目录不存在 = 没有这一项');
  same(G(gdir, NOW), null, '目录在、没有 gemini-balance.json = 没有这一项（不猜余额）');
  anchor(CAD);
  let g = G(gdir, NOW);
  ok(g && g.id === 'gemini' && g.provider === 'gemini' && g.account === null && g.plan === null && g.at === A0 && Array.isArray(g.windows) && g.windows.length === 0, '条目：id、来源、没有窗口、at 是锚点的时间', JSON.stringify(g));
  same(g && g.balance, { currency: 'CAD', remaining: 8, start: 8, spent: 0, spentUsd: 0, usdPerUnit: 0.5, anchorAt: A0, estimate: true, rows: 0, bad: 0 }, '没给账本：余额就是锚点，并标明是估算');

  // spend.tsv 的格式：表头 + 2 行（second-opinion 写的，一行一次调用，分钟精度的本地时间）
  const tsv = lg('spend.tsv', HEAD + '2026-11-22 12:10\tsess01\t/tmp/a.md\t1200\t3400\t0.7\n2026-11-22 12:11\tsess01\t/tmp/b.md\t5600\t7800\t0.1\n');
  g = G(gdir, NOW, { ledgers: [tsv] });
  same(g && g.balance && [g.balance.spentUsd, g.balance.spent, g.balance.remaining, g.balance.rows], [0.8, 1.6, 6.4, 2], '美元合计 0.8（0.7 + 0.1 不出浮点尾巴）、按 1 加元 = 0.5 美元折成 1.6 加元、余额 6.4');
  anchor({ ...CAD, at: lt(2026, 11, 22, 12, 10, 30) });
  same(rows(G(gdir, NOW, { ledgers: [tsv] })), 2, '锚点在 12:10:30：12:10 那行只有分钟、多半在锚点之后，算上（宁可多算一行：估算本来就偏高）');
  anchor({ ...CAD, at: lt(2026, 11, 22, 12, 11, 30) });
  same(rows(G(gdir, NOW, { ledgers: [tsv] })), 1, '锚点在 12:11:30：12:10 那行在锚点之前不算，12:11 那行算');
  anchor({ ...CAD, at: lt(2026, 11, 22, 12, 12) });
  same(rows(G(gdir, NOW, { ledgers: [tsv] })), 0, '锚点在 12:12：两行都在锚点之前，一行都不算');

  // .jsonl（网关回调写的）：at 是毫秒或 ISO 串，锚点之前的不算
  anchor(CAD);
  const jl = lg('calls.jsonl', [J(A0 - 1000, 5), J(A0, 0.1), J(new Date(A0 + 60000).toISOString(), 0.2, { model: 'gemini-4-carbon' }), ''].join('\n'));
  g = G(gdir, NOW, { ledgers: [jl] });
  same(g && g.balance && [g.balance.rows, g.balance.spentUsd], [2, 0.3], '.jsonl：锚点之前 1 秒的不算，正好在锚点那一刻的算；at 毫秒和 ISO 串都认');

  // 两份账本同时给：.jsonl 有了以后，不早于它最早一行的 .tsv 行不再数（网关里每次调用都有，包括 second-opinion 的）
  const tsv2 = lg('spend2.tsv', HEAD + row('2026-11-22 12:10', 0.7) + row('2026-11-22 14:10', 0.1));
  const jl2 = lg('calls2.jsonl', [J(lt(2026, 11, 22, 14, 5), 1), J(lt(2026, 11, 22, 14, 6), 2)].join('\n'));
  for (const order of [[tsv2, jl2], [jl2, tsv2]]) {
    g = G(gdir, NOW, { ledgers: order });
    same(g && g.balance && [g.balance.rows, g.balance.spentUsd], [3, 3.7], '14:05 起有 .jsonl：12:10 的 .tsv 行算（0.7），14:10 的不算（和 .jsonl 重复）；' + (order[0] === tsv2 ? '.tsv 在前' : '.jsonl 在前') + '结果一样');
  }

  // 坏行：数进 bad，不算进花费，也不崩
  const badTsv = lg('bad.tsv', HEAD + 'garbage\n2026-11-22 25:61\ts\tf\t1\t1\t0.1\n2026-11-22 13:50\ts\tf\t1\t1\t-0.5\n2026-11-22 13:51\ts\tf\t1\t1\n2026-11-22 13:52\ts\tf\t1\t1\tabc\n\n2026-11-22 13:53\ts\tf\t1\t1\t0.5\n');
  g = G(gdir, NOW, { ledgers: [badTsv] });
  same(g && g.balance && [g.balance.rows, g.balance.spentUsd, g.balance.bad], [1, 0.5, 5], '.tsv：不是时间、25 点 61 分、负的金额、少一列、金额不是数 各算 1 个坏行；表头和空行不算；好的那行照算');
  const badJl = lg('bad.jsonl', ['not json', J(1795000000, 1), J(A0 + 1000, '0.5'), J(A0 + 1000, -1), '[1,2]', 'null', '{"usd":1}', J(A0 + 1000, 0.25)].join('\n'));
  g = G(gdir, NOW, { ledgers: [badJl] });
  same(g && g.balance && [g.balance.rows, g.balance.spentUsd, g.balance.bad], [1, 0.25, 7], '.jsonl：不是 json、时间写成秒、金额是字符串、负的、数组、null、没有时间 各算 1 个坏行；好的那行照算');

  // 账本文件本身的情形
  g = G(gdir, NOW, { ledgers: [path.join(gdir, 'never.tsv'), path.join(gdir, 'never.jsonl')] });
  same(g && g.balance && [g.balance.rows, g.balance.bad], [0, 0], '账本文件还不在：没有行，不算坏（还没人记过账）');
  const dirp = path.join(gdir, 'dir.tsv'); fs.mkdirSync(dirp, { recursive: true });
  g = G(gdir, NOW, { ledgers: [lg('spend.log', HEAD), dirp] });
  same(g && g.balance && [g.balance.rows, g.balance.bad], [0, 2], '认不出格式（.log）、是文件夹：各算 1 个坏的，不读');
  const big = path.join(gdir, 'big.jsonl'); fs.writeFileSync(big, J(A0 + 1000, 3) + '\n'); fs.truncateSync(big, 16 * 1024 * 1024 + 1);
  g = G(gdir, NOW, { ledgers: [big] });
  same(g && g.balance && [g.balance.rows, g.balance.spentUsd, g.balance.bad], [0, 0, 1], '超过 16 MB 的账本不读（每 30 秒整份读一遍，不能无限长），算 1 个坏的');
  g = G(gdir, NOW, { ledgers: 'not-an-array' }); ok(g && g.balance && g.balance.rows === 0, 'ledgers 不是数组：当没给');
  g = G(gdir, NOW, { ledgers: [null, 42, {}, tsv] }); ok(g && g.balance && g.balance.rows === 2 && g.balance.bad === 0, 'ledgers 里混了不是字符串的：跳过，不崩，后面那份真账本照读（2 行）');

  // 余额的算法
  anchor({ amount: 1, currency: 'USD', at: A0 });
  g = G(gdir, NOW, { ledgers: [lg('three.jsonl', J(A0 + 1000, 3))] });
  same(g && g.balance && [g.balance.remaining, g.balance.spent], [0, 3], '花得比锚点还多：余额封在 0（不出负数），花费照实记 3');
  anchor({ amount: 10, currency: 'USD', usdPerUnit: 99, at: A0 });
  g = G(gdir, NOW, { ledgers: [lg('two.jsonl', J(A0 + 1000, 2))] });
  same(g && g.balance && [g.balance.remaining, g.balance.usdPerUnit], [8, 1], '币种是 USD：汇率恒为 1，写了别的（99）也不理');
  anchor({ amount: 0, currency: 'USD', at: new Date(A0).toISOString() });
  g = G(gdir, NOW); ok(g && g.balance && g.balance.remaining === 0 && g.at === A0, '余额 0 是合法的锚点；时间写成 ISO 串也认');

  // 锚点写坏了：一律没有这一项，不猜
  for (const [name, a] of [['金额是负数', { amount: -1, currency: 'USD', at: A0 }], ['金额是字符串', { amount: '8', currency: 'USD', at: A0 }],
    ['币种小写', { ...CAD, currency: 'cad' }], ['币种不是三个字母', { ...CAD, currency: 'CA$' }],
    ['非美元没写汇率', { amount: 8, currency: 'CAD', at: A0 }], ['汇率是 0', { ...CAD, usdPerUnit: 0 }], ['汇率是字符串', { ...CAD, usdPerUnit: '0.5' }],
    ['时间写成秒', { ...CAD, at: 1795000000 }], ['没有时间', { amount: 8, currency: 'USD' }], ['时间不是时间', { ...CAD, at: 'yesterday' }],
    ['是个数组', '[]'], ['是 null', 'null'], ['不是 json', '{坏']]) { anchor(a); same(G(gdir, NOW), null, '锚点写坏了（' + name + '）= 没有这一项'); }

  // 锚点文件和 Claude 的取数文件在同一个目录里：互不相扰
  clear(); tap('aaaa1111-0001', NOW - 1000, { week: 7 });
  const anc = path.join(dir, 'gemini-balance.json'); fs.writeFileSync(anc, JSON.stringify({ amount: 8, currency: 'USD', at: A0 }));
  const aged = (Date.now() - 30 * 86400000) / 1000; fs.utimesSync(anc, aged, aged);
  ok(L.claudeLimits(dir, NOW).length === 1, '锚点文件放在取数目录里，不会被当成 Claude 的条目');
  ok(G(dir, NOW) && G(dir, NOW).balance && G(dir, NOW).balance.remaining === 8, '同一个目录里读得到锚点');
  ok(L.purgeTaps(dir, Date.now()) === 0 && fs.existsSync(anc), '30 天没动的锚点文件不会被清取数文件的那一步清掉（人写的，不是取数文件）');
  clear();
}

console.log('收起时钉住哪几条（limitPins / parseLimitsPin，11/24 ng 车）');
{
  // 拿旧的 limits.mjs（没有这两个导出）跑红阶段时逐项红，不在第一项就抛出去
  const call = (f, ...a) => { try { return typeof L[f] === 'function' ? L[f](...a) : '<没有 ' + f + '>'; } catch (e) { return '<抛错 ' + e.message + '>'; } };
  const anon = { id: 'claude:w123', provider: 'claude', account: null }, amy = { id: 'claude:amy', provider: 'claude', account: 'amy' }, ben = { id: 'claude:ben', provider: 'claude', account: 'ben' };
  same(call('limitPins', [anon]), ['claude:w123'], '没配 accounts（只有没标账号的那条）：钉住它，收起也看得到自己的额度');
  same(call('limitPins', [amy, ben, anon], { defaultAccount: 'ben' }), ['claude:ben', 'claude:w123'], '默认 = defaultAccount 那条 + 没标账号的那条，先后照条目');
  same(call('limitPins', [amy, ben]), [], '两个号都标了账号、没有 defaultAccount：一条都不钉（不猜哪个是主号）');
  same(call('limitPins', [amy, ben], { defaultAccount: 'nobody' }), [], 'defaultAccount 在额度里没有条目：不拿别的号顶上');
  same(call('limitPins', [amy, ben, anon], { pin: ['claude:main', 'claude:alt'], defaultAccount: 'ben' }), ['claude:main', 'claude:alt'], 'config 写了 limitsPin：照它（作者本机 main + alt），压过默认');
  same(call('limitPins', [anon], { pin: [] }), [], 'limitsPin 写成 []：一条都不钉（明说的，不退回默认）');
  const cfgPin = ['codex'], got = call('limitPins', [], { pin: cfgPin });
  ok(Array.isArray(got) && got !== cfgPin && JSON.stringify(got) === '["codex"]', '回的是拷贝：界面那边改它不会改到 config', JSON.stringify(got));
  same(call('limitPins', undefined), [], '还没有 Claude 条目（undefined）：空数组，不抛');
  clear(); tap('pin00000-0001', NOW - 1000, { week: 7 });
  let real = L.claudeLimits(dir, NOW);
  ok(real.length === 1 && /^claude:w\d+$/.test(real[0].id) && JSON.stringify(call('limitPins', real)) === JSON.stringify([real[0].id]), '真读出来的没标账号那条（id 是 claude:w<周截止分钟>）：默认钉住', JSON.stringify([real, call('limitPins', real)]));
  tap('pin00000-0002', NOW - 1000, { week: 9, account: 'main', weekEnd: WEEK_END + 86400000 });
  real = L.claudeLimits(dir, NOW);
  ok(real.length === 2 && JSON.stringify(call('limitPins', real, { defaultAccount: 'main' })) === JSON.stringify(['claude:main', real[1].id]) && /^claude:w\d+$/.test(real[1].id), '真读出来的 main（标了账号）+ 没标账号那条，defaultAccount 是 main：两条都钉', JSON.stringify([real.map((e) => e.id), call('limitPins', real, { defaultAccount: 'main' })]));
  clear();
  same(call('parseLimitsPin', undefined), { pin: null }, 'config 没写 limitsPin：pin 是 null（服务照默认算）');
  same(call('parseLimitsPin', null), { pin: null }, 'limitsPin 写成 null：同没写');
  same(call('parseLimitsPin', ['claude:main', 'claude:alt', 'codex', 'gemini', 'claude:a.b@c-d_e']), { pin: ['claude:main', 'claude:alt', 'codex', 'gemini', 'claude:a.b@c-d_e'] }, '认得的写法：claude:<账号 id>（账号 id 同 CCBOARD_ACCOUNT 的 [\\w.@-]）、codex、gemini');
  same(call('parseLimitsPin', ['codex', 'codex', 'claude:main']), { pin: ['codex', 'claude:main'] }, '重复的只留一个，先后不变');
  const sixteen = Array.from({ length: 16 }, (_, i) => 'claude:a' + i);
  ok(((call('parseLimitsPin', sixteen) || {}).pin || []).length === 16, '16 个照收（上限是 16）');
  for (const v of ['claude:main', {}, ['main'], ['claude:a b'], [1], [''], ['claude:'], ['claude:' + 'x'.repeat(41)], ['Codex'], [...sixteen, 'claude:b']]) {
    const r = call('parseLimitsPin', v);
    ok(r && typeof r === 'object' && r.pin === null && typeof r.error === 'string' && r.error.length > 0, '写错整项不用、带原因：' + JSON.stringify(v).slice(0, 48), JSON.stringify(r));
  }
  const mixed = call('parseLimitsPin', ['claude:main', 'claude:a b']);
  ok(mixed && mixed.pin === null && /claude:a b/.test(mixed.error || ''), '错的是哪一个写进原因里（日志里看得出改哪）', JSON.stringify(mixed));
}

console.log('取数脚本 statusline-tap.mjs（端到端）');
{
  clear();
  const run = (input, env = {}) => spawnSync(process.execPath, [path.join(HERE, '../statusline-tap.mjs')], { input, encoding: 'utf8', env: { ...process.env, CCBOARD_DATA: TMP, CCBOARD_ACCOUNT: '', ...env } });
  const real = Date.now(), wk = SEC(real + 3 * 86400000), fv = SEC(real + 3600000);
  const payload = JSON.stringify({ session_id: 'e2e00000-0001', cwd: '/Users/someone/private-project', model: { display_name: 'M' }, transcript_path: '/x/y.jsonl', rate_limits: { five_hour: { used_percentage: 6.4, resets_at: fv }, seven_day: { used_percentage: 1.6, resets_at: wk } } });
  const r = run(payload, { CCBOARD_ACCOUNT: 'ben' });
  ok(r.status === 0 && r.stdout === 'ben · 5h 6% · 7d 2%', '状态栏那一行：账号 · 5h · 7d，百分数四舍五入', JSON.stringify(r.stdout));
  const file = path.join(TMP, 'limits', 'claude-e2e00000-0001.json'); const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  ok(raw && !/private-project|transcript|display_name|cwd/.test(raw), '落盘的只有额度，没有路径 / 模型 / 记录文件');
  const g = L.claudeLimits(path.join(TMP, 'limits'));
  ok(g.length === 1 && g[0].account === 'ben' && g[0].windows.length === 2 && g[0].windows[1].used === 1.6, 'limits.mjs 能把它读回来');
  const none = run(JSON.stringify({ session_id: 'e2e00000-0002', cwd: '/x' }));
  ok(none.status === 0 && none.stdout === '' && !fs.existsSync(path.join(TMP, 'limits', 'claude-e2e00000-0002.json')), '没有 rate_limits：什么都不打、不写');
  const bad = [run('不是 json'), run(''), run(JSON.stringify({ session_id: '../../x', rate_limits: { seven_day: { used_percentage: 1, resets_at: wk } } })), run(JSON.stringify({ rate_limits: { seven_day: { used_percentage: 1, resets_at: wk } } }))];
  ok(bad.every((x) => x.status === 0 && x.stderr === ''), '坏输入、空输入、路径穿越的会话号、没有会话号：退出 0，终端里一个字的错误都不吐');
  ok(!fs.existsSync(path.join(TMP, 'x.json')) && fs.readdirSync(path.join(TMP, 'limits')).length === 1, '路径穿越的、没有会话号的都没有写出任何文件（不会凑出 claude-undefined.json）');
}

console.log(fail ? `\n${fail} 项没过，${pass} 项过了` : `\n${pass} 项全过`);
process.exit(fail ? 1 : 0);
