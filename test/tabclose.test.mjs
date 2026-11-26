/**
 * [INPUT]: 依赖 ../server.mjs（或命令行给的另一份：红阶段给「没有 tabclose 那一版」所在的完整工程拷贝里的路径）；依赖 tmux、python3（造一个「有 tty 节点、没有进程」的假死标签）
 * [OUTPUT]: 逐项打印 ok / FAIL；退出码 0 = 全过。试验服务的 stdout 在 test/tmp/tabc-*（带 --keep 才留）
 * [POS]: test/ 的「归档后关掉『去终端』开的 Ghostty 标签」专测（11/26 作者提的：归档以后 Ghostty 里留下很多停住的标签）。
 *        根因：stopSession 只对 channel === 'ghostty' 的会话关标签；总控台起的 tmux 会话，「去终端」另开的是一个 `tmux attach` 标签，
 *        归档 → kill-session → attach 进程退出，标签停在 [exited]。补丁：kill-session 之前先问 list-clients 拿到 tty，杀完再核「tty 上还有没有进程」，只关死的。
 *          [U] 单元：从 server.mjs 里按 `tabclose begin / end` 标记原样切出代码块来跑（测的是补丁里真实的那段文字），osa 是桩，绝不碰真 Ghostty
 *              活 tty（里面有进程）不关、死 tty（有节点没进程）才关、节点不在就跳过、一活一死只关死的、ps 失败 / 认不出输出 = 不知道 = 不关、试验场只记 dry、坏名字 → []、Ghostty 没开着不去叫它
 *          [S] 接线：自己起一份试验服务（假主目录、自己的端口和 tmux 套接字），开三个 tmux 窗口（一个 attach 了一个客户端、一个没人 attach、一个 attach 了两个），
 *              都归档；试验场里 closeAttachTabs 只写一行 `tabclose … dry <名字> <tty,…>`，所以能断言：
 *              ① attach 着的窗口那一行有、tty 就是归档前 list-clients 给的那个（证明 tty 是在 kill-session 之前取的，杀了以后没有 client 可查）② 没人 attach 的窗口一行都没有
 *              ③ 两个标签的窗口两个 tty 都在那一行 ④ 窗口真的被杀了 ⑤ 日志里没有 `closed=`（试验场一次都没去碰 Ghostty）
 *          真 Ghostty 的「关 / 不关」没有写进这个文件（会抢焦点、会关他的标签）：2026-11-26 在 scratchpad 里用一次性标签跑过（见 HANDOFF.md 的证据）。
 * [PROTOCOL]: 改了 server.mjs 里 tabclose begin / end 之间的代码、或 stopSession 里 attachTtys / closeAttachTabs 的调用位置，要同步改这里；加断言前先在「没有 tabclose 那一版」上跑出红
 */
// 用法：node test/tabclose.test.mjs [server.mjs 的路径] [--keep]      端口用 T_PORT 改（默认 4991，预览端口 +1000）
import fs from 'node:fs'; import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../server.mjs'));
const KEEP = process.argv.includes('--keep');
const PORT = Number(process.env.T_PORT || 4991);
const NODE = process.execPath; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x));
if (!TMUX_BIN) { console.error('ABORT：找不到 tmux'); process.exit(2); }
if (!fs.existsSync('/usr/bin/python3')) { console.error('ABORT：找不到 /usr/bin/python3（造假死标签要它）'); process.exit(2); }
fs.mkdirSync(path.join(HERE, 'tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, 'tmp', 'tabc-'));
const TMUXDIR = fs.mkdtempSync('/tmp/ccb-tabc-tmux-');                  // 这次测试自己的 tmux 套接字，一律 -S 绝对路径
const SOCK = path.join(TMUXDIR, 'ccboard.sock');
const TENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TMUX|CLAUDE|CCBOARD_)/.test(k))), TMUX_TMPDIR: TMUXDIR, TERM: 'xterm-256color' };

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const tm = (...a) => spawnSync(TMUX_BIN, ['-S', SOCK, ...a], { env: TENV, encoding: 'utf8' });
const kids = [];                                                        // 只记自己起的进程号，收尾只杀这些
let serverProc = null;

// 和 server.mjs 里的 run / osa 一字不差
function run(cmd, args, { input, timeout = 15000, env, maxBuffer = 8 << 20 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').replace(/\n$/, ''), err: String(stderr || (err && err.message) || '').trim() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function cleanup() {
  try { tm('kill-server'); } catch {}                                    // 带着自己的 -S 绝对路径：只会打到这次测试自己那台
  for (const pid of kids) { try { if (pid > 1) process.kill(pid, 'SIGTERM'); } catch {} }
  if (serverProc && serverProc.pid > 1) { try { process.kill(serverProc.pid, 'SIGTERM'); } catch {} }
  await sleep(300);
  if (!KEEP) { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} try { fs.rmSync(TMUXDIR, { recursive: true, force: true }); } catch {} }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); });

// ───────────────────────────── [U] 单元 ─────────────────────────────
console.log('\n[U] 单元：从 server.mjs 切出 tabclose 那一段，osa 是桩');
const src = rd(SERVER) || '';
const a = src.indexOf('// ── tabclose begin'), b = src.indexOf('// ── tabclose end');
const haveBlock = a >= 0 && b > a;
ok(haveBlock, 'server.mjs 里有 tabclose begin / end 标记（没有 = 这是补丁之前的那一版）');
const make = (d) => new Function('run', 'osa', 'tmuxFor', 'SANDBOX', 'fs', 'sleep', 'console',
  src.slice(a, b) + '\nreturn { attachTtys, liveTtys, closeAttachTabs, CLOSE_TTYS };')(d.run || run, d.osa, d.tmuxFor || (async () => ({ ok: false, out: '', err: '' })), !!d.SANDBOX, fs, sleep, d.console || console);
// run 默认当 Ghostty 开着（pgrep 是桩，别的照真的跑）：单元的结果不随这台机器上 Ghostty 开没开而变
const ghosttyUp = async (c, a2, o) => (c === '/usr/bin/pgrep' ? { ok: JSON.stringify(a2) === '["-x","ghostty"]', out: '1', err: '' } : run(c, a2, o));   // 参数也要对：查错进程名的话，真机上永远是「没开着」
const mk = (over = {}) => { const calls = [], logs = []; const m = make({ run: ghosttyUp, osa: async (_s, args) => { calls.push(args); return { ok: true, out: String(args.length), err: '' }; }, console: { log: (...x) => logs.push(x.join(' ')) }, ...over }); return { m, calls, logs }; };

// 已知答案各造一个：活 tty = 一个 `script` 起的 pty 上跑着 sleep；死 tty = python 开了一对 pty 但没有任何进程以它为控制终端（有节点、没进程，和 Ghostty 里 [exited] 的标签一样）
const liveProc = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/sleep', '120'], { env: TENV, stdio: 'ignore' }); kids.push(liveProc.pid);
const deadProc = spawn('/usr/bin/python3', ['-I', '-c', 'import pty,os,sys,time\nm,s=pty.openpty()\nprint(os.ttyname(s),flush=True)\ntime.sleep(120)'], { env: TENV, stdio: ['ignore', 'pipe', 'ignore'] }); kids.push(deadProc.pid);
let deadTty = '';
await new Promise((res) => { deadProc.stdout.once('data', (d) => { deadTty = String(d).trim(); res(); }); setTimeout(res, 3000); });
let liveTty = '';
if (haveBlock) {
  const probe = make({ osa: async () => ({ ok: true, out: '0', err: '' }) });
  // sleep 所在的 tty：从 ps 里找（命令行 /bin/sleep 120 且是 script 的孩子，不会是别人的）
  const t0 = Date.now();
  while (!liveTty && Date.now() - t0 < 4000) {
    const r = await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,tty=,command=']);
    const row = r.out.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === String(liveProc.pid) && /^ttys\d+$/.test(p[2]));
    if (row) liveTty = '/dev/' + row[2]; else await sleep(150);
  }
  const live = await probe.liveTtys();
  ok(!!liveTty && !!deadTty && live && live.has(liveTty.replace('/dev/', '')) && !live.has(deadTty.replace('/dev/', '')) && fs.existsSync(deadTty),
    `夹具自检：活 tty ${liveTty}（ps 里有）、死 tty ${deadTty}（节点在、ps 里没有）`, `live=${liveTty} dead=${deadTty} set=${live ? live.size : null}`);
  { const { m, calls } = mk(); const n = await m.closeAttachTabs([liveTty], 'ccb-x'); ok(calls.length === 0 && n === 0, 'U1 活 tty（里面有进程）→ 不去关', JSON.stringify(calls)); }
  { const { m, calls } = mk(); const n = await m.closeAttachTabs([deadTty], 'ccb-x'); ok(calls.length === 1 && calls[0].join() === deadTty && n === 1, 'U2 死 tty → 去关，且只把它交给 osascript', JSON.stringify(calls)); }
  { const { m, calls } = mk(); const n = await m.closeAttachTabs(['/dev/ttys999'], 'ccb-x'); ok(calls.length === 0 && n === 0, 'U3 tty 节点已不存在 → 不去关', JSON.stringify(calls)); }
  { const { m, calls, logs } = mk(); await m.closeAttachTabs([liveTty, deadTty], 'ccb-x');
    ok(calls.length === 1 && calls[0].join() === deadTty, 'U4 一活一死 → 只关死的', JSON.stringify(calls));
    ok(logs.some((l) => l.includes('kept=' + liveTty) && l.includes('dead=' + deadTty)), 'U4b 日志同时写了 dead= 和 kept=', logs.join(' | ')); }
  { const { m, calls } = mk({ run: async (c, a2) => (c === '/bin/ps' ? { ok: false, out: '', err: 'boom' } : run(c, a2)) }); const n = await m.closeAttachTabs([deadTty], 'ccb-x'); ok(calls.length === 0 && n === 0, 'U5 ps 失败 = 不知道 → 不关（保护性判断落在「停」上，不落在「放行」上）', JSON.stringify(calls)); }
  { const { m, calls } = mk({ run: async (c, a2) => (c === '/bin/ps' ? { ok: true, out: 'foo\nbar ', err: '' } : run(c, a2)) }); const n = await m.closeAttachTabs([deadTty], 'ccb-x'); ok(calls.length === 0 && n === 0, 'U6 ps 输出里认不出一个 ttysN → 不知道 → 不关', JSON.stringify(calls)); }
  { const { m, calls, logs } = mk({ SANDBOX: true }); const n = await m.closeAttachTabs([deadTty], 'ccb-x'); ok(calls.length === 0 && n === 0 && logs.some((l) => /^tabclose \S+ dry ccb-x /.test(l)), 'U7 试验场 → 不碰 Ghostty，只记 dry', logs.join(' | ')); }
  { const { m } = mk(); ok((await m.attachTtys('foo')).length === 0 && (await m.attachTtys('')).length === 0 && (await m.attachTtys(undefined)).length === 0, 'U8 attachTtys 对不是 ccb- 的名字回 []'); }
  { const { m } = mk({ tmuxFor: async () => ({ ok: true, out: '/dev/ttys041 \n/dev/ttys041\n/dev/ttys042\nweird\n/dev/null/x', err: '' }) }); const r = await m.attachTtys('ccb-ok'); ok(r.join() === '/dev/ttys041,/dev/ttys042', 'U9 attachTtys 去重、去空白、滤掉不像 tty 的行', r.join()); }
  { const { m } = mk({ tmuxFor: async () => ({ ok: false, out: '', err: 'no server' }) }); ok((await m.attachTtys('ccb-ok')).length === 0, 'U10 tmux 查不到（会话已经没了）→ []'); }
  { const { m, calls } = mk(); const n = await m.closeAttachTabs([], 'ccb-x'); ok(n === 0 && calls.length === 0, 'U11 空列表（ghostty 通道的会话）→ 什么都不做'); }
  { const { m, calls, logs } = mk({ run: async (c, a2) => (c === '/usr/bin/pgrep' ? { ok: false, out: '', err: '' } : run(c, a2)) }); const n = await m.closeAttachTabs([deadTty], 'ccb-x');
    ok(calls.length === 0 && n === 0 && logs.some((l) => l.includes('ghostty=off')), 'U12 Ghostty 没开着 → 不调 osascript（不然会把 Ghostty 拉起来），日志写 ghostty=off', JSON.stringify(calls) + ' ' + logs.join(' | ')); }
} else {
  console.log('  （没有代码块，单元整段跳过；上面那一条已记红）');
}

// ───────────────────────────── [S] 接线 ─────────────────────────────
console.log('\n[S] 接线：试验服务 + 三个 tmux 窗口，归档后看 tabclose 日志');
const FH = path.join(ROOT, 'home'), DATA = path.join(FH, 'Library/Application Support/cc-board'), SESS = path.join(FH, '.claude/sessions'), CWD = path.join(FH, 'work');
const PROJ = path.join(FH, '.claude/projects', CWD.replace(/[^A-Za-z0-9]/g, '-'));
for (const d of [DATA, SESS, PROJ, CWD]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(DATA, 'config.json'), '{}');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_|ANTHROPIC_|GEMINI_|TMUX)/.test(k))),
  HOME: FH, CCBOARD_PORT: String(PORT), CCBOARD_PREVIEW_PORT: String(PORT + 1000), CCBOARD_DATA: DATA, CCBOARD_TMUX_SOCKET: SOCK, TMUX_TMPDIR: TMUXDIR,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CCBOARD_CLAUDE_TMP: path.join(ROOT, 'claude-tmp'), CCBOARD_SECURITY: '/usr/bin/false' };
const logFile = path.join(ROOT, 'server.log'), fd = fs.openSync(logFile, 'a');
serverProc = spawn(NODE, [SERVER], { env, stdio: ['ignore', fd, fd] });
const log = () => rd(logFile) || '';
let TOK = '';
const up = await until(async () => { try { TOK = (rd(path.join(DATA, '.token')) || '').trim(); const h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json(); return !!(h.ok && TOK && h.sandbox); } catch { return false; } }, 15000);
if (!up) { console.error('ABORT：试验服务起不来\n' + log().slice(-1500)); await cleanup(); process.exit(2); }
const get = async (p) => (await fetch('http://127.0.0.1:' + PORT + p, { headers: { 'x-ccboard': TOK } })).json();
const post = async (p, body) => { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: 'POST', headers: { 'x-ccboard': TOK, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };
ok(true, '试验服务起来了（health.sandbox = true）：端口 ' + PORT);

let n = 0;
function mkWin(name) {                                                   // 一个 tmux 窗口 + 登记 + 对话记录：服务认成 channel 'tmux' 的会话
  tm('new-session', '-d', '-s', name, '-x', '80', '-y', '20', '/bin/sleep', '1500');
  const pid = Number(tm('list-panes', '-t', name, '-F', '#{pane_pid}').stdout.trim()) || 0;
  const sid = 'abcdef0' + (++n) + '-0000-4000-8000-' + String(pid).padStart(12, '0');
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  fs.writeFileSync(path.join(PROJ, sid + '.jsonl'), [
    { type: 'user', message: { role: 'user', content: '做个小工具' }, origin: { kind: 'human' }, timestamp: iso(now - 600000) },
    { type: 'assistant', message: { id: 'm' + n, model: 'claude-x', content: [{ type: 'text', text: '做好了。' }], stop_reason: 'end_turn' }, timestamp: iso(now - 590000) },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(SESS, pid + '.json'), JSON.stringify({ pid, sessionId: sid, cwd: CWD, startedAt: now - 700000, kind: 'interactive', entrypoint: 'cli', name: 'w-' + name, nameSource: 'derived', status: 'idle', statusUpdatedAt: now - 60000, updatedAt: now - 60000 }));
  return { name, pid, sid };
}
const attach = (w) => { const p = spawn('/usr/bin/script', ['-q', '/dev/null', TMUX_BIN, '-S', SOCK, 'attach', '-t', w.name], { env: TENV, stdio: 'ignore' }); kids.push(p.pid); return p; };
const clientsOf = (w) => tm('list-clients', '-t', w.name, '-F', '#{client_tty}').stdout.split('\n').map((x) => x.trim()).filter(Boolean).sort();

const W1 = mkWin('ccb-tabc001'), W2 = mkWin('ccb-tabc002'), W3 = mkWin('ccb-tabc003');
attach(W1); attach(W3); attach(W3);                                      // W1：一个标签；W2：没人 attach；W3：两个标签（11/15–16 同一个会话挂过 5–7 个标签）
const t1 = await until(async () => { const c = clientsOf(W1); return c.length === 1 ? c : null; }, 6000);
const t3 = await until(async () => { const c = clientsOf(W3); return c.length === 2 ? c : null; }, 6000);
ok(!!t1 && !!t3 && clientsOf(W2).length === 0, `夹具自检：W1 一个 client ${t1}，W3 两个 client ${t3}，W2 没有`, `W1=${clientsOf(W1)} W3=${clientsOf(W3)} W2=${clientsOf(W2)}`);

const seen = await until(async () => { const s = await get('/api/state?peek=1'); const ws = [W1, W2, W3].map((w) => s.sessions.find((x) => x.sid === w.sid)); return ws.every((x) => x && x.channel === 'tmux' && x.tmux) ? ws : null; }, 15000);
ok(!!seen, '服务把三个窗口都认成 tmux 通道的会话', JSON.stringify(seen));
if (!seen) { console.error(log().slice(-1500)); }

const arch = [];
for (const w of [W1, W2, W3]) arch.push(await post('/api/archive', { sid: w.sid, force: true }));
ok(arch.every((r) => r.body && r.body.ok), '三个都归档成功（进入 8 秒宽限）', JSON.stringify(arch.map((r) => r.body)));

const line = (name) => log().split('\n').find((l) => l.startsWith('tabclose ') && l.includes(` dry ${name} `)) || '';
const got1 = await until(async () => line(W1.name), 25000), got3 = await until(async () => line(W3.name), 25000);
const gone = (w) => tm('has-session', '-t', w.name).status !== 0;
await sleep(1500);                                                       // 给 W2 留出「如果会写就该写出来了」的时间
const tty1 = got1 ? (got1.match(/dry \S+ (\S+)/) || [])[1] : '', tty3 = got3 ? (got3.match(/dry \S+ (\S+)/) || [])[1] : '';
ok(!!got1 && t1 && tty1 === t1.join(','), 'S1 attach 着的窗口：归档后写了 tabclose 行，tty 就是归档前 list-clients 给的那个', got1 + ' vs ' + (t1 || []).join(','));
ok(gone(W1), 'S2 窗口真的被杀了（所以 S1 的 tty 只可能是 kill-session 之前取的：杀了以后没有 client 可查）');
ok(!line(W2.name) && gone(W2), 'S3 没人 attach 的窗口：被杀了，一行 tabclose 都没有（没有标签可关）', line(W2.name));
ok(!!got3 && t3 && (tty3 || '').split(',').sort().join() === t3.join(','), 'S4 挂了两个标签的窗口：两个 tty 都在那一行', got3 + ' vs ' + (t3 || []).join(','));
const tcLines = log().split('\n').filter((l) => l.startsWith('tabclose '));
ok(tcLines.length > 0 && tcLines.every((l) => / dry ccb-tabc\d+ /.test(l)) && !/closed=/.test(log()), 'S5 试验场一次都没去碰 Ghostty（有 tabclose 行，且每一行都是 dry、日志里没有 closed=）', tcLines.join(' | '));

await cleanup();
console.log(`\n合计 ${pass} 过 ${fail} 没过`);
process.exit(fail ? 1 : 0);
