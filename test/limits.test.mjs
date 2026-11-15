/**
 * [INPUT]: 依赖 ../limits.mjs（或命令行给的另一份，比如改坏版）和 ../statusline-tap.mjs（端到端那一项）。Codex 记录夹具照真实 rollout 里 token_count 事件的结构手搭（limit_id、primary、plan_type），Claude 的取数文件照 tap 脚本写出来的样子。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造 16 个改坏的 limits.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「各订阅周额度」测试。不起服务，在临时目录里造假主目录和假数据目录，两秒内跑完。
 *        测：Codex 取最后一条而不是第一条、只认订阅那一条限额、截断的行不崩、窗口缺字段就丢、过期窗口丢掉；Claude 的多个窗口按周窗口截止时间分成各自的号、有标记的号认领同截止时间的无标数据、几个会话轮流更新时先后不跳；会话号和账号标记进文件名前要过滤；tap 脚本落盘只有额度、坏输入安静退出。
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
