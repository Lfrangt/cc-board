/**
 * [INPUT]: 依赖 ../server.mjs（或命令行给的另一份：红阶段把「没有 Gemini 那一版」的 server.mjs 放进一份工程拷贝里再给路径）；依赖 tmux、/usr/bin/env、/bin/bash、/bin/zsh
 * [OUTPUT]: 逐项打印 ok / FAIL；退出码 0 = 全过。每份试验服务的 stdout 在 test/tmp/gem-*（带 --keep 才留）
 * [POS]: test/ 的 Gemini 模型专测（11/23）。作者：「我们在 Claude Code 里用 Gemini 的模型……应该在模型列表里可以选」。外壳还是 Claude Code，模型是 Gemini：
 *        config.json 的 `gemini` 写 claude-gemini 外壳脚本的路径，模型下拉里就多出 gemini-4-neon / carbon / hydrogen，选了就 `GEMINI_MODEL=<它> /bin/bash <脚本> [提示 | --resume <sid>]` 起窗口。
 *        不用 state.test.mjs 的 600 多项（机器忙时要跑很久、没有按段跑的开关）：这里自己起 4 份试验服务（假主目录、自己的端口、自己的 tmux 套接字），
 *        假 claude 和假 claude-gemini 把「真收到了什么」写进文件，断言读文件、不读服务自己的说法。
 *          [A] Gemini 开着：模型列表、新任务（参数 / 环境 / PATH / 空提示）、Claude 模型不变、四种报错不开窗口（强度 / 档位 / 账号 / Code Mode）、
 *              提示里的 shell 元字符原样当一个参数（不过 shell）、接回走外壳（含 --resume）而 Claude 的归档照旧、活的 Gemini 会话归档时记下 gemini。
 *          [B] config 里没写 gemini：没有 Gemini 模型、开不了、Gemini 的归档项接回被拒（不悄悄变成 Claude）。
 *          [C] gemini 指的脚本不在：同上，报「找不到脚本」。
 *          [D] gemini 写错（不是字符串、不是绝对路径）：只关这一项，别的键（accounts）照常。
 * [PROTOCOL]: 改了 Gemini 的接线（server.mjs 的 geminiArgv / newSession 的 gem 分支 / unarchive 的 gemM / providers()）要同步改这里；加断言前先在「没有 Gemini 那一版」上跑出红
 */
// 用法：node test/gemini.test.mjs [server.mjs 的路径] [--keep]      端口用 T_PORT 改（默认 4881，用到 4881 / 4891 / 4901 / 4911 和各自 +1000 的预览端口）
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../server.mjs'));
const KEEP = process.argv.includes('--keep');
const PORT = Number(process.env.T_PORT || 4881);
const NODE = process.execPath; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x));
if (!TMUX_BIN) { console.error('ABORT：找不到 tmux，开窗口测不了'); process.exit(2); }
fs.mkdirSync(path.join(HERE, 'tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, 'tmp', 'gem-'));            // 放在仓库里的临时目录，--keep 才留
const TMUXDIR = fs.mkdtempSync('/tmp/ccb-gem-tmux-');                   // 这次测试自己的 tmux 套接字，一律 -S 绝对路径（不用 -L：目录被人删了会退回线上那台）
const BIN = path.join(ROOT, 'bin'); fs.mkdirSync(BIN, { recursive: true });
const GEM = ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-hydrogen'];

// ── 假命令 ──
// 假 claude：把收到的参数、环境、工作目录写进 $T_OUT.*，最后写 .done，再睡着（像一个在等输入的窗口）
fs.writeFileSync(path.join(BIN, 'claude'), [
  '#!/bin/sh',
  ': > "$T_OUT.claudeargv"',
  'for a in "$@"; do printf \'%s\\0\' "$a" >> "$T_OUT.claudeargv"; done',
  'printf \'%s|%s\' "${CLAUDE_CODE_OAUTH_TOKEN-unset}" "${CCBOARD_ACCOUNT-unset}" > "$T_OUT.env"',
  'printf \'%s\' "$0" > "$T_OUT.self"',
  ': > "$T_OUT.done"',
  '/bin/sleep 25', ''].join('\n'), { mode: 0o755 });
// 假的 security：钥匙串里只有 ccboard-account-good（token 是 tok-good）
fs.writeFileSync(path.join(BIN, 'security'), '#!/bin/sh\nsvc=; w=0\nwhile [ $# -gt 0 ]; do case "$1" in -s) svc="$2"; shift;; -w) w=1;; esac; shift; done\ncase "$svc" in ccboard-account-good) t=tok-good;; *) exit 44;; esac\n[ $w = 1 ] && echo $t\nexit 0\n', { mode: 0o755 });
// 假 claude-gemini：和真的同一个合同——读 GEMINI_MODEL，最后 exec "$(command -v claude)" --model "$GEMINI_MODEL" "$@"；
// 先把自己看到的环境和参数写进 $T_OUT.wrap / .wrapargv。没有执行位：服务要用 /bin/bash 跑它
const WRAPPER = [
  '#!/bin/bash',
  '{',
  '  printf \'MODEL=%s\\n\' "${GEMINI_MODEL-unset}"',
  '  printf \'TOKEN=%s\\n\' "${CLAUDE_CODE_OAUTH_TOKEN-unset}"',
  '  printf \'ACCT=%s\\n\' "${CCBOARD_ACCOUNT-unset}"',
  '  printf \'CODEMODE=%s\\n\' "${CLAUDE_CODE_EXPERIMENTAL_CODE_MODE-unset}"',
  '  printf \'CLAUDE=%s\\n\' "$(command -v claude)"',
  '  printf \'PATH1=%s\\n\' "${PATH%%:*}"',
  '  printf \'ARGC=%s\\n\' "$#"',
  '} > "$T_OUT.wrap"',
  'for a in "$@"; do printf \'%s\\0\' "$a" >> "$T_OUT.wrapargv"; done',
  'exec "$(command -v claude)" --model "$GEMINI_MODEL" "$@"', ''].join('\n');

// ── 小工具 ──
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const nul = (s) => (s === null ? null : s.split('\0').slice(0, -1));
const kv = (s) => Object.fromEntries((s || '').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const kids = [], servers = [];

// ── 起一份试验服务：假主目录、自己的端口和 tmux 套接字、一份 config.json（可带 archive.json）──
async function startServer(tag, cfg, archive) {
  const idx = servers.length, port = PORT + 10 * idx, dir = path.join(ROOT, tag);
  const FH = path.join(dir, 'home'), DATA = path.join(FH, 'Library/Application Support/cc-board'), SESS = path.join(FH, '.claude/sessions'), CWD = path.join(FH, 'work');
  const PROJ = path.join(FH, '.claude/projects', CWD.replace(/[^A-Za-z0-9]/g, '-'));
  for (const d of [DATA, SESS, PROJ, CWD, path.join(FH, 'gem'), path.join(TMUXDIR, tag)]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(FH, 'gem', 'claude-gemini'), WRAPPER);
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cfg(FH)));
  if (archive) fs.writeFileSync(path.join(DATA, 'archive.json'), JSON.stringify({ items: archive(FH, CWD) }));
  const sock = path.join(TMUXDIR, tag, 'ccboard.sock'), out = path.join(dir, 'out'), logFile = path.join(dir, 'server.log');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_|ANTHROPIC_|GEMINI_|TMUX)/.test(k))),
    HOME: FH, CCBOARD_PORT: String(port), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_DATA: DATA, CCBOARD_TMUX_SOCKET: sock, TMUX_TMPDIR: TMUXDIR,
    PATH: BIN + ':/usr/bin:/bin:/usr/sbin:/sbin', T_OUT: out, CCBOARD_SECURITY: path.join(BIN, 'security'), CCBOARD_CLAUDE_TMP: path.join(dir, 'claude-tmp'),
    CCBOARD_SETTLE_MS: '800', CCBOARD_RESPAWN_MS: '300' };
  const fd = fs.openSync(logFile, 'a');
  const proc = spawn(NODE, [SERVER], { env, stdio: ['ignore', fd, fd] }); kids.push(proc.pid);
  const S = { tag, port, FH, DATA, SESS, CWD, PROJ, sock, out, proc, tok: '', log: () => rd(logFile) || '' };
  servers.push(S);
  const up = await until(async () => { try { S.tok = (rd(path.join(DATA, '.token')) || '').trim(); const h = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); return !!(h.ok && S.tok); } catch { return false; } }, 20000);
  if (!up) { console.error('ABORT：' + tag + ' 起不来\n' + S.log().slice(-1500)); await cleanup(); process.exit(2); }
  S.get = async (p) => (await fetch('http://127.0.0.1:' + port + p, { headers: { 'x-ccboard': S.tok } })).json();
  S.post = async (p, body) => { const r = await fetch('http://127.0.0.1:' + port + p, { method: 'POST', headers: { 'x-ccboard': S.tok, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };
  S.clear = () => { for (const x of ['wrap', 'wrapargv', 'claudeargv', 'env', 'self', 'done']) { try { fs.unlinkSync(out + '.' + x); } catch {} } };
  // 发一个 /api/new 或 /api/unarchive，等假 claude 写完 .done（没写 = 没开窗口）；回服务的应答和两个假命令各自看到的东西
  S.run = async (route, body, wait = true) => {
    S.clear(); const r = await S.post(route, body);
    const started = r.body && r.body.ok ? await until(() => fs.existsSync(out + '.done'), 12000) : false;
    if (!wait) await sleep(1500);
    return { r, started, wrap: rd(out + '.wrap') === null ? null : kv(rd(out + '.wrap')), wrapArgv: nul(rd(out + '.wrapargv')), claudeArgv: nul(rd(out + '.claudeargv')), env: rd(out + '.env'), self: rd(out + '.self') };
  };
  S.providers = async () => (await S.get('/api/state?peek=1')).providers;
  return S;
}
// 活的会话：假进程（命令行带 claude-fake，服务才肯停它）+ 会话登记 + 对话记录；model 是最后一条真回复的模型
function mkLive(S, name, model) {
  const child = spawn(NODE, ['-e', 'setInterval(() => {}, 1e6)', 'claude-fake'], { stdio: 'ignore' }); kids.push(child.pid);
  const sid = name.padEnd(8, '0') + '-0000-4000-8000-' + String(child.pid).padStart(12, '0'), t = (ms) => new Date(Date.now() - ms).toISOString();
  const recs = [{ type: 'user', message: { role: 'user', content: '问个问题' }, origin: { kind: 'human' }, timestamp: t(9000) },
    { type: 'assistant', message: { id: 'm-' + name, model, content: [{ type: 'text', text: '回答好了。' }], stop_reason: 'end_turn' }, timestamp: t(7000) }];
  fs.writeFileSync(path.join(S.PROJ, sid + '.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(S.SESS, child.pid + '.json'), JSON.stringify({ pid: child.pid, sessionId: sid, cwd: S.CWD, startedAt: Date.now() - 60000, kind: 'interactive', entrypoint: 'cli', name: 'w-' + name, nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now() - 2000, updatedAt: Date.now() - 2000 }));
  return sid;
}
async function cleanup() {
  for (const S of servers) {          // 只收自己起的 tmux：套接字都在这次的 TMUXDIR 里，别处一律不碰（全局规矩 30）
    const socks = [S.sock]; try { for (const f of fs.readdirSync(path.join(TMUXDIR, S.tag, 'tmux'))) socks.push(path.join(TMUXDIR, S.tag, 'tmux', f)); } catch {}
    for (const s of socks) if (s.startsWith(TMUXDIR + '/') && fs.existsSync(s)) spawnSync(TMUX_BIN, ['-S', s, 'kill-server'], { stdio: 'ignore' });
  }
  for (const pid of kids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await sleep(300);
  if (!KEEP) { fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(TMUXDIR, { recursive: true, force: true }); }
}
for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) process.on(sig, async () => { await cleanup(); process.exit(code); });

console.log('server:', SERVER, ' load:', os.loadavg().map((x) => x.toFixed(1)).join(' '));
const seedArchive = (FH, CWD) => ({
  'gem10000-0000-4000-8000-000000000001': { sid: 'gem10000-0000-4000-8000-000000000001', provider: 'claude', gemini: 'gemini-4-neon', title: 'Gemini 老窗口', cwd: CWD, file: null, prompt: '用 Gemini 做的事', archivedAt: Date.now() - 3600000, state: 'archived', why: '测试夹具' },
  'cla10000-0000-4000-8000-000000000002': { sid: 'cla10000-0000-4000-8000-000000000002', provider: 'claude', title: 'Claude 老窗口', cwd: CWD, file: null, prompt: '用 Claude 做的事', archivedAt: Date.now() - 3600000, state: 'archived', why: '测试夹具' } });
const SID_GEM = 'gem10000-0000-4000-8000-000000000001', SID_CL = 'cla10000-0000-4000-8000-000000000002';
const CANARY = path.join(ROOT, 'PWNED');

try {
  // ═══ [A] Gemini 开着（路径用 ~/ 写法）+ 登记了一个默认号 ═══
  console.log('\n[A] config.json 的 gemini 写了脚本：模型列表、开窗口、接回、归档');
  const A = await startServer('a', () => ({ gemini: '~/gem/claude-gemini', accounts: [{ id: 'good', name: '旧号' }], defaultAccount: 'good' }), seedArchive);
  const pv = await until(async () => { const p = await A.providers(); return p && p.claude && p.claude.accounts && p.claude.accounts.length ? p : null; }, 8000) || await A.providers();
  ok(same(pv.claude.models, ['fable', 'opus', 'sonnet', 'haiku', ...GEM]), 'Gemini 三个模型接在 Claude Code 的模型列表后面', JSON.stringify(pv.claude.models));
  ok(same(pv.claude.geminiModels, GEM), 'providers.claude.geminiModels 告诉界面哪几个是 Gemini', JSON.stringify(pv.claude.geminiModels));
  ok(same(Object.keys(pv), ['claude']), '不是第三个「交给谁」：providers 里还只有 claude', JSON.stringify(Object.keys(pv)));
  ok(same(pv.claude.efforts, ['low', 'medium', 'high', 'xhigh', 'max']) && !/^gemini-/.test(pv.claude.defaultModel || ''), 'Claude 自己的强度列表没动、默认模型不会是 Gemini（假主目录里没有 settings.json，默认模型本来就是 null）', JSON.stringify([pv.claude.efforts, pv.claude.defaultModel]));

  const g1 = await A.run('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'gemini-4-neon' });
  ok(g1.r.body.ok && g1.r.body.gemini === 'gemini-4-neon' && g1.r.body.account === null, '选 Gemini 开窗口：应答带 gemini、没有账号', JSON.stringify(g1.r.body));
  ok(g1.started && g1.wrap && g1.wrap.MODEL === 'gemini-4-neon', '外壳脚本被跑了，GEMINI_MODEL 是选的那个', JSON.stringify(g1.wrap));
  ok(g1.wrap && g1.wrap.CLAUDE === path.join(BIN, 'claude') && g1.wrap.PATH1 === BIN, '脚本里 command -v claude 找得到（PATH 最前面是 claude 所在的文件夹）', g1.wrap && g1.wrap.CLAUDE + ' ' + g1.wrap.PATH1);
  ok(g1.wrapArgv && g1.wrapArgv.length === 1 && g1.wrapArgv[0].startsWith('做个小工具\n\n<system-reminder>') && /不想被问/.test(g1.wrapArgv[0]), '交给脚本的只有一个参数：任务原话 + 找项目文件夹的说明', JSON.stringify(g1.wrapArgv && g1.wrapArgv.map((x) => x.slice(0, 30))));
  ok(g1.claudeArgv && same(g1.claudeArgv.slice(0, 2), ['--model', 'gemini-4-neon']) && g1.claudeArgv[2] === (g1.wrapArgv || [])[0] && g1.claudeArgv.length === 3, '脚本 exec 出来的 claude 收到 --model gemini-4-neon 和同一句提示、没有别的参数（没有 --effort）', JSON.stringify(g1.claudeArgv && g1.claudeArgv.map((x) => x.slice(0, 30))));
  ok(g1.wrap && g1.wrap.TOKEN === 'unset' && g1.wrap.ACCT === 'unset' && g1.env === 'unset|unset', '默认号（good）没有包上来：Claude 的登录 token 不会跑进 Gemini 窗口', JSON.stringify([g1.wrap && [g1.wrap.TOKEN, g1.wrap.ACCT], g1.env]));
  ok(g1.wrap && g1.wrap.CODEMODE === 'unset', '没有 Code Mode 的环境变量', g1.wrap && g1.wrap.CODEMODE);
  ok(/gemini \S+ \S+ new gemini-4-neon/.test(A.log()), '服务日志记了一行 gemini … new gemini-4-neon');

  const g2 = await A.run('/api/new', { prompt: '', cwd: '~', provider: 'claude', model: 'gemini-4-hydrogen' });
  ok(g2.r.body.ok && g2.wrap && g2.wrap.MODEL === 'gemini-4-hydrogen' && g2.wrap.ARGC === '0' && g2.claudeArgv && same(g2.claudeArgv, ['--model', 'gemini-4-hydrogen']), '空提示（⌘T 那种）：脚本没收到参数，claude 只收到 --model', JSON.stringify([g2.r.body, g2.wrap, g2.claudeArgv]));

  const c1 = await A.run('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'opus', effort: 'low' });
  ok(c1.r.body.ok && c1.r.body.gemini === undefined && c1.wrap === null && c1.claudeArgv && same(c1.claudeArgv.slice(0, 4), ['--model', 'opus', '--effort', 'low']), 'Claude 的模型照旧：直接起 claude、不经外壳、带强度、应答没有 gemini', JSON.stringify([c1.r.body, c1.wrap, c1.claudeArgv && c1.claudeArgv.slice(0, 4)]));
  ok(c1.env === 'tok-good|good', 'Claude 的窗口仍按默认号起（token 经钥匙串包上来）', c1.env);
  ok(!/gemini \S+ \S+ new gemini-4-neon[\s\S]*gemini \S+ \S+ new opus/.test(A.log()) && (A.log().match(/gemini \S+ \S+ new /g) || []).length === 2, 'Claude 开的窗口不记 gemini 日志（一共 2 行：neon、hydrogen）');

  // 四种不接的写法：报错、不开窗口（悄悄丢掉的话，调用方会以为强度 / 账号 / Code Mode 生效了）
  A.clear();
  const rej = [['强度', { effort: 'low' }, /强度/], ['档位（会带强度）', { tier: 'light' }, /强度|档位/], ['账号', { account: 'good' }, /账号/], ['Code Mode', { codeMode: true }, /Code Mode/]];
  const rejR = [];
  for (const [, extra] of rej) rejR.push(await A.post('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'gemini-4-neon', ...extra }));
  await sleep(1500);
  rej.forEach(([what, , re], i) => ok(rejR[i].body.ok === false && re.test(rejR[i].body.error || ''), 'Gemini + ' + what + '：报错、说得出原因', JSON.stringify(rejR[i].body)));
  ok(rd(A.out + '.wrap') === null && rd(A.out + '.claudeargv') === null, '四次被拒都没有开窗口（脚本和 claude 都没被跑）');

  // 提示是模型 / 别的窗口写的文字，要原样当一个参数：tmux 收的是 argv、不过 shell
  const evil = '$(touch ' + CANARY + ') `touch ' + CANARY + '` "q" \'s\' ; touch ' + CANARY + ' #\n--resume x';
  const g3 = await A.run('/api/new', { prompt: evil, cwd: '~', provider: 'claude', model: 'gemini-4-carbon' });
  ok(g3.wrapArgv && g3.wrapArgv.length === 1 && g3.wrapArgv[0].startsWith(evil), '提示里的 $() 反引号 引号 分号 换行 --resume 原样是一个参数', JSON.stringify(g3.wrapArgv && g3.wrapArgv.map((x) => x.slice(0, 60))));
  ok(!fs.existsSync(CANARY), '没有任何一段被当命令执行（canary 文件不存在）');

  // 接回：当初是 Gemini 开的，接回还走外壳；Claude 的归档照旧
  const rg = await A.run('/api/unarchive', { sid: SID_GEM });
  ok(rg.r.body.ok && rg.r.body.resumed === true, 'Gemini 的归档项接回成功', JSON.stringify(rg.r.body));
  ok(rg.wrap && rg.wrap.MODEL === 'gemini-4-neon' && same(rg.wrapArgv, ['--resume', SID_GEM]) && same(rg.claudeArgv, ['--model', 'gemini-4-neon', '--resume', SID_GEM]), '接回走外壳：GEMINI_MODEL 对、参数是 --resume <sid>、claude 收到 --model gemini-4-neon --resume <sid>', JSON.stringify([rg.wrap, rg.wrapArgv, rg.claudeArgv]));
  ok(rg.wrap && rg.wrap.TOKEN === 'unset' && rg.wrap.ACCT === 'unset' && rg.env === 'unset|unset', '接回也不包默认号（Claude 的 token 不进 Gemini 窗口）', JSON.stringify([rg.wrap && [rg.wrap.TOKEN, rg.wrap.ACCT], rg.env]));
  ok(new RegExp('gemini \\S+ \\S+ resume ' + SID_GEM.slice(0, 8) + ' gemini-4-neon').test(A.log()), '日志记了 gemini … resume <sid 前 8 位> gemini-4-neon');
  const rc = await A.run('/api/unarchive', { sid: SID_CL });
  ok(rc.r.body.ok && rc.wrap === null && same(rc.claudeArgv, ['--resume', SID_CL]) && rc.env === 'tok-good|good', 'Claude 的归档项接回照旧：直接 claude --resume、不经外壳、默认号照包', JSON.stringify([rc.r.body, rc.wrap, rc.claudeArgv, rc.env]));

  // 归档：活的 Gemini 会话（记录里最后一条回复的模型是 gemini-4-neon）归档时要记下 gemini，不然以后接回就悄悄变成 Claude
  const sidG = mkLive(A, 'livegem', 'gemini-4-neon'), sidO = mkLive(A, 'liveopus', 'claude-opus-5-5');
  const seen = await until(async () => { const st = await A.get('/api/state?peek=1'); const a = st.sessions.find((x) => x.sid === sidG), b = st.sessions.find((x) => x.sid === sidO); return a && b && a.model && b.model ? [a.model, b.model] : null; }, 15000);
  ok(same(seen, ['gemini-4-neon', 'claude-opus-5-5']), '夹具：两个活会话的模型从对话记录里读到了', JSON.stringify(seen));
  const ag = await A.post('/api/archive', { sid: sidG }), ao = await A.post('/api/archive', { sid: sidO });
  const arc = JSON.parse(rd(path.join(A.DATA, 'archive.json')) || '{"items":{}}').items;
  ok(ag.body.ok && ao.body.ok, '两个都归档了', JSON.stringify([ag.body, ao.body]));
  ok(arc[sidG] && arc[sidG].gemini === 'gemini-4-neon', 'Gemini 会话的归档项记下了 gemini: gemini-4-neon', JSON.stringify(arc[sidG] && Object.keys(arc[sidG])));
  ok(arc[sidO] && arc[sidO].gemini === undefined, 'Claude 会话的归档项没有 gemini', JSON.stringify(arc[sidO] && arc[sidO].gemini));

  // ═══ [B] config 里没有 gemini 这个键 ═══
  console.log('\n[B] 没写 gemini：不出现、开不了、接回被拒');
  const B = await startServer('b', () => ({ accounts: [{ id: 'good', name: '旧号' }] }), seedArchive);
  const pvB = await B.providers();
  ok(same(pvB.claude.models, ['fable', 'opus', 'sonnet', 'haiku']) && pvB.claude.geminiModels === undefined, '模型列表只有 Claude 的四个，没有 geminiModels', JSON.stringify(pvB.claude.models));
  const nb = await B.run('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'gemini-4-neon' }, false);
  ok(nb.r.body.ok === false && /Gemini 没有打开/.test(nb.r.body.error || '') && nb.wrap === null && nb.claudeArgv === null, '直接请求 Gemini 模型：报「没有打开」，不开窗口（不会把 gemini-4-neon 当 Claude 模型名传给 claude）', JSON.stringify([nb.r.body, nb.claudeArgv]));
  const ub = await B.run('/api/unarchive', { sid: SID_GEM }, false);
  ok(ub.r.body.ok === false && /Gemini/.test(ub.r.body.error || '') && ub.claudeArgv === null && ub.wrap === null, 'Gemini 的归档项接回被拒、说清原因，不悄悄变成 Claude 的模型', JSON.stringify([ub.r.body, ub.claudeArgv]));
  const uc = await B.run('/api/unarchive', { sid: SID_CL });
  ok(uc.r.body.ok && same(uc.claudeArgv, ['--resume', SID_CL]), '同一份服务里 Claude 的归档项照常接回', JSON.stringify([uc.r.body, uc.claudeArgv]));

  // ═══ [C] gemini 指的脚本不在 ═══
  console.log('\n[C] gemini 指的脚本不在');
  const C = await startServer('c', () => ({ gemini: '/nonexistent/dir/claude-gemini' }), seedArchive);
  const pvC = await C.providers();
  ok(same(pvC.claude.models, ['fable', 'opus', 'sonnet', 'haiku']) && pvC.claude.geminiModels === undefined, '脚本不在：模型列表里没有 Gemini', JSON.stringify(pvC.claude.models));
  const nc = await C.run('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'gemini-4-carbon' }, false);
  ok(nc.r.body.ok === false && /找不到 claude-gemini 脚本/.test(nc.r.body.error || '') && nc.claudeArgv === null, '直接请求：报找不到脚本，不开窗口', JSON.stringify(nc.r.body));
  const uC = await C.run('/api/unarchive', { sid: SID_GEM }, false);
  ok(uC.r.body.ok === false && uC.claudeArgv === null, 'Gemini 的归档项接回被拒', JSON.stringify(uC.r.body));
  ok(/gemini 指的脚本现在不在/.test(C.log()), '服务日志说了脚本不在');

  // ═══ [D] gemini 写错：只关这一项 ═══
  console.log('\n[D] gemini 写错只关这一项，别的键照常');
  const D = await startServer('d', () => ({ gemini: 42, accounts: [{ id: 'good', name: '旧号' }] }));
  const pvD = await D.providers();
  ok(same(pvD.claude.models, ['fable', 'opus', 'sonnet', 'haiku']) && pvD.claude.geminiModels === undefined, '不是字符串：没有 Gemini 模型', JSON.stringify(pvD.claude.models));
  ok(Array.isArray(pvD.claude.accounts) && pvD.claude.accounts.some((a) => a.id === 'good'), '同一份 config 里的 accounts 照常用上了（没有因为 gemini 写错整份作废）', JSON.stringify(pvD.claude.accounts));
  ok(/gemini 不用（/.test(D.log()), '日志写了 gemini 不用 + 原因');
  const E = await startServer('e', () => ({ gemini: 'relative/claude-gemini', accounts: [{ id: 'good', name: '旧号' }] }));
  const pvE = await E.providers();
  ok(pvE.claude.geminiModels === undefined && pvE.claude.accounts.some((a) => a.id === 'good'), '相对路径：同样只关 Gemini，accounts 照常', JSON.stringify([pvE.claude.geminiModels, pvE.claude.accounts]));
} finally {
  await cleanup();
}
console.log(`\n${pass} 过 ${fail} 红`);
process.exit(fail ? 1 : 0);
