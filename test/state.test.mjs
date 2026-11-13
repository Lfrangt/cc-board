/**
 * [INPUT]: 依赖 ../server.mjs（或命令行给的另一份，比如 mutants.mjs 造的改坏版）；依赖 /bin/sleep 充当「会话进程」
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过；带 --ui 时不跑断言，搭好场景并写 ui-fixture.json 给 ui-check.mjs 用
 * [POS]: test/ 的服务端测试：30 个假会话覆盖 运行中 / 后台在跑 / 交付 / 额度用完 / 登录过期 / 报错 / 被打断 / 没做完 / 卡住 / 进程退出 / 交付摘要 / 项目分组 / 点开正文里的路径 / 「归档」自己定删还是留。
 *        完全隔离：假的主目录、自己的端口、自己的 tmux 目录，服务因此自认是试验场（不碰 Ghostty、不发系统通知）。收尾只按记下的进程号停。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/state.test.mjs [server.mjs 的路径] [--ui]      端口用 T_PORT 改（默认 4761）
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../server.mjs')); const KEEP = process.argv.includes('--keep');
const PORT = Number(process.env.T_PORT || 4761);
fs.mkdirSync(path.join(HERE, '.tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, '.tmp', 'run-'));
const FH = path.join(ROOT, 'home'); const SESS = path.join(FH, '.claude/sessions'); const CWD = path.join(FH, 'work');
const PROJ = path.join(FH, '.claude/projects', CWD.replace(/[^A-Za-z0-9]/g, '-'));
for (const d of [SESS, PROJ, CWD, path.join(ROOT, 'tmux')]) fs.mkdirSync(d, { recursive: true });
const NODE = process.execPath; const kids = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = Date.now() - 600000; const ts = () => new Date((T += 1500)).toISOString();

// ── 一条条记录 ──
let mid = 0;
const R = {
  human: (text) => ({ type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, timestamp: ts() }),
  tool: (name = 'Bash') => ({ type: 'assistant', message: { id: 'm' + ++mid, model: 'claude-x', content: [{ type: 'tool_use', id: 'tu' + mid, name, input: { command: 'ls', description: '列目录' } }], stop_reason: 'tool_use' }, timestamp: ts() }),
  result: () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + mid, content: 'ok' }] }, timestamp: ts() }),
  note: (text) => ({ type: 'assistant', message: { id: 'm' + ++mid, model: 'claude-x', content: [{ type: 'text', text }], stop_reason: 'tool_use' }, timestamp: ts() }),
  final: (text) => ({ type: 'assistant', message: { id: 'm' + ++mid, model: 'claude-x', content: [{ type: 'text', text }], stop_reason: 'end_turn' }, timestamp: ts() }),
  apiErr: (error, text, stop = 'stop_sequence') => ({ type: 'assistant', message: { id: 'e' + ++mid, model: '<synthetic>', content: [{ type: 'text', text }], stop_reason: stop }, isApiErrorMessage: true, error, timestamp: ts() }),
  interrupt: () => ({ type: 'user', message: { role: 'user', content: '[Request interrupted by user]' }, timestamp: ts() }),
  compact: () => ({ type: 'user', message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context.' }, isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: ts() }),
  peer: (name, text) => ({ type: 'user', message: { role: 'user', content: 'Another Claude session sent a message: <cross-session-message from="uds:/tmp/x.sock" from-name="' + name + '">' + text + '</cross-session-message>' }, origin: { kind: 'peer', name }, isMeta: true, timestamp: ts() }),
  toolAt: (file) => ({ type: 'assistant', message: { id: 'm' + ++mid, model: 'claude-x', content: [{ type: 'tool_use', id: 'tu' + mid, name: 'Read', input: { file_path: file } }], stop_reason: 'tool_use' }, timestamp: ts() }),
  notif: () => ({ type: 'user', message: { role: 'user', content: '<task-notification><status>completed</status></task-notification>' }, origin: { kind: 'task-notification' }, timestamp: ts() }),
};
const LIMIT = "You've hit your weekly limit · resets 11am (America/Vancouver)";
const S = {};   // 名字 → {sid, pid, file}
function mk(name, status, recs, { statusAgo = 60000, claude = false } = {}) {
  // claude: 进程命令行里带 claude-fake（服务只肯停命令行里带 claude 的进程，归档测试要它真停得掉）
  const child = claude ? spawn(NODE, ['-e', 'setInterval(() => {}, 1e6)', 'claude-fake'], { stdio: 'ignore' }) : spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(child.pid);
  const sid = name.padEnd(8, '0') + '-0000-4000-8000-' + String(child.pid).padStart(12, '0');
  const file = path.join(PROJ, sid + '.jsonl');
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  S[name] = { sid, pid: child.pid, file, child };
  setStatus(name, status, statusAgo);
}
function setStatus(name, status, ago = 0) {
  const s = S[name];
  fs.writeFileSync(path.join(SESS, s.pid + '.json'), JSON.stringify({ pid: s.pid, sessionId: s.sid, cwd: CWD, startedAt: Date.now() - 3600000, kind: 'interactive', entrypoint: 'cli',
    name: 'w-' + name, nameSource: 'derived', status, statusUpdatedAt: Date.now() - ago, updatedAt: Date.now() - ago }));
}
const append = (name, ...recs) => fs.appendFileSync(S[name].file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

mk('run', 'busy', [R.human('跑测试'), R.tool(), R.result(), R.note('我先看一下目录。')]);
mk('done', 'idle', [R.human('写个总结'), R.tool(), R.result(), R.final('总结写好了。')]);
mk('limit', 'idle', [R.human('改首页'), R.tool(), R.result(), R.note('改到一半。'), R.apiErr('rate_limit', LIMIT)]);
mk('auth', 'idle', [R.human('部署一下'), R.tool(), R.apiErr('authentication_failed', 'Login expired · Please run /login')]);
mk('err', 'idle', [R.human('读这份文档'), R.apiErr('invalid_request', 'Prompt is too long · the request is ~205181 tokens (limit 200000)')]);
mk('intr', 'idle', [R.human('重构播放器'), R.tool(), R.result(), R.interrupt()]);
mk('intrIdle', 'idle', [R.human('查一下日志'), R.final('日志里没有报错。'), R.interrupt()]);
mk('compact', 'busy', [R.human('做发布片'), R.tool(), R.result(), R.compact(), R.tool()]);
mk('unfin', 'idle', [R.human('修那个缺陷'), R.note('我看一下。'), R.tool(), R.result()]);
mk('recover', 'idle', [R.human('跑回归'), R.tool(), R.apiErr('rate_limit', LIMIT), R.notif(), R.tool(), R.result(), R.final('回归全过。')]);
mk('relimit', 'idle', [R.human('整理素材'), R.tool(), R.apiErr('rate_limit', LIMIT), R.notif(), R.apiErr('rate_limit', LIMIT)]);
mk('hint', 'busy', [R.human('做个小工具\n\n<system-reminder>这条任务是从总控台新建的，工作目录是主目录。</system-reminder>'), R.tool()]);
mk('bg', 'shell', [R.human('跑一遍回归'), R.tool(), R.result(), R.final('回归在后台跑，跑完我再报。')]);
mk('bgOpen', 'shell', [R.human('拍一组图'), R.note('我放到后台拍。'), R.tool(), R.result()]);
mk('stall', 'busy', [R.human('等一个网页'), R.tool('mcp__browser__wait')]);
mk('gone', 'busy', [R.human('渲染视频'), R.tool()]);
mk('goneIdle', 'idle', [R.human('问个问题'), R.final('答完了。')]);
// 交付摘要：问你选哪个 = 待跟进；「……的话告诉我」是条件句、不算；它自己写在最后一行的【待跟进】以它为准，那一行不进正文
mk('askQ', 'idle', [R.human('出个方案'), R.tool(), R.result(), R.final('方案写好了，在桌面。\n\n两个方向：A 稳，B 快。你选哪个？')]);
mk('askCond', 'idle', [R.human('换成下拉菜单'), R.tool(), R.result(), R.final('改好了，已上线。\n\n预览在 http://127.0.0.1:4791/?k=abc 。\n\n开出来的不是 Opus 的话，要不要我再查一遍？')]);
mk('peerDone', 'idle', [R.human('做补丁'), R.tool(), R.result(), R.final('补丁交了，等验收。'), R.peer('khalil-f2', '验收通过，请合入'), R.tool(), R.result(), R.final('已合入，回归在后台跑。')]);
mk('noneDone', 'idle', [R.human('继续'), R.final('好，继续做。提审照旧等你明说，其余不需要你做什么。')]);
mk('peerAsk', 'idle', [R.peer('khalil-46', '候选干净了'), R.final('候选的回归全过了。提审要你本人点，要不要现在提审？')]);
// 按项目分组：动过的文件夹定项目（共用的测试锁不算）；没动过文件时看他说的话；新任务附的说明里的「总控台」不算
mk('projF', 'idle', [R.human('改一下首页'), R.toolAt('/Users/x/Projects/fretflow-ui/app/page.tsx'), R.result(), R.toolAt('/Users/x/Projects/fretflow/ios/A.swift'), R.result(),
  R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.final('首页改好了。')]);
mk('projC', 'idle', [R.human('给总控台加个按钮'), R.final('按钮加好了。')]);
// 「归档」一个按钮：没留下东西的删掉，其余留着并记一笔（11/13 Khalil）
mk('tidyChat', 'idle', [R.human('问个小问题'), R.final('答完了。')], { claude: true });
mk('tidyWork', 'idle', [R.human('改一下样式'), R.tool('Edit'), R.result(), R.final('样式改好了。')], { claude: true });
mk('tidyAsk', 'idle', [R.human('出个主意'), R.final('想了两个方向。\n\n你选 A 还是 B？')], { claude: true });
mk('tidyUndo', 'idle', [R.human('随便问问'), R.final('好。')], { claude: true });
// 正文里的本机路径（界面测试核它们变成可点的链接）
mk('links', 'idle', [R.human('整理资料'), R.final('资料在这里：\n\n- 文件夹 ~/Desktop/总控台_封面新版/\n- `~/Library/Application Support/cc-board`\n- [讲解页](file:///Users/khalil/Desktop/x%20y.html)\n- 网址 https://example.com')]);
mk('askTag', 'idle', [R.human('出两版首页'), R.tool(), R.result(), R.final('两版都做好了。\n\n做了什么：出了两版首页\n【待跟进】回 A 或 B，图在桌面')]);

// ── 假的 claude：记下收到的参数和所在的文件夹，然后睡着。服务的 PATH 里只有它，真的 claude 够不着 ──
const BIN = path.join(ROOT, 'bin'); const ARGV = path.join(ROOT, 'argv'); fs.mkdirSync(BIN);
// 任务里带 TRUSTME / OTHERDIALOG 时，它先画一个开工前的选择框（和真 Claude Code 主目录的信任框同一个样子），按键能挪光标，回车后把选中的那项写进 argv.trust
fs.writeFileSync(path.join(BIN, 'dialog.mjs'), `import fs from 'node:fs';
const opts = process.argv.slice(2).join(' ').includes('OTHERDIALOG') ? ['Use this API key', 'Do not use'] : ['No, exit', 'Yes, I trust this folder'];
let cur = 0; const draw = () => process.stdout.write('\\x1b[2J\\x1b[H Accessing workspace:\\n ' + process.cwd() + '\\n Quick safety check: Is this a project you created or one you trust?\\n' + opts.map((o, i) => (i === cur ? ' \\u276f ' : '   ') + o).join('\\n') + '\\n Enter to confirm \\u00b7 Esc to cancel\\n');
process.stdin.setRawMode(true); process.stdin.resume(); draw();
process.stdin.on('data', (b) => { const k = b.toString();
  if (k === '\\x1b[B') { cur = Math.min(opts.length - 1, cur + 1); draw(); } else if (k === '\\x1b[A') { cur = Math.max(0, cur - 1); draw(); }
  else if (k === '\\r') { fs.writeFileSync(process.env.T_ARGV + '.trust', opts[cur]); process.stdout.write('\\x1b[2J\\x1b[H  \\u23f5\\u23f5 bypass permissions on\\n'); } });
setTimeout(() => process.exit(0), 25000);
`);
fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\ncase "$*" in *TRUSTME*|*OTHERDIALOG*) exec "' + NODE + '" "' + path.join(BIN, 'dialog.mjs') + '" "$@";; esac\n/bin/pwd > "$T_ARGV.cwd"\n: > "$T_ARGV"\nfor a in "$@"; do printf \'%s\\0\' "$a" >> "$T_ARGV"; done\n/bin/sleep 25\n', { mode: 0o755 });
const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x));
// ── 起服务 ──
const logFile = path.join(ROOT, 'server.out'); const out = fs.openSync(logFile, 'w');
const env = { ...process.env, HOME: FH, CCBOARD_PORT: String(PORT), TMUX_TMPDIR: path.join(ROOT, 'tmux'), CCBOARD_STALL_MS: '3000', PATH: BIN + ':/usr/bin:/bin:/usr/sbin:/sbin', T_ARGV: ARGV };
delete env.CCBOARD_DATA; delete env.CCBOARD_READONLY;
// ── config.json：示例项目表（test/fixture-config.json），两个开关都打开。最后一段 [8] 换成写坏的 config 重启，看默认值 ──
const DATA0 = path.join(FH, 'Library/Application Support/cc-board'); fs.mkdirSync(DATA0, { recursive: true });
fs.writeFileSync(path.join(DATA0, 'config.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-config.json'), 'utf8')), autoTrust: true, codex: true }));
// ── 一个总控台起过的 Codex 会话：登记在 agents.json，tmux 里有它的窗格，记录是最小的两行（--ui 场景里不放：界面测试按卡数断言）──
const CDX = 'ccb-cdx001';
if (!process.argv.includes('--ui') && TMUX_BIN) {
  const rollout = path.join(FH, '.codex/sessions/2026/11/13/rollout-fixture.jsonl'); fs.mkdirSync(path.dirname(rollout), { recursive: true }); const t = new Date().toISOString();
  fs.writeFileSync(rollout, [{ type: 'response_item', timestamp: t, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex 夹具任务' }] } },
    { type: 'event_msg', timestamp: t, payload: { type: 'task_complete', last_agent_message: '夹具做完了' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(DATA0, 'agents.json'), JSON.stringify({ [CDX]: { cwd: CWD, at: Date.now(), prompt: 'Codex 夹具任务', sid: 'cdx-fixture', rollout } }));
  spawnSync(TMUX_BIN, ['-L', 'ccboard', 'new-session', '-d', '-s', CDX, '-x', '80', '-y', '20', '/bin/sleep', '600'], { env, stdio: 'ignore' });
}
const srv = spawn(NODE, [SERVER], { env, stdio: ['ignore', out, out] }); kids.push(srv.pid);
const DATA = path.join(FH, 'Library/Application Support/cc-board');
let TOKEN = '';
const get = async (p) => (await fetch('http://127.0.0.1:' + PORT + p, { headers: { 'x-ccboard': TOKEN } })).json();
const post = async (p, body) => { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };
const log = () => fs.readFileSync(logFile, 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const by = (st, name) => st.sessions.find((x) => x.sid === S[name].sid);
const kind = (st, name) => { const s = by(st, name); return s ? (s.alert ? s.alert.kind : null) : 'MISSING'; };

let ticker = null;
const hintTick = setInterval(() => { try { append('hint', R.tool(), R.result()); } catch {} }, 800);   // hint 这个会话从头到尾都在正常干活
try {
  for (let i = 0; i < 50; i++) { await sleep(200); try { TOKEN = fs.readFileSync(path.join(DATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json(); if (h.ok) { console.log('health', JSON.stringify(h).replace(FH, '<假主目录>')); break; } } catch {} }
  // 「在跑」的两个会话每 0.8 秒多一条记录（真在干活的样子）；stall 那个一条不加
  ticker = setInterval(() => { try { append('run', R.tool(), R.result()); append('compact', R.tool(), R.result()); } catch {} }, 800);
  await sleep(1600);
  if (process.argv.includes('--ui')) {
    process.kill(S.gone.pid, 'SIGTERM');                      // 让「进程退出」的卡片也出现
    fs.writeFileSync(path.join(HERE, '.tmp', 'ui-fixture.json'), JSON.stringify({ url: 'http://127.0.0.1:' + PORT + '/?k=' + TOKEN, pid: process.pid, sids: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.sid])) }));
    console.log('UI fixture ready pid=' + process.pid);
    await new Promise((resolve) => { process.on('SIGTERM', resolve); process.on('SIGINT', resolve); setTimeout(resolve, Number(process.env.T_UI_SECONDS || 600) * 1000); });
    throw new Error('ui-fixture-done');
  }
  let st = await get('/api/state');
  console.log('\n[1] 一开始的状态（alert 字段）');
  ok(st.sandbox === true, '试验场被认出来了（sandbox=true，不碰 Ghostty、不发通知）', 'sandbox=' + st.sandbox);
  ok(st.ghostty === false, 'Ghostty 没被碰');
  const want = { relimit: 'limit', bg: null, bgOpen: null, run: null, done: null, limit: 'limit', auth: 'auth', err: 'error', intr: 'interrupt', intrIdle: null, compact: null, unfin: 'unfinished', recover: null, gone: null, goneIdle: null };
  for (const [n, k] of Object.entries(want)) ok(kind(st, n) === k, `${n}: alert=${k}`, 'got ' + kind(st, n));
  ok(by(st, 'limit') && by(st, 'limit').alert && /weekly limit/.test(by(st, 'limit').alert.text), 'limit: 带着报错原文');
  ok(by(st, 'intr') && by(st, 'intr').prompt === '重构播放器', 'intr: 「你说的话」还是原来那句，不是打断标记', by(st, 'intr') && by(st, 'intr').prompt);
  ok(by(st, 'intrIdle') && by(st, 'intrIdle').prompt === '查一下日志' && by(st, 'intrIdle').done === true, 'intrIdle: 没在做事时的 Esc 不算停住，交付还在');
  ok(by(st, 'compact') && by(st, 'compact').prompt === '做发布片', 'compact: 压缩摘要没被当成你说的话', by(st, 'compact') && by(st, 'compact').prompt);
  ok(by(st, 'hint') && by(st, 'hint').prompt === '做个小工具', 'hint: 新任务后面附的那段说明不显示在「你说的话」里', by(st, 'hint') && by(st, 'hint').prompt);
  ok(by(st, 'recover') && by(st, 'recover').done === true && by(st, 'recover').result === '回归全过。', 'recover: 报错之后又做完了 = 正常交付');
  const pj = (n) => ((by(st, n) || {}).project || {});
  ok(pj('projF').key === 'fretflow' && pj('projF').name === 'FretFlow', 'project: 动过 fretflow-* 文件夹 = FretFlow（共用测试锁不算）', JSON.stringify(pj('projF')));
  ok(pj('projC').key === 'ccboard', 'project: 没动过文件时看他说的话（「给总控台加个按钮」）', JSON.stringify(pj('projC')));
  ok(pj('hint').key === 'other' && pj('done').key === 'other', 'project: 没有证据 = 其他；新任务附的说明里的「总控台」不算', JSON.stringify([pj('hint'), pj('done')]));
  const dg = (n) => (by(st, n) || {}).digest || {};
  ok(dg('done').need === 'review' && dg('done').head === '总结写好了。' && !dg('done').tag, 'digest: 普通交付 = 待审阅，一句结论取第一句', JSON.stringify(dg('done')));
  ok(dg('askQ').need === 'reply' && /你选哪个/.test(dg('askQ').ask || ''), 'digest: 问你选哪个 = 待跟进，要你做的事取那一句', JSON.stringify(dg('askQ')));
  ok(dg('askCond').need === 'review' && !dg('askCond').ask, 'digest: 「……的话，要不要我…？」是条件句，不算等你', JSON.stringify(dg('askCond')));
  ok(dg('peerDone').need === 'fyi' && by(st, 'peerDone').prompt === '做补丁', 'digest: 别的窗口发来的话开的这一轮 = 无需处理（交付是给它的，不是给你的）', JSON.stringify(dg('peerDone')));
  ok(dg('noneDone').need === 'fyi', 'digest: 写明「不需要你做什么」= 无需处理', JSON.stringify(dg('noneDone')));
  ok(dg('peerAsk').need === 'reply' && /要不要现在提审/.test(dg('peerAsk').ask || ''), 'digest: 别的窗口开的头、但确实要你本人决定 = 待跟进', JSON.stringify(dg('peerAsk')));
  ok(dg('askTag').need === 'reply' && dg('askTag').tag === true && dg('askTag').ask === '回 A 或 B，图在桌面' && !/【待跟进】/.test(by(st, 'askTag').result || '【待跟进】'), 'digest: 它自己写的【待跟进】以它为准，那一行从正文拿掉', JSON.stringify(dg('askTag')) + ' / ' + (by(st, 'askTag') || {}).result);
  // 正文里的路径点了（/api/open）：看的东西打开，能执行的只在访达里选中；试验场里只写日志、不真打开
  const OD = path.join(FH, 'Desktop', '资料 夹'); fs.mkdirSync(path.join(OD, 'Foo.app'), { recursive: true });
  fs.writeFileSync(path.join(OD, '讲解.html'), '<p>x</p>'); fs.writeFileSync(path.join(OD, 'run.sh'), 'echo hi'); fs.symlinkSync(path.join(OD, 'run.sh'), path.join(OD, 'pic.png'));
  const op = async (p) => (await post('/api/open', { path: p })).body;
  const o1 = await op('~/Desktop/资料 夹'), o2 = await op('file://' + encodeURI(path.join(OD, '讲解.html'))), o3 = await op(path.join(OD, 'run.sh')), o4 = await op(path.join(OD, 'Foo.app')), o5 = await op(path.join(OD, 'pic.png')), o6 = await op('~/Desktop/没有这个'), o7 = await op('Desktop/x');
  ok(o1.ok && o1.action === 'open' && o1.dry && o2.ok && o2.action === 'open', 'open: 文件夹（带空格和中文）、file:// 百分号编码的网页 → 直接打开（试验场里只记日志）', JSON.stringify([o1, o2]));
  ok(o3.action === 'reveal' && o4.action === 'reveal' && o5.action === 'reveal', 'open: 脚本、.app、伪装成 .png 的脚本符号链接 → 只在访达里选中', JSON.stringify([o3, o4, o5]));
  ok(!o6.ok && !o7.ok && /dry:open .*资料 夹/.test(log()) && !/dry:open .*run\.sh/.test(log()), 'open: 不存在的、不是完整路径的不动；日志里打开的只有该打开的', JSON.stringify([o6, o7]));
  const bad = await fetch('http://127.0.0.1:' + PORT + '/api/open', { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ path: OD }) });
  ok(bad.status === 403, 'open: Origin 不是总控台自己的页面 → 拒绝', String(bad.status));

  console.log('\n[2] 显示在运行、但一直没有新记录 → 可能卡住了（阈值调成 3 秒）');
  await sleep(4500); st = await get('/api/state');
  ok(kind(st, 'stall') === 'stall', 'stall: alert=stall', 'got ' + kind(st, 'stall') + ' quiet=' + (by(st, 'stall') || {}).quiet);
  ok(kind(st, 'run') === null && kind(st, 'compact') === null, '一直有新记录的两个不算卡住', kind(st, 'run') + ',' + kind(st, 'compact'));

  console.log('\n[3] 跑着跑着额度用完 → 提醒一次；这时没人看着界面 → 该发系统通知（试验场里只写日志）');
  clearInterval(ticker); ticker = setInterval(() => { try { append('compact', R.tool(), R.result()); } catch {} }, 800);
  append('run', R.apiErr('rate_limit', LIMIT)); setStatus('run', 'idle');
  await sleep(9500); st = await get('/api/state');
  ok(kind(st, 'run') === 'limit', 'run: 现在 alert=limit', 'got ' + kind(st, 'run'));
  ok(!log().split('\n').some((x) => x.startsWith('alert ') && /interrupt|unfinished|error/.test(x)), '启动时已经停着的那些，不补发通知（启动 15 秒后，日志里没有它们）', log().split('\n').filter((x) => x.startsWith('alert ')).join(' | '));
  const l3 = log().split('\n').filter((x) => x.startsWith('alert '));
  ok(l3.some((x) => / dry:sent /.test(x) && /limit/.test(x)), '日志：dry:sent …limit', l3.join(' | '));
  ok(l3.filter((x) => /limit/.test(x)).length === 1, '同一件事只提醒一次', l3.join(' | '));
  const k0 = by(st, 'run').alert.key, r0 = by(st, 'relimit').alert.key;
  ok(r0 === 'limit@' + JSON.parse(fs.readFileSync(S.relimit.file, 'utf8').split('\n')[2]).timestamp, 'relimit: 连着报两次错，记的是第一次的时间', r0);
  append('run', R.notif(), R.apiErr('rate_limit', LIMIT + ' (again)')); setStatus('run', 'busy'); await sleep(1500); setStatus('run', 'idle');     // 被后台通知叫醒 → 又报同样的错
  await sleep(8500); st = await get('/api/state');
  ok(by(st, 'run').alert && by(st, 'run').alert.key === k0 && /again/.test(by(st, 'run').alert.text), '额度没恢复时被叫醒又报错：还是同一次停住（key 不变，原文更新）', JSON.stringify(by(st, 'run').alert));
  ok(log().split('\n').filter((x) => x.startsWith('alert ') && /limit/.test(x)).length === 1, '……也不再提醒第二遍', log().split('\n').filter((x) => x.startsWith('alert ')).join(' | '));

  console.log('\n[3b] 做到一半你按了 Esc → 卡片上标出来，但不发系统通知');
  clearInterval(ticker); ticker = null; append('compact', R.interrupt()); setStatus('compact', 'idle');
  await sleep(13000); st = await get('/api/state');          // 通知要「站稳 4 秒 + 攒 2.5 秒」才发；机器忙时会更晚，所以等 13 秒再看日志
  ok(kind(st, 'compact') === 'interrupt', 'compact: alert=interrupt', 'got ' + kind(st, 'compact'));
  ok(!log().split('\n').some((x) => x.startsWith('alert ') && /interrupt/.test(x)), '日志里没有 interrupt 的通知', log().split('\n').filter((x) => x.startsWith('alert ')).join(' | '));
  append('compact', R.human('接着做'), R.tool(), R.result()); setStatus('compact', 'busy'); await sleep(1500);
  console.log('\n[4] 你正看着总控台（轮询带 f=1）时停住 → 不发系统通知，由界面提示');
  const focus = setInterval(() => get('/api/state?f=1').catch(() => {}), 700);
  append('compact', R.apiErr('authentication_failed', 'Login expired · Please run /login')); setStatus('compact', 'idle');
  await sleep(9500); clearInterval(focus); st = await get('/api/state');
  ok(kind(st, 'compact') === 'auth', 'compact: 现在 alert=auth', 'got ' + kind(st, 'compact'));
  const l4 = log().split('\n').filter((x) => x.startsWith('alert '));
  ok(l4.some((x) => / dry:ui /.test(x) && /auth/.test(x)), '日志：dry:ui …auth', l4.join(' | '));

  console.log('\n[4b] 「归档」一个按钮：总控台自己定删还是留');
  const tv1 = (await post('/api/archive', { sid: S.tidyChat.sid })).body, tv2 = (await post('/api/archive', { sid: S.tidyWork.sid })).body, tv3 = (await post('/api/archive', { sid: S.tidyAsk.sid })).body, tv4 = (await post('/api/archive', { sid: S.tidyUndo.sid })).body;
  ok(tv1.ok && tv1.keep === false && /只聊了几句/.test(tv1.why) && tv2.ok && tv2.keep === true && /改过 1 次文件/.test(tv2.why) && tv3.keep === true && /等你决定/.test(tv3.why) && tv4.keep === false, 'archive: 只聊几句 → 删；改过文件 → 留；在等你决定的 → 留', JSON.stringify([tv1, tv2, tv3, tv4]));
  await post('/api/unarchive', { sid: S.tidyUndo.sid });
  await sleep(9500); st = await get('/api/state'); const arc = await get('/api/archive');
  const delDir = path.join(DATA, 'deleted'); const delFiles = fs.existsSync(delDir) ? fs.readdirSync(delDir) : [];
  ok(!fs.existsSync(S.tidyChat.file) && delFiles.some((f) => f.includes(S.tidyChat.sid)) && (arc.dropped || []).some((x) => x.sid === S.tidyChat.sid && /只聊了几句/.test(x.why)) && !arc.items.some((x) => x.sid === S.tidyChat.sid), 'archive: 删掉的：对话挪进暂存处，归档列表「自动删掉的」里留一行', JSON.stringify({ dropped: arc.dropped, delFiles }));
  const tw = arc.items.find((x) => x.sid === S.tidyWork.sid), ta = arc.items.find((x) => x.sid === S.tidyAsk.sid);
  ok(tw && tw.state === 'archived' && tw.note && tw.note.head === '样式改好了。' && fs.existsSync(S.tidyWork.file) && ta && ta.note && /你选 A 还是 B/.test(ta.note.ask || ''), 'archive: 留着的：停掉、对话还在原处，记下了最后那句结论和要你做的事', JSON.stringify([tw, ta]));
  ok(by(st, 'tidyUndo') && fs.existsSync(S.tidyUndo.file), 'archive: 8 秒内撤销的照旧在墙上，没被删', String(!!by(st, 'tidyUndo')));

  console.log('\n[5] 做到一半进程没了 → 留一张卡；空闲时退出的不算');
  process.kill(S.gone.pid, 'SIGTERM'); process.kill(S.goneIdle.pid, 'SIGTERM');
  try { fs.unlinkSync(path.join(SESS, S.goneIdle.pid + '.json')); } catch {}     // 正常退出会删登记；gone 那个留着登记（像崩溃）
  await sleep(10500); st = await get('/api/state');
  ok(!by(st, 'gone') && !by(st, 'goneIdle'), '两张活卡片都没了');
  ok((st.lost || []).length === 1 && st.lost[0].sid === S.gone.sid && st.lost[0].prompt === '渲染视频', 'lost 里只有做到一半的那个', JSON.stringify(st.lost));
  ok(st.lost[0] && st.lost[0].project && st.lost[0].project.key === 'other', 'lost 的卡片也带项目（好放进对应的组）', JSON.stringify(st.lost[0] && st.lost[0].project));
  ok(log().split('\n').some((x) => x.startsWith('alert ') && /gone/.test(x)), '日志：…gone');
  const a1 = await post('/api/ack', { sid: S.gone.sid }); st = await get('/api/state');
  ok(a1.code === 200 && (st.lost || []).length === 0, '点「知道了」后卡片收起');
  const arch = JSON.parse(fs.readFileSync(path.join(DATA, 'archive.json'), 'utf8'));
  ok(arch.items[S.gone.sid] && arch.items[S.gone.sid].state === 'archived' && !arch.items[S.gone.sid].lost && arch.items[S.gone.sid].file === S.gone.file, '对话留在归档里，能恢复（记着对话记录的位置）');

  console.log('\n[6] 回它一句之后（新的一句话）→ 不再算停住');
  append('limit', R.human('继续'), R.tool()); setStatus('limit', 'busy');
  await sleep(2000); st = await get('/api/state');
  ok(kind(st, 'limit') === null && by(st, 'limit').prompt === '继续', 'limit: 回话后 alert 清掉');

  console.log('\n[7] 新任务不问放哪个文件夹：开在主目录，任务后面附一段让它自己找项目文件夹的说明');
  const readArgv = async () => { for (let i = 0; i < 40; i++) { await sleep(150); try { const cwd = fs.readFileSync(ARGV + '.cwd', 'utf8').trim(); const a = fs.readFileSync(ARGV, 'utf8'); await sleep(200); return { cwd, args: fs.readFileSync(ARGV, 'utf8').split('\0').filter((x, i2, all) => i2 < all.length - 1) }; } catch {} } return null; };
  const clearArgv = () => { for (const f of [ARGV, ARGV + '.cwd']) { try { fs.unlinkSync(f); } catch {} } };
  const real = (x) => fs.realpathSync(x);
  let n1 = await post('/api/new', { prompt: '做个小工具', cwd: '~', provider: 'claude', model: 'opus', effort: 'low' }); let got = await readArgv();
  ok(n1.body.ok && got && got.args.slice(0, 4).join(' ') === '--model opus --effort low', '带着你选的模型和强度启动', JSON.stringify(n1.body) + ' ' + JSON.stringify(got && got.args.slice(0, 4)));
  const t1 = got ? got.args[got.args.length - 1] : '';
  ok(t1.startsWith('做个小工具\n\n<system-reminder>') && /~\/Projects/.test(t1) && /不想被问/.test(t1) && t1.trimEnd().endsWith('</system-reminder>'), '任务原话在前，后面附着「自己找项目文件夹、没有就新建、别问」', t1.slice(0, 80));
  ok(got && real(got.cwd) === real(FH), '开在主目录', got && got.cwd);
  await sleep(5500); st = await get('/api/state');
  ok((st.pending || []).some((x) => x.prompt === '做个小工具'), '「启动中」的卡片上只显示你说的那一句', JSON.stringify((st.pending || []).map((x) => x.prompt)));
  clearArgv(); n1 = await post('/api/new', { prompt: '在这里做', cwd: CWD, provider: 'claude' }); got = await readArgv();
  ok(got && got.args.length === 1 && got.args[0] === '在这里做' && real(got.cwd) === real(CWD), '接口上明确给了文件夹的：就在那里做，不附说明', JSON.stringify(got));
  clearArgv(); n1 = await post('/api/new', { prompt: '', cwd: '~', provider: 'claude' }); got = await readArgv();
  ok(got && got.args.length === 0, '空会话：什么都不附', JSON.stringify(got));

  console.log('\n[7b] 在某一列的列头开新任务：任务说明换成「属于这个项目」，新卡落进那一列，记住是哪一列');
  const pinsFile = path.join(DATA, 'pins.json'), pinsNow = () => { try { return JSON.parse(fs.readFileSync(pinsFile, 'utf8')); } catch { return {}; } };
  clearArgv(); n1 = await post('/api/new', { prompt: '列里开的任务', cwd: '~', provider: 'claude', project: { key: 'fretflow', name: '随便写的名字' } }); got = await readArgv();
  const t7 = got ? got.args[got.args.length - 1] : '';
  ok(n1.body.ok && t7.startsWith('列里开的任务\n\n<system-reminder>') && /「FretFlow」那一列/.test(t7) && !/不想被问/.test(t7), '附的是「属于 FretFlow」，项目名按服务自己的项目表（不信界面传的名字）', t7.slice(0, 120));
  ok(pinsNow()[n1.body.name] && pinsNow()[n1.body.name].key === 'fretflow', '记进 pins.json（服务重启后还认得）', JSON.stringify(pinsNow()));
  await sleep(5500); st = await get('/api/state');
  const pend7 = (st.pending || []).find((x) => x.name === n1.body.name);
  ok(pend7 && pend7.project && pend7.project.key === 'fretflow', '「启动中」的卡片已经在 FretFlow 那一列（还没动过任何文件）', JSON.stringify(pend7 && pend7.project));
  clearArgv(); n1 = await post('/api/new', { prompt: '自成一组的列', cwd: '~', provider: 'claude', project: { key: 'dir:tone-lab', name: 'Tone-Lab' } }); got = await readArgv();
  ok(got && /以「Tone-Lab」开头/.test(got.args[got.args.length - 1]) && pinsNow()[n1.body.name] && pinsNow()[n1.body.name].key === 'dir:tone-lab', '没登记的文件夹组：说明里写出文件夹名', got && got.args[got.args.length - 1].slice(0, 120));
  for (const bad of [{ key: 'other', name: '其他' }, { key: 'dir:x', name: '<b>x' }, { key: 'dir:x', name: 'y' }, { key: 'nope', name: 'nope' }, 'fretflow']) {
    clearArgv(); n1 = await post('/api/new', { prompt: '核不过的列', cwd: '~', provider: 'claude', project: bad }); got = await readArgv();
    ok(n1.body.ok && got && /不想被问/.test(got.args[got.args.length - 1]) && !pinsNow()[n1.body.name], '核不过的列（' + JSON.stringify(bad) + '）当成右上角开的：照旧让它自己找，不记', got && got.args[got.args.length - 1].slice(-60));
  }

  console.log('\n[7c] 开工前的「信任这个文件夹」替他点掉；别的选择框不碰');
  const trustFile = ARGV + '.trust', trustNow = () => { try { return fs.readFileSync(trustFile, 'utf8'); } catch { return null; } };
  try { fs.unlinkSync(trustFile); } catch {}
  n1 = await post('/api/new', { prompt: 'TRUSTME 做点事', cwd: '~', provider: 'claude' });
  let tr7 = null; for (let i = 0; i < 40 && !tr7; i++) { await sleep(250); tr7 = trustNow(); }
  ok(tr7 === 'Yes, I trust this folder', '光标从「No, exit」挪到「Yes, I trust this folder」再回车', String(tr7));
  ok(/trust .* ccb-\w+ yes/.test(log()), '服务日志里记了一笔', log().split('\n').filter((l) => l.startsWith('trust')).join(' | '));
  try { fs.unlinkSync(trustFile); } catch {}
  n1 = await post('/api/new', { prompt: 'OTHERDIALOG 做点事', cwd: '~', provider: 'claude' });
  await sleep(6000); st = await get('/api/state');
  const pend7c = (st.pending || []).find((x) => x.name === n1.body.name);
  ok(trustNow() === null && pend7c && pend7c.dialog && pend7c.dialog.options[0] === 'Use this API key', '不是信任框：一个键都不按，卡片上照旧给他选', JSON.stringify(pend7c && pend7c.dialog));
  try { fs.unlinkSync(trustFile); } catch {}
  n1 = await post('/api/new', { prompt: 'TRUSTME 在别的文件夹', cwd: CWD, provider: 'claude' });
  await sleep(6000); st = await get('/api/state');
  const pend7e = (st.pending || []).find((x) => x.name === n1.body.name);
  ok(trustNow() === null && pend7e && pend7e.dialog && pend7e.dialog.options[1] === 'Yes, I trust this folder', '开在主目录以外的文件夹：信任框不替他点，留在卡片上', JSON.stringify(pend7e && pend7e.dialog));

  console.log('\n[7d] config 里 codex 打开：总控台起过的 Codex 会话照常上墙，「交给谁」里有 Codex');
  st = await get('/api/state');
  ok(st.sessions.some((x) => x.provider === 'codex' && x.tmux === CDX && x.prompt === 'Codex 夹具任务'), 'Codex 会话在墙上', JSON.stringify(st.sessions.filter((x) => x.provider === 'codex').map((x) => x.tmux)));
  ok(!!(st.providers && st.providers.codex), '「交给谁」里有 Codex', JSON.stringify(Object.keys(st.providers || {})));
  // 模型名故意写坏：过了 Codex 开关那一关，在起进程之前被拦下。不能真起：服务用登录 shell 找 codex，开发机上找得到真的
  n1 = await post('/api/new', { prompt: '用 Codex 做', cwd: '~', provider: 'codex', model: 'bad model!' });
  ok(!n1.body.ok && /写法不对/.test(n1.body.error || ''), '选 Codex：过了开关，走到核对模型名那一步', JSON.stringify(n1.body));

  console.log('\n[8] config.json 写坏了：照常起来、记一行日志、用默认值（空项目表；自动点信任和 Codex 都关着）');
  process.kill(srv.pid, 'SIGTERM');
  for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + PORT + '/health'); } catch { break; } }
  fs.writeFileSync(path.join(DATA, 'config.json'), '{ 写坏了');
  const log2File = path.join(ROOT, 'server2.out'); const out2 = fs.openSync(log2File, 'w');
  const srv2 = spawn(NODE, [SERVER], { env, stdio: ['ignore', out2, out2] }); kids.push(srv2.pid);
  let up = false; for (let i = 0; i < 50 && !up; i++) { await sleep(200); try { up = (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).ok === true; } catch {} }
  const cfgLines = () => fs.readFileSync(log2File, 'utf8').split('\n').filter((l) => l.startsWith('config '));
  ok(up && cfgLines().length === 1 && /读不了/.test(cfgLines()[0]), '写坏的 config：服务照常起来，日志里只有一行说明', cfgLines().join(' | '));
  await sleep(3000); st = await get('/api/state');
  ok(st.providers && !st.providers.codex && !st.sessions.some((x) => x.provider === 'codex') && !(st.pending || []).some((x) => x.name === CDX), 'codex 关着：「交给谁」里没有 Codex；Codex 会话不上墙，也不当成「启动中」', JSON.stringify({ prov: Object.keys(st.providers || {}), codex: st.sessions.filter((x) => x.provider === 'codex').length, pend: (st.pending || []).map((x) => x.name) }));
  n1 = await post('/api/new', { prompt: '用 Codex 做', cwd: '~', provider: 'codex', model: 'bad model!' });
  ok(!n1.body.ok && /Codex 没有打开/.test(n1.body.error || ''), 'codex 关着：接口拒绝开 Codex 会话（在核对模型名之前）', JSON.stringify(n1.body));
  const pj8 = (n) => ((by(st, n) || {}).project || {});
  ok(pj8('projC').key === 'other' && /^dir:fretflow/.test(pj8('projF').key || ''), '默认项目表是空的：登记过的组名不再出现，碰过的文件夹自成一组', JSON.stringify([pj8('projC'), pj8('projF')]));
  try { fs.unlinkSync(trustFile); } catch {}
  n1 = await post('/api/new', { prompt: 'TRUSTME 关着', cwd: '~', provider: 'claude' });
  await sleep(6000); st = await get('/api/state');
  const pend8 = (st.pending || []).find((x) => x.name === n1.body.name);
  ok(trustNow() === null && pend8 && pend8.dialog && pend8.dialog.options[1] === 'Yes, I trust this folder', 'autoTrust 关着：信任框留在「启动中」卡片上给他选', JSON.stringify(pend8 && pend8.dialog));
} catch (e) { if (e.message !== 'ui-fixture-done') throw e; } finally {
  try { if (TMUX_BIN) spawnSync(TMUX_BIN, ['-L', 'ccboard', 'kill-server'], { env, stdio: 'ignore' }); } catch {}      // 只关这次测试自己那个 tmux（它在自己的临时目录里）
  if (ticker) clearInterval(ticker); clearInterval(hintTick);
  if (KEEP) { console.log('\nKEEP url=http://127.0.0.1:' + PORT + '/?k=' + TOKEN + ' root=' + ROOT + ' pids=' + kids.join(',')); }
  else { for (const p of kids) { try { process.kill(p, 'SIGTERM'); } catch {} } await sleep(300); fs.rmSync(ROOT, { recursive: true, force: true }); }
}
console.log(`\n结果：${pass} 过，${fail} 没过`);
process.exit(fail ? 1 : 0);
