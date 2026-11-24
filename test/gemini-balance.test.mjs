/**
 * [INPUT]: 依赖 ../server.mjs（或命令行给的另一份：红阶段给「没有 Gemini 余额那一版」的 server.mjs 所在工程拷贝里的路径）；依赖 tmux（服务起来要一个私有套接字，这里不开任何窗口）
 * [OUTPUT]: 逐项打印 ok / FAIL；退出码 0 = 全过。每份试验服务的 stdout 在 test/tmp/gbal-*（带 --keep 才留）
 * [POS]: test/ 的 Gemini API 余额接线专测（11/23）。作者 11/23 要求把 Google 的 API 还剩多少钱也放进顶栏的额度旁边。
 *        geminiLimits() 本身（锚点、账本、换算、坏输入）在 limits.test.mjs；这里只测 server.mjs 的接线：config.json 的 geminiLedgers 怎么读、limitsLoop 有没有把它放进 /api/state 的 limits.gemini、
 *        它坏了连不连累 Claude / Codex 那几格、只回变过的读法里它变了给不给。不用 state.test.mjs（600 多项、要重活锁）：自己起 3 份试验服务（假主目录、自己的端口和 tmux 套接字）。
 *          [A] 锚点 + 两份账本（.tsv 用 ~/ 写，.jsonl 用绝对路径）：余额算对（数是手算的，不调 limits.mjs）、Claude 那格照旧、账本追加 / 坏一行 / 锚点删掉 / 锚点写坏 / 锚点放回、只回变过的读法
 *          [B] geminiLedgers 不是数组：只关这一项（日志一行），accounts 照常；有锚点照样显示，只是一分钱都没减
 *          [C] geminiLedgers 里有写错的：丢掉那几条（日志写丢了几条），剩下的照用
 * [PROTOCOL]: 改了 server.mjs 的 parseGeminiLedgers / limitsLoop 的 gemini 那一段要同步改这里；加断言前先在「没有 Gemini 余额那一版」上跑出红
 */
// 用法：node test/gemini-balance.test.mjs [server.mjs 的路径] [--keep]      端口用 T_PORT 改（默认 4931，用到 4931 / 4941 / 4951 和各自 +1000 的预览端口）
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../server.mjs'));
const KEEP = process.argv.includes('--keep');
const PORT = Number(process.env.T_PORT || 4931);
const NODE = process.execPath; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x));
if (!TMUX_BIN) { console.error('ABORT：找不到 tmux'); process.exit(2); }
fs.mkdirSync(path.join(HERE, 'tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, 'tmp', 'gbal-'));
const TMUXDIR = fs.mkdtempSync('/tmp/ccb-gbal-tmux-');                  // 这次测试自己的 tmux 套接字，一律 -S 绝对路径

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-5;
const kids = [], servers = [];
const H = 3600000, NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const two = (n) => String(n).padStart(2, '0');
const local = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };   // second-opinion 的 spend.tsv：本地时间、到分钟

async function startServer(tag, cfg) {
  const idx = servers.length, port = PORT + 10 * idx, dir = path.join(ROOT, tag);
  const FH = path.join(dir, 'home'), DATA = path.join(FH, 'Library/Application Support/cc-board'), SESS = path.join(FH, '.claude/sessions'), GW = path.join(FH, 'gw');
  for (const d of [DATA, path.join(DATA, 'limits'), SESS, GW, path.join(TMUXDIR, tag)]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cfg(FH)));
  // 一个 Claude 号的取数文件：看 Gemini 那格坏了时它还在不在
  fs.writeFileSync(path.join(DATA, 'limits', 'claude-aaaa1111-0001.json'), JSON.stringify({ v: 1, at: NOW, session: 'aaaa1111-0001', account: 'good',
    rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor((NOW + H) / 1000) }, seven_day: { used_percentage: 40, resets_at: Math.floor((NOW + 3 * 24 * H) / 1000) } } }));
  const sock = path.join(TMUXDIR, tag, 'ccboard.sock'), logFile = path.join(dir, 'server.log');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_|ANTHROPIC_|GEMINI_|TMUX)/.test(k))),
    HOME: FH, CCBOARD_PORT: String(port), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_DATA: DATA, CCBOARD_TMUX_SOCKET: sock, TMUX_TMPDIR: TMUXDIR,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CCBOARD_CLAUDE_TMP: path.join(dir, 'claude-tmp'), CCBOARD_LIMITS_MS: '400', CCBOARD_SECURITY: '/usr/bin/false' };
  const fd = fs.openSync(logFile, 'a');
  const proc = spawn(NODE, [SERVER], { env, stdio: ['ignore', fd, fd] }); kids.push(proc.pid);
  const S = { tag, port, FH, DATA, GW, anchor: path.join(DATA, 'limits', 'gemini-balance.json'), tok: '', log: () => rd(logFile) || '' };
  servers.push(S);
  const up = await until(async () => { try { S.tok = (rd(path.join(DATA, '.token')) || '').trim(); const h = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); return !!(h.ok && S.tok); } catch { return false; } }, 20000);
  if (!up) { console.error('ABORT：' + tag + ' 起不来\n' + S.log().slice(-1500)); await cleanup(); process.exit(2); }
  S.get = async (p) => (await fetch('http://127.0.0.1:' + port + p, { headers: { 'x-ccboard': S.tok } })).json();
  S.lim = async () => ((await S.get('/api/state?peek=1')).limits || {});
  return S;
}
async function cleanup() {
  for (const S of servers) {          // 只收自己起的 tmux：套接字都在这次的 TMUXDIR 里（全局规矩 30）
    const socks = [path.join(TMUXDIR, S.tag, 'ccboard.sock')]; try { for (const f of fs.readdirSync(path.join(TMUXDIR, S.tag, 'tmux'))) socks.push(path.join(TMUXDIR, S.tag, 'tmux', f)); } catch {}
    for (const s of socks) if (s.startsWith(TMUXDIR + '/') && fs.existsSync(s)) spawnSync(TMUX_BIN, ['-S', s, 'kill-server'], { stdio: 'ignore' });
  }
  for (const pid of kids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await sleep(300);
  if (!KEEP) { fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(TMUXDIR, { recursive: true, force: true }); }
}
for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) process.on(sig, async () => { await cleanup(); process.exit(code); });

// 锚点：2 小时前在 AI Studio 读到还剩 CA$8，1 CAD = 0.71 USD
const ANCHOR = { amount: 8, currency: 'CAD', usdPerUnit: 0.71, at: iso(NOW - 2 * H) };
const TSV = ['time\tsession\tfile\tinput\toutput\tusd',
  `${local(NOW - 3 * H)}\tdead0001\t/x/a.md\t100\t200\t1.000`,      // 锚点之前：不算
  `${local(NOW - 90 * 60000)}\tdead0002\t/x/b.md\t100\t200\t0.200`,
  `${local(NOW - 60 * 60000)}\tdead0003\t/x/c.md\t100\t200\t0.300`].join('\n') + '\n';
const JSONL = JSON.stringify({ at: iso(NOW - 30 * 60000), usd: 0.071 }) + '\n';
// 手算：0.2 + 0.3 + 0.071 = 0.571 USD；÷ 0.71 = 0.804225 CAD；8 − 0.804225 = 7.195775
const G = (lm) => (lm && lm.gemini) || null;
const B = (lm) => (G(lm) && G(lm).balance) || {};

console.log('server:', SERVER, ' load:', os.loadavg().map((x) => x.toFixed(1)).join(' '));
try {
  // ═══ [A] 锚点 + 两份账本 ═══
  console.log('\n[A] 锚点 + geminiLedgers 两份账本：/api/state 的 limits.gemini');
  const A = await startServer('a', (FH) => ({ accounts: [{ id: 'good', name: '旧号' }], geminiLedgers: ['~/gw/spend.tsv', path.join(FH, 'gw', 'spend.jsonl')] }));
  fs.writeFileSync(path.join(A.GW, 'spend.tsv'), TSV); fs.writeFileSync(path.join(A.GW, 'spend.jsonl'), JSONL);
  fs.writeFileSync(A.anchor, JSON.stringify(ANCHOR));
  let lm = await until(async () => { const l = await A.lim(); return G(l) ? l : null; }) || await A.lim();
  ok(/geminiLedgers=2/.test(A.log()), '启动日志写了 geminiLedgers=2（~/ 写法和绝对路径都收了）', A.log().split('\n').find((l) => /accountFallback=/.test(l)) || '');
  ok(!!G(lm) && G(lm).id === 'gemini' && G(lm).provider === 'gemini' && Array.isArray(G(lm).windows) && G(lm).windows.length === 0, '有锚点：limits.gemini 是一个条目（id / provider 是 gemini，没有周额度窗口）', JSON.stringify(G(lm)));
  ok(B(lm).currency === 'CAD' && B(lm).start === 8 && B(lm).estimate === true, '余额照锚点：CAD、起点 8、标着是估算', JSON.stringify(B(lm)));
  ok(near(B(lm).spentUsd, 0.571) && near(B(lm).spent, 0.804225) && near(B(lm).remaining, 7.195775) && B(lm).rows === 3 && B(lm).bad === 0,
    '减掉锚点之后的花费：tsv 两行 + jsonl 一行 = US$0.571 = CA$0.804225，剩 CA$7.195775（锚点之前那行 US$1 不算）', JSON.stringify(B(lm)));
  ok(Array.isArray(lm.claude) && lm.claude.length === 1 && lm.claude[0].account === 'good' && lm.claude[0].name === '旧号' && lm.codex === null, 'Claude 那格照旧（一个号、名字照 accounts 换），Codex 没开是 null', JSON.stringify({ claude: lm.claude && lm.claude.map((x) => x.account), codex: lm.codex }));

  fs.appendFileSync(path.join(A.GW, 'spend.jsonl'), JSON.stringify({ at: iso(NOW - 10 * 60000), usd: 0.142 }) + '\n');
  lm = await until(async () => { const l = await A.lim(); return near(B(l).spentUsd, 0.713) ? l : null; }) || await A.lim();
  ok(near(B(lm).spentUsd, 0.713) && B(lm).rows === 4, '账本追加一行（US$0.142），不用重启，下一次读就减上（US$0.713）', JSON.stringify(B(lm)));

  fs.appendFileSync(path.join(A.GW, 'spend.jsonl'), '{这一行坏了\n');
  lm = await until(async () => { const l = await A.lim(); return B(l).bad === 1 ? l : null; }) || await A.lim();
  ok(B(lm).bad === 1 && near(B(lm).spentUsd, 0.713), '账本里坏了一行：记 bad 1，别的行照算', JSON.stringify(B(lm)));

  // 只回变过的读法：先拿一个版本号，改锚点以后带着它来，limits 要在应答里
  const full = await A.get('/api/state?v=0'); const v0 = full.v;
  fs.writeFileSync(A.anchor, JSON.stringify({ ...ANCHOR, amount: 10 }));
  let d = null;
  for (let i = 0; i < 40 && !(d && d.limits && G(d.limits) && B(d.limits).start === 10); i++) { await sleep(200); d = await A.get('/api/state?v=' + encodeURIComponent(v0)); }
  ok(!!v0 && d && d.base === v0 && d.limits && B(d.limits).start === 10 && Array.isArray(d.limits.claude) && d.limits.claude.length === 1,
    '只回变过的读法：锚点改了，带旧版本号来的应答里有新的 limits（gemini 起点 10，Claude 那格一起给）', JSON.stringify({ v0, base: d && d.base, limits: d && d.limits && { start: B(d.limits).start, claude: d.limits.claude && d.limits.claude.length } }));

  fs.rmSync(A.anchor);
  lm = await until(async () => { const l = await A.lim(); return l.gemini === null ? l : null; }) || await A.lim();
  ok('gemini' in lm && lm.gemini === null && lm.claude.length === 1, '锚点删掉：limits.gemini 是 null（顶栏不画），Claude 那格还在', JSON.stringify({ gemini: lm.gemini, claude: lm.claude && lm.claude.length }));

  fs.writeFileSync(A.anchor, '{"amount": 8, "currency": ');
  await sleep(1200); lm = await A.lim();
  const h = await (await fetch('http://127.0.0.1:' + A.port + '/health')).json();
  ok(lm.gemini === null && lm.claude.length === 1 && h.ok, '锚点写坏（不是完整 JSON）：gemini 是 null，Claude 那格照旧，服务照常', JSON.stringify({ gemini: lm.gemini, claude: lm.claude && lm.claude.length, health: h.ok }));

  fs.writeFileSync(A.anchor, JSON.stringify({ amount: 8, currency: 'CAD', at: ANCHOR.at }));     // 不是美元又没写汇率
  await sleep(1200); lm = await A.lim();
  ok(lm.gemini === null, '锚点不是美元又没写 usdPerUnit：当没有锚点（不瞎换算）', JSON.stringify(lm.gemini));

  fs.writeFileSync(A.anchor, JSON.stringify(ANCHOR));
  lm = await until(async () => { const l = await A.lim(); return G(l) ? l : null; }) || await A.lim();
  ok(B(lm).start === 8 && near(B(lm).spentUsd, 0.713), '锚点放回去：不用重启，下一次读就回来', JSON.stringify(B(lm)));

  // ═══ [B] geminiLedgers 不是数组 ═══
  console.log('\n[B] geminiLedgers 写成字符串：只关这一项');
  const Bs = await startServer('b', () => ({ accounts: [{ id: 'good', name: '旧号' }], geminiLedgers: '~/gw/spend.tsv' }));
  fs.writeFileSync(path.join(Bs.GW, 'spend.tsv'), TSV); fs.writeFileSync(Bs.anchor, JSON.stringify(ANCHOR));
  lm = await until(async () => { const l = await Bs.lim(); return G(l) ? l : null; }) || await Bs.lim();
  ok(/geminiLedgers 不用/.test(Bs.log()) && /geminiLedgers=0/.test(Bs.log()), '日志一行「geminiLedgers 不用」，启动行写 geminiLedgers=0', Bs.log().split('\n').filter((l) => /geminiLedgers/.test(l)).join(' | '));
  const pv = await until(async () => { const p = (await Bs.get('/api/state?peek=1')).providers; return p && p.claude && p.claude.accounts && p.claude.accounts.length ? p : null; }) ;
  ok(!!pv && pv.claude.accounts.length === 1 && pv.claude.accounts[0].id === 'good' && lm.claude.length === 1 && lm.claude[0].name === '旧号', '同一份 config 里的 accounts 照常用（没有整份作废）', JSON.stringify(pv && pv.claude && pv.claude.accounts));
  ok(B(lm).start === 8 && B(lm).spentUsd === 0 && B(lm).rows === 0 && B(lm).remaining === 8, '有锚点照样显示，只是没有账本可减（剩 CA$8，0 行）', JSON.stringify(B(lm)));

  // ═══ [C] 数组里有写错的 ═══
  console.log('\n[C] geminiLedgers 里有写错的：丢掉那几条');
  const C = await startServer('c', (FH) => ({ geminiLedgers: ['~/gw/spend.tsv', 'gw/relative.tsv', path.join(FH, 'gw', 'x.csv'), 42, path.join(FH, 'gw', 'spend.jsonl')] }));
  fs.writeFileSync(path.join(C.GW, 'spend.tsv'), TSV); fs.writeFileSync(path.join(C.GW, 'spend.jsonl'), JSONL); fs.writeFileSync(C.anchor, JSON.stringify(ANCHOR));
  lm = await until(async () => { const l = await C.lim(); return G(l) ? l : null; }) || await C.lim();
  ok(/geminiLedgers 丢掉 3 条/.test(C.log()) && /geminiLedgers=2/.test(C.log()), '相对路径、.csv、数字三条丢掉（日志写丢了 3 条），剩 2 条', C.log().split('\n').filter((l) => /geminiLedgers/.test(l)).join(' | '));
  ok(near(B(lm).spentUsd, 0.571) && B(lm).rows === 3, '剩下的两份照用：花费和 [A] 一开始一样（US$0.571、3 行）', JSON.stringify(B(lm)));
} catch (e) { fail++; console.log('  FAIL 抛错：' + (e && e.stack || e)); }

await cleanup();
console.log(`\n${pass} 过 ${fail} 红`);
process.exit(fail ? 1 : 0);
