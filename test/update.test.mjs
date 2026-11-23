/**
 * [INPUT]: 依赖 ../update.mjs（或 UPDATE_SRC 给的另一份，改坏版用）、../server.mjs。只连本机假的「GitHub」，不连外网、不碰 tmux 线上套接字、不碰真实数据目录。
 * [OUTPUT]: 每项一行 ok / FAIL，最后一行「update.test：N 过 M 没过」，有没过的退出码 1。
 * [POS]: test/ 的检查新版本测试。三段：纯函数（版本号、跳转地址、sha256 文件、config 两个键、给界面的那一份）；
 *        createUpdater 对假服务器（302 到 tag、.sha256、dmg）走一遍：下好 / sha 对不上 / 一天只查一次 / 自动下载关着 / 检查关着 / 旧包删掉 / 重启读回 / 用户删了包；
 *        11/22 1b 修复轮加 4 项：断网时一天最多问一次、.sha256 最多 1 KB、dmg 有 content-length 先看 / 没有就边读边数超了中止、update.json 读回的 latest 先核样子；
 *        起一份试验场服务（假主目录、自己的端口）：/api/state 的 update、/api/update/check、/api/update/open（试验场只记 dry）、没给 BASE 时不连、只读不连、config 写错整份不用。
 *        假服务器的答案是这里自己写死的，不读 update.mjs 拼网址的写法（检查和被检查的不用同一种写法）。
 * 用法：node test/update.test.mjs（53 项，约 10 秒）；--mutants 造 11 个改坏的 update.mjs，每个经 UPDATE_SRC 跑一遍，都必须变红。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// --mutants：造 11 个改坏的 update.mjs，每个经 UPDATE_SRC 跑一遍本测试，都必须变红（原文不唯一就报错）
if (process.argv.includes('--mutants')) {
  const { spawnSync } = await import('node:child_process');
  const src = fs.readFileSync(path.join(HERE, '../update.mjs'), 'utf8');
  const dir = path.join(HERE, '.tmp', 'update-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'newer-string': ['if (x[i] !== y[i]) return x[i] > y[i];', 'if (x[i] !== y[i]) return String(x[i]) > String(y[i]);'],
    'no-sha-check': ['if (got !== want) {', 'if (false) {'],
    'no-day-gate': ['if (force || now() - st.checkedAt >= DAY) await check();', 'await check();'],
    'auto-ignored': ['if (conf.auto && newer(', 'if (newer('],
    'no-cleanup': ['if (f !== path.basename(out)) try', 'if (false) try'],
    'stale-file-kept': ['if (st.file && !fs.existsSync(st.file)) { st.file = null; st.fileVer = null; }', ''],
    'tag-any-suffix': ['(\\d{1,4}\\.\\d{1,4}\\.\\d{1,6})\\/?$/', '(\\d{1,4}\\.\\d{1,4}\\.\\d{1,6})/'],
    'ready-any-file': ['const ready = !!(st.file && st.fileVer === st.latest);', 'const ready = !!st.file;'],
    'no-retry-gate': ['(force || now() - st.triedAt >= RETRY)', 'true'],
    'conf-no-throw': ["throw new Error(k + ' 要是 true 或 false')", 'void 0'],
    'check-ignored': ['if (busy || !conf.check) return;', 'if (busy) return;'],
  };
  let miss = 0, bad = 0;
  for (const [n, [a, b]] of Object.entries(M)) {
    const c = src.split(a).length - 1;
    if (c !== 1) { bad++; console.log('BAD  ' + n + ' 原文出现 ' + c + ' 次'); continue; }
    const f = path.join(dir, n + '.mjs'); fs.writeFileSync(f, src.replace(a, () => b));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, UPDATE_SRC: f }, encoding: 'utf8', timeout: 120000 });
    const reds = (r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(5, 50));
    if (!reds.length) miss++;
    console.log((reds.length ? 'RED  ' : 'MISS ') + n + ' rc=' + r.status + ' ' + reds.length + ' 红：' + reds.join(' | '));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`update 改坏版：${Object.keys(M).length - miss - bad} 个变红，${miss} 个没抓到，${bad} 个原文不对`);
  process.exit(miss || bad ? 1 : 0);
}

const SRC =path.resolve(process.env.UPDATE_SRC || path.join(HERE, '../update.mjs'));
const U = await import(pathToFileURL(SRC).href);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-update-test-'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───── 一、纯函数 ─────
ok('parseVer v0.3.7', JSON.stringify(U.parseVer('v0.3.7')) === '[0,3,7]');
ok('parseVer 「0.3.7 (12)」（外壳写的 .bundle-version）', JSON.stringify(U.parseVer('0.3.7 (12)')) === '[0,3,7]');
ok('parseVer 认不出的是 null', [null, '', 'abc', '0.3', '0.3.7x', 'v.3.7', '1.2.3.4'].every((x) => U.parseVer(x) === null), String(['0.3.7x', '1.2.3.4'].map(U.parseVer)));
ok('newer 0.3.10 比 0.3.9 新（按数字不按字母）', U.newer('0.3.10', '0.3.9') && !U.newer('0.3.9', '0.3.10'));
ok('newer 0.4.0 比 0.3.99 新、1.0.0 比 0.9.9 新', U.newer('0.4.0', '0.3.99') && U.newer('1.0.0', '0.9.9'));
ok('newer 一样的不算新', !U.newer('0.3.7', '0.3.7 (12)') && !U.newer('v0.3.7', '0.3.7'));
ok('newer 认不出的不算新（宁可不提示）', !U.newer(null, '0.3.7') && !U.newer('0.3.8', '') && !U.newer('latest', '0.3.7'));
ok('tagFromLocation 认 …/releases/tag/v0.3.8', U.tagFromLocation('https://github.com/Lfrangt/cc-board/releases/tag/v0.3.8') === '0.3.8');
ok('tagFromLocation 没有 release 时跳回 /releases → null', U.tagFromLocation('https://github.com/Lfrangt/cc-board/releases') === null);
ok('tagFromLocation 别的 tag 写法不认', [null, '', '/releases/tag/nightly', '/releases/tag/v0.3.8-beta', '/releases/tag/v0.3.8/../x'].every((x) => U.tagFromLocation(x) === null));
const SHA = 'ab'.repeat(32);
ok('shaFromFile 认「<sha>  cc-board.dmg」', U.shaFromFile(SHA.toUpperCase() + '  cc-board.dmg\n') === SHA);
ok('shaFromFile 不像 sha 的 → null', [null, '', 'xyz', 'ab'.repeat(31), 'Not Found'].every((x) => U.shaFromFile(x) === null));
ok('parseUpdateConf 不写 = 查、自动下', JSON.stringify(U.parseUpdateConf({})) === '{"check":true,"auto":true}');
ok('parseUpdateConf autoUpdate:false = 只提示', JSON.stringify(U.parseUpdateConf({ autoUpdate: false })) === '{"check":true,"auto":false}');
ok('parseUpdateConf updateCheck:false = 不连也不下', JSON.stringify(U.parseUpdateConf({ updateCheck: false, autoUpdate: true })) === '{"check":false,"auto":false}');
let threw = 0; for (const c of [{ updateCheck: 'false' }, { autoUpdate: 0 }, { updateCheck: null }]) try { U.parseUpdateConf(c); } catch { threw++; }
ok('parseUpdateConf 不是布尔就抛（3 种）', threw === 3, 'threw=' + threw);
ok('updateView 没有更新的版本 → null', U.updateView('0.3.8 (3)', { latest: '0.3.8' }) === null && U.updateView('0.3.8', { latest: '0.3.7' }) === null && U.updateView('0.3.8', null) === null);
const v1 = U.updateView('0.3.7 (12)', { latest: '0.3.8', file: '/x.dmg', fileVer: '0.3.8' }, 'https://h/o/r');
ok('updateView 下好了 = ready，网址指向这个 tag', v1 && v1.ready === true && v1.current === '0.3.7' && v1.dmg === 'https://h/o/r/releases/download/v0.3.8/cc-board.dmg' && v1.page === 'https://h/o/r/releases/tag/v0.3.8', JSON.stringify(v1));
const v2 = U.updateView('0.3.7', { latest: '0.3.9', file: '/x.dmg', fileVer: '0.3.8' });
ok('updateView 下好的是旧一版 → 不算 ready', v2 && v2.ready === false && v2.latest === '0.3.9');

// ───── 二、createUpdater 对假服务器 ─────
const fake = { latest: '0.3.8', dmg: crypto.randomBytes(4096), shaOverride: null, hits: [] };
const gh = http.createServer((req, res) => {
  fake.hits.push(req.url);
  if (req.url === '/o/r/releases/latest') { res.writeHead(fake.latest ? 302 : 302, { location: fake.latest ? 'https://github.com/o/r/releases/tag/v' + fake.latest : 'https://github.com/o/r/releases' }); return res.end(); }
  const m = /^\/o\/r\/releases\/download\/v([\d.]+)\/cc-board\.dmg(\.sha256)?$/.exec(req.url);
  if (m && m[1] === fake.latest) {
    if (m[2]) { res.writeHead(200); return res.end((fake.shaOverride || crypto.createHash('sha256').update(fake.dmg).digest('hex')) + '  cc-board.dmg\n'); }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(fake.dmg);
  }
  res.writeHead(404); res.end('Not Found');
});
await new Promise((r) => gh.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + gh.address().port + '/o/r';
let clock = 1_000_000_000_000;
const mk = (dir, conf = { check: true, auto: true }, current = '0.3.7 (12)') => U.createUpdater({ current, dir, conf, base: BASE, now: () => clock, log: () => {} });
const reqs = (re) => fake.hits.filter((h) => re.test(h)).length;

{ const d = path.join(TMP, 'a'); fake.hits = [];
  const up = mk(d); await up.tick();
  const st = up.state(), v = up.view();
  ok('下好了：update.json 记着、dmg 在 updates/ 里、内容一样', st.fileVer === '0.3.8' && fs.existsSync(st.file) && path.dirname(st.file) === path.join(d, 'updates') && fs.readFileSync(st.file).equals(fake.dmg), JSON.stringify(st));
  ok('下好了：view ready', v && v.ready === true && v.latest === '0.3.8');
  ok('下好了：先取 .sha256 再取 dmg', fake.hits.join(' ') === '/o/r/releases/latest /o/r/releases/download/v0.3.8/cc-board.dmg.sha256 /o/r/releases/download/v0.3.8/cc-board.dmg', fake.hits.join(' '));
  ok('没留 .part', !fs.readdirSync(path.join(d, 'updates')).some((f) => f.endsWith('.part')));
  fake.hits = []; clock += 3600000; await up.tick();
  ok('一小时后再叫：不连网（一天查一次、已经下好）', fake.hits.length === 0, fake.hits.join(' '));
  const up2 = mk(d); fake.hits = []; await up2.tick();
  ok('重启（新建一个）读回 update.json：不重查不重下、仍 ready', fake.hits.length === 0 && up2.view() && up2.view().ready, fake.hits.join(' '));
  fs.unlinkSync(st.file);
  const up3 = mk(d);
  ok('用户删了下好的包：重启后不算 ready', up3.view() && up3.view().ready === false);
  fake.latest = '0.3.9'; fake.dmg = crypto.randomBytes(2048); clock += 86400000; fake.hits = [];
  // 上面那步把 0.3.8 删了；放两个旧文件回去（旧包 + 上次断掉的 .part），「旧包删掉」才不是白过
  fs.writeFileSync(path.join(d, 'updates', 'cc-board-0.3.8.dmg'), 'old');
  fs.writeFileSync(path.join(d, 'updates', 'cc-board-0.3.8.dmg.part'), 'half');
  await up2.tick();
  const files = fs.readdirSync(path.join(d, 'updates'));
  ok('第二天出了 0.3.9：查到、下好、旧包删掉', up2.state().fileVer === '0.3.9' && files.join() === 'cc-board-0.3.9.dmg', files.join());
}
{ const d = path.join(TMP, 'b'); fake.latest = '0.3.8'; fake.dmg = crypto.randomBytes(1024); fake.shaOverride = 'cd'.repeat(32); fake.hits = [];
  const up = mk(d); await up.tick();
  const st = up.state();
  ok('sha256 对不上：不留文件、view 不 ready、记下原因', !st.file && !fs.existsSync(path.join(d, 'updates', 'cc-board-0.3.8.dmg')) && up.view() && !up.view().ready && /sha256 对不上/.test(st.error || ''), JSON.stringify(st));
  fake.hits = []; clock += 3600000; await up.tick();
  ok('失败后一小时内不重下（6 小时才再试）', reqs(/cc-board\.dmg/) === 0, fake.hits.join(' '));
  fake.shaOverride = null; clock += 6 * 3600000; await up.tick();
  ok('满 6 小时再试：这次对上了就下好', up.state().fileVer === '0.3.8' && up.view().ready);
}
{ const d = path.join(TMP, 'c'); fake.hits = [];
  const up = mk(d, { check: true, auto: false }); await up.tick();
  ok('autoUpdate 关着：只查不下，view 不 ready', fake.hits.join(' ') === '/o/r/releases/latest' && up.view() && up.view().ready === false, fake.hits.join(' '));
}
{ const d = path.join(TMP, 'd'); fake.hits = [];
  const up = mk(d, { check: false, auto: false }); await up.tick(); await up.tick(true);
  ok('updateCheck 关着：一个请求都不发（点「检查更新」也不发）', fake.hits.length === 0 && up.view() === null, fake.hits.join(' '));
}
{ const d = path.join(TMP, 'e'); fake.hits = [];
  const up = mk(d, { check: true, auto: true }, '0.3.8 (1)'); await up.tick();
  ok('本机已是最新：只查一次，不下，view 是 null', fake.hits.join(' ') === '/o/r/releases/latest' && up.view() === null, fake.hits.join(' '));
}
{ const d = path.join(TMP, 'f'); const keep = fake.latest; fake.latest = ''; fake.hits = [];
  const up = mk(d); await up.tick();
  ok('仓库里还没有 release（跳回 /releases）：不提示，记 no-tag', up.view() === null && /^no-tag/.test(up.state().error || ''), JSON.stringify(up.state()));
  fake.latest = keep;
  fake.hits = []; await up.tick(true);
  ok('点「检查更新」（force）不等一天：马上再查、有了就下', fake.hits[0] === '/o/r/releases/latest' && up.view() && up.view().ready, fake.hits.join(' '));
}
{ const d = path.join(TMP, 'g'); fs.mkdirSync(d, { recursive: true });
  const dead = U.createUpdater({ current: '0.3.7', dir: d, conf: { check: true, auto: true }, base: 'http://127.0.0.1:9/o/r', now: () => clock, log: () => {} });
  let err = null; try { await dead.tick(); } catch (e) { err = e; }
  ok('连不上网：tick 不抛、记下原因、不提示', !err && dead.view() === null && !!dead.state().error, String(err) + JSON.stringify(dead.state()));
}
// ② 断网时一天最多问一次（11/22 1b 修复轮）：没修之前 checkedAt 在 fetch 之后才记，fetch 一抛就没记，每小时重问一次
{ const d = path.join(TMP, 'h'); let n = 0;
  const off = (...a) => { n++; return Promise.reject(new TypeError('fetch failed')); };
  const mkOff = () => U.createUpdater({ current: '0.3.7', dir: d, conf: { check: true, auto: true }, base: BASE, fetchImpl: off, now: () => clock, log: () => {} });
  const t0 = clock; const a = mkOff(); await a.tick();
  clock += 3600000; await a.tick();
  clock += 3600000; await mkOff().tick();          // 重启（新建一个）读回 update.json：也不重问
  const quiet = n;
  clock = t0 + 86400000; await a.tick();
  const dayLater = n;
  await a.tick(true);
  ok('断网：一天最多问一次（1 小时后、重启后都不问，满一天再问，点「检查更新」照样马上问）', quiet === 1 && dayLater === 2 && n === 3, JSON.stringify({ quiet, dayLater, n }));
}
// ① 大小上限：.sha256 最多 1 KB；dmg 有 content-length 先看它，没有就边读边数、超了中止（没修之前 .sha256 不限、dmg 整份读进内存再比 200 MB）
{ const big = crypto.randomBytes(128 * 1024), bigSha = crypto.createHash('sha256').update(big).digest('hex');
  const f2 = { mode: '', closedEarly: null };
  const gh2 = http.createServer((req, res) => {
    if (req.url === '/c/r/releases/latest') { res.writeHead(302, { location: 'https://github.com/c/r/releases/tag/v0.3.8' }); return res.end(); }
    if (req.url === '/c/r/releases/download/v0.3.8/cc-board.dmg.sha256') {
      res.writeHead(200); return res.end(bigSha + '  cc-board.dmg\n' + (f2.mode === 'bigsha' ? '#'.repeat(4000) + '\n' : ''));
    }
    if (req.url === '/c/r/releases/download/v0.3.8/cc-board.dmg') {
      if (f2.mode !== 'stream') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': big.length }); return res.end(big); }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });     // 不给 content-length（分块），一块 1 KB 慢慢发
      res.on('close', () => { f2.closedEarly = !res.writableEnded; });
      let i = 0; const step = () => { if (res.destroyed) return; if (i >= big.length) return res.end(); res.write(big.subarray(i, i += 1024)); setTimeout(step, 4); }; step();
      return;
    }
    res.writeHead(404); res.end('Not Found');
  });
  await new Promise((r) => gh2.listen(0, '127.0.0.1', r));
  const B2 = 'http://127.0.0.1:' + gh2.address().port + '/c/r';
  let k2 = 0;      // 每次一个新目录：同一个目录会读回上一次失败的 triedAt，6 小时内不重试
  const run2 = async (mode, maxDmg) => { f2.mode = mode; f2.closedEarly = null; const d = path.join(TMP, 'cap-' + mode + '-' + (k2++));
    const up = U.createUpdater({ current: '0.3.7', dir: d, conf: { check: true, auto: true }, base: B2, now: () => clock, log: () => {}, maxDmg });
    await up.tick(); await sleep(100);
    const left = fs.existsSync(path.join(d, 'updates')) ? fs.readdirSync(path.join(d, 'updates')) : [];
    return { error: up.state().error, ready: !!(up.view() && up.view().ready), left: left.join(), closedEarly: f2.closedEarly }; };
  const s = await run2('bigsha', 1024 * 1024);
  ok('.sha256 超过 1 KB：不认（前面那段 sha 对得上也不下）', !s.ready && /sha256 文件 太大/.test(s.error || '') && s.left === '', JSON.stringify(s));
  const cl = await run2('cl', 4096), st = await run2('stream', 4096), fine = await run2('cl', 1024 * 1024);
  ok('dmg 超过上限：有 content-length 先看它、一个字节都不写；没有就边读边数，超了中止（服务器那头没发完连接就断了），都不留 .part；上限以内照常下好',
    !cl.ready && /dmg 太大（content-length/.test(cl.error || '') && cl.left === '' && !st.ready && /dmg 太大（读到/.test(st.error || '') && st.closedEarly === true && st.left === '' && fine.ready,
    JSON.stringify({ cl, st, fine }));
  gh2.close();
}
// ⑤ update.json 读回来的 latest 先过版本号的样子再用（它要进网址和 path.join）
{ const d = path.join(TMP, 'j'); fs.mkdirSync(d, { recursive: true }); let n = 0;
  fs.writeFileSync(path.join(d, 'update.json'), JSON.stringify({ checkedAt: clock, latest: '9.9.9 /../../../evil', file: null, fileVer: null, triedAt: 0, error: null }));
  const up = U.createUpdater({ current: '0.3.7', dir: d, conf: { check: true, auto: true }, base: BASE, fetchImpl: (...a) => { n++; return fetch(...a); }, now: () => clock, log: () => {} });
  const v0 = up.view(); await up.tick();
  ok('update.json 里的 latest 不像版本号（「9.9.9 /../../../evil」）：当没有，不提示、不拿它拼网址去下', up.state().latest === null && v0 === null && n === 0 && !fs.existsSync(path.join(TMP, 'evil.dmg')), JSON.stringify({ latest: up.state().latest, v0, n }));
}

// ───── 三、试验场服务 ─────
const NODE = process.execPath, SERVER = path.join(HERE, '../server.mjs');
const kids = [];
async function boot(tag, port, extraEnv, conf) {
  const home = path.join(TMP, 'home-' + tag), data = path.join(home, 'Library/Application Support/cc-board');
  fs.mkdirSync(path.join(home, '.claude/sessions'), { recursive: true }); fs.mkdirSync(path.join(home, '.claude/projects'), { recursive: true }); fs.mkdirSync(data, { recursive: true });
  if (conf !== undefined) fs.writeFileSync(path.join(data, 'config.json'), conf);
  const logf = path.join(TMP, 'server-' + tag + '.log'), out = fs.openSync(logf, 'w');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CCBOARD_') && !k.startsWith('CLAUDE') && k !== 'TMUX' && k !== 'TMUX_PANE')),
    HOME: home, CCBOARD_DATA: data, CCBOARD_PORT: String(port), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_REMOTE_PORT: String(port + 50),
    CCBOARD_TMUX_SOCKET: path.join(TMP, 'tmux-' + tag + '.sock'), TMUX_TMPDIR: TMP, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...extraEnv };
  const p = spawn(NODE, [SERVER], { env, stdio: ['ignore', out, out] }); kids.push(p);
  for (let i = 0; i < 100; i++) { await sleep(100); try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch {} }
  const token = fs.readFileSync(path.join(data, '.token'), 'utf8').trim();
  const H = { 'x-ccboard': token };
  return { data, log: () => fs.readFileSync(logf, 'utf8'),
    state: () => fetch(`http://127.0.0.1:${port}/api/state?peek=1`, { headers: H }).then((r) => r.json()),
    post: (p2, body = {}, origin) => fetch(`http://127.0.0.1:${port}${p2}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()) };
}
const P0 = 14700 + Math.floor(Math.random() * 200);
try {
  fake.latest = '0.3.8'; fake.dmg = crypto.randomBytes(3000); fake.shaOverride = null; fake.hits = [];
  const s1 = await boot('on', P0, { CCBOARD_UPDATE_BASE: BASE, CCBOARD_UPDATE_CURRENT: '0.3.7 (12)', CCBOARD_UPDATE_DELAY_MS: '200' });
  let st1; for (let i = 0; i < 50; i++) { await sleep(100); st1 = await s1.state(); if (st1.update && st1.update.ready) break; }
  ok('服务：起来后自己查、自己下，/api/state 的 update ready', st1.update && st1.update.ready === true && st1.update.latest === '0.3.8' && st1.update.current === '0.3.7', JSON.stringify(st1.update));
  ok('服务：dmg 落在数据目录 updates/ 里', fs.existsSync(path.join(s1.data, 'updates', 'cc-board-0.3.8.dmg')));
  ok('服务：启动日志写 update on', /update \S+ on：本机 0\.3\.7 \(12\)，autoUpdate=true/.test(s1.log()));
  const op = await s1.post('/api/update/open');
  ok('服务：/api/update/open 试验场只记 dry、不真打开', op.ok === true && op.dry === true && /update \S+ dry:open .*cc-board-0\.3\.8\.dmg/.test(s1.log()), JSON.stringify(op));
  const op2 = await s1.post('/api/update/open', {}, 'http://evil.example');
  ok('服务：别的页面（Origin 不对）调不了 /api/update/open', op2.ok === false, JSON.stringify(op2));
  fake.latest = '0.3.9'; fake.dmg = crypto.randomBytes(1500); fake.hits = [];
  const ck = await s1.post('/api/update/check');
  ok('服务：/api/update/check 马上查、下到新的', ck.ok && ck.update && ck.update.latest === '0.3.9' && ck.update.ready, JSON.stringify(ck));
  const sv = await fetch(`http://127.0.0.1:${P0}/api/state?v=0`, { headers: { 'x-ccboard': fs.readFileSync(path.join(s1.data, '.token'), 'utf8').trim() } }).then((r) => r.json());
  ok('服务：只回变过的读法的整份里也带 update', sv.full === true && sv.update && sv.update.latest === '0.3.9');

  fake.hits = [];
  const s2 = await boot('nobase', P0 + 2, { CCBOARD_UPDATE_CURRENT: '0.3.7 (12)', CCBOARD_UPDATE_DELAY_MS: '200' });
  await sleep(800); const st2 = await s2.state();
  ok('服务：试验场没给 CCBOARD_UPDATE_BASE 就不连（/api/state 没有 update 键、日志 off（试验场））', !('update' in st2) && fake.hits.length === 0 && /update \S+ off（试验场）/.test(s2.log()), JSON.stringify(st2.update) + ' hits=' + fake.hits.length);
  const op3 = await s2.post('/api/update/check');
  ok('服务：没开时 /api/update/check 说没开', op3.ok === false && /没开/.test(op3.error || ''));

  const s3 = await boot('nover', P0 + 4, { CCBOARD_UPDATE_BASE: BASE, CCBOARD_UPDATE_DELAY_MS: '200' });
  await sleep(800);
  ok('服务：没有 .bundle-version（build.sh 装的）就不查', !('update' in (await s3.state())) && /update \S+ off（不是公开安装包）/.test(s3.log()));

  fake.hits = [];
  const s4 = await boot('cfgoff', P0 + 6, { CCBOARD_UPDATE_BASE: BASE, CCBOARD_UPDATE_CURRENT: '0.3.7', CCBOARD_UPDATE_DELAY_MS: '200' }, '{"updateCheck": false}');
  await sleep(800);
  ok('服务：config updateCheck:false 一个请求都不发', !('update' in (await s4.state())) && fake.hits.length === 0 && /update \S+ off（updateCheck=false）/.test(s4.log()), 'hits=' + fake.hits.length);

  const s5 = await boot('cfgbad', P0 + 8, { CCBOARD_UPDATE_BASE: BASE, CCBOARD_UPDATE_CURRENT: '0.3.7', CCBOARD_UPDATE_DELAY_MS: '200' }, '{"autoUpdate": "no", "autoTrust": true}');
  await sleep(300);
  ok('服务：autoUpdate 写错 = 整份 config 不用（日志写原因），检查照默认开', /config .*读不了（autoUpdate 要是 true 或 false）/.test(s5.log()) && /update \S+ on：/.test(s5.log()));

  fake.hits = [];
  const s6 = await boot('ro', P0 + 10, { CCBOARD_UPDATE_BASE: BASE, CCBOARD_UPDATE_CURRENT: '0.3.7', CCBOARD_UPDATE_DELAY_MS: '200', CCBOARD_READONLY: '1' });
  await sleep(800);
  ok('服务：只读服务不查（要写 update.json）', !('update' in (await s6.state())) && fake.hits.length === 0 && /update \S+ off（只读）/.test(s6.log()));
} finally {
  for (const k of kids) try { k.kill('SIGTERM'); } catch {}
  gh.close();
  await sleep(300);
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`update.test：${pass} 过 ${fail} 没过`);
process.exit(fail ? 1 : 0);
