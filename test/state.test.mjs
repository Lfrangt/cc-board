/**
 * [INPUT]: [4p] 用 node:http2 起本机假 APNs，以独立 P-256 公钥验签；用 CCBOARD_IDLE_FILE 切换空闲值。依赖 ../server.mjs（或命令行给的另一份，比如 mutants.mjs 造的改坏版）；依赖 /bin/sleep 充当「会话进程」
 * [OUTPUT]: 逐项打印 ok / FAIL，[4p] 输出假 APNs 接线、空闲放行与日志限流、墙钟；退出码 0 = 全过；带 --ui 时不跑断言，搭好场景并写 ui-fixture.json 给 ui-check.mjs 用
 * [POS]: test/ 的服务端测试：30 个假会话覆盖 运行中 / 后台在跑 / 交付 / 额度用完 / 登录过期 / 报错 / 被打断 / 没做完 / 卡住 / 进程退出 / 交付摘要 / 项目分组 / 点开正文里的路径 / 内置预览（/api/preview 和预览端口：网页、PDF、图、音视频、文本，含 Esc 转发脚本）/ 「归档」自己定删还是留；
 *        另测英文摘要状态标签（`--ui` 不放）。
 *        再加 11 个自动收工（autoTidy）用的会话（`--ui` 不放）：到线的收、没到线 / 待跟进 / 在跑 / 后台命令还在跑 / 有 alert 的不收，他正看着时不收，只读预览只记不动。
 *        架构视图（谁归谁管）：在现有会话上补关系（别的窗口发来的消息、spawn.json、点名总管的文件；`--ui` 也有，卡片不变），再加 6 个专测认发信人的会话（`--ui` 不放）；
 *        [7h] 用真的 lsof 认出用子进程 curl 调 /api/new 的是这个测试进程（它临时登记成一个会话）。场景见 test/CLAUDE.md「架构场景」。
 *        [7m] 独立账号夹具核归档保留原号、默认号和缺 token 时不接回。
 *        [1f] 按轮次和已扫描字节验证逐笔补丁、安全门、截断、重启与只读读取。
 *        [1d] 这一轮改了哪些文件（wrote / wroteMore）和撞车提示（collide）：另造 21 个会话（`--ui` 不放），假主目录里放几个假仓库（.git 文件夹、worktree 的 .git 文件、没有 .git 的、主目录自己的 .git）。
 *        [7r] 新开的会话一开就退了（撞上 claude 自动更新）：假 claude 按 argv.flaky 先退几次（马上退 / 0.4 秒后退），服务要看出来、重新找 claude、换名字重开一次；接回归档一样；两次都退报「一开就退了」。
 *        [3p]「审完了」跨设备（11/18）：另起一份服务（T_PORT + 250）、5 个刚交付【待审阅】的会话，两个「页面」各拿各的 v 读 /api/state 的 processed；重启读回 processed.json、文件写坏当空表。[10] 末尾两项核远程端口也带。
 *        完全隔离：假的主目录、自己的端口、自己的 tmux 目录，服务因此自认是试验场（不碰 Ghostty、不发系统通知）。收尾只按记下的进程号停。
 *        历任持久化、防 PID 复用，以及短暂套接字故障、真退出裁剪、启动日志恢复均走主服务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
// 用法：node test/state.test.mjs [server.mjs 的路径] [--ui]      端口用 T_PORT 改（默认 4761）
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process'; import crypto from 'node:crypto'; import http2 from 'node:http2';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../server.mjs')); const KEEP = process.argv.includes('--keep');
const PORT = Number(process.env.T_PORT || 4761);
fs.mkdirSync(path.join(HERE, '.tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, '.tmp', 'run-'));
const FH = path.join(ROOT, 'home'); const SESS = path.join(FH, '.claude/sessions'); const CWD = path.join(FH, 'work');
const PROJ = path.join(FH, '.claude/projects', CWD.replace(/[^A-Za-z0-9]/g, '-'));
for (const d of [SESS, PROJ, CWD]) fs.mkdirSync(d, { recursive: true });
const TMUXDIR = fs.mkdtempSync('/tmp/ccb-tmux-');
// 这次测试的 tmux 一律用 -S 绝对套接字（被测服务经 CCBOARD_TMUX_SOCKET 用同一个）。不用 -L ccboard：TMUX_TMPDIR 那个目录一旦被别人删了，
// tmux -L 会退回默认目录 /tmp/tmux-<uid>/ccboard，也就是线上那台，收尾的 kill-server 就把全部真窗口带走（11/16 两次）。-S 目录不在只报错
const TSOCK = path.join(TMUXDIR, 'ccboard.sock'), TM = ['-S', TSOCK];
// 每个窗口一台 tmux（P0-0）：被测服务新开的窗口住在 <TSOCK 所在目录>/tmux/<会话名>.sock（老窗口照旧在 TSOCK）。测试碰它们一律 ...TMW(名字)，同样是 -S 绝对路径
const WD = path.join(TMUXDIR, 'tmux'), sockW = (n) => path.join(WD, n + '.sock'), TMW = (n) => ['-S', sockW(n)];
// [7r] 关到一半：测试自己备的套接字（不是窗口的）用 ...TMS(路径)，只认直接放在这次的 TMUXDIR 下的，别处一律抛错
const TMS = (s) => { if (path.dirname(s) !== TMUXDIR) throw new Error('TMS 只认 ' + TMUXDIR + ' 下的套接字：' + s); return ['-S', s]; };
// 自检：这个文件里每一处起 tmux 的 spawnSync 都必须先带 ...TM、...TMW(名字) 或 ...TMS(TMUXDIR 下的路径)（漏写一个就会顺着继承来的 $TMUX 或默认目录走）
{ const me = fs.readFileSync(new URL(import.meta.url), 'utf8'); const bad = me.split('\n').filter((l) => l.includes('spawnSync(TMUX_BIN, [') && !l.includes('spawnSync(TMUX_BIN, [...TM,') && !l.includes('spawnSync(TMUX_BIN, [...TMW(') && !l.includes('spawnSync(TMUX_BIN, [...TMS(')); if (bad.length) { console.error('ABORT：有 tmux 调用没带 -S 套接字：\n' + bad.join('\n')); process.exit(2); } }      // 短路径：tmux 的套接字路径不能超过约 104 字节；放进仓库里的 .tmp，仓库一克隆到深目录就整批失败
const NODE = process.execPath; const kids = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = Date.now() - 600000; const ts = () => new Date((T += 1500)).toISOString();
const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x));
const BIN = path.join(ROOT, 'bin'), ARGV = path.join(ROOT, 'argv');      // 假的 claude 等命令放在 BIN；假 claude 把收到的参数写进 ARGV
// 这次测试自己的 tmux。第一个起 tmux 的客户端定了 tmux 服务的全局环境，之后服务开的会话（假 claude）都从这里继承：
// 所以和下面服务用的 env 一样带上 HOME、PATH（只有 BIN 里的假命令）、T_ARGV。hint 开在 tmux 里以后，第一个起 tmux 的是这里
// 无头调用默认 TERM=dumb，tmux attach 会直接退出；测试客户端显式声明终端能力。
const TENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'TMUX' && k !== 'TMUX_PANE')), HOME: FH, TERM: 'xterm-256color', TMUX_TMPDIR: TMUXDIR, PATH: BIN + ':/usr/bin:/bin:/usr/sbin:/sbin', T_ARGV: ARGV, CCBOARD_TMUX_SOCKET: TSOCK, CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '424242', CCBOARD_DATA: path.join(FH, 'Library/Application Support/cc-board') };   // 后三个：故意带着，和线上 App 一样脏（见 [7] 的「子会话标记」那条）

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
  // 别的窗口发来的消息，照真实记录的样子：origin 里有发信进程号（verifiedPeerPid）和它当时的名字。from 是夹具里的会话名，或 { pid, name } 直接给
  peerFrom: (from, text, atMs) => { const o = typeof from === 'string' ? { pid: S[from].pid, name: S[from].reg || 'w-' + from } : from;
    return { type: 'user', message: { role: 'user', content: 'Another Claude session sent a message: ' + text }, origin: { kind: 'peer', ...(o.pid ? { from: 'uds:/tmp/cc-socks/' + o.pid + '.sock', verifiedPeerPid: o.pid } : {}), msg_id: 'pm' + ++mid, name: o.name, body: text },
      isMeta: true, timestamp: new Date(atMs).toISOString() }; },
};
// 给一条 assistant 记录盖上模型和强度：真记录里 model 在 message 里，effort 在最外层（Claude Code 2.1.x）
const as = (rec, model, effort) => { rec.message.model = model; if (effort !== undefined) rec.effort = effort; return rec; };
// 给一条 assistant 记录盖上 usage（上下文多大 = 三项相加）
const use = (rec, input, read, create) => { rec.message.usage = { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 7 }; return rec; };
const LIMIT = "You've hit your weekly limit · resets 11am (America/Los_Angeles)";
const S = {};   // 名字 → {sid, pid, file, reg, tmux, at}
// 开的时间：每个会话固定一个，按 mk 的先后每个晚 1 秒（11/15 以前是每次 setStatus 都写成「现在 - 1 小时」）。架构视图按开的先后认现任 / 前任，要稳定
const BASE = Date.now() - 3600000; let nMk = 0;
// reg：会话登记里的名字（真实窗口是 win-a5 这种）；给了 reg 就在记录开头补一条 ai-title，卡片标题照旧是 w-<名字>（界面测试按标题认卡）
// tmux：进程开在这次测试自己的 tmux 窗格里（服务认得出它的 tmux 名，spawn.json 按 tmux 名记谁开的）；at：开的时间（毫秒），不给按先后排
function mk(name, status, recs, { statusAgo = 60000, claude = false, reg = null, tmux = null, at = null } = {}) {
  // claude: 进程命令行里带 claude-fake（服务只肯停命令行里带 claude 的进程，归档测试要它真停得掉）
  let pid = 0, child = null;
  if (tmux && TMUX_BIN) {
    spawnSync(TMUX_BIN, [...TM, 'new-session', '-d', '-s', tmux, '-x', '80', '-y', '20', '/bin/sleep', '900'], { env: TENV, stdio: 'ignore' });
    pid = Number(spawnSync(TMUX_BIN, [...TM, 'list-panes', '-t', tmux, '-F', '#{pane_pid}'], { env: TENV, encoding: 'utf8' }).stdout.trim()) || 0;
  }
  if (!pid) { child = claude ? spawn(NODE, ['-e', 'setInterval(() => {}, 1e6)', 'claude-fake'], { stdio: 'ignore' }) : spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(child.pid); pid = child.pid; tmux = null; }
  const sid = name.padEnd(8, '0') + '-0000-4000-8000-' + String(pid).padStart(12, '0');
  const file = path.join(PROJ, sid + '.jsonl');
  fs.writeFileSync(file, (reg ? [{ type: 'ai-title', aiTitle: 'w-' + name, sessionId: sid }, ...recs] : recs).map((r) => JSON.stringify(r)).join('\n') + '\n');
  S[name] = { sid, pid, file, child, reg, tmux, at: at === null ? BASE + 1000 * nMk++ : at };
  setStatus(name, status, statusAgo);
}
function setStatus(name, status, ago = 0) {
  const s = S[name];
  fs.writeFileSync(path.join(SESS, s.pid + '.json'), JSON.stringify({ pid: s.pid, sessionId: s.sid, cwd: CWD, startedAt: s.at, kind: 'interactive', entrypoint: 'cli',
    name: s.reg || 'w-' + name, nameSource: 'derived', status, statusUpdatedAt: Date.now() - ago, updatedAt: Date.now() - ago }));
}
// 在第 at 条原始记录前面插几条（at 按 mk 时给的记录数算，不算开头补的 ai-title）；recAt 取第 i 条原始记录的时间（毫秒）
const recLines = (name) => fs.readFileSync(S[name].file, 'utf8').split('\n').filter(Boolean);
function insertRecs(name, at, recs) { const ls = recLines(name); ls.splice(at + (S[name].reg ? 1 : 0), 0, ...recs.map((r) => JSON.stringify(r))); fs.writeFileSync(S[name].file, ls.join('\n') + '\n'); }
const recAt = (name, i) => Date.parse(JSON.parse(recLines(name)[i + (S[name].reg ? 1 : 0)]).timestamp);
const append = (name, ...recs) => fs.appendFileSync(S[name].file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

mk('run', 'busy', [R.human('跑测试'), R.tool(), R.result(), R.note('我先看一下目录。')]);
mk('done', 'idle', [R.human('写个总结'), R.tool(), R.result(), use(as(R.note('先理一下。'), 'claude-opus-5-5', 'high'), 100, 2000, 300), use(as(R.final('总结写好了。'), 'claude-fable-5-2', 'max'), 5, 40000, 1200),
  { ...use(as(R.final('子任务说完了。'), 'claude-haiku-5-5', 'low'), 999999, 0, 0), isSidechain: true }]);   // 模型和强度只认主线上最近一条真回复：子 agent 的不算；上下文同理（41205，子 agent 的 999999 不算）
mk('limit', 'idle', [R.human('改首页'), R.tool(), R.result(), use(as(R.note('改到一半。'), 'claude-opus-5-5', 'xhigh'), 1000, 5000, 1000), use(R.apiErr('rate_limit', LIMIT), 999, 0, 0)]);   // 上下文 7000：后面那条额度报错（<synthetic>）带的 usage 不算
mk('auth', 'idle', [R.human('部署一下'), as(R.tool(), 'claude-sonnet-4-5-20250929', 'Max; rm -rf'), R.apiErr('authentication_failed', 'Login expired · Please run /login')]);   // 老模型没有强度；强度写得不像一个词就当没有
mk('err', 'idle', [R.human('读这份文档'), R.apiErr('invalid_request', 'Prompt is too long · the request is ~205181 tokens (limit 200000)')]);
// 安全检查拦下：原文照 11/13 本机真实记录（error=invalid_request、stop_reason=refusal、model=<synthetic>），两个模型只差模型名和最后一个链接
const FLAG = (model, link) => "API Error: " + model + "'s safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. Claude Code can't respond to this message with " + model + ".\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nSend feedback with /feedback or learn more: https://support.claude.com/en/articles/" + link + "\n\nDetails: `[reasoning_extraction]`\n\nRequest ID: req_test01\n\nMessage ID: msg_test01";
mk('flag', 'idle', [R.human('整理这份报告'), R.tool(), R.apiErr('invalid_request', FLAG('Opus 5.5', '8106465'), 'refusal')]);
if (!process.argv.includes('--ui')) mk('flagFable', 'idle', [R.human('写个脚本'), R.apiErr('invalid_request', FLAG('Fable 5.2', '15363606'), 'refusal')]);   // 界面测试按卡数断言，只放 Opus 那张
mk('intr', 'idle', [R.human('重构播放器'), R.tool(), R.result(), R.interrupt()]);
mk('intrIdle', 'idle', [R.human('查一下日志'), R.final('日志里没有报错。'), R.interrupt()]);
mk('compact', 'busy', [R.human('做发布片'), R.tool(), R.result(), R.compact(), R.tool()]);
mk('unfin', 'idle', [R.human('修那个缺陷'), R.note('我看一下。'), as(R.tool(), 'claude-sonnet-5-5', 'medium'), R.result()]);   // 窄卡里胶囊最长的真实组合：Sonnet · medium（15 个字符）；11/15 线上 Sonnet · xhigh 被截断，夹具里没有这么长的才没测出来
mk('recover', 'idle', [{ type: 'repl-mode', replMode: true }, R.human('跑回归'), R.tool(), R.apiErr('rate_limit', LIMIT), R.notif(), R.tool(), R.result(), as(R.final('回归全过。'), 'claude-opus-5-5', 'xhigh')]);   // Code Mode 窗口（11/17）：卡片的模型胶囊前面多一段「Code」（`--ui` 也有，界面测试用它）
mk('relimit', 'idle', [R.human('整理素材'), R.tool(), R.apiErr('rate_limit', LIMIT), R.notif(), R.apiErr('rate_limit', LIMIT)]);
mk('hint', 'busy', [R.human('做个小工具\n\n<system-reminder>这条任务是从总控台新建的，工作目录是主目录。</system-reminder>'), R.tool()], { tmux: 'ccb-hint01' });   // 开在 tmux 里：架构场景里它是负责人 peerDone 开出来的（spawn.json）
mk('bg', 'shell', [R.human('跑一遍回归'), R.tool(), R.result(), R.final('回归在后台跑，跑完我再报。')]);
mk('bgOpen', 'shell', [R.human('拍一组图'), R.note('我放到后台拍。'), R.tool(), R.result()]);
mk('stall', 'busy', [R.human('等一个网页'), R.tool('mcp__browser__wait')]);
mk('gone', 'busy', [R.human('渲染视频'), R.tool()]);
mk('goneIdle', 'idle', [R.human('问个问题'), R.final('答完了。')]);
// 交付摘要：问你选哪个 = 待跟进；「……的话告诉我」是条件句、不算；它自己写在最后一行的【待跟进】以它为准，那一行不进正文
mk('askQ', 'idle', [R.human('出个方案'), R.tool(), R.result(), R.final('方案写好了，在桌面。\n\n两个方向：A 稳，B 快。你选哪个？')], { reg: '总指挥 · 前任（win-q1）' });   // 架构场景：前任负责人
mk('askCond', 'idle', [R.human('换成下拉菜单'), R.tool(), R.result(), R.final('改好了，已上线。\n\n预览在 http://127.0.0.1:4791/?k=abc 。\n\n开出来的不是 Opus 的话，要不要我再查一遍？')]);
mk('peerDone', 'idle', [R.human('做补丁'), R.tool(), R.result(), R.final('补丁交了，等验收。'), R.peer('win-f2', '验收通过，请合入'), R.tool(), R.result(), R.final('已合入，回归在后台跑。')], { reg: 'FretFlow 总指挥（win-p2）' });   // 架构场景：现任负责人
mk('noneDone', 'idle', [R.human('继续'), R.final('好，继续做。提审照旧等你明说，其余不需要你做什么。')]);
mk('peerAsk', 'idle', [R.peer('win-46', '候选干净了'), R.final('候选的回归全过了。提审要你本人点，要不要现在提审？')]);
// 按项目分组：动过的文件夹定项目（共用的测试锁不算）；没动过文件时看他说的话；新任务附的说明里的「总控台」不算
mk('projF', 'idle', [R.human('改一下首页'), R.toolAt('/Users/x/Projects/fretflow-ui/app/page.tsx'), R.result(), R.toolAt('/Users/x/Projects/fretflow/ios/A.swift'), R.result(),
  R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.toolAt('/Users/x/Projects/shared/fretflow-lock/heavy-lock.py'), R.result(), R.final('首页改好了。')]);
mk('projC', 'idle', [R.human('给总控台加个按钮'), R.final('按钮加好了。')]);
// 「归档」一个按钮：没留下东西的删掉，其余留着并记一笔（11/13 作者）
mk('tidyChat', 'idle', [R.human('问个小问题'), R.final('答完了。')], { claude: true });
mk('tidyWork', 'idle', [R.human('改一下样式'), R.tool('Edit'), R.result(), R.final('样式改好了。')], { claude: true });
mk('tidyAsk', 'idle', [R.human('出个主意'), R.final('想了两个方向。\n\n你选 A 还是 B？')], { claude: true });
mk('tidyUndo', 'idle', [R.human('随便问问'), R.final('好。')], { claude: true });
// 自动收工（autoTidy）：门槛在下面的 env 里调成 快线 3 秒 / fyi 1 小时 / review 2 小时。aged() 把记录和登记都挪到很久以前，好让它们到点
const H = 3600000;
const aged = (ms, recs) => recs.map((r, i) => ({ ...r, timestamp: new Date(Date.now() - ms + i * 1500).toISOString() }));
if (!process.argv.includes('--ui')) {      // 界面测试按卡数断言，这些卡不放进去
mk('atFyi', 'idle', aged(2 * H, [R.peer('win-f2', '补丁验收过了'), R.tool('Edit'), R.result(), R.final('补丁已合入。T-DONE')]), { statusAgo: 2 * H, claude: true });          // fyi 超 1 小时、小模型说做完了 → 收；改过文件 → 留
mk('atRev', 'idle', aged(3 * H, [R.human('问个问题'), R.final('答完了。T-DONE')]), { statusAgo: 3 * H, claude: true });                                              // 待审阅超 2 小时没点、小模型说做完了 → 收；只聊几句 → 删
mk('atFyiNew', 'idle', aged(H / 2, [R.peer('win-f2', '验收过了'), R.tool('Edit'), R.result(), R.final('已合入。')]), { statusAgo: H / 2, claude: true });          // fyi 才半小时 → 不收（只读预览里会标「会收」）
mk('atRevNew', 'idle', aged(1.5 * H, [R.human('改样式'), R.tool('Edit'), R.result(), R.final('样式改好了。T-DONE')]), { statusAgo: 1.5 * H, claude: true });              // 待审阅 1.5 小时：过了 fyi 的线、没到 review 的线 → 不收
mk('atAsk', 'idle', aged(5 * H, [R.human('出个主意'), R.final('想了两个方向。T-DONE\n\n你选 A 还是 B？')]), { statusAgo: 5 * H, claude: true });                    // 待跟进放多久都不收
mk('atBusy', 'busy', aged(5 * H, [R.human('跑一下'), R.tool(), R.result(), R.note('我先看看。')]), { statusAgo: 5 * H, claude: true });                            // 在跑的不收
mk('atShell', 'shell', aged(5 * H, [R.peer('win-f2', '验收过了'), R.tool('Edit'), R.result(), R.final('已合入，回归在后台跑。T-DONE')]), { statusAgo: 5 * H, claude: true });   // 放到后台的命令还在跑：不收
mk('atHalt', 'idle', aged(5 * H, [R.human('跑回归'), R.final('回归全过。T-DONE'), R.notif(), R.apiErr('rate_limit', LIMIT)]), { statusAgo: 5 * H, claude: true });      // 交付了、又被后台通知叫醒撞上额度：有 alert 的不收
mk('atFastHead', 'idle', [R.human('改一下设计稿'), R.tool('Edit'), R.result(), R.final('设计稿改好了。')], { claude: true, reg: 'FretFlow 设计负责人（win-g9）' });   // 待审阅、点了「审完了」= fast 线该收，但它是分支负责人：不收（11/17 win-49；fast 线和 smart 线一样要挡住）
mk('atFast', 'idle', [R.human('改一下标题'), R.tool('Edit'), R.result(), R.final('标题改好了。T-DONE')], { claude: true });                // 点「审完了」后安静 3 秒、小模型说做完了 → 收
mk('atFocus', 'idle', [R.human('改一下页脚'), R.tool('Edit'), R.result(), R.final('页脚改好了。T-DONE')], { claude: true });               // 同上，但他正看着总控台时先不收
mk('atStale', 'idle', [R.human('改一下配色'), R.tool('Edit'), R.result(), R.final('配色改好了。T-DONE')], { claude: true });               // 点的是上一次交付的「审完了」→ 不算
// 它自己还有后续的不收（11/17 car5，作者：「不能在归档的时候，就把该做的直接自动收工了」）。T- 记号给假判断命令看（T-DONE 做完了 / T-WAIT 在等 / T-YOURS 要你定 / T-EXIT 命令失败），和 [4d] 的 J- 记号分开计数
mk('atFyiWait', 'idle', aged(2 * H, [R.peer('win-f2', '先停在断点'), R.tool('Edit'), R.result(), R.final('停在断点，等总指挥叫我再合。T-WAIT')]), { statusAgo: 2 * H, claude: true });   // fyi 超 1 小时，但它在等别的窗口 → 不收
mk('atRevWait', 'idle', aged(3 * H, [R.human('定个时间'), R.tool('Edit'), R.result(), R.final('定了明早 08:04 的一次性定时，到点我自己做。T-WAIT')]), { statusAgo: 3 * H, claude: true });   // 待审阅超 2 小时没点，但它说明早自己还要做 → 不收
mk('atFastWait', 'idle', [R.human('排一下'), R.tool('Edit'), R.result(), R.final('下一版上架后我来展开任务单。T-WAIT')], { claude: true });   // 点了「审完了」，但它自己还有后续 → 不收（一个总管窗口就是这样被误收过）
mk('atFastYours', 'idle', [R.human('出两版'), R.tool('Edit'), R.result(), R.final('两版都好了，你选哪个？T-YOURS')], { claude: true });   // 点了「审完了」，但小模型说交付里还有要他定的事 → 不收（只有明说做完了才收）
mk('atFastExit', 'idle', [R.human('改个字'), R.tool('Edit'), R.result(), R.final('字改好了。T-EXIT')], { claude: true });   // 点了「审完了」，小模型命令失败 → 拿不准就不收
mk('atOwed', 'idle', aged(2 * H, [R.human('删目录那步'), R.tool('Edit'), R.result(), R.final('定了明早 08:04 的定时，到点我自己做。T-WAIT')]), { statusAgo: 2 * H, claude: true });    // 先判 waiting；之后回别的窗口一句「收到」（T-DONE），带着之前欠着的再问 → 还是 waiting，不收
mk('atOwed2', 'idle', aged(2 * H, [R.human('删目录那步'), R.tool('Edit'), R.result(), R.final('定了明早 08:05 的定时，到点我自己做。T-WAIT')]), { statusAgo: 2 * H, claude: true });   // 同上，但之后那次交付说做完了（T-SETTLED）→ done，收；欠着的清掉
mk('atParent', 'idle', aged(2 * H, [R.peer('win-f2', '开个窗口去跑'), R.tool('Edit'), R.result(), R.final('开了 atKid 去跑。T-DONE')]), { statusAgo: 2 * H, claude: true });   // fyi 超 1 小时、交付说做完了，但它开的 atKid 还在墙上跑 → 不收、也不问
// 收之前看一眼（tidyJudge）：fyi 安静半小时 = 过了 smart 线（15 分钟）、没到 fyi 线（1 小时）。假的判断命令按正文里的记号答（见下面 BIN/judge）
const jfx = (mark) => aged(H / 2, [R.peer('win-f2', '合入吧'), R.tool('Edit'), R.result(), R.final('补丁已合入。' + mark)]);
mk('jDone', 'idle', jfx('J-DONE'), { statusAgo: H / 2, claude: true });     // 做完了 → 走 smart 线收；改过文件 → 留
mk('jHead', 'idle', jfx('J-DONE'), { statusAgo: H / 2, claude: true, reg: 'FretFlow 运营负责人（win-g7）' });   // 和 jDone 一样该收，但它是分支负责人：不收、不问小模型（11/17 win-49：smart 线也不能收岗位上的窗口）。不用「推广」：和 orgHead 同一条分支，会把其中一个变成前任
mk('jWait', 'idle', jfx('J-WAIT'), { statusAgo: H / 2, claude: true });     // 在等别人 → 照旧等满 fyi 线
mk('jYours', 'idle', jfx('J-YOURS'), { statusAgo: H / 2, claude: true });   // 还有要你定的事 → 不收，卡片改成待跟进
mk('jBad', 'idle', jfx('J-BAD'), { statusAgo: H / 2, claude: true });       // 答非所问 → 判不出来，照旧等
mk('jExit', 'idle', jfx('J-EXIT'), { statusAgo: H / 2, claude: true });     // 命令失败 → 同上
mk('atKid', 'busy', [R.human('跑一下'), R.tool()], { tmux: 'ccb-atkid1' });   // atParent 开的窗口（spawn.json），还在跑
}
// 正文里的本机路径（界面测试核它们变成可点的链接）
mk('links', 'idle', [R.human('整理资料'), R.final('资料在这里：\n\n- 文件夹 ~/Desktop/示例_封面/\n- `~/Library/Application Support/cc-board`\n- [讲解页](file:///Users/khalil/Desktop/x%20y.html)\n- 网址 https://example.com')], { reg: '总管 · Ops Assistant（win-zz）' });   // 架构场景：名字里带「总管」、但比点名的总管晚开 → 普通窗口；点名的文件坏了时按字样认它当总管
mk('askTag', 'idle', [R.human('出两版首页'), R.tool(), R.result(), R.final('两版都做好了。\n\n做了什么：出了两版首页\n【待跟进】回 A 或 B，图在桌面')]);
if (!process.argv.includes('--ui')) {
  mk('engAsk', 'idle', [R.human('Prepare two drafts'), R.final('The drafts are ready.\n\n[Needs you] Pick a draft')]);
  mk('engReview', 'idle', [R.human('Prepare a report'), R.final('I need your input on the earlier draft.\n\n**[REVIEW]**: The final report is ready')]);
  mk('engFyi', 'idle', [R.human('Send a progress update'), R.final('I need your input on the earlier draft.\n\n[FYI] The preview built successfully')]);
  mk('engGuess', 'idle', [R.human('Prepare two drafts'), R.final('Both drafts are ready. I need your approval to continue.')]);
  mk('engNone', 'idle', [R.human('Send a progress update'), R.final('The preview built successfully. No reply is required.')]);
  mk('engQuestion', 'idle', [R.human('Prepare two drafts'), R.final('Both drafts are ready. Which option works best?')]);
}

// [7s] 总控台保温（11/20 win-99）：KW_MARK 开头的那一轮整轮不算（`--ui` 不放：界面测试按卡数断言）。
// kwCard：交付挂着【待审阅】，之后来了一轮保温、它回了一个点 → 卡片上的话、交付、交付时间都不变，上下文取保温那一条的。
// kwTool：保温那一轮它还是调了工具，之后别的窗口发来一条 → 保温那一轮的工具不算步数，别的窗口那一轮照常交付。
// kwMid（11/21 1b 审查 M4）：保温那句插在一轮中间（工具跑完、还没收尾）→ 不认成保温，后面的收尾照常算那一轮的交付，不被吞掉。
const KW_SAMPLE = '【总控台保温】（不是 Khalil 本人，也不是别的窗口）只为续上缓存：只回一个点「·」';
if (!process.argv.includes('--ui')) {
mk('kwCard', 'idle', [R.human('出一份报告'), use(R.final('报告写好了。\n\n【待审阅】报告在桌面'), 3, 120000, 2000), R.human(KW_SAMPLE), use(R.final('·'), 2, 122000, 900)]);
mk('kwTool', 'idle', [R.human('查额度'), R.final('查完了。\n\n【待跟进】要你登录'), R.human('  ' + KW_SAMPLE), R.tool(), R.result(), R.final('·'), R.peer('win-zz', '查一下 X'), R.final('X 查完了。')]);
mk('kwMid', 'idle', [R.human('改一个文件'), R.tool(), R.result(), R.human(KW_SAMPLE), R.final('改好了。\n\n【待审阅】改动在沙盒里')]);
}
// 架构视图（谁归谁管）专用的几个会话（`--ui` 不放：界面测试按卡数断言）。认发信人的规则：先按进程号（还得在那条消息之前就开了），再按名字且唯一
if (!process.argv.includes('--ui')) {
mk('orgLate', 'idle', [R.human('后开的窗口'), R.final('好。')], { at: Date.now() });                   // 它的进程号和 orgRecv 收到的两条消息对得上，但开得比消息晚：不能认成它
mk('orgRen', 'idle', [R.human('设计线'), R.final('好。')], { reg: '设计线（win-r5）' });              // 发信时叫 win-r5、进程已经换了：按名字认（登记名包含它）
mk('orgDupA', 'idle', [R.human('重名 A'), R.final('好。')], { reg: 'win-0b' });                     // 两个窗口都叫 win-0b：重名的不认
mk('orgDupB', 'idle', [R.human('重名 B'), R.final('好。')], { reg: 'win-0b' });
mk('orgRecv', 'idle', [R.human('收消息'), R.final('收到。')]);
mk('orgHum', 'idle', Array.from({ length: 6 }, (_, i) => [R.human('第 ' + (i + 1) + ' 轮'), R.final('好。')]).flat());   // 负责人发来 3 条，但他本人最近说了 6 轮：他自己带着
mk('orgOld', 'idle', [R.human('接着做'), R.final('好。')]);
mk('orgHead', 'idle', [R.human('拉新'), R.final('好。')], { reg: 'FretFlow 推广负责人（win-g4）' });
// 「<话题>分支」（11/17 win-49）：标题（ai-title）以「…分支」结尾、在给 orgBrW 发消息的 orgBr 是分支；「car3 合并分支」是 git 用语，同样发了消息也不是；orgBrW 只收过分支 1 条 → 挂到分支（via contact）
mk('orgBr', 'idle', [{ type: 'ai-title', aiTitle: '字体与排版分支' }, R.human('导入平台'), R.final('好。')], { reg: 'win-g5' });
mk('orgGit', 'idle', [{ type: 'ai-title', aiTitle: 'car3 合并分支' }, R.human('合补丁'), R.final('好。')], { reg: 'win-g6' });
mk('orgBrW', 'idle', [R.human('补跑'), R.final('好。')]);   // 分支负责人（11/17）：和负责人 peerDone 同一个项目，挂在它下面，不是它的前任         // 听的是一个已经不在的前任总指挥（进程没了，改过一次名）：跟着岗位归现任 peerDone，handed
}
// ── 这一轮改了哪些文件（wrote / wroteMore）和撞车提示（collide）专用的会话（`--ui` 不放：界面测试按卡数断言）──
// 假主目录里造仓库：repoW / repoT / repoP / repoM / repoC / repoS / repoD1 / repoD2（.git 是文件夹），repoC/wt（.git 是文件 = worktree，自己算一个仓库），norepo（没有 .git）；
// 主目录本身也放一个 .git 文件夹：主目录和更上层不算仓库，norepo 里的写不能被认成「主目录这个仓库」。都是人开的一轮、交付过（待审阅），自动收工的线（2 小时）碰不到
const PJ = (...xs) => path.join(FH, 'Projects', ...xs);
const X = (name, input) => ({ type: 'assistant', message: { id: 'm' + ++mid, model: 'claude-x', content: [{ type: 'tool_use', id: 'tu' + mid, name, input }], stop_reason: 'tool_use' }, timestamp: ts() });
const W = (name, file) => X(name, name === 'NotebookEdit' ? { notebook_path: file, new_source: 'x' } : { file_path: file, old_string: 'a', new_string: 'b' });   // 改文件的一次调用
if (!process.argv.includes('--ui')) {
  for (const r of ['repoW', 'repoT', 'repoP', 'repoM', 'repoC', 'repoS', 'repoD1', 'repoD2', 'repoX']) fs.mkdirSync(PJ(r, '.git'), { recursive: true });
  fs.mkdirSync(PJ('repoC', 'wt', 'src'), { recursive: true }); fs.writeFileSync(PJ('repoC', 'wt', '.git'), 'gitdir: ' + PJ('repoC', '.git', 'worktrees', 'wt') + '\n');
  fs.mkdirSync(PJ('norepo'), { recursive: true }); fs.mkdirSync(path.join(FH, '.git'), { recursive: true });
  // wFiles：上一轮改过 old.js；这一轮 a.js 改 3 次（Edit、MultiEdit、Edit），中间 Write b.md、NotebookEdit n.ipynb；Read / Grep / Bash 里的写都不算
  mk('wFiles', 'idle', [R.human('上一轮'), W('Edit', PJ('repoW', 'old.js')), R.result(), R.final('上一轮改好了。'),
    R.human('这一轮'), W('Edit', PJ('repoW', 'src', 'a.js')), R.result(), W('MultiEdit', PJ('repoW', 'src', 'a.js')), R.result(), W('Write', PJ('repoW', 'b.md')), R.result(),
    R.toolAt(PJ('repoW', 'c.js')), R.result(), X('Grep', { pattern: 'x', path: PJ('repoW', 'src') }), R.result(), X('Bash', { command: 'echo hi > ' + PJ('repoW', 'd.txt') }), R.result(),
    W('NotebookEdit', PJ('repoW', 'n.ipynb')), R.result(), W('Edit', PJ('repoW', 'src', 'a.js')), R.result(), R.final('这一轮改好了。')]);
  mk('wTurn', 'idle', [R.human('改 x'), W('Edit', PJ('repoT', 'x.js')), R.result(), R.final('x 改好了。')]);          // 交付以后照旧列着；[1d] 里再追加后台通知、新的一轮
  // wPeer：一轮做到一半别的窗口发来消息（这一轮还没收尾）→ 不是新的一轮，p1 照旧算；[1d] 里交付之后它再发一条 = 新的一轮
  mk('wPeer', 'idle', [R.human('改 p1'), W('Edit', PJ('repoP', 'p1.js')), R.result(), R.peer('win-w7', '顺手把 p2 也改了'), W('Write', PJ('repoP', 'p2.js')), R.result(), R.final('p1、p2 都改好了。')]);
  // wMany：25 个文件各写一次，f07 之后又改两次 → 列 20 个（f07 ×3 在最前，其余最近写的在前），多出来 5 个
  const fN = (i) => PJ('repoM', 'f' + String(i).padStart(2, '0') + '.txt');
  mk('wMany', 'idle', [R.human('批量生成'), ...Array.from({ length: 25 }, (_, i) => W('Write', fN(i + 1))), W('Edit', fN(7)), W('Edit', fN(7)), R.final('25 个都生成了。')]);
  // 撞车：cA、cB 都往 repoC 里写（刚才）；cOld 45 分钟前也写过 repoC（过了 30 分钟的线）；cW1、cW2 写的是 repoC 里面的 worktree（自己一个仓库，不算 repoC）
  mk('cA', 'idle', [R.human('改 one'), W('Edit', PJ('repoC', 'src', 'one.js')), R.result(), R.final('one 改好了。')]);
  mk('cB', 'idle', [R.human('写 two'), W('Write', PJ('repoC', 'two.md')), R.result(), R.final('two 写好了。')]);
  mk('cOld', 'idle', aged(0.75 * H, [R.human('改 three'), W('Edit', PJ('repoC', 'three.js')), R.result(), R.final('three 改好了。')]), { statusAgo: 0.75 * H });
  mk('cW1', 'idle', [R.human('worktree 里改 a'), W('Edit', PJ('repoC', 'wt', 'src', 'a.js')), R.result(), R.final('a 改好了。')]);
  mk('cW2', 'idle', [R.human('worktree 里写 b'), W('Write', PJ('repoC', 'wt', 'b.js')), R.result(), R.final('b 写好了。')]);
  mk('cSelf', 'idle', [R.human('改两个文件'), W('Edit', PJ('repoS', 'a.js')), R.result(), W('Edit', PJ('repoS', 'b.js')), R.result(), R.final('两个都改好了。')]);   // 同一个会话写两次：不撞自己
  mk('cD1', 'idle', [R.human('改 D1'), W('Edit', PJ('repoD1', 'x.js')), R.result(), R.final('D1 改好了。')]);   // 不同的仓库：不撞
  mk('cD2', 'idle', [R.human('改 D2'), W('Edit', PJ('repoD2', 'x.js')), R.result(), R.final('D2 改好了。')]);
  mk('cN1', 'idle', [R.human('写笔记 a'), W('Write', PJ('norepo', 'a.txt')), R.result(), R.final('a 写好了。')]);   // 不在任何仓库里（主目录的 .git 不算）：不撞
  mk('cN2', 'idle', [R.human('写笔记 b'), W('Write', PJ('norepo', 'b.txt')), R.result(), R.final('b 写好了。')]);
  mk('cX', 'idle', [R.human('改 repoX'), W('Edit', PJ('repoX', 'claude.js')), R.result(), R.final('repoX 改好了。')]);   // 和下面那个 Codex 会话撞在 repoX：Claude、Codex 两边的写放在一起比
  // wKeep：这一轮里压缩了一次对话、最后被打断——都不是新的一轮，单子不清。k1、k2 各写两次，k1 最后又写了一次 → k1 在前（按最后一次写排，不按第一次）；子 agent（isSidechain）的写不算
  mk('wKeep', 'idle', [R.human('改 k'), W('Edit', PJ('repoK', 'k1.js')), R.result(), W('Edit', PJ('repoK', 'k2.js')), R.result(), W('Edit', PJ('repoK', 'k2.js')), R.result(), R.compact(),
    W('Edit', PJ('repoK', 'k1.js')), R.result(), { ...W('Edit', PJ('repoK', 'k3.js')), isSidechain: true }, R.interrupt()]);
  // Bash 里的写（只进撞车，不进 wrote）：bA 用 cd 仓库 && git，提交说明里写着「; cd repoE && git commit」也不能当成命令；bB 不带路径的 git merge，靠这条记录的 cwd（真实记录每条都带 cwd）
  // bR 在 repoB 里只读：git status / log、echo 引号里的 >、heredoc 正文里的 git commit 和 > 重定向 → 都不算写；bE1 cp 进 repoE，bE2 tee -a 和 heredoc 的 cat > 写进 repoE
  for (const r of ['repoB', 'repoE']) fs.mkdirSync(PJ(r, '.git'), { recursive: true });
  const B = (command, cwd) => { const r = X('Bash', { command, description: 'x' }); if (cwd) r.cwd = cwd; return r; };
  mk('bA', 'idle', [R.human('提交'), B('cd ' + PJ('repoB') + ' && git add -A && git commit -m "fix; cd ' + PJ('repoE') + ' && git commit -am x"', CWD), R.result(), R.final('提交好了。')]);
  mk('bB', 'idle', [R.human('合并'), B('git merge feature --no-edit', PJ('repoB')), R.result(), R.final('合并好了。')]);
  mk('bR', 'idle', [R.human('看看'), B('cd ' + PJ('repoB') + ' && git status && git log --oneline | head -3; echo "x > ' + PJ('repoB', 'y.txt') + '"', CWD), R.result(),
    B("cat <<'EOF'\ngit commit -am x\necho hi > " + PJ('repoB', 'z.txt') + '\nEOF', PJ('repoB')), R.result(), R.final('看完了。')]);
  mk('bE1', 'idle', [R.human('拷文件'), B('cp -R /tmp/a.txt ' + PJ('repoE') + '/', CWD), R.result(), R.final('拷好了。')]);
  mk('bE2', 'idle', [R.human('记日志'), B('printf x | tee -a ' + PJ('repoE', 'log.txt') + ' >/dev/null && cat > ' + PJ('repoE', 'notes.md') + " <<'EOF'\n# notes\nEOF", CWD), R.result(), R.final('记好了。')]);
}
// 界面测试（`--ui`）用：不加卡，只在现有的卡里补写文件的记录。写在主目录下的 code/，而且写成 ~/code/… ：假主目录本身在 ~/Projects/cc-board… 里，
// 写成绝对路径的话 projects.mjs 的 roots() 会在路径里认出 /Projects/cc-board-wip，把这几张卡分进总控台那一列（11/16 第一趟整套 9 条按列的断言因此变红）。服务按主目录展开 ~/
// askCond（待审阅）：这一轮写了 code/site 里 23 个文件（app.js 改 3 次）→ 列 20 个、wroteMore 3；run（在跑）和 tidyWork（待审阅，2 个文件）都写 code/demo → 两张卡各一行撞车提示
if (process.argv.includes('--ui')) {
  for (const r of ['demo', 'site']) fs.mkdirSync(path.join(FH, 'code', r, '.git'), { recursive: true });
  const CO = (...xs) => '~/' + ['code', ...xs].join('/');
  const dp = (tool, file, n, create = false) => {
    const call = W(tool, file), id = call.message.content[0].id;
    return [call, { type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '完成' }] },
      toolUseResult: create ? { type: 'create', content: 'first\nsecond\n', structuredPatch: [] } : { structuredPatch: [{ oldStart: n, oldLines: 2, newStart: n, newLines: 2, lines: [' context', '-old ' + n, '+' + (n === 2 ? '<img src=x onerror=alert(1)>' : 'new ' + n)] }] } }];
  };
  insertRecs('askCond', 3, [...dp('Edit', CO('site', 'app.js'), 1), ...Array.from({ length: 22 }, (_, i) => dp('Write', CO('site', 'pages', 'p' + String(i + 1).padStart(2, '0') + '.html'), i + 1, true)).flat(),
    ...dp('Edit', CO('site', 'app.js'), 2), ...dp('Edit', CO('site', 'app.js'), 3)]);
  fs.writeFileSync(path.join(FH, 'code/site/app.js'), '// file preview\n');
  insertRecs('tidyWork', 3, [W('Edit', CO('demo', 'ui.html')), R.result(), W('Write', CO('demo', 'test', 'ui-check.mjs')), R.result()]);
  insertRecs('run', 3, [W('Edit', CO('demo', 'server.mjs')), R.result()]);
}
// ── Code Mode（11/17）专用的会话（`--ui` 不放：界面测试按卡数断言；界面用的是 recover）──
// test/codemode.jsonl：一份真实 Code Mode 记录（Claude Code 2.1.327，三段脚本 + 一轮后台脚本 + 一轮不带工具）去掉内容后的样子，test/codemode-fixture.mjs 生成。
// @CM@ 换成假主目录里的 cm 文件夹；时间整体挪到 T 附近（先后、虚拟调用比前一条早几毫秒的那几处原样保留）。第 0–64 条 = 三段脚本做完、交付；第 0–59 条 = 第三段脚本跑完、还没交付
const CMDIR = path.join(FH, 'cm');
function cmRecs(from, to) {
  const L = fs.readFileSync(path.join(HERE, 'codemode.jsonl'), 'utf8').trim().split('\n').slice(from, to).map((l) => JSON.parse(l.split('@CM@').join(CMDIR)));
  const ts0 = L.filter((d) => d.timestamp).map((d) => Date.parse(d.timestamp)), shift = T + 1500 - Math.min(...ts0);
  for (const d of L) if (d.timestamp) d.timestamp = new Date(Date.parse(d.timestamp) + shift).toISOString();
  T = Math.max(...ts0) + shift; return L;
}
const RM = (on) => ({ type: 'repl-mode', replMode: on });
if (!process.argv.includes('--ui')) {
  mk('cmReal', 'idle', cmRecs(0, 65), { claude: true });         // 三段脚本：4 次模型调用（REPL ×3 + Poll）+ 15 次脚本里的工具（Write 新建、Edit、Write 覆盖）；交付了
  mk('cmBusy', 'busy', cmRecs(0, 60));                             // 同上，停在第三段脚本跑完、还没交付：卡片上的当前工具是第三段 REPL 的说明，不是 Poll、不是脚本里最后那个 Read
  const v = cmRecs(0, 81).filter((d) => d.isVirtual);              // 交付以后才写进来的一条虚拟调用（写的先后和时间的先后不一定一致）：卡片照旧是交付
  mk('cmLate', 'idle', [RM(true), R.human('看一下'), R.final('看过了，没问题。'), { ...v[4], timestamp: ts() }, { ...v[5], timestamp: ts() }]);
  mk('cmOff', 'idle', [RM(true), R.human('改个东西'), R.tool('Edit'), R.result(), RM(true), R.final('改好了。'), RM(false)], { claude: true });   // 中途在 Claude Code 里关掉：最后一条是 false
  mk('cmQuote', 'idle', [R.human('存一下设置'), X('mcp__x__save', { record: { type: 'repl-mode', replMode: true } }), R.result(), R.tool('Edit'), R.result(), R.final('存好了。')], { claude: true });   // 别的记录里嵌着一个 repl-mode 对象：不算
  mk('cmBad', 'idle', [RM(true), R.human('改'), R.tool('Edit'), R.result(), R.final('改好了。')], { claude: true });   // 是 Code Mode，但接回之前把记录改成读不了：落到「不带」
  // 下面三组是评审（11/17 23:5x）补的守卫。服务一块读 64 字节（env 的 CCBOARD_REPL_CHUNK），[7m] 的接回都走跨块那几步
  // cmEdge：最后一条 repl-mode（true）后面补一行（服务不认的类型，apply 跳过），这一行连换行共 54 字节 → 从文件尾往前第一个 64 字节的边界
  // 正好切在 repl-mode 那一行结尾前 10 字节处（「…"replMo|de":true}」）：前一块拿到的是半行，要接上后一块开头那半行才读得出 true
  mk('cmEdge', 'idle', [RM(true), R.human('改个东西'), R.tool('Edit'), R.result(), R.final('改好了。'), RM(true)], { claude: true });
  { const pad0 = JSON.stringify({ type: 'x-pad', p: '' }); fs.appendFileSync(S.cmEdge.file, JSON.stringify({ type: 'x-pad', p: 'x'.repeat(53 - pad0.length) }) + '\n'); }
  // cmNest：真的 repl-mode true 在前，后面一条工具调用的 input 里嵌着 { type: 'repl-mode', replMode: false }：嵌着的不算，仍是 Code Mode
  mk('cmNest', 'idle', [RM(true), R.human('存一下设置'), X('mcp__x__save', { record: { type: 'repl-mode', replMode: false } }), R.result(), R.tool('Edit'), R.result(), R.final('存好了。')], { claude: true });
  // vA：Code Mode 脚本里跑的 git commit（虚拟 Bash，照夹具里一条真的虚拟 Bash 改 input 和 cwd）；vB 普通 Edit 写同一个仓库 → 两边撞车
  fs.mkdirSync(PJ('repoV', '.git'), { recursive: true });
  const vb = JSON.parse(JSON.stringify(v.find((d) => d.type === 'assistant' && d.message.content[0].name === 'Bash')));
  vb.message.content[0].input = { command: 'cd ' + PJ('repoV') + ' && git add -A && git commit -m x' }; vb.cwd = CWD;
  mk('vA', 'idle', [RM(true), R.human('提交一下'), X('REPL', { code: 'await Bash({ command: "git commit" })', description: 'Commit' }), { ...vb, timestamp: ts() }, R.result(), R.final('提交好了。')]);
  mk('vB', 'idle', [R.human('改 repoV'), W('Edit', PJ('repoV', 'v.js')), R.result(), R.final('改好了。')]);
}
// 一个已经退出的进程的号：它发过的消息认不出是哪个活会话，服务把它做成 gone 项（'gone:<pid>'）
const DEAD_PID = spawnSync('/usr/bin/true').pid;
// 历任场景不加入 --ui 的卡片清单。进程真实退出，名字全部为示例。
const HIST_PID = spawnSync('/usr/bin/true').pid, REUSED_PID = spawnSync('/usr/bin/true').pid;
const HIST_AT = Date.now() - 3600000;
if (!process.argv.includes('--ui')) {
  for (const [name, pid] of [['histRecv', HIST_PID], ['histReuse', REUSED_PID], ['histTwin', HIST_PID + 1000000]]) {
    mk(name, 'idle', [R.human('示例任务'), ...[0, 1, 2].map((i) => R.peerFrom({ pid, name: 'win-x1' }, '示例派活', Date.now() - 120000 + i * 1000)), R.final('示例完成')]);
  }
  // 评审必改 2（11/19）：名单里的前任进程（HIST_PID）用过的名字 win-x7，墙上正好有一个登记名 win-x7 的活窗口 histX7。
  //   前任的消息只认名单上那个会话（不在墙上 → gone 项），不按名字算到 histX7 头上。
  mk('histX7', 'idle', [R.human('示例'), R.final('好')], { reg: 'win-x7' });
  mk('histDup', 'idle', [R.human('示例任务'), ...[0, 1, 2].map((i) => R.peerFrom({ pid: HIST_PID, name: 'win-x7' }, '示例派活', Date.now() - 110000 + i * 1000)), R.final('示例完成')]);
}
// ── 架构场景（`--ui` 也放，界面测试和之后的「架构」界面都用它）：只在现有会话的记录里补消息、在 tmux 名上记谁开的，卡片的标题、状态、交付都不变 ──
//   总管 = projC（config 的 org.chief 指向的文件点名，generation 3）；其他 这一组里：现任负责人 peerDone、前任 askQ（登记名带「总指挥」）；
//   hint 是 peerDone 开的（spawn）；unfin 收到 peerDone 3 条（msg）；intr 收到 unfin 3 条（下级的下级）；done 收到前任 askQ 3 条 → 跟着岗位挂到 peerDone；
//   run 正在跑，这一轮是 peerDone 发来的一条消息开的（for = peerDone），只有 1 条，不算上级；其余没有上级。
{
  const MIN = 60000, now = Date.now();
  insertRecs('done', 0, [0, 1, 2].map((i) => R.peerFrom('askQ', '前任派的活 ' + i, now - 50 * MIN + i * 30000)));
  const uh = recAt('unfin', 0);                                                    // unfin：一条在他开口之前（开了一轮），两条在这一轮里（每条都要算，不只算开了一轮的那条）
  insertRecs('unfin', 1, [R.peerFrom('peerDone', '再看一下边界', uh + 300), R.peerFrom('peerDone', '修完回我', uh + 600)]);
  insertRecs('unfin', 0, [R.peerFrom('peerDone', '修一下那个缺陷', now - 30 * MIN)]);
  insertRecs('intr', 0, [0, 1, 2].map((i) => R.peerFrom('unfin', '帮我查 ' + i, now - 20 * MIN + i * 30000)));
  const rr = recAt('run', 2);                                                      // run：上一轮被打断，之后 peerDone 发来一条，开了现在这一轮
  insertRecs('run', 3, [{ ...R.interrupt(), timestamp: new Date(rr + 200).toISOString() }, R.peerFrom('peerDone', '跑一下测试', rr + 400), { ...R.tool(), timestamp: new Date(rr + 600).toISOString() }, { ...R.result(), timestamp: new Date(rr + 800).toISOString() }]);
  if (S.orgRecv) {
    insertRecs('orgRecv', 0, [
      R.peerFrom({ pid: S.orgLate.pid, name: 'khalil-gone' }, '旧进程发的', now - 15 * MIN), R.peerFrom({ pid: S.orgLate.pid, name: 'khalil-gone' }, '旧进程发的 2', now - 15 * MIN + 1000),
      R.peerFrom({ name: 'win-r5' }, '改名前发的', now - 14 * MIN), R.peerFrom({ name: 'win-r5' }, '改名前发的 2', now - 14 * MIN + 1000),
      R.peerFrom({ name: 'win-0b' }, '重名的发的', now - 13 * MIN), R.peerFrom({ name: 'win-0b' }, '重名的发的 2', now - 13 * MIN + 1000)]);
    insertRecs('orgHum', 0, [0, 1, 2].map((i) => R.peerFrom('peerDone', '派活 ' + i, now - 5 * MIN + i * 1000)));
    insertRecs('orgBrW', 0, [R.peerFrom('orgGit', '合完了', now - 9 * MIN), R.peerFrom('orgBr', '补跑一下导入页', now - 8 * MIN)]);
    // orgOld：同一个已经退出的进程，先叫「总指挥（旧名）」发 1 条，改名后又发 2 条：合成一个 gone 项，3 条
    insertRecs('orgOld', 0, [R.peerFrom({ pid: DEAD_PID, name: '总指挥（旧名）' }, '先做这个', now - 40 * MIN),
      R.peerFrom({ pid: DEAD_PID, name: 'FretFlow 总指挥（win-x9）' }, '再做那个', now - 36 * MIN), R.peerFrom({ pid: DEAD_PID, name: 'FretFlow 总指挥（win-x9）' }, '做完回我', now - 35 * MIN)]);
  }
  // 正在跑的子 agent：run（在跑）的 subagents 文件夹里两份刚改过的记录 + 一份 5 分钟前的 + 一个 .meta.json → 2；done（歇着）里有一份刚改过的 → 歇着的不数，0
  const subOf = (n) => S[n].file.replace(/\.jsonl$/, '') + '/subagents';
  for (const [n, files] of [['run', ['agent-a1.jsonl', 'agent-a2.jsonl', 'agent-old.jsonl', 'agent-a1.meta.json']], ['done', ['agent-x.jsonl']]]) {
    fs.mkdirSync(subOf(n), { recursive: true }); for (const f of files) fs.writeFileSync(path.join(subOf(n), f), '{}\n');
  }
  const old = new Date(now - 5 * MIN); fs.utimesSync(path.join(subOf('run'), 'agent-old.jsonl'), old, old);
}
const SUBRUN = S.run.file.replace(/\.jsonl$/, '') + '/subagents';

// ── 假的 claude：记下收到的参数和所在的文件夹，然后睡着。服务的 PATH 里只有它，真的 claude 够不着 ──
fs.mkdirSync(BIN);
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
// 首次启动向导（有人 /logout、/login 以后新起的 claude 都先走一遍）：选主题 → Security notes → 终端设置 → 信任框。文字照 11/15 真 Claude Code 2.1.325 的屏幕。
// 任务里带 LOGINSCREEN 时停在「选登录方式」，什么键都不接（真的在这里回车会开始一次 OAuth 登录）。每个键记进 argv.keys：Enter / Esc / Down / Up。
// 终端设置那一屏回车不往下走（真的回车 = 改他的终端配置），只有 Esc 能往下；恢复归档（--resume）不带任务文字，默认就走完整向导。
fs.writeFileSync(path.join(BIN, 'onboard.mjs'), `import fs from 'node:fs';
let step = process.argv.slice(2).join(' ').includes('LOGINSCREEN') ? 'login' : 'theme', cur = 0;
const rec = (k) => fs.appendFileSync(process.env.T_ARGV + '.keys', k + '\\n');
const draw = () => {
  let s;
  if (step === 'theme') s = " Welcome to Claude Code v2.1.325\\n Let's get started.\\n Choose the text style that looks best with your terminal\\n To change this later, run /theme\\n     Auto (match terminal)\\n     Dark mode\\n \\u276f \\u2714 Light mode (colorblind-friendly)\\n";
  else if (step === 'security') s = " Security notes:\\n Claude can make mistakes.\\n You're responsible for Claude's actions.\\n Press Enter to continue\\u2026\\n";
  else if (step === 'term') s = " Use Claude Code's terminal setup?\\n For the optimal coding experience, enable the recommended settings\\n \\u276f Yes, use recommended settings\\n   No, maybe later with /terminal-setup\\n Enter to confirm \\u00b7 Esc to skip\\n";
  else if (step === 'login') s = " Claude Code can be used with your Claude subscription or billed based on API usage.\\n Select login method:\\n \\u276f 1. Claude account with subscription\\n   2. Anthropic Console account\\n   3. 3rd-party platform\\n";
  else s = " Accessing workspace:\\n " + process.cwd() + "\\n Quick safety check: Is this a project you created or one you trust?\\n" + ['No, exit', 'Yes, I trust this folder'].map((o, i) => (i === cur ? ' \\u276f ' : '   ') + o).join('\\n') + "\\n Enter to confirm \\u00b7 Esc to cancel\\n";
  process.stdout.write('\\x1b[2J\\x1b[H' + s);
};
process.stdin.setRawMode(true); process.stdin.resume(); draw();
process.stdin.on('data', (b) => { const k = b.toString();
  const name = k === '\\r' ? 'Enter' : k === '\\x1b' ? 'Esc' : k === '\\x1b[B' ? 'Down' : k === '\\x1b[A' ? 'Up' : '?'; rec(name);
  if (step === 'login') return;
  if (step === 'theme' && name === 'Enter') step = 'security';
  else if (step === 'security' && name === 'Enter') step = 'term';
  else if (step === 'term' && name === 'Esc') step = 'trust';
  else if (step === 'trust') {
    if (name === 'Down') cur = 1; else if (name === 'Up') cur = 0;
    else if (name === 'Enter') { fs.writeFileSync(process.env.T_ARGV + '.trust', cur ? 'Yes, I trust this folder' : 'No, exit'); process.stdout.write('\\x1b[2J\\x1b[H  \\u23f5\\u23f5 bypass permissions on\\n'); return; } }
  draw(); });
setTimeout(() => process.exit(0), 25000);
`);
// [7r] 一开就退：argv.flaky 在时（第一行还要退几次、第二行参数里要有的字、第三行退之前睡几秒），参数里带那个字的启动先退掉那么多次；认到的每次启动在 argv.flakyn 记 die / live。
// 第三行是 swap:<套接字> 时（11/19 关到一半）：把那个套接字改名盖到自己那台 tmux 的套接字上（$TMUX 第一段），在 argv.swapped 记「套接字 那台的进程号」，然后睡着不退（那台不杀，看护不会醒来收套接字）。
// 睡 0 = 马上退的那种（exec 就落空）；睡 0.4 = 晚一点退的那种（选了号的那层 zsh 先读钥匙串再 exec，has-session 早过了，会话 1 秒内才退）。放在 argv.all 和 argv.cm.XXXXXX 都记完之后：退掉的那次也算进 [9] 的逐次核对（参数白名单、核环境两份记录的次数要对得上；11/18 第一趟红放在 argv.cm 前面，核环境 51 对 46 红了）
const FLAKY_SH = 'if [ -s "$T_ARGV.flaky" ]; then { read fn; read fp; read fd; } < "$T_ARGV.flaky"; case "$*" in *"$fp"*) if [ "$fn" -gt 0 ]; then printf "%s\\n%s\\n%s\\n" $((fn-1)) "$fp" "$fd" > "$T_ARGV.flaky"; echo die >> "$T_ARGV.flakyn"; case "$fd" in 0) ;; swap:*) s=${TMUX%%,*}; p=${TMUX#*,}; p=${p%%,*}; /bin/mv -f "${fd#swap:}" "$s"; echo "$s $p" > "$T_ARGV.swapped"; exec /bin/sleep 30;; *) /bin/sleep "$fd";; esac; exit 1; fi; echo live >> "$T_ARGV.flakyn";; esac; fi\n';
// 第一行先把这次启动收到的全部参数追加进 argv.all（每个参数以 \0 结尾，一次启动以 \036\0 收尾）：[9]「不改脑子」按它逐次核对。放在最前面，下面 exec 去向导 / 信任框 / --resume 的也记得到
fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\0\' "$a" >> "$T_ARGV.all"; done; printf \'\\036\\0\' >> "$T_ARGV.all"\nf=$(/usr/bin/mktemp "$T_ARGV.cm.XXXXXX") && printf \'%s\\0\' "${CLAUDE_CODE_EXPERIMENTAL_CODE_MODE-unset}" "$@" > "$f"\n' + FLAKY_SH + 'case "$T_ARGV" in *resume-argv) printf "%s|%s" "$CLAUDE_CODE_OAUTH_TOKEN" "$CCBOARD_ACCOUNT" > "$T_ARGV.env";; esac\ncase "$*" in *ONBOARD*|*LOGINSCREEN*|*--resume*) exec "' + NODE + '" "' + path.join(BIN, 'onboard.mjs') + '" "$@";; esac\ncase "$*" in *TRUSTME*|*OTHERDIALOG*) exec "' + NODE + '" "' + path.join(BIN, 'dialog.mjs') + '" "$@";; esac\n/bin/pwd > "$T_ARGV.cwd"\nprintf "%s|%s" "$CLAUDE_CODE_OAUTH_TOKEN" "$CCBOARD_ACCOUNT" > "$T_ARGV.env"\n/usr/bin/env | /usr/bin/grep -E "^(CLAUDE|CCBOARD|TMUX=)" > "$T_ARGV.cenv"\nprintf "%s|%s|%s" "${CLAUDE_CODE_CHILD_SESSION-unset}" "${CLAUDE_PID-unset}" "${CCBOARD_DATA-unset}" > "$T_ARGV.child"\n: > "$T_ARGV"\nfor a in "$@"; do printf \'%s\\0\' "$a" >> "$T_ARGV"; done\ncase "$*" in *PW-*) /bin/sleep 90;; *) /bin/sleep 25;; esac\n', { mode: 0o755 });
// [7r] 重开前重新找 claude：服务用 zsh -lc 'command -v claude' 找。假主目录的 .zprofile 在 alt-claude-on 在时把 altbin 排到 PATH 最前面（像自动更新以后 claude 换了位置）；
// altbin/claude 在 argv.alt 记一行再原样交给 BIN/claude，所以服务之后一直缓存着它也不影响别的段
fs.mkdirSync(path.join(FH, 'altbin'), { recursive: true });
fs.writeFileSync(path.join(FH, 'altbin', 'claude'), '#!/bin/sh\necho alt >> "$T_ARGV.alt"\nexec "' + path.join(BIN, 'claude') + '" "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(FH, '.zprofile'), '[ -f "$HOME/alt-claude-on" ] && PATH="$HOME/altbin:$PATH"\n');
// 假的 security：钥匙串里只有 ccboard-account-good（token 是 tok-good）和 ccboard-account-spare（tok-spare，只有 [8c] 的 config 登记它）。服务和会话里那层 zsh 都经 CCBOARD_SECURITY 用它，真钥匙串碰不到
fs.writeFileSync(path.join(BIN, 'security'), '#!/bin/sh\nsvc=; w=0\nwhile [ $# -gt 0 ]; do case "$1" in -s) svc="$2"; shift;; -w) w=1;; esac; shift; done\ncase "$svc" in ccboard-account-good) t=tok-good;; ccboard-account-spare) t=tok-spare;; *) exit 44;; esac\n[ $w = 1 ] && echo $t\nexit 0\n', { mode: 0o755 });
// 假的判断命令（CCBOARD_JUDGE）：读 stdin，记下参数和收到的原文（J_LOG 一行一次），按原文里的记号答，格式和 claude -p --output-format json 一样
const JLOG = path.join(ROOT, 'judge.log');
fs.writeFileSync(path.join(BIN, 'judge.mjs'), `import fs from 'node:fs';
let input = ''; process.stdin.on('data', (b) => { input += b; }); process.stdin.on('end', () => {
  fs.appendFileSync(process.env.J_LOG, JSON.stringify({ argv: process.argv.slice(2), input, acct: process.env.CCBOARD_ACCOUNT || '', tok: process.env.CLAUDE_CODE_OAUTH_TOKEN || '' }) + '\\n');
  if (process.env.J_QUOTA) { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, terminal_reason: 'api_error', result: "You've hit your weekly limit · resets Jan 5 at 9am (America/Los_Angeles) · out of usage credits" })); process.exit(1); }
  if (input.includes('J-EXIT') || input.includes('T-EXIT')) { process.stderr.write('boom'); process.exit(3); }
  if (input.includes('<earlier_followup>') && !input.includes('T-SETTLED')) { process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ verdict: 'waiting', why: '之前的还欠着' }) })); return; }
  const v = input.includes('J-DONE') || input.includes('T-DONE') ? { verdict: 'done', why: '做完了' } : input.includes('J-YOURS') || input.includes('T-YOURS') ? { verdict: 'yours', ask: 'J 要你定：选 A 还是 B', why: '有事' } : { verdict: 'waiting', why: '在等' };
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: input.includes('J-BAD') ? '我觉得可以关' : JSON.stringify(v) }));
});
`);
fs.writeFileSync(path.join(BIN, 'judge'), '#!/bin/sh\nexec "' + NODE + '" "' + path.join(BIN, 'judge.mjs') + '" "$@"\n', { mode: 0o755 });
// 自动续跑的假判断命令（CCBOARD_AUTO_JUDGE）：只看 <next> 里的记号答（A-GO / A-YOURS / A-BAD，其余 wait；autojudge.log.force 里写着 go 时一律 go），每次调用在 autojudge.log 记一行
const AJLOG = path.join(ROOT, 'autojudge.log');
fs.writeFileSync(path.join(BIN, 'autojudge.mjs'), `import fs from 'node:fs';
let input = ''; process.stdin.on('data', (b) => { input += b; }); process.stdin.on('end', () => {
  fs.appendFileSync(process.env.AJ_LOG, JSON.stringify({ argv: process.argv.slice(2), input }) + '\\n');
  const next = (input.match(/<next>([\\s\\S]*)<\\/next>/) || [])[1] || '';
  let force = ''; try { force = fs.readFileSync(process.env.AJ_LOG + '.force', 'utf8').trim(); } catch {}   // 11/16 夜里的原句不带记号：夹具在这个文件里写 go，模拟那晚小模型说了 go
  const v = force === 'go' || next.includes('A-GO') ? { verdict: 'go', why: '顺理成章' } : next.includes('A-YOURS') ? { verdict: 'yours', ask: 'A 要你定：用哪个', why: '口味' } : { verdict: 'wait', why: '在等别人' };
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: next.includes('A-BAD') ? '我觉得可以' : JSON.stringify(v) }));
});
`);
fs.writeFileSync(path.join(BIN, 'autojudge'), '#!/bin/sh\nexec "' + NODE + '" "' + path.join(BIN, 'autojudge.mjs') + '" "$@"\n', { mode: 0o755 });
// 认调用方用的假 lsof / ps（只在 [8] 那份服务里用，CCBOARD_LSOF / CCBOARD_PS）：lsof 马上报一个进程号，ps 每次慢 0.3 秒、永远报「父进程是下一个号」，
// 不限时的话往上走 15 层要 4.5 秒以上。其余地方用真的 /usr/sbin/lsof 和 /bin/ps
fs.writeFileSync(path.join(BIN, 'lsof-fast'), '#!/bin/sh\nprintf "p100000\\nf3\\n"\n', { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'ps-slow'), '#!/bin/sh\n/bin/sleep 0.3\necho $(( $4 + 1 ))\n', { mode: 0o755 });
// ── 起服务 ──
const logFile = path.join(ROOT, 'server.out'); const out = fs.openSync(logFile, 'w');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['TMUX', 'TMUX_PANE', 'CCBOARD_APNS_URL', 'CCBOARD_APNS_KEY_FILE', 'CCBOARD_ACCOUNT', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(k))), CCBOARD_TMUX_SOCKET: TSOCK, CCBOARD_REMOTE_PORT: String(PORT + 50), CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '424242', HOME: FH, CCBOARD_PORT: String(PORT), TMUX_TMPDIR: TMUXDIR, CCBOARD_STALL_MS: '3000', CCBOARD_SUGGEST_MS: '800', CCBOARD_LIMITS_MS: '800', CCBOARD_TIDY_FAST_MS: '3000', CCBOARD_TIDY_FYI_MS: String(H), CCBOARD_TIDY_REVIEW_MS: String(2 * H), CCBOARD_TIDY_SMART_MS: String(H / 4), CCBOARD_JUDGE: path.join(BIN, 'judge'), J_LOG: JLOG, PATH: BIN + ':/usr/bin:/bin:/usr/sbin:/sbin', T_ARGV: ARGV, CCBOARD_SECURITY: path.join(BIN, 'security'), CCBOARD_CHIEF_MS: '1000', CCBOARD_PRUNE_MS: '6000', CCBOARD_REPL_CHUNK: '64',
  CCBOARD_AUTO_JUDGE: path.join(BIN, 'autojudge'), AJ_LOG: AJLOG, CCBOARD_AUTO_DELAY_MS: '3000', CCBOARD_AUTO_SETTLE_MS: '300', CCBOARD_AUTO_GAP_MS: '500', CCBOARD_AUTO_CFG_MS: '300',
  CCBOARD_KW_SANDBOX: '1', CCBOARD_KW_CFG_MS: '300',   // [7s-2] 保温真打字：这份试验服务用的是私有 -S 套接字（TSOCK），允许它真打；没设 CCBOARD_KW_SANDBOX 的试验服务只记 dry
  // 一起退出、全部接回（P0-0）：快照里的 log show 换成假命令；负载读这个文件；接回的间隔 2 秒、负载每 0.5 秒看一次、最多等 3 秒
  CCBOARD_LOGSHOW: path.join(BIN, 'logshow'), CCBOARD_LOADAVG_FILE: path.join(ROOT, 'loadavg'), CCBOARD_RESTORE_GAP_MS: '2000', CCBOARD_LOAD_POLL_MS: '500', CCBOARD_LOAD_WAIT_MS: '3000',
  CCBOARD_SETTLE_MS: '1000', CCBOARD_RESPAWN_MS: '500',          // [7r] 开完再看 1 秒站不站得住（线上 2 秒）；一开就退了等 0.5 秒再重开（线上 3 秒）
  CLAUDE_EFFORT: 'xhigh' };   // 和上面的 CLAUDE_CODE_CHILD_SESSION / CLAUDE_PID 一样故意带着：[7i] 断言每个窗口自己那台 tmux 里的新窗口也没有它们
fs.writeFileSync(path.join(ROOT, 'loadavg'), '1');
fs.writeFileSync(path.join(BIN, 'logshow'), '#!/bin/sh\nprintf "FAKE-LOG-SHOW %s\\n" "$*"\n', { mode: 0o755 });
// ── 会话的临时目录（CCBOARD_CLAUDE_TMP）：tidyChat 在两个工作目录编码下各一份（删掉时两份都清），tidyWork / done / 一个两小时前归档的旧会话各一份，再放一个名字不是会话号的目录 ──
const CTMP = path.join(ROOT, 'claude-tmp'); env.CCBOARD_CLAUDE_TMP = CTMP;
const OLD_SID = 'oldarch0-0000-4000-8000-000000000001';
const TMPF = { chatA: path.join(CTMP, '-work', S.tidyChat.sid), chatB: path.join(CTMP, '-other', S.tidyChat.sid), work: path.join(CTMP, '-work', S.tidyWork.sid), live: path.join(CTMP, '-work', S.done.sid), old: path.join(CTMP, '-work', OLD_SID), notes: path.join(CTMP, '-work', 'notes') };
for (const d of Object.values(TMPF)) { fs.mkdirSync(path.join(d, 'scratchpad'), { recursive: true }); fs.writeFileSync(path.join(d, 'scratchpad', 'x.txt'), 'x'); }
const tmpHas = () => Object.fromEntries(Object.entries(TMPF).map(([k, d]) => [k, fs.existsSync(d)]));
// 被杀（SIGTERM / Ctrl-C）时 finally 不跑：这里做同样的收尾，不然这次测试的 tmux 服务、假会话进程和两个临时目录会一直留着（11/13 一次被杀的改坏对照留下 4 个 tmux 和 138 个进程）。
// kill-server 用的是这次测试自己的 -S 套接字（TSOCK），目录被删了也只是报错，碰不到真总控台。--keep 是故意留着，不管
let cleaned = false;
// 被测服务新开的窗口各有一台 tmux（<TMUXDIR>/tmux/*.sock）：一台台 kill-server，它们的看护随之自己退出。只认这次测试自己的目录
function killWins() {
  // 中断发生在故障注入的 await 里时，信号收尾先还原自有套接字，再关 tmux；不把 .saved 的服务器遗在后台。
  try { for (const f of fs.readdirSync(WD).filter((f) => /^ccb-[\w-]+\.sock\.saved$/.test(f))) {
    const saved = path.join(WD, f), sock = saved.slice(0, -6);
    if (fs.existsSync(sock)) fs.unlinkSync(sock); fs.renameSync(saved, sock);
  } } catch {}
  let socks = []; try { socks = fs.readdirSync(WD).filter((f) => /^ccb-[\w-]+\.sock$/.test(f)); } catch {}
  for (const f of socks) { try { spawnSync(TMUX_BIN, [...TMW(f.slice(0, -5)), 'kill-server'], { env, stdio: 'ignore', timeout: 5000 }); } catch {} }
}
function cleanupNow() {
  if (cleaned) return; cleaned = true;
  try { if (TMUX_BIN) spawnSync(TMUX_BIN, [...TM, 'kill-server'], { env, stdio: 'ignore' }); } catch {}
  try { if (TMUX_BIN) killWins(); } catch {}
  for (const p of kids) { try { process.kill(p, 'SIGTERM'); } catch {} }
  for (const d of [ROOT, TMUXDIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
if (!KEEP) for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) process.on(sig, () => { cleanupNow(); process.exit(code); });
env.CCBOARD_DATA = path.join(FH, 'Library/Application Support/cc-board'); delete env.CCBOARD_READONLY;   // 和线上一样：App 给服务设了 CCBOARD_DATA（指着它自己的数据目录）
// ── config.json：示例项目表（test/fixture-config.json），两个开关都打开。最后一段 [8] 换成写坏的 config 重启，看默认值 ──
const DATA0 = path.join(FH, 'Library/Application Support/cc-board'); fs.mkdirSync(DATA0, { recursive: true });
const CHIEF = path.join(ROOT, 'chief-state.json');
const SEAT = path.join(ROOT, 'seat-other.txt');   // org.seats（11/17 win-49）：点名「其他」这一组的现任负责人；开头不建（没点名），[1c] 末尾写进去再改坏、删掉
fs.writeFileSync(path.join(DATA0, 'config.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-config.json'), 'utf8')), autoTrust: true, codex: true, autoTidy: !process.argv.includes('--ui'), tidyJudge: !process.argv.includes('--ui'), accounts: [{ id: 'good', name: '旧号' }, { id: 'none', name: '还没存 token 的号' }], org: { chief: CHIEF, seats: { other: SEAT, fretflow: path.join(ROOT, 'no-such-seat.txt'), 'bad key!': '/x' } }, autoContinue: process.argv.includes('--ui') ? false : { maxRun: 2 } }));   // --ui：界面测试点「审完了」，不能让服务把卡收走
// 架构场景：点名总管的文件（照 ~/Projects/assistant/state.json 的样子：session_id + generation）；hint 是负责人 peerDone 开的（spawn.json 按 tmux 名记）
fs.writeFileSync(CHIEF, JSON.stringify({ window: 'w-projC', session_id: S.projC.sid, generation: 3 }));
if (S.hint.tmux) fs.writeFileSync(path.join(DATA0, 'spawn.json'), JSON.stringify({ [S.hint.tmux]: { by: S.peerDone.sid, at: Date.now() }, ...(S.atKid && S.atKid.tmux ? { [S.atKid.tmux]: { by: S.atParent.sid, at: Date.now() } } : {}) }));
// 删记录的复现用独立 tmux；不登记卡片，且记录已超过一分钟。
const PRUNE_KEEP = 'ccb-prune-keep', PRUNE_GONE = 'ccb-prune-gone', PRUNE_PATH = 'ccb-prune-path';
const RESTORE_NAMES = ['ccb-restore-noid', 'ccb-restore-old', 'ccb-restore-ambig'];
const histFile = path.join(DATA0, 'seat-history.json');
const histNow = () => { try { return JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch { return {}; } };
if (!process.argv.includes('--ui') && TMUX_BIN) {
  fs.mkdirSync(WD, { recursive: true });
  for (const name of [PRUNE_KEEP, PRUNE_GONE, PRUNE_PATH, ...RESTORE_NAMES]) spawnSync(TMUX_BIN, [...TMW(name), 'new-session', '-d', '-s', name, '/bin/sleep', '900'], { env: TENV, stdio: 'ignore' });
  const sp = JSON.parse(fs.readFileSync(path.join(DATA0, 'spawn.json'), 'utf8'));
  for (const name of [PRUNE_KEEP, PRUNE_GONE, PRUNE_PATH]) sp[name] = { by: S.run.sid, at: Date.now() - 120000 };
  fs.writeFileSync(path.join(DATA0, 'spawn.json'), JSON.stringify(sp));
  fs.writeFileSync(path.join(DATA0, 'pins.json'), JSON.stringify(Object.fromEntries([PRUNE_KEEP, PRUNE_GONE, PRUNE_PATH].map((n) => [n, { key: 'fretflow', name: '示例项目', at: Date.now() - 120000 }]))));
  fs.writeFileSync(histFile, JSON.stringify({ other: [
    { sid: 'history0-0000-4000-8000-000000000001', name: 'win-x1', procs: [[HIST_PID, HIST_AT]], first: HIST_AT, last: HIST_AT },
    { sid: 'history0-0000-4000-8000-000000000002', name: 'win-x1', procs: [[REUSED_PID, Date.now() + 3600000]], first: HIST_AT, last: HIST_AT }
  ] }));
}
// ── 顶栏额度夹具（--ui 场景里也放：界面测试要看到芯片）──
// Codex：今天目录里一个只有额度的 rollout（不是会话，不登记进 agents.json，所以不会多出卡）；Claude：状态栏取数脚本存的两个号，amy 用到 91%、ben 用到 1%。
const LIM_NOW = Date.now(), LIM_SEC = (ms) => Math.round(ms / 1000);
const limTap = (s, account, five, week, days) => fs.writeFileSync(path.join(DATA0, 'limits', `claude-${s}.json`), JSON.stringify({ v: 1, at: Date.now(), session: s, account, rate_limits: { five_hour: { used_percentage: five, resets_at: LIM_SEC(LIM_NOW + 3600000) }, seven_day: { used_percentage: week, resets_at: LIM_SEC(LIM_NOW + days * 86400000) } } }));
{
  const d = new Date(LIM_NOW), two = (n) => String(n).padStart(2, '0');
  const dir = path.join(FH, '.codex/sessions', String(d.getFullYear()), two(d.getMonth() + 1), two(d.getDate())); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rollout-limits.jsonl'), JSON.stringify({ timestamp: new Date(LIM_NOW - 120000).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 34, window_minutes: 10080, resets_at: LIM_SEC(LIM_NOW + 2.5 * 86400000) }, secondary: null, plan_type: 'prolite' } } }) + '\n');
  fs.mkdirSync(path.join(DATA0, 'limits'), { recursive: true });
  limTap('aaaa1111-0001', 'amy', 100, 91, 2); limTap('bbbb2222-0002', 'ben', 6, 1, 1.9);
}
// ── 一个总控台起过的 Codex 会话：登记在 agents.json，tmux 里有它的窗格，记录是最小的两行（--ui 场景里不放：界面测试按卡数断言）──
const CDX = 'ccb-cdx001';
if (!process.argv.includes('--ui') && TMUX_BIN) {
  const rollout = path.join(FH, '.codex/sessions/2026/11/13/rollout-fixture.jsonl'); fs.mkdirSync(path.dirname(rollout), { recursive: true }); const t = new Date().toISOString();
  // [1d] 用：这一轮照真实 rollout 的三种写法改文件（11/16 本机 60 份 rollout 里补丁都包在 exec 的 JS 源码里，换行是 \\n 两个字符）；直接的 apply_patch、
  // 旧写法 shell 的 JSON 参数各一条；exec 里只读文件的不算。repoX 里那几个和 Claude 会话 cX 撞车，相对路径 rel/cx2.js 按工作目录（主目录下的 work）补全、不算进任何仓库
  const ci = (payload) => ({ type: 'response_item', timestamp: t, payload });
  const PX = (f) => PJ('repoX', f);
  fs.writeFileSync(rollout, [{ type: 'response_item', timestamp: t, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex 夹具任务' }] } },
    ci({ type: 'custom_tool_call', name: 'exec', call_id: 'cx1', input: 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: ' + PX('cx1.js') + '\\n@@\\n-a\\n+b\\n*** End Patch\\n"));' }),
    ci({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'cx2', input: '*** Begin Patch\n*** Add File: rel/cx2.js\n+x\n*** Update File: ' + PX('old.js') + '\n*** Move to: ' + PX('moved.js') + '\n@@\n-a\n+b\n*** End Patch\n' }),
    ci({ type: 'function_call', name: 'shell', call_id: 'cx3', arguments: JSON.stringify({ command: ['apply_patch', '*** Begin Patch\n*** Delete File: ' + PX('gone.js') + '\n*** End Patch\n'] }) }),
    ci({ type: 'custom_tool_call', name: 'exec', call_id: 'cx4', input: 'text(await tools.exec_command({cmd:"cat ' + PX('read.js') + '"}));' }),
    { type: 'event_msg', timestamp: t, payload: { type: 'task_complete', last_agent_message: '夹具做完了' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(DATA0, 'agents.json'), JSON.stringify({ [CDX]: { cwd: CWD, at: Date.now(), prompt: 'Codex 夹具任务', sid: 'cdx-fixture', rollout, model: 'gpt-6.1-sol', effort: 'high' } }));
  spawnSync(TMUX_BIN, [...TM, 'new-session', '-d', '-s', CDX, '-x', '80', '-y', '20', '/bin/sleep', '600'], { env, stdio: 'ignore' });
}
// 「不改脑子」（P0-2）：服务起来之前，给假主目录里所有会进模型说明的文件记一份哈希；[9] 再比一次，服务一个都不能加、改、删
const BRAIN_RE = /(^|\/)(CLAUDE(\.local)?\.md|AGENTS\.md|settings(\.local)?\.json|\.claude\.json|\.mcp\.json)$|(^|\/)\.claude\/(agents|commands|rules|skills|hooks|output-styles)\//;
const brainFiles = () => { const out = {}; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && BRAIN_RE.test(path.relative(FH, p))) out[path.relative(FH, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } };
  walk(FH); return out; };
fs.mkdirSync(path.join(FH, '.claude'), { recursive: true });
for (const [f, txt] of [['CLAUDE.md', '# 夹具：主目录的规矩\n'], ['AGENTS.md', '# 夹具：Codex 的规矩\n'], ['.claude/CLAUDE.md', '# 夹具：全局规矩\n'], ['.claude/settings.json', '{"env":{}}\n'], [path.relative(FH, path.join(CWD, 'CLAUDE.md')), '# 夹具：项目规矩\n']])
  if (!fs.existsSync(path.join(FH, f))) fs.writeFileSync(path.join(FH, f), txt);       // 没有就放一份，免得「一个没动」空对空也算过
const BRAIN0 = brainFiles();
const srv = spawn(NODE, [SERVER], { env, stdio: ['ignore', out, out] }); kids.push(srv.pid);
const DATA = path.join(FH, 'Library/Application Support/cc-board');
let TOKEN = '';
const get = async (p) => (await fetch('http://127.0.0.1:' + PORT + p, { headers: { 'x-ccboard': TOKEN } })).json();
const post = async (p, body) => { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };
// 手机远程（[10]）要自己写 Host 头（tailscale serve 转进来的请求 Host 是 *.ts.net）；fetch 不许改 Host，所以用 http.request。连不上 / 超时回 code 0，不抛
const rq = (port, method, p, headers = {}, body) => new Promise((resolve) => {
  const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
    let t = ''; res.setEncoding('utf8'); res.on('data', (c) => (t += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} resolve({ code: res.statusCode, headers: res.headers, text: t, body: j }); });
  });
  r.on('error', (e) => resolve({ code: 0, headers: {}, text: String(e), body: null })); r.setTimeout(10000, () => r.destroy(new Error('timeout')));
  if (data) r.write(data); r.end();
});
const log = () => fs.readFileSync(logFile, 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const by = (st, name) => st.sessions.find((x) => x.sid === S[name].sid);
const kind = (st, name) => { const s = by(st, name); return s ? (s.alert ? s.alert.kind : null) : 'MISSING'; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(400); } return v; };

let ticker = null;
const hintTick = setInterval(() => { try { append('hint', R.tool(), R.result()); } catch {} }, 800);   // hint 这个会话从头到尾都在正常干活
const subTick = setInterval(() => { const t = new Date(); for (const f of ['agent-a1.jsonl', 'agent-a2.jsonl', 'agent-a1.meta.json']) { try { fs.utimesSync(path.join(SUBRUN, f), t, t); } catch {} } }, 20000);   // run 的两个子 agent 一直在跑（--ui 场景要撑 10 分钟）
try {
  for (let i = 0; i < 50; i++) { await sleep(200); try { TOKEN = fs.readFileSync(path.join(DATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json(); if (h.ok) { console.log('health', JSON.stringify(h).replace(FH, '<假主目录>')); break; } } catch {} }
  // 「在跑」的两个会话每 0.8 秒多一条记录（真在干活的样子）；stall 那个一条不加
  ticker = setInterval(() => { try { append('run', R.tool(), R.result()); append('compact', R.tool(), R.result()); } catch {} }, 800);
  await sleep(1600);
  if (process.argv.includes('--ui')) {
    process.kill(S.gone.pid, 'SIGTERM');                      // 让「进程退出」的卡片也出现
    // 等服务真的把它挂出来再说「好了」：服务要连着几轮看不到进程才认（约 6 秒），慢机器（CI）上更久。不能让 ui-check 靠固定的等待去赌
    let lostUp = false; for (let i = 0; i < 150 && !lostUp; i++) { await sleep(200); try { lostUp = ((await get('/api/state')).lost || []).length === 1; } catch {} }
    if (!lostUp) { console.log('UI fixture FAILED: 30 秒内「进程退出」的卡片没出现'); throw new Error('ui-fixture-not-ready'); }
    fs.writeFileSync(path.join(HERE, '.tmp', 'ui-fixture.json'), JSON.stringify({ url: 'http://127.0.0.1:' + PORT + '/?k=' + TOKEN, home: FH, pid: process.pid, sids: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.sid])) }));
    console.log('UI fixture ready pid=' + process.pid);
    await new Promise((resolve) => { process.on('SIGTERM', resolve); process.on('SIGINT', resolve); setTimeout(resolve, Number(process.env.T_UI_SECONDS || 600) * 1000); });
    throw new Error('ui-fixture-done');
  }
  let st = await get('/api/state');
  console.log('\n[1] 一开始的状态（alert 字段）');
  ok(st.sandbox === true, '试验场被认出来了（sandbox=true，不碰 Ghostty、不发通知）', 'sandbox=' + st.sandbox);
  ok(st.ghostty === false, 'Ghostty 没被碰');
  const want = { relimit: 'limit', bg: null, bgOpen: null, run: null, done: null, limit: 'limit', auth: 'auth', err: 'error', flag: 'flagged', flagFable: 'flagged', intr: 'interrupt', intrIdle: null, compact: null, unfin: 'unfinished', recover: null, gone: null, goneIdle: null };
  for (const [n, k] of Object.entries(want)) ok(kind(st, n) === k, `${n}: alert=${k}`, 'got ' + kind(st, n));
  ok(by(st, 'limit') && by(st, 'limit').alert && /weekly limit/.test(by(st, 'limit').alert.text), 'limit: 带着报错原文');
  ok(['flag', 'flagFable'].every((n) => by(st, n) && by(st, n).alert && /safeguards flagged/.test(by(st, n).alert.text)), 'flag / flagFable：被安全检查拦了，带着原文（Opus 5.5、Fable 5.2 各一条）', ['flag', 'flagFable'].map((n) => by(st, n) && by(st, n).alert && by(st, n).alert.text.slice(0, 40)).join(' | '));
  ok(by(st, 'intr') && by(st, 'intr').prompt === '重构播放器', 'intr: 「你说的话」还是原来那句，不是打断标记', by(st, 'intr') && by(st, 'intr').prompt);
  ok(by(st, 'intrIdle') && by(st, 'intrIdle').prompt === '查一下日志' && by(st, 'intrIdle').done === true, 'intrIdle: 没在做事时的 Esc 不算停住，交付还在');
  ok(by(st, 'compact') && by(st, 'compact').prompt === '做发布片', 'compact: 压缩摘要没被当成你说的话', by(st, 'compact') && by(st, 'compact').prompt);
  { // [7s] 总控台保温
    const a = by(st, 'kwCard'), b = by(st, 'kwTool'), aAt = JSON.parse(recLines('kwCard')[1]).timestamp;
    ok(a && a.prompt === '出一份报告' && a.result === '报告写好了。' && a.done === true && a.digest && a.digest.tag === true && a.digest.need === 'review', '[7s] kwCard：保温那一轮整轮不算，卡片上还是「出一份报告」和挂着【待审阅】的那次交付（状态行照旧从正文里拿掉、tag 还在；总管 11/20 23:07 的条件）', JSON.stringify(a && { p: a.prompt, r: a.result, d: a.done, tag: a.digest && a.digest.tag, need: a.digest && a.digest.need }));
    ok(a && a.resultAt === aAt, '[7s] kwCard：交付时间还是原来那次（不变成新交付、不标未读）', a && a.resultAt + ' / ' + aAt);
    ok(a && a.ctx === 122902, '[7s] kwCard：上下文取保温那一条回复的（它是真的大小）', a && a.ctx);
    ok(b && b.result === 'X 查完了。' && b.prompt === '查额度', '[7s] kwTool：保温那一轮调了工具也不算；之后别的窗口发来的那一轮照常交付', JSON.stringify(b && { p: b.prompt, r: b.result }));
    const ta = (await get('/api/turns?sid=' + S.kwCard.sid)).turns || [], tb = (await get('/api/turns?sid=' + S.kwTool.sid)).turns || [];
    ok(ta.length === 1 && ta[0].prompt === '出一份报告' && ta[0].results.length === 1 && !JSON.stringify(ta).includes('保温'), '[7s] 放大看（/api/turns）：保温不算一轮，它回的点也不算交付', JSON.stringify(ta.map((t) => [t.prompt, t.results.length])));
    ok(tb.length === 1 && tb[0].steps === 0 && tb[0].results.map((r) => r.text).join('|') === '查完了。\n\n【待跟进】要你登录|X 查完了。', '[7s] 放大看：保温那一轮的工具不算步数，之后别的窗口那一轮的交付照常接上', JSON.stringify(tb.map((t) => [t.prompt, t.steps, t.results.map((r) => r.text)])));
    const c = by(st, 'kwMid'), tc = (await get('/api/turns?sid=' + S.kwMid.sid)).turns || [];
    ok(c && c.prompt === '改一个文件' && c.result === '改好了。' && c.done === true && c.digest && c.digest.need === 'review' && !c.alert, '[7s] kwMid：保温那句插在一轮中间不认成保温，收尾照常是这一轮的交付（不被当成保温的回复吞掉、卡片不变成没做完；1b 审查 M4）', JSON.stringify(c && { p: c.prompt, r: c.result, d: c.done, need: c.digest && c.digest.need, alert: c.alert }));
    ok(tc.length === 1 && tc[0].prompt === '改一个文件' && tc[0].steps === 1 && tc[0].results.map((r) => r.text).join('|') === '改好了。\n\n【待审阅】改动在沙盒里', '[7s] 放大看：插在一轮中间的那句保温也不认，这一轮的交付照常（步数 1）', JSON.stringify(tc.map((t) => [t.prompt, t.steps, t.results.map((r) => r.text)])));
  }
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
  ok(dg('engAsk').tag && dg('engAsk').need === 'reply' && dg('engAsk').ask === 'Pick a draft' && !by(st, 'engAsk').result.includes('[Needs you]'), 'digest: [Needs you] supplies the ask and leaves the displayed text', JSON.stringify(dg('engAsk')));
  ok(dg('engReview').tag && dg('engReview').need === 'review' && dg('engReview').head === 'The final report is ready', 'digest: bold English [REVIEW] overrides guessed follow-up', JSON.stringify(dg('engReview')));
  ok(dg('engFyi').tag && dg('engFyi').need === 'fyi' && dg('engFyi').head === 'The preview built successfully', 'digest: [FYI] overrides guessed follow-up', JSON.stringify(dg('engFyi')));
  ok(!dg('engGuess').tag && dg('engGuess').need === 'reply', 'digest: English request for approval implies follow-up', JSON.stringify(dg('engGuess')));
  ok(!dg('engNone').tag && dg('engNone').need === 'fyi', 'digest: English no-reply text implies FYI', JSON.stringify(dg('engNone')));
  ok(!dg('engQuestion').tag && dg('engQuestion').need === 'reply', 'digest: English question about a choice implies follow-up', JSON.stringify(dg('engQuestion')));
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


  // 内置预览（/api/preview + 预览端口）：HTML 拿到一个另一个端口上的网址；只发那个文件夹里白名单类型的文件
  // 路径原样发出去：URL() 会先把 %2E%2E 解成 ..，就测不到服务自己的防护
  const raw = (url, { method = 'GET', headers = {} } = {}) => new Promise((resolve) => {
    const u = /^http:\/\/([^/:]+):(\d+)(\/.*)?$/.exec(url) || []; const rq = http.request({ host: u[1], port: u[2], path: u[3] || '/', method, headers }, (rs) => { const b = []; rs.on('data', (c) => b.push(c)); rs.on('end', () => resolve({ code: rs.statusCode, h: rs.headers, body: Buffer.concat(b).toString('utf8') })); });
    rq.on('error', () => resolve({ code: 0, h: {}, body: '' })); rq.end();
  });
  fs.mkdirSync(path.join(OD, 'img'), { recursive: true }); fs.mkdirSync(path.join(OD, '.git'), { recursive: true });
  fs.writeFileSync(path.join(OD, 'img', 'a.css'), 'h1{}'); fs.writeFileSync(path.join(OD, '.git', 'config.css'), 'x'); fs.writeFileSync(path.join(OD, 'clip.mp4'), Buffer.alloc(3000, 7));
  fs.writeFileSync(path.join(FH, 'secret.css'), 'secret'); fs.symlinkSync(path.join(FH, 'secret.css'), path.join(OD, 'out.css'));
  fs.writeFileSync(path.join(FH, 'top.html'), '<p>top</p>'); fs.writeFileSync(path.join(FH, 'top.css'), 'x'); fs.mkdirSync(path.join(FH, 'notes'), { recursive: true }); fs.writeFileSync(path.join(FH, 'notes', 'n.css'), 'x');
  const pv = async (p) => (await post('/api/preview', { path: p })).body;
  const v1 = await pv('file://' + encodeURI(path.join(OD, '讲解.html'))), v1b = await pv('~/Desktop/资料 夹/讲解.html');
  const pu = (r) => new URL(r.url || 'http://x/');
  ok(v1.ok && pu(v1).hostname === '127.0.0.1' && Number(pu(v1).port) === PORT + 1000 && v1.name === '讲解.html' && v1b.url === v1.url, 'preview: HTML（中文 + 空格的文件夹、file:// 百分号编码）→ 另一个端口上的网址；同一个文件再点网址不变', JSON.stringify([v1, v1b]));
  const B = (v1.url || '').replace(/\/[^/]*$/, '');
  const g1 = await raw(v1.url || 'http://127.0.0.1:1/'), g2 = await raw(B + '/img/a.css');
  ok(g1.code === 200 && /^text\/html/.test(g1.h['content-type'] || '') && /^<p>x<\/p><script>.*preview-esc/.test(g1.body) && g1.h['referrer-policy'] === 'no-referrer' && g2.code === 200 && /^text\/css/.test(g2.h['content-type'] || ''), 'preview: 页面本身和它子文件夹里的 CSS 都能取，类型对，不带 Referer 出去', [g1.code, g1.h['content-type'], g1.h['referrer-policy'], g2.code].join(' '));
  const deny = await Promise.all(['/.git/config.css', '/run.sh', '/out.css', '/%2E%2E/secret.css', '/..%2Fsecret.css', '/img/', '/img'].map(async (t) => (await raw(B + t)).code));
  ok(deny.every((c) => c === 404), 'preview: 点开头的文件夹、不在白名单的类型、指到外面的符号链接、..、文件夹本身 → 一律 404', deny.join(','));
  const r206 = await raw(B + '/clip.mp4', { headers: { range: 'bytes=0-1' } }), rFull = await raw(B + '/clip.mp4');
  ok(r206.code === 206 && r206.h['content-range'] === 'bytes 0-1/3000' && r206.body.length === 2 && rFull.code === 200 && rFull.h['content-length'] === '3000', 'preview: 视频按段取回 206（WebKit 的 <video> 要这个才播）', r206.code + ' ' + r206.h['content-range'] + ' / ' + rFull.code);
  const hostBad = await raw(v1.url || 'http://127.0.0.1:1/', { headers: { host: 'evil.example:' + (PORT + 1000) } }), postBad = await raw(v1.url || 'http://127.0.0.1:1/', { method: 'POST' }), idBad = await raw('http://127.0.0.1:' + (PORT + 1000) + '/' + '0'.repeat(32) + '/' + encodeURIComponent('讲解.html'));
  ok(hostBad.code === 403 && postBad.code === 405 && idBad.code === 404, 'preview: 别的 Host（DNS 重绑定）403、POST 405、编号不对 404', [hostBad.code, postBad.code, idBad.code].join(','));
  // Esc 转发：发 HTML 时在最后一个 </body> 前加一小段脚本；磁盘上的文件不动；别的类型、HEAD、按段请求都照旧
  const EH = path.join(OD, 'esc.html'); const ESRC = '<html><body><p>a</p><script>var s="</body>"</script></BODY>\n</html>'; fs.writeFileSync(EH, ESRC);
  const ve = await pv(EH), e1 = await raw(ve.url || 'http://127.0.0.1:1/'), eHead = await raw(ve.url || 'http://127.0.0.1:1/', { method: 'HEAD' }), eRange = await raw(ve.url || 'http://127.0.0.1:1/', { headers: { range: 'bytes=0-1' } });
  const hookAt = e1.body.indexOf('<script>addEventListener("keydown"');
  ok(hookAt > 0 && e1.body.slice(hookAt).replace(/^<script>.*?<\/script>/, '') === '</BODY>\n</html>' && e1.body.indexOf('preview-esc') === e1.body.lastIndexOf('preview-esc') && Number(e1.h['content-length']) === Buffer.byteLength(e1.body) && fs.readFileSync(EH, 'utf8') === ESRC,
    'preview: HTML 末尾带 Esc 转发脚本（插在最后一个 </body> 前、大小写都认、只插一次），长度对，磁盘上的文件没动', e1.body.slice(-120));
  ok(!/preview-esc/.test(g2.body) && eHead.code === 200 && eHead.body === '' && Number(eHead.h['content-length']) === Buffer.byteLength(e1.body) && eRange.code === 200 && eRange.body === e1.body, 'preview: CSS 不加脚本；HTML 的 HEAD 长度对、不带正文；HTML 不按段发（整份 200）', [eHead.code, eHead.h['content-length'], eRange.code].join(' '));
  const vTop = await pv('~/top.html'), TB = (vTop.url || '').replace(/\/[^/]*$/, '');
  const shallow = [(await raw(TB + '/top.css')).code, (await raw(TB + '/notes/n.css')).code];
  ok(vTop.ok && shallow[0] === 200 && shallow[1] === 404, 'preview: 页面就在主目录里时只发同一层的文件，不往下钻', JSON.stringify(vTop) + ' ' + shallow.join(','));
  fs.writeFileSync(path.join(OD, 'report.docx'), 'PK'); fs.mkdirSync(path.join(OD, 'dir.png'));
  const q1 = await pv(path.join(OD, 'report.docx')), q2 = await pv(OD), q3 = await pv('~/Desktop/没有.html'), q4 = await pv('Desktop/x.html'), q5 = await pv(path.join(OD, 'Foo.app')), q6 = await pv(path.join(OD, 'dir.png'));
  ok(q1.reason === 'no-preview' && q2.reason === 'no-preview' && q5.reason === 'no-preview' && q6.reason === 'no-preview' && q3.reason === 'missing' && !q4.ok && !q1.url, 'preview: 预览不了的（Word、文件夹、.app、叫 x.png 的文件夹）回 no-preview 让界面改走 open；不存在的、不是完整路径的不给网址', JSON.stringify([q1, q2, q3, q4, q5, q6]));
  // 别的类型（11/15 作者：「访达里的这种文件预览，也直接在我们的 APP 里打开」）：图、音视频、PDF 给网址和类型；文本、Markdown 直接带内容，最多 1 MiB
  for (const [n, body] of [['photo.png', Buffer.from('89504e470d0a1a0a', 'hex')], ['shot.HEIC', 'x'], ['song.m4a', 'x'], ['doc.pdf', '%PDF-1.4'], ['笔记.md', '# 标题\n\n正文'], ['data.json', '{"a":1}'], ['tool.sh', 'echo hi'], ['big.log', 'a'.repeat(1024 * 1024 + 10)]]) fs.writeFileSync(path.join(OD, n), body);
  const k = {}; for (const n of ['photo.png', 'shot.HEIC', 'clip.mp4', 'song.m4a', 'doc.pdf', '笔记.md', 'data.json', 'tool.sh', 'big.log']) k[n] = await pv(path.join(OD, n));
  const kinds = Object.fromEntries(Object.entries(k).map(([n, r]) => [n, r.kind]));
  ok(JSON.stringify(kinds) === JSON.stringify({ 'photo.png': 'image', 'shot.HEIC': 'image', 'clip.mp4': 'video', 'song.m4a': 'audio', 'doc.pdf': 'pdf', '笔记.md': 'markdown', 'data.json': 'text', 'tool.sh': 'text', 'big.log': 'text' }), 'preview: 按扩展名分类（大小写都认）：图 / 视频 / 音频 / PDF / Markdown / 文本', JSON.stringify(kinds));
  const kp = await raw(k['photo.png'].url || 'http://127.0.0.1:1/'), kd = await raw(k['doc.pdf'].url || 'http://127.0.0.1:1/');
  ok(kp.code === 200 && kp.h['content-type'] === 'image/png' && kd.code === 200 && kd.h['content-type'] === 'application/pdf' && !/preview-esc/.test(kd.body), 'preview: 图和 PDF 的网址按真类型发，不加 Esc 脚本', [kp.code, kp.h['content-type'], kd.code, kd.h['content-type']].join(' '));
  ok(k['笔记.md'].text === '# 标题\n\n正文' && k['笔记.md'].truncated === false && k['data.json'].text === '{"a":1}' && !('text' in k['photo.png']) && k['big.log'].text.length === 1024 * 1024 && k['big.log'].truncated === true,
    'preview: 文本和 Markdown 直接带内容；超过 1 MiB 只带开头并标 truncated；图不带内容', JSON.stringify({ md: k['笔记.md'].text, big: [(k['big.log'].text || '').length, k['big.log'].truncated] }));
  ok(/preview \S+ image .*photo\.png/.test(log()) && /preview \S+ markdown .*笔记\.md/.test(log()), 'preview: 日志里写类型');
  const pBad = await fetch('http://127.0.0.1:' + PORT + '/api/preview', { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json', origin: 'http://127.0.0.1:' + (PORT + 1000) }, body: JSON.stringify({ path: path.join(OD, '讲解.html') }) });
  const pNoTok = await fetch('http://127.0.0.1:' + PORT + '/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: path.join(OD, '讲解.html') }) });
  ok(pBad.status === 403 && pNoTok.status === 403, 'preview: 预览页自己（另一个端口的 Origin）和不带口令的都调不了 /api/preview', pBad.status + ',' + pNoTok.status);
  ok(/preview \S+ .*资料 夹\/讲解\.html/.test(log()) && !/preview \S+ .*run\.sh/.test(log()), 'preview: 日志里记下预览了哪个文件，没给网址的不记');

  // 图集（11/15 作者：「直接把这些照片做成一个合集，我就不要一个一个去点开」「打开预览的时候，我不想切到外面去看」）：
  // 点一个多半是图 / 视频的文件夹 → gallery；一条交付里的好几个图片路径 → paths 合成一个图集
  {   // 自成一个作用域：这一块的变量名（g、many、proj…）不和上面已有的撞
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
  const mk = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b); return dir; };
  const GD = mk(path.join(FH, 'Desktop', '截图集'), { 'shot2.png': PNG, 'shot10.png': PNG, 'shot1.png': PNG, '中文图.PNG': PNG, 'clip.mov': Buffer.alloc(3000, 7), '.hidden.png': PNG });
  fs.mkdirSync(path.join(GD, 'sub')); fs.writeFileSync(path.join(GD, 'sub', 'deep.png'), PNG);
  fs.writeFileSync(path.join(FH, 'outside.png'), PNG); fs.symlinkSync(path.join(FH, 'outside.png'), path.join(GD, 'leak.png'));      // 指到文件夹外面的图：不列
  const g = await pv(GD);
  ok(g.ok && g.kind === 'gallery' && g.name === '截图集' && g.dir === fs.realpathSync(GD) && g.total === 5 && g.truncated === false, 'gallery: 点文件夹 → kind gallery，带文件夹名和真身路径', JSON.stringify({ ...g, items: undefined }));
  ok(JSON.stringify(g.items.map((i) => i.name)) === JSON.stringify(['clip.mov', 'shot1.png', 'shot2.png', 'shot10.png', '中文图.PNG']), 'gallery: 按文件名里的数字排（shot1、shot2、shot10），大小写扩展名都认；点开头的、文件夹、指到外面的符号链接不列', JSON.stringify(g.items.map((i) => i.name)));
  ok(g.items.map((i) => i.kind).join() === 'video,image,image,image,image', 'gallery: 每一项带类型（图 / 视频）', g.items.map((i) => i.kind).join());
  const gBase = g.items[0].url.replace(/[^/]*$/, '');
  const gp = await raw(g.items[1].url), gv = await raw(g.items[0].url), gc = await raw(g.items[4].url);
  const gDeny = [await raw(gBase + '.hidden.png'), await raw(gBase + 'leak.png'), await raw(gBase + 'sub')].map((x) => x.code);
  ok(gp.code === 200 && gp.h['content-type'] === 'image/png' && gv.code === 200 && gv.h['content-type'] === 'video/quicktime' && gc.code === 200 && Number(new URL(g.items[1].url).port) === PORT + 1000, 'gallery: 每一项的网址在预览端口上能取，类型对（中文文件名也行）', [gp.code, gp.h['content-type'], gv.code, gv.h['content-type'], gc.code].join(' '));
  ok(gDeny.join() === '404,404,404', 'gallery: 钥匙只开这个文件夹：点开头的文件、指到外面的符号链接、文件夹本身一律 404', gDeny.join());
  const g2 = await pv(GD + '/');
  ok(g2.ok && g2.items[0].url === g.items[0].url, 'gallery: 路径带 / 结尾、同一个文件夹再点，网址不变', g2.items && g2.items[0].url);
  // 什么样的文件夹才算图集：至少 2 个，且占文件的 60% 以上；不然点项目文件夹想进访达，却看到一面只有 logo 的墙
  const proj = mk(path.join(FH, 'Desktop', 'proj'), { 'logo.png': PNG, 'a.md': 'x', 'b.md': 'x', 'c.md': 'x', 'd.md': 'x', 'e.md': 'x' });
  const half = mk(path.join(FH, 'Desktop', 'half'), { '1.png': PNG, '2.png': PNG, 'a.md': 'x', 'b.md': 'x' });
  const solo = mk(path.join(FH, 'Desktop', 'solo'), { 'only.png': PNG });
  const most = mk(path.join(FH, 'Desktop', 'most'), { '1.png': PNG, '2.png': PNG, '3.png': PNG, 'notes.md': 'x' });
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(FH, 'home-' + i + '.png'), PNG);       // 主目录里即便躺着一堆图（占了多数文件），也不当图集：一整个主目录的图不是他要看的
  const rHome = await pv(FH); for (let i = 0; i < 10; i++) fs.unlinkSync(path.join(FH, 'home-' + i + '.png'));
  const rr = [await pv(proj), await pv(half), await pv(solo), rHome, await pv(mk(path.join(FH, 'Desktop', 'empty'), {}))];
  ok(rr.every((r) => !r.ok && r.reason === 'no-preview'), 'gallery: 项目文件夹里躺着一个 logo、图只占一半、只有 1 张、主目录本身、空文件夹 → 都回 no-preview，照旧交给访达', JSON.stringify(rr.map((r) => r.reason)));
  const mo = await pv(most);
  ok(mo.ok && mo.kind === 'gallery' && mo.items.length === 3, 'gallery: 3 张图 + 1 个笔记（图占 75%）→ 算图集，笔记不进格子', JSON.stringify(mo.items && mo.items.map((i) => i.name)));
  const many = mk(path.join(FH, 'Desktop', 'many'), Object.fromEntries(Array.from({ length: 205 }, (_, i) => ['p' + String(i + 1).padStart(3, '0') + '.png', PNG])));
  const gm = await pv(many);
  ok(gm.ok && gm.items.length === 200 && gm.total === 205 && gm.truncated === true && gm.items[0].name === 'p001.png' && gm.items[199].name === 'p200.png', 'gallery: 一个图集最多 200 个，多出来的标 truncated 并带总数', [gm.items && gm.items.length, gm.total, gm.truncated].join(' '));
  // 一条交付里写了好几个图片路径：{ paths } 合成一个图集。不是完整路径的丢掉，不在的 / 不是图的 / 点开头的 / 文件夹跳过，同一个文件只放一次
  const pm = async (paths) => (await post('/api/preview', { paths })).body;
  const m1 = await pm([path.join(GD, 'shot1.png'), 'file://' + encodeURI(path.join(GD, 'shot2.png')), '~/Desktop/截图集/shot1.png', path.join(OD, 'photo.png'), path.join(GD, '没有.png'), path.join(OD, 'doc.pdf'), path.join(GD, '.hidden.png'), 'Desktop/x.png', path.join(GD, 'sub')]);
  ok(m1.ok && m1.kind === 'gallery' && JSON.stringify(m1.items.map((i) => i.name)) === JSON.stringify(['shot1.png', 'shot2.png', 'photo.png']) && m1.total === 3 && m1.skipped === 4 && m1.truncated === false, 'gallery: paths → 同一个文件（~ 和完整路径写法）只放一次；不在的、PDF、点开头的、文件夹跳过（skipped 4）；相对路径直接丢掉', JSON.stringify({ n: m1.items && m1.items.map((i) => i.name), t: m1.total, s: m1.skipped }));
  const mp = await raw(m1.items[0].url), mq = await raw(m1.items[2].url);
  ok(mp.code === 200 && mq.code === 200 && m1.items[0].url.split('/')[3] !== m1.items[2].url.split('/')[3] && m1.items[0].url.split('/')[3] === m1.items[1].url.split('/')[3], 'gallery: 不同文件夹的图各用各的钥匙，同一个文件夹的共用一把；都取得到', [mp.code, mq.code].join(','));
  const m2 = await pm([path.join(OD, 'doc.pdf'), path.join(GD, '没有.png')]), m3 = await pm([]), m4 = await pm('x');
  ok(!m2.ok && m2.reason === 'no-preview' && !m3.ok && m3.reason === 'no-preview' && !m4.ok && !m4.reason, 'gallery: 一张图都没有 / 空列表 → no-preview；paths 不是列表 → 报错', JSON.stringify([m2, m3, m4]));
  const mBad = await fetch('http://127.0.0.1:' + PORT + '/api/preview', { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json', origin: 'http://127.0.0.1:' + (PORT + 1000) }, body: JSON.stringify({ paths: [path.join(GD, 'shot1.png')] }) });
  ok(mBad.status === 403, 'gallery: paths 这条路也只接受总控台自己的页面（预览页的 Origin 调不了）', String(mBad.status));
  ok(/preview \S+ gallery .*截图集 5\/5/.test(log()) && /preview \S+ gallery 3 个文件（2 个文件夹）/.test(log()) && /preview \S+ gallery .*many 200\/205/.test(log()), 'gallery: 日志里记下图集（文件夹和张数、一批文件的个数）');
  }

  console.log('\n[1b] 每个会话用的模型和强度：取主线上最近一条真回复，报错和子 agent 的不算（卡片右上角的胶囊读它）');
  ok(by(st, 'done').model === 'claude-fable-5-2' && by(st, 'done').effort === 'max', 'done: 模型 / 强度是最近一条真回复的（Fable 5.2 · max），不是前面那条 opus、也不是子 agent 的 haiku', by(st, 'done').model + ' ' + by(st, 'done').effort);
  ok(by(st, 'limit').model === 'claude-opus-5-5' && by(st, 'limit').effort === 'xhigh', 'limit: 后面跟着额度报错（<synthetic>）也不盖掉模型和强度', by(st, 'limit').model + ' ' + by(st, 'limit').effort);
  ok(by(st, 'auth').model === 'claude-sonnet-4-5-20250929' && by(st, 'auth').effort === null, 'auth: 老模型没有强度 → effort 是 null；写得不像一个词的强度也当没有', by(st, 'auth').model + ' ' + by(st, 'auth').effort);
  ok(by(st, 'err').model === null && by(st, 'err').effort === null, 'err: 一条真回复都没有 → 都是 null，界面不画胶囊', by(st, 'err').model + ' ' + by(st, 'err').effort);

  console.log('\n[1c] 架构视图（谁归谁管）：/api/state 的 org，加每个会话的 ctx、sub（规则本身的断言在 org.test.mjs）');
  // hint 要等服务认出它的 tmux 名（每 4 秒对一次窗格）才知道它是谁开的
  const orgOf = (r) => (r && r.org) || { nodes: {} };
  const on = (r, n) => (orgOf(r).nodes[S[n].sid]) || {};
  st = await until(async () => { const r = await get('/api/state'); return on(r, 'hint').via === 'spawn' ? r : null; }, 15000) || await get('/api/state');
  const sd = (n) => S[n].sid, show = (r, ns) => JSON.stringify(Object.fromEntries(ns.map((n) => { const x = on(r, n); return [n, [x.role, x.boss ? Object.keys(S).find((k) => S[k].sid === x.boss) || x.boss : null, x.via, x.n, x.for === 'you' ? 'you' : x.for ? Object.keys(S).find((k) => S[k].sid === x.for) || x.for : null]]; })));
  const TREE = ['projC', 'peerDone', 'askQ', 'hint', 'unfin', 'intr', 'done', 'run', 'links', 'limit'];
  ok(st.org && st.org.chief === sd('projC') && st.org.gen === 3 && on(st, 'projC').role === 'chief', 'org.chief：config 的 org.chief 文件点名的 projC（带 generation 3），没用名字里带「总管」的 links', JSON.stringify({ chief: st.org && st.org.chief, gen: st.org && st.org.gen }));
  ok(on(st, 'peerDone').role === 'lead' && on(st, 'peerDone').boss === sd('projC') && on(st, 'peerDone').via === 'seat', '负责人：登记名带「总指挥」、在给别人发消息的 peerDone；挂在总管下面（via seat）', show(st, TREE));
  ok(on(st, 'askQ').role === 'former' && on(st, 'askQ').boss === sd('peerDone') && on(st, 'askQ').via === 'seat', '前任：同一组里更早开的总指挥 askQ，挂在现任下面', show(st, TREE));
  ok(on(st, 'hint').boss === sd('peerDone') && on(st, 'hint').via === 'spawn', 'spawn.json 按 tmux 名记着 hint 是 peerDone 开的 → 上级是它（via spawn）', show(st, TREE));
  ok(on(st, 'unfin').boss === sd('peerDone') && on(st, 'unfin').via === 'msg' && on(st, 'unfin').n === 3, '负责人发来 3 条（1 条开了一轮、2 条在这一轮里，每条都算）→ 上级是它（via msg，n 3）', show(st, TREE));
  ok(on(st, 'intr').boss === sd('unfin') && on(st, 'intr').via === 'msg', '下级的下级：intr 收到 unfin 3 条 → 归 unfin', show(st, TREE));
  ok(on(st, 'done').boss === sd('peerDone') && on(st, 'done').via === 'msg', 'done 听的是前任 askQ 的 → 跟着岗位挂到现任 peerDone', show(st, TREE));
  // 按项目挂上（11/17）：没有窗口在管的，和负责人 peerDone 同一个项目的挂到它下面，别的项目（这里都没有负责人）挂到总管 projC
  const pkey = (n) => (by(st, n).project || {}).key, seatOf = (n) => (pkey(n) === pkey('peerDone') ? sd('peerDone') : sd('projC'));
  const placed = (n) => on(st, n).boss === seatOf(n) && on(st, n).via === 'dept' && on(st, n).n === 0;
  ok(on(st, 'run').boss === sd('peerDone') && on(st, 'run').via === 'contact' && on(st, 'run').n === 1 && on(st, 'run').for === sd('peerDone'), 'run 正在跑、这一轮是 peerDone 的一条消息开的：for 指向它；只有 1 条，不算派活（via 不是 msg）；负责人给它发过消息，挂到它（via contact，n 1；11/17 win-49 之前是 via dept）', show(st, TREE));
  ok(on(st, 'links').role === 'member' && placed('links') && placed('limit') && placed('projF') && pkey('projF') !== pkey('peerDone') && on(st, 'projF').boss === sd('projC'),
    '名字里带「总管」但比点名的总管晚开的 links 是普通窗口；没有证据的窗口按项目挂上：和 peerDone 同项目的挂到它，projF（FretFlow，那里没有负责人）挂到总管', show(st, TREE.concat(['projF'])) + ' ' + JSON.stringify(['links', 'limit', 'projF', 'peerDone'].map(pkey)));
  const fr = (n) => on(st, n).from || [];
  ok(fr('unfin').length === 1 && fr('unfin')[0][0] === sd('peerDone') && fr('unfin')[0][1] === 3 && fr('unfin')[0][2] === recAt('unfin', 3) && JSON.stringify(fr('done').map((x) => [x[0], x[1]])) === JSON.stringify([[sd('askQ'), 3]]),
    'from：[发信人 sid, 条数, 最近一条的时间]（unfin 最近一条是这一轮里第二条的时间）', JSON.stringify({ unfin: fr('unfin'), done: fr('done') }));
  ok(on(st, 'done').for === 'you' && on(st, 'peerDone').for === null && fr('peerDone').length === 0, 'for：他本人开的一轮是 you；peerDone 这一轮是 win-f2 开的，没有这个窗口 → null，from 里也不列认不出的', show(st, ['done', 'peerDone']) + ' ' + JSON.stringify(fr('peerDone')));
  ok(JSON.stringify(fr('orgRecv').map((x) => [x[0], x[1]])) === JSON.stringify([[sd('orgRen'), 2]]), '认发信人：进程号对得上但那个会话开得比消息晚（orgLate）→ 不认；pid 认不出时按名字，登记名包含它且唯一（orgRen）→ 认；两个窗口重名（win-0b）→ 不认', JSON.stringify(fr('orgRecv')));
  ok(on(st, 'orgHum').boss === sd('peerDone') && on(st, 'orgHum').via === 'contact' && on(st, 'orgHum').n === 3, '他本人最近说了 6 轮，负责人发来 3 条：不算负责人在派活（via 不是 msg，他说了几轮是从对话记录里数的）；负责人确实发过消息，挂到它（via contact，n 3；11/17 win-49 之前是 via dept）', show(st, ['orgHum']) + ' ' + pkey('orgHum'));
  ok(on(st, 'orgHead').role === 'head' && on(st, 'orgHead').boss === sd('peerDone') && on(st, 'orgHead').via === 'seat' && on(st, 'peerDone').role === 'lead',
    '分支负责人：登记名「FretFlow 推广负责人」→ role head，挂在同一个项目的负责人 peerDone 下面（via seat），不是它的前任（服务把 headWords 交给了 org.mjs）', show(st, ['orgHead', 'peerDone']));
  // 已经不在的发信人（gone）：进程号认不出活会话的，做成 gone 项交给 org.mjs；名字带「总指挥」就是前任，听它的跟着岗位归现任
  ok(on(st, 'orgOld').boss === sd('peerDone') && on(st, 'orgOld').via === 'msg' && on(st, 'orgOld').handed === true && on(st, 'orgOld').n === 3,
    '不在的前任总指挥（进程已退出、改过一次名，一共 3 条）：orgOld 跟着岗位归现任 peerDone，handed 是 true，n 是合起来的 3', JSON.stringify(on(st, 'orgOld')));
  const gk = (x) => typeof x === 'string' && x.startsWith('gone:');
  const allN = Object.entries(orgOf(st).nodes);
  ok(!allN.some(([k, x]) => gk(k) || gk(x.boss) || (x.from || []).some((f) => gk(f[0]))), 'org.nodes 里没有 gone: 开头的键，没有谁的上级指着它，给界面的 from 里也只有活会话', JSON.stringify(allN.filter(([k, x]) => gk(k) || gk(x.boss) || (x.from || []).some((f) => gk(f[0]))).slice(0, 3)));
  ok(on(st, 'done').handed === true && on(st, 'unfin').handed === false && on(st, 'hint').handed === false && on(st, 'askQ').handed === false && fr('orgOld').length === 0,
    'handed：听活着的前任 askQ 的 done 改挂过 → true；直接听现任的 unfin、hint，前任 askQ 自己 → false', show(st, ['done', 'unfin', 'hint', 'askQ']) + ' ' + JSON.stringify(['done', 'unfin', 'hint', 'askQ'].map((n) => on(st, n).handed)));
  const allNodes = Object.keys(orgOf(st).nodes);
  ok(allNodes.length === st.sessions.length && st.sessions.every((s) => allNodes.includes(s.sid)), '墙上每个会话在 org.nodes 里都有一项', allNodes.length + ' / ' + st.sessions.length);
  ok(by(st, 'done').ctx === 41205 && by(st, 'limit').ctx === 7000 && by(st, 'err').ctx === null, 'ctx：最近一条主线真回复的 usage 三项相加（done 41205；子 agent 的不算；limit 后面那条额度报错带的不算 → 7000；一条真回复都没有 → null）', [by(st, 'done').ctx, by(st, 'limit').ctx, by(st, 'err').ctx].join(' '));
  ok(by(st, 'run').sub === 2 && by(st, 'done').sub === 0 && st.sessions.every((s) => typeof s.sub === 'number'), 'sub：在跑的 run 的 subagents 里 90 秒内改过的 .jsonl 有 2 份（5 分钟前的、.meta.json 不算）；歇着的 done 不数 → 0', [by(st, 'run').sub, by(st, 'done').sub].join(' '));
  const pk = await get('/api/state?peek=1');
  ok(pk.peek === true && pk.org && pk.org.chief === sd('projC') && on(pk, 'unfin').boss === sd('peerDone'), 'peek=1 照样带 org');
  // 点名总管的文件坏了：退回按名字里的「总管」字样认（links）；修好了又回到点名的那个。服务最多每 CCBOARD_CHIEF_MS（这里 1 秒）重读一次
  fs.writeFileSync(CHIEF, '{ 写坏了');
  const stB = await until(async () => { const r = await get('/api/state'); return r.org && r.org.chief === sd('links') ? r : null; }, 8000);
  ok(stB && stB.org.chief === sd('links') && stB.org.gen === null && on(stB, 'peerDone').role === 'member', '点名的文件坏了 → 按字样认 links 当总管（gen 是 null）；它在 其他 这一组，那里就不另立负责人', stB ? show(stB, ['links', 'peerDone', 'projC']) : 'timeout');
  fs.writeFileSync(CHIEF, JSON.stringify({ window: 'w-projC', session_id: S.projC.sid, generation: 3 }));
  const stC = await until(async () => { const r = await get('/api/state'); return r.org && r.org.chief === sd('projC') ? r : null; }, 8000);
  ok(stC && stC.org.gen === 3 && on(stC, 'peerDone').role === 'lead', '文件修好 → 又回到点名的 projC', stC ? show(stC, ['projC', 'peerDone']) : 'timeout');
  // 「…分支」（11/17 win-49）：服务把新的默认字样交给 org.mjs；只收过分支 1 条消息的挂到它（via contact）
  ok(on(stC, 'orgBr').role === 'head' && on(stC, 'orgBr').boss === sd('peerDone') && on(stC, 'orgGit').role === 'member' && on(stC, 'orgBrW').boss === sd('orgBr') && on(stC, 'orgBrW').via === 'contact' && on(stC, 'orgBrW').n === 1,
    '标题「字体与排版分支」（不带 FretFlow：带了会被分到 FretFlow 那一组）、在给 orgBrW 发消息 → 分支，挂在 peerDone 下面；「car3 合并分支」同样发了消息也是普通窗口；orgBrW 只收过分支 1 条 → 挂到 orgBr（via contact，n 1）', show(stC, ['orgBr', 'orgGit', 'orgBrW', 'peerDone']));
  // org.seats（11/17 win-49）：config 里三条，一条 key 不合规丢掉，整份 config 照用（autoTrust 这些还在），日志记 2 条
  const cfgLine = (log().match(/^config .*$/m) || [''])[0];
  ok(/org\.seats=2（丢掉 1 条写错的）/.test(cfgLine) && /autoTrust=true/.test(cfgLine), 'config：org.seats 有一条写错只丢那一条，整份照用；日志 org.seats=2（丢掉 1 条写错的）', cfgLine);
  ok(pkey('peerDone') === 'other' && !fs.existsSync(SEAT) && on(stC, 'peerDone').role === 'lead', '点名文件还没建：照旧按字样认 peerDone（它在 other 这一组）', pkey('peerDone'));
  const regOf = (n) => by(stC, n).regName;
  fs.writeFileSync(SEAT, regOf('unfin') + ' [abc123]\n会话 ' + sd('unfin') + '\n');
  const stSeat = await until(async () => { const r = await get('/api/state'); return on(r, 'unfin').role === 'lead' ? r : null; }, 8000);
  ok(stSeat && on(stSeat, 'unfin').boss === sd('projC') && on(stSeat, 'unfin').via === 'seat' && on(stSeat, 'peerDone').role !== 'lead' && on(stSeat, 'orgBr').boss === sd('unfin'),
    '写进点名文件（第一行窗口名、第二行会话号）→ unfin 当这一组的负责人（归总管），peerDone 不再是负责人，分支 orgBr 挂到 unfin 下面', stSeat ? show(stSeat, ['unfin', 'peerDone', 'orgBr']) : 'timeout');
  ok(log().includes('点名负责人 other → ' + regOf('unfin') + '（' + sd('unfin').slice(0, 8) + '）'), '日志记一行「点名负责人 other → <窗口名>（会话号前 8 位）」', (log().match(/^org .*点名负责人.*$/gm) || []).join(' | '));
  fs.writeFileSync(SEAT, regOf('unfin') + '\n会话 ' + sd('hint') + '\n');   // 名字是 unfin、会话号是 hint：对不上
  let lastM = null;
  const stSeatM = await until(async () => { const r = await get('/api/state'); lastM = r; return on(r, 'peerDone').role === 'lead' ? r : null; }, 8000);
  ok(stSeatM && on(stSeatM, 'unfin').role !== 'lead' && on(stSeatM, 'hint').role !== 'lead' && log().includes('other → 认不出：点名的窗口不在墙上，或名字和会话号对不上（' + regOf('unfin') + ' / ' + sd('hint').slice(0, 8) + '）'),
    '名字（unfin）和会话号（hint）对不上：认不出，退回按字样认 peerDone，日志写清对不上的两样', (stSeatM ? '' : 'timeout ') + show(stSeatM || lastM, ['peerDone', 'unfin', 'hint', 'askQ']) + ' ' + (log().match(/^org .*点名负责人.*$/gm) || []).slice(-2).join(' | '));
  fs.writeFileSync(SEAT, regOf('unfin') + '\n会话 ' + sd('unfin') + '\n'); await until(async () => on(await get('/api/state'), 'unfin').role === 'lead', 8000);
  fs.rmSync(SEAT);
  const stSeatD = await until(async () => { const r = await get('/api/state'); return on(r, 'peerDone').role === 'lead' ? r : null; }, 8000);
  ok(stSeatD && on(stSeatD, 'unfin').role !== 'lead', '点名文件删掉：退回按字样认 peerDone（后面各段照旧）', stSeatD ? show(stSeatD, ['peerDone', 'unfin']) : 'timeout');

  const recordedSeat = (histNow().other || []).find((x) => x.sid === sd('unfin'));
  ok(recordedSeat && recordedSeat.procs.some(([pid, at]) => pid === S.unfin.pid && at === S.unfin.at), 'history: 点名命中后 sid 与 pid/startedAt 原子落盘', JSON.stringify(recordedSeat));
  ok(on(stSeatD, 'histRecv').boss === sd('peerDone') && on(stSeatD, 'histRecv').via === 'msg' && on(stSeatD, 'histRecv').handed === true, 'history: 已退出的无岗位字样前任按历任 pid 认出，队伍跟现任且 handed', JSON.stringify(on(stSeatD, 'histRecv')));
  ok(on(stSeatD, 'histReuse').handed === false && on(stSeatD, 'histTwin').handed === false, 'history: 消息早于该 pid 启动时间、同名不同 pid：都不混认前任', JSON.stringify([on(stSeatD, 'histReuse'), on(stSeatD, 'histTwin')]));
  ok(on(stSeatD, 'histDup').boss === sd('peerDone') && on(stSeatD, 'histDup').via === 'msg' && on(stSeatD, 'histDup').handed === true && on(stSeatD, 'histX7').role === 'member',
    'history: 名单里的前任进程用的名字和墙上一个活窗口重名：不按名字算给重名的 histX7，照样跟现任且 handed', JSON.stringify({ dup: on(stSeatD, 'histDup'), x7: sd('histX7') }));

  console.log('\n[1d] 这一轮改了哪些文件（wrote / wroteMore）和撞车提示（collide：30 分钟内墙上两个会话往同一个 git 仓库里写过）');
  st = await get('/api/state');
  const wl = (r, n) => { const s = by(r, n); return !s ? 'MISSING' : !Array.isArray(s.wrote) ? 'wrote=' + JSON.stringify(s.wrote) : s.wrote.map((x) => String(x.path).replace(/^~\/Projects\//, '') + '×' + x.n).join(' '); };
  const wr = (r, n) => { const s = by(r, n); return s ? JSON.stringify({ wrote: s.wrote, wroteMore: s.wroteMore, collide: s.collide }) : 'MISSING'; };
  ok(st.sessions.every((s) => Array.isArray(s.wrote) && Number.isInteger(s.wroteMore) && (s.collide === null || Array.isArray(s.collide))) && JSON.stringify([by(st, 'done').wrote, by(st, 'done').wroteMore, by(st, 'done').collide]) === '[[],0,null]',
    '每个会话都有 wrote（数组）、wroteMore（整数）、collide（null 或数组）；没改过文件的 done → [] / 0 / null', wr(st, 'done'));
  ok(wl(st, 'wFiles') === 'repoW/src/a.js×3 repoW/n.ipynb×1 repoW/b.md×1' && by(st, 'wFiles').wrote[0].path === '~/Projects/repoW/src/a.js' && by(st, 'wFiles').wroteMore === 0,
    'wFiles：这一轮写过的文件带次数（Edit、MultiEdit、Write、NotebookEdit 都算，MultiEdit 一次算一次），写得多的在前、一样多的最近写的在前，路径缩写成 ~/', wr(st, 'wFiles'));
  ok(by(st, 'wFiles') && Array.isArray(by(st, 'wFiles').wrote) && !/old\.js/.test(wl(st, 'wFiles')), 'wFiles：上一轮改过的 old.js 不在这一轮的单子里', wl(st, 'wFiles'));
  ok(by(st, 'wFiles') && Array.isArray(by(st, 'wFiles').wrote) && !/c\.js|d\.txt|repoW\/src×/.test(wl(st, 'wFiles')), 'wFiles：Read（c.js）、Grep（src 文件夹）、Bash 里的重定向（d.txt）都不算写', wl(st, 'wFiles'));
  ok(wl(st, 'wTurn') === 'repoT/x.js×1' && by(st, 'wTurn').digest && by(st, 'wTurn').digest.need === 'review', 'wTurn：交付以后（待审阅）照旧列着这一轮改的 x.js', wr(st, 'wTurn'));
  ok(wl(st, 'wPeer') === 'repoP/p2.js×1 repoP/p1.js×1', 'wPeer：一轮做到一半别的窗口发来的消息不算新的一轮，p1 照旧在', wr(st, 'wPeer'));
  const wm = by(st, 'wMany') || {}, wmp = (wm.wrote || []).map((x) => x.path.replace(/^.*\//, '') + '×' + x.n);
  ok(wmp.length === 20 && wm.wroteMore === 5 && wmp[0] === 'f07.txt×3' && wmp[1] === 'f25.txt×1' && wmp[19] === 'f06.txt×1' && !wmp.some((x) => /^f0[1-5]\./.test(x)),
    'wMany：写了 25 个文件 → 列 20 个（改了 3 次的 f07 在最前，其余最近写的在前），wroteMore 5（最早写的 f01–f05 没列）', JSON.stringify([wmp, wm.wroteMore]));
  const cl = (r, n) => (by(r, n) || {}).collide;
  const cTo = (r, n, repo) => ((cl(r, n) || []).find((c) => c.repo === repo) || { with: [] }).with.map((w) => Object.keys(S).find((k) => S[k].sid === w.sid) + ':' + w.name).join(',');
  ok(cTo(st, 'cA', '~/Projects/repoC') === 'cB:w-cB' && cTo(st, 'cB', '~/Projects/repoC') === 'cA:w-cA', 'cA、cB 刚才都往 repoC 里写：两边的 collide 都写着 ~/Projects/repoC 和对方（sid + 卡片标题）', JSON.stringify([cl(st, 'cA'), cl(st, 'cB')]));
  ok(cl(st, 'cOld') === null && !/cOld/.test(cTo(st, 'cA', '~/Projects/repoC')), 'cOld 45 分钟前也写过 repoC（记录里的时间过了 30 分钟的线）→ 它没有 collide，也不在 cA 的单子里', JSON.stringify([cl(st, 'cOld'), cl(st, 'cA')]));
  ok(cTo(st, 'cW1', '~/Projects/repoC/wt') === 'cW2:w-cW2' && cTo(st, 'cW2', '~/Projects/repoC/wt') === 'cW1:w-cW1' && (cl(st, 'cA') || []).length === 1 && !/cW/.test(cTo(st, 'cA', '~/Projects/repoC')),
    'worktree（.git 是文件）自己算一个仓库：cW1、cW2 撞在 ~/Projects/repoC/wt；cA 只撞 repoC 一处，单子里没有它们', JSON.stringify([cl(st, 'cW1'), cl(st, 'cA')]));
  ok(cl(st, 'cSelf') === null && wl(st, 'cSelf') === 'repoS/b.js×1 repoS/a.js×1', 'cSelf：同一个会话在同一个仓库里写两个文件 → 不撞自己', wr(st, 'cSelf'));
  ok(cl(st, 'cD1') === null && cl(st, 'cD2') === null, 'cD1、cD2 各写各的仓库 → 都没有 collide', JSON.stringify([cl(st, 'cD1'), cl(st, 'cD2')]));
  ok(cl(st, 'cN1') === null && cl(st, 'cN2') === null && wl(st, 'cN1') === 'norepo/a.txt×1', 'cN1、cN2 都写 norepo（不在任何仓库里；主目录自己的 .git 不算）→ 都没有 collide，wrote 照旧列着', JSON.stringify([cl(st, 'cN1'), cl(st, 'cN2'), wl(st, 'cN1')]));
  if (TMUX_BIN) {   // Codex 会话（只在有 tmux 时放）：补丁头的三种写法，和 Claude 会话 cX 撞在 repoX
    const cxs = await until(async () => { const r = await get('/api/state'); const c = r.sessions.find((x) => x.tmux === CDX); return c && Array.isArray(c.wrote) && c.wrote.length ? r : null; }, 8000) || await get('/api/state');
    const cx = cxs.sessions.find((x) => x.tmux === CDX) || {}, cxl = (cx.wrote || []).map((x) => String(x.path).replace(/^~\/Projects\//, '') + '×' + x.n).join(' ');
    ok(cxl === 'repoX/gone.js×1 repoX/moved.js×1 repoX/old.js×1 ~/work/rel/cx2.js×1 repoX/cx1.js×1',
      'Codex：补丁头里的文件都算写（exec 的 JS 源码里 \\n 两个字符的写法、直接的 apply_patch、shell 的 JSON 参数；Move to 两头都算），相对路径 rel/cx2.js 按会话的工作目录补全成 ~/work/rel/cx2.js（界面上点得开），exec 里只读的 read.js 不算', JSON.stringify(cx.wrote));
    const cxC = (cl(cxs, 'cX') || []).find((c) => c.repo === '~/Projects/repoX'), cdC = (cx.collide || []).find((c) => c.repo === '~/Projects/repoX');
    ok(!!cxC && cxC.with.length === 1 && cxC.with[0].sid === cx.sid && !!cdC && cdC.with.length === 1 && cdC.with[0].sid === S.cX.sid && (cx.collide || []).length === 1,
      'Claude 会话 cX 和 Codex 会话都往 repoX 里写 → 两边互相挂 collide（rel/cx2.js 落在主目录下的 work，不算仓库，不另起一处）', JSON.stringify([cl(cxs, 'cX'), cx.collide]));
    // Codex 新的一轮：他又说了一句（同一句话，卡片的 prompt 不变，[7d] 还要断言它）→ 上一轮的五个文件清掉，只列这一轮补丁写的 next.js
    const roll = path.join(FH, '.codex/sessions/2026/11/13/rollout-fixture.jsonl'), t2 = new Date().toISOString();
    fs.appendFileSync(roll, [{ type: 'response_item', timestamp: t2, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex 夹具任务' }] } },
      { type: 'response_item', timestamp: t2, payload: { type: 'custom_tool_call', name: 'exec', call_id: 'cx5', input: 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: ' + PJ('repoX', 'next.js') + '\\n@@\\n-a\\n+b\\n*** End Patch\\n"));' } },
      { type: 'event_msg', timestamp: t2, payload: { type: 'task_complete', last_agent_message: '夹具做完了' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
    const cx2 = await until(async () => { const r = await get('/api/state'); const c = r.sessions.find((x) => x.tmux === CDX); return c && (c.wrote || []).some((w) => /next\.js/.test(w.path)) ? c : null; }, 8000) || {};
    ok((cx2.wrote || []).map((x) => String(x.path).replace(/^~\/Projects\//, '') + '×' + x.n).join(' ') === 'repoX/next.js×1' && cx2.prompt === 'Codex 夹具任务',
      'Codex：他说了新的一句 → 上一轮的五个文件清掉，只列这一轮补丁写的 next.js（卡片的 prompt 照旧）', JSON.stringify([cx2.wrote, cx2.prompt]));
  }
  ok(['wFiles', 'wTurn', 'wPeer', 'wMany'].every((n) => cl(st, n) === null), '只有自己写的仓库（repoW / repoT / repoP / repoM）→ 没有 collide', JSON.stringify(['wFiles', 'wTurn', 'wPeer', 'wMany'].map((n) => cl(st, n))));
  ok(wl(st, 'wKeep') === 'repoK/k1.js×2 repoK/k2.js×2', 'wKeep：一轮里压缩了对话、最后被打断都不清单子；一样多的按最后一次写排（k1 最后又写了一次，在前）；子 agent 的写（k3）不算', wr(st, 'wKeep'));
  ok(cTo(st, 'bA', '~/Projects/repoB') === 'bB:w-bB' && cTo(st, 'bB', '~/Projects/repoB') === 'bA:w-bA',
    'Bash：bA（cd 仓库 && git add / commit）和 bB（不带路径的 git merge，按这条记录的 cwd）撞在 repoB', JSON.stringify([cl(st, 'bA'), cl(st, 'bB')]));
  ok(cl(st, 'bR') === null && (cl(st, 'bA') || []).length === 1, 'Bash：bR 在 repoB 里只读（git status / log、echo 引号里的 >、heredoc 正文里的 git commit 和重定向）→ 不算写；bA 提交说明里的「cd repoE && git commit」不当命令（只撞 repoB 一处）',
    JSON.stringify([cl(st, 'bR'), cl(st, 'bA')]));
  ok(cTo(st, 'bE1', '~/Projects/repoE') === 'bE2:w-bE2' && cTo(st, 'bE2', '~/Projects/repoE') === 'bE1:w-bE1', 'Bash：cp 的目标（bE1）、tee -a 和 heredoc 的 cat >（bE2）都算写进 repoE；> /dev/null 不算', JSON.stringify([cl(st, 'bE1'), cl(st, 'bE2')]));
  ok(['bA', 'bB', 'bE1', 'bE2'].every((n) => wl(st, n) === ''), 'Bash 里的写只进撞车，不进「这一轮改了哪些文件」', JSON.stringify(['bA', 'bB', 'bE1', 'bE2'].map((n) => wl(st, n))));
  // 新的一轮从哪里开始：被后台任务通知叫醒接着做不算；他本人说话才清（清在开口那一刻，之后写的才进新单子）；别的窗口在交付之后发来的也算新的一轮
  append('wTurn', R.notif(), W('Edit', PJ('repoT', 'z.js')), R.result(), R.final('z 也改好了。'));
  let s1 = await until(async () => { const r = await get('/api/state'); return /z\.js/.test(wl(r, 'wTurn')) ? r : null; }, 8000) || await get('/api/state');
  ok(wl(s1, 'wTurn') === 'repoT/z.js×1 repoT/x.js×1', 'wTurn：交付后被后台任务通知叫醒又改了 z.js → 和 x.js 列在同一轮（通知不算新的一轮）', wr(s1, 'wTurn'));
  append('wTurn', R.human('再改 y'));
  s1 = await until(async () => { const r = await get('/api/state'); return (by(r, 'wTurn') || {}).prompt === '再改 y' ? r : null; }, 8000) || await get('/api/state');
  ok((by(s1, 'wTurn') || {}).prompt === '再改 y' && wl(s1, 'wTurn') === '' && by(s1, 'wTurn').wroteMore === 0, 'wTurn：他本人说了新的一句（还没动手）→ 上一轮的单子这时才清空', wr(s1, 'wTurn'));
  append('wTurn', W('Edit', PJ('repoT', 'y.js')), R.result(), R.final('y 改好了。'));
  s1 = await until(async () => { const r = await get('/api/state'); return /y\.js/.test(wl(r, 'wTurn')) ? r : null; }, 8000) || await get('/api/state');
  ok(wl(s1, 'wTurn') === 'repoT/y.js×1', 'wTurn：新的一轮只列这一轮改的 y.js', wr(s1, 'wTurn'));
  append('wPeer', R.peer('win-w7', '再改 p3'), W('Edit', PJ('repoP', 'p3.js')), R.result(), R.final('p3 改好了。\n\n【待审阅】p3 改好了'));
  s1 = await until(async () => { const r = await get('/api/state'); return /p3\.js/.test(wl(r, 'wPeer')) ? r : null; }, 8000) || await get('/api/state');
  ok(wl(s1, 'wPeer') === 'repoP/p3.js×1', 'wPeer：交付之后别的窗口又发来一条 = 新的一轮，只列 p3.js', wr(s1, 'wPeer'));

  console.log('\n[1e] Code Mode（11/17）：codeMode 取记录里最后一条 repl-mode；脚本里真正跑的工具（<synthetic> + isVirtual）进步数和「这一轮改了哪些文件」，不改这一轮的状态和卡片上的当前工具');
  st = await get('/api/state');
  const cm = (n) => by(st, n) || {};
  ok(cm('cmReal').codeMode === true && cm('cmBusy').codeMode === true && cm('cmLate').codeMode === true && cm('recover').codeMode === true, 'codeMode：记录里有 repl-mode true 的四个会话是 true（真实记录 cmReal / cmBusy，手搭的 cmLate、recover）', JSON.stringify(['cmReal', 'cmBusy', 'cmLate', 'recover'].map((n) => cm(n).codeMode)));
  ok(cm('cmOff').codeMode === false && cm('cmQuote').codeMode === false && cm('done').codeMode === false && cm('cmBad').codeMode === true, 'codeMode：中途关掉的（最后一条 false）是 false；别的记录里嵌着的 repl-mode 对象不算；普通会话 false', JSON.stringify(['cmOff', 'cmQuote', 'done', 'cmBad'].map((n) => cm(n).codeMode)));
  ok(cm('cmNest').codeMode === true && cm('cmEdge').codeMode === true, 'codeMode：真的 repl-mode true 后面有一条记录里嵌着 replMode: false 的对象（cmNest）→ 仍是 true；最后一条 repl-mode 后面还有别的记录（cmEdge）→ true', JSON.stringify(['cmNest', 'cmEdge'].map((n) => cm(n).codeMode)));
  ok(cTo(st, 'vA', '~/Projects/repoV') === 'vB:w-vB' && cTo(st, 'vB', '~/Projects/repoV') === 'vA:w-vA' && wl(st, 'vA') === '' && cm('vA').steps === 2,
    'vA：Code Mode 脚本里跑的 git commit（虚拟 Bash）进撞车，和普通 Edit 的 vB 撞在 repoV；Bash 的写照旧不进「这一轮改了哪些文件」；步数 2 = REPL + 脚本里的 Bash', JSON.stringify([cl(st, 'vA'), cl(st, 'vB'), wl(st, 'vA'), cm('vA').steps]));
  ok(cm('cmReal').steps === 19, 'cmReal：步数 19 = 模型发的 4 次（REPL ×3 + Poll）+ 脚本里真正跑的 15 次（以前只数到 4）', String(cm('cmReal').steps));
  ok(wl(st, 'cmReal') === '~/cm/summary.txt×2 ~/cm/c.txt×1', 'cmReal：这一轮改了哪些文件 = 脚本里的 Write 两次（新建、覆盖）和 Edit 一次（以前是空的）', wr(st, 'cmReal'));
  ok(cm('cmReal').done === true && cm('cmReal').tool === null && /a\.md 有 2 行/.test(cm('cmReal').result || ''), 'cmReal：照旧是交付（虚拟调用的 stop_sequence 不被当成又一次交付或又开始干活）', JSON.stringify({ done: cm('cmReal').done, tool: cm('cmReal').tool, result: (cm('cmReal').result || '').slice(0, 20) }));
  ok(cm('cmBusy').tool === 'Fix off-by-one in summary.txt' && cm('cmBusy').steps === 19 && cm('cmBusy').done === false && cm('cmBusy').result === null, 'cmBusy：当前工具是第三段 REPL 自己写的说明，不是后面的 Poll、也不是脚本里最后那个 Read；步数照样 19', JSON.stringify({ tool: cm('cmBusy').tool, steps: cm('cmBusy').steps, done: cm('cmBusy').done }));
  ok(cm('cmLate').done === true && cm('cmLate').tool === null && cm('cmLate').result === '看过了，没问题。' && cm('cmLate').steps === 1, 'cmLate：交付以后才写进来的一条虚拟调用只加步数，卡片照旧是交付（不变成「在做」、不出当前工具）', JSON.stringify({ done: cm('cmLate').done, tool: cm('cmLate').tool, steps: cm('cmLate').steps }));
  const tu1e = await get('/api/turns?sid=' + S.cmReal.sid), lt1e = (tu1e.turns || []).slice(-1)[0] || {};
  ok(lt1e.steps === 19 && (lt1e.results || []).length === 1, '放大看（/api/turns）：这一轮的步数也是 19，交付只有一条（虚拟调用不算交付）', JSON.stringify({ steps: lt1e.steps, results: (lt1e.results || []).length }));


  console.log('\n[1f] 看这一轮的改动：按轮次、文件、工具和已扫描字节读记录');
  {
    const names = [], pair = (tool, file, hunks, extra = {}) => {
      const call = W(tool, file), id = call.message.content[0].id;
      const result = { type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, ...(extra.failed ? { is_error: true } : {}), content: '完成' }] },
        ...(extra.missing ? {} : { toolUseResult: { structuredPatch: hunks, ...extra } }) };
      return [call, result];
    };
    const H = (n, word = 'new') => [{ oldStart: n, oldLines: 2, newStart: n, newLines: 2, lines: [' context', '-old', '+' + word] }];
    const f = '~/code/diff/app.js', fresh = '~/code/diff/new.txt', old = '~/code/diff/old.js';
    const a = pair('Edit', f, H(1)), b = pair('Edit', f, H(4)), c = pair('Write', f, H(7));
    const make = (n, recs) => { names.push(n); mk(n, 'idle', recs); return S[n]; };
    make('dfMain', [R.human('上一轮'), ...pair('Edit', f, H(90)), ...pair('Edit', old, H(91)), R.final('上一轮完成。'), R.human('这一轮'),
      ...a, ...b, ...c, ...pair('Write', fresh, [], { type: 'create', content: '第一行\n第二行\n' }), ...pair('MultiEdit', '~/code/diff/multi.js', H(2)),
      ...pair('Edit', '~/code/diff/fail.js', [], { failed: true }), ...pair('Edit', '~/code/diff/missing.js', [], { missing: true }),
      ...pair('NotebookEdit', '~/code/diff/book.ipynb', undefined),
      ...pair('Edit', f, H(80)).map(r => ({ ...r, isSidechain: true })), ...pair('Read', f, H(81)), R.final('这一轮完成。')]);
    make('dfPeer', [R.human('开始'), ...pair('Edit', f, H(1)), R.peer('worker-a', '中途补充'), ...pair('Edit', f, H(2)), R.final('完成。')]);
    const virt = pair('Edit', f, H(3)); virt[0].isVirtual = true; virt[0].message.model = '<synthetic>';
    make('dfVirt', [R.human('开始'), ...virt, R.final('完成。')]);
    const big = H(1, '汉字'.repeat(110000)); make('dfBig', [R.human('开始'), ...pair('Edit', f, big), ...pair('Edit', f, H(2)), R.final('完成。')]);
    make('dfEdge', [R.human('旧轮'), ...pair('Edit', f, H(98)), R.final('旧轮结束。')]);
    // 无轮首的超长记录：服务最多重建最后 48 MiB，接口必须从同一段开始。
    make('dfTail', [...pair('Edit', f, H(99))]);
    const pad = JSON.stringify({ type: 'api-request-blob', body: 'x'.repeat((1 << 20) - 60) }) + '\n';
    const fd = fs.openSync(S.dfTail.file, 'a'); for (let i = 0; i < 50; i++) fs.writeSync(fd, pad); fs.closeSync(fd);
    append('dfTail', ...pair('Edit', f, H(5)), R.final('尾巴里的交付。'));
    const pathQ = (name, file) => '/api/diff?sid=' + encodeURIComponent(S[name]?.sid || name) + '&path=' + encodeURIComponent(file);
    const diff = (name, file = f, port = PORT) => rq(port, 'GET', pathQ(name, file), { 'x-ccboard': TOKEN });
    await until(async () => by(await get('/api/state?peek=1'), 'dfMain')?.wrote?.some(x => x.path === f));
    const d = await diff('dfMain'), items = d.body?.items || [];
    ok(d.code === 200 && d.body.ok && d.body.path === f && d.body.truncated === false, '改动：接口返回路径、数组和未截断标记');
    ok(items.length === 3 && JSON.stringify(items.map(x => [x.at, x.tool, x.hunks])) === JSON.stringify([a, b, c].map(p => [p[0].timestamp, p[0].message.content[0].name, p[1].toolUseResult.structuredPatch])), '改动：只含这一轮三笔、先后和工具正确、补丁逐字一致');
    const created = (await diff('dfMain', fresh)).body?.items || [];
    ok(created.length === 1 && created[0].create === true && JSON.stringify(created[0].hunks) === JSON.stringify([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+第一行', '+第二行'] }]), '改动：新建文件转成两条加行，不多算末尾换行');
    const multi = (await diff('dfMain', '~/code/diff/multi.js')).body?.items || [];
    ok(multi.length === 1 && multi[0].tool === 'MultiEdit', '改动：一次多处编辑只出一块');
    const failed = (await diff('dfMain', '~/code/diff/fail.js')).body?.items || [], missing = (await diff('dfMain', '~/code/diff/missing.js')).body?.items || [];
    const current = by(await get('/api/state?peek=1'), 'dfMain');
    ok(failed.length === 1 && failed[0].failed && failed[0].hunks.length === 0 && failed.length === current.wrote.find(x => x.path.endsWith('/fail.js')).n && missing[0]?.failed, '改动：失败或缺结果的一笔保留空块，块数等于调用次数');
    ok((await diff('dfMain', '~/code/diff/book.ipynb')).body?.items?.[0]?.nopatch === true, '改动：工具有结果但没有补丁时明确标记');
    ok(items.length === 3 && !items.some(x => x.tool === 'Read' || x.hunks?.[0]?.oldStart === 80), '改动：同路径的读取和子任务补丁都不混入');
    for (const denied of ['~/code/diff/other.js', '/etc/hosts', '~/code/diff/../diff/app.js', old]) ok((await diff('dfMain', denied)).code === 404, '改动：清单安全门拒绝 ' + denied);
    ok((await diff('absent', f)).code === 404, '改动：不存在的会话返回找不到');
    const noDiff = await rq(PORT, 'GET', pathQ('dfMain', f)), noTurns = await rq(PORT, 'GET', '/api/turns?sid=' + S.dfMain.sid);
    ok(noDiff.code === noTurns.code && noDiff.code === 403, '改动：未带口令与对话接口一样被拒绝');
    ok((await diff('dfVirt')).body?.items?.length === 1, '改动：虚拟编辑有对应结果时照样显示');
    ok((await diff('dfPeer')).body?.items?.length === 2, '改动：一轮中途的窗口消息不清边界');
    append('dfPeer', R.peer('worker-a', '下一轮'), ...pair('Edit', f, H(6)), R.final('下一轮完成。'));
    await until(async () => by(await get('/api/state?peek=1'), 'dfPeer')?.wrote?.find(x => x.path === f)?.n === 1);
    const pd = (await diff('dfPeer')).body?.items || [];
    ok(pd.length === 1 && pd[0].hunks?.[0]?.oldStart === 6, '改动：交付后别的窗口开新轮，只保留新一笔');
    const bd = await diff('dfBig'); ok(bd.code === 200 && bd.body?.truncated && Buffer.byteLength(bd.text) <= 512 * 1024, '改动：超过六百 KB 的补丁截断，整个应答不超过五百一十二 KB');
    ok((await diff('dfTail')).body?.items?.length === 1 && (await diff('dfTail')).body.items[0].hunks[0].oldStart === 5, '改动：尾巴没有轮首也只读清单重建范围，不回到文件头');
    // 人的话跨过一 MiB 块边界；按字节而非字符计算，前一轮就在同一块中。
    append('dfEdge', { type: 'file-history-snapshot', text: '汉'.repeat(350000) }, R.human('新轮' + '字'.repeat(360000)), ...pair('Edit', f, H(10)), R.final('跨块完成。'));
    await until(async () => by(await get('/api/state?peek=1'), 'dfEdge')?.result === '跨块完成。');
    const edge = (await diff('dfEdge')).body?.items || [];
    ok(edge.length === 1 && edge[0].hunks?.[0]?.oldStart === 10, '改动：一 MiB 跨块和中文不移错轮首，上一轮补丁不出现');
    const half = JSON.stringify(R.human('半行跨两拍' + '界'.repeat(600))); const cut = Buffer.from(half), split = cut.length - 11;
    fs.appendFileSync(S.dfEdge.file, cut.subarray(0, split)); await sleep(1800);
    fs.appendFileSync(S.dfEdge.file, cut.subarray(split)); fs.appendFileSync(S.dfEdge.file, '\n'); append('dfEdge', ...pair('Edit', f, H(11)), R.final('半行完成。'));
    await until(async () => by(await get('/api/state?peek=1'), 'dfEdge')?.result === '半行完成。');
    const hd = (await diff('dfEdge')).body?.items || [];
    ok(hd.length === 1 && hd[0].hunks?.[0]?.oldStart === 11, '改动：半行跨两次扫描仍记原始行首，前一轮不泄漏');
    // 等到新一拍刚读完，再追加。接口须以已扫描位置为终点。
    append('dfPeer', ...pair('Edit', f, H(12)));
    await until(async () => by(await get('/api/state?peek=1'), 'dfPeer')?.wrote?.find(x => x.path === f)?.n === 2);
    append('dfPeer', ...pair('Edit', f, H(13)));
    const beforeScan = await diff('dfPeer');
    ok(beforeScan.body?.items?.length === 2, '改动：服务还没扫到的新记录不提前读进来');
    append('dfPeer', R.final('读取边界检查结束。'));
    // 另起只读实例，先核自己的假主目录；停掉自己记下的进程，再从同一份数据重建。
    const restartRead = async () => {
      const rp = PORT + 700, child = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(rp), CCBOARD_PREVIEW_PORT: String(PORT + 1700), CCBOARD_REMOTE_PORT: String(PORT + 701), CCBOARD_READONLY: '1' }, stdio: ['ignore', out, out] }); kids.push(child.pid);
      const up = await until(async () => { const r = await rq(rp, 'GET', '/health'); return r.body?.ok && r.body.data === DATA0; }, 12000);
      const r = up ? await diff('dfMain', f, rp) : { code: 0, body: null };
      child.kill('SIGTERM'); await new Promise(resolve => child.once('close', resolve)); kids.splice(kids.indexOf(child.pid), 1); return r;
    };
    const ro1 = await restartRead(), ro2 = await restartRead();
    ok(ro1.code === 200 && JSON.stringify(ro1.body?.items) === JSON.stringify(items), '改动：只读服务同样能读取补丁');
    ok(ro2.code === 200 && JSON.stringify(ro2.body?.items) === JSON.stringify(ro1.body?.items), '改动：同数据目录重启后内容逐字一致');
    if (TMUX_BIN) {
      const agents = JSON.parse(fs.readFileSync(path.join(DATA0, 'agents.json'), 'utf8')), agent = agents[CDX], pf = 'rel/diff-a.js', pa = 'rel/diff-b.js';
      const patch = '*** Begin Patch\n*** Update File: ' + pf + '\n@@\n-old\n+new\n*** Add File: ' + pa + '\n+created\n*** End Patch\n';
      fs.appendFileSync(agent.rollout, [
        { type: 'response_item', timestamp: ts(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: agent.prompt }] } },
        { type: 'response_item', timestamp: ts(), payload: { type: 'custom_tool_call', name: 'apply_patch', input: patch } },
        { type: 'response_item', timestamp: ts(), payload: { type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ patch }) } },
        { type: 'event_msg', timestamp: ts(), payload: { type: 'task_complete', last_agent_message: '夹具做完了' } }
      ].map(r => JSON.stringify(r)).join('\n') + '\n');
      await until(async () => (await get('/api/state?peek=1')).sessions.find(x => x.sid === agent.sid)?.wrote?.some(x => x.path.endsWith(pf)));
      const cd = await rq(PORT, 'GET', '/api/diff?sid=' + agent.sid + '&path=' + encodeURIComponent('~/work/' + pf), { 'x-ccboard': TOKEN });
      ok(cd.code === 200 && cd.body?.items?.length === 2 && cd.body.items.every(x => x.tool === 'apply_patch' && x.patch === '*** Update File: ' + pf + '\n@@\n-old\n+new\n'), '改动：直接和 JSON 包装的补丁均按文件切，真换行且不混入另一文件');
    }
    // 清单超过二十行时，未展示的文件仍属于这一轮。
    const many = Array.from({ length: 23 }, (_, i) => pair('Write', '~/code/diff/p' + i + '.txt', [], { type: 'create', content: 'x' })).flat();
    make('dfMany', [R.human('批量写'), ...many, R.final('写完。')]);
    await until(async () => by(await get('/api/state?peek=1'), 'dfMany')?.wroteMore === 3);
    ok((await diff('dfMany', '~/code/diff/p0.txt')).code === 200, '改动：未展示的清单尾部文件仍可读取');
    append('dfMain', R.human('新的一轮不改文件'));
    await until(async () => by(await get('/api/state?peek=1'), 'dfMain')?.wrote?.length === 0);
    ok((await diff('dfMain')).code === 404, '改动：本人开了新轮以后刚才路径立即失效');
    // 假会话留到整趟收尾统一停；本段一起停会被退出检测当成一次崩溃。
  }

  console.log('\n[1g] 预计交付（11/18）：窗口回复里单独一行【预计】N 分钟 → /api/state 的 eta { at, mins }；这一轮最新的一行算数，新的一轮清掉，被后台叫醒、一轮做到一半别的窗口发来的话不清');
  {
    const N = (text, side = false) => { const r = R.note(text); if (side) r.isSidechain = true; return r; };
    const et = {};   // 名字 → 期望 { mins, at } 里的 at 取哪一条记录
    const make = (n, recs) => { mk(n, 'idle', recs); return recs; };
    let r;
    r = make('etA', [R.human('合一下补丁'), N('先读任务单。\n【预计】20 分钟'), R.tool(), R.result(), N('排上锁了，前面还有一件。\n【预计】还要 35 分钟'), R.tool(), R.result()]); et.etA = r[4].timestamp;
    r = make('etMulti', [R.human('跑一遍'), N('【预计】10 分钟\n先跑测试\n【预计】还要 45 分钟（加上排队）'), R.tool(), R.result()]); et.etMulti = r[1].timestamp;
    make('etQuote', [R.human('看下这条规矩'), N('规矩是开工时单独写一行【预计】20 分钟，这一轮很快不用写。'), R.final('看完了。')]);
    make('etUnits', [R.human('估一下'), N('【预计】20–30 分钟'), R.tool(), R.result()]);
    make('etHour', [R.human('估一下'), N('**【预计】1.5 小时**'), R.tool(), R.result()]);
    make('etBig', [R.human('估一下'), N('【预计】20 分钟'), R.tool(), R.result(), N('【预计】3000 分钟')]);
    make('etNew', [R.human('第一件'), N('【预计】20 分钟'), R.tool(), R.result(), R.final('做完了。\n\n【待审阅】结果在 x'), R.human('再来一件')]);
    make('etWake', [R.human('跑测试'), N('【预计】25 分钟'), R.tool(), R.result(), R.final('测试在后台跑。\n\n【进展】后台在跑'), R.notif(), N('测试跑完了，接着看结果。')]);
    make('etPeerMid', [R.human('改个东西'), N('【预计】15 分钟'), R.tool(), R.peer('win-x1', '顺便看下 y'), R.result()]);
    make('etPeerNew', [R.human('改个东西'), N('【预计】15 分钟'), R.tool(), R.result(), R.final('改好了。'), R.peer('win-x1', '再看下 y')]);
    make('etSide', [R.human('查一下'), N('【预计】30 分钟', true), R.tool(), R.result()]);
    r = make('etFinal', [R.human('跑一整套'), R.tool(), R.result(), R.final('整套放到后台了。\n【预计】还要 40 分钟\n\n【进展】后台在跑整套')]); et.etFinal = r[3].timestamp;
    const names = ['etA', 'etMulti', 'etQuote', 'etUnits', 'etHour', 'etBig', 'etNew', 'etWake', 'etPeerMid', 'etPeerNew', 'etSide', 'etFinal'];
    const sg = await until(async () => { const x = await get('/api/state?peek=1'); return names.every((n) => by(x, n)) ? x : null; }, 15000) || { sessions: [] };
    const E = (n) => (by(sg, n) || {}).eta, M = (n) => (E(n) || {}).mins ?? null, J = (ns) => JSON.stringify(ns.map((n) => [n, E(n) === undefined ? 'missing' : E(n)]));
    ok(M('etA') === 35 && E('etA').at === et.etA, 'etA：报了两次（20 分钟、排上锁后「还要 35 分钟」）→ 取后一条，at 是那一条记录的时间', J(['etA']) + ' want at ' + et.etA);
    ok(M('etMulti') === 45 && E('etMulti').at === et.etMulti, 'etMulti：同一段话里两行【预计】→ 取最后一行（括号里的说明不碍事）', J(['etMulti']));
    ok(E('etQuote') === null, 'etQuote：正文里提到「单独写一行【预计】20 分钟」这条规矩（不在行首）→ 不算，eta 是 null', J(['etQuote']));
    ok(M('etUnits') === 30 && M('etHour') === 90, '范围「20–30 分钟」取大的 30；「**【预计】1.5 小时**」（加粗）换成 90 分钟', J(['etUnits', 'etHour']));
    ok(M('etBig') === 20, 'etBig：后来报了 3000 分钟（超过一天，卡片写不对钟点）→ 不认，留着前面的 20', J(['etBig']));
    ok(E('etNew') === null && E('etPeerNew') === null, '交付以后他本人 / 别的窗口开了新的一轮 → 上一轮报的预计清掉', J(['etNew', 'etPeerNew']));
    ok(M('etWake') === 25 && M('etPeerMid') === 15, '被后台任务叫醒（etWake）、一轮做到一半别的窗口发来话（etPeerMid）→ 不是新的一轮，预计照旧', J(['etWake', 'etPeerMid']));
    ok(E('etSide') === null, 'etSide：子 agent（isSidechain）里写的【预计】不算主线的', J(['etSide']));
    ok(M('etFinal') === 40 && E('etFinal').at === et.etFinal, 'etFinal：收尾的话里报「还要 40 分钟」再放到后台跑（卡片是「后台在跑」）→ 照样认', J(['etFinal']));
    if (TMUX_BIN) {   // Codex：中途的话有两种写法，各单独核一次（只写一种时另一种的解析被拿掉也要变红）
      const agents = JSON.parse(fs.readFileSync(path.join(DATA0, 'agents.json'), 'utf8')), agent = agents[CDX];
      const cx = async (want) => (await until(async () => { const c = (await get('/api/state?peek=1')).sessions.find((x) => x.tmux === CDX); return c && JSON.stringify(c.eta && c.eta.mins) === JSON.stringify(want) ? c : null; }, 8000)) || {};
      const u1 = ts(), t1 = ts();
      fs.appendFileSync(agent.rollout, [{ type: 'response_item', timestamp: u1, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: agent.prompt }] } },
        { type: 'event_msg', timestamp: t1, payload: { type: 'agent_message', message: '先跑测试。\n【预计】12 分钟' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
      const c1 = await cx(12); ok(c1.eta && c1.eta.mins === 12 && c1.eta.at === t1, 'Codex：event_msg 的 agent_message 里一行【预计】12 分钟 → eta', JSON.stringify(c1.eta));
      fs.appendFileSync(agent.rollout, JSON.stringify({ type: 'response_item', timestamp: ts(), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '测试排队了。\n【预计】还要 7 分钟' }] } }) + '\n');
      const c2 = await cx(7); ok(c2.eta && c2.eta.mins === 7, 'Codex：response_item 的 assistant message 里报的新一行 → 换成 7', JSON.stringify(c2.eta));
      fs.appendFileSync(agent.rollout, [{ type: 'response_item', timestamp: ts(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: agent.prompt }] } },
        { type: 'event_msg', timestamp: ts(), payload: { type: 'task_complete', last_agent_message: '夹具做完了' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
      const c3 = await cx(null); ok(c3.tmux === CDX && c3.eta === null, 'Codex：他说了新的一句 → 预计清掉', JSON.stringify(c3.eta));
    }
  }

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
  const t4 = tmpHas(), tl4 = log().split('\n').filter((x) => x.startsWith('tmp '));
  ok(!t4.chatA && !t4.chatB && t4.work && t4.live && t4.old && t4.notes && tl4.length === 1 && tl4[0].includes(S.tidyChat.sid.slice(0, 8)) && / 2 个/.test(tl4[0]), 'tmp: 删掉的会话当场清掉它在每个工作目录下的临时目录（两份）；留着的还没到线不清；别的会话、名字不是会话号的目录不碰；日志恰好一行', JSON.stringify({ t4, tl4 }));

  console.log('\n[4c] 自动收工（autoTidy）：结束了的窗口自己收掉，没结束的一个都不碰');
  // car5 起到线的先问小模型（一次问一个），atFyi / atRev 要等它们各自的回答到了才收：最多等 30 秒
  for (let i = 0; i < 30; i++) { const a = await get('/api/archive'); if (a.items.some((x) => x.sid === S.atFyi.sid) && (a.dropped || []).some((x) => x.sid === S.atRev.sid)) break; await sleep(1000); }
  st = await get('/api/state'); const arc2 = await get('/api/archive'); const ai = (n) => arc2.items.find((x) => x.sid === S[n].sid);
  ok(!by(st, 'atFyi') && ai('atFyi') && ai('atFyi').state === 'archived' && ai('atFyi').auto === true && /无需处理的交付，2 小时没人理它/.test(ai('atFyi').why) && /改过 1 次文件/.test(ai('atFyi').why) && fs.existsSync(S.atFyi.file), 'tidy: 无需处理的交付超过 1 小时没人理 → 收；改过文件 → 留着（理由里写明哪条线）', JSON.stringify(ai('atFyi')));
  ok(!by(st, 'atRev') && !ai('atRev') && !fs.existsSync(S.atRev.file) && (arc2.dropped || []).some((x) => x.sid === S.atRev.sid && /待审阅的交付，3 小时没点「审完了」/.test(x.why) && /只聊了几句/.test(x.why)), 'tidy: 待审阅超过 2 小时没点「审完了」 → 收；只聊了几句 → 和手点归档一样删（对话挪进暂存处）', JSON.stringify(arc2.dropped));
  const stay = ['atFyiNew', 'atRevNew', 'atAsk', 'atBusy', 'atShell', 'atHalt', 'atStale'];
  ok(stay.every((n) => by(st, n) && !ai(n)), 'tidy: 没到线的（fyi 才半小时 / 待审阅 1.5 小时）、待跟进放了 5 小时、在跑的、后台命令还在跑的、被后台叫醒撞上额度的、点的是旧交付的 → 一个都没动', JSON.stringify(stay.map((n) => [n, !!by(st, n), !!ai(n)])));
  // car5（11/17 win-f7）：作者 22:4x「不能在归档的时候，就把该做的直接自动收工了」
  const holdRe = (n, line, why) => new RegExp('^tidy \\S+ hold ' + S[n].sid.slice(0, 8) + ' ' + line + ' 不收：' + why + '$', 'm');
  ok(by(st, 'atFyiWait') && !ai('atFyiWait') && by(st, 'atRevWait') && !ai('atRevWait') && !(arc2.dropped || []).some((x) => x.sid === S.atRevWait.sid)
    && holdRe('atFyiWait', 'fyi', '它自己还有后续：在等').test(log()) && holdRe('atRevWait', 'review', '它自己还有后续：在等').test(log()),
    'tidy: 过了 fyi 线 / review 线，但小模型说它自己还有后续（在等别的窗口、明早自己做）→ 不收，日志写「hold … 不收：它自己还有后续」', JSON.stringify({ fyi: [!!by(st, 'atFyiWait'), !!ai('atFyiWait')], rev: [!!by(st, 'atRevWait'), !!ai('atRevWait')], lines: (log().match(/^tidy .* hold .*$/gm) || []).slice(0, 6) }));
  // 欠着的后续（car5 复审 #1）：atOwed / atOwed2 第一次判 waiting；各来一次新交付（还是 2 小时前那一带，过了 fyi 线）
  const jOwed = () => fs.readFileSync(JLOG, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)).filter((x) => x.input.includes('<earlier_followup>'));
  await until(async () => holdRe('atOwed', 'fyi', '.+').test(log()) && holdRe('atOwed2', 'fyi', '.+').test(log()), 30000);
  const jf0 = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'judged.json'), 'utf8')); } catch { return {}; } })();
  append('atOwed', ...aged(1.5 * H, [R.peer('win-f2', '值班换人了'), R.final('收到，不影响。T-DONE')]));
  append('atOwed2', ...aged(1.5 * H, [R.peer('win-f2', '明早那步呢'), R.final('08:05 那步做完了，后续都结束了。T-SETTLED T-DONE')]));
  await until(async () => jOwed().length >= 2 && (await get('/api/archive')).items.some((x) => x.sid === S.atOwed2.sid), 30000);
  const stO = await get('/api/state'), arcO = await get('/api/archive'), jf1 = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'judged.json'), 'utf8')); } catch { return {}; } })();
  const eo = jOwed().find((x) => x.input.includes('收到，不影响'));
  ok(jf0[S.atFyiWait.sid] && jf0[S.atFyiWait.sid].v && jf0[S.atFyiWait.sid].v.verdict === 'waiting' && jf0[S.atFyiWait.sid].at === by(st, 'atFyiWait').resultAt && jf0[S.atOwed.sid] && /08:04/.test((jf0[S.atOwed.sid].owed || {}).tail || ''),
    'judged.json：判过的落了盘（会话号 → 那次交付的时间、答案）；判成 waiting 的记下那次交付的结尾（owed）', JSON.stringify({ fyiWait: jf0[S.atFyiWait.sid] || null, owed: jf0[S.atOwed.sid] || null }).slice(0, 600));
  ok(by(stO, 'atOwed') && !arcO.items.some((x) => x.sid === S.atOwed.sid) && eo && /<earlier_followup>\n[\s\S]*定了明早 08:04 的定时[\s\S]*<\/earlier_followup>\n<delivery>\n[\s\S]*收到，不影响/.test(eo.input),
    'tidy: 之前说「明早 08:04 我自己做」、后来又回了别的窗口一句「收到」：带着之前欠着的那段再问 → 还是不收（只看最新一句会判 done 收掉）', JSON.stringify({ on: !!by(stO, 'atOwed'), asked: eo ? eo.input.slice(0, 300) : null }));
  ok(arcO.items.some((x) => x.sid === S.atOwed2.sid && x.auto === true) && !by(stO, 'atOwed2') && jf1[S.atOwed2.sid] && !jf1[S.atOwed2.sid].owed,
    'tidy: 之后那次交付说「做完了」→ done → 收，judged.json 里欠着的清掉', JSON.stringify({ arc: arcO.items.find((x) => x.sid === S.atOwed2.sid) || null, j: jf1[S.atOwed2.sid] || null }));
  const jlP = () => fs.readFileSync(JLOG, 'utf8').split('\n').filter((x) => x.includes('开了 atKid 去跑')).length;
  ok(by(st, 'atParent') && !ai('atParent') && by(st, 'atKid') && holdRe('atParent', 'fyi', '它开的 1 个窗口还在墙上').test(log()) && jlP() === 0,
    'tidy: atParent 过了 fyi 线、交付说做完了，但它开的 atKid（spawn.json）还在墙上跑 → 不收，也不去问小模型（认 spawn.json，不认架构的 via：两个被分到不同项目时架构不挂 spawn，复审 #4 / 11/17 红阶段实测 via=dept）', JSON.stringify({ on: !!by(st, 'atParent'), kid: (st.org && st.org.nodes[S.atKid.sid]) || null, asked: jlP(), lines: (log().match(/^tidy .* hold .*$/gm) || []).slice(0, 6) }));
  ok(kind(st, 'atHalt') === 'limit' && by(st, 'atHalt').done === true, 'tidy: atHalt 交付了、又报了额度的错 = 有 alert，不收（守卫是真会碰到的）', kind(st, 'atHalt') + ' done=' + by(st, 'atHalt').done);
  const prc = async (map) => (await post('/api/processed', { map })).body;
  const bads = [await prc([1, 2]), await prc({ x: 'y' }), await prc({ [S.atFast.sid]: { a: 1 } })];
  ok(bads.every((b) => b.ok && b.n === 0), '/api/processed：不是对象、sid 写法不对、时间不是字符串或数字 → 都忽略，不崩', JSON.stringify(bads));
  const seen4c = []; const poll4c = async (f) => { const r = await get('/api/state' + (f ? '?f=1' : '')); for (const n of r.notices || []) seen4c.push(n.text); return r; };
  const focus4c = setInterval(() => poll4c(true).catch(() => {}), 700);      // 他正看着总控台：从打标记之前就开始，一直到下面检查完；「审完了」过 3 秒就到点，之后只有「正看着」在拦着
  const pm = await prc({ [S.atFast.sid]: by(st, 'atFast').resultAt, [S.atFocus.sid]: by(st, 'atFocus').resultAt, [S.atStale.sid]: '2020-01-01T00:00:00.000Z' });
  ok(pm.ok && pm.n === 3, '/api/processed：三条记录都收下', JSON.stringify(pm));
  const pm2 = await prc({ [S.atBusy.sid]: 'x' }), pm3 = (await post('/api/processed', { clear: [S.atBusy.sid] })).body, pm4 = await prc({ 'ghost000-0000-4000-8000-000000000000': 'x' });
  await sleep(2500); const pm5 = await prc({});
  ok(pm2.n === 4 && pm3.n === 3 && pm4.n === 4 && pm5.n === 3, '/api/processed：只增不整份替换（再来一条 → 4）、clear 撤销一条 → 3、已经不在墙上的会话（ghost）扫一遍就清掉 → 3', JSON.stringify([pm2.n, pm3.n, pm4.n, pm5.n]));
  await sleep(7500); st = await poll4c(true); clearInterval(focus4c);
  ok(by(st, 'atFast') && by(st, 'atFocus'), 'tidy: 他正看着总控台时不收（卡片不在他眼前消失）', JSON.stringify([!!by(st, 'atFast'), !!by(st, 'atFocus')]));
  // 这段等收工时用 peek=1 读（只看不取），提示攒在服务里；等到之后两头各验一次：带 peek 连取两次都还在，不带取一次就清掉
  // 坐在岗位上的不收，fast 线也一样（11/17 win-49）：atFastHead 是「FretFlow 设计负责人」，待审阅、点了「审完了」、他不看总控台，过了 fast 线也不收
  const pmH = await prc({ [S.atFastHead.sid]: by(st, 'atFastHead').resultAt }); await sleep(8000); const stH = await get('/api/state?peek=1'), arcH = await get('/api/archive');
  const fhRole = ((stH.org && stH.org.nodes && stH.org.nodes[S.atFastHead.sid]) || {}).role;
  ok(pmH.ok && by(stH, 'atFastHead') && !arcH.items.some((x) => x.sid === S.atFastHead.sid) && fhRole === 'head' && new RegExp('^tidy \\S+ seat ' + S.atFastHead.sid.slice(0, 8) + ' fast 不收：它是分支负责人$', 'm').test(log()),
    'tidy: 分支负责人（FretFlow 设计负责人）点了「审完了」、过了 fast 线也不收，日志写「seat … fast 不收：它是分支负责人」', JSON.stringify({ on: !!by(stH, 'atFastHead'), role: fhRole, line: (log().match(/^tidy .* seat .*$/gm) || []).slice(0, 3) }));
  const tidyN = (r) => (r.notices || []).find((x) => /^自动收工：/.test(x.text));
  let arc3 = { items: [] }, pk1 = {}; for (let i = 0; i < 30; i++) { await sleep(1000); pk1 = await get('/api/state?peek=1'); arc3 = await get('/api/archive'); if (tidyN(pk1) && ['atFast', 'atFocus'].every((n) => arc3.items.some((x) => x.sid === S[n].sid && x.state === 'archived'))) break; }
  const pk2 = await get('/api/state?peek=1');
  ok(pk1.peek === true && pk2.peek === true && tidyN(pk1) && tidyN(pk2) && tidyN(pk1).id === tidyN(pk2).id, 'peek=1：连取两次，同一条提示都还在，返回带 peek: true', JSON.stringify([pk1.peek, pk1.notices, pk2.peek, pk2.notices]));
  const nk1 = await poll4c(false), nk2 = await poll4c(false);
  ok(!('peek' in nk1) && !('peek' in nk2) && tidyN(nk1) && tidyN(nk1).id === tidyN(pk1).id && !tidyN(nk2), '不带 peek：取一次就清掉（第二次没有了），返回里没有 peek 字段', JSON.stringify([nk1.peek, nk1.notices, nk2.peek, nk2.notices]));
  const a3 = (n) => arc3.items.find((x) => x.sid === S[n].sid); st = await get('/api/state');
  ok(['atFast', 'atFocus'].every((n) => a3(n) && a3(n).state === 'archived' && a3(n).auto === true && /^你点过「审完了」，改过 1 次文件$/.test(a3(n).why)), 'tidy: 他离开之后，点过「审完了」又安静 3 秒的收掉，改过文件 → 留着', JSON.stringify([a3('atFast'), a3('atFocus')]));
  ok(by(st, 'atStale') && !a3('atStale'), 'tidy: 点的是上一次交付的「审完了」（时间对不上）→ 不算，还在墙上');
  const tl = log().split('\n').filter((x) => x.startsWith('tidy '));
  ok(['atFast', 'atFocus'].every((n) => { const ls = tl.filter((x) => x.includes(' ' + S[n].sid.slice(0, 8) + ' ')); return ls.length === 1 && / keep \S+ fast /.test(ls[0]); }), '日志：两个同一拍到点的，各自只记一行、都是 keep（收拾 A 的过程里不会再进来收拾 B，B 也不会被记成删）', tl.join(' | '));
  ok(seen4c.some((x) => /^自动收工：留了 2 个，删了 0 个（「.+」「.+」）$/.test(x)), '界面会收到一条提示：「自动收工：留了 2 个，删了 0 个（…）」', JSON.stringify(seen4c));
  console.log('\n[4c2] fast 线也先问小模型（11/17 car5）：只有明说做完了才收；它自己还有后续 / 还有要他定的事 / 判不出来 → 不收');
  const pmF = await prc({ [S.atFastWait.sid]: by(st, 'atFastWait').resultAt, [S.atFastYours.sid]: by(st, 'atFastYours').resultAt, [S.atFastExit.sid]: by(st, 'atFastExit').resultAt });
  let arcF = { items: [] }; for (let i = 0; i < 40; i++) { await sleep(1000); arcF = await get('/api/archive'); if (['atFastWait', 'atFastYours', 'atFastExit'].every((n) => holdRe(n, 'fast', '.+').test(log()))) break; }
  st = await get('/api/state'); const af = (n) => arcF.items.find((x) => x.sid === S[n].sid);
  ok(pmF.ok && by(st, 'atFastYours') && !af('atFastYours') && holdRe('atFastYours', 'fast', '还有要你定的事：J 要你定：选 A 还是 B').test(log()), 'tidy: fast 线、点了「审完了」，小模型判 yours（交付里还有要他定的事）→ 不收：只有明说做完了才收（总管那条 5 次里有 1 次判 yours）', JSON.stringify({ on: !!by(st, 'atFastYours'), arc: af('atFastYours') || null }));
  ok(by(st, 'atFastWait') && !af('atFastWait') && holdRe('atFastWait', 'fast', '它自己还有后续：在等').test(log()), 'tidy: fast 线、点了「审完了」，但它说下一版上架后自己还要做 → 不收（一个总管窗口就是这样被误收过）', JSON.stringify((log().match(/^tidy .* hold .*$/gm) || [])));
  ok(by(st, 'atFastExit') && !af('atFastExit') && holdRe('atFastExit', 'fast', '判不出来，拿不准就不收').test(log()), 'tidy: fast 线、小模型命令失败 → 拿不准就不收（保护性的判断：判不出来落在「不收」）', JSON.stringify((log().match(/^tidy .* hold .*$/gm) || [])));
  const holdN = (log().match(/^tidy .* hold .*$/gm) || []).length; await sleep(3000);
  ok((log().match(/^tidy .* hold .*$/gm) || []).length === holdN, 'tidy: 不收的每次交付只记一行 hold（不是每次扫描刷一行）', String(holdN));
  console.log('\n[4d] 收之前看一眼（tidyJudge）：fyi 过了 smart 线就问小模型，做完了才收；在等 / 要你定 / 判不出来都不收；待审阅不问');
  let arcJd = { items: [] }; for (let i = 0; i < 20; i++) { arcJd = await get('/api/archive'); if (arcJd.items.some((x) => x.sid === S.jDone.sid && x.state === 'archived')) break; await sleep(1000); }
  const aj = (n) => arcJd.items.find((x) => x.sid === S[n].sid); st = await get('/api/state');
  ok(aj('jDone') && aj('jDone').state === 'archived' && aj('jDone').auto === true && /^无需处理的交付，\d+ 分钟没人理它，看过没有要你定的事，改过 1 次文件$/.test(aj('jDone').why) && !by(st, 'jDone'), 'judge: 安静半小时、小模型说做完了 → 走 smart 线收（没等满 1 小时的 fyi 线）；改过文件 → 留着', JSON.stringify(aj('jDone')));
  const jhRole = ((st.org && st.org.nodes && st.org.nodes[S.jHead.sid]) || {}).role;
  ok(by(st, 'jHead') && !aj('jHead') && ['head', 'lead'].includes(jhRole) && new RegExp('^tidy \\S+ seat ' + S.jHead.sid.slice(0, 8) + ' \\w+ 不收：它是(分支负责人|负责人)$', 'm').test(log()),
    'judge: 同样安静半小时、交付一样的 jHead 是「FretFlow 运营负责人」（架构里坐在岗位上）→ 不收、还在墙上，日志写「不收：它是分支负责人」（11/17 win-49）', JSON.stringify({ on: !!by(st, 'jHead'), arc: aj('jHead') || null, role: jhRole, line: (log().match(/^tidy .* seat .*$/gm) || []).slice(0, 2) }));
  ok(['jWait', 'jYours', 'jBad', 'jExit'].every((n) => by(st, n) && !aj(n)), 'judge: 在等别人 / 还有要你定的事 / 答非所问 / 命令失败 → 都还在墙上', JSON.stringify(['jWait', 'jYours', 'jBad', 'jExit'].map((n) => [n, !!by(st, n), !!aj(n)])));
  const dy = by(st, 'jYours').digest, dw = by(st, 'jWait').digest, db = by(st, 'jBad').digest;
  ok(dy.need === 'reply' && dy.ask === 'J 要你定：选 A 还是 B' && dy.judged === true && dw.need === 'fyi' && !dw.judged && db.need === 'fyi', 'judge: 说还有事要你定的，卡片改成待跟进、那件事放进「要你做的事」；在等的、判不出来的原样是无需处理', JSON.stringify([dy, dw, db]));
  const jl = fs.readFileSync(JLOG, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const nOf = (mark) => jl.filter((x) => x.input.includes(mark)).length;
  ok(['J-DONE', 'J-WAIT', 'J-YOURS', 'J-BAD', 'J-EXIT'].every((m) => nOf(m) === 1), 'judge: 每次交付只问一次（判不出来的也不反复问）', JSON.stringify(['J-DONE', 'J-WAIT', 'J-YOURS', 'J-BAD', 'J-EXIT'].map((m) => [m, nOf(m)])));
  ok(nOf('样式改好了') === 0 && nOf('想了两个方向') === 0 && nOf('回归在后台跑') === 0 && nOf('配色改好了') === 0 && nOf('回归全过') === 0 && nOf('答完了。T-DONE') === 1 && nOf('标题改好了。T-DONE') === 1, 'judge: 待审阅没到线（1.5 小时）、待跟进、后台命令还在跑的、刚交付的，一个都不问（待审阅留 24 小时，作者 11/15 定）；到了 review 线 / fast 线的才问，各问一次（car5）', JSON.stringify(jl.map((x) => x.input.slice(-40))));
  const ja = jl[0] ? jl[0].argv : [];
  ok(ja[0] === '-p' && ja[ja.indexOf('--model') + 1] === 'haiku' && ja[ja.indexOf('--setting-sources') + 1] === '' && ja[ja.indexOf('--tools') + 1] === '' && ja.includes('--no-session-persistence') && ja.includes('--strict-mcp-config') && jl.every((x) => /^<title>[\s\S]*<delivery>\n[\s\S]*\n<\/delivery>$/.test(x.input)), 'judge: 参数是 claude -p + haiku，不读设置文件、不带工具、不存会话；原文从 stdin 进去、包在 <delivery> 里', JSON.stringify(ja.slice(0, 12)));
  const jlog = log().split('\n').filter((x) => x.startsWith('judge '));
  const jline = (n) => jlog.filter((x) => x.includes(' ' + S[n].sid.slice(0, 8) + ' '));
  ok(/ done 做完了$/.test(jline('jDone')[0] || '') && / yours J 要你定/.test(jline('jYours')[0] || '') && / fail 答非所问$/.test(jline('jBad')[0] || '') && / fail 命令失败：.*boom/.test(jline('jExit')[0] || '') && ['jDone', 'jYours', 'jBad', 'jExit', 'jWait'].every((n) => jline(n).length === 1), '日志：judge <时间> <会话> done / waiting / yours / fail <理由>，每个会话一行', jlog.join(' | '));
  // 只读预览：只记「会收」，什么都不动（拿真实会话预览时靠它不误关）。同一份假主目录，另起一份只读服务，把 fyi 的线调成 1 分钟
  // 它读的 config.json 关掉 tidyJudge（autoTidy 照旧开着）：顺带核「不开 tidyJudge 就不问」
  const cfgFile = path.join(DATA0, 'config.json'), cfg0 = fs.readFileSync(cfgFile, 'utf8'); fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(cfg0), tidyJudge: false }));
  append('jWait', ...aged(3000, [R.peer('win-f2', '再看看'), R.final('又改了一处。J-WAIT2')]));      // 刚交付：只读预览那份服务把 smart 线调成 1 秒，它正好落在「该问了」的区间（fyi 线 1 分钟之内）
  const jn0 = fs.readFileSync(JLOG, 'utf8').length;
  const logD = path.join(ROOT, 'server-dry.out'); const outD = fs.openSync(logD, 'w');
  const srvD = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(PORT + 100), CCBOARD_READONLY: '1', CCBOARD_TIDY_FYI_MS: '60000', CCBOARD_TIDY_SMART_MS: '1000' }, stdio: ['ignore', outD, outD] }); kids.push(srvD.pid);
  await sleep(4500); const dlog = fs.readFileSync(logD, 'utf8'); try { process.kill(srvD.pid, 'SIGTERM'); } catch {}     // 它要是自己退出了，日志会写在失败信息里
  fs.writeFileSync(cfgFile, cfg0);
  ok(fs.readFileSync(JLOG, 'utf8').length === jn0 && !/^judge /m.test(dlog) && /tidyJudge=false/.test(dlog), 'judge: config 里 tidyJudge 关着（autoTidy 开着）→ 刚交付、过了 1 秒 smart 线的 jWait 也一次都不问', dlog.split('\n').filter((x) => /^(judge|config) /.test(x)).join(' | '));
  const arc4 = await get('/api/archive'); st = await get('/api/state');
  ok(new RegExp('tidy \\S+ dry ' + S.atFyiNew.sid.slice(0, 8) + ' fyi ').test(dlog) && !/tidy \S+ (keep|drop) /.test(dlog) && by(st, 'atFyiNew') && !arc4.items.some((x) => x.sid === S.atFyiNew.sid) && (() => { try { process.kill(S.atFyiNew.pid, 0); return true; } catch { return false; } })(), 'tidy: 只读预览：日志里写「dry … 会收」，但没归档、没停进程', dlog.split('\n').filter((x) => x.startsWith('tidy')).join(' | ') + ' ‖ 预览服务日志末尾：' + dlog.slice(-500));

  // 判断落盘以后，另一份服务（只读，开着 tidyJudge，判不出来隔 1 秒重问）读得回来：atFyiWait 不再问、照旧 hold；判不出来的 jExit 会再问一次（car5 复审 #2 / #5）
  const jc = (t) => fs.readFileSync(JLOG, 'utf8').split('\n').filter((x) => x.includes(t)).length;
  const rdJ = () => { try { return fs.readFileSync(path.join(DATA, 'judged.json'), 'utf8'); } catch { return null; } };   // 底上没有这个文件：读不到当 null，别让红阶段整个崩掉
  const failN = () => jc('J-EXIT') + jc('J-BAD');   // jBad（答非所问）、jExit（命令失败）都判不出来：隔 1 秒重问时排在前面的那个每一拍都会被问，看两个加起来
  const fw0 = jc('停在断点，等总指挥叫我再合'), ex0 = failN(), jfH = rdJ();
  const logJ = path.join(ROOT, 'server-dry2.out'); const outJ = fs.openSync(logJ, 'w');
  const srvJ = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(PORT + 101), CCBOARD_READONLY: '1', CCBOARD_JUDGE_RETRY_MS: '1000' }, stdio: ['ignore', outJ, outJ] }); kids.push(srvJ.pid);
  let jlog2 = ''; for (let i = 0; i < 15; i++) { await sleep(1000); jlog2 = fs.readFileSync(logJ, 'utf8'); if (new RegExp('hold ' + S.atFyiWait.sid.slice(0, 8) + ' ').test(jlog2) && failN() > ex0) break; }
  try { process.kill(srvJ.pid, 'SIGTERM'); } catch {}
  ok(new RegExp('^tidy \\S+ hold ' + S.atFyiWait.sid.slice(0, 8) + ' fyi 不收：它自己还有后续', 'm').test(jlog2) && jc('停在断点，等总指挥叫我再合') === fw0 && jfH !== null && rdJ() === jfH,
    'judged.json：另起的服务读得回来，atFyiWait 不再问、照旧不收；只读的服务不往里写', jlog2.split('\n').filter((x) => /^(tidy|judge) /.test(x)).slice(0, 8).join(' | '));
  ok(failN() > ex0, 'judge: 判不出来的（答非所问 / 命令失败）隔 CCBOARD_JUDGE_RETRY_MS 再问，不是一直卡着', String(failN() - ex0) + ' ‖ ' + jlog2.split('\n').filter((x) => /^(tidy|judge) /.test(x)).slice(0, 10).join(' | '));

  // 判官用哪个号（11/20 judge 换号）：config 写 judgeAccount 时，judge 经钥匙串那一层用它的 token 跑；没额度（429）单独认出来、日志写真原因、卡片写「判官没额度」；
  // 登记了但钥匙串里没 token 的号：不调判官、不退回当前登录的号，马上记「号不可用」。都用只读服务，假钥匙串里只有 good。
  // 重问间隔 5 秒：jBad / jExit 上次判不出来已经过了 6 秒以上（中间隔着上面 srvD 的 4.5 秒），起来就重问；「不收」那一行每个原因只记一次、只在重问之前那段时间里记，间隔 1 秒时赶不上 1.2 秒一拍的扫描（11/20 第一遍绿跑红了两条）
  const runJ = async (extraCfg, extraEnv, file) => {
    fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(cfg0), accounts: [{ id: 'good', name: '判官号' }, { id: 'none', name: '还没存 token 的号' }], ...extraCfg }));
    const lf = path.join(ROOT, file), of = fs.openSync(lf, 'w'), n0 = fs.readFileSync(JLOG, 'utf8').split('\n').filter(Boolean).length;
    const sv = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(PORT + 102), CCBOARD_READONLY: '1', CCBOARD_JUDGE_RETRY_MS: '5000', ...extraEnv }, stdio: ['ignore', of, of] }); kids.push(sv.pid);
    let lg = ''; for (let i = 0; i < 15; i++) { await sleep(1000); lg = fs.readFileSync(lf, 'utf8'); if (/^judge \S+ \S+ fail /m.test(lg) && /^tidy \S+ hold \S+ \S+ 不收：判/m.test(lg)) break; }
    try { process.kill(sv.pid, 'SIGTERM'); } catch {} await sleep(300);
    fs.writeFileSync(cfgFile, cfg0);
    return { lg, calls: fs.readFileSync(JLOG, 'utf8').split('\n').filter(Boolean).slice(n0).map((x) => JSON.parse(x)) };
  };
  const pick = (lg, re) => lg.split('\n').filter((x) => re.test(x)).slice(0, 4).join(' | ');
  const jq = await runJ({ judgeAccount: 'good' }, { J_QUOTA: '1' }, 'server-dry3.out');
  ok(/judgeAccount=good，/.test(jq.lg) && jq.calls.length > 0 && jq.calls.every((x) => x.acct === 'good' && x.tok === 'tok-good' && !x.argv.join(' ').includes('tok-good')), 'judge 换号：config 写 judgeAccount=good → 判官经钥匙串那一层跑，带的是 good 的 token（不是当前登录的号），token 不在参数里', JSON.stringify(jq.calls.map((x) => [x.acct, x.tok])) + ' ‖ ' + pick(jq.lg, /^config /));
  ok(/^judge \S+ \S+ fail 判官没额度：You've hit your weekly limit · resets Jan 5 at 9am/m.test(jq.lg) && !/fail 命令失败：Command failed/.test(jq.lg), 'judge 换号：429 认成「判官没额度」，日志写 json 里的真原因，不再只剩「Command failed: 命令行」', pick(jq.lg, /^judge /));
  ok(/^tidy \S+ hold \S+ \S+ 不收：判官没额度，拿不准就不收（You've hit your weekly limit/m.test(jq.lg), 'judge 换号：没额度照旧不收（失效关闭），不收的原因写「判官没额度」和那句原话', pick(jq.lg, /^tidy \S+ hold /));
  const jn = await runJ({ judgeAccount: 'none' }, {}, 'server-dry4.out');
  ok(jn.calls.length === 0 && /^judge \S+ \S+ fail 号不可用：none（钥匙串里没有它的 token）$/m.test(jn.lg) && /^tidy \S+ hold \S+ \S+ 不收：判不出来，拿不准就不收$/m.test(jn.lg), 'judge 换号：judgeAccount 登记了但钥匙串里没 token → 一次都不调判官（不悄悄退回当前登录的号），日志记「号不可用」，照旧不收', JSON.stringify(jn.calls.length) + ' ‖ ' + pick(jn.lg, /^(judge|tidy \S+ hold) /));
  const jd = await runJ({ defaultAccount: 'good' }, {}, 'server-dry5.out');
  ok(/judgeAccount=跟 defaultAccount，/.test(jd.lg) && jd.calls.length > 0 && jd.calls.every((x) => x.acct === 'good' && x.tok === 'tok-good') && /^judge \S+ \S+ fail 命令失败：boom$/m.test(jd.lg), 'judge 换号：不写 judgeAccount 就跟 defaultAccount；非额度的失败照旧记「命令失败」和 stderr 原文', JSON.stringify(jd.calls.map((x) => [x.acct, x.tok])) + ' ‖ ' + pick(jd.lg, /^(config|judge) /));

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

  console.log('\n[5b] 一起退出（P0-0）：10 秒内 ≥ 3 个窗口的进程没了、又不是总控台自己停的 → 闲着的也记成「进程退出」、同一个 crash 编号、当场留一份快照；「全部接回」排队一个一个接，看负载');
  // 这一段才造的会话（前面的断言不受影响）：crA / crB / crC 一起退出（最后动静 30 / 10 / 20 分钟前，crC 点名成总管）；crD 之后单独退出；arA / arB / arC 由总控台自己同时归档
  const CRASH = path.join(DATA, 'crash');
  fs.mkdirSync(CRASH, { recursive: true });
  for (let i = 1; i <= 11; i++) fs.mkdirSync(path.join(CRASH, '20200101-0000' + String(i).padStart(2, '0')));   // 11 份旧快照：之后只留最近 10 份
  fs.writeFileSync(path.join(DATA, 'machine.log'), Array.from({ length: 150 }, (_, i) => 'm' + String(i).padStart(3, '0')).join('\n') + '\n');
  const M = 60000;
  mk('crA', 'idle', aged(30 * M, [R.human('A 的活'), R.tool('Edit'), R.result(), R.final('A 做完了。')]), { statusAgo: 30 * M });
  mk('crB', 'idle', aged(10 * M, [R.human('B 的活'), R.tool('Edit'), R.result(), R.final('B 做完了。')]), { statusAgo: 10 * M });
  mk('crC', 'idle', aged(20 * M, [R.human('C 的活'), R.tool('Edit'), R.result(), R.final('C 做完了。')]), { statusAgo: 20 * M });
  mk('crD', 'idle', aged(15 * M, [R.human('D 的活'), R.tool('Edit'), R.result(), R.final('D 做完了。')]), { statusAgo: 15 * M });
  for (const n of ['arA', 'arB', 'arC']) mk(n, 'idle', aged(25 * M, [R.human(n + ' 的活'), R.tool('Edit'), R.result(), R.final(n + ' 做完了。')]), { statusAgo: 25 * M, claude: true });
  fs.writeFileSync(CHIEF, JSON.stringify({ window: 'w-crC', session_id: S.crC.sid, generation: 4 }));      // 这一段里点名 crC 当总管：接回时排第一
  const chiefOk = await until(async () => { const s = await get('/api/state?peek=1'); return s.org && s.org.chief === S.crC.sid && ['crA', 'crB', 'crC', 'crD', 'arA', 'arB', 'arC'].every((n) => by(s, n)); }, 15000);
  ok(chiefOk, '夹具：7 个新会话上墙，crC 被点名成总管');
  await sleep(1600);                                                                     // 让服务记下它们当时的职级
  for (const n of ['arA', 'arB', 'arC']) await post('/api/archive', { sid: S[n].sid, force: true });
  await until(async () => ['arA', 'arB', 'arC'].every((n) => { try { process.kill(S[n].pid, 0); return false; } catch { return true; } }), 15000);   // 归档 8 秒后总控台自己停掉它们
  const tKill = Date.now();
  for (const n of ['crA', 'crB', 'crC']) process.kill(S[n].pid, 'SIGTERM');
  try { fs.unlinkSync(path.join(SESS, S.crA.pid + '.json')); } catch {}                 // crA 像正常退出那样删了登记，另两个留着（像被杀）：都算
  fs.writeFileSync(CHIEF, JSON.stringify({ window: 'w-projC', session_id: S.projC.sid, generation: 3 }));   // 总管换回去：职级按它们还活着时记下的算
  await sleep(9000); st = await get('/api/state');
  const lostCr = (st.lost || []).filter((x) => ['crA', 'crB', 'crC'].some((n) => S[n].sid === x.sid));
  const cid = lostCr[0] && lostCr[0].crash;
  ok(lostCr.length === 3 && cid && lostCr.every((x) => x.crash === cid && x.idle === true), '三个闲着的一起退出：lost 里三个都有，带同一个 crash 编号、标着闲着（以前只记做到一半的）', JSON.stringify(st.lost));
  ok(!(st.lost || []).some((x) => ['arA', 'arB', 'arC'].some((n) => S[n].sid === x.sid)) && st.crash && st.crash.id === cid && st.crash.n === 3 && st.crash.state === 'new', '总控台自己同一拍归档掉的三个不算：不在 lost 里、也没算进这一起（crash.n 是 3、状态 new）', JSON.stringify(st.crash));
  const snaps = fs.readdirSync(CRASH).sort(), snap = snaps.filter((d) => !d.startsWith('2020'));
  const sdir = snap.length === 1 ? path.join(CRASH, snap[0]) : null, sf = (f) => { try { return fs.readFileSync(path.join(sdir, f), 'utf8'); } catch { return null; } };
  ok(sdir && /^vm\.swapusage: total = /m.test(sf('swapusage.txt') || '') && /^vm\.loadavg: \{ [\d.]+ /m.test(sf('loadavg.txt') || '') && (sf('memory_pressure.txt') || '').trim().split('\n').length === 1 && /FAKE-LOG-SHOW show --last 2m --style compact --predicate /.test(sf('log.txt') || ''),
    '当场快照 crash/<时间>/：交换区、负载、memory_pressure 最后一行、log show（试验场里是假命令，参数照原样）', JSON.stringify({ snap, files: sdir && fs.readdirSync(sdir) }));
  const psL = (sf('ps.txt') || '').trim().split('\n'), mlog = (sf('machine.log.txt') || '').trim().split('\n'), cj = (() => { try { return JSON.parse(sf('crash.json')); } catch { return null; } })();
  ok(psL.length >= 2 && psL.length <= 31 && /RSS/.test(psL[0]) && mlog.length === 120 && mlog[0] === 'm030' && mlog[119] === 'm149' && cj && cj.sessions && cj.sessions.length === 3, '快照里还有：ps 按内存前 30、machine.log 最后 120 行、这一起是哪几个窗口', JSON.stringify({ ps: psL.length, ml: [mlog.length, mlog[0], mlog[119]], cj: cj && cj.sessions && cj.sessions.length }));
  ok(snaps.length === 10 && !snaps.includes('20200101-000001') && !snaps.includes('20200101-000002') && snaps.includes('20200101-000011'), '快照只留最近 10 份（旧的 11 份删掉最早的 2 份）', snaps.join(','));
  ok(log().split('\n').some((l) => l.startsWith('crash ') && l.includes(cid) && / n=3 /.test(l)), '日志：crash <时间> <编号> n=3 <快照目录>');
  // 单独一个闲着的退出（离上一起 10 秒以上）：照旧不记
  await sleep(4000); process.kill(S.crD.pid, 'SIGTERM'); try { fs.unlinkSync(path.join(SESS, S.crD.pid + '.json')); } catch {}
  const tD = Date.now();
  // 全部接回：负载 40 → 一个都不接，等满（这里调成 3 秒）就停下；降到 5 → 按「总管 / 负责人先，再按最后动静从新到旧」一个一个接，每个隔 ≥ 2 秒（这里调的）
  const rsLines = () => log().split('\n').filter((l) => l.startsWith('restore ') && l.includes(cid));
  fs.writeFileSync(path.join(ROOT, 'loadavg'), '40');
  const rq1 = await post('/api/crash', { id: cid, action: 'restore' });
  await sleep(1500); st = await get('/api/state');
  ok(rq1.body.ok && st.crash && st.crash.state === 'waiting' && st.crash.load === 40 && !rsLines().some((l) => / ok /.test(l)), '负载 ≥ 30：一个都不接，横幅状态是「等负载降下来」（带当时的负载）', JSON.stringify({ rq1: rq1.body, crash: st.crash, rs: rsLines() }));
  const stop1 = await until(async () => { const s = await get('/api/state?peek=1'); return s.crash && s.crash.state === 'stopped' ? s.crash : null; }, 8000);
  ok(stop1 && stop1.why === 'load' && stop1.next === 1 && stop1.done === 0 && !rsLines().some((l) => / ok /.test(l)), '负载一直没降：等满就停下，停在第 1 个，一个都没接', JSON.stringify(stop1));
  await sleep(Math.max(0, tD + 9000 - Date.now())); st = await get('/api/state');     // 进程退出要 6 秒才记，等够
  ok(!(st.lost || []).some((x) => x.sid === S.crD.sid) && st.crash && st.crash.n === 3, '单独一个闲着的退出：不记（不在 lost 里，也没并进这一起）', JSON.stringify({ lost: (st.lost || []).map((x) => x.sid.slice(0, 4)), crash: st.crash }));
  fs.writeFileSync(path.join(ROOT, 'loadavg'), '5');
  const rq2 = await post('/api/crash', { id: cid, action: 'restore' });
  await until(async () => rsLines().filter((l) => / ok /.test(l)).length >= 1, 8000);
  const sp5 = await post('/api/crash', { id: cid, action: 'stop' });
  const stopU = await until(async () => { const s = await get('/api/state?peek=1'); return s.crash && s.crash.state === 'stopped' ? s.crash : null; }, 8000);
  ok(rq2.body.ok && sp5.body.ok && stopU && stopU.why === 'user' && stopU.done === 1 && stopU.next === 2 && rsLines().filter((l) => / ok /.test(l)).length === 1, '「停下」：手上那个接完就停，横幅写停在第 2 个', JSON.stringify({ sp5: sp5.body, stopU, rs: rsLines() }));
  const rq3 = await post('/api/crash', { id: cid, action: 'restore' });
  const done2 = await until(async () => { const s = await get('/api/state?peek=1'); return s.crash && s.crash.state === 'done' ? s.crash : null; }, 20000);
  const rl = rsLines().filter((l) => / ok /.test(l)), order = rl.map((l) => l.split(' ')[3]), at = rl.map((l) => Date.parse(l.split(' ')[1]));
  ok(rq3.body.ok && done2 && done2.done === 3 && rl.length === 3, '接着接回：三个都接回（停下之前那个不重接），横幅状态「都接回了」', JSON.stringify({ done2, rs: rsLines() }));
  ok(order.join(',') === [S.crC.sid, S.crB.sid, S.crA.sid].map((x) => x.slice(0, 8)).join(','), '顺序：总管 crC 先，再按最后动静从新到旧（crB 10 分钟前、crA 30 分钟前）', order.join(','));
  ok(at.length === 3 && at[1] - at[0] >= 1900 && at[2] - at[1] >= 1900, '一个一个接：每个之间隔 ≥ 设定的间隔（这里 2 秒）', at.map((t, i) => i ? t - at[i - 1] : 0).join(','));
  const arcR = JSON.parse(fs.readFileSync(path.join(DATA, 'archive.json'), 'utf8'));
  ok(['crA', 'crB', 'crC'].every((n) => !arcR.items[S[n].sid] || arcR.items[S[n].sid].state === 'restoring') && rl.every((l) => fs.existsSync(sockW(l.split(' ')[5] || 'none'))), '接回的走的是普通的「接回来」：各自一台新 tmux', rl.join(' | '));
  // 接回的窗口登记上墙（假 claude 换成登记同一个会话号的进程）：横幅的总数不该跟着变小（评审 E2：以前会显示「0 个都接回了」）
  for (const n of ['crA', 'crB', 'crC']) {
    const c = spawn(NODE, ['-e', 'setInterval(() => {}, 1e6)', 'claude-fake'], { stdio: 'ignore' }); kids.push(c.pid);
    fs.writeFileSync(path.join(SESS, c.pid + '.json'), JSON.stringify({ pid: c.pid, sessionId: S[n].sid, cwd: CWD, startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli', name: 'w-' + n, nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
  }
  const backOn = await until(async () => { const s = await get('/api/state?peek=1'); return ['crA', 'crB', 'crC'].every((n) => by(s, n)) ? s : null; }, 8000);
  await sleep(3000); st = await get('/api/state?peek=1');
  ok(backOn && st.crash && st.crash.n === 3 && st.crash.done === 3 && st.crash.state === 'done', '接回的窗口登记上墙以后：横幅的总数还是 3、接回 3（以前会越接越小）', JSON.stringify(st.crash));
  for (const n of ['crA', 'crB', 'crC']) await post('/api/archive', { sid: S[n].sid, force: true });   // 收掉：总控台自己停的，不算又一次一起退出
  const dm = await post('/api/crash', { id: cid, action: 'dismiss' }); st = await get('/api/state');
  ok(dm.body.ok && !st.crash, '「先不管」/「知道了」：横幅收起', JSON.stringify(st.crash));
  const bad5 = await post('/api/crash', { id: 'nope', action: 'restore' }), bad6 = await post('/api/crash', { id: cid, action: 'boom' });
  ok(!bad5.body.ok && !bad6.body.ok, '没有这一起 / 不认识的动作：回错，不动', JSON.stringify([bad5.body, bad6.body]));

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
  { let child = null; try { child = fs.readFileSync(ARGV + '.child', 'utf8'); } catch {}
    ok(child === 'unset|unset|unset' && /\ntmux \S+ 拿掉全局环境里的 CLAUDE_CODE_CHILD_SESSION\n/.test('\n' + log() + '\n') && /\ntmux \S+ 拿掉全局环境里的 CCBOARD_DATA\n/.test('\n' + log() + '\n'), '服务和 tmux 全局环境都带着 CLAUDE_CODE_CHILD_SESSION / CLAUDE_PID / CCBOARD_DATA（和线上 App 一样脏）：新开的窗口里没有它们，日志记着从 tmux 全局环境拿掉了', String(child)); }
  await sleep(5500); st = await get('/api/state');
  ok((st.pending || []).some((x) => x.prompt === '做个小工具'), '「启动中」的卡片上只显示你说的那一句', JSON.stringify((st.pending || []).map((x) => x.prompt)));
  clearArgv(); n1 = await post('/api/new', { prompt: '在这里做', cwd: CWD, provider: 'claude' }); got = await readArgv();
  ok(got && got.args.length === 1 && got.args[0] === '在这里做' && real(got.cwd) === real(CWD), '接口上明确给了文件夹的：就在那里做，不附说明', JSON.stringify(got));
  clearArgv(); n1 = await post('/api/new', { prompt: '', cwd: '~', provider: 'claude' }); got = await readArgv();
  ok(got && got.args.length === 0, '空会话：什么都不附', JSON.stringify(got));

  console.log('\n[7a] 新任务选账号：config 里登记的号列在新任务里；选了就从钥匙串读 token 设进会话，没选原样');
  const readEnv = async () => { for (let i = 0; i < 40; i++) { await sleep(150); try { return fs.readFileSync(ARGV + '.env', 'utf8'); } catch {} } return null; };
  const clearEnv = () => { try { fs.unlinkSync(ARGV + '.env'); } catch {} };
  const acc = ((st.providers || {}).claude || {}).accounts || [];
  ok(acc.length === 2 && acc[0].id === 'good' && acc[0].ready === true && acc[1].id === 'none' && acc[1].ready === false, '账号表：钥匙串里有 token 的能选，没有的标出来', JSON.stringify(acc));
  ok(!JSON.stringify(st).includes('tok-good'), '/api/state 里没有 token 本身');
  clearArgv(); clearEnv(); n1 = await post('/api/new', { prompt: '用旧号做', cwd: CWD, provider: 'claude', model: 'opus', account: 'good' }); got = await readArgv(); let envNow = await readEnv();
  ok(n1.body.ok && envNow === 'tok-good|good', '选了号：会话里 CLAUDE_CODE_OAUTH_TOKEN 是钥匙串里那个，CCBOARD_ACCOUNT 是号的 id', JSON.stringify(n1.body) + ' ' + envNow);
  ok(got && got.args.join(' ') === '--model opus 用旧号做', '选了号：claude 收到的参数和没选时一样', JSON.stringify(got && got.args));
  ok(!fs.readFileSync(path.join(ROOT, 'server.out'), 'utf8').includes('tok-good'), '服务日志里没有 token 本身');
  clearArgv(); clearEnv(); n1 = await post('/api/new', { prompt: '默认号做', cwd: CWD, provider: 'claude' }); got = await readArgv(); envNow = await readEnv();
  ok(n1.body.ok && envNow === '|', '没选号：不设 token，用钥匙串里当前登录的号', envNow);
  n1 = await post('/api/new', { prompt: 'x', cwd: CWD, provider: 'claude', account: 'none' });
  ok(!n1.body.ok && /token/.test(n1.body.error), '钥匙串里没有 token 的号：不开，说清原因', JSON.stringify(n1.body));
  n1 = await post('/api/new', { prompt: 'x', cwd: CWD, provider: 'claude', account: 'nobody' });
  ok(!n1.body.ok && /没有这个账号/.test(n1.body.error), '没登记过的号：不开', JSON.stringify(n1.body));

  console.log('\n[7g] 开窗口的一方只说档位 tier：服务翻成模型和强度；写错的档位不开窗口（档位表的断言在 route.test.mjs）');
  clearArgv(); n1 = await post('/api/new', { prompt: '汇总一下', cwd: '~', provider: 'claude', tier: 'light' }); got = await readArgv();
  ok(n1.body.ok && got && got.args.slice(0, 4).join(' ') === '--model sonnet --effort high', 'light 档：带着 --model sonnet --effort high 启动', JSON.stringify(n1.body) + ' ' + JSON.stringify(got && got.args.slice(0, 4)));
  ok(n1.body.route && n1.body.route.tier === 'light' && n1.body.route.model === 'sonnet' && n1.body.route.effort === 'high' && typeof n1.body.route.why === 'string', '应答里带 route（档位、模型、强度、为什么），调用方看得到最后用了什么', JSON.stringify(n1.body));
  clearArgv(); n1 = await post('/api/new', { prompt: '定个方案', cwd: '~', provider: 'claude', tier: 'heavy' }); got = await readArgv();
  ok(got && got.args.slice(0, 4).join(' ') === '--model fable --effort xhigh', 'heavy 档：fable + xhigh', JSON.stringify(got && got.args.slice(0, 4)));
  clearArgv(); n1 = await post('/api/new', { prompt: '写个功能', cwd: '~', provider: 'claude', tier: 'standard' }); got = await readArgv();
  ok(got && got.args.slice(0, 4).join(' ') === '--model opus --effort xhigh', 'standard 档：opus + xhigh', JSON.stringify(got && got.args.slice(0, 4)));
  clearArgv(); n1 = await post('/api/new', { prompt: '汇总一下', cwd: '~', provider: 'claude', tier: 'light', effort: 'xhigh' }); got = await readArgv();
  ok(got && got.args.slice(0, 4).join(' ') === '--model sonnet --effort xhigh', '显式给的强度压过档位，模型还是档位的', JSON.stringify(got && got.args.slice(0, 4)));
  clearArgv(); n1 = await post('/api/new', { prompt: '不认识的档位', cwd: '~', provider: 'claude', tier: 'xl' }); await sleep(1500);
  ok(n1.body.ok === false && /档位只能是/.test(n1.body.error || '') && !fs.existsSync(ARGV), '不认识的档位：报错，窗口没开（假 claude 没被启动）', JSON.stringify(n1.body));
  clearArgv(); n1 = await post('/api/new', { prompt: '原型上的名字', cwd: '~', provider: 'claude', tier: '__proto__' }); await sleep(1500);
  ok(n1.body.ok === false && !fs.existsSync(ARGV), '档位写成 __proto__ 也拦下，窗口没开', JSON.stringify(n1.body));
  ok(/\nroute \S+ ccb-\w+ light claude sonnet high\n/.test('\n' + log()) && /\nroute \S+ ccb-\w+ heavy claude fable xhigh\n/.test('\n' + log()), '服务日志每开一个声明了档位的窗口记一行 route <时间> <窗口> <档位> <谁> <模型> <强度>');
  ok(!/\nroute \S+ \S+ xl /.test('\n' + log()), '被拦下的档位不记 route');

  console.log('\n[7h-0] 短暂套接字故障不删归属；真退出跨三拍才删并记日志');
  const pruneRead = (file) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch { return {}; } };
  const kept = (name) => !!pruneRead('spawn.json')[name] && !!pruneRead('pins.json')[name];
  const pendingHas = async (name) => ((await get('/api/state?peek=1')).pending || []).some((x) => x.name === name);
  await until(() => pendingHas(PRUNE_KEEP), 8000);
  ok(kept(PRUNE_KEEP) && kept(PRUNE_GONE), 'prune: 故障前两台测试 tmux 的 spawn/pin 都存在');
  // 真退出的守卫与长故障同拍等待，避免给整套额外增加时长。
  spawnSync(TMUX_BIN, [...TMW(PRUNE_GONE), 'kill-server'], { env: TENV, stdio: 'ignore' });
  const sock = sockW(PRUNE_KEEP), saved = sock + '.saved';
  fs.renameSync(sock, saved);
  try {
    const fake = spawnSync('/usr/bin/python3', ['-c', 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])', sock], { encoding: 'utf8' });
    if (fake.status !== 0) throw new Error('造无监听套接字失败：' + fake.stderr);
    await sleep(4800);
    ok(kept(PRUNE_KEEP), 'R1 no server running 一拍：spawn 和 pin 都保留');
    await sleep(8500);
    ok(kept(PRUNE_KEEP), 'R4 no server running 超过裁剪阈值且窗格 pid 活着：仍保留');
  } finally { if (fs.existsSync(sock)) fs.unlinkSync(sock); fs.renameSync(saved, sock); }
  await until(() => pendingHas(PRUNE_KEEP), 8000);
  ok(!pruneRead('spawn.json')[PRUNE_GONE] && !pruneRead('pins.json')[PRUNE_GONE] && ['spawn-drop', 'pin-drop'].every((tag) => log().split('\n').filter((l) => l.startsWith(tag + ' ') && l.includes(' ' + PRUNE_GONE + ' ')).length === 1), 'R3 真退出跨三拍过阈值：删 spawn/pin，各一行删除日志', log().split('\n').filter((l) => /^(spawn-drop|pin-drop) /.test(l)).join(' | '));
  const pathSock = sockW(PRUNE_PATH), pathSaved = pathSock + '.saved';
  const pathReady = kept(PRUNE_PATH) && await pendingHas(PRUNE_PATH);
  fs.renameSync(pathSock, pathSaved);
  try { await sleep(4800); ok(pathReady && kept(PRUNE_PATH), 'R2 另一台套接字路径消失一拍：原有 spawn 和 pin 都保留', JSON.stringify({ before: pathReady, after: kept(PRUNE_PATH) })); }
  finally { fs.renameSync(pathSaved, pathSock); }
  await until(() => pendingHas(PRUNE_PATH), 8000);

  console.log('\n[7h] 谁开的这个窗口：/api/new 当场记进 spawn.json（带 Origin 的是他本人，不记；body.from；否则按端口用 lsof 认）');
  const spawnFile = path.join(DATA, 'spawn.json'), spawnNow = () => { try { return JSON.parse(fs.readFileSync(spawnFile, 'utf8')); } catch { return {}; } };
  const spawnLog = () => log().split('\n').filter((x) => x.startsWith('spawn '));
  clearArgv(); n1 = await post('/api/new', { prompt: '被负责人开的', cwd: CWD, provider: 'claude', from: S.peerDone.sid }); await readArgv();
  const nmF = n1.body.name;
  ok(n1.body.ok && n1.body.by === S.peerDone.sid && spawnNow()[nmF] && spawnNow()[nmF].by === S.peerDone.sid && spawnLog().some((x) => new RegExp('^spawn \\S+ ' + nmF + ' ' + S.peerDone.sid.slice(0, 8) + ' from$').test(x)),
    'body.from 是一个活会话的 sid：记进 spawn.json，应答带 by，日志 spawn <时间> <tmux名> <sid 前 8 位> from', JSON.stringify(n1.body) + ' ' + spawnLog().join(' | '));
  // 让这个新窗口上墙：它窗格里的进程（假 claude）登记成一个会话。服务每 4 秒对一次窗格，认出 tmux 名后按 spawn.json 挂到 peerDone 下面
  const pidW = Number(spawnSync(TMUX_BIN, [...TMW(nmF), 'list-panes', '-t', nmF, '-F', '#{pane_pid}'], { env: TENV, encoding: 'utf8' }).stdout.trim()) || 0;   // 新开的窗口住它自己那台（P0-0）；旧代码（跑红时）开在老的那台
  const panePid = pidW || Number(spawnSync(TMUX_BIN, [...TM, 'list-panes', '-t', nmF, '-F', '#{pane_pid}'], { env: TENV, encoding: 'utf8' }).stdout.trim()) || 0;
  const spSid = 'spawned0-0000-4000-8000-' + String(panePid).padStart(12, '0');
  fs.writeFileSync(path.join(PROJ, spSid + '.jsonl'), [R.human('被负责人开的'), R.final('开工了。')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(SESS, panePid + '.json'), JSON.stringify({ pid: panePid, sessionId: spSid, cwd: CWD, startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli', name: 'w-spawned', nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
  const stS = await until(async () => { const r = await get('/api/state'); const x = r.org && r.org.nodes[spSid]; return x && x.via === 'spawn' ? r : null; }, 15000);
  ok(panePid > 0 && stS && stS.org.nodes[spSid].boss === S.peerDone.sid, '这个窗口上墙以后：上级是开它的 peerDone（via spawn）', JSON.stringify(stS ? stS.org.nodes[spSid] : null));
  try { fs.unlinkSync(path.join(SESS, panePid + '.json')); } catch {}
  clearArgv(); const nO = await fetch('http://127.0.0.1:' + PORT + '/api/new', { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json', origin: 'http://127.0.0.1:' + PORT }, body: JSON.stringify({ prompt: '界面上开的', cwd: CWD, provider: 'claude', from: S.peerDone.sid }) }).then((r) => r.json()); await readArgv();
  ok(nO.ok && !('by' in nO) && !spawnNow()[nO.name], '带 Origin（界面自己发的 = 他本人开的）：就算 body 里有 from 也不记', JSON.stringify(nO));
  // 自动认：这个测试进程自己登记成一个会话，用子进程 curl 调 /api/new。服务按 curl 的端口用真的 lsof 找到 curl，往上一层就是这个测试进程
  const meSid = 'tester00-0000-4000-8000-' + String(process.pid).padStart(12, '0'), meReg = path.join(SESS, process.pid + '.json');
  fs.writeFileSync(meReg, JSON.stringify({ pid: process.pid, sessionId: meSid, cwd: CWD, startedAt: Date.now() - 600000, kind: 'interactive', entrypoint: 'cli', name: 'w-tester', nameSource: 'derived', status: 'busy', statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
  const curlNew = (prompt) => new Promise((resolve) => { let o = ''; const c = spawn('/usr/bin/curl', ['-s', '-m', '20', '-X', 'POST', 'http://127.0.0.1:' + PORT + '/api/new', '-H', 'x-ccboard: ' + TOKEN, '-H', 'content-type: application/json', '-d', JSON.stringify({ prompt, cwd: CWD, provider: 'claude' })]);
    c.stdout.on('data', (b) => { o += b; }); c.on('close', () => { try { resolve(JSON.parse(o)); } catch { resolve({ raw: o }); } }); });
  clearArgv(); const nL = await curlNew('子进程 curl 开的'); await readArgv();
  ok(nL.ok && nL.by === meSid && spawnNow()[nL.name] && spawnNow()[nL.name].by === meSid && spawnLog().some((x) => x.includes(' ' + nL.name + ' ' + meSid.slice(0, 8) + ' lsof')), '没给 from：按端口用 lsof 找到 curl，往上一层是登记过的会话 → 记成它（日志写 lsof）', JSON.stringify(nL) + ' ' + spawnLog().join(' | '));
  fs.unlinkSync(meReg);
  clearArgv(); const t0 = Date.now(); n1 = await post('/api/new', { prompt: '认不出是谁开的', cwd: CWD, provider: 'claude', from: 'ghost000-0000-4000-8000-000000000000' }); await readArgv();
  ok(n1.body.ok && !('by' in n1.body) && !spawnNow()[n1.body.name] && Date.now() - t0 < 8000, '认不出（from 不是活会话、往上走也没有登记过的会话）：/api/new 照常成功，不记', JSON.stringify(n1.body));

  console.log('\n[7i] 每个窗口一台 tmux（P0-0）：新开的窗口各住 tmux/<名字>.sock，tmux 在前台、父进程是脱离会话的看护；杀掉一台不带走别的；老的 ccboard.sock 上的窗口照常认、能发；「去终端」attach 它自己的套接字，已经有终端 attach 着就不再开新的');
  const tmw = (n, ...a) => spawnSync(TMUX_BIN, [...TMW(n), ...a], { env: TENV, encoding: 'utf8', timeout: 5000 });
  const tml = (...a) => spawnSync(TMUX_BIN, [...TM, ...a], { env: TENV, encoding: 'utf8', timeout: 5000 });
  const psOf = (pid) => spawnSync('/bin/ps', ['-ww', '-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  const xlog = () => { try { return fs.readFileSync(path.join(DATA, 'tmux-exit.log'), 'utf8'); } catch { return ''; } };
  const cenv = () => { try { return fs.readFileSync(ARGV + '.cenv', 'utf8'); } catch { return null; } };
  clearArgv(); try { fs.unlinkSync(ARGV + '.cenv'); } catch {}
  const pwA = await post('/api/new', { prompt: 'PW-A', cwd: CWD, provider: 'claude' }); await readArgv(); const ceA = cenv();
  clearArgv(); const pwB = await post('/api/new', { prompt: 'PW-B', cwd: CWD, provider: 'claude' }); await readArgv();
  const nA = pwA.body.name, nB = pwB.body.name;
  ok(pwA.body.ok && pwB.body.ok && nA !== nB && fs.existsSync(sockW(nA)) && fs.existsSync(sockW(nB)) && tmw(nA, 'has-session', '-t', nA).status === 0 && tmw(nB, 'has-session', '-t', nB).status === 0,
    '两个新窗口各一台 tmux：tmux/<名字>.sock 各一个、各自认得自己的会话', JSON.stringify({ a: pwA.body, b: pwB.body, dir: (() => { try { return fs.readdirSync(WD); } catch { return null; } })() }));
  ok(tml('has-session', '-t', nA).status !== 0 && tml('has-session', '-t', nB).status !== 0, '新窗口不在老的 ccboard.sock 上');
  ok(ceA !== null && new RegExp('^TMUX=.*/tmux/' + nA + '\\.sock,', 'm').test(ceA) && !/^CLAUDE_CODE_CHILD_SESSION=/m.test(ceA) && !/^CLAUDE_EFFORT=/m.test(ceA) && !/^CCBOARD_/m.test(ceA),
    '窗格里：$TMUX 指着它自己的套接字；服务环境里的 CLAUDE_CODE_CHILD_SESSION / CLAUDE_EFFORT（带着它新开的 claude 会当成子会话）和 CCBOARD_*（窗口里起的沙盒服务会写真实数据目录）都没带进来', ceA);
  const sA = Number(tmw(nA, 'display', '-p', '#{pid}').stdout.trim()) || 0, wA = Number((psOf(sA).split(/\s+/)[0]) || 0), wCmd = wA ? psOf(wA) : '';
  ok(sA && / -D /.test(psOf(sA)) && wA && wA !== srv.pid && /ccb-watch/.test(wCmd) && wCmd.includes(nA + '.sock') && Number(wCmd.split(/\s+/)[0]) === 1,
    'tmux 在前台跑（-D），父进程是看护（命令行带 ccb-watch 和它的套接字），看护已经脱离服务（它的父进程是 1）', JSON.stringify({ server: psOf(sA), watch: wCmd.slice(0, 160) }));
  ok(new RegExp(' start ' + nA + ' pid=' + sA + '\\b').test(xlog()), '看护起来时记一行 start <名字> pid=<tmux 进程号>', xlog());
  if (sA > 1) process.kill(sA, 'SIGKILL');                                  // 取不到进程号（旧代码没有这台）时不杀：kill(0) 会杀掉整个进程组（11/16 红阶段就这样带走了测试和锁）
  const endA = await until(async () => xlog().split('\n').find((l) => l.includes(' end ' + nA + ' ') && / signal 9\b/.test(l)), 5000);
  ok(endA, '被 kill -9：看护记下「end <名字> … signal 9 KILL」（分得清是被硬杀的）', xlog());
  ok(!fs.existsSync(sockW(nA)) && tmw(nB, 'has-session', '-t', nB).status === 0, '杀掉一台：它的套接字由看护收走，另一台照样在', JSON.stringify({ a: fs.existsSync(sockW(nA)), dir: (() => { try { return fs.readdirSync(WD); } catch { return null; } })() }));   // 旧代码没有 tmux/ 目录：这里不能抛，红的时候也要跑到底、打出条数
  // 让 B 上墙（它窗格里的假 claude 登记成一个会话），再 mk 一个开在老 ccboard.sock 上的窗口
  const pidB = Number(tmw(nB, 'list-panes', '-t', nB, '-F', '#{pane_pid}').stdout.trim()) || 0;
  const sidB = 'pwB00000-0000-4000-8000-' + String(pidB).padStart(12, '0'), fileB = path.join(PROJ, sidB + '.jsonl');
  fs.writeFileSync(fileB, [R.human('PW-B'), R.final('开工了。')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(SESS, pidB + '.json'), JSON.stringify({ pid: pidB, sessionId: sidB, cwd: CWD, startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli', name: 'w-pwB', nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
  mk('legacy', 'idle', [R.human('老窗口'), R.final('好了。')], { tmux: 'ccb-legacy1' });
  const onW = await until(async () => { const s = await get('/api/state?peek=1'); const b = s.sessions.find((x) => x.sid === sidB), l = by(s, 'legacy'); return b && l && b.channel === 'tmux' && b.tmux === nB && l.channel === 'tmux' && l.tmux === 'ccb-legacy1' ? [b, l] : null; }, 12000);
  ok(onW, '服务两处都枚举：新窗口（tmux/<名字>.sock）和老窗口（ccboard.sock）都认成 tmux 通道', JSON.stringify(onW));
  const sendVia = async (sid, file, text) => { const p = post('/api/send', { sid, text }); await sleep(1500); fs.appendFileSync(file, JSON.stringify(R.human(text)) + '\n'); return p; };
  const sdB = await sendVia(sidB, fileB, 'HELLO-B'), sdL = await sendVia(S.legacy.sid, S.legacy.file, 'HELLO-L');
  ok(sdB.body.ok && /HELLO-B/.test(tmw(nB, 'capture-pane', '-p', '-t', nB).stdout || ''), '杀掉 A 之后：B 照样能发（字进了它自己那台 tmux 的窗格）', JSON.stringify(sdB.body));
  ok(sdL.body.ok && /HELLO-L/.test(tml('capture-pane', '-p', '-t', 'ccb-legacy1').stdout || ''), '老 ccboard.sock 上的窗口照样能发', JSON.stringify(sdL.body));
  await post('/api/focus', { sid: S.legacy.sid }); await post('/api/focus', { sid: sidB });
  const fls = () => log().split('\n').filter((l) => l.startsWith('focus '));
  ok(fls().some((l) => / dry:open ccb-legacy1 -S /.test(l) && l.endsWith(' -S ' + TSOCK)) && fls().some((l) => l.includes(' dry:open ' + nB + ' -S ') && l.endsWith('/tmux/' + nB + '.sock')),
    '「去终端」：试验场里不碰 Ghostty、只记一行；attach 的是那个窗口自己的套接字（老窗口 ccboard.sock、新窗口 tmux/<名字>.sock）', fls().join(' | '));
  const cli = spawn('/usr/bin/script', ['-q', '/dev/null', TMUX_BIN, ...TMW(nB), 'attach', '-t', nB], { env: TENV, stdio: 'ignore' }); kids.push(cli.pid);
  const tty = await until(async () => (tmw(nB, 'list-clients', '-t', nB, '-F', '#{client_tty}').stdout || '').trim(), 5000);
  await post('/api/focus', { sid: sidB });
  ok(tty && fls().some((l) => l.includes(' dry:reuse ' + nB + ' ') && l.includes(tty)), '已经有一个终端 attach 着（11/15–16 同一个会话挂过 5–7 个标签）：再点「去终端」认出它的 tty、去聚焦它，不再开新标签', fls().join(' | ') + ' tty=' + tty);
  try { process.kill(cli.pid, 'SIGTERM'); } catch {}
  // 窗口里的程序自己退出（他在终端里 /exit）：会话没了，那台 tmux 自己退（-D 会关掉 exit-empty，要重新打开），看护记 exit 0、收走套接字
  const sB = Number(tmw(nB, 'display', '-p', '#{pid}').stdout.trim()) || 0;
  tmw(nB, 'send-keys', '-t', nB, 'C-c');
  const endB = await until(async () => xlog().split('\n').find((l) => l.includes(' end ' + nB + ' ') && / exit 0\b/.test(l)), 8000);
  ok(endB && !fs.existsSync(sockW(nB)) && (() => { try { process.kill(sB, 0); return false; } catch { return true; } })(), '窗口里的程序退出：那台 tmux 自己退掉（不留空服务器），看护记「exit 0」、收走套接字', xlog());

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
  n1 = await post('/api/new', { prompt: 'TRUSTME 在别的文件夹', cwd: CWD, provider: 'claude' });   // Agent 开窗口都带 cwd：11/15 起开在哪个文件夹都替他点
  let tr7e = null; for (let i = 0; i < 40 && !tr7e; i++) { await sleep(250); tr7e = trustNow(); }
  ok(CWD !== FH && tr7e ==='Yes, I trust this folder', '开在主目录以外的文件夹：照样点「Yes, I trust this folder」', String(tr7e));
  ok(new RegExp('trust .* ' + n1.body.name + ' yes').test(log()), '服务日志里记的是这个窗口', log().split('\n').filter((l) => l.startsWith('trust')).join(' | '));

  console.log('\n[7c-2] 首次启动向导（有人 /logout、/login 以后新起的每个 claude 都先走一遍）：选主题、Security notes 回车，终端设置按 Esc，再点信任框；选登录方式一个键都不碰；恢复归档出来的窗口一样');
  const keysFile = ARGV + '.keys', keysNow = () => { try { return fs.readFileSync(keysFile, 'utf8').trim().split('\n').join(','); } catch { return null; } };
  const obLines = (name) => log().split('\n').filter((l) => l.startsWith('onboard ') && l.includes(' ' + name + ' '));
  const OB_KEYS = 'Enter,Enter,Esc,Down,Enter';
  for (const f of [trustFile, keysFile]) try { fs.unlinkSync(f); } catch {}
  n1 = await post('/api/new', { prompt: 'ONBOARD 做点事', cwd: '~', provider: 'claude' });
  let tr7g = null; for (let i = 0; i < 80 && !tr7g; i++) { await sleep(250); tr7g = trustNow(); }
  ok(tr7g === 'Yes, I trust this folder' && keysNow() === OB_KEYS, '新任务：向导四屏按对了键（主题 Enter、Security Enter、终端设置 Esc、信任框 Down + Enter）', JSON.stringify({ tr7g, keys: keysNow() }));
  const ob7 = obLines(n1.body.name);
  ok(ob7.length === 3 && / theme Enter ok$/.test(ob7[0]) && / security Enter ok$/.test(ob7[1]) && / terminal-setup Escape ok$/.test(ob7[2]), '服务日志：向导每一屏恰好一行 onboard（theme / security / terminal-setup），不重复按', ob7.join(' | '));
  for (const f of [trustFile, keysFile]) try { fs.unlinkSync(f); } catch {}
  n1 = await post('/api/new', { prompt: 'LOGINSCREEN 做点事', cwd: '~', provider: 'claude' });
  await sleep(6000);
  ok(keysNow() === null && trustNow() === null && obLines(n1.body.name).length === 0, '选登录方式：一个键都不按（真 Claude Code 在这里回车会开始一次 OAuth 登录），日志里没有这个窗口的 onboard 行', JSON.stringify({ keys: keysNow(), ob: obLines(n1.body.name) }));
  for (const f of [trustFile, keysFile]) try { fs.unlinkSync(f); } catch {}
  const rs7 = (await post('/api/unarchive', { sid: S.tidyAsk.sid })).body;
  let tr7h = null; for (let i = 0; i < 80 && !tr7h; i++) { await sleep(250); tr7h = trustNow(); }
  ok(rs7.ok && rs7.resumed && tr7h === 'Yes, I trust this folder' && keysNow() === OB_KEYS, '恢复归档：恢复出来的窗口（claude --resume）也替他过向导和信任框，以前只有新任务点', JSON.stringify({ rs7, tr7h, keys: keysNow() }));
  ok(obLines(rs7.name).length === 3 && new RegExp('trust .* ' + rs7.name + ' yes').test(log()), '恢复归档：日志里是这个窗口，3 行 onboard 加 1 行 trust', obLines(rs7.name).join(' | '));
  ok(rs7.ok && fs.existsSync(sockW(rs7.name)) && tmw(rs7.name, 'has-session', '-t', rs7.name).status === 0 && tml('has-session', '-t', rs7.name).status !== 0, '恢复归档：接回来的窗口也是自己一台 tmux（tmux/<名字>.sock），不落在老的 ccboard.sock 上', rs7.name);

  console.log('\n[7m] Code Mode 开窗口和接回（11/17 作者 本人要的）：勾了开关的那一个窗口、记录里最后一次是 Code Mode 的接回窗口，环境里带 CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1，claude 的参数不变；别的一律不带');
  // 假 claude 每次启动写一个 argv.cm.XXXXXX：第一段是它看到的这个变量（没有写 unset），后面是它收到的参数（\0 分隔）
  const cmLaunch = () => fs.readdirSync(ROOT).filter((f) => f.startsWith('argv.cm.')).map((f) => { const p = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\0').slice(0, -1); return { env: p[0], args: p.slice(1) }; });
  const cmWait = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const hit = cmLaunch().filter(pred); if (hit.length) { await sleep(300); return cmLaunch().filter(pred); } await sleep(200); } return []; };
  const cmLog = () => log().split('\n').filter((l) => l.startsWith('codemode '));
  const has7 = (p) => (x) => x.args.some((a) => a.startsWith(p));
  let r7m = await post('/api/new', { prompt: 'CMODE-ON 找坏链接', cwd: '~', provider: 'claude', codeMode: true }), L7m = await cmWait(has7('CMODE-ON 找坏链接'));
  ok(r7m.body.ok && r7m.body.codeMode === true && L7m.length === 1 && L7m[0].env === '1', '勾了 Code Mode：开出来的窗口环境里 CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1，应答带 codeMode: true', JSON.stringify({ body: r7m.body, env: L7m.map((x) => x.env) }));
  ok(L7m.length === 1 && L7m[0].args.length === 1 && L7m[0].args[0].startsWith('CMODE-ON 找坏链接'), 'claude 收到的参数和不勾时一样：只有任务原文（变量是外面套的 /usr/bin/env 给的，不是参数）', JSON.stringify(L7m.map((x) => x.args.map((a) => a.slice(0, 24)))));
  ok(cmLog().filter((l) => l.endsWith(' ' + r7m.body.name + ' new on')).length === 1, '服务日志一行 codemode <时间> <窗口> new on', cmLog().join(' | '));
  r7m = await post('/api/new', { prompt: 'CMODE-OFF 普通任务', cwd: '~', provider: 'claude', codeMode: false }); L7m = await cmWait(has7('CMODE-OFF 普通任务'));
  const r7n = await post('/api/new', { prompt: 'CMODE-NONE 不传', cwd: '~', provider: 'claude' }), L7n = await cmWait(has7('CMODE-NONE 不传'));
  ok(r7m.body.ok && r7m.body.codeMode === false && L7m.length === 1 && L7m[0].env === 'unset' && r7n.body.ok && r7n.body.codeMode === false && L7n.length === 1 && L7n[0].env === 'unset', 'codeMode: false 和不传：环境里没有这个变量，应答 codeMode: false', JSON.stringify([r7m.body.codeMode, L7m.map((x) => x.env), r7n.body.codeMode, L7n.map((x) => x.env)]));
  try { fs.unlinkSync(ARGV + '.env'); } catch {}
  r7m = await post('/api/new', { prompt: 'CMODE-ON 用旧号', cwd: '~', provider: 'claude', codeMode: true, account: 'good', model: 'opus' }); L7m = await cmWait(has7('CMODE-ON 用旧号'));
  let env7m = null; for (let i = 0; i < 40 && env7m === null; i++) { await sleep(150); try { env7m = fs.readFileSync(ARGV + '.env', 'utf8'); } catch {} }
  ok(r7m.body.ok && L7m.length === 1 && L7m[0].env === '1' && env7m === 'tok-good|good' && L7m[0].args.slice(0, 2).join(' ') === '--model opus', '选了账号再勾 Code Mode：读钥匙串的那层 zsh 里面照样带上变量，token 照旧设好，参数照旧', JSON.stringify({ env: L7m.map((x) => x.env), env7m, args: L7m.map((x) => x.args.slice(0, 2)) }));
  const n7x = cmLaunch().length, bad7 = [];
  for (const v of ['yes', 1, 'true', {}]) bad7.push((await post('/api/new', { prompt: 'CMODE-BAD ' + JSON.stringify(v), cwd: '~', provider: 'claude', codeMode: v })).body);
  await sleep(1500);
  ok(bad7.every((b) => b.ok === false && /codeMode/.test(b.error || '')) && cmLaunch().length === n7x, 'codeMode 写成 "yes"、1、"true"、{}：报错、不开窗口（只有 true 才开，不猜）', JSON.stringify(bad7));
  const cx7 = await post('/api/new', { prompt: 'x', cwd: '~', provider: 'codex', codeMode: true, model: 'bad model!' });   // 写坏的模型名：万一放过去了也在起进程之前被拦下（不真开 Codex）
  ok(cx7.body.ok === false && /Code Mode 只有 Claude Code 有/.test(cx7.body.error || ''), 'Codex + codeMode：报错「Code Mode 只有 Claude Code 有」，不悄悄忽略', JSON.stringify(cx7.body));
  const CM4 = ['cmReal', 'cmOff', 'cmQuote', 'cmBad'], CMX = ['cmEdge', 'cmNest'], ar7 = {}, un7 = {}, rs7m = {};   // CMX：评审补的两个守卫（跨块、嵌着 false），和这四个一起归档、接回
  for (const n of [...CM4, ...CMX]) ar7[n] = (await post('/api/archive', { sid: S[n].sid })).body;
  ok(CM4.every((n) => ar7[n].ok && ar7[n].keep === true) && /改过 3 次文件/.test(ar7.cmReal.why || ''), '归档：四个都留着（能接回）；cmReal 的理由是「改过 3 次文件」（脚本里的 Write / Edit 也算，以前是「用了 4 次工具」）', JSON.stringify(ar7));
  await sleep(9500);                                                     // 等过 8 秒的反悔时间，真停了才是「接回」而不是撤销
  fs.chmodSync(S.cmBad.file, 0o000);
  try {
    for (const n of [...CM4, ...CMX]) un7[n] = (await post('/api/unarchive', { sid: S[n].sid })).body;
    for (const n of [...CM4, ...CMX]) rs7m[n] = (await cmWait((x) => x.args[0] === '--resume' && x.args[1] === S[n].sid)).map((x) => x.env).join(',');
  } finally { try { fs.chmodSync(S.cmBad.file, 0o644); } catch {} }
  ok(CM4.every((n) => un7[n].ok && un7[n].resumed), '四个都接回来了（claude --resume）', JSON.stringify(un7));
  ok(rs7m.cmReal === '1', '接回：记录里最后一条 repl-mode 是 true 的（cmReal）照样带上变量', JSON.stringify(rs7m));
  ok(rs7m.cmOff === 'unset' && rs7m.cmQuote === 'unset', '接回：中途关掉的（最后一条 false）、只是记录里嵌着一个 repl-mode 对象的，不带', JSON.stringify(rs7m));
  ok(rs7m.cmBad === 'unset', '接回：记录读不了（权限 000）→ 不带（宁可少开）', JSON.stringify(rs7m));
  const cl7 = cmLog(), k8 = (n) => S[n].sid.slice(0, 8);
  ok(cl7.filter((l) => l.includes(' resume ' + k8('cmReal') + ' on')).length === 1 && cl7.filter((l) => l.includes(' ' + k8('cmBad') + ' ') && /读不了对话记录.*接回不带 Code Mode/.test(l)).length === 1 && !cl7.some((l) => l.includes(k8('cmOff')) || l.includes(k8('cmQuote'))),
    '服务日志：cmReal 接回一行 on；cmBad 恰好一行「读不了对话记录…接回不带 Code Mode」；cmOff、cmQuote 一行都没有（关了、没开过都不是出错）', cl7.join(' | '));
  const kx = (n) => cl7.filter((l) => l.includes(' ' + k8(n) + ' ')).length;
  ok(CMX.every((n) => ar7[n].ok && un7[n].ok && un7[n].resumed) && rs7m.cmEdge === '1' && cl7.filter((l) => l.includes(' resume ' + k8('cmEdge') + ' on')).length === 1 && kx('cmEdge') === 1,
    '接回（一块 64 字节、块的边界切在最后那条 repl-mode 中间）：前一块那半行接上后一块开头那半行，读出 true、带上变量，日志只有 on 那一行（不报「那一行坏了」）', JSON.stringify({ ar: ar7.cmEdge, un: un7.cmEdge, env: rs7m.cmEdge, log: cl7.filter((l) => l.includes(k8('cmEdge'))) }));
  ok(rs7m.cmNest === '1' && cl7.filter((l) => l.includes(' resume ' + k8('cmNest') + ' on')).length === 1 && kx('cmNest') === 1,
    '接回：真的 repl-mode true 后面有一条记录里嵌着 replMode: false 的对象 → 嵌着的跳过，照样带上变量', JSON.stringify({ env: rs7m.cmNest, log: cl7.filter((l) => l.includes(k8('cmNest'))) }));

  // 接回账号用独立假主目录、数据目录和钥匙串；tmux 仍归本趟测试的套接字目录收尾。
  {
    const UH = path.join(ROOT, 'resume-home'), UD = path.join(UH, 'Library/Application Support/cc-board'), UP = PORT + 260;
    const US = path.join(UH, '.claude/sessions'), UC = path.join(UH, 'work'), UJ = path.join(UH, '.claude/projects', UC.replace(/[^A-Za-z0-9]/g, '-'));
    for (const d of [UD, US, UC, UJ, path.join(UD, 'limits')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ accounts: [{ id: 'main', name: '默认号' }, { id: 'friend', name: '原号' }], defaultAccount: 'main' }));
    const SEC = path.join(ROOT, 'resume-security'), FLAG = SEC + '.friend', UA = path.join(ROOT, 'resume-argv');
    fs.writeFileSync(FLAG, 'yes');
    fs.writeFileSync(SEC, '#!/bin/sh\nsvc=; w=0\nwhile [ $# -gt 0 ]; do case "$1" in -s) svc="$2"; shift;; -w) w=1;; esac; shift; done\ncase "$svc" in ccboard-account-main) id=main;; ccboard-account-friend) [ -f "' + FLAG + '" ] || exit 44; id=friend;; *) exit 44;; esac\n[ $w = 1 ] && echo tok-$id\nexit 0\n', { mode: 0o755 });
    const U = {};
    for (const [i, name] of ['original', 'null', 'missing', 'blocked'].entries()) {
      const c = spawn(NODE, ['-e', 'setInterval(() => {}, 1e6)', 'claude-fake'], { stdio: 'ignore' }); kids.push(c.pid);
      const sid = 'ua00000' + i + '-0000-4000-8000-000000000001', file = path.join(UJ, sid + '.jsonl'), at = Date.now() - 60000;
      const records = [R.human('核对接回账号'), R.tool('Edit'), R.result(), R.final('文件已改好。')];
      if (name === 'original') records.unshift({ type: 'repl-mode', replMode: true });
      fs.writeFileSync(file, records.map((x, k) => JSON.stringify({ ...x, timestamp: new Date(at + k * 1000).toISOString() })).join('\n') + '\n');
      fs.writeFileSync(path.join(US, c.pid + '.json'), JSON.stringify({ pid: c.pid, sessionId: sid, cwd: UC, startedAt: at, kind: 'interactive', entrypoint: 'cli', name: 'resume-' + name, status: 'idle', statusUpdatedAt: at, updatedAt: at }));
      U[name] = { sid, tap: path.join(UD, 'limits/claude-' + sid + '.json') };
      if (name !== 'missing') fs.writeFileSync(U[name].tap, JSON.stringify({ account: name === 'null' ? null : 'friend' }));
    }
    let usrv, utok = '';
    const ustart = async () => {
      const o = fs.openSync(path.join(ROOT, 'resume-server.out'), 'a');
      usrv = spawn(NODE, [SERVER], { env: { ...env, HOME: UH, CCBOARD_DATA: UD, CCBOARD_PORT: String(UP), CCBOARD_SECURITY: SEC, T_ARGV: UA }, stdio: ['ignore', o, o] }); kids.push(usrv.pid);
      return until(async () => { try { const h = await (await fetch('http://127.0.0.1:' + UP + '/health')).json(); utok = fs.readFileSync(path.join(UD, '.token'), 'utf8').trim(); return h.pid === usrv.pid; } catch { return false; } }, 10000);
    };
    const ustop = async () => { if (usrv?.pid > 1) { try { process.kill(usrv.pid, 'SIGTERM'); } catch {} await until(() => usrv.exitCode !== null, 5000); } };
    const urq = async (p, body) => (await fetch('http://127.0.0.1:' + UP + p, { method: body ? 'POST' : 'GET', headers: { 'x-ccboard': utok, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
    const uenv = () => { try { return fs.readFileSync(UA + '.env', 'utf8'); } catch { return ''; } };
    const uresume = async name => {
      try { fs.unlinkSync(UA + '.env'); } catch {}
      const res = await urq('/api/unarchive', { sid: U[name].sid });
      const got = res.ok ? await until(() => uenv() || null, 8000) : '';
      const argv = res.ok ? tmw(res.name, 'display-message', '-p', '#{pane_start_command}').stdout.trim() : '';
      return { res, got, argv };
    };
    try {
      if (!(await ustart())) throw Error('接回账号夹具服务未启动');
      await until(async () => (await urq('/api/state?peek=1')).sessions.length === 4, 10000);
      for (const x of Object.values(U)) await urq('/api/archive', { sid: x.sid });
      const saved = JSON.parse(fs.readFileSync(path.join(UD, 'archive.json'), 'utf8')).items[U.original.sid];
      fs.unlinkSync(U.original.tap);
      await until(async () => (await urq('/api/archive')).items.every(x => x.state === 'archived'), 12000);
      const one = await uresume('original');
      const apos = one.argv.indexOf('ccboard-account-friend'), cpos = one.argv.indexOf('CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1'), rpos = one.argv.indexOf('--resume');
      ok(saved?.account === 'friend' && one.res.ok && one.got === 'tok-friend|friend' && apos >= 0 && cpos > apos && rpos > cpos && one.argv.includes(U.original.sid), '接回账号：归档保存 friend，tap 清掉后仍包 friend，Code Mode 在账号层里面、resume 在最里面', JSON.stringify({ saved: saved?.account, ...one }));
      const two = await uresume('null'), three = await uresume('missing');
      ok([two, three].every(x => x.res.ok && x.got === 'tok-main|main' && x.argv.includes('ccboard-account-main')), '接回账号：tap 是 null 和没有 tap 都包 defaultAccount main', JSON.stringify([two, three]));
      await ustop(); fs.unlinkSync(FLAG); await ustart();
      const archivedBefore = (await urq('/api/state?peek=1')).archived;
      const before = fs.readdirSync(WD).filter(x => x.endsWith('.sock')).sort().join(), bad = await uresume('blocked');
      const entry = (await urq('/api/archive')).items.find(x => x.sid === U.blocked.sid), after = fs.readdirSync(WD).filter(x => x.endsWith('.sock')).sort().join();
      const archivedAfter = (await urq('/api/state?peek=1')).archived;
      ok(!bad.res.ok && /原号.*token/.test(bad.res.error || '') && before === after && entry?.state === 'archived' && !entry.tmux && !uenv() && archivedAfter === archivedBefore && archivedAfter > 0, '接回账号：原号没有 token 就不开窗口，保持 archived，不改用 main', JSON.stringify({ bad, entry, archivedBefore, archivedAfter, sameSockets: before === after }));
    } finally { await ustop(); }
  }

  console.log('\n[7r] 新开的会话一开就退了（撞上 claude 自动更新）：等一下、重新找 claude、换个名字重开一次；还退就说「会话一开就退了（claude 可能正在更新）」，套接字目录明明在就不再问它');
  const FLK = ARGV + '.flaky', FLKN = ARGV + '.flakyn', ALTON = path.join(FH, 'alt-claude-on'), ALTLOG = ARGV + '.alt';
  const flaky = (n, pat, d) => { for (const f of [FLKN, ARGV + '.env']) try { fs.unlinkSync(f); } catch {} fs.writeFileSync(FLK, n + '\n' + pat + '\n' + d + '\n'); };
  const flakyN = () => { try { return fs.readFileSync(FLKN, 'utf8').split('\n').filter(Boolean).join(','); } catch { return ''; } };
  const altN = () => { try { return fs.readFileSync(ALTLOG, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  const reLines = () => log().split('\n').filter((l) => l.startsWith('launch ') && l.includes('一开就退了'));
  const up7r = (n) => !!n && tmw(n, 'has-session', '-t', n).status === 0;
  const arc7r = async (sid) => ((await get('/api/archive')).items || []).find((x) => x.sid === sid) || null;
  const re0 = reLines().length;
  fs.writeFileSync(ALTON, '');                                 // 这一项里 PATH 排第一的 claude 换成 altbin/claude：重开前重新找了的话，第二次走它
  flaky(1, 'RESPAWN-A', 0);
  const rA = (await post('/api/new', { prompt: 'RESPAWN-A 一开就退', cwd: CWD, provider: 'claude' })).body; await sleep(600);
  try { fs.unlinkSync(ALTON); } catch {}
  ok(rA.ok && flakyN() === 'die,live' && up7r(rA.name), '一开就退（马上退的那种）：重开一次，接口回的是第二次开的窗口、它活着', JSON.stringify({ rA, n: flakyN() }));
  ok(altN() === 1, '重开前丢掉缓存的 claude 路径重新找：第二次走的是这时 PATH 里排第一的那个（altbin/claude）', String(altN()));
  ok(reLines().length === re0 + 1, '服务日志恰好一行 launch … 一开就退了', reLines().slice(re0).join(' | '));
  flaky(1, 'RESPAWN-B', 0.4);
  const rB = (await post('/api/new', { prompt: 'RESPAWN-B 读完钥匙串才退', cwd: CWD, provider: 'claude', account: 'good', model: 'opus' })).body; await sleep(600);
  let envB = null; try { envB = fs.readFileSync(ARGV + '.env', 'utf8'); } catch {}
  ok(rB.ok && rB.account === 'good' && flakyN() === 'die,live' && up7r(rB.name) && envB === 'tok-good|good', '选了号、0.4 秒后才退（晚一点退的那种：has-session 早过了，以前接口照样回 ok）：开完再看一会儿，看出来就重开一次，第二次照样读钥匙串', JSON.stringify({ rB, n: flakyN(), envB }));
  flaky(2, 'RESPAWN-C', 0.4);
  const reC = reLines().length;
  const rC = (await post('/api/new', { prompt: 'RESPAWN-C 两次都退', cwd: CWD, provider: 'claude' })).body; await sleep(600);
  ok(!rC.ok && /^会话一开就退了（claude 可能正在更新）/.test(rC.error || '') && !/套接字/.test(rC.error || ''), '重开一次还退：报「会话一开就退了（claude 可能正在更新）」；套接字目录明明在，不再问它在不在', JSON.stringify(rC));
  ok(flakyN() === 'die,die' && reLines().length === reC + 1, '只重开一次：一共起两次、日志一行', JSON.stringify({ n: flakyN(), log: reLines().slice(reC) }));
  const aD = await arc7r(S.atFyi.sid);
  flaky(1, S.atFyi.sid, 0.4);
  const rD = (await post('/api/unarchive', { sid: S.atFyi.sid })).body; await sleep(600);
  ok(aD && aD.state === 'archived' && rD.ok && rD.resumed && flakyN() === 'die,live' && up7r(rD.name), '接回归档（claude --resume）也一样：0.4 秒后退 → 重开一次，回的是活着的那个窗口', JSON.stringify({ was: aD && aD.state, rD, n: flakyN() }));
  const aE = await arc7r(S.gone.sid);
  flaky(2, S.gone.sid, 0.4);
  const rE = (await post('/api/unarchive', { sid: S.gone.sid })).body; const aE2 = await arc7r(S.gone.sid);
  ok(aE && aE.state === 'archived' && !rE.ok && /^会话一开就退了（claude 可能正在更新）/.test(rE.error || '') && flakyN() === 'die,die' && aE2 && aE2.state === 'archived', '接回重开一次还退：报一开就退了，归档里退回「已停」，以后还能再接', JSON.stringify({ was: aE && aE.state, rE, n: flakyN(), now: aE2 && aE2.state }));
  // 关到一半（整套测试偶尔会红一次，报 tmux 没开出会话）：会话一开就退、那台 tmux 跟着退的时候，
  // has-session 正好连上一台正在关的服务器，回的不是上面认得的三句，而是 server exited unexpectedly（连上了、话没说完服务器就没了）或
  // no current target（服务器还在、会话已经没了）。真时序撞上的机会小（自己的套接字上 1000 次 19 + 5），这里让假 claude 第一次启动时
  // 把测试备好的套接字改名盖到它自己那台的套接字上，之后每次 has-session 回的都是这一句：第一次检查（i === 0）就撞上，旧代码回
  // 「tmux 没开出会话：…」；没撞上，之后每次都是这一句，旧代码等满 SETTLE_MS 回 ok、回的是死窗口。两种都红，认得这两句以后都重开一次
  const tmRaw = (sock, ...a) => spawnSync(TMUX_BIN, [...TMS(sock), ...a], { env: TENV, encoding: 'utf8', timeout: 5000 });
  const SWP = ARGV + '.swapped';
  const midExit = async (tag, prep) => {
    try { fs.unlinkSync(SWP); } catch {}
    const self = (tmRaw(prep, 'has-session', '-t', 'x').stderr || '').trim();
    flaky(1, tag, 'swap:' + prep);
    const l0 = reLines().length;
    const r = (await post('/api/new', { prompt: tag + ' 关到一半', cwd: CWD, provider: 'claude' })).body; await sleep(600);
    let sw = null; try { const [s, p] = fs.readFileSync(SWP, 'utf8').trim().split(' '); sw = { name: path.basename(s, '.sock'), p: Number(p) }; if (sw.p) kids.push(sw.p); } catch {}
    const after = sw ? (tmw(sw.name, 'has-session', '-t', 'x').stderr || '').trim() : '';
    return { r, self, after, sw, n: flakyN(), lines: reLines().length - l0 };
  };
  const unswap = (x) => { if (!x.sw) return; try { fs.unlinkSync(sockW(x.sw.name)); } catch {} try { process.kill(x.sw.p, 'SIGTERM'); } catch {} };   // 先拿掉盖上去的套接字，再让原来那台退（它退时删的是同一个路径，已经没了）
  const RF = path.join(TMUXDIR, 'rf.sock');
  // 连上就关：tmux 客户端看到的就是服务器话没说完就没了。放在子进程里：下面的核对用 spawnSync，假套接字要是在测试自己这个进程里，事件循环被卡住、接不了话
  // （11/19 第一趟先红，自检就是这样等满 5 秒回了空的）
  const fake = spawn(NODE, ['-e', 'require("net").createServer((c) => c.destroy()).listen(process.argv[1])', RF], { stdio: 'ignore' }); kids.push(fake.pid);
  for (let i = 0; i < 30 && !fs.existsSync(RF); i++) await sleep(100);
  const xG = await midExit('RESPAWN-G', RF);
  try { process.kill(fake.pid, 'SIGTERM'); } catch {} unswap(xG);
  ok(xG.self === 'server exited unexpectedly' && !!xG.sw && xG.after === 'server exited unexpectedly', '夹具自检（关到一半之一）：备好的套接字、盖过去以后旧窗口的套接字，has-session 回的都是 server exited unexpectedly', JSON.stringify({ self: xG.self, sw: xG.sw, after: xG.after }));
  ok(xG.r.ok && xG.n === 'die,live' && up7r(xG.r.name) && xG.lines === 1, '关到一半（server exited unexpectedly）也算一开就退：重开一次，接口回的是第二次开的窗口、它活着；日志一行', JSON.stringify({ r: xG.r, n: xG.n, lines: xG.lines }));
  const RE = path.join(TMUXDIR, 're.sock');
  const empty = spawn(TMUX_BIN, ['-D', ...TMS(RE), '-f', '/dev/null'], { env: TENV, stdio: 'ignore' }); kids.push(empty.pid);   // -D 关掉 exit-empty：没有会话也不退
  for (let i = 0; i < 30 && tmRaw(RE, 'list-sessions').status !== 0; i++) await sleep(100);
  const xH = await midExit('RESPAWN-H', RE);
  try { process.kill(empty.pid, 'SIGTERM'); } catch {} unswap(xH);
  ok(xH.self === 'no current target' && !!xH.sw && xH.after === 'no current target', '夹具自检（关到一半之二）：一台没有会话的 tmux，备好时和盖过去以后，has-session 回的都是 no current target', JSON.stringify({ self: xH.self, sw: xH.sw, after: xH.after }));
  ok(xH.r.ok && xH.n === 'die,live' && up7r(xH.r.name) && xH.lines === 1, '关到一半（no current target：服务器还在、会话没了）也算一开就退：重开一次，回的是活着的那个窗口；日志一行', JSON.stringify({ r: xH.r, n: xH.n, lines: xH.lines }));
  try { fs.unlinkSync(FLK); } catch {}

  console.log('\n[7f] 顶栏的订阅额度：/api/state 的 limits（Codex 从假主目录的 rollout 读，Claude 从取数文件读）');
  st = await get('/api/state'); const lm = st.limits || {};
  const cw = lm.codex && lm.codex.windows && lm.codex.windows[0];
  ok(!!lm.codex && lm.codex.provider === 'codex' && lm.codex.plan === 'prolite' && lm.codex.windows.length === 1 && cw.key === 'week' && cw.used === 34 && cw.resetsAt > Date.now(), 'Codex：周额度 34%，套餐 prolite，截止时间在将来', JSON.stringify(lm.codex));
  ok(Array.isArray(lm.claude) && lm.claude.length === 2 && lm.claude.map((x) => x.account).join() === 'amy,ben', 'Claude：两个号各一条，按账号排', JSON.stringify(lm.claude));
  const wk = (x) => ((x && x.windows) || []).find((w) => w.key === 'week');
  ok(lm.claude && wk(lm.claude[0]) && wk(lm.claude[0]).used === 91 && wk(lm.claude[1]) && wk(lm.claude[1]).used === 1, 'Claude：amy 周 91%，ben 周 1%', JSON.stringify((lm.claude || []).map(wk)));
  ok(!('session' in (lm.claude[0] || {})) && Object.keys(lm.claude[0] || {}).sort().join() === 'account,at,id,name,plan,provider,windows', 'Claude 条目的字段是固定的：只有账号、名字、时间、窗口，没有会话号和路径', JSON.stringify(Object.keys(lm.claude[0] || {})));
  ok(lm.claude[0] && lm.claude[0].name === 'amy', '没在 config 登记的号：名字就是 id', JSON.stringify(lm.claude[0]));
  limTap('cccc3333-0003', 'good', 3, 40, 3.5);                                    // 选账号开的窗口（config 里 good = 旧号）说了一句话
  let good = null; for (let i = 0; i < 20 && !good; i++) { await sleep(300); good = ((await get('/api/state')).limits.claude || []).find((x) => x.account === 'good'); }
  ok(good && good.name === '旧号', '登记过的号：顶栏的名字取 config 的 name，和新任务的账号下拉一样（旧号）', JSON.stringify(good));
  fs.rmSync(path.join(DATA0, 'limits', 'claude-cccc3333-0003.json'));             // 还原：后面的断言和界面测试要的是两个号
  for (let i = 0; i < 20 && ((await get('/api/state')).limits.claude || []).length !== 2; i++) await sleep(300);
  const wrote = Date.now(); limTap('bbbb2222-0002', 'ben', 7, 55, 1.9);          // 会话又说了一句话：取数文件更新了
  let ben = null; for (let i = 0; i < 20 && !(ben && wk(ben).used === 55); i++) { await sleep(300); ben = ((await get('/api/state')).limits.claude || []).find((x) => x.account === 'ben'); }
  ok(ben && wk(ben).used === 55, '取数文件更新后，下一轮读到新的（ben 55%，' + (Date.now() - wrote) + ' ms 内）', JSON.stringify(ben));
  limTap('bbbb2222-0002', 'ben', 6, 1, 1.9);                                       // 还原：界面测试要的是 1%

  console.log('\n[7d] config 里 codex 打开：总控台起过的 Codex 会话照常上墙，「交给谁」里有 Codex');
  st = await get('/api/state');
  ok(st.sessions.some((x) => x.provider === 'codex' && x.tmux === CDX && x.prompt === 'Codex 夹具任务'), 'Codex 会话在墙上', JSON.stringify(st.sessions.filter((x) => x.provider === 'codex').map((x) => x.tmux)));
  ok(st.sessions.some((x) => x.tmux === CDX && x.model === 'gpt-6.1-sol' && x.effort === 'high'), 'Codex 会话带着开窗口时定的模型和强度', JSON.stringify(st.sessions.filter((x) => x.tmux === CDX).map((x) => [x.model, x.effort])));
  ok(!!(st.providers && st.providers.codex), '「交给谁」里有 Codex', JSON.stringify(Object.keys(st.providers || {})));
  // 模型名故意写坏：过了 Codex 开关那一关，在起进程之前被拦下。不能真起：服务用登录 shell 找 codex，开发机上找得到真的
  n1 = await post('/api/new', { prompt: '用 Codex 做', cwd: '~', provider: 'codex', model: 'bad model!' });
  ok(!n1.body.ok && /写法不对/.test(n1.body.error || ''), '选 Codex：过了开关，走到核对模型名那一步', JSON.stringify(n1.body));

  console.log('\n[7e] 输入框上的预判：读空闲会话的屏幕，灰字和「下一步 1/2/3」挂在 /api/state 的 suggest 上');
  // 假终端：把文件里的内容原样画到窗格里，文件一改就重画；它自己就是会话的进程（窗格里的进程号 = 登记的 pid）
  const SG = 'ccb-sug001', SGF = path.join(ROOT, 'sug-screen.txt');
  fs.writeFileSync(path.join(BIN, 'screen.mjs'), `import fs from 'node:fs';
const f = process.argv[2]; let last = null; fs.writeFileSync(f + '.pid', String(process.pid));
// 自动续跑（[7e-2]）往窗格里打字：收到的每一行记进 <f>.in，并像 Claude Code 一样写进这个会话的对话记录（argv[3] 是记录所在文件夹）
const rec = process.argv[3] && (process.argv[3] + '/' + (process.argv[4] || 'sug00000') + '-0000-4000-8000-' + String(process.pid).padStart(12, '0') + '.jsonl');   // argv[4]：会话号开头 8 位（[7s-2] 要真 UUID 那样只有十六进制，keepWarm.sids 只认这种）
// 写回记录晚 1.5 秒（真 Claude Code 也要一会儿才落盘）：服务至少会在「已经发出去、记录里还是上一句」的状态下看一轮
process.stdin.on('data', (b) => { const t = String(b); fs.appendFileSync(f + '.in', t); const at = new Date().toISOString();
  setTimeout(() => { for (const line of t.split(/\\r?\\n/)) if (line.trim() && rec) fs.appendFileSync(rec, JSON.stringify({ type: 'user', message: { role: 'user', content: line.trim() }, origin: { kind: 'human' }, timestamp: at }) + '\\n'); }, 1500); });
const draw = () => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch {} if (t !== last) { last = t; process.stdout.write('\\x1b[2J\\x1b[H' + t); } };
draw(); setInterval(draw, 200); setTimeout(() => process.exit(0), 600000);   // 兜底：[7e-2] 末尾自己停它（11/17 [7e-2] 加长后超过了原来的 90 秒，会话中途没了）
`);
  const BD = '\x1b[38;5;245m' + '─'.repeat(140), SUGGESTED = '把这个改动提交，然后跑一遍全部测试', SGL = ['提交并跑测试', '看一下改动', '先放着'];
  const bandRows = ['\x1b[38;5;241m下一步：\x1b[39m', ...SGL.map((l, i) => `  \x1b[38;5;69m${i + 1}\x1b[39m: ${l}`), '  \x1b[38;5;69m0\x1b[39m: 关闭'];
  const sgScreen = (chips, composer) => ['⏺ 这是一段做完了的交付。', '', ...chips, '', BD, composer, BD, '  ⏵⏵ bypass permissions on', ''].join('\n');
  const GH = (t) => '\x1b[39m❯\xa0\x1b[2m' + t + '\x1b[0m';
  fs.writeFileSync(SGF, sgScreen(bandRows, GH(SUGGESTED)));
  // 开在它自己那台 tmux 上（和 P0-0 之后新开的窗口一样）：自动续跑发之前重读屏幕走的是服务里的旧写法 tmux([... '-t', 名字])，这样才守得住它按名字找对套接字
  spawnSync(TMUX_BIN, [...TMW(SG), 'new-session', '-d', '-s', SG, '-x', '160', '-y', '48', NODE, path.join(BIN, 'screen.mjs'), SGF, PROJ], { env, stdio: 'ignore' });
  let sgPid = 0; for (let i = 0; i < 40 && !sgPid; i++) { await sleep(150); try { sgPid = Number(fs.readFileSync(SGF + '.pid', 'utf8')); } catch {} }
  const sgSid = 'sug00000-0000-4000-8000-' + String(sgPid).padStart(12, '0');
  fs.writeFileSync(path.join(PROJ, sgSid + '.jsonl'), [R.human('给个建议'), R.final('这是一段做完了的交付。')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const sgReg = (status) => fs.writeFileSync(path.join(SESS, sgPid + '.json'), JSON.stringify({ pid: sgPid, sessionId: sgSid, cwd: CWD, startedAt: Date.now() - 3600000, kind: 'interactive', entrypoint: 'cli',
    name: 'w-sug', nameSource: 'derived', status, statusUpdatedAt: Date.now() - 60000, updatedAt: Date.now() - 60000 }));
  sgReg('idle');
  const sgNow = async () => (await get('/api/state')).sessions.find((x) => x.sid === sgSid);
  let sg = await until(async () => { const x = await sgNow(); return x && x.suggest ? x : null; });
  ok(sg && sg.channel === 'tmux' && sg.tmux === SG, '假终端里的会话对上了 tmux 窗格', JSON.stringify(sg && [sg.channel, sg.tmux]));
  ok(sg && sg.suggest && sg.suggest.ghost === SUGGESTED, 'suggest.ghost：输入行 ❯ 后面暗色字 = 灰字建议', JSON.stringify(sg && sg.suggest));
  ok(sg && sg.suggest && JSON.stringify(sg.suggest.options) === JSON.stringify(SGL.map((label, i) => ({ n: i + 1, label }))), 'suggest.options：输入框上方的 1 / 2 / 3 三条标签', JSON.stringify(sg && sg.suggest));
  st = await get('/api/state');
  ok(st.sessions.filter((x) => x.suggest).length === 1, '只有这一个会话有预判（别的会话不是 tmux 空闲会话，或屏幕上没有）', JSON.stringify(st.sessions.filter((x) => x.suggest).map((x) => x.title)));
  fs.writeFileSync(SGF, sgScreen(bandRows, '\x1b[39m❯\xa0正在自己打字'));
  sg = await until(async () => { const x = await sgNow(); return x && x.suggest && x.suggest.ghost === '' ? x : null; });
  ok(sg && sg.suggest.options.length === 3, '他在输入框里打字：灰字没了，1 / 2 / 3 还在', JSON.stringify(sg && sg.suggest));
  fs.writeFileSync(SGF, sgScreen([], GH('')));
  sg = await until(async () => { const x = await sgNow(); return x && !x.suggest ? x : null; });
  ok(sg && !sg.suggest, '屏幕上什么预判都没有了：suggest 字段跟着没有（不留旧的）');
  fs.writeFileSync(SGF, sgScreen(bandRows, GH(SUGGESTED)));
  await until(async () => { const x = await sgNow(); return x && x.suggest; });
  sgReg('busy');
  sg = await until(async () => { const x = await sgNow(); return x && x.status === 'busy' && !x.suggest ? x : null; });
  ok(sg && sg.status === 'busy' && !sg.suggest, '会话转成忙：屏幕上的预判再没画完也不给界面（只给空闲的）', JSON.stringify(sg && [sg.status, sg.suggest]));
  sgReg('shell'); await sleep(200);
  sg = await until(async () => { const x = await sgNow(); return x && x.status === 'shell' && x.suggest ? x : null; });
  ok(sg && sg.suggest && sg.suggest.ghost === SUGGESTED, '放到后台的命令还在跑（shell）：终端里照样能回话、照样显示建议，所以也给', JSON.stringify(sg && [sg.status, sg.suggest]));
  sgReg('idle');

  console.log('\n[7e-2] 自动续跑：灰字建议过两道闸、倒数完由服务打进终端一句固定的话；取消、发满几轮、额度、跳过的窗口、待审阅、替他下结论的都不发，删掉 config 的键 10 秒内停（纯函数的断言在 autopilot.test.mjs）');
  const AMARK = '【总控台自动续跑】', inF = SGF + '.in', SGJ = path.join(PROJ, sgSid + '.jsonl');
  // 发出去的固定那句（11/17 修法 f）。照抄一遍，不 import autopilot.mjs：检查和被检查的不用同一份
  const ATEXT = '【总控台自动续跑】（不是 Khalil 本人）接着做你上一轮自己提的下一步；要他本人听、看、点头、登录、付款、发布的事不做，停下写状态行';
  const typed = () => { try { return fs.readFileSync(inF, 'utf8'); } catch { return ''; } };
  const sends = () => typed().split(AMARK).length - 1;                                   // 打进终端几次
  const lastSent = () => (typed().trim().split(/\r?\n/).filter((l) => l.includes(AMARK)).pop() || '');
  const ajs = () => { try { return fs.readFileSync(AJLOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const force = (v) => { if (v) fs.writeFileSync(AJLOG + '.force', v); else fs.rmSync(AJLOG + '.force', { force: true }); };
  const nowRec = (r) => ({ ...r, timestamp: new Date().toISOString() });
  const deliver = (...recs) => fs.appendFileSync(SGJ, recs.map((r) => JSON.stringify(nowRec(r))).join('\n') + '\n');
  const F = (t) => R.final(t + '\n\n【进展】交给负责的窗口了');                            // 无需处理的交付：只有这种能自动续跑（11/17 修法 a）
  const ghostIs = (g) => fs.writeFileSync(SGF, sgScreen(bandRows, GH(g)));
  const sgTap = (week, at) => fs.writeFileSync(path.join(DATA0, 'limits', `claude-${sgSid}.json`), JSON.stringify({ v: 1, at, session: sgSid, account: null, rate_limits: { five_hour: { used_percentage: 10, resets_at: LIM_SEC(LIM_NOW + 3600000) }, seven_day: { used_percentage: week, resets_at: LIM_SEC(LIM_NOW + 1.9 * 86400000) } } }));   // 和 ben 同一个周截止时间 = 同一个号
  const autoLines = () => log().split('\n').filter((x) => x.startsWith('auto ') && x.includes(' ' + sgSid.slice(0, 8) + ' '));
  const CFG = path.join(DATA0, 'config.json'), cfgOn = fs.readFileSync(CFG, 'utf8');
  ok(/^config .*autoContinue=on\(周<90% 5h<85% 连续≤2\)$/m.test(log()), '启动行照旧写 autoContinue 是开是关（这里 on，连续 ≤ 2 轮来自 config）', (log().match(/^config .*$/m) || [''])[0].slice(-80));
  // 0) 还没有取数文件：不知道它挂在哪个号上 → 不问、不发，卡片上写原因
  deliver(F('先交一段无需处理的。'));
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' ? x : null; });
  ok(sg && sg.auto.why === '读不到这个窗口的额度' && ajs().length === 0 && !typed(), '读不到这个窗口的额度：不问小模型、不发，卡片上写原因（保护性的判断落到停）', JSON.stringify(sg && sg.auto));
  // 1) 有额度、建议带 A-GO：问一次 → 倒数 → 打进终端。他上一句话的时间戳比服务的钟快一小时（对话记录的钟和服务的钟不一定对得上）：
  //    「已发几轮」不能拿时钟比来判断他是不是又说话了，不然每次刚发出去、记录还没写回的那一拍就被清零（11/16 跑出过：第 3 步多发了一轮）
  fs.appendFileSync(SGJ, JSON.stringify({ ...R.human('他上一句话（时钟快一小时）'), timestamp: new Date(Date.now() + 3600000).toISOString() }) + '\n' + JSON.stringify(nowRec(F('这是一段做完了的交付。'))) + '\n');
  sgTap(30, LIM_NOW - 3600000); ghostIs('A-GO 接着把测试补齐');
  const armed = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'armed' ? x : null; });
  ok(armed && armed.auto.text === ATEXT && armed.auto.basis === 'A-GO 接着把测试补齐' && armed.auto.fireIn > 0 && armed.auto.fireIn <= 3000, '小模型说 go：卡片上倒数（auto.state armed、text 是真要发的那句固定的话、basis 是依据的灰字、fireIn ≤ 3 秒）', JSON.stringify(armed && armed.auto));
  await until(async () => sends() >= 1);
  const ty1 = typed();
  ok(sends() === 1 && lastSent().trim() === ATEXT && !ty1.includes('接着把测试补齐'), '倒数完由服务打进终端的是固定的那句（带「总控台自动续跑」开头、写明不是他本人），灰字一个字都不进终端（11/17 修法 f）', JSON.stringify(ty1));
  const j1 = ajs();
  ok(j1.length === 1 && j1[0].argv[j1[0].argv.indexOf('--model') + 1] === 'haiku' && j1[0].argv[j1[0].argv.indexOf('--setting-sources') + 1] === '' && /<next>A-GO 接着把测试补齐<\/next>$/.test(j1[0].input) && /<delivery>\n这是一段做完了的交付。/.test(j1[0].input), '只问了一次：claude -p + haiku、不读设置文件，原文里有交付和 <next>（灰字只给小模型当判断材料）', JSON.stringify(j1.map((x) => x.input.slice(-60))));
  sg = await until(async () => { const x = await sgNow(); return x && x.prompt && x.prompt.startsWith(AMARK) ? x : null; });
  ok(sg && sg.prompt === ATEXT, '对话记录里多了这句：卡片的 prompt 就是那句固定的话（界面据记号写「自动续跑」）', JSON.stringify(sg && sg.prompt));
  const on1 = (await get('/api/state')).org.nodes[sgSid] || {};
  ok(on1.for !== 'you', '自动发的这一轮不算他本人开的头（架构视图的 for 不是「你派的」；也不计进他说了几轮）', JSON.stringify(on1.for));
  const al1 = await until(async () => { const l = autoLines(); return l.some((x) => / fire /.test(x)) ? l : null; }) || autoLines();   // fire 那一行在送达确认之后才写
  ok(al1.some((x) => / go 顺理成章$/.test(x)) && al1.some((x) => / arm \d+s A-GO 接着把测试补齐$/.test(x)) && al1.filter((x) => / fire A-GO 接着把测试补齐$/.test(x)).length === 1, '日志：auto <时间> <会话> go / arm / fire 各一行（fire 后面记的是依据的灰字）', al1.join(' | '));
  // 2) 第二次交付，又一句 A-GO：照样发（连着第 2 轮）
  deliver(F('第二段交付。')); ghostIs('A-GO 第二步');
  await until(async () => sends() >= 2);
  await until(async () => autoLines().some((x) => / fire A-GO 第二步$/.test(x)));
  ok(sends() === 2 && lastSent().trim() === ATEXT, '下一次交付的下一句建议：照样接着发（他没说话，第 2 轮）', JSON.stringify(typed().slice(-120)));
  // 3) 第三次：config 里 maxRun 是 2 → 不发，写原因，也不问小模型
  const nAsk3 = ajs().length; deliver(F('第三段交付。')); ghostIs('A-GO 第三步');
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' && /轮/.test(x.auto.why) ? x : null; });
  await sleep(2500);
  ok(sg && sg.auto.why === '已经自动接着做了 2 轮，等你说一句' && sends() === 2 && ajs().length === nAsk3, '他没说话、已经自动发了 2 轮（config 的 maxRun）：不发、不问，卡片上写「等你说一句」（他上一句话的时钟快一小时也不会被误当成他又说了话）', JSON.stringify([sg && sg.auto, sends(), nAsk3, ajs().map((x) => (x.input.match(/<next>(.*)<\/next>/) || [])[1])]));
  // 4) 他自己说了一句 → 重新数；这次在倒数里点「不发了」
  deliver(R.human('我自己说一句'), F('第四段交付。')); ghostIs('A-GO 第四步');
  const armed4 = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'armed' && x.auto.basis === 'A-GO 第四步' ? x : null; });
  ok(!!armed4, '他自己说了一句：重新开始数，又能自动续跑（在倒数）');
  const c4 = await post('/api/auto', { sid: sgSid, op: 'cancel' });
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' ? x : null; });
  await sleep(3500);
  ok(c4.body.ok && sg && sg.auto.why === '你取消了这一次的自动续跑' && sends() === 2 && autoLines().some((x) => / cancel 你取消了$/.test(x)), '点「不发了」：这一次交付不再自动发，卡片上写「你取消了」，日志记 cancel', JSON.stringify([c4.body, sg && sg.auto, sends()]));
  // 5) 小模型说 wait → 不发，写它的理由
  deliver(F('第五段交付。')); ghostIs('A-WAIT 再看看');
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' && x.auto.why === '在等别人' ? x : null; });
  ok(!!sg && sends() === 2, '小模型说 wait：不发，卡片上写它的理由', JSON.stringify(sg && sg.auto));
  // 6) 小模型说 yours → 卡片改成待跟进
  deliver(F('第六段交付。')); ghostIs('A-YOURS 换个样式');
  sg = await until(async () => { const x = await sgNow(); return x && x.digest && x.digest.need === 'reply' && x.digest.judged ? x : null; });
  ok(sg && sg.digest.ask === 'A 要你定：用哪个' && !sg.auto && sends() === 2, '小模型说 yours：不发，这一次交付改成待跟进、那件事放进「要你做的事」', JSON.stringify(sg && [sg.digest, sg.auto]));
  // 7) 第一道闸：删除 → 不问小模型，直接待跟进
  const nAsk7 = ajs().length; deliver(F('第七段交付。')); ghostIs('把旧的模拟器删掉');
  sg = await until(async () => { const x = await sgNow(); return x && x.digest && x.digest.need === 'reply' && /^删除东西：/.test(x.digest.ask || '') ? x : null; });
  ok(!!sg && ajs().length === nAsk7 && sends() === 2, '建议里要删东西：第一道闸直接拦下改成待跟进，不问小模型、不发', JSON.stringify(sg && sg.digest));
  // 8) 第一道闸：! 开头 → 不问、不发、不改卡片，写原因
  deliver(F('第八段交付。')); ghostIs('!rm -rf /tmp/x');
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' && x.auto.why === '建议是一条终端命令' ? x : null; });
  ok(!!sg && sg.digest.need !== 'reply' && ajs().length === nAsk7 && sends() === 2, '建议以 ! 开头（终端命令）：不问、不发，卡片照旧，写原因', JSON.stringify(sg && [sg.auto, sg.digest.need]));
  // 9) 同号别的窗口刚报周 95% → 不发
  sgTap(95, Date.now()); deliver(F('第九段交付。')); ghostIs('A-GO 第九步');
  sg = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'held' && /周额度/.test(x.auto.why) ? x : null; });
  await sleep(2000);
  ok(sg && sg.auto.why === '这个号周额度用了 95%' && sends() === 2 && ajs().length === nAsk7, '这个号周额度到线：不问、不发，卡片上写用了多少', JSON.stringify(sg && sg.auto));
  sgTap(30, LIM_NOW - 3600000); limTap('bbbb2222-0002', 'ben', 6, 1, 1.9);    // 还原：ben 的读数要回到 1%
  // 10) 名字里带「值班」的窗口：一律跳过，卡片上什么都不写
  const sgRegAs = (name) => fs.writeFileSync(path.join(SESS, sgPid + '.json'), JSON.stringify({ pid: sgPid, sessionId: sgSid, cwd: CWD, startedAt: Date.now() - 3600000, kind: 'interactive', entrypoint: 'cli', name, nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now() - 60000, updatedAt: Date.now() - 60000 }));
  sgRegAs('作者 值班窗口'); deliver(F('第十段交付。')); ghostIs('A-GO 第十步');
  sg = await until(async () => { const x = await sgNow(); return x && x.title === '作者 值班窗口' && x.suggest && x.suggest.ghost === 'A-GO 第十步' ? x : null; });
  await sleep(2500);
  ok(sg && !sg.auto && sends() === 2 && ajs().length === nAsk7, '值班 / 总管这类窗口（标题带「值班」）：不问、不发、卡片上不写（11/16 总管要求）', JSON.stringify(sg && [sg.title, sg.auto]));
  sgRegAs('w-sug');
  // 11) 「现在发」：不等倒数
  deliver(F('第十一段交付。')); ghostIs('A-GO 立刻发');
  await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'armed' && x.auto.basis === 'A-GO 立刻发'; });
  const n11 = await post('/api/auto', { sid: sgSid, op: 'now' });
  await until(async () => sends() >= 3, 2500);
  const s11 = sends();
  await until(async () => autoLines().some((x) => / fire 手点 /.test(x)));
  ok(n11.body.ok && s11 === 3 && lastSent().trim() === ATEXT && autoLines().some((x) => / fire 手点 A-GO 立刻发$/.test(x)), '点「现在发」：不等 3 秒倒数、马上打进终端（发的照样是固定那句），日志记「手点」', JSON.stringify([n11.body, s11]));
  const badOp = await post('/api/auto', { sid: sgSid, op: 'boom' }), goneS = await post('/api/auto', { sid: 'nope-0000-0000', op: 'cancel' });
  ok(badOp.code === 400 && goneS.body.ok === false, '/api/auto：op 写错 400，会话不在回 ok:false', JSON.stringify([badOp, goneS.body]));
  ok(st.sessions.every((x) => x.sid === sgSid || !x.auto || x.auto.state === 'held'), '别的会话（没有 tmux 灰字的）不会被倒数', JSON.stringify(st.sessions.filter((x) => x.auto && x.auto.state !== 'held').map((x) => x.title)));
  // 12) 照 11/16 夜里那条改写（文字是编的）：交付最后一行是【待审阅】（交给他听的试听），灰字替他宣布已经听过。
  //     那晚小模型说了 go（把灰字当成了他的结论），这里让假判断命令也说 go：线上那版代码会发，修好的不问、不发
  const G9F = '我听完了，三套里第二套最好，就用它。顺手把音量调平，然后接进 App';
  force('go'); const nAsk12 = ajs().length, nS12 = sends();
  deliver(R.human('（夹具）他说了一句，重新数'), R.final('三套音色都换好了。\n\n顺便考你一下：为什么房间的回声会让声音听起来更厚？\n\n【待审阅】改前 / 改后的试听放在 `~/Projects/app-sandbox/presets/listen/`，听完告诉我留哪几套'));
  ghostIs(G9F);
  sg = await until(async () => { const x = await sgNow(); return x && x.digest && x.digest.need === 'review' && x.suggest && x.suggest.ghost === G9F ? x : null; });
  await until(async () => sends() > nS12, 8000);                                  // 线上那版：稳住 0.3 秒 + 问一次 + 倒数 3 秒就发了；等足 8 秒
  sg = await sgNow();
  ok(sg && sends() === nS12 && ajs().length === nAsk12 && !(sg.auto && sg.auto.state === 'armed') && !autoLines().some((x) => / arm \d+s 我听完了/.test(x)), '9f（【待审阅】+「我听完了……」）：待审阅的交付不问小模型、不倒数、不发（11/17 修法 a）', JSON.stringify([sg && sg.digest && sg.digest.need, sg && sg.auto, sends() - nS12, ajs().length - nAsk12, typed().slice(-160)]));
  if (sends() > nS12) await until(async () => autoLines().some((x) => / fire 我听完了/.test(x)), 12000);   // 只在第 12 步真发了时（线上那版、改坏版）：等那句写回记录，不然下一段交付会排在它前面，这一轮看着没收尾
  // 13) 待审阅 + 不替他下结论的灰字（小模型也说 go）：照样不发 —— 只靠「待审阅不发」这一道（去掉它的改坏版在这里变红）
  const nS13 = sends(), nAsk13 = ajs().length;                                     // 每一步自己的起点：前一步在旧代码上发出去了，不能拿它的数比
  deliver(R.final('又一段交付。\n\n【待审阅】结果在 ~/x/ 里，你看一下'));  ghostIs('A-GO 待审阅也接着做');
  sg = await until(async () => { const x = await sgNow(); return x && x.digest && x.digest.need === 'review' && x.suggest && x.suggest.ghost === 'A-GO 待审阅也接着做' ? x : null; });
  await until(async () => sends() > nS13, 8000);
  ok(sends() === nS13 && ajs().length === nAsk13, '待审阅的交付、灰字也没替他下结论：照样不问、不发', JSON.stringify([sends() - nS13, ajs().length - nAsk13, typed().slice(-120)]));
  // 14) 无需处理 + 灰字替他下结论（小模型会说 go）：第一道闸拦下，不问、不发 —— 只靠「替他下结论」这一道。
  //     重开前 ①（11/17 总管批）：卡片不动，仍是无需处理，那一行写原因；以前改成待跟进（「不凭一句猜测改他看到的状态」）
  const nS14 = sends(), nAsk14 = ajs().length, W14 = '建议替你下了结论（听完了 / 可以…）';
  deliver(F('第十四段交付。')); ghostIs('我听完了，都挺好，直接接进 App');
  await until(async () => { const x = await sgNow(); return x && x.suggest && x.suggest.ghost === '我听完了，都挺好，直接接进 App' && x.auto && x.auto.state === 'held' && x.auto.why === W14 ? x : null; });
  await sleep(1500); sg = await sgNow();
  ok(!!sg && sg.digest && sg.digest.need === 'fyi' && !sg.digest.judged && !sg.digest.ask && sg.auto && sg.auto.state === 'held' && sg.auto.why === W14 && sends() === nS14 && ajs().length === nAsk14 && autoLines().some((x) => x.endsWith(' wait hard ' + W14)), '无需处理、灰字替他说「我听完了」：第一道闸拦下，不问、不发；卡片仍是无需处理、那一行写原因，日志记 wait hard（重开前 ①）', JSON.stringify([sg && sg.digest && [sg.digest.need, sg.digest.ask, sg.digest.judged], sg && sg.auto, sends() - nS14, ajs().length - nAsk14, autoLines().slice(-2)]));
  // 15) 照 11/16 夜里另一条改写（文字是编的）：交付最后一行是【进展】，灰字编了一个不存在的帖子链接。两道字面的闸都不拦，小模型那晚说了 go：
  //     照样发，但打进终端的是固定的那句，没有「链接回头我发你」
  const GB8 = '链接回头我发你，你先帮我把三张表合成一张，明早再对一遍';
  const nS15 = sends();
  deliver(R.human('（夹具）他又说了一句，重新数'), R.final('好的，记下了：预告已经发了。\n\n眼下没有要做的。想看数字的时候把链接给我，我隔天读一次访问量。\n\n【进展】预告已发，已记；暂无待办'));
  ghostIs(GB8);
  await until(async () => sends() > nS15, 12000);
  const sent15 = lastSent().trim();
  ok(sends() === nS15 + 1 && sent15 === ATEXT && !typed().includes('链接'), 'b8（【进展】+「链接回头我发你……」）：发出去的是固定的那句，终端里没有「链接回头我发你」（11/17 修法 f）', JSON.stringify([sends() - nS15, sent15]));
  force('');
  await until(async () => autoLines().some((x) => / fire 链接回头我发你/.test(x)));
  // 16) 不用重启就能关（11/17 修法 c）：在倒数时把 config.json 里的 autoContinue 删掉 → 倒数撤掉、不发，日志记一行；加回去又能倒数
  deliver(F('第十六段交付。')); ghostIs('A-GO 倒数中关掉');
  const armed16 = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'armed' && x.auto.basis === 'A-GO 倒数中关掉' ? x : null; });
  const nS16 = sends(), cfgOff = JSON.parse(cfgOn); delete cfgOff.autoContinue; fs.writeFileSync(CFG, JSON.stringify(cfgOff));
  const off16 = await until(async () => { const x = await sgNow(); return x && !x.auto ? x : null; }, 6000);
  await sleep(4000);
  ok(!!armed16 && !!off16 && sends() === nS16 && /^config \S+ autoContinue on\(周<90% 5h<85% 连续≤2\) → off（config.json 里没有 autoContinue）$/m.test(log()) && autoLines().some((x) => / disarm 自动续跑关了$/.test(x)),
    '倒数时删掉 config.json 里的 autoContinue：不重启，几秒内倒数撤掉、不发，日志记一行 on → off 和一行 disarm', JSON.stringify([!!armed16, off16 && off16.auto, sends() - nS16, (log().match(/^config \S+ autoContinue .*$/gm) || []).join(' | ')]));
  fs.writeFileSync(CFG, cfgOn);
  const back16 = await until(async () => { const x = await sgNow(); return x && x.auto && x.auto.state === 'armed' ? x : null; }, 8000);
  ok(!!back16 && /^config \S+ autoContinue off → on\(周<90% 5h<85% 连续≤2\)$/m.test(log()), '加回去：日志记一行 off → on，同一次交付又开始倒数', JSON.stringify([back16 && back16.auto, (log().match(/^config \S+ autoContinue .*$/gm) || []).join(' | ')]));
  await post('/api/auto', { sid: sgSid, op: 'cancel' });
  if (sgPid > 1) try { process.kill(sgPid, 'SIGTERM'); } catch {}                // 停掉自己起的假终端（进程号是它自己写的；是 0 时 kill 会打到整个进程组，所以先判断）（以前靠它 90 秒后自己退出；后面几段不需要它）

  console.log('\n[7s-2] 总管保温真打字（11/21 1b 审查 M1–M3）：只读服务、没设 CCBOARD_KW_SANDBOX 的试验服务只记 dry 不打；copy-mode、分屏不打；打完那一轮收尾前不再打、收尾后按「刚用过缓存」不打；config 写 {"on": false}、拼错的键都是关');
  {
    // 假终端（[7e] 的 screen.mjs）：空输入框；收到的每一行记进 <文件>.in，并像 Claude Code 一样写回对话记录。上一轮 30 分钟前交付了【待跟进】（不会被收、不会自动续跑）
    const KS = 'ccb-kw001', KSF = path.join(ROOT, 'kw-screen.txt'), kin = KSF + '.in';
    const KTEXT = '【总控台保温】（不是 Khalil 本人，也不是别的窗口）只为续上缓存';   // 照抄开头一段，不 import autopilot.mjs：检查和被检查的不用同一份
    fs.writeFileSync(KSF, sgScreen([], GH('')));
    spawnSync(TMUX_BIN, [...TMW(KS), 'new-session', '-d', '-s', KS, '-x', '160', '-y', '48', NODE, path.join(BIN, 'screen.mjs'), KSF, PROJ, 'cafe0000'], { env, stdio: 'ignore' });
    let kPid = 0; for (let i = 0; i < 40 && !kPid; i++) { await sleep(150); try { kPid = Number(fs.readFileSync(KSF + '.pid', 'utf8')); } catch {} }
    const kSid = 'cafe0000-0000-4000-8000-' + String(kPid).padStart(12, '0'), KJ = path.join(PROJ, kSid + '.jsonl');   // 只有十六进制：config 的 keepWarm.sids 只认真 UUID 那样的会话号
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
    fs.writeFileSync(KJ, [{ ...R.human('总管的上一轮'), timestamp: ago(31) }, { ...use(R.final('总管这一轮做完了。\n\n【待跟进】要你定一件事'), 3, 150000, 2000), timestamp: ago(30) }].map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(SESS, kPid + '.json'), JSON.stringify({ pid: kPid, sessionId: kSid, cwd: CWD, startedAt: Date.now() - 3600000, kind: 'interactive', entrypoint: 'cli',
      name: 'w-kw', nameSource: 'derived', status: 'idle', statusUpdatedAt: Date.now() - 60000, updatedAt: Date.now() - 60000 }));
    const kNow = async () => (await get('/api/state')).sessions.find((x) => x.sid === kSid);
    const ks = await until(async () => { const x = await kNow(); return x && x.channel === 'tmux' && x.status === 'idle' ? x : null; });
    ok(kPid > 1 && ks && ks.tmux === KS && ks.ctx === 152003 && ks.result === '总管这一轮做完了。', '[7s-2] 夹具：假终端里的会话上墙（tmux、空闲、上下文 152003、30 分钟前交付）', JSON.stringify(ks && [ks.tmux, ks.status, ks.ctx, ks.result]));
    const KCF = { sids: [kSid], chief: false, idleMin: 1, idleMax: 59, minCtx: 0, maxRun: 2 };
    const typedK = () => { try { return fs.readFileSync(kin, 'utf8'); } catch { return ''; } };
    const nTyped = () => typedK().split('【总控台保温】').length - 1;
    const kwOf = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('kw ') && l.includes(' ' + kSid.slice(0, 8) + ' ')); } catch { return []; } };
    const KTM = (...a) => spawnSync(TMUX_BIN, [...TMW(KS), ...a], { env, encoding: 'utf8' });

    // 1) 两份旁边的服务，各只差一道闸：ro = 只读（带着 CCBOARD_KW_SANDBOX=1），sb = 试验服务、没设 CCBOARD_KW_SANDBOX。都只该记 dry、一个字不打
    const side = (name, port, extra) => {
      const d = path.join(ROOT, 'kw-' + name + '-data'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ keepWarm: KCF }));
      const lg = path.join(ROOT, 'server-kw-' + name + '.out'), o = fs.openSync(lg, 'w');
      const p = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(port), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_REMOTE_PORT: String(port + 1), CCBOARD_DATA: d, ...extra }, stdio: ['ignore', o, o] });
      fs.closeSync(o); kids.push(p.pid); return { p, lg };
    };
    const ro = side('ro', PORT + 330, { CCBOARD_READONLY: '1' }), sb = side('sb', PORT + 340, { CCBOARD_KW_SANDBOX: '' });
    const dryRo = await until(async () => kwOf(ro.lg).find((l) => / dry n=1 ctx=152003 只读$/.test(l)), 20000);
    const drySb = await until(async () => kwOf(sb.lg).find((l) => / dry n=1 ctx=152003 试验服务$/.test(l)), 20000);
    await sleep(1500);                                   // 万一哪一份真打了：screen.mjs 写回记录要 1.5 秒，打出去的字立刻进 .in
    const sideOut = [...kwOf(ro.lg), ...kwOf(sb.lg)];
    for (const x of [ro, sb]) try { process.kill(x.p.pid, 'SIGTERM'); } catch {}
    ok(!!dryRo && !sideOut.some((l) => / fire /.test(l)) && nTyped() === 0, '[7s-2] 只读服务（CCBOARD_READONLY=1）：条件都满足也只记一行 dry … 只读，不往窗口里打字', JSON.stringify({ dryRo, typed: typedK(), lines: kwOf(ro.lg) }));
    ok(!!drySb && nTyped() === 0, '[7s-2] 试验服务（换了端口和数据目录）没设 CCBOARD_KW_SANDBOX：只记 dry … 试验服务，不打（1b 审查 M3：不然会和线上服务一起往真总管里打）', JSON.stringify({ drySb, typed: typedK(), lines: kwOf(sb.lg) }));

    // 2) 这份服务（设了 CCBOARD_KW_SANDBOX=1、私有套接字）：先让窗格进 copy-mode（他往上翻着看），再开 keepWarm
    KTM('copy-mode', '-t', KS);
    const CFGK = path.join(DATA0, 'config.json'), cfgK0 = fs.readFileSync(CFGK, 'utf8'), withKw = (kw) => fs.writeFileSync(CFGK, JSON.stringify({ ...JSON.parse(cfgK0), keepWarm: kw }));
    withKw(KCF);
    const sMode = await until(async () => kwOf(logFile).find((l) => / skip pane-mode$/.test(l)), 15000);
    ok(!!sMode && nTyped() === 0 && /^config \S+ keepWarm → on\(空闲 1–59 分、上下文≥0、连续≤2、另 1 个\)$/m.test(log()), '[7s-2] 窗格在 copy-mode：不打，日志 skip pane-mode（粘贴进去了、Enter 会被吃掉，那句会留在他的输入框里；1b 审查 M1）', JSON.stringify({ sMode, typed: typedK(), lines: kwOf(logFile).slice(-3) }));
    // 3) 还在 copy-mode 时分一个窗格出去（-d：原来那个窗格还是当前的）：不打，skip split；关掉分出去的、退出 copy-mode 以后才打
    KTM('split-window', '-d', '-t', KS, '/bin/sleep', '120');
    const sSplit = await until(async () => kwOf(logFile).find((l) => / skip split$/.test(l)), 15000);
    ok(!!sSplit && nTyped() === 0, '[7s-2] 会话里有两个窗格：不打，日志 skip split（不去猜哪个是 claude）', JSON.stringify({ sSplit, typed: typedK(), panes: KTM('list-panes', '-s', '-t', KS, '-F', '#{pane_id} #{pane_in_mode}').stdout }));
    KTM('kill-pane', '-t', KTM('list-panes', '-s', '-t', KS, '-F', '#{pane_id}').stdout.trim().split('\n')[1] || '%none');
    KTM('send-keys', '-t', KS, '-X', 'cancel');
    const fired = await until(async () => kwOf(logFile).find((l) => / fire n=1 ctx=152003 delivered$/.test(l)), 20000);
    const tLines = typedK().split(/\r?\n/).filter((l) => l.includes('【总控台保温】'));
    ok(!!fired && nTyped() === 1 && tLines.length === 1 && tLines[0].startsWith(KTEXT), '[7s-2] 一个窗格、退出了 copy-mode、输入框空：打了一次，打进去的是固定那句（以【总控台保温】开头），日志 fire n=1 … delivered', JSON.stringify({ fired, typed: typedK().slice(0, 120), lines: kwOf(logFile).slice(-4) }));
    // 4) 写回的那条记录被认成保温：那一轮没收尾前 skip in-kw；它回了一个点（end_turn）以后是 skip fresh（刚用过缓存），卡片不变
    const inKw = await until(async () => kwOf(logFile).find((l) => / skip in-kw$/.test(l)), 15000);
    fs.appendFileSync(KJ, JSON.stringify({ ...use(R.final('·'), 2, 160000, 900), timestamp: new Date().toISOString() }) + '\n');
    const fresh = await until(async () => kwOf(logFile).find((l) => / skip fresh$/.test(l)), 15000);
    const kc = await kNow();
    ok(!!inKw && !!fresh && nTyped() === 1, '[7s-2] 保温那一轮没收尾：skip in-kw；它回了点（end_turn）以后换成 skip fresh、不再打（收尾那一下没清掉 in-kw 的话，之后一次都打不了）', JSON.stringify({ inKw, fresh, lines: kwOf(logFile).slice(-4) }));
    ok(kc && kc.prompt === '总管的上一轮' && kc.result === '总管这一轮做完了。' && kc.ctx === 160902 && kc.digest && kc.digest.need === 'reply', '[7s-2] 卡片：话和交付都还是上一轮的（【待跟进】还挂着），上下文取保温那一条回复的', JSON.stringify(kc && [kc.prompt, kc.result, kc.ctx, kc.digest && kc.digest.need]));
    // 5) config 写 {"on": false}、拼错的键：都是关，日志各一行（1b 审查 M2：原来这两种都会把保温打开）
    withKw({ ...KCF, on: false });
    const offLine = await until(async () => (log().match(/^config \S+ keepWarm → .*$/gm) || []).pop()?.match(/ keepWarm → off$/), 8000);
    ok(!!offLine, '[7s-2] config 写 "keepWarm": {"on": false, …}：日志 keepWarm → off', JSON.stringify((log().match(/^config \S+ keepWarm → .*$/gm) || []).slice(-2)));
    withKw({ ...KCF, idlemin: 5 });
    const oddLine = await until(async () => (log().match(/^config \S+ keepWarm → .*$/gm) || []).pop()?.match(/ keepWarm → off（读不了或写错：keepWarm 里有不认识的键：idlemin）$/), 8000);
    ok(!!oddLine && nTyped() === 1, '[7s-2] config 里拼错的键（idlemin）：按写错处理 → 关，日志写明是哪个键', JSON.stringify((log().match(/^config \S+ keepWarm → .*$/gm) || []).slice(-2)));
    fs.writeFileSync(CFGK, cfgK0);
    if (kPid > 1) try { process.kill(kPid, 'SIGTERM'); } catch {}   // 停掉自己起的假终端（进程号是它自己写的；是 0 时 kill 会打到整个进程组，所以先判断）
    KTM('kill-server');                                              // 它自己那台 tmux（TMUXDIR 下的 -S 套接字）
  }

  // ── 一个数据目录只许一份能写的服务；只读的服务不往数据目录写（datalock，11/16 那次事故）。放在 [8] 前面：这段要等十几秒，放在开头会把别的夹具推过「卡住了」的线 ──
  {
    const sj = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'server.json'), 'utf8')); } catch { return null; } })();
    const lgX = path.join(ROOT, 'server-dup.out'), oX = fs.openSync(lgX, 'w');
    const dup = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(PORT + 200) }, stdio: ['ignore', oX, oX] }); kids.push(dup.pid);
    const code = await new Promise((res) => { const t = setTimeout(() => res('still running'), 8000); dup.on('exit', (c) => { clearTimeout(t); res(c); }); });
    if (code === 'still running') { try { process.kill(dup.pid, 'SIGTERM'); } catch {} }
    const dl = fs.readFileSync(lgX, 'utf8');
    ok(sj && sj.pid === srv.pid && sj.port === PORT, 'datalock: 能写的服务起来后在数据目录记 server.json（进程号、端口）', JSON.stringify(sj));
    ok(code === 3 && /^datadir \S+ 数据目录 .* 正被端口 \d+ 的服务/m.test(dl) && !/^cc-board /m.test(dl), 'datalock: 同一个数据目录、另一个端口再起一份能写的服务：没开始监听就退出（码 3），日志一行说明', JSON.stringify({ code, dl: dl.slice(0, 300) }));
    const D2 = path.join(ROOT, 'ro-data'); fs.mkdirSync(D2, { recursive: true });
    const old = Date.now() - 5 * 60000;
    const pinsTxt = JSON.stringify({ 'ccb-ghost-ro': { key: 'other', name: 'x', at: old } }), spawnTxt = JSON.stringify({ 'ccb-ghost-ro': { by: 'x', at: old } });
    fs.writeFileSync(path.join(D2, 'pins.json'), pinsTxt); fs.writeFileSync(path.join(D2, 'spawn.json'), spawnTxt);
    const lgR = path.join(ROOT, 'server-ro.out'), oR = fs.openSync(lgR, 'w');
    const ro = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(PORT + 300), CCBOARD_DATA: D2, CCBOARD_READONLY: '1' }, stdio: ['ignore', oR, oR] }); kids.push(ro.pid);
    await sleep(5000);
    const roUp = /^cc-board /m.test(fs.readFileSync(lgR, 'utf8'));
    try { process.kill(ro.pid, 'SIGTERM'); } catch {}
    const rd = (f) => { try { return fs.readFileSync(path.join(D2, f), 'utf8'); } catch { return null; } };
    ok(roUp && rd('pins.json') === pinsTxt && rd('spawn.json') === spawnTxt && rd('server.json') === null, 'datalock: 只读的服务（CCBOARD_READONLY=1）不往数据目录写：tmux 里没有的窗格照样不从 pins / spawn 里删，也不记 server.json', JSON.stringify({ roUp, pins: rd('pins.json'), spawn: rd('spawn.json'), server: rd('server.json') }));
  }

  // ── 只回变过的（拉数据瘦身）：另起一份服务（T_PORT + 400），自己的假主目录里 60 个不动的会话（3 个在跑但没有新记录、57 个歇着）。
  //    主夹具里 run / compact / hint 每 0.8 秒加记录，凑不出「60 个都没变」，所以单独搭。放在 [8] 前面：和 datalock 一样要等十几秒 ──
  const V_CAP = 512;   // 60 个会话都没变时一次应答的上限（字节）：外壳 + 3 个在跑会话的 quiet。实际字节数和同一刻整份的字节数都打在断言名里
  console.log('\n[2v] 只回变过的：界面带版本号拉 /api/state，60 个会话都没变时应答 ≤ ' + V_CAP + ' 字节；改了一个只回那一个；不见了的给名单；两个页面各拿各的；重启后整份；不带版本号的老读法一个字段都不变');
  {
    const VPORT = PORT + 400, VH = path.join(ROOT, 'vhome'), VSESS = path.join(VH, '.claude/sessions'), VCWD = path.join(VH, 'work');
    const VPROJ = path.join(VH, '.claude/projects', VCWD.replace(/[^A-Za-z0-9]/g, '-')), VDATA = path.join(ROOT, 'vdata');
    for (const d of [VSESS, VCWD, VPROJ, VDATA]) fs.mkdirSync(d, { recursive: true });
    const V = [], vT0 = Date.now() - 600000;
    for (let i = 0; i < 60; i++) {
      const c = spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(c.pid);
      const x = { sid: 'v' + String(i).padStart(7, '0') + '-0000-4000-8000-' + String(c.pid).padStart(12, '0'), pid: c.pid, busy: i < 3 };
      x.file = path.join(VPROJ, x.sid + '.jsonl');
      fs.writeFileSync(x.file, [R.human('第 ' + i + ' 件事'), R.tool(), R.result(), ...(x.busy ? [] : [R.final('第 ' + i + ' 件做完了。')])].map((r) => JSON.stringify(r)).join('\n') + '\n');
      fs.writeFileSync(path.join(VSESS, x.pid + '.json'), JSON.stringify({ pid: x.pid, sessionId: x.sid, cwd: VCWD, startedAt: vT0 + i * 1000, kind: 'interactive', entrypoint: 'cli',
        name: 'v-' + i, nameSource: 'derived', status: x.busy ? 'busy' : 'idle', statusUpdatedAt: vT0, updatedAt: vT0 }));
      V.push(x);
    }
    // 自己的 tmux 套接字目录（不存在的服务器）：不和主夹具共用 <TMUXDIR>/tmux/，免得它的「启动中」跟着主夹具的窗口变
    // CCBOARD_STATE_GONE_MAX=2：不见了的名单只记 2 个，第 3 个不见了就忘掉最早那个（第 7b 步测「拿着比忘掉的还早的版本号来 → 整份」）
    const venv = { ...env, HOME: VH, CCBOARD_PORT: String(VPORT), CCBOARD_PREVIEW_PORT: String(VPORT + 1000), CCBOARD_DATA: VDATA, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, 'v', 'ccboard.sock'), CCBOARD_STALL_MS: '3600000', CCBOARD_STATE_GONE_MAX: '2' };
    let vsrv = null, VTOK = '';
    const vStart = async (extra = {}) => {      // 起来了回 true；端口先被别人占着、10 秒没起来回 false（调用的地方记一条红、跳过这一段，不让整份测试崩掉）
      for (const p of [VPORT, VPORT + 1000]) { try { await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(1500) }); return false; } catch {} }
      const o = fs.openSync(path.join(ROOT, 'server-v.out'), 'a'); vsrv = spawn(NODE, [SERVER], { env: { ...venv, ...extra }, stdio: ['ignore', o, o] }); kids.push(vsrv.pid);
      for (let i = 0; i < 50; i++) { await sleep(200); try { VTOK = fs.readFileSync(path.join(VDATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + VPORT + '/health')).json(); if (h.ok && h.pid === vsrv.pid) return true; } catch {} }
      return false;
    };
    const vStop = async () => { const p = vsrv && vsrv.pid; if (!(p > 1)) return; try { process.kill(p, 'SIGTERM'); } catch {} for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + VPORT + '/health'); } catch { break; } } };
    const vraw = async (p) => { const r = await fetch('http://127.0.0.1:' + VPORT + p, { headers: { 'x-ccboard': VTOK } }); const b = Buffer.from(await r.arrayBuffer()); return { n: b.length, j: JSON.parse(b.toString('utf8')) }; };
    const vget = async (p) => (await vraw(p)).j;
    const LEGACY = ['now', 'sessions', 'others', 'ghostty', 'pending', 'home', 'notices', 'providers', 'archived', 'lost', 'crash', 'stallMs', 'sandbox', 'limits', 'org', 'processed'];      // processed：11/18 「审完了」跨设备（[3p]）
    const keysOf = (o) => Object.keys(o || {}).sort().join();
    const noQuiet = (o) => JSON.stringify({ ...o, now: 0, v: undefined, full: undefined, peek: undefined, sessions: (o.sessions || []).map((s) => ({ ...s, quiet: 0 })) });
    const vUp = await vStart();
    ok(vUp, '[2v] 另起的一份服务（端口 ' + VPORT + '）起来了（没起来时这一段后面全跳过；先看端口 ' + VPORT + ' / ' + (VPORT + 1000) + ' 是不是被别人占着）', fs.existsSync(path.join(ROOT, 'server-v.out')) ? fs.readFileSync(path.join(ROOT, 'server-v.out'), 'utf8').slice(-300) : '');
    v2: if (vUp) {
    await until(async () => { try { return (await vget('/api/state?peek=1')).sessions.length === 60; } catch { return false; } }, 15000);
    await sleep(2500);                                                         // 让几轮扫描过去：在跑的 3 个 quiet 涨起来

    // 1) 不带版本号：和以前逐字段一样（总管、值班、脚本都这么读）
    const L1 = await vget('/api/state?peek=1'), L2 = await vget('/api/state');
    ok(keysOf(L1) === [...LEGACY, 'peek'].sort().join() && keysOf(L2) === [...LEGACY].sort().join() && L1.sessions.length === 60,
      '不带版本号的老读法：字段一个不多一个不少（peek=1 多一个 peek），60 个会话整份给', JSON.stringify({ peek: keysOf(L1), plain: keysOf(L2), n: (L1.sessions || []).length }));
    // 2) v=0（界面第一次拉、换了一台、拼不上时）：整份 + v + full，内容和老读法一样
    const F0 = await vget('/api/state?v=0');
    ok(F0.full === true && /^[0-9a-f]{8}\.\d+$/.test(F0.v || '') && keysOf(F0) === [...LEGACY, 'v', 'full'].sort().join() && noQuiet(F0) === noQuiet(L2),
      '带 v=0：整份（full: true + 版本号 v），其余字段和内容跟老读法一模一样（quiet、now 除外）', JSON.stringify({ full: F0.full, v: F0.v, keys: keysOf(F0), same: noQuiet(F0) === noQuiet(L2) }));
    // 3) 都没变：应答很小，没有会话、没有全局字段；在跑的 3 个只在 q 里给 quiet
    await sleep(2500);
    const U = await vraw('/api/state?v=' + encodeURIComponent(F0.v || '')), u = U.j;
    const busySids = V.filter((x) => x.busy).map((x) => x.sid).sort().join();
    ok(U.n <= V_CAP, '60 个会话都没变：一次应答 ' + U.n + ' 字节（上限 ' + V_CAP + '；同一刻整份是 ' + Buffer.byteLength(JSON.stringify(L2)) + '）', JSON.stringify(u).slice(0, 300));
    ok(!('sessions' in u) && Array.isArray(u.changed) && u.changed.length === 0 && Array.isArray(u.gone) && u.gone.length === 0 && !('ids' in u) && keysOf(u) === 'base,changed,gone,notices,now,q,v' && u.base === F0.v && u.v !== undefined,
      '都没变：changed / gone 是空的，不带 ids 和任何全局字段（limits、org、crash…），base 是界面带来的版本号', JSON.stringify({ keys: keysOf(u), changed: (u.changed || []).length, base: u.base }));
    ok(Object.keys(u.q || {}).sort().join() === busySids && Object.values(u.q || {}).every((x) => x > 2000),
      '在跑的会话「多久没动静」（quiet）每一拍都在涨，不算变了：只在 q 里给，歇着的（0）不给', JSON.stringify(u.q));
    // 4) 改了一个：只回那一个
    const one = V[10];
    fs.appendFileSync(one.file, [R.human('第 10 件又来一句'), R.tool()].map((r) => JSON.stringify(r)).join('\n') + '\n');
    await sleep(2500);
    const C1 = await vget('/api/state?v=' + encodeURIComponent(u.v || '')), Lc = await vget('/api/state?peek=1');
    const lOne = Lc.sessions.find((s) => s.sid === one.sid), cOne = (C1.changed || [])[0];
    ok((C1.changed || []).map((s) => s.sid).join() === one.sid && C1.gone.length === 0 && !('ids' in C1),
      '改了一个会话：changed 里只有它，gone 空，先后没变不带 ids', JSON.stringify({ changed: (C1.changed || []).map((s) => s.sid.slice(0, 8)), gone: C1.gone, ids: 'ids' in C1 }));
    ok(!!cOne && cOne.prompt === '第 10 件又来一句' && JSON.stringify({ ...cOne, quiet: 0 }) === JSON.stringify({ ...lOne, quiet: 0 }),
      '改了的那个整个给，内容和同一刻老读法里的它一样', JSON.stringify({ prompt: cOne && cOne.prompt }));
    // 5) 两个页面：B 拿着新的版本号什么都不收；A 还拿着早先的版本号，照样收到这之后改过的那一个（B 先拉不会吃掉 A 的）
    const B2 = await vget('/api/state?v=' + encodeURIComponent(C1.v || '')), A2 = await vget('/api/state?v=' + encodeURIComponent(u.v || ''));
    ok((B2.changed || []).length === 0 && (A2.changed || []).map((s) => s.sid).join() === one.sid,
      '两个页面同时拉：各拿各的版本号，新的什么都不收，旧的照样收到之后改过的会话', JSON.stringify({ b: (B2.changed || []).length, a: (A2.changed || []).map((s) => s.sid.slice(0, 8)) }));
    // 6) 不见了一个（进程没了）：gone 给名单，ids 是新的先后，changed 不带它
    const dead = V[20]; if (dead.pid > 1) try { process.kill(dead.pid, 'SIGTERM'); } catch {}
    const G1 = await until(async () => { const g = await vget('/api/state?v=' + encodeURIComponent(B2.v || '')); return g.gone && g.gone.length ? g : null; }, 10000) || {};
    ok(JSON.stringify(G1.gone) === JSON.stringify([dead.sid]) && Array.isArray(G1.ids) && G1.ids.length === 59 && !G1.ids.includes(dead.sid) && !(G1.changed || []).some((s) => s.sid === dead.sid),
      '会话不见了：gone 里是它，ids 是剩下 59 个的新先后，changed 里没有它', JSON.stringify({ gone: G1.gone, ids: G1.ids && G1.ids.length, changed: (G1.changed || []).map((s) => s.sid.slice(0, 8)) }));
    ok(Array.isArray(G1.ids) && JSON.stringify(G1.ids) === JSON.stringify((await vget('/api/state?peek=1')).sessions.map((s) => s.sid)),
      'ids 的先后就是老读法里 sessions 的先后', JSON.stringify((G1.ids || []).slice(0, 3)));
    ok(!!G1.org && !!G1.org.nodes && Object.keys(G1.org.nodes).length === 59 && !(dead.sid in G1.org.nodes) && !('limits' in G1) && !('providers' in G1),
      '全局字段变了才给：会话不见了，架构（org）跟着变、这一拍给新的（59 个，没有它）；额度、providers 没变不给', JSON.stringify({ org: !!G1.org, nodes: G1.org && G1.org.nodes && Object.keys(G1.org.nodes).length, limits: 'limits' in G1, providers: 'providers' in G1 }));
    // 7) 版本号认不出的：乱写的、将来的，都回整份
    const boot = String(F0.v || '').split('.')[0];
    const Z1 = await vget('/api/state?v=zz'), Z2 = await vget('/api/state?v=' + boot + '.99999999');
    ok(Z1.full === true && Z2.full === true && Z1.sessions.length === 59 && Z2.sessions.length === 59, '版本号认不出（乱写的、比现在还新的）：回整份', JSON.stringify({ z1: Z1.full, z2: Z2.full }));
    // 7b) 不见了的名单记不下（这份服务调成只记 2 个）：又不见了 2 个，最早那个（第 6 步的）被忘掉。
    //     拿着它不见之前的版本号（B2）来：服务说不清这之后还少了谁，回整份；拿着它不见那一刻的版本号（G1）来：照样只回变过的，gone 是后来的 2 个
    const dead2 = [V[21], V[22]]; for (const x of dead2) if (x.pid > 1) try { process.kill(x.pid, 'SIGTERM'); } catch {}
    const H1 = await until(async () => { const h = await vget('/api/state?v=' + encodeURIComponent(G1.v || '')); return h.gone && h.gone.length === 2 ? h : null; }, 10000) || {};
    const H2 = await vget('/api/state?v=' + encodeURIComponent(B2.v || ''));
    ok(!H1.full && JSON.stringify((H1.gone || []).slice().sort()) === JSON.stringify(dead2.map((x) => x.sid).sort()) && H2.full === true && (H2.sessions || []).length === 57,
      '不见了的名单记不下时：拿着比忘掉的还早的版本号来回整份（57 个），拿着忘掉那一刻的版本号来照样只回后来不见的 2 个', JSON.stringify({ h1full: H1.full, h1gone: (H1.gone || []).length, h2full: H2.full, h2n: (H2.sessions || []).length }));
    // 8) 重启（只读模式重起，顺带核只读的服务也能增量）：拿着上一台的版本号来，回整份、启动号换了；序号恰好落在新一台的范围里也认得出
    const oldV = H1.v || G1.v || '';
    await vStop();
    if (!(await vStart({ CCBOARD_READONLY: '1' }))) { ok(false, '[2v] 只读重起的那份服务没起来', ''); break v2; }
    await until(async () => { try { return (await vget('/api/state?peek=1')).sessions.length === 57; } catch { return false; } }, 15000);
    const R0 = await vget('/api/state?v=' + encodeURIComponent(oldV)), R1 = await vget('/api/state?v=' + encodeURIComponent(boot + '.1'));
    ok(R0.full === true && R0.sessions.length === 57 && String(R0.v || '').split('.')[0] !== boot,
      '服务重启后拿着上一台的版本号来：回整份（full），启动号换了，界面不会拿旧的接着拼', JSON.stringify({ full: R0.full, v: R0.v, old: oldV }));
    ok(R1.full === true && R1.sessions.length === 57, '上一台的版本号、序号恰好落在新一台的范围里（.1）：也认得出换了一台，回整份', JSON.stringify({ full: R1.full, v: R1.v }));
    await sleep(1500);
    const R2 = await vraw('/api/state?v=' + encodeURIComponent(R0.v || ''));
    ok(R2.j.full === undefined && Array.isArray(R2.j.changed) && R2.j.changed.length === 0 && R2.n <= V_CAP, '只读的服务（CCBOARD_READONLY=1）照样只回变过的：没变时 ' + R2.n + ' 字节', JSON.stringify(R2.j).slice(0, 200));
    }
    await vStop();
  }
  // ── 「先放着」带时间：另起一份服务（T_PORT + 500），自己的假主目录里 6 个歇着、刚交付了【待跟进】的会话。
  //    该醒：又交付了一次【待跟进】、停下来等你选（登记里的状态改成 waiting）、他自己回了话、到点（中间被【进展】盖住的那件事翻回待跟进）；
  //    不该醒：别的窗口开的轮又交付了【进展】、【待审阅】。服务重启推迟还在；刚发了话、这一轮还没交付的不让推迟；界面看到的不是现在这次交付不让推迟；坏输入 400 ──
  console.log('\n[3s] 先放着带时间：推迟记在服务（snooze.json）；推迟中只有新的【待跟进】、停下来等你选、到点才醒，【进展】【待审阅】不醒；服务重启照样记得；刚发了话的不让推迟；坏输入');
  {
    const ZPORT = PORT + 500, ZH = path.join(ROOT, 'zhome'), ZSESS = path.join(ZH, '.claude/sessions'), ZCWD = path.join(ZH, 'work');
    const ZPROJ = path.join(ZH, '.claude/projects', ZCWD.replace(/[^A-Za-z0-9]/g, '-')), ZDATA = path.join(ROOT, 'zdata'), ZOUT = path.join(ROOT, 'server-z.out');
    for (const d of [ZSESS, ZCWD, ZPROJ, ZDATA]) fs.mkdirSync(d, { recursive: true });
    const Z = {}, zT0 = Date.now() - 600000;
    const zreg = (x, status) => fs.writeFileSync(path.join(ZSESS, x.pid + '.json'), JSON.stringify({ pid: x.pid, sessionId: x.sid, cwd: ZCWD, startedAt: x.at, kind: 'interactive', entrypoint: 'cli', name: 'z-' + x.name, nameSource: 'derived', status, statusUpdatedAt: zT0, updatedAt: zT0 }));
    const zadd = (x, recs) => fs.appendFileSync(x.file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    ['reply', 'ask', 'due', 'keep', 'sent', 'bad', 'you', 'raise'].forEach((name, i) => {
      const c = spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(c.pid);
      const x = { name, pid: c.pid, sid: 'z' + String(i).padStart(7, '0') + '-0000-4000-8000-' + String(c.pid).padStart(12, '0'), at: zT0 + i * 1000 };
      x.file = path.join(ZPROJ, x.sid + '.jsonl'); fs.writeFileSync(x.file, '');
      zadd(x, [R.human('第 ' + i + ' 件事'), R.tool(), R.result(), R.final('做好了两版。\n\n【待跟进】回 A 或 B')]); zreg(x, 'idle'); Z[name] = x;
    });
    const zenv = { ...env, HOME: ZH, CCBOARD_PORT: String(ZPORT), CCBOARD_PREVIEW_PORT: String(ZPORT + 1000), CCBOARD_DATA: ZDATA, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, 'z', 'ccboard.sock'), CCBOARD_STALL_MS: '3600000' };
    let zsrv = null, ZTOK = '';
    const zStart = async () => {      // 起来了回 true；端口先被别人占着、10 秒没起来回 false
      for (const p of [ZPORT, ZPORT + 1000]) { try { await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(1500) }); return false; } catch {} }
      const o = fs.openSync(ZOUT, 'a'); zsrv = spawn(NODE, [SERVER], { env: zenv, stdio: ['ignore', o, o] }); kids.push(zsrv.pid);
      for (let i = 0; i < 50; i++) { await sleep(200); try { ZTOK = fs.readFileSync(path.join(ZDATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + ZPORT + '/health')).json(); if (h.ok && h.pid === zsrv.pid) return true; } catch {} }
      return false;
    };
    const zStop = async () => { const p = zsrv && zsrv.pid; if (!(p > 1)) return; try { process.kill(p, 'SIGTERM'); } catch {} for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + ZPORT + '/health'); } catch { break; } } };
    const zget = async (p) => (await fetch('http://127.0.0.1:' + ZPORT + p, { headers: { 'x-ccboard': ZTOK } })).json();
    const zpost = async (p, body) => { const r = await fetch('http://127.0.0.1:' + ZPORT + p, { method: 'POST', headers: { 'x-ccboard': ZTOK, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json().catch(() => ({})) }; };
    const zs = async () => Object.fromEntries((await zget('/api/state?peek=1')).sessions.map((x) => [x.sid, x]));
    const zlog = () => (fs.existsSync(ZOUT) ? fs.readFileSync(ZOUT, 'utf8') : '').split('\n').filter((l) => l.startsWith('snooze '));
    const woke = (x, why) => zlog().some((l) => l.includes(' ' + x.sid.slice(0, 8) + ' wake ' + why));
    const zfile = () => { try { return JSON.parse(fs.readFileSync(path.join(ZDATA, 'snooze.json'), 'utf8')); } catch { return null; } };
    const zUp = await zStart();
    ok(zUp, '[3s] 另起的一份服务（端口 ' + ZPORT + '）起来了（没起来时这一段后面全跳过；先看端口 ' + ZPORT + ' / ' + (ZPORT + 1000) + ' 是不是被别人占着）', fs.existsSync(ZOUT) ? fs.readFileSync(ZOUT, 'utf8').slice(-300) : '');
    z3: if (zUp) {
      await until(async () => { try { const S = await zs(); return Object.values(Z).every((x) => S[x.sid] && S[x.sid].digest && S[x.sid].digest.need === 'reply'); } catch { return false; } }, 15000);
      const hour = Date.now() + 3600e3;
      // 坏输入
      const b1 = await zpost('/api/snooze', { sid: 'nope0000-0000-4000-8000-000000000000', until: hour });
      const b2 = await zpost('/api/snooze', { sid: Z.bad.sid, until: Date.now() - 1000 });
      const b3 = await zpost('/api/snooze', { sid: Z.bad.sid, until: Date.now() + 49 * 3600e3 });
      const b4 = await zpost('/api/snooze', { sid: Z.bad.sid, until: String(hour) });
      ok([b1, b2, b3, b4].every((b) => b.code === 400 && b.body.ok === false) && !(await zs())[Z.bad.sid].snooze && zfile() === null,
        '坏输入一律 400、什么都不记：墙上没有的会话、时间在过去、超过 48 小时、时间不是数字', JSON.stringify([b1, b2, b3, b4].map((b) => [b.code, b.body.error])));
      // 刚发了话（这一轮还没交付）：不让推迟
      zadd(Z.sent, [R.human('再改一下 B')]);
      await until(async () => (await zs())[Z.sent.sid].prompt === '再改一下 B', 8000);
      const s1 = await zpost('/api/snooze', { sid: Z.sent.sid, until: hour });
      ok(s1.code === 200 && s1.body.ok === false && /刚发了话/.test(s1.body.error || '') && !(await zs())[Z.sent.sid].snooze,
        '刚发了话、这一轮还没交付的：不让推迟（回 ok:false 和原因，不记）', JSON.stringify(s1));
      const s2 = await zpost('/api/snooze', { sid: Z.bad.sid, until: hour, at: '2000-01-01T00:00:00.000Z' });
      ok(s2.code === 200 && s2.body.ok === false && /又交付/.test(s2.body.error || '') && !(await zs())[Z.bad.sid].snooze,
        '界面带来的 at（它看到的那一次交付）不是现在这一次：不让推迟（菜单开着时它又交付了）', JSON.stringify(s2));
      // 推迟 6 个：reply / ask / keep / you 推一小时，due / raise 推 8 秒（界面带上它看到的那一次交付 at）
      const S0 = await zs(), P = {};
      for (const n of ['reply', 'ask', 'keep', 'you']) P[n] = await zpost('/api/snooze', { sid: Z[n].sid, until: hour, at: S0[Z[n].sid].resultAt });
      for (const n of ['due', 'raise']) P[n] = await zpost('/api/snooze', { sid: Z[n].sid, until: Date.now() + 8000, at: S0[Z[n].sid].resultAt });
      zadd(Z.raise, [R.peer('win-zz', '顺手把 C 也看一下'), R.tool(), R.result(), R.final('C 也看过了。\n\n【进展】C 看完了')]);     // 推迟中别的窗口开的一轮，交付【进展】，到点前盖住「回 A 或 B」
      const S1 = await zs(), F1 = zfile() || {}, SIX = ['reply', 'ask', 'due', 'keep', 'you', 'raise'];
      ok(Object.values(P).every((x) => x.code === 200 && x.body.ok && x.body.until > Date.now()) && SIX.every((n) => S1[Z[n].sid].snooze && S1[Z[n].sid].snooze.at === S0[Z[n].sid].resultAt && F1[Z[n].sid] && F1[Z[n].sid].ask === '回 A 或 B') && Object.keys(F1).length === 6 && zlog().filter((l) => / set /.test(l)).length === 6,
        '推迟 6 个：/api/state 里各带 snooze（until、推迟的是哪一次交付 at），snooze.json 里 6 条、各记着那件事（ask），日志 6 行 set', JSON.stringify({ P: Object.values(P).map((x) => x.code), file: Object.keys(F1).length }));
      // 不该醒：推迟中别的窗口开的轮交付了【进展】，又交付了【待审阅】
      zadd(Z.reply, [R.peer('win-zz', '先别管 A，看下 C'), R.tool(), R.result(), R.final('C 看过了，和 A 差不多。\n\n【进展】C 看完了')]);
      const n1 = await until(async () => { const x = (await zs())[Z.reply.sid]; return x.done && x.digest && x.digest.need === 'fyi' && x.resultAt !== S1[Z.reply.sid].resultAt ? x : null; }, 8000) || {};
      await sleep(1500);
      const n1b = (await zs())[Z.reply.sid];
      zadd(Z.reply, [R.peer('win-zz', '再看下 D'), R.tool(), R.result(), R.final('D 做好了，截图在桌面。\n\n【待审阅】D 的截图')]);
      const n2 = await until(async () => { const x = (await zs())[Z.reply.sid]; return x.done && x.digest && x.digest.need === 'review' ? x : null; }, 8000) || {};
      await sleep(1500);
      const n2b = (await zs())[Z.reply.sid];
      ok(n1.digest && !!n1b.snooze && n2.digest && !!n2b.snooze && n2b.digest.need === 'review' && !woke(Z.reply, '') && !!(zfile() || {})[Z.reply.sid],
        '不该醒：推迟中别的窗口开的轮又交付了【进展】、又交付了【待审阅】，都还在推迟（snooze 还在、snooze.json 里还在、没有 wake 日志）', JSON.stringify({ n1: n1b.snooze, need1: n1.digest && n1.digest.need, n2: n2b.snooze, need2: n2b.digest && n2b.digest.need }));
      // 该醒 1：推迟中又交付了一次【待跟进】
      zadd(Z.reply, [R.peer('win-zz', '那 D 和 A 选哪个'), R.tool(), R.result(), R.final('两个都能用。\n\n【待跟进】回 A 或 D')]);
      const w1 = await until(async () => { const x = (await zs())[Z.reply.sid]; return x.done && x.digest && x.digest.need === 'reply' && x.resultAt !== n2b.resultAt && !x.snooze ? x : null; }, 8000) || {};
      await until(() => woke(Z.reply, 'reply'), 5000);
      ok(!!w1.sid && !w1.snooze && woke(Z.reply, 'reply') && !(zfile() || {})[Z.reply.sid], '该醒：推迟中又交付了一次【待跟进】→ 醒（snooze 没了、snooze.json 里删了、日志 wake reply）', JSON.stringify({ snooze: w1.snooze, need: w1.digest && w1.digest.need }));
      // 该醒 2：停下来等你选
      zreg(Z.ask, 'waiting');
      const w2 = await until(async () => { const x = (await zs())[Z.ask.sid]; return x.status === 'waiting' && !x.snooze ? x : null; }, 8000) || {};
      await until(() => woke(Z.ask, 'ask'), 5000);
      ok(w2.status === 'waiting' && !w2.snooze && woke(Z.ask, 'ask'), '该醒：推迟中停下来等你选（登记里的状态 waiting）→ 醒（日志 wake ask）', JSON.stringify({ status: w2.status, snooze: w2.snooze }));
      // 该醒 3：他自己回了它（终端里说了一句）→ 醒；之后它交回来的【待审阅】照常是待审阅，不被推迟吞掉
      zadd(Z.you, [R.human('选 A')]);
      const w4 = await until(async () => { const x = (await zs())[Z.you.sid]; return x.prompt === '选 A' && !x.snooze ? x : null; }, 8000) || {};
      await until(() => woke(Z.you, 'you'), 5000);
      zadd(Z.you, [R.tool(), R.result(), R.final('按 A 做好了。\n\n【待审阅】A 的截图')]);
      const w4b = await until(async () => { const x = (await zs())[Z.you.sid]; return x.done && x.digest && x.digest.need === 'review' ? x : null; }, 8000) || {};
      ok(!!w4.sid && woke(Z.you, 'you') && !!w4b.sid && !w4b.snooze, '该醒：推迟中他自己回了话 → 醒（日志 wake you），之后交回来的【待审阅】照常显示、不带 snooze', JSON.stringify({ w4: !!w4.sid, snooze: w4b.snooze, need: w4b.digest && w4b.digest.need }));
      // 该醒 4：到点。due 推迟后什么都没发生：照旧是待跟进；raise 推迟中被【进展】盖住了：到点后那一次交付改回待跟进、带推迟时那件事
      const w3 = await until(async () => { const S = await zs(); return !S[Z.due.sid].snooze && !S[Z.raise.sid].snooze ? S : null; }, 15000) || {};
      await until(() => woke(Z.due, 'due') && woke(Z.raise, 'due'), 5000);
      await sleep(2500); const S3 = await zs();          // 隔两轮扫描再读：到点那一拍是就地改的，之后每一拍要照样改（不然下一拍又变回【进展】）
      const d3 = (w3[Z.due.sid] || {}).digest || {}, r3 = (S3[Z.raise.sid] || {}).digest || {};
      ok(!!w3[Z.due.sid] && woke(Z.due, 'due') && d3.need === 'reply' && !!(await zs())[Z.keep.sid].snooze, '该醒：到点 → 醒（日志 wake due），还是待跟进；没到点、什么都没发生的 keep 照旧推迟着', JSON.stringify({ due: d3.need, keep: !!(await zs())[Z.keep.sid].snooze }));
      ok(woke(Z.raise, 'due raise') && r3.need === 'reply' && r3.ask === '回 A 或 B' && r3.raised === true && (S3[Z.raise.sid] || {}).resultAt !== S0[Z.raise.sid].resultAt,
        '到点时那件事已经被后来的【进展】盖住：现在这一次交付改回待跟进，「要你做的事」是推迟时那句（日志 wake due raise）', JSON.stringify({ need: r3.need, ask: r3.ask, raised: r3.raised }));
      // 服务重启：keep 还在推迟（读 snooze.json）
      await zStop();
      if (!(await zStart())) { ok(false, '[3s] 重起的服务没起来', ''); break z3; }
      const r1 = await until(async () => { try { const x = (await zs())[Z.keep.sid]; return x && x.digest && x.digest.need ? x : null; } catch { return null; } }, 15000) || {};
      ok(!!r1.snooze && r1.snooze.until === P.keep.body.until, '服务重启后推迟照样记得：keep 的 snooze 还在、到的时间一样', JSON.stringify(r1.snooze || null));
      // 撤销
      const c1 = await zpost('/api/snooze', { sid: Z.keep.sid, clear: true });
      ok(c1.code === 200 && c1.body.ok && !(await zs())[Z.keep.sid].snooze && !(zfile() || {})[Z.keep.sid] && zlog().some((l) => l.includes(' ' + Z.keep.sid.slice(0, 8) + ' clear')),
        '撤销（clear: true）：snooze 没了、snooze.json 里删了、日志 clear', JSON.stringify(c1));
    }
    await zStop();
  }
  // ── 「审完了」跨设备（11/18，作者 13:0x：「手机上待审阅 5 个，电脑上待审阅 0 个」）：另起一份服务（T_PORT + 250），自己的假主目录里 5 个刚交付【待审阅】的会话。
  //    A、B 两个「页面」各拿各的版本号（v）拉 /api/state：A 经 /api/processed 报上来的，B 不点也要在 processed 里看到；只给墙上的、和现在这一次交付对得上的；
  //    clear 以后没了；它又交付了一次，旧的那笔不算；只回变过的那套里 processed 变了才给。远程端口也带，在 [10] 里核（要配对过的设备）──
  console.log('\n[3p] 「审完了」跨设备：A 页报上来的，B 页读 /api/state 的 processed 就看到；只给墙上、对得上这一次交付的；撤销就没；又交付了一次旧的不算；只回变过的那套变了才给');
  {
    const PPORT = PORT + 250, PH = path.join(ROOT, 'phome'), PSESS = path.join(PH, '.claude/sessions'), PCWD = path.join(PH, 'work');
    const PPROJ = path.join(PH, '.claude/projects', PCWD.replace(/[^A-Za-z0-9]/g, '-')), PDATA = path.join(ROOT, 'pdata'), POUT = path.join(ROOT, 'server-p.out');
    for (const d of [PSESS, PCWD, PPROJ, PDATA]) fs.mkdirSync(d, { recursive: true });
    const P = {}, pT0 = Date.now() - 600000;
    const padd = (x, recs) => fs.appendFileSync(x.file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    ['a', 'b', 'c', 'd', 'e'].forEach((name, i) => {
      const c = spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(c.pid);
      const x = { name, pid: c.pid, sid: 'p' + String(i).padStart(7, '0') + '-0000-4000-8000-' + String(c.pid).padStart(12, '0'), at: pT0 + i * 1000 };
      x.file = path.join(PPROJ, x.sid + '.jsonl'); fs.writeFileSync(x.file, '');
      padd(x, [R.human('第 ' + i + ' 件'), R.tool(), R.result(), R.final('改好了，截图在桌面。\n\n【待审阅】第 ' + i + ' 件的截图')]);
      fs.writeFileSync(path.join(PSESS, x.pid + '.json'), JSON.stringify({ pid: x.pid, sessionId: x.sid, cwd: PCWD, startedAt: x.at, kind: 'interactive', entrypoint: 'cli', name: 'p-' + name, nameSource: 'derived', status: 'idle', statusUpdatedAt: pT0, updatedAt: pT0 }));
      P[name] = x;
    });
    const penv = { ...env, HOME: PH, CCBOARD_PORT: String(PPORT), CCBOARD_PREVIEW_PORT: String(PPORT + 1000), CCBOARD_DATA: PDATA, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, 'p', 'ccboard.sock'), CCBOARD_STALL_MS: '3600000' };
    let psrv = null, PTOK = '';
    const pStart = async () => {      // 起来了回 true；端口先被别人占着、10 秒没起来回 false
      for (const p of [PPORT, PPORT + 1000]) { try { await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(1500) }); return false; } catch {} }
      const o = fs.openSync(POUT, 'a'); psrv = spawn(NODE, [SERVER], { env: penv, stdio: ['ignore', o, o] }); kids.push(psrv.pid);
      for (let i = 0; i < 50; i++) { await sleep(200); try { PTOK = fs.readFileSync(path.join(PDATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + PPORT + '/health')).json(); if (h.ok && h.pid === psrv.pid) return true; } catch {} }
      return false;
    };
    const pStop = async () => { const p = psrv && psrv.pid; if (!(p > 1)) return; try { process.kill(p, 'SIGTERM'); } catch {} for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + PPORT + '/health'); } catch { break; } } psrv = null; };
    const pUp = await pStart();
    const pget = async (p) => (await fetch('http://127.0.0.1:' + PPORT + p, { headers: { 'x-ccboard': PTOK } })).json();
    const ppost = async (body) => (await fetch('http://127.0.0.1:' + PPORT + '/api/processed', { method: 'POST', headers: { 'x-ccboard': PTOK, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    ok(pUp, '[3p] 另起的一份服务（端口 ' + PPORT + '）起来了（没起来时这一段后面全跳过；先看端口 ' + PPORT + ' / ' + (PPORT + 1000) + ' 是不是被别人占着）', fs.existsSync(POUT) ? fs.readFileSync(POUT, 'utf8').slice(-300) : '');
    p3: if (pUp) {
      const full = () => pget('/api/state?peek=1');
      const S0 = await until(async () => { try { const st = await full(); return Object.values(P).every((x) => { const s = st.sessions.find((y) => y.sid === x.sid); return s && s.digest && s.digest.need === 'review'; }) ? st : null; } catch { return null; } }, 15000);
      if (!S0) { ok(false, '[3p] 5 个会话 15 秒内没都变成待审阅', ''); break p3; }
      const at0 = (n) => S0.sessions.find((y) => y.sid === P[n].sid).resultAt;
      // 两个页面：各自先拉一次整份（v=0），之后带自己的 v
      const page = () => { let v = '0'; return async () => { const d = await pget('/api/state?v=' + encodeURIComponent(v)); v = d.v; return d; }; };
      const A = page(), B = page(), a0 = await A(), b0 = await B(), b1 = await B();
      ok(a0.full && b0.full && JSON.stringify(b0.processed) === '{}' && JSON.stringify(S0.processed) === '{}' && !('processed' in b1),
        '还没人点「审完了」：整份里 processed 是 {}（老读法 peek 和带 v 的整份都有这个键）；没变时只回变过的那套里不带 processed', JSON.stringify({ peek: S0.processed, b0: b0.processed, b1: 'processed' in b1 }));
      // A 页点了 a（这一次交付）；顺手报了 b 的一个旧时间、一个不在墙上的会话、e 的一个乱写的时间
      const r1 = await ppost({ map: { [P.a.sid]: at0('a'), [P.b.sid]: '2000-01-01T00:00:00.000Z', 'ghost000-0000-4000-8000-000000000000': at0('a'), [P.e.sid]: 'x' } });
      const b2 = await B(), s2 = await full();
      ok(r1.ok && JSON.stringify(b2.processed) === JSON.stringify({ [P.a.sid]: at0('a') }) && JSON.stringify(s2.processed) === JSON.stringify(b2.processed),
        'A 页点了 a 的「审完了」：B 页下一拍（只回变过的那套）带上 processed = { a: 那一次交付的时间 }，老读法 peek 一样；b 记的是旧交付、ghost 不在墙上、e 的时间对不上，都不给', JSON.stringify({ r1, b2: b2.processed, peek: s2.processed }));
      const b3 = await B();
      ok(!('processed' in b3) && b3.changed.length === 0, '再拉一拍、什么都没变：只回变过的那套里不带 processed（全局字段各自比，变了才给）', JSON.stringify({ has: 'processed' in b3, changed: b3.changed.length }));
      // 页面重发（只增不整份替换）：B 页空的一份发过来，不清掉 A 的
      await ppost({ map: {} }); await ppost({ map: { [P.c.sid]: at0('c') } });
      const b4 = await B();
      ok(JSON.stringify(b4.processed) === JSON.stringify({ [P.a.sid]: at0('a'), [P.c.sid]: at0('c') }), '另一页发来空的 map、再报 c：a 还在、c 加上（按 sid 排）', JSON.stringify(b4.processed));
      // A 页撤销 a
      await ppost({ clear: [P.a.sid] });
      const b5 = await B(), a5 = await A();
      ok(JSON.stringify(b5.processed) === JSON.stringify({ [P.c.sid]: at0('c') }) && JSON.stringify(a5.processed) === JSON.stringify(b5.processed),
        'A 页撤销 a（clear）：B 页下一拍 processed 里没有 a 了，c 还在；A 页自己读的也一样', JSON.stringify({ b5: b5.processed, a5: a5.processed }));
      // c 又交付了一次：服务里记的还是旧的那次，不再给
      padd(P.c, [R.human('再改一下'), R.tool(), R.result(), R.final('又改了一版。\n\n【待审阅】第二版')]);
      const s6 = await until(async () => { const st = await full(); const s = st.sessions.find((y) => y.sid === P.c.sid); return s && s.resultAt !== at0('c') && s.done ? st : null; }, 10000);
      const b6 = await B();
      ok(!!s6 && JSON.stringify(s6.processed) === '{}' && JSON.stringify(b6.processed) === '{}' && b6.changed.some((s) => s.sid === P.c.sid),
        'c 又交付了一次（resultAt 变了）：点过的是上一次，processed 里不再有 c（peek 和 B 页的下一拍都是 {}）', JSON.stringify({ peek: s6 && s6.processed, b6: b6.processed }));
      // 再点 c 的新交付 → 又有；会话不在墙上 → 没有
      const at6 = s6.sessions.find((y) => y.sid === P.c.sid).resultAt;
      await ppost({ map: { [P.c.sid]: at6, [P.d.sid]: at0('d') } });
      try { process.kill(P.d.pid, 'SIGTERM'); } catch {}
      const s7 = await until(async () => { const st = await full(); return !st.sessions.some((y) => y.sid === P.d.sid) ? st : null; }, 15000);
      ok(!!s7 && JSON.stringify(s7.processed) === JSON.stringify({ [P.c.sid]: at6 }), '点 c 的新交付 → 又给 c（新的时间）；d 点过、但它的进程退了、不在墙上 → 不给', JSON.stringify(s7 && s7.processed));
      // 落盘（线上服务一天会重启好几次）：只在内存的话，手机上点的、重启时手机又没开着，Mac 上那几张就回到待审阅，直到手机再打开重发
      const PF = path.join(PDATA, 'processed.json'), pf = () => { try { return JSON.parse(fs.readFileSync(PF, 'utf8')); } catch { return null; } };
      const canon = (o) => JSON.stringify(Object.entries(o || {}).sort());
      const fWant = canon({ [P.b.sid]: '2000-01-01T00:00:00.000Z', [P.c.sid]: at6, [P.e.sid]: 'x' });      // 盘上是服务记着的整张表（b、e 的时间对不上也收，只是不发给页面）
      const f1 = await until(async () => (canon(pf()) === fWant ? pf() : null), 15000);
      ok(!!f1, 'processed.json：落了盘，是服务记着的整张表 b、c、e（b、e 时间对不上照样记、只是不给页面）；撤销了的 a、进程退了的 d、不在墙上的 ghost 都不在（起服务的头 10 秒不删）', JSON.stringify(pf()));
      await pStop();
      if (!(await pStart())) { ok(false, '[3p] 重起的服务没起来', ''); break p3; }
      const s8 = await until(async () => { try { const st = await full(); return st.sessions.some((y) => y.sid === P.c.sid) ? st : null; } catch { return null; } }, 15000);
      ok(!!s8 && JSON.stringify(s8.processed) === JSON.stringify({ [P.c.sid]: at6 }), '服务重启以后：/api/state 的 processed 照样有 c（读回 processed.json），不等哪个页面重发', JSON.stringify(s8 && s8.processed));
      await pStop(); fs.writeFileSync(PF, '{坏了');
      if (!(await pStart())) { ok(false, '[3p] 文件写坏以后服务没起来', ''); break p3; }
      const s9 = await until(async () => { try { const st = await full(); return st.sessions.some((y) => y.sid === P.c.sid) ? st : null; } catch { return null; } }, 15000);
      await ppost({ map: { [P.a.sid]: at0('a') } });
      ok(!!s9 && JSON.stringify(s9.processed) === '{}' && JSON.stringify(pf()) === JSON.stringify({ [P.a.sid]: at0('a') }), 'processed.json 写坏了：服务照常起来、当成没有（processed 是 {}）；下一次有人点「审完了」整份重写成好的', JSON.stringify({ s9: s9 && s9.processed, file: pf() }));
    }
    await pStop();
  }
  // ── 通知的门：另起一份服务（T_PORT + 600），自己的假主目录里 15 个会话（后来再上墙 1 个）。试验场里不真发通知，服务日志的 notify 行写「本来会发什么」，这一段读它。
  //    不该发：服务起来时已经是待跟进 / 已经停住的、重启以后已经发过的、后来才上墙的待跟进、交付了待跟进马上又动了（后台通知、自动续跑把它叫醒）、推迟中停住了、
  //            推迟到点翻回来的那件、刚交付就推迟的那件到点以后、发过以后它 busy 一下又回来（同一次交付）、等你选期间登记重写；
  //    该发：新交付一个【待跟进】恰好一条（站稳 5 秒以后）、后台命令还在跑时交付的待跟进（等得更久）、停下来等你选、离开又进来的等你选、推迟中被新的【待跟进】叫醒那一拍、
  //          推迟到点时还停着、会话登记读坏一两轮又回来、重启前刚交付还没站稳的；他正看着时记 ui 不记 sent ──
  console.log('\n[4n] 通知的门：服务起来 / 重启时已有的不发；同一件只发一次；待跟进站稳 5 秒、期间又动了不发、后台在跑多等；推迟中不发、叫醒那一拍和到点还停着的发；后来才上墙的不发；等你选也发；登记读坏一轮不丢；重启前没站稳的重启后照发；看着时只记 ui');
  {
    const NPORT = PORT + 600, NH = path.join(ROOT, 'nhome'), NSESS = path.join(NH, '.claude/sessions'), NCWD = path.join(NH, 'work');
    const NPROJ = path.join(NH, '.claude/projects', NCWD.replace(/[^A-Za-z0-9]/g, '-')), NDATA = path.join(ROOT, 'ndata'), NOUT = path.join(ROOT, 'server-n.out');
    for (const d of [NSESS, NCWD, NPROJ, NDATA]) fs.mkdirSync(d, { recursive: true });
    const N = {}, nT0 = Date.now() - 600000;
    const nreg = (x, status, at = nT0) => fs.writeFileSync(path.join(NSESS, x.pid + '.json'), JSON.stringify({ pid: x.pid, sessionId: x.sid, cwd: NCWD, startedAt: x.at, kind: 'interactive', entrypoint: 'cli', name: 'n-' + x.name, nameSource: 'derived', status, statusUpdatedAt: at, updatedAt: at }));
    const nadd = (x, recs) => fs.appendFileSync(x.file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const nmk = (name, recs) => {
      const i = Object.keys(N).length, c = spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(c.pid);
      const x = { name, pid: c.pid, sid: 'n' + String(i).padStart(7, '0') + '-0000-4000-8000-' + String(c.pid).padStart(12, '0'), at: nT0 + i * 1000 };
      x.file = path.join(NPROJ, x.sid + '.jsonl'); fs.writeFileSync(x.file, ''); nadd(x, recs); nreg(x, 'idle'); N[name] = x; return x;
    };
    const fyi = (n) => [R.human('做 ' + n), R.tool(), R.result(), R.final(n + ' 做了一半。\n\n【进展】还在做')];
    const ask = (n, t) => [R.human('做 ' + n), R.tool(), R.result(), R.final(n + ' 做好了两版。\n\n【待跟进】' + t)];
    const reply = (n) => [R.human('接着做 ' + n), R.tool(), R.result(), R.final(n + ' 做好了。\n\n【待跟进】回 C 或 D')];
    nmk('old', ask('old', '回 A 或 B'));                                                        // 服务起来时已经是待跟进
    nmk('halt', [R.human('跑一下'), R.tool(), R.result(), R.apiErr('rate_limit', LIMIT)]);      // 服务起来时已经停住（额度）
    for (const n of ['fresh', 'quick', 'flick', 'asker', 'seen', 'shl', 'shl2', 'zc', 'pend', 'stale']) nmk(n, fyi(n));   // 起来时是【进展】，之后各自来一件
    for (const n of ['snz', 'rz', 'zh']) nmk(n, ask(n, '回 A 或 B'));                           // 起来时是待跟进，之后推迟
    const nenv = { ...env, HOME: NH, CCBOARD_PORT: String(NPORT), CCBOARD_PREVIEW_PORT: String(NPORT + 1000), CCBOARD_DATA: NDATA, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, 'n', 'ccboard.sock'), CCBOARD_STALL_MS: '3600000', CCBOARD_REPLY_SHELL_MS: '12000' };
    let nsrv = null, NTOK = '';
    const nStart = async () => {      // 起来了回 true；端口先被别人占着、10 秒没起来回 false
      for (const p of [NPORT, NPORT + 1000]) { try { await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(1500) }); return false; } catch {} }
      const o = fs.openSync(NOUT, 'a'); nsrv = spawn(NODE, [SERVER], { env: nenv, stdio: ['ignore', o, o] }); kids.push(nsrv.pid);
      for (let i = 0; i < 50; i++) { await sleep(200); try { NTOK = fs.readFileSync(path.join(NDATA, '.token'), 'utf8').trim(); const h = await (await fetch('http://127.0.0.1:' + NPORT + '/health')).json(); if (h.ok && h.pid === nsrv.pid && h.data === NDATA) return true; } catch {} }
      return false;
    };
    const nStop = async () => { const p = nsrv && nsrv.pid; if (!(p > 1)) return; try { process.kill(p, 'SIGTERM'); } catch {} for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + NPORT + '/health'); } catch { break; } } };
    const nget = async (p) => (await fetch('http://127.0.0.1:' + NPORT + p, { headers: { 'x-ccboard': NTOK } })).json();
    const npost = async (p, body) => { const r = await fetch('http://127.0.0.1:' + NPORT + p, { method: 'POST', headers: { 'x-ccboard': NTOK, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json().catch(() => ({})) }; };
    const ns = async (q = '') => Object.fromEntries((await nget('/api/state?peek=1' + q)).sessions.map((x) => [x.sid, x]));
    const nlines = (pre) => (fs.existsSync(NOUT) ? fs.readFileSync(NOUT, 'utf8') : '').split('\n').filter((l) => l.startsWith(pre));
    const nlog = () => nlines('notify ');
    const limitTok = () => nlines('alert ').reduce((a, l) => a + (l.split(' ')[4] || '').split(',').filter((k) => k === 'limit').length, 0);   // 原来那行（alert <时间> <how> n=… <类,…>）里 limit 出现几次：底上也写这一行
    const sent = (x, kind) => nlog().filter((l) => (l.split(' ')[3] || '').split(',').includes(kind + ':' + x.sid.slice(0, 8)));   // notify <时间> <dry:sent|dry:ui> <类:会话前 8 位,…> | 标题 | 正文
    const tOf = (l) => Date.parse((l || '').split(' ')[1]);
    const nUp = await nStart();
    ok(nUp, '[4n] 另起的一份服务（端口 ' + NPORT + '）起来了、/health 报的数据目录是这一段自己的（没起来时这一段后面全跳过；先看端口 ' + NPORT + ' / ' + (NPORT + 1000) + ' 是不是被别人占着）', fs.existsSync(NOUT) ? fs.readFileSync(NOUT, 'utf8').slice(-300) : '');
    n4: if (nUp) {
      const NAMES = Object.keys(N);
      const S0 = await until(async () => { try { const S = await ns(); return NAMES.every((n) => S[N[n].sid] && (S[N[n].sid].alert || (S[N[n].sid].digest && S[N[n].sid].digest.need))) ? S : null; } catch { return null; } }, 15000) || {};
      const sv = (n, S = S0) => S[N[n].sid] || {};
      // 推迟：snz 一小时（推迟中先停住、再被新的【待跟进】叫醒）；rz 6 秒（推迟中被【进展】盖住，到点翻回待跟进）；zh 12 秒（推迟中停住，到点还停着）
      const pz = await npost('/api/snooze', { sid: N.snz.sid, until: Date.now() + 3600e3, at: sv('snz').resultAt });
      const pr = await npost('/api/snooze', { sid: N.rz.sid, until: Date.now() + 6000, at: sv('rz').resultAt });
      const ph = await npost('/api/snooze', { sid: N.zh.sid, until: Date.now() + 12000, at: sv('zh').resultAt });
      nadd(N.rz, [R.peer('win-zz', '顺手看下 C'), R.tool(), R.result(), R.final('C 看过了。\n\n【进展】C 看完了')]);
      for (const n of ['snz', 'zh']) nadd(N[n], [R.peer('win-zz', '再跑一下'), R.tool(), R.result(), R.apiErr('rate_limit', LIMIT)]);   // 推迟中被别的窗口叫醒、撞上额度
      // 同一拍：fresh / quick / flick / zc 交付【待跟进】；shl 交付【待跟进】时后台命令还在跑（shell）；asker 停下来等你选；late 上墙时已经是待跟进
      for (const n of ['quick', 'flick', 'zc', 'shl', 'shl2']) nadd(N[n], reply(n));
      nadd(N.fresh, aged(8000, reply('fresh')));                                   // fresh 用真时间：重启后它走 notified.json 那条路（太旧的交付不看盘）
      for (const n of ['shl', 'shl2']) nreg(N[n], 'shell', Date.now()); nreg(N.asker, 'waiting', Date.now());
      nmk('late', ask('late', '回 A 或 B'));
      const S1 = await until(async () => { const S = await ns(); return ['fresh', 'quick', 'flick', 'zc', 'shl', 'shl2'].every((n) => sv(n, S).done && sv(n, S).digest && sv(n, S).digest.need === 'reply') ? S : null; }, 8000) || {};
      const tObs = Date.now();                                                    // 这一刻服务已经看到了这几件待跟进（它的 5 秒从更早算起）
      nadd(N.quick, [R.notif()]); nreg(N.quick, 'busy', Date.now());              // 交付完马上又动了：后台通知把它叫醒（自动续跑发出去也是这个样子）
      const pc = await npost('/api/snooze', { sid: N.zc.sid, until: Date.now() + 6000, at: sv('zc', S1).resultAt });   // 刚交付、还没站稳就推迟：推迟的就是这一件
      fs.writeFileSync(path.join(NSESS, N.flick.pid + '.json'), '{');           // flick 的会话登记读坏（正在写一半）
      const flickGone = !!(await until(async () => !(await ns())[N.flick.sid], 6000));
      nreg(N.flick, 'idle');
      const flickBack = !!(await until(async () => !!(await ns())[N.flick.sid], 6000));
      await until(() => Date.now() - tObs >= 6000, 8000);                         // shl2：后台在跑时交付、已经过了 5 秒（还没到后台的 12 秒），后台跑完先写一拍 idle、马上又被叫醒（busy）：从头站稳，不发
      nreg(N.shl2, 'idle', Date.now());
      const shl2Idle = !!(await until(async () => ((await ns())[N.shl2.sid] || {}).status === 'idle', 5000)); nreg(N.shl2, 'busy', Date.now());
      const zHalt = await until(async () => { const x = (await ns())[N.snz.sid]; return x && x.alert && x.alert.kind === 'limit' && x.snooze ? x : null; }, 8000) || {};
      await until(() => sent(N.fresh, 'reply').length && sent(N.flick, 'reply').length && sent(N.asker, 'ask').length, 15000);
      nreg(N.asker, 'waiting', Date.now()); const tRw = Date.now();               // 一直停在选择框上，登记被重写（状态时间变了）：还是同一件
      nreg(N.fresh, 'busy', Date.now()); await sleep(4000); nreg(N.fresh, 'idle', Date.now());   // 发过以后它 busy 了一下又回来，交付还是那一次
      nadd(N.quick, [R.tool(), R.result(), R.final('后台那件也跑完了。\n\n【进展】都好了')]); nreg(N.quick, 'idle', Date.now());
      const zMid = (await ns())[N.snz.sid] || {};
      const zHaltSent = sent(N.snz, 'limit').length;
      nadd(N.snz, [R.peer('win-zz', '额度回来了，接着'), R.tool(), R.result(), R.final('做完了。\n\n【待跟进】回 C 或 D')]);   // 推迟中又交付【待跟进】：叫醒它
      const zhDue = await until(async () => { const x = (await ns())[N.zh.sid]; return x && !x.snooze ? Date.now() : null; }, 10000) || 0;
      await until(() => Date.now() - tRw >= 12000, 14000);
      const askMid = sent(N.asker, 'ask').length;                                 // 重写登记 12 秒以后：要是当成新的一件，多半已经发了第二条（负载高时扫描慢，不靠它，靠下面数总条数）
      nreg(N.asker, 'busy', Date.now()); await sleep(4000); nreg(N.asker, 'waiting', Date.now()); const tW2 = Date.now();   // 离开选择框又停下来等你选：新的一件
      await until(() => sent(N.snz, 'reply').length && sent(N.shl, 'reply').length && sent(N.zh, 'limit').length && sent(N.asker, 'ask').some((l) => tOf(l) >= tW2), 20000);   // 等到新的那一件发出来再数：登记重写要是也算一件，这时一共 3 条
      await sleep(4000);
      const S2 = await ns();
      const fl = sent(N.fresh, 'reply');
      ok(sv('old').digest && sv('old').digest.need === 'reply' && sv('halt').alert && sv('halt').alert.kind === 'limit' && !sent(N.old, 'reply').length && !sent(N.halt, 'limit').length,
        '服务起来时已经是待跟进的、已经停住（额度）的：不发（墙上照常是待跟进 / 停住了）', JSON.stringify({ old: sv('old').digest && sv('old').digest.need, halt: sv('halt').alert, log: nlog() }));
      ok(fl.length === 1 && / dry:sent /.test(fl[0]), '新交付一个【待跟进】：恰好一条（dry:sent；和同一拍的几件合成一条也算）；隔几轮、它 busy 一下又回来（同一次交付）还是一条', JSON.stringify(fl));
      ok(fl.length === 1 && tOf(fl[0]) - tObs >= 4500, '……站稳 5 秒才发：这一条比测试看到它是待跟进晚 ≥ 4.5 秒（' + (fl[0] ? tOf(fl[0]) - tObs : '-') + ' ms）', JSON.stringify(fl));
      ok(sv('quick', S1).digest && sv('quick', S1).digest.need === 'reply' && !sent(N.quick, 'reply').length,
        '交付了【待跟进】、5 秒内又动了（登记变 busy、后台通知叫醒，自动续跑同样）：不发；同一拍交付、没动的 fresh 发了', JSON.stringify(sent(N.quick, 'reply')));
      const sh = sent(N.shl, 'reply');
      ok(sh.length === 1 && tOf(sh[0]) - tObs >= 10000, '交付【待跟进】时后台命令还在跑（shell）：不取消、等得更久（这一条比测试看到它晚 ≥ 10 秒，试验场里等 12 秒、线上 60 秒）', JSON.stringify({ sh, dt: sh[0] ? tOf(sh[0]) - tObs : null }));
      ok(shl2Idle && !sent(N.shl2, 'reply').length, '后台在跑时交付的待跟进、过了 5 秒后后台跑完（idle 一拍）马上又被叫醒：从头站稳 5 秒，不发', JSON.stringify(sent(N.shl2, 'reply')));
      ok(!!sv('late', S2).digest && sv('late', S2).digest.need === 'reply' && !sent(N.late, 'reply').length, '后来才上墙的会话（上墙时已经是待跟进）：不发', JSON.stringify(sent(N.late, 'reply')));
      ok(flickGone && flickBack && sent(N.flick, 'reply').length === 1, '会话登记读坏、一两轮不在墙上又回来：它的【待跟进】照样发一条（不当成没见过的会话）', JSON.stringify({ flickGone, flickBack, l: sent(N.flick, 'reply') }));
      ok(askMid === 1 && sv('asker', S2).status === 'waiting' && sent(N.asker, 'ask').length === 2, '停下来等你选：发一条；一直停着、登记被重写也只一条；离开再停下来是新的一件，第二条（等第二条发出来以后一共恰好 2 条）', JSON.stringify({ askMid, l: sent(N.asker, 'ask') }));
      ok(pz.code === 200 && pz.body.ok && !!zHalt.sid && !!zMid.snooze && zHaltSent === 0 && !sent(N.snz, 'limit').length && limitTok() <= 1,
        '推迟中停住了（额度，卡片照常亮）：不发，站稳以后也不发（alert 行里的 limit 最多一个：是下面到点还停着的 zh）', JSON.stringify({ pz: pz.body, halt: zHalt.alert, snooze: zMid.snooze, l: sent(N.snz, 'limit'), tok: limitTok() }));
      ok(sent(N.snz, 'reply').length === 1 && !sv('snz', S2).snooze, '推迟中又交付了【待跟进】：叫醒它，那一拍发一条', JSON.stringify({ l: sent(N.snz, 'reply'), snooze: sv('snz', S2).snooze }));
      const zl = sent(N.zh, 'limit');
      ok(ph.code === 200 && ph.body.ok && zhDue > 0 && zl.length === 1 && tOf(zl[0]) >= zhDue, '推迟中停住了、到点时还停着：到点以后发一条（推迟中没发、也没记成已知道）', JSON.stringify({ zhDue, zl }));
      ok(pr.code === 200 && pr.body.ok && sv('rz', S2).digest && sv('rz', S2).digest.raised === true && sv('rz', S2).digest.need === 'reply' && !sent(N.rz, 'reply').length,
        '推迟到点、被【进展】盖住的那件翻回待跟进（raised）：不另发（推迟的那件他已经知道）', JSON.stringify({ dg: sv('rz', S2).digest, l: sent(N.rz, 'reply') }));
      ok(pc.code === 200 && pc.body.ok && !sv('zc', S2).snooze && sv('zc', S2).digest.need === 'reply' && !sent(N.zc, 'reply').length,
        '刚交付【待跟进】、还没站稳就推迟：推迟中不发，到点以后也不补发（推迟的就是这一件）', JSON.stringify({ pc: pc.body, snooze: sv('zc', S2).snooze, l: sent(N.zc, 'reply') }));
      // 重启：pend 刚交付【待跟进】、还没站稳就停服务（真时间）。重起以后墙上发过的、停住的、等你选的一个都不重发；pend 那件照发一条（notified.json 记着它上一次是哪件）；
      //       stale 在服务停着时交付了一件 10 分钟前的待跟进（停了很久 / 回滚到不写 notified.json 的旧版）：算旧的，不发
      nadd(N.pend, aged(6000, reply('pend')));
      await until(async () => { const x = (await ns())[N.pend.sid]; return x && x.digest && x.digest.need === 'reply'; }, 8000);
      const n0 = nlog().length;
      await nStop();
      const disk = (() => { try { return JSON.parse(fs.readFileSync(path.join(NDATA, 'notified.json'), 'utf8')); } catch { return null; } })() || {};
      nadd(N.stale, aged(600000, reply('stale')));
      if (!(await nStart())) { ok(false, '[4n] 重起的服务没起来', ''); break n4; }
      const R1 = await until(async () => { try { const S = await ns(); return Object.keys(N).every((n) => S[N[n].sid]) ? S : null; } catch { return null; } }, 15000) || {};
      await until(() => sent(N.pend, 'reply').length, 15000); await sleep(6000);
      const after = nlog().slice(n0);
      ok(Object.keys(R1).length >= 16 && sv('asker', R1).status === 'waiting' && sv('fresh', R1).digest.need === 'reply' && sv('zh', R1).alert && sv('stale', R1).digest.need === 'reply' && after.length === 1 && after[0].split(' ')[3] === 'reply:' + N.pend.sid.slice(0, 8),
        '重启服务：发过的待跟进、停住了、等你选一个都不重发；停着时交付的 10 分钟前的待跟进（stale）不发；重启前刚交付、还没站稳的那件（pend）照发，而且这一条里只有它', JSON.stringify(after));
      ok(disk[N.fresh.sid] === 'reply@' + sv('fresh', S2).resultAt && disk[N.pend.sid] === 'reply@' + sv('pend', S0).resultAt && Object.keys(disk).length >= 16,
        'notified.json：每个见过的会话记着它的待跟进发到了哪一件（fresh = 发过的那次；pend = 停服务时还没发，记的是上一次）', JSON.stringify({ fresh: disk[N.fresh.sid], pend: disk[N.pend.sid], n: Object.keys(disk).length }));
      // 他正看着总控台（轮询带 f=1）：记 ui，不记 sent；文案是「「标题」要你回」+ 要你做的那件事
      nadd(N.seen, [R.human('接着做 seen'), R.tool(), R.result(), R.final('seen 做好了。\n\n【待跟进】回 E 或 F')]);
      const u1 = await until(async () => { await nget('/api/state?peek=1&f=1'); return sent(N.seen, 'reply')[0] || null; }, 15000) || '';
      ok(/ dry:ui /.test(u1) && u1.includes('| 「n-seen」要你回 | 回 E 或 F'), '他正看着总控台时交付【待跟进】：记 dry:ui，不记 sent；标题「「n-seen」要你回」、正文是要你做的那件事', u1);
    }
    await nStop();
  }
  console.log('\n[4p] APNs：假 h2c、公钥验签、设备登记、通知的门、撤销、失效和只读');
  {
    const began = Date.now(), received = [], h2sessions = new Set(), modes = new Map();
    const AP = { keyId: 'ABCDE12345', teamId: 'ZXCVB12345', topic: 'dev.example.remote' };
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const keyFile = path.join(ROOT, 'push-key.b64');
    fs.writeFileSync(keyFile, Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') + '\n', { mode: 0o600 });
    const tokens = ['a1', 'b2', 'c3', 'd4', 'e5'].map((x) => x.repeat(32));
    const ids = ['1', '2', '3', '4'].map((x) => x.repeat(16));
    const secret = crypto.randomBytes(32).toString('base64url'), hash = crypto.createHash('sha256').update(secret).digest('hex');
    const host = 'push-fixture.tailtest.ts.net', login = 'tester@example.com';
    const api = http2.createServer();
    let connections = 0;
    api.on('session', (s) => { connections++; h2sessions.add(s); s.on('close', () => h2sessions.delete(s)); s.on('error', () => {}); });
    api.on('stream', (stream, headers) => {
      let body = ''; stream.on('error', () => {}); stream.setEncoding('utf8'); stream.on('data', (s) => { body += s; });
      stream.on('end', () => {
        const token = String(headers[':path']).split('/').pop(); received.push({ headers, body, token, source: stream.session.socket.localPort, at: Date.now() });
        if (modes.get(token) === 'disconnect') { stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR); return; }
        const drop = modes.get(token) === 'drop'; stream.respond({ ':status': drop ? 410 : 200 }); stream.end(drop ? '{"reason":"Unregistered"}' : '');
      });
    });
    const offApi = http2.createServer(), roApi = http2.createServer();
    for (const extra of [offApi, roApi]) { extra.on('session', (s) => { h2sessions.add(s); s.on('close', () => h2sessions.delete(s)); s.on('error', () => {}); }); extra.on('stream', (...args) => api.emit('stream', ...args)); }
    await Promise.all([api, offApi, roApi].map((srv, i) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT + 380 + i, '127.0.0.1', resolve); })));
    const fixtures = [], idleTimers = [];
    const create = (name, offset, apns, readonly = false) => {
      const h = path.join(ROOT, 'push-' + name), cwd = path.join(h, 'work'), sess = path.join(h, '.claude/sessions');
      const proj = path.join(h, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-')), data = path.join(h, 'data');
      for (const d of [cwd, sess, proj, data]) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ remote: { on: true, hosts: [host] }, ...(apns ? { apns: AP } : {}) }));
      const devFile = path.join(data, 'remote-devices.json');
      fs.writeFileSync(devFile, JSON.stringify({ devices: ids.map((id, i) => ({ id, name: 'Fixture device ' + i, login, hash, at: 1, push: { token: tokens[i], env: i ? 'sandbox' : 'production', at: 1 } })) }), { mode: 0o600 });
      const port = PORT + offset, output = path.join(h, 'server.out'), all = {}, idleFile = path.join(h, 'idle-ms');
      fs.writeFileSync(idleFile, 'fail');
      const reg = (x, status) => fs.writeFileSync(path.join(sess, x.pid + '.json'), JSON.stringify({ pid: x.pid, sessionId: x.sid, cwd, startedAt: began - 600000, kind: 'interactive', entrypoint: 'cli', name: 'PUSH_PRIVATE_NAME_' + x.name, nameSource: 'user', status, statusUpdatedAt: Date.now(), updatedAt: Date.now() }));
      const add = (x, recs) => fs.appendFileSync(x.file, recs.map((r) => JSON.stringify({ ...r, timestamp: new Date().toISOString() })).join('\n') + '\n');
      for (const [i, n] of ['old', 'one', 'two', 'quick', 'snz', 'single', 'seen', 'away', 'unknownA', 'unknownB'].entries()) {
        const c = spawn('/bin/sleep', ['900'], { stdio: 'ignore' }); kids.push(c.pid);
        const x = { name: n, pid: c.pid, sid: 'push' + name.padEnd(2, 'x') + String(i).padStart(2, '0') + '-0000-4000-8000-' + String(c.pid).padStart(12, '0') };
        x.file = path.join(proj, x.sid + '.jsonl'); fs.writeFileSync(x.file, '');
        add(x, [R.human('PUSH_PRIVATE_TITLE_' + n), R.final('初始结果。\n\n' + (n === 'old' || n === 'snz' ? '【待跟进】PUSH_PRIVATE_ASK_INITIAL' : '【进展】先记录'))]); reg(x, 'idle'); all[n] = x;
      }
      const o = fs.openSync(output, 'a');
      const child = spawn(NODE, [SERVER], { env: { ...env, HOME: h, CCBOARD_PORT: String(port), CCBOARD_REMOTE_PORT: String(port + 50), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_DATA: data, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, 'p' + name, 'c.sock'), CCBOARD_STALL_MS: '3600000', CCBOARD_READONLY: readonly ? '1' : '0', CCBOARD_APNS_URL: 'http://127.0.0.1:' + (PORT + 380 + (name === 'off' ? 1 : name === 'ro' ? 2 : 0)), CCBOARD_APNS_KEY_FILE: keyFile, CCBOARD_DEV_RETRY_MS: '300', CCBOARD_IDLE_FILE: idleFile }, stdio: ['ignore', o, o] }); fs.closeSync(o); kids.push(child.pid);
      const f = { child, port, all, reg, add, devFile, output, readonly, idleFile, key: '',
        text: () => fs.readFileSync(output, 'utf8'), devs: () => JSON.parse(fs.readFileSync(devFile, 'utf8')).devices };
      f.local = (method, p, body) => rq(port, method, p, { 'x-ccboard': f.key, origin: 'http://127.0.0.1:' + port }, body);
      f.remote = (index, body, cred = true) => rq(port + 50, 'POST', '/api/remote/push', { host, 'tailscale-user-login': login, origin: 'https://' + host, ...(cred ? { 'x-ccboard-device': ids[index] + '.' + secret } : {}) }, body);
      f.notify = () => f.text().split('\n').filter((x) => x.startsWith('notify ')); fixtures.push(f); return f;
    };
    const stop = async (f) => { if (f.child.exitCode !== null || f.child.signalCode !== null) return; const done = new Promise((r) => f.child.once('exit', r)); if (f.child.pid > 1) f.child.kill('SIGTERM'); await done; };
    const off = create('off', 300, false), on = create('on', 310, true), ro = create('ro', 320, true, true);
    try {
      const up = await until(async () => {
        const r = await Promise.all(fixtures.map(async (f) => { try { f.key = fs.readFileSync(path.join(path.dirname(f.devFile), '.token'), 'utf8').trim(); const v = await f.local('GET', '/api/state?peek=1'); const r = await rq(f.port + 50, 'GET', '/api/state?peek=1', { host, 'tailscale-user-login': login, 'x-ccboard-device': ids[0] + '.' + secret }); return v.code === 200 && v.body.sessions.length === 10 && r.code === 200; } catch { return false; } })); return r.every(Boolean);
      }, 6000);
      ok(up, '[4p] 三份隔离服务起来，假主目录和端口各自独立');
      const offState = await off.local('GET', '/api/state?peek=1'), onState = await on.local('GET', '/api/state?peek=1');
      ok(JSON.stringify(Object.keys(offState.body).sort()) === JSON.stringify(Object.keys(onState.body).sort()), '[4p] 有无 apns 的 state 键完全一样');
      ok(/^push \S+ on：ABCD…$/m.test(on.text()) && !/^push /m.test(off.text()), '[4p] 配置启动行只在配置存在时出现、只露 keyId 前四位');
      const p = async (i, b) => on.remote(i, b);
      const badT = await p(0, { token: tokens[0].toUpperCase(), env: 'production' }), badE = await p(0, { token: tokens[0], env: 'dev' });
      ok(badT.code === 400 && badT.body?.error === 'bad token' && badE.code === 400 && badE.body?.error === 'bad env', '[4p] token / env 错各回 400 和对应错因');
      const noCred = await on.remote(0, { token: tokens[0], env: 'production' }, false);
      ok(noCred.code === 401, '[4p] push 接口走设备凭证第三道');
      const localPush = await on.local('POST', '/api/remote/push', { token: tokens[0], env: 'production' });
      ok([404, 405].includes(localPush.code), '[4p] 本机端口不收 push 登记');
      const changed = await p(1, { token: tokens[1], env: 'production' }), initial = on.devs().find((d) => d.id === ids[1]);
      ok(changed.body?.ok && initial?.push?.env === 'production' && Number.isFinite(initial.push.at) && (fs.statSync(on.devFile).mode & 0o777) === 0o600, '[4p] 登记只改当前设备并存盘，push.at 毫秒、文件 0600');
      const before = fs.statSync(on.devFile), nlines = on.text().split('\n').filter((s) => /^push .* token /.test(s)).length;
      const again = await p(1, { token: tokens[1], env: 'production' });
      ok(again.body?.ok && fs.statSync(on.devFile).mtimeMs === before.mtimeMs && fs.statSync(on.devFile).ino === before.ino && on.text().split('\n').filter((s) => /^push .* token /.test(s)).length === nlines, '[4p] 重复登记不写盘、不刷新 at、不多记 token 行');
      const clear = await p(1, { token: null });
      ok(clear.body?.ok && !on.devs().find((d) => d.id === ids[1])?.push && new RegExp('^push \\S+ token ' + ids[1] + ' cleared$', 'm').test(on.text()), '[4p] null 清令牌并记 cleared');
      const move = await p(1, { token: tokens[0], env: 'sandbox' });
      ok(move.body?.ok && !on.devs().find((d) => d.id === ids[0])?.push && on.devs().find((d) => d.id === ids[1])?.push?.token === tokens[0], '[4p] 同 token 迁到这台，旧设备 push 消失');
      await p(0, { token: tokens[0], env: 'production' }); await p(1, { token: tokens[1], env: 'sandbox' });
      fs.mkdirSync(on.devFile + '.tmp');
      const saveFail = await p(1, { token: tokens[4], env: 'sandbox' });
      ok(saveFail.body?.ok === false && saveFail.body?.error === 'save', '[4p] 存盘失败回 save，服务继续运行');
      fs.rmdirSync(on.devFile + '.tmp');
      await until(() => on.devs().find((d) => d.id === ids[1])?.push?.token === tokens[4], 1500);
      ok(on.devs().find((d) => d.id === ids[1])?.push?.token === tokens[4], '[4p] 存盘失败内存照改，devDirty 自动补写');
      await p(1, { token: tokens[1], env: 'sandbox' });
      const roDisk = fs.readFileSync(ro.devFile, 'utf8'), roWrite = await ro.remote(0, { token: null });
      ok(roWrite.code === 403 && fs.readFileSync(ro.devFile, 'utf8') === roDisk, '[4p] 只读不登记、不改设备表');
      for (const f of fixtures) {
        const state = (await f.local('GET', '/api/state?peek=1')).body;
        const x = state.sessions?.find((s) => s.sid === f.all.snz.sid);
        if (!f.readonly) await f.local('POST', '/api/snooze', { sid: f.all.snz.sid, at: x?.resultAt, until: Date.now() + 3600000 });
        for (const n of ['one', 'two', 'quick']) f.add(f.all[n], [R.human('新任务'), R.final('完成。\n\n【待跟进】PUSH_PRIVATE_ASK_NEW_' + n)]);
        f.reg(f.all.quick, 'busy');
        if (!f.readonly) f.add(f.all.snz, [R.peer('Fixture peer', '继续'), R.tool(), R.apiErr('rate_limit', 'Fixture limit')]);
      }
      modes.set(tokens[2], 'drop'); modes.set(tokens[3], 'disconnect');
      await until(() => on.notify().some((l) => /dry:sent/.test(l)) && off.notify().length > 0, 11000);
      await until(() => /^push .* sent /m.test(on.text()), 1500);
      const first = received.slice();
      ok(off.notify().some((l) => /dry:sent/.test(l)) && !/^push /m.test(off.text()) && received.every((r) => r.source !== PORT + 381), '[4p] 没配 apns 照常 notify、零 push 日志、零该服务 APNs 请求');
      ok(first.length === 4 && tokens.slice(0, 4).every((t) => first.filter((r) => r.token === t).length === 1), '[4p] 首批每台有令牌设备恰好一个请求（无配置、只读、基线、quick、推迟均未多发）', 'requests=' + first.length);
      const parse = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
      ok(first.length === 4 && first.every((r) => parse(r).aps?.alert?.['loc-key'] === 'PUSH_WAIT_MANY' && JSON.stringify(parse(r).aps?.alert?.['loc-args']) === '["2"]' && !('sid' in parse(r))), '[4p] 两件合批：WAIT_MANY、数量 2、不带 sid');
      const jwtOK = (r) => { try { const raw = r.headers.authorization; if (!raw.startsWith('bearer ')) return false; const [a, b, c] = raw.slice(7).split('.'); const h = JSON.parse(Buffer.from(a, 'base64url')), j = JSON.parse(Buffer.from(b, 'base64url')); return h.alg === 'ES256' && h.kid === AP.keyId && j.iss === AP.teamId && j.iat <= Date.now() / 1000 && j.iat >= began / 1000 - 1 && crypto.verify('sha256', Buffer.from(a + '.' + b), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(c, 'base64url')); } catch { return false; } };
      ok(first.length === 4 && first.every((r) => r.headers[':method'] === 'POST' && r.headers[':path'] === '/3/device/' + r.token && r.headers['apns-topic'] === AP.topic && r.headers['apns-push-type'] === 'alert' && r.headers['apns-priority'] === '10' && Number(r.headers['apns-expiration']) >= began / 1000 + 3599 && Number(r.headers['apns-expiration']) <= Date.now() / 1000 + 3600 && jwtOK(r)), '[4p] APNs 路径、请求头、1 小时过期、公钥验 JWT 全对');
      ok(!on.devs().find((d) => d.id === ids[2])?.push && on.text().split('\n').filter((l) => new RegExp('^push \\S+ drop ' + ids[2] + ' ' + tokens[2].slice(0, 8) + ' 410 Unregistered$').test(l)).length === 1, '[4p] 410 删除当前 push、存盘，drop 恰好一行');
      ok(on.text().split('\n').filter((l) => new RegExp('^push \\S+ err ' + ids[3] + ' ').test(l)).length === 1 && first.filter((r) => r.token === tokens[3]).length === 1, '[4p] 断开只记一次 err、只请求一次、不重试');
      ok(/^push \S+ sent 2\/4 PUSH_WAIT_MANY$/m.test(on.text()), '[4p] 首批汇总成功 2/4 和 KEY');
      ok(!/^push .* (sent|token|drop|err) /m.test(ro.text()) && received.every((r) => r.source !== PORT + 382) && fs.readFileSync(ro.devFile, 'utf8') === roDisk, '[4p] 只读不发推送、不改令牌');
      const revoke = await on.local('POST', '/api/remote/revoke', { id: ids[0] });
      await p(3, { token: null });
      fs.unlinkSync(keyFile);
      on.add(on.all.single, [R.human('单件'), R.final('完成。\n\n【待跟进】PUSH_PRIVATE_ASK_SINGLE')]);
      // 新场景的站稳等待与 single 重叠；各事件隔 3.7 秒，超过 2.5 秒合批窗。
      for (const [i, n] of ['seen', 'away', 'unknownA', 'unknownB'].entries()) idleTimers.push(setTimeout(() => {
        on.add(on.all[n], [R.human('空闲场景 ' + n), R.final('完成。\n\n【待跟进】PUSH_PRIVATE_ASK_' + n)]);
      }, 4000 + i * 3700));
      await until(() => on.notify().length >= 2, 11000); await until(() => received.length > first.length, 1000); await sleep(500);
      const second = received.slice(first.length);
      ok(revoke.body?.ok && !on.devs().some((d) => d.id === ids[0]) && second.length === 1 && second[0].token === tokens[1], '[4p] 撤销设备令牌不再收，410 下一件也不再收，另一台照收', 'requests=' + second.length);
      ok(second.length === 1 && parse(second[0]).sid === on.all.single.sid && parse(second[0]).aps?.alert?.['loc-key'] === 'PUSH_REPLY_ONE' && !('loc-args' in parse(second[0]).aps.alert), '[4p] 单件有对应 sid、REPLY_ONE、不带 loc-args');
      ok(second.length === 1 && second[0].headers.authorization === first[0]?.headers.authorization && connections === 1, '[4p] 删除测试密钥文件后仍可发：密钥/JWT 缓存、每主机一条 h2 连接复用');
      const countBeforeUI = received.length;
      fs.writeFileSync(on.idleFile, '0');
      const focusedFlush = async (n) => {
        const done = await until(async () => { await on.local('GET', '/api/state?peek=1&f=1'); return on.notify().length >= n; }, 11000);
        await sleep(200); return done;
      };
      await focusedFlush(3);
      ok(on.notify().some((l) => /dry:ui/.test(l)) && received.length === countBeforeUI, '[4p] f=1 看着 Mac：notify dry:ui，手机零请求');
      const expected = on.notify().filter((l) => /dry:sent/.test(l));
      ok(expected.length === 2 && received.length === 5 && received.filter((r) => r.token === tokens[3]).length === 1, '[4p] 隔多拍仍只对应两批 dry:sent，每设备每批一次，网络错无延迟重试');
      ok(received.length === countBeforeUI && !/idle-unknown/.test(on.text()), '[4p] 空闲 0：f=1 手机零请求、f 旧时未读取 fail 夹具');
      fs.writeFileSync(on.idleFile, '180000');
      const beforeAway = received.length, awayFlush = await focusedFlush(4);
      const away = received.slice(beforeAway);
      ok(awayFlush && away.length === 1 && away[0].token === tokens[1] && parse(away[0]).sid === on.all.away.sid && /dry:ui/.test(on.notify()[3] || ''), '[4p] 空闲 180000：f=1 假 APNs 恰好一条、Mac 仍 dry:ui', 'requests=' + away.length);
      fs.writeFileSync(on.idleFile, 'fail');
      const beforeUnknown = received.length, unknown1 = await focusedFlush(5), unknown2 = await focusedFlush(6);
      ok(unknown1 && unknown2 && received.length === beforeUnknown && on.text().split('\n').filter((l) => /^push \S+ idle-unknown /.test(l)).length === 1, '[4p] 空闲 fail：f=1 连续两次 flush 零请求、idle-unknown 恰好一行');
      const forbidden = ['PUSH_PRIVATE_TITLE_', 'PUSH_PRIVATE_NAME_', 'PUSH_PRIVATE_ASK_'];
      ok(received.length > 0 && received.every((r) => forbidden.every((w) => !r.body.includes(w))), '[4p] 每条正文均无会话标题、登记名和待跟进后面的字');
      ok(tokens.every((t) => !fixtures.some((f) => f.text().includes(t))) && /^remote .* act .* POST \/api\/remote\/push$/m.test(on.text()), '[4p] 完整 token 不进日志，远程 act 行照旧');
    } finally {
      for (const timer of idleTimers) clearTimeout(timer);
      await Promise.all(fixtures.map(stop)); for (const s of h2sessions) s.destroy(); await Promise.all([api, offApi, roApi].map((srv) => new Promise((r) => srv.close(r))));
    }
    const elapsed = Date.now() - began; console.log('[4p] 墙钟 ' + elapsed + ' ms');
    ok(elapsed <= 40000, '[4p] 整段墙钟 ≤ 40 秒', elapsed + ' ms');
  }
  console.log('\n[10-0] 手机远程：config 里没有 remote（这一趟的主服务）→ 远程端口没人听；4747 和以前一样，只多拒带代理头的请求');
  {
    const TSN = 'ccb-r1.tail1a2b.ts.net', LG = 'khalil@example.com';
    const x1 = await rq(PORT, 'GET', '/health', { host: TSN, 'tailscale-user-login': LG });
    const x2 = await rq(PORT, 'GET', '/api/state?peek=1', { host: TSN, 'tailscale-user-login': LG, 'x-ccboard': TOKEN });
    const x3 = await rq(PORT, 'GET', '/', { host: TSN, 'tailscale-user-login': LG });
    const s0 = await get('/api/state?peek=1');
    const x4 = await post('/api/remote/pair', {});
    const x5 = await rq(PORT, 'GET', '/api/remote/devices', { 'x-ccboard': TOKEN });
    const x6 = await rq(PORT, 'GET', '/health', { 'tailscale-user-login': LG, 'x-forwarded-for': '203.0.113.2' });
    const x7 = await rq(PORT, 'GET', '/api/state?peek=1', { 'x-ccboard': TOKEN, 'x-forwarded-proto': 'https' }), x8 = await rq(PORT + 50, 'GET', '/', { host: TSN, 'tailscale-user-login': LG });
    const lg0 = fs.readFileSync(path.join(ROOT, 'server.out'), 'utf8');
    ok(x1.code === 403 && x1.body && x1.body.error === 'bad host' && x2.code === 403 && x3.code === 403 && x6.code === 403 && x6.body.error === 'bad host' && x7.code === 403 && x8.code === 0 && /ECONNREFUSED/.test(x8.text), '没有 remote：*.ts.net 的 Host（带登录头、带口令都一样）→ 403 bad host；本机 Host 带着代理头（tailscale-* / x-forwarded-*）也 403（serve 指错到 4747 也拿不到本机权限）；远程端口（这一趟是 端口+50）没人听', JSON.stringify([x1.code, x1.body, x2.code, x3.code, x6.code]));
    ok(!('remote' in s0) && x4.code === 404 && x4.body.error === 'not found' && x5.code === 405 && !/^remote /m.test(lg0) && !fs.existsSync(path.join(DATA, 'remote-devices.json')), '没有 remote：/api/state 没有 remote 键、配对接口和以前的未知路径一样（POST 404 / GET 405）、日志里没有 remote 行、不建设备表', JSON.stringify([('remote' in s0), x4.code, x5.code]));
  }
  console.log('\n[8] config.json 写坏了：照常起来、记一行日志、用默认值（空项目表；自动点信任和 Codex 都关着）');
  clearArgv(); const n8 = await post('/api/new', { prompt: 'PW-8 服务重启以后还在', cwd: CWD, provider: 'claude' }); await readArgv();
  const nm8 = n8.body.name, s8 = Number(tmw(nm8, 'display', '-p', '#{pid}').stdout.trim()) || 0;
  // R5：主服务停下后删一条记录、造日志；下一台复用现有重启点。
  process.kill(srv.pid, 'SIGTERM');
  for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + PORT + '/health'); } catch { break; } }
  await sleep(500);
  const w8 = s8 ? Number(psOf(s8).split(/\s+/)[0]) || 0 : 0;
  ok(n8.body.ok && s8 && tmw(nm8, 'has-session', '-t', nm8).status === 0 && w8 && /ccb-watch/.test(psOf(w8)), '服务停了（上线时 ./build.sh update 就是这样重启它）：新窗口那台 tmux 和它的看护都还在', JSON.stringify({ n8: n8.body, s8, w8: w8 && psOf(w8).slice(0, 80) }));
  const restoreSpawnFile = path.join(DATA, 'spawn.json');
  const restoreSpawns = JSON.parse(fs.readFileSync(restoreSpawnFile, 'utf8'));
  delete restoreSpawns[nm8]; fs.writeFileSync(restoreSpawnFile, JSON.stringify(restoreSpawns));
  mk('restoreTwin', 'busy', [R.human('示例重名前缀')]);
  const twinReg = path.join(SESS, S.restoreTwin.pid + '.json'), twinJ = JSON.parse(fs.readFileSync(twinReg, 'utf8'));
  twinJ.sessionId = S.peerDone.sid.slice(0, 8) + '-0000-4000-8000-000000000999'; fs.writeFileSync(twinReg, JSON.stringify(twinJ));
  const restoreTime = (name) => Number(tmw(name, 'display', '-p', '#{session_created}').stdout.trim()) * 1000;
  const restoreLine = (name, sid, at = restoreTime(name)) => 'spawn ' + new Date(at).toISOString() + ' ' + name + ' ' + sid.slice(0, 8) + ' from';
  fs.writeFileSync(path.join(DATA, 'server.log'), [
    restoreLine(nm8, S.unfin.sid), restoreLine(nm8, S.run.sid),
    restoreLine(RESTORE_NAMES[0], 'unknown0'), restoreLine(RESTORE_NAMES[1], S.run.sid, restoreTime(RESTORE_NAMES[1]) - 180000),
    restoreLine(RESTORE_NAMES[2], S.peerDone.sid), restoreLine('ccb-not-on-wall', S.run.sid, Date.now())
  ].join('\n') + '\n');
  mk('atOff', 'idle', aged(3 * H, [R.peer('win-f2', '验收过了'), R.tool('Edit'), R.result(), R.final('已合入。')]), { statusAgo: 3 * H, claude: true });      // fyi 超线 3 小时：autoTidy 默认关，就一动不动
  fs.writeFileSync(path.join(DATA, 'config.json'), '{ 写坏了');
  const log2File = path.join(ROOT, 'server2.out'); const out2 = fs.openSync(log2File, 'w');
  // 留着的归档：线调成 1 小时。旧会话两小时前归档 → 清；tidyWork 几分钟前归档 → 不清；done 登记成两小时前归档、进程却还在跑 → 不清
  env.CCBOARD_KEEP_TMP_MS = String(H);
  env.CCBOARD_LSOF = path.join(BIN, 'lsof-fast'); env.CCBOARD_PS = path.join(BIN, 'ps-slow');     // 认调用方：ps 很慢、要往上走 15 层（见 BIN 那里的说明）
  const arcFile = path.join(DATA, 'archive.json'), arcJ = JSON.parse(fs.readFileSync(arcFile, 'utf8'));
  for (const [sid, title] of [[OLD_SID, '两小时前归档的'], [S.done.sid, '归档了却又在跑的']]) arcJ.items[sid] = { sid, title, cwd: CWD, state: 'archived', archivedAt: Date.now() - 2 * H };
  fs.writeFileSync(arcFile, JSON.stringify(arcJ));
  const srv2 = spawn(NODE, [SERVER], { env, stdio: ['ignore', out2, out2] }); kids.push(srv2.pid);
  let up = false; for (let i = 0; i < 50 && !up; i++) { await sleep(200); try { up = (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).ok === true; } catch {} }
  const cfgLines = () => fs.readFileSync(log2File, 'utf8').split('\n').filter((l) => l.startsWith('config '));
  ok(fs.readFileSync(path.join(ROOT, 'server.out'), 'utf8').split('\n').some((l) => l.startsWith('tmux ') && l.endsWith(' -S ' + TSOCK)), '服务启动时记一行它用的 tmux 套接字：就是测试给的 CCBOARD_TMUX_SOCKET（-S 绝对路径），不是 -L');
  ok(up && cfgLines().length === 1 && /读不了/.test(cfgLines()[0]), '写坏的 config：服务照常起来，日志里只有一行说明', cfgLines().join(' | '));
  await sleep(3000); st = await get('/api/state');
  ok((st.pending || []).some((x) => x.name === nm8), '重起的服务照样枚举 tmux/ 下各窗口自己的套接字：服务停着时开着的那个窗口还认得（在「启动中」里）', JSON.stringify((st.pending || []).map((x) => x.name)));
  const restoredSpawns = JSON.parse(fs.readFileSync(restoreSpawnFile, 'utf8'));
  const restoreLog = fs.readFileSync(log2File, 'utf8').split('\n').filter((l) => l.startsWith('spawn-restore '));
  ok(restoredSpawns[nm8] && restoredSpawns[nm8].by === S.run.sid && restoredSpawns[nm8].at === restoreTime(nm8) && restoreLog.filter((l) => l.includes(' ' + nm8 + ' ')).length === 1, 'R5 重启按日志最后一行补回活窗口，完整 sid/时间落盘且只记一次日志', JSON.stringify({ entry: restoredSpawns[nm8], restoreLog }));
  ok(!restoredSpawns[RESTORE_NAMES[0]] && !restoredSpawns[RESTORE_NAMES[1]] && !restoredSpawns[RESTORE_NAMES[2]] && !restoredSpawns['ccb-not-on-wall'], 'R5 守卫：sid 不存在、开窗时间不符、sid8 不唯一、不在墙上的都不补', JSON.stringify(restoredSpawns));
  ok((histNow().other || []).some((x) => x.sid === S.unfin.sid) && on(st, 'histRecv').via === 'msg' && on(st, 'histRecv').handed === true && on(st, 'histRecv').boss === st.org.chief, 'history: 复用坏 config 重启点读回历任，归档前任的队伍仍跟当前岗位（默认总管）', JSON.stringify(on(st, 'histRecv')));
  const t8 = tmpHas(), tl8 = fs.readFileSync(log2File, 'utf8').split('\n').filter((x) => x.startsWith('tmp '));
  ok(!t8.old && t8.work && t8.live && t8.notes && tl8.length === 1 && tl8[0].includes(OLD_SID.slice(0, 8)), 'tmp: 留着的归档满了线（这里 1 小时）才清；没满线的、归档了却又在跑的、名字不是会话号的都不碰；日志恰好一行', JSON.stringify({ t8, tl8 }));
  ok(st.providers && !st.providers.codex && !st.sessions.some((x) => x.provider === 'codex') && !(st.pending || []).some((x) => x.name === CDX), 'codex 关着：「交给谁」里没有 Codex；Codex 会话不上墙，也不当成「启动中」', JSON.stringify({ prov: Object.keys(st.providers || {}), codex: st.sessions.filter((x) => x.provider === 'codex').length, pend: (st.pending || []).map((x) => x.name) }));
  n1 = await post('/api/new', { prompt: '用 Codex 做', cwd: '~', provider: 'codex', model: 'bad model!' });
  ok(!n1.body.ok && /Codex 没有打开/.test(n1.body.error || ''), 'codex 关着：接口拒绝开 Codex 会话（在核对模型名之前）', JSON.stringify(n1.body));
  ok(st.limits && st.limits.codex === null && st.limits.claude.length === 2, 'codex 关着：顶栏没有 Codex 额度（rollout 还在磁盘上也不读）；Claude 的照常', JSON.stringify(st.limits && { codex: st.limits.codex, claude: (st.limits.claude || []).length }));
  const pj8 = (n) => ((by(st, n) || {}).project || {});
  ok(pj8('projC').key === 'other' && /^dir:fretflow/.test(pj8('projF').key || ''), '默认项目表是空的：登记过的组名不再出现，碰过的文件夹自成一组', JSON.stringify([pj8('projC'), pj8('projF')]));
  try { fs.unlinkSync(trustFile); } catch {}
  n1 = await post('/api/new', { prompt: 'TRUSTME 关着', cwd: '~', provider: 'claude' });
  await sleep(6000); st = await get('/api/state');
  const pend8 = (st.pending || []).find((x) => x.name === n1.body.name);
  ok(trustNow() === null && pend8 && pend8.dialog && pend8.dialog.options[1] === 'Yes, I trust this folder', 'autoTrust 关着：信任框留在「启动中」卡片上给他选', JSON.stringify(pend8 && pend8.dialog));
  clearArgv(); const t8s = Date.now(); n1 = await post('/api/new', { prompt: '认人很慢', cwd: CWD, provider: 'claude' }); const dt8 = Date.now() - t8s; await readArgv();
  ok(n1.body.ok && !('by' in n1.body) && dt8 < 3000 && !fs.readFileSync(log2File, 'utf8').split('\n').some((x) => x.startsWith('spawn ')), '认调用方很慢（ps 每次 0.3 秒、要走 15 层）：1.5 秒就放弃，/api/new 照常成功、不记（' + dt8 + ' ms）', JSON.stringify(n1.body) + ' ' + dt8 + ' ms');
  const arc8 = await get('/api/archive');
  ok(by(st, 'atOff') && !arc8.items.some((x) => x.sid === S.atOff.sid) && !fs.readFileSync(log2File, 'utf8').split('\n').some((x) => x.startsWith('tidy ')), 'autoTidy 默认关：超线 3 小时的 fyi 也一动不动，日志里没有 tidy', JSON.stringify([!!by(st, 'atOff'), arc8.items.length]));

  console.log('\n[8b] config 的 defaultAccount（总管 11/17 17:3x）：没选账号的新任务按它包；写的不是登记过的号就整份 config 不用');
  // 换两次 config 各重起一次服务（同一个端口、同一个数据目录）：先写一个没登记的号，再写 good
  let srvB = srv2;
  const restartB = async (cfg, log) => {
    try { process.kill(srvB.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 25; i++) { await sleep(200); try { await fetch('http://127.0.0.1:' + PORT + '/health'); } catch { break; } }
    await sleep(300);
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cfg));
    const o = fs.openSync(path.join(ROOT, log), 'w'); srvB = spawn(NODE, [SERVER], { env, stdio: ['ignore', o, o] }); kids.push(srvB.pid);
    let u = false; for (let i = 0; i < 50 && !u; i++) { await sleep(200); try { u = (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).ok === true; } catch {} }
    return u ? fs.readFileSync(path.join(ROOT, log), 'utf8').split('\n').filter((l) => l.startsWith('config ')).join(' | ') : null;
  };
  const cfgB = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-config.json'), 'utf8')), accB = [{ id: 'good', name: '旧号' }, { id: 'none', name: '还没存 token 的号' }];
  let cB = await restartB({ ...cfgB, accounts: accB, defaultAccount: 'nobody' }, 'server3.out');
  ok(cB && /读不了.*defaultAccount/.test(cB), 'defaultAccount 写了没登记的号：整份 config 不用，日志一行说清（不悄悄退回钥匙串当前登录的号）', String(cB));
  cB = await restartB({ ...cfgB, accounts: accB, judgeAccount: 'nobody' }, 'server3j.out');
  ok(cB && /读不了.*judgeAccount/.test(cB), 'judgeAccount 写了没登记的号：整份 config 不用，日志一行说清（同 defaultAccount 的规矩）', String(cB));
  cB = await restartB({ ...cfgB, accounts: accB, defaultAccount: 'good' }, 'server4.out');
  ok(cB && /accounts=2，defaultAccount=good，/.test(cB), 'defaultAccount=good：config 用上了，日志里写着', String(cB));
  let pB = null; for (let i = 0; i < 20 && !(pB && (pB.accounts || []).length); i++) { await sleep(200); pB = ((await get('/api/state')).providers || {}).claude; }
  ok(pB && pB.defaultAccount === 'good', '/api/state 的 providers.claude.defaultAccount 是 good（界面「默认」那一项写它的名字）', JSON.stringify(pB && { d: pB.defaultAccount, n: (pB.accounts || []).length }));
  for (const [extra, what] of [[{}, '接口没传 account'], [{ account: '' }, '界面选「默认」（account 是空串）']]) {
    clearArgv(); clearEnv(); n1 = await post('/api/new', { prompt: '默认号做', cwd: CWD, provider: 'claude', ...extra }); got = await readArgv(); envNow = await readEnv();
    ok(n1.body.ok && n1.body.account === 'good' && envNow === 'tok-good|good', what + '：按 defaultAccount 包，会话里是 good 的 token，应答回 account', JSON.stringify(n1.body) + ' ' + envNow);
  }
  clearArgv(); clearEnv(); n1 = await post('/api/new', { prompt: 'x', cwd: CWD, provider: 'claude', account: 'none' });
  ok(!n1.body.ok && /token/.test(n1.body.error), '设了 defaultAccount，明说的号照旧优先：选了没 token 的号照样不开', JSON.stringify(n1.body));
  ok(/^account \S+ \S+ good default$/m.test(fs.readFileSync(path.join(ROOT, 'server4.out'), 'utf8')), '服务日志 account 那一行标 default（默认号顶上的，不是调用方选的）');

  console.log('\n[8c] config 的 accountFallback（11/22 作者：「我之后新建的任务开到主号」；总管 win-4c：主号真到顶才退回朋友号）：界面新建、没明说账号的开默认号，默认号这周或这 5 小时到 95% 才退；接口不带 account 的保持现状；明说的照明说的');
  // 情形照 4c 列的：界面新建（带 Origin、account 空串）、主号高于以前的读数、主号到顶、5 小时到顶、接口带 account、接口不带 account、重置以后、没有读数；
  // 审查加的：退回的号自己也到了 toMax、退回的号没 token、写错只关这一项、试验服务不往数据目录外面写退回记录
  const FB_NOTE = path.join(DATA, 'fb-note.md'), FB_OUT = path.join(ROOT, 'fb-out.md'), FB_TAP = path.join(DATA, 'limits', 'claude-acctfb01-0001.json'), FB_TAP2 = path.join(DATA, 'limits', 'claude-acctfb02-0002.json');
  const accC = [{ id: 'good', name: '主号' }, { id: 'spare', name: '朋友号' }, { id: 'none', name: '还没存 token 的号' }];
  const fbTapOf = (file, sess, account, week, five, weekReset = Date.now() + 2 * 86400000) => fs.writeFileSync(file, JSON.stringify({ v: 1, at: Date.now(), session: sess, account, rate_limits: { five_hour: { used_percentage: five, resets_at: Math.floor((Date.now() + 3 * 3600000) / 1000) }, seven_day: { used_percentage: week, resets_at: Math.floor(weekReset / 1000) } } }));
  const fbTap = (week, five, weekReset) => fbTapOf(FB_TAP, 'acctfb01-0001', 'good', week, five, weekReset);
  const fbSeen = async (pred, who = 'good') => { for (let i = 0; i < 30; i++) { const c = (((await get('/api/state')).limits || {}).claude || []).find((x) => x.account === who); if (pred(c)) return true; await sleep(300); } return false; };
  const wkOf = (c, k) => ((c && c.windows) || []).find((w) => w.key === k);
  const postUi = async (p, body) => { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: 'POST', headers: { 'x-ccboard': TOKEN, 'content-type': 'application/json', origin: 'http://127.0.0.1:' + PORT }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };
  const fbNew = async (extra, ui) => { clearArgv(); clearEnv(); const r = await (ui ? postUi : post)('/api/new', { prompt: '分号规则', cwd: CWD, provider: 'claude', ...extra }); await readArgv(); return { body: r.body, env: await readEnv() }; };
  const fbLines = (log) => fs.readFileSync(path.join(ROOT, log), 'utf8').split('\n').filter((l) => l.startsWith('account '));
  const fbNoteLines = (f = FB_NOTE) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  for (const f of [FB_NOTE, FB_OUT, FB_TAP, FB_TAP2]) { try { fs.unlinkSync(f); } catch {} }
  cB = await restartB({ ...cfgB, accounts: accC, defaultAccount: 'good', accountFallback: { to: 'spare', at: 95, toMax: 78, note: FB_NOTE } }, 'server8c.out');
  ok(cB && /accounts=3，defaultAccount=good，/.test(cB) && /accountFallback=spare@95%，/.test(cB), 'accountFallback 写对：config 用上了，启动行写着退到哪个号、多少算到顶', String(cB));
  fbTap(77, 20); ok(await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 77), '夹具：主号（good）周 77% 的读数进了 limits');
  let f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body) && f8.env === 'tok-good|good', '界面新建（带 Origin、account 空串），主号 77%：开主号，应答不带 fallback', JSON.stringify(f8));
  fbTap(90, 20); await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 90);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body), '界面新建，主号 90%：照开主号（没有「过了某个读数就分流」）', JSON.stringify(f8.body));
  fbTap(96, 20); await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 96);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'spare' && f8.body.fallback && f8.body.fallback.from === 'good' && f8.body.fallback.key === 'week' && f8.body.fallback.used === 96 && f8.env === 'tok-spare|spare', '主号周 96%（到顶）：界面新建的退回朋友号，会话里是 spare 的 token，应答带 fallback（从哪个号、哪个窗口、读数）', JSON.stringify(f8));
  const fbName1 = f8.body.name;
  ok(fbLines('server8c.out').some((l) => new RegExp('^account \\S+ ' + fbName1 + ' spare default fallback good week 96%$').test(l)), '日志 account 那一行写明是退回的：spare default fallback good week 96%', JSON.stringify(fbLines('server8c.out')));
  let nl = fbNoteLines();
  ok(nl.length === 1 && nl[0].includes(fbName1) && /默认号 good 周额度 96%（到了 95%）/.test(nl[0]) && /开在 spare/.test(nl[0]) && /重置后回到 good/.test(nl[0]), '退回时往 note 文件追加一行（给总管看）：哪个号、读数、从哪个窗口起、几点重置', JSON.stringify(nl));
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'spare' && fbNoteLines().length === 1, '再从界面新建一个、主号仍到顶：一样退回；同一个额度窗口 note 只写一次', JSON.stringify([f8.body, fbNoteLines().length]));
  f8 = await fbNew({});
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body), '接口不带 account（不带 Origin）、主号到顶：保持现状，照开默认号（主号），不退', JSON.stringify(f8.body));
  f8 = await fbNew({ account: 'good' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body) && f8.env === 'tok-good|good', '界面里明说选了 good：主号到顶也照明说的开主号，不退', JSON.stringify(f8));
  f8 = await fbNew({ account: 'none' });
  ok(!f8.body.ok && /token/.test(f8.body.error || ''), '明说的号没 token：照旧报错不开，不悄悄退回', JSON.stringify(f8.body));
  fbTapOf(FB_TAP2, 'acctfb02-0002', 'spare', 80, 10); await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 80, 'spare');
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body) && fbLines('server8c.out').some((l) => /^account \S+ - 默认号 good 周额度 96%，该退回的 spare 周额度也到了 80%（线 78%），照旧开 good$/.test(l)) && fbNoteLines().length === 2 && /该退回的 spare 周额度也到了 80%/.test(fbNoteLines()[1]), '主号到顶、朋友号自己也到了 toMax（78%）：不退，照旧开主号，日志和 note 各写明', JSON.stringify([f8.body, fbNoteLines()]));
  try { fs.unlinkSync(FB_TAP2); } catch {} await fbSeen((c) => !c, 'spare');
  fbTap(60, 97); await fbSeen((c) => wkOf(c, 'five_hour') && wkOf(c, 'five_hour').used === 97);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'spare' && f8.body.fallback && f8.body.fallback.key === 'five_hour' && f8.body.fallback.used === 97 && fbNoteLines().length === 3, '主号周 60%、5 小时 97%：也退回（开出来马上就卡额度），note 多一行', JSON.stringify([f8.body, fbNoteLines()]));
  fbTap(99, 20, Date.now() - 60000); await fbSeen((c) => !wkOf(c, 'week'));
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body), '重置以后：周 99% 那个窗口过了截止时间，读数作废，回到主号', JSON.stringify(f8.body));
  try { fs.unlinkSync(FB_TAP); } catch {} await fbSeen((c) => !c);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good', '主号没有读数（没有窗口说过话）：开主号', JSON.stringify(f8.body));
  cB = await restartB({ ...cfgB, accounts: accC, defaultAccount: 'good', accountFallback: { to: 'none' } }, 'server8c2.out');
  fbTap(96, 20); await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 96);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && fbLines('server8c2.out').some((l) => /^account \S+ - 默认号 good 周额度 96%，该退回 none，但它钥匙串里没有 token，照旧开 good$/.test(l)), '该退回的号钥匙串里没 token：照旧开主号，不因为退不了就不开，日志说清', JSON.stringify([f8.body, fbLines('server8c2.out')]));
  cB = await restartB({ ...cfgB, accounts: accC, defaultAccount: 'good', accountFallback: { to: 'spare', note: FB_OUT } }, 'server8c2b.out');
  await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 96);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'spare' && !fs.existsSync(FB_OUT) && fbLines('server8c2b.out').some((l) => /^account \S+ - 试验服务只往自己的数据目录里写退回记录，不写 /.test(l)), '试验服务的 note 指到数据目录外面（像拿真 config 拷贝起的）：照样退回，但不往那个文件写，日志说清', JSON.stringify([f8.body, fs.existsSync(FB_OUT), fbLines('server8c2b.out')]));
  cB = await restartB({ ...cfgB, accounts: accC, defaultAccount: 'good', accountFallback: { to: 'spare', notes: FB_NOTE } }, 'server8c3.out');
  ok(cB && /accountFallback 不用（不认识的键：notes）/.test(cB) && /accounts=3，defaultAccount=good，/.test(cB) && /accountFallback=无，/.test(cB), 'accountFallback 写错（note 拼成 notes）：只关这一项、日志说清，别的键照用（不像 defaultAccount 写错那样整份不用）', String(cB));
  await fbSeen((c) => wkOf(c, 'week') && wkOf(c, 'week').used === 96);
  f8 = await fbNew({ account: '' }, true);
  ok(f8.body.ok && f8.body.account === 'good' && !('fallback' in f8.body), 'accountFallback 写错时界面新建、主号 96% 也照开主号（和没这一项一样）', JSON.stringify(f8.body));
  for (const f of [FB_TAP, FB_TAP2]) { try { fs.unlinkSync(f); } catch {} }
  cB = await restartB({ ...cfgB, accounts: accB, defaultAccount: 'good' }, 'server8c4.out');   // 还原成 [8b] 结尾的样子，后面几段照旧

  console.log('\n[9] 不改脑子（P0-2）：这一整趟里总控台起的每个 Claude 会话，参数只有模型、强度、--resume 和任务原文；假主目录里的 CLAUDE.md / AGENTS.md / settings / .claude.json 一个没动');
  // 白名单，不是黑名单：--append-system-prompt、--system-prompt、--disallowedTools、--settings、--mcp-config、--agents……任何没列在这里的旗子都算违约
  const FLAG_OK = new Set(['--model', '--effort', '--resume']);
  let allRaw = ''; try { allRaw = fs.readFileSync(ARGV + '.all', 'utf8'); } catch {}
  const launches = []; let cur9 = [];
  for (const a of allRaw.split('\0').slice(0, -1)) { if (a === '\x1e') { launches.push(cur9); cur9 = []; } else cur9.push(a); }
  const bad9 = [];
  for (const L of launches) {
    let pos = 0;
    for (let i = 0; i < L.length; i++) {
      if (FLAG_OK.has(L[i])) { i++; continue; }                     // 旗子后面那个是它的值
      if (L[i].startsWith('-')) bad9.push(L[i]); else pos++;
    }
    if (pos > 1) bad9.push('多于一个原文参数：' + L.map((x) => x.slice(0, 20)).join(' '));
  }
  ok(launches.length >= 20 && launches.some((L) => L.includes('--model')) && launches.some((L) => L.includes('--resume')), '对照：记到了这一趟的启动（' + launches.length + ' 次），其中有带 --model 的、有恢复归档的 --resume（记录本身没坏）', String(launches.length));
  ok(launches.length > 0 && bad9.length === 0, '每一次启动都只有 --model / --effort / --resume 和至多一段任务原文，没有往说明里塞东西的旗子', JSON.stringify(bad9.slice(0, 5)));
  // 核环境（Code Mode，11/17 唯一的例外）：参数白名单管不到环境变量，所以另核一遍。「有」「无」两种都要这一趟里真起过
  const cm9 = fs.readdirSync(ROOT).filter((f) => f.startsWith('argv.cm.')).map((f) => { const p = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\0').slice(0, -1); return { env: p[0], args: p.slice(1) }; });
  const on9 = (L) => L.args.some((a) => a.startsWith('CMODE-ON ')) || (L.args[0] === '--resume' && [S.cmReal.sid, S.cmEdge.sid, S.cmNest.sid].includes(L.args[1]));
  const bad9e = cm9.filter((L) => (on9(L) ? L.env !== '1' : L.env !== 'unset')).map((L) => L.env + ' ' + L.args.map((a) => a.slice(0, 20)).join(' '));
  ok(cm9.length === launches.length && cm9.filter(on9).length >= 3 && cm9.filter((L) => !on9(L)).length >= 20 && bad9e.length === 0,
    '核环境：这一整趟 ' + cm9.length + ' 次启动里，勾了 Code Mode 的和接回 Code Mode 会话的 ' + cm9.filter(on9).length + ' 次环境里是 CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1，其余 ' + cm9.filter((L) => !on9(L)).length + ' 次一个都没有', JSON.stringify({ n: cm9.length, all: launches.length, bad: bad9e.slice(0, 5) }));
  const brain1 = brainFiles(), diff9 = [...new Set([...Object.keys(BRAIN0), ...Object.keys(brain1)])].filter((k) => BRAIN0[k] !== brain1[k]);
  ok(Object.keys(BRAIN0).length > 0 && diff9.length === 0, '服务跑完整趟：假主目录里 ' + Object.keys(BRAIN0).length + ' 个说明 / 设置文件一个没加、没改、没删', JSON.stringify(diff9));

  console.log('\n[10] 手机远程（11/17）：远程端口（端口+1）+ 名单里的 *.ts.net + 登录头 + 设备凭证；配对码一次 / 过期 / 作废；远程只给 10 个接口；撤销（含在途请求、写盘失败）；重启；只读不写设备表；日志不漏码');
  {
    const TS = 'ccb-r1.tail1a2b.ts.net', LG = 'khalil@example.com', ORI = 'https://' + TS;
    const R1P = PORT + 400, R2P = PORT + 500, R3P = PORT + 600, R4P = PORT + 700, R5P = PORT + 800, R6P = PORT + 900;
    // 远程端口：服务默认听 端口+1，这里每份都用 CCBOARD_REMOTE_PORT 改成 端口+50。mutants.mjs 并行时各份的 T_PORT 只差 1（按改坏版序号），用 +1 会撞上隔壁那份
    const R1R = R1P + 50, R2R = R2P + 50, R3R = R3P + 50, R4R = R4P + 50;
    const startR = (name, port, cfg, extra = {}, dir) => {
      const d = dir || path.join(ROOT, name + '-data'); fs.mkdirSync(d, { recursive: true });
      if (cfg !== undefined) fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify(cfg));
      const lg = path.join(ROOT, name + '.out'), o = fs.openSync(lg, 'a');
      const p = spawn(NODE, [SERVER], { env: { ...env, CCBOARD_PORT: String(port), CCBOARD_DATA: d, CCBOARD_TMUX_SOCKET: path.join(TMUXDIR, name, 'c.sock'), CCBOARD_PAIR_MS: '3000', CCBOARD_DEV_RETRY_MS: '500', CCBOARD_REMOTE_PORT: String(port + 50), ...extra }, stdio: ['ignore', o, o] }); kids.push(p.pid);
      return { p, d, lg };
    };
    const upR = async (port) => { for (let i = 0; i < 60; i++) { await sleep(200); try { if ((await (await fetch('http://127.0.0.1:' + port + '/health')).json()).ok) return true; } catch {} } return false; };
    const stopR = async (r) => { try { process.kill(r.p.pid, 'SIGTERM'); } catch {} await new Promise((res) => { const t = setTimeout(res, 5000); r.p.on('exit', () => { clearTimeout(t); res(); }); }); };
    const tokOf = (d) => { try { return fs.readFileSync(path.join(d, '.token'), 'utf8').trim(); } catch { return ''; } };
    const RH = (extra = {}) => ({ host: TS, 'tailscale-user-login': LG, ...extra });
    const lpost = (port, tok, p, body, extra = {}) => rq(port, 'POST', p, { 'x-ccboard': tok, origin: 'http://127.0.0.1:' + port, ...extra }, body);
    const rget = (port, p, cred, extra = {}) => rq(port, 'GET', p, RH({ ...(cred ? { 'x-ccboard-device': cred } : {}), ...extra }));
    const claim = (port, code, extra = {}, name = 'iPhone') => rq(port, 'POST', '/api/remote/claim', RH({ origin: ORI, ...extra }), { code, name });
    const hold = (port, p, headers, body) => {      // 先只发请求头（含 content-length），正文等 finish() 再发：造「过了凭证检查、还在等正文」的在途请求
      const data = Buffer.from(JSON.stringify(body)); let done;
      const res = new Promise((resolve) => (done = resolve));
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { ...headers, 'content-type': 'application/json', 'content-length': data.length } }, (rs) => {
        let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} done({ code: rs.statusCode, body: j }); });
      });
      r.on('error', (e) => done({ code: 0, body: { error: String(e) } })); r.setTimeout(10000, () => r.destroy(new Error('timeout'))); r.flushHeaders();
      return { finish: () => { r.end(data); return res; } };
    };
    const codeOf = (x) => String((x.body && x.body.url) || '').split('#')[1] || '';
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const errOf = (x) => x.code + ' ' + ((x.body && (x.body.why || x.body.error)) || '');
    const logOf = (r) => { try { return fs.readFileSync(r.lg, 'utf8'); } catch { return ''; } };

    let r1 = startR('r1', R1P, { remote: { on: true, hosts: [TS] } });
    const up1 = await upR(R1P), tok1 = tokOf(r1.d);
    let x = await rq(R1P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok1 });
    ok(up1 && x.code === 200 && x.body && x.body.remote && x.body.remote.hosts.join() === TS && x.body.remote.devices === 0 && x.body.remote.port === R1R && !('down' in x.body.remote) && /^remote \S+ on：多认 1 个名字 ccb-r1\.tail1a2b\.ts\.net$/m.test(logOf(r1)) && new RegExp('^remote \\S+ listen 127\\.0\\.0\\.1:' + R1R + '（', 'm').test(logOf(r1)), 'remote 开着：本机的 /api/state 多一个 remote（名单、已配对 0 台、远程端口 = 端口+1），启动日志 remote on + 远程端口听上了', JSON.stringify([up1, x.code, x.body && x.body.remote]));
    x = await rq(R1R, 'GET', '/', RH());
    ok(x.code === 200 && x.text.includes("const K = '';") && !x.text.includes(tok1) && !x.text.includes('__TOKEN__') && /frame-ancestors 'none'/.test(x.headers['content-security-policy'] || '') && x.headers['referrer-policy'] === 'no-referrer', '远程打开 /（远程端口）：给界面，但页面里没有口令（K 是空的，界面改带设备凭证）；不许被别的页面嵌进去、不带 Referer', x.code + ' ' + (x.headers['content-security-policy'] || '') + ' ' + x.text.slice(0, 60));
    x = await rq(R1P, 'GET', '/', RH());
    ok(x.code === 403 && x.body.error === 'bad host', 'remote 开着，4747 也不认 *.ts.net：经 4747 进来的远程请求 → 403 bad host（只有远程端口认远程）', errOf(x));
    x = await rq(R1R, 'GET', '/pair', RH());
    ok(x.code === 200 && /default-src 'none'/.test(x.headers['content-security-policy'] || '') && x.headers['referrer-policy'] === 'no-referrer' && x.text.includes('history.replaceState') && !x.text.includes(tok1), '配对页：CSP 收紧、no-referrer、不含口令', x.code + ' ' + (x.headers['content-security-policy'] || ''));
    const g1 = [
      ['没有 Tailscale-User-Login 头', await rq(R1R, 'GET', '/', { host: TS }), 403, 'no tailscale login'],
      ['登录头是两份（逗号连起来）', await rq(R1R, 'GET', '/', { host: TS, 'tailscale-user-login': LG + ', x@y.z' }), 403, 'no tailscale login'],
      ['Host 不在名单（同一个 tailnet 的别的名字）', await rq(R1R, 'GET', '/', { host: 'other.tail1a2b.ts.net', 'tailscale-user-login': LG }), 403, 'bad host'],
      ['远程端口、Host 写成本机、带 Tailscale 登录头（经 serve 进来伪造 Host）', await rq(R1R, 'GET', '/health', { host: '127.0.0.1:' + R1R, 'tailscale-user-login': LG }), 403, 'bad host'],
      ['远程端口、Host 写成本机、什么代理头都不带、还带着口令（本机进程直连远程端口）', await rq(R1R, 'GET', '/api/state?peek=1', { host: '127.0.0.1:' + R1R, 'x-ccboard': tok1 }), 403, 'bad host'],
      ['4747、Host 写成本机、带 Tailscale 登录头（serve 指错到 4747）', await rq(R1P, 'GET', '/health', { host: '127.0.0.1:' + R1P, 'tailscale-user-login': LG }), 403, 'bad host'],
      ['4747、Host 写成本机、带 X-Forwarded-For、还带着口令', await rq(R1P, 'GET', '/api/state?peek=1', { host: '127.0.0.1:' + R1P, 'x-forwarded-for': '203.0.113.2', 'x-ccboard': tok1 }), 403, 'bad host'],
      ['4747、Host 写成本机、只带 X-Forwarded-Proto（审查 L1：原来漏的头）、还带着口令', await rq(R1P, 'GET', '/api/state?peek=1', { host: '127.0.0.1:' + R1P, 'x-forwarded-proto': 'https', 'x-ccboard': tok1 }), 403, 'bad host'],
      ['远程 GET /health（不在 9 个里）', await rget(R1R, '/health'), 403, 'remote: not allowed'],
    ];
    for (const [why, y, c, e] of g1) ok(y.code === c && y.body && y.body.error === e, '拦：' + why + ' → ' + c + ' ' + e, errOf(y));

    x = await claim(R1R, 'A'.repeat(43));
    ok(x.code === 403 && x.body && x.body.error === 'no code', '还没出过配对码就来换凭证 → 拒（no code）', errOf(x));
    x = await lpost(R1P, tok1, '/api/remote/pair', {}, { origin: 'http://127.0.0.1:' + (R1P + 1000) });
    const xr = await rq(R1R, 'POST', '/api/remote/pair', RH({ origin: ORI }), {});
    ok(x.code === 403 && xr.code === 403 && xr.body && /not allowed|device/.test(xr.body.error), '出配对码只在本机、只接受总控台自己的页面：预览端口的 Origin → 403，远程 → 403', errOf(x) + ' | ' + errOf(xr));
    const p1 = await lpost(R1P, tok1, '/api/remote/pair', {}), code1 = codeOf(p1);
    ok(p1.body && p1.body.ok && p1.body.url.startsWith('https://' + TS + '/pair#') && /^[A-Za-z0-9_-]{43}$/.test(code1) && /^<svg[^>]*viewBox/.test(p1.body.qr || '') && p1.body.ttl === 3000, '本机出配对码：https://<名单第一个名字>/pair#<43 位>，带二维码 SVG（测试把有效期调成 3 秒）', JSON.stringify(p1.body && { url: (p1.body.url || '').slice(0, 40), ttl: p1.body.ttl }));
    x = await claim(R1R, 'B'.repeat(43));
    ok(x.code === 403 && x.body.error === 'bad code', '码不对 → 拒（bad code），而且不把正在配的码打掉（下面照样能用）', errOf(x));
    const g2 = [
      ['码对、没有登录头', await rq(R1R, 'POST', '/api/remote/claim', { host: TS, origin: ORI }, { code: code1 }), 'no tailscale login'],
      ['码对、POST 不带 Origin', await rq(R1R, 'POST', '/api/remote/claim', RH(), { code: code1 }), 'no origin'],
      ['码对、Origin 是别的网站', await claim(R1R, code1, { origin: 'https://evil.example.com' }), 'bad origin'],
      ['码对、Origin 是 http://（不是 tailscale serve 的 https）', await claim(R1R, code1, { origin: 'http://' + TS }), 'bad origin'],
      ['码对、Host 不在名单', await rq(R1R, 'POST', '/api/remote/claim', { host: 'other.tail1a2b.ts.net', 'tailscale-user-login': LG, origin: 'https://other.tail1a2b.ts.net' }, { code: code1 }), 'bad host'],
      ['码对、头齐，但发到 4747', await claim(R1P, code1), 'bad host'],
    ];
    for (const [why, y, e] of g2) ok(y.code === 403 && y.body && y.body.error === e, '拦：' + why + ' → 403 ' + e, errOf(y));
    const c1 = await claim(R1R, code1), CRED = String((c1.body && c1.body.device) || ''), [idA = '', secA = 'none'] = CRED.split('.');   // 旧代码上换不到凭证：给默认值，后面照样逐条判红，不崩
    ok(c1.code === 200 && c1.body.ok && /^[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(CRED) && c1.body.id === idA, '码对、头齐 → 换到这台设备自己的凭证（16 位设备号 . 43 位随机串）', errOf(c1));
    x = await claim(R1R, code1);
    ok(x.code === 403 && x.body.error === 'no code', '同一个码再用一次 → 拒（用一次就作废）', errOf(x));

    const g3 = [
      ['没带凭证', await rget(R1R, '/api/state'), 'no device'],
      ['只带本机口令', await rget(R1R, '/api/state', '', { 'x-ccboard': tok1 }), 'no device'],
      ['凭证随机串错一位', await rget(R1R, '/api/state', idA + '.' + secA.slice(0, -1) + (secA.slice(-1) === 'A' ? 'B' : 'A')), 'bad device'],
      ['凭证写法不对（多一段）', await rget(R1R, '/api/state', CRED + '.x'), 'no device'],
      ['不存在的设备号', await rget(R1R, '/api/state', '0123456789abcdef.' + secA), 'unknown device'],
      ['凭证对、Tailscale 登录名换了人', await rget(R1R, '/api/state', CRED, { 'tailscale-user-login': 'someone@example.org' }), 'other login'],
    ];
    for (const [why, y, e] of g3) ok(y.code === 401 && y.body && y.body.error === 'device' && y.body.why === e, '拦：' + why + ' → 401 ' + e, errOf(y));
    const g4 = [
      ['凭证对、Host 不在名单', await rq(R1R, 'GET', '/api/state', { host: 'other.tail1a2b.ts.net', 'tailscale-user-login': LG, 'x-ccboard-device': CRED }), 'bad host'],
      ['凭证对、没有登录头', await rq(R1R, 'GET', '/api/state', { host: TS, 'x-ccboard-device': CRED }), 'no tailscale login'],
      ['凭证对、远程端口、Host 写成本机还带登录头', await rq(R1R, 'GET', '/api/state', { host: '127.0.0.1:' + R1R, 'tailscale-user-login': LG, 'x-ccboard-device': CRED }), 'bad host'],
      ['凭证对、头齐，但发到 4747', await rq(R1P, 'GET', '/api/state', RH({ 'x-ccboard-device': CRED })), 'bad host'],
    ];
    for (const [why, y, e] of g4) ok(y.code === 403 && y.body && y.body.error === e, '拦：' + why + ' → 403 ' + e, errOf(y));
    x = await rget(R1R, '/api/state', CRED);
    ok(x.code === 200 && Array.isArray(x.body.sessions) && x.body.peek === true && !('remote' in x.body), '凭证对、头齐：远程读得到状态；手机读不取走本机界面的提示（peek）；不给配对信息', errOf(x));
    const NOT = [['POST', '/api/delete'], ['POST', '/api/open'], ['POST', '/api/reveal'], ['POST', '/api/focus'], ['POST', '/api/attach'], ['POST', '/api/pick'], ['POST', '/api/crash'], ['POST', '/api/auto'], ['POST', '/api/upload'], ['POST', '/api/preview'],
      ['POST', '/api/unarchive'], ['POST', '/api/cancel'], ['POST', '/api/remote/revoke'], ['GET', '/api/remote/devices'], ['GET', '/health'], ['GET', '/api/send'], ['GET', '/api/state/']];
    const leak = [];
    for (const [m, p] of NOT) { const y = await rq(R1R, m, p, RH({ 'x-ccboard-device': CRED, ...(m === 'POST' ? { origin: ORI } : {}) }), m === 'POST' ? { sid: 'x', path: '/etc/hosts', name: 'ccb-x' } : undefined); if (!(y.code === 403 && y.body && y.body.error === 'remote: not allowed')) leak.push(m + ' ' + p + ' → ' + errOf(y)); }
    ok(leak.length === 0, '拦：凭证对也不给的 ' + NOT.length + ' 个（删除、打开、选中、聚焦、去终端、选文件框、一起退出、自动续跑、上传、预览、接回、取消、撤销、列设备、/health、换方法、结尾斜杠）→ 403 remote: not allowed', JSON.stringify(leak));
    const okA = [await rget(R1R, '/api/archive', CRED), await rq(R1R, 'POST', '/api/processed', RH({ 'x-ccboard-device': CRED, origin: ORI }), {}), await rq(R1R, 'POST', '/api/ack', RH({ 'x-ccboard-device': CRED, origin: ORI }), { sid: 'nope' }), await rget(R1R, '/api/turns?sid=nope', CRED)];
    ok(okA[0].code === 200 && Array.isArray(okA[0].body.items) && okA[1].code === 200 && okA[1].body.ok && okA[2].code === 200 && okA[3].code === 404, '放行的接口真走到原来的处理：归档列表、审完了、知道了、对话（没有这段记录 → 404）', okA.map(errOf).join(' | '));
    const acts = logOf(r1).split('\n').filter((l) => / act /.test(l));
    ok(acts.some((l) => new RegExp('^remote \\S+ act ' + idA + ' khalil@example\\.com POST /api/processed$').test(l)) && acts.some((l) => new RegExp('^remote \\S+ act ' + idA + ' khalil@example\\.com POST /api/ack nope$').test(l)) && !acts.some((l) => / GET /.test(l)), '远程做的事留痕（审查 L5）：每个远程 POST 记一行 act <设备号> <登录名> POST <路径> <sid 前 8 位>，不记正文；GET 不记', JSON.stringify(acts.slice(0, 3)));
    // 「审完了」跨设备（11/18，[3p] 的远程那一半）：手机经远程端口报上来的 Mac 读得到，Mac 报上来的手机也读得到（两个端口的 /api/state 都带 processed）；Mac 撤销，手机下一次读就没了
    const lst = async () => ((await rq(R1P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok1 })).body || {});
    const [pA, pB] = ((await lst()).sessions || []).filter((s) => s.sid && s.resultAt && s.done);
    if (!pA || !pB) ok(false, '[10] 手机远程 · 审完了跨设备：这份服务墙上找不到两个交付过的会话', '');
    else {
      const rp = await rq(R1R, 'POST', '/api/processed', RH({ 'x-ccboard-device': CRED, origin: ORI }), { map: { [pA.sid]: pA.resultAt } });
      const lp = await lpost(R1P, tok1, '/api/processed', { map: { [pB.sid]: pB.resultAt } });
      const want = JSON.stringify(Object.fromEntries([[pA.sid, pA.resultAt], [pB.sid, pB.resultAt]].sort((a, b) => (a[0] < b[0] ? -1 : 1))));
      const rs1 = (await rget(R1R, '/api/state', CRED)).body || {}, ls1 = await lst();
      ok(rp.code === 200 && lp.code === 200 && JSON.stringify(rs1.processed) === want && JSON.stringify(ls1.processed) === want,
        '手机（远程端口）点了一张、Mac（4747）点了一张：两边读 /api/state 的 processed 都是这两张（远程端口也带，不只给本机）', JSON.stringify({ rp: errOf(rp), lp: errOf(lp), remote: rs1.processed, local: ls1.processed, want }));
      await lpost(R1P, tok1, '/api/processed', { clear: [pA.sid, pB.sid] });
      const rs2 = (await rget(R1R, '/api/state', CRED)).body || {};
      ok(JSON.stringify(rs2.processed) === '{}', 'Mac 撤销（clear）两张：手机下一次读 processed 就是 {}', JSON.stringify(rs2.processed));
    }
    await rq(R1R, 'POST', '/api/ack', RH({ 'x-ccboard-device': CRED, origin: ORI }), { sid: 'a\nremote x' }); await sleep(200);
    ok(!/^remote(?! \S+ )/m.test(logOf(r1)) && new RegExp('^remote \\S+ act ' + idA + ' khalil@example\\.com POST /api/ack a$', 'm').test(logOf(r1)), 'act 行的 sid 只取字母数字横杠（复审 S3）：正文里带换行伪造不出以 remote 开头的日志行', JSON.stringify(logOf(r1).split('\n').filter((l) => /^remote(?! \S+ )| act .*ack a$/.test(l))));
    x = await rq(R1P, 'GET', '/api/remote/devices', { 'x-ccboard': tok1 });
    const dj = JSON.stringify(x.body || {}), dv = (x.body && x.body.devices) || [];
    ok(x.code === 200 && dv.length === 1 && dv[0].id === idA && dv[0].name === 'iPhone' && dv[0].login === LG && dv[0].seenAt > 0 && !dj.includes('hash') && !dj.includes(secA), '本机列设备：名字、登录名、配对和最近一次的时间；不给哈希、不给凭证', dj.slice(0, 200));
    const df = path.join(r1.d, 'remote-devices.json'), rdf = () => { try { return fs.readFileSync(df, 'utf8'); } catch { return ''; } }, dtxt = rdf();
    ok(dtxt.includes(sha(secA)) && !dtxt.includes(secA) && fs.existsSync(df) && (fs.statSync(df).mode & 0o777) === 0o600, '设备表 remote-devices.json：只存凭证的 sha256、不存凭证本身，权限 0600', dtxt.slice(0, 120));

    const p2 = await lpost(R1P, tok1, '/api/remote/pair', {}), p3 = await lpost(R1P, tok1, '/api/remote/pair', {});
    const x2 = await claim(R1R, codeOf(p2)), c3 = await claim(R1R, codeOf(p3), {}, 'iPad'), CRED_B = String((c3.body && c3.body.device) || '');
    ok(x2.code === 403 && x2.body.error === 'bad code' && c3.code === 200 && /^[0-9a-f]{16}\./.test(CRED_B) && CRED_B !== CRED, '新出一个码，旧的（没用过的）就作废；新的照样能配第二台', errOf(x2) + ' | ' + errOf(c3));
    const p4 = await lpost(R1P, tok1, '/api/remote/pair', {}); const cx = await lpost(R1P, tok1, '/api/remote/pair', { cancel: true }); x = await claim(R1R, codeOf(p4));
    ok(cx.body && cx.body.ok && x.code === 403 && x.body.error === 'no code', '关掉配对弹层（cancel）→ 码作废', errOf(x));
    const p5 = await lpost(R1P, tok1, '/api/remote/pair', {}); await sleep(3300);
    const e5 = await claim(R1R, codeOf(p5)), e6 = await claim(R1R, codeOf(p5));
    ok(e5.code === 403 && e5.body.error === 'expired' && e6.code === 403 && e6.body.error === 'no code', '过期（这里调成 3 秒）→ 拒（expired），之后这个码就不认了（no code）', errOf(e5) + ' | ' + errOf(e6));
    x = await lpost(R1P, tok1, '/api/remote/revoke', { id: idA }, { origin: 'http://127.0.0.1:' + (R1P + 1000) });
    const inflight = hold(R1R, '/api/processed', RH({ 'x-ccboard-device': CRED, origin: ORI }), {}); await sleep(300);   // iPhone 的请求已经过了凭证检查、在等正文
    const rv = await lpost(R1P, tok1, '/api/remote/revoke', { id: idA }), ra = await rget(R1R, '/api/state', CRED), rb = await rget(R1R, '/api/state', CRED_B);
    const fl = await inflight.finish();
    ok(fl.code === 401 && fl.body.error === 'device' && fl.body.why === 'unknown device' && new RegExp('^remote \\S+ deny revoked-in-flight ' + idA + ' POST /api/processed$', 'm').test(logOf(r1)), '撤销时正在等正文的请求（审查 M1）：正文到了也不办 → 401 unknown device，日志 deny revoked-in-flight', errOf(fl));
    ok(x.code === 403 && rv.body && rv.body.ok && ra.code === 401 && ra.body.why === 'unknown device' && rb.code === 200, '撤销：别的源来撤 → 403；本机撤掉 iPhone → 它下一次请求就 401 unknown device，iPad 不受影响', [errOf(x), errOf(rv), errOf(ra), errOf(rb)].join(' | '));
    const p7 = await lpost(R1P, tok1, '/api/remote/pair', {}), c7 = await claim(R1R, codeOf(p7), {}, 'iPad'), CRED_C = String((c7.body && c7.body.device) || ''), [idC = 'none', secC = 'none'] = CRED_C.split('.');
    const tmpD = path.join(r1.d, 'remote-devices.json.tmp'); fs.mkdirSync(tmpD);                       // 造写盘失败：临时文件的位置被一个目录占着
    const rvC = await lpost(R1P, tok1, '/api/remote/revoke', { id: idC }), rcC = await rget(R1R, '/api/state', CRED_C);
    const stale = df + '.stale', midHas = fs.existsSync(df), midStale = (() => { try { return fs.readFileSync(stale, 'utf8'); } catch { return ''; } })(), dvMid = await rq(R1P, 'GET', '/api/remote/devices', { 'x-ccboard': tok1 });
    fs.rmdirSync(tmpD); await sleep(1500);                                                              // 测试把重试间隔调成 0.5 秒
    const endTxt = rdf(), lgC = logOf(r1), dvEnd = await rq(R1P, 'GET', '/api/remote/devices', { 'x-ccboard': tok1 });
    ok(c7.code === 200 && rvC.body && rvC.body.ok === false && /没写进盘/.test(rvC.body.error || '') && rcC.code === 401 && !midHas && midStale.includes(sha(secC)) && dvMid.body.dirty === true
      && !endTxt.includes(sha(secC)) && endTxt.includes(sha(CRED_B.split('.')[1] || 'none')) && !fs.existsSync(stale) && dvEnd.body.dirty === false
      && new RegExp('^remote \\S+ revoke ' + idC + ' iPad khalil@example\\.com（设备表没写进去：EISDIR', 'm').test(lgC) && /^remote \S+ devices 设备表补写好了$/m.test(lgC),
      '撤销时设备表写盘失败（审查 M2 / 复审 N2）：应答 ok:false 写明「没写进盘」、那台马上就拒、设备列表带 dirty；旧表挪成 .stale（补写前重启 = 空表，撤掉的回不来）；盘好了以后定时补写，撤掉的那台没了、别的还在、.stale 删掉', JSON.stringify([errOf(c7), rvC.body, errOf(rcC), midHas, !!midStale, dvMid.body.dirty, endTxt.includes(sha(secC)), fs.existsSync(stale), dvEnd.body.dirty]));
    const p6 = await lpost(R1P, tok1, '/api/remote/pair', {}), code6 = codeOf(p6);
    const lg1 = logOf(r1), codes = [code1, codeOf(p2), codeOf(p3), codeOf(p4), codeOf(p5), code6].filter(Boolean), secB = CRED_B.split('.')[1] || 'none';
    ok(codes.length === 6 && codes.every((c) => !lg1.includes(c)) && !lg1.includes(secA) && !lg1.includes(secB) && !lg1.includes('/pair#') && /^remote \S+ claim ok [0-9a-f]{16} iPhone khalil@example\.com$/m.test(lg1) && /^remote \S+ revoke [0-9a-f]{16} iPhone /m.test(lg1) && /^remote \S+ deny /m.test(lg1),
      '服务日志：记了配对、撤销、拒绝，但 6 个配对码、两台的凭证、配对链接一个字都没进日志', JSON.stringify({ n: codes.length, log: lg1.split('\n').filter((l) => l.startsWith('remote ')).slice(0, 4) }));

    await stopR(r1); r1 = startR('r1', R1P, undefined, {}, r1.d);
    const up1b = await upR(R1P); await sleep(300);
    const rs = [await rget(R1R, '/api/state', CRED_B), await rget(R1R, '/api/state', CRED), await claim(R1R, code6), await rget(R1R, '/api/state', CRED_C)];
    ok(up1b && rs[0].code === 200 && rs[1].code === 401 && rs[2].code === 403 && rs[2].body.error === 'no code' && rs[3].code === 401, '服务重启：iPad 照样能用（设备表在盘上）、撤销的 iPhone 照样拒、写盘失败后补写的那次撤销重启后也照样拒、重启前出的配对码作废（只在内存里）', rs.map(errOf).join(' | '));

    const dtxt2 = rdf();
    const r2 = startR('r2', R2P, undefined, { CCBOARD_READONLY: '1' }, r1.d); const up2 = await upR(R2P);
    await sleep(300); const q = [await rget(R2R, '/api/state', CRED_B), await claim(R2R, 'C'.repeat(43)), await lpost(R2P, tok1, '/api/remote/pair', {}), await lpost(R2P, tok1, '/api/remote/revoke', { id: (CRED_B.split('.')[0]) })];
    ok(up2 && q[0].code === 200 && q[1].code === 403 && /只读/.test(q[1].body.error || '') && q[2].code === 403 && q[3].code === 403 && dtxt2 !== '' && rdf() === dtxt2, '只读服务（CCBOARD_READONLY=1）指着同一个数据目录：认得已配对的 iPad；换凭证、出配对码、撤销一律拒；设备表一个字没动', q.map(errOf).join(' | '));
    await stopR(r2);

    const r3 = startR('r3', R3P, { remote: { on: true, hosts: [] } }); const up3 = await upR(R3P), tok3 = tokOf(r3.d); await sleep(300);
    const q3 = [await rq(R3R, 'GET', '/', RH()), await lpost(R3P, tok3, '/api/remote/pair', {})];
    ok(up3 && q3[0].code === 403 && q3[0].body.error === 'bad host' && q3[1].body && q3[1].body.ok === false && /空/.test(q3[1].body.error) && /^remote \S+ on：多认 0 个名字 （remote\.hosts 是空的/m.test(logOf(r3)), '名单为空：开着也一个都不多认（*.ts.net → 403 bad host），出配对码报「名单是空的」，日志写明', [errOf(q3[0]), JSON.stringify(q3[1].body)].join(' | '));
    await stopR(r3);
    const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-config.json'), 'utf8'));
    const r4 = startR('r4', R4P, { ...fx, remote: { on: true, hosts: ['evil.example.com', TS] } }, { CCBOARD_READONLY: '1' }); const up4 = await upR(R4P), tok4 = tokOf(r4.d);
    await sleep(300); const q4 = [await rq(R4P, 'GET', '/', RH()), await rq(R4P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok4 }), await rq(R4R, 'GET', '/', RH())];
    const cfg4 = logOf(r4).split('\n').filter((l) => l.startsWith('config '));
    ok(up4 && q4[0].code === 403 && q4[0].body.error === 'bad host' && q4[1].code === 200 && !('remote' in q4[1].body) && /^remote \S+ off：remote\.hosts 里有不是 \*\.ts\.net 的名字：evil\.example\.com$/m.test(logOf(r4)) && cfg4.length === 1 && cfg4[0].includes(fx.projects.length + ' 个项目') && q4[2].code === 0 && /ECONNREFUSED/.test(q4[2].text),
      'remote 写错（名单里混一个不是 *.ts.net 的）：整个远程关掉（远程端口没人听）、日志写明原因；别的设置（项目表）照常用', JSON.stringify([errOf(q4[0]), errOf(q4[2]), cfg4[0]]));
    await stopR(r4);
    const r5 = startR('r5', R5P, { remote: { on: true, hosts: [TS] } }, { CCBOARD_REMOTE_PORT: String(R1R), CCBOARD_REMOTE_RETRY_MS: '500' }); const up5 = await upR(R5P), tok5 = tokOf(r5.d); await sleep(300);   // 远程端口被占着（r1 还在听）
    const q5 = await rq(R5P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok5 }), p5x = await lpost(R5P, tok5, '/api/remote/pair', {});
    ok(up5 && q5.code === 200 && q5.body.remote && q5.body.remote.port === R1R && q5.body.remote.down === 'EADDRINUSE' && new RegExp('^remote \\S+ listen 127\\.0\\.0\\.1:' + R1R + ' 没听上（EADDRINUSE）', 'm').test(logOf(r5))
      && p5x.body && p5x.body.ok === false && /没听上/.test(p5x.body.error || '') && !p5x.body.url, '远程端口被占（复审 N1）：总控台照常起来（本机能用），/api/state 的 remote 带 down，日志写明；不出配对码（手机的请求会落到占着的那个进程）', JSON.stringify([q5.body && q5.body.remote, p5x.body]));
    await stopR(r1); await sleep(1500);                                                                 // 占着的走了：r5 隔 0.5 秒再试，应当接上
    const q5b = await rq(R5P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok5 }), q5c = await rq(R1R, 'GET', '/pair', RH());
    ok(q5b.body.remote && !('down' in q5b.body.remote) && q5c.code === 200 && new RegExp('^remote \\S+ listen 127\\.0\\.0\\.1:' + R1R + '（', 'm').test(logOf(r5)), '占着远程端口的进程走了：隔一阵自己再听上，down 清掉，配对页由这份服务给', JSON.stringify([q5b.body.remote, errOf(q5c)]));
    await stopR(r5);
    const r6 = startR('r6', R6P, { remote: { on: true, hosts: [TS] } }, { CCBOARD_REMOTE_PORT: 'abc', CCBOARD_READONLY: '1' }); const up6 = await upR(R6P), tok6 = tokOf(r6.d); await sleep(300);
    const q6 = await rq(R6P, 'GET', '/api/state?peek=1', { 'x-ccboard': tok6 });
    ok(up6 && q6.code === 200 && q6.body.remote && q6.body.remote.down === 'bad port' && /^remote \S+ listen 远程端口写错（abc），不听/m.test(logOf(r6)), 'CCBOARD_REMOTE_PORT 写错（复审 N3）：总控台照常起来、不崩，远程端口不听，down = bad port', JSON.stringify(q6.body && q6.body.remote));
    await stopR(r6);
  }
} catch (e) { if (e.message !== 'ui-fixture-done') throw e; } finally {
  try { if (TMUX_BIN) spawnSync(TMUX_BIN, [...TM, 'kill-server'], { env, stdio: 'ignore' }); } catch {}      // 只关这次测试自己那个 tmux（-S 绝对套接字，目录不在就只报错）
  if (!KEEP) try { if (TMUX_BIN) killWins(); } catch {}                                                        // 再关被测服务开的每一台（同样只在这次测试自己的目录里）
  if (ticker) clearInterval(ticker); clearInterval(hintTick); clearInterval(subTick);
  if (KEEP) { console.log('\nKEEP url=http://127.0.0.1:' + PORT + '/?k=' + TOKEN + ' root=' + ROOT + ' pids=' + kids.join(',')); }
  else { for (const p of kids) { try { process.kill(p, 'SIGTERM'); } catch {} } await sleep(300); fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(TMUXDIR, { recursive: true, force: true }); }
}
console.log(`\n结果：${pass} 过，${fail} 没过`);
process.exit(fail ? 1 : 0);
