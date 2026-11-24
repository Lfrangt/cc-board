#!/usr/bin/env node
/**
 * [INPUT]: 依赖 ~/.claude/sessions 的会话登记（进程号、状态）、~/.claude/projects 和 ~/.codex/sessions 的对话记录（jsonl，只读）；
 *          依赖 tmux（每个窗口一台：-S ~/.cc-board/tmux/<会话名>.sock，11/16 之前开的在 -S ~/.cc-board/tmux.sock；每台由一个 /bin/sh 看护起在前台，退出状态写 <数据目录>/tmux-exit.log）和 Ghostty 的 AppleScript 接口往会话里送字；依赖 osascript 发系统通知；依赖 ./projects.mjs 认会话属于哪个项目；依赖 ./suggest.mjs 读输入框上的预判；依赖 ./limits.mjs 汇总各订阅的周额度；依赖 ./route.mjs 把 /api/new 里声明的档位 tier 翻成模型和强度；依赖 /usr/bin/open 打开正文里的路径（/api/open）；依赖 ./preview.mjs 起内置预览的只读端口；
 *          依赖 ./org.mjs 定「哪个窗口归哪个窗口管」；依赖 /usr/sbin/lsof 和 /bin/ps 认出是哪个会话在调 /api/new（测试用 CCBOARD_LSOF / CCBOARD_PS 换掉）；config.json 的 org.chief 指向的 JSON 文件（只读，点名总管）。
 *          依赖 node:http2 发 APNs；remote.mjs 生成载荷和 JWT；生产在前台推送前异步读 HIDIdleTime，试验场只读空闲夹具文件；首次发送时异步读 cc-board-apns 钥匙串项，试验场改读显式密钥文件。
 * [OUTPUT]: APNs 设备登记与通知合批推送；前台空闲两分钟时额外放行手机推送，Mac 横幅门不变；密钥只在首次发送时异步读，试验场只连显式假地址。
 *           对外提供 127.0.0.1:4747 上的页面 /、/health 和 /api/*（state（带 peek=1 只看不取提示；org = 架构视图的上下级）、turns、diff（只读这一轮逐笔补丁）、send、new、archive、unarchive、delete、ack、answer、open、preview…）；
 *           另起 preview.mjs 的只读预览端口（默认 4747 + 1000），/api/preview 给正文里的路径发预览网址和类型（网页、PDF、图、音视频、文本；多半是图 / 视频的文件夹、或 body.paths 里的一批图回 gallery）
 * [POS]: 总控台唯一的服务进程，由 app/main.swift 启动和重启，ui.html 只通过 /api 和它说话。
 *        它把每个会话压成四样：你问了什么 / 它在干嘛 / 它交付了什么 / 它为什么停了（alertOf 是「要不要你跟进」的唯一判断处）。
 *        读记录时把每次工具调用交给 noteTool 记证据，每轮用 classify 给会话、启动中、进程退出的卡片都标上 project。
 *        在某一列列头开的新任务，tmux 名 → 那一列记在 pins.json，classify 拿它当提示分；开工前的「信任这个文件夹」由 autoTrust 替他点（config 打开就点，开在哪个文件夹都一样）。
 *        digest() 从每次交付里取一句结论和要你做的事；中英文状态标记（如【待跟进】或 [Needs you]）优先于正文判断。
 *        换了端口、数据目录或主目录就自认是试验场：不碰 Ghostty（「去终端」只记一行 focus … dry）、不发系统通知。
 *        watchGone 判「一起退出」（10 秒内 ≥ 3 个窗口的进程没了、不是总控台自己停的）：连闲着的一起记成 lost（同一个 crash 编号），当场写 <数据目录>/crash/<时间>/ 快照；
 *        归档保存原账号；接回先核账号可用，再包启动命令，Code Mode 位于账号层内。
 *        /api/crash 的 restore 让 restoreLoop 一个一个接回（看负载、每个隔一阵、总管 / 负责人先），/api/state 的 crash 给界面画横幅。
 *        归档的会话由 purgeSessionTmp 清它在 /tmp/claude-<uid> 下的临时目录：删掉的当场清，留着的归档满 3 天清。
 *        suggestLoop 每 2.5 秒读一遍空闲 tmux 会话的屏幕（capture-pane -e，只读），交给 suggest.mjs 取灰字建议和「下一步 1/2/3」，挂在 /api/state 的 suggest 字段上；它们不进对话记录。
 *        limitsLoop 每 30 秒让 limits.mjs 汇总一遍各订阅的周额度（Codex 读它的记录，只在 codex 打开时；Claude 读状态栏取数脚本存在 <数据目录>/limits 的文件），挂在 /api/state 的 limits 字段上，顶栏右上角显示；Claude 条目带上 config.json accounts 里登记的名字（name），和新任务的账号下拉同名。
 *        limits 里还有 gemini：Gemini API 预付余额的估算（<数据目录>/limits/gemini-balance.json 人读的锚点 − config.json geminiLedgers 账本里锚点之后的花费），没有锚点就是 null。
 *        /api/new 先过 route.mjs：开窗口的一方（比如总指挥窗口）声明档位 heavy / standard / light，服务翻成 --model / --effort 再交给 newSession，写错的档位拦下、不开窗口；不声明档位就沿用 settings.json 的默认（界面「新任务 → 默认」走这条）。声明了档位的，应答带 route，日志记一行 route。
 *        每个 Claude 会话记着它最近一条真回复的 model 和 effort（对话记录里每条 assistant 消息自带，跟着 /model、/effort 走），卡片右上角的模型胶囊显示它；Codex 会话用开窗口时给的值。
 *        启动时读一次数据目录里的 config.json（CONFIG）：项目表交给 useRules；autoTrust、codex、autoTidy、tidyJudge 四个开关默认关。
 *        autoTidy 打开时，watchTidy() 把「已经交付、歇着、没人在等、没人再理」的会话交给 archiveSession 自动收工（tidyDue 定哪些，tidyVerdict 定删还是留）；
 *        tidyJudge 也打开时，无需处理的交付安静 4 小时，askJudge 用 ./judge.mjs 的参数跑一次 claude -p（haiku）读它最后那段交付：做完了就收，还有要你定的事就不收、卡片改成待跟进（applyJudged）；11/17 car5 起四条线到点都先问、只有 done 才收（它自己还有后续、要你定、判不出来都不收），答案落盘 judged.json；
 *        「你点过审完了」由界面经 /api/processed 告诉它（map 新增 / clear 撤销），落盘 processed.json（重启读回），界面每次载入、服务换了一台（重启）时也重发一遍；
 *        /api/state 的 processed 再发回给每个页面（只给墙上的、和现在这一次交付对得上的），所以在一台上点了「审完了」，另一台下一拍也算处理过。
 *        架构视图（谁归谁管）：apply() 从主线记录里记下别的窗口发来的每条消息（按发信人累计）、他本人开了几轮、这一轮是谁开的、上下文多大；
 *        Track.tick 给在跑的会话数正在跑的子 agent；/api/new 当场记下是哪个会话开的窗口（spawn.json：带 Origin 的是他本人，不记；body.from；否则按端口用 lsof 认）；
 *        出 /api/state 时 orgView() 把发信人认成活会话的 sid（先按进程号 + 开的时间，再按名字且唯一），交给 org.mjs 的 buildOrg()，挂在 org 字段上；
 *        认不出、但有进程号的发信人做成 gone 项（sid 'gone:<pid>'）一起交进去，前任归档以后它带的窗口照样跟着岗位归现任（handed）。
 *        「这一轮改了哪些文件」和撞车提示：apply() / applyCodex() 把改文件的工具（Edit / Write / MultiEdit / NotebookEdit、Codex 的 apply_patch 补丁头）交给 noteWrite 记下；
 *        出状态时 markWrites() 给每个会话挂 wrote / wroteMore（这一轮写过的文件，新的一轮开始才清）和 collide（30 分钟内墙上另一个会话也往同一个 git 仓库里写过；仓库 = 最近一层有 .git 的上级文件夹，只用 existsSync，不起 git）。
 *        seat-history.json 保留点名岗位的进程时代；归属跨拍裁剪，启动按日志核验后恢复。
 *        手机远程的预览（/api/remote/preview、/rp/<钥匙>/）：只给这个会话交付里写到的文件；一个路径只解析一次（rpResolve：先按字面规整、再取真身，大小写和 firmlink 别名收成一种写法），
 *        主目录和它的上层按 dev+ino 认；钥匙绑真身和 dev+ino，GET 时按 O_NOFOLLOW 打开、核同一个文件再从这个 fd 发；PDF 按附件发；拒绝日志里的钥匙换成 <key>。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
// 只读 ~/.claude/sessions（会话登记）和 ~/.claude/projects（对话记录），不读终端画面（弹着选择框的会话除外）。
// 只监听 127.0.0.1；所有接口要带口令（.token），别的网页调不了。
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSuggest, promptEmpty } from './suggest.mjs';                                   // 输入框上的灰字建议和「下一步 1/2/3」（只从屏幕读）
import { codexLimits, claudeLimits, geminiLimits, purgeTaps, TAP_PREFIX } from './limits.mjs';            // 顶栏右上角的各订阅周额度（Codex 读它自己的记录，Claude 读状态栏取数脚本存的文件），和 Gemini API 余额的估算
import { noteTool, classify, pinnable, useRules } from './projects.mjs';
import { judgeArgs, judgeInput, parseJudge, failReason, VERDICTS } from './judge.mjs';             // 自动收工收之前看一眼：问小模型什么、答案怎么认
import { routeNew } from './route.mjs';                                         // 新窗口用哪个模型、多大强度：调用方声明档位，这里翻成参数
import { parseAccounts, parseFallback, pickDefault, accountState, wrapLaunch, wrapBackground, loginLabel } from './accounts.mjs';   // 新任务选账号：token 在钥匙串里，开会话时由一层 zsh 读出来     // 认会话属于哪个项目（按它动过的文件夹 + 标题 + 在哪一列开的）
import { startPreview, kindOf, mimeOf, readText, serveFile, listGallery } from './preview.mjs';                                // 正文里的 HTML 点开在总控台里看（另一个端口，只读）
import { buildOrg } from './org.mjs';
import { pathsIn, RP_TTL, RP_KEEP, rpKeyOk, hiddenPath, parseHidIdle, pushWould, parseApns, pushToken, pushEnv, pushPayload, apnsJwt, apnsVerdict, parseRemote, gate, allowed, checkDevice, newCode, useCode, newDevice, loadDevices, PAIR_HTML, PAIR_MS } from './remote.mjs';   // 远程准入、配对和推送纯规则
import { parseUpdateConf, createUpdater } from './update.mjs';               // 公开安装包检查新版本、自动下载（只连 github.com，config 的 updateCheck / autoUpdate）
import { qrSvg } from './qr.mjs';                                               // 配对链接画成二维码（零依赖）
import { parseAutoConfig, autoArgs, autoInput, parseAuto, hardStop, autoMessage, isAutoPrompt, autoBlock, quotaHold, KW_TEXT, isKeepWarm, parseKeepWarm, keepWarmDue, kwPaneGate } from './autopilot.mjs';   // 自动续跑：哪些窗口能替他把灰字建议发出去、先问小模型                                         // 架构视图：哪个窗口归哪个窗口管（规则全在那里，这里只备料）

const HOME = os.homedir();
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CCBOARD_PORT || 4747);
const PREVIEW_PORT = Number(process.env.CCBOARD_PREVIEW_PORT || PORT + 1000);   // 预览页的端口：另一个源，页面里的脚本碰不到总控台
const SESS_DIR = path.join(HOME, '.claude/sessions');
const PROJ_DIR = path.join(HOME, '.claude/projects');
const DATA = process.env.CCBOARD_DATA || path.join(HOME, 'Library/Application Support/cc-board');
fs.mkdirSync(DATA, { recursive: true });
const TOKEN_FILE = path.join(DATA, '.token');
const ARCHIVE_FILE = path.join(DATA, 'archive.json');
const DELETED_DIR = path.join(DATA, 'deleted');
const UPLOAD_DIR = path.join(DATA, 'uploads');          // 粘贴 / 拖进来的附件存这里，30 天后清
const LIMITS_DIR = path.join(DATA, 'limits');           // statusline-tap.mjs 在各个 Claude 会话里取走的额度，一个会话一个文件
const LIMITS_MS = Number(process.env.CCBOARD_LIMITS_MS) || 30000;   // 额度半分钟读一遍：它按「周」算，不用比这更勤
const GRACE = 8000;                      // 归档后这么久才真的停进程，期间可以撤销
const KEEP_DELETED_DAYS = 30;
const TAIL_FIRST = 4 << 20, TAIL_MAX = 48 << 20;
const STALL_MS = Number(process.env.CCBOARD_STALL_MS) || 20 * 60000;   // 显示在运行、却这么久没有任何新记录 = 可能卡住了（实测正常干活最长安静约 11 分钟）
// 不是「你平时用的那一份」（换了端口、换了数据目录或换了主目录）就当成试验场：不碰 Ghostty、不发系统通知。
// 这是它自己的默认行为，不靠调用的人记得带开关。
const REAL_HOME = (() => { try { return os.userInfo().homedir; } catch { return HOME; } })();
const SANDBOX = HOME !== REAL_HOME || PORT !== 4747 || path.resolve(DATA) !== path.join(REAL_HOME, 'Library/Application Support/cc-board');
const READONLY = process.env.CCBOARD_READONLY === '1';                 // 只读：所有会改东西的接口一律拒绝，也不往数据目录写（拿真实会话预览时用）
// 一个数据目录只许一份能写的服务（11/16 14:23 事故）：窗口环境里继承了线上服务的 CCBOARD_DATA，一份沙盒服务（假主目录、别的端口）照着它起来，
// 它的 tmux 里没有那些窗格，prunePins / pruneSpawns 就把真实的 pins.json、spawn.json 写成了 {}（线上服务 94 秒后写回，没丢东西）。
// 现在：起来前读 <数据目录>/server.json（上一份能写的服务记的端口和进程号）；那个端口不是自己的，它的 /health 又答话、进程号和数据目录都对得上
// = 别的服务正在用这个数据目录，退出（码 3），什么都不写。只读的（CCBOARD_READONLY=1）照常起：它不往数据目录写（见 savePins 等处的 READONLY）。
const SERVER_FILE = path.join(DATA, 'server.json');
const realDir = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (!READONLY) {
  let prev = null; try { prev = JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8')); } catch {}
  if (prev && Number.isInteger(prev.port) && prev.port !== PORT && prev.pid !== process.pid) {
    let h = null; try { h = await (await fetch(`http://127.0.0.1:${prev.port}/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch {}
    if (h && h.app === 'cc-board' && h.pid === prev.pid && typeof h.data === 'string' && realDir(h.data) === realDir(DATA)) {
      console.log(`datadir ${new Date().toISOString()} 数据目录 ${DATA} 正被端口 ${prev.port} 的服务（pid ${prev.pid}）用着，这一份不起。要预览就加 CCBOARD_READONLY=1，或者换一个 CCBOARD_DATA（窗口里起沙盒服务先 unset CCBOARD_DATA）`);
      process.exit(3);
    }
  }
}
// 自己单独一个 tmux 服务，不碰用户原有的 tmux 会话。CCBOARD_TMUX_SOCKET（测试用）给一个绝对套接字路径时改用 -S：
// -L 按 TMUX_TMPDIR 找目录，那个目录被删了 tmux 会退回默认的 /tmp/tmux-<uid>/，测试收尾的 kill-server 就打到线上那台（11/16 11:42、12:10 两次全体崩溃）；-S 目录不在只报错
// 11/16 起线上也不用 -L ccboard：默认套接字放在主目录下的 ~/.cc-board/tmux.sock，不在 /tmp/tmux-<uid>/ 里。
// 这样全机那几十份旧测试拷贝（-L ccboard + TMUX_TMPDIR）就算目录被删、退回默认目录，那里也没有线上服务器可杀。
// 测试假主目录下自然是另一个路径；CCBOARD_TMUX_SOCKET 给了就用它。路径不许带引号（「去终端」要把它放进 shell 命令里）
const TMUX_SOCKET = (SANDBOX && process.env.CCBOARD_TMUX_SOCKET) || path.join(HOME, '.cc-board', 'tmux.sock');   // 线上固定用主目录下这个，环境变量只在试验场里认
if (/['"\\]/.test(TMUX_SOCKET)) throw new Error('tmux 套接字路径里不能有引号或反斜杠：' + TMUX_SOCKET);
try { fs.mkdirSync(path.dirname(TMUX_SOCKET), { recursive: true, mode: 0o700 }); } catch (e) { console.log(`tmux ${new Date().toISOString()} 建不了套接字目录 ${path.dirname(TMUX_SOCKET)}：${e.message}`); }
// 每个窗口一台 tmux（P0-0，11/16）：一台服务器死掉只带走一个窗口。新开的（新任务、接回来）住在 <套接字目录>/tmux/<会话名>.sock；
// 11/16 这一版上线之前开的窗口留在 TMUX_SOCKET（tmux.sock）上照常认、不迁移。枚举两处都扫。测试里 TMUX_DIR 跟着 CCBOARD_TMUX_SOCKET 走，也是 -S 绝对路径
const TMUX_DIR = path.join(path.dirname(TMUX_SOCKET), 'tmux');
if (!READONLY) try { fs.mkdirSync(TMUX_DIR, { recursive: true, mode: 0o700 }); } catch (e) { console.log(`tmux ${new Date().toISOString()} 建不了每个窗口的套接字目录 ${TMUX_DIR}：${e.message}`); }
if (!SANDBOX && !READONLY) try { const rd = path.join(path.dirname(TMUX_SOCKET), 'README.txt'); fs.writeFileSync(rd, '这是总控台（cc-board）线上 tmux 的套接字目录。\n每个窗口一台 tmux：tmux/<会话名>.sock（11/16 起新开的）；tmux.sock 是之前开的窗口共用的那一台。不要删这个目录和里面的套接字：删了以后总控台连不上那些窗口。\n看一个窗口：tmux -S ~/.cc-board/tmux/<会话名>.sock ls；老窗口：tmux -S ~/.cc-board/tmux.sock ls（不要用 tmux -L ccboard，那是 11/16 之前的写法）。\ntmux-exit.log 在数据目录里：每台 tmux 是怎么退出的（exit 0 = 自己退的，signal 9 = 被硬杀）。\n'); } catch {}
const sockPath = (name) => path.join(TMUX_DIR, name + '.sock');
// 起 tmux 的环境：去掉 CLAUDE*（11/16 总控台 App 是从一个 Claude 会话里拉起来的，服务环境里一直带着那个早已不在的会话的变量；
// tmux 服务器起来时把它们带进全局环境，新窗口继承 CLAUDE_CODE_CHILD_SESSION=1 就被当成子会话：不存对话记录、不登记，总控台看不到）。TMUX / TMUX_PANE 同理不往下传
const TMUX_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_)/.test(k) && k !== 'TMUX' && k !== 'TMUX_PANE'));   // CCBOARD_* 同理（11/16 14:23 窗口里继承的 CCBOARD_DATA 让一份沙盒服务写坏了真实数据，cc-board-9e 的 datalock 同样剥）
// Code Mode（11/17 22:3x Khalil 本人要的，khalil-06 定范围）：Claude Code 的实验开关是这个环境变量。只给新任务里勾了开关的那一个窗口、和记录里最后一次是 Code Mode 的接回窗口，
// 不写 settings、不全局开。TMUX_ENV 剥掉了所有 CLAUDE*（规则不改），所以在剥完之后、只对这一个窗口加：套在 claude 的 argv 外面（wrapLaunch 那层 zsh 里面），claude 收到的参数一个不变
const CODE_MODE_ENV = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE';
const withCodeMode = (argv) => ['/usr/bin/env', CODE_MODE_ENV + '=1', ...argv];
const TMUX_EXIT_LOG = path.join(DATA, 'tmux-exit.log');
// 看护：一个脱离会话的 /bin/sh（两次 fork，父进程是 1，服务重启不带走它）让 tmux 留在前台（-D）当它的子进程，wait 拿到退出状态写一行日志。
// 分得清：exit 0 = tmux 自己退的（会话都结束了、kill-server、或收到 SIGTERM——tmux 接住 TERM 也按正常退出，这三种分不开）；signal 9 KILL = 被硬杀（kill -9 或内存不够时系统杀的）；
// 别的信号（6 ABRT、11 SEGV）= tmux 自己崩了；exit 非 0 = 出错退出。服务器退了以后收走它的套接字（名字只有它用）
const WATCH_SH = 'tm=$1; sock=$2; name=$3; log=$4\n' +
  'trap "" HUP INT\n' +
  '"$tm" -D -S "$sock" </dev/null >/dev/null 2>>"$log" &\n' +
  'pid=$!\n' +
  'echo "$(/bin/date +%Y-%m-%dT%H:%M:%S%z) start $name pid=$pid" >> "$log"\n' +
  'wait "$pid"; st=$?\n' +
  'if [ "$st" -gt 128 ]; then how="signal $((st-128)) $(kill -l $((st-128)) 2>/dev/null)"; else how="exit $st"; fi\n' +
  'echo "$(/bin/date +%Y-%m-%dT%H:%M:%S%z) end $name pid=$pid $how" >> "$log"\n' +
  '"$tm" -S "$sock" list-sessions >/dev/null 2>&1 || /bin/rm -f "$sock"\n';   // 这个套接字上已经没有服务器在应答才收
const WATCH_SPAWN = '/bin/sh -c "$1" ccb-watch "$2" "$3" "$4" "$5" </dev/null >/dev/null 2>&1 &';   // 外面这层马上退出：看护被 1 号进程收养
// 自动收工的四条线（autoTidy 打开时；smart 线还要 tidyJudge）。11/13 的需求：做完的窗口常常没人去关，要自动判断一个窗口是不是已经结束。
const TIDY_FAST_MS = Number(process.env.CCBOARD_TIDY_FAST_MS) || 10 * 60000;          // 你点了「审完了」之后，它再安静这么久
const TIDY_FYI_MS = Number(process.env.CCBOARD_TIDY_FYI_MS) || 24 * 3600000;          // 无需处理的交付（回给别的窗口的、过程汇报），没人再理它这么久。长期项目的负责窗口大多在回别的窗口，交付总是 fyi：线要跨过一整夜（11/13 定 48 小时；11/15 Khalil 嫌两天前的窗口还挂着，改成 24 小时）
const TIDY_REVIEW_MS = Number(process.env.CCBOARD_TIDY_REVIEW_MS) || 24 * 3600000;    // 待审阅的交付，一直没点「审完了」这么久（11/15 Khalil：「待审阅留 24 小时」）
const TIDY_SMART_MS = Number(process.env.CCBOARD_TIDY_SMART_MS) || 4 * 3600000;       // 无需处理的交付安静这么久，先让小模型看一眼（tidyJudge）：做完了就收，不用等满 TIDY_FYI_MS（11/15 Khalil：「交付了，4 个小时就可以关了」）
// 会话的临时目录：Claude Code 给每个会话一个 <CLAUDE_TMP>/<工作目录编码>/<会话号>/（scratchpad、后台命令的输出、贴进来的图）。
// 归档后它没人管，一个会话能留几百 MB（11/15 已归档的 23 个共 2.5 GB）。删掉的会话当场清；留着的归档这么久以后清，期间接回来还能用。
// 试验场默认指向假主目录里：测试忘了设也碰不到真的 /tmp。
const CLAUDE_TMP = process.env.CCBOARD_CLAUDE_TMP || (SANDBOX ? path.join(HOME, '.claude-tmp') : '/tmp/claude-' + process.getuid());
const KEEP_TMP_MS = Number(process.env.CCBOARD_KEEP_TMP_MS) || 3 * 86400000;
// 架构视图（谁归谁管）用的几个数
const SIDE_MS = 5000;                     // 在跑的会话多久读一次 subagents 文件夹（数子 agent、看「卡住了」）
const SUB_RECENT = 90000;                 // 子 agent 的记录 90 秒内有改动 = 还在跑
const PEER_MAX = 24;                      // 一个会话最多记 24 个发信人，超了丢最久没动静的
const CHIEF_MS = Number(process.env.CCBOARD_CHIEF_MS) || 10000;     // config 里 org.chief 那个文件最多每 10 秒重读一次
const CALLER_MS = 1500;                   // /api/new 认调用方（lsof + ps 往上走）整个过程的时限
const LSOF = process.env.CCBOARD_LSOF || '/usr/sbin/lsof', PS = process.env.CCBOARD_PS || '/bin/ps';   // 测试换掉（和 CCBOARD_SECURITY 一样）

// ───────────── config.json：项目表、自动点信任、Codex ─────────────
// 数据目录里一个文件，启动时读一次（./build.sh update 会重启服务）。没有或读不了就用默认值，记一行日志，不崩。
// 键：projects [{key, name, dir, word}]、neutral、roots（交给 projects.mjs 的 useRules）；autoTrust、codex、autoTidy、tidyJudge（true / false，默认都是 false）；accounts [{id, name}]（accounts.mjs）；
//     org { chief, seats, chiefWords, leadWords, headWords }（架构视图，见 parseOrg）
const CONFIG_FILE = path.join(DATA, 'config.json');
// 架构视图：chief = 点名总管的那个 JSON 文件（~ 或 / 开头；读它的 session_id 和 generation）；chiefWords / leadWords / headWords = 名字或标题里带什么字算总管 / 负责人 / 分支负责人（正则原文，不分大小写）
// headWords（11/17）：「X负责人」，X 是一个汉字、不是「总」（增长负责人、设计负责人），或英文 head of；去掉它以后还带 leadWords 的照旧是负责人，见 org.mjs
//   11/17 22:xx（khalil-49）加第三种：标题以「<至少两个汉字的话题>分支」结尾（后面可以跟 交接 / 接手 / 开工 / 接班），话题不是 git 用语（合并、清理、切到、主…分支）。
//   起因：当晚总指挥开出去的几条分支，标题只写到「…分支」、没有「负责人」三个字，一条也没被认出来，有一条还被画到了它自己手下的窗口下面。
// seats（11/17 khalil-49）：{ 项目 key: 文件路径 }，文件点名这个项目的现任负责人（见 seatsNow）。写错的那一条丢掉、记进 seatsBad，不让整份 config 不用：架构图出错不该连累开窗口。
const BRANCH_TAIL = '(?<=[\\u4e00-\\u9fff]{2})(?<!合并|合进|合入|并入|清理|删除|删掉|切换|切到|新建|新开|拉取|拉出|推送|远程|本地|临时|功能|特性|发布|开发|修复|热修|上线|回滚|[主旧切删拉推建合])分支(?=\\s*(?:交接|接手|开工|接班)?\\s*$)';
const ORG_DEF = { chief: '', seats: {}, seatsBad: 0, chiefWords: '总管|chief of staff', leadWords: '总指挥|负责人|(?:^|[^a-z])lead(?:$|[^a-z])', headWords: '(?<=[\\u4e00-\\u9fff])(?<!总)负责人|head of|' + BRANCH_TAIL };
function parseOrg(o) {                   // 写错了就抛出去，和别的键一样：整份 config 不用，记一行日志
  if (o === undefined) return { ...ORG_DEF };
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('org 要是一个对象');
  const out = { ...ORG_DEF, seats: {}, seatsBad: 0 };
  if ('seats' in o) {                    // 宽松：整段不是对象、某一条 key / 路径写错，都只丢掉那些，照旧按字样认负责人
    const v = o.seats;
    if (!v || typeof v !== 'object' || Array.isArray(v)) out.seatsBad = 1;
    else for (const [k, f] of Object.entries(v)) {
      if (/^[a-z][a-z0-9_.:-]{0,63}$/i.test(k) && typeof f === 'string' && /^(?:~\/|\/)./.test(f)) out.seats[k] = f; else out.seatsBad++;
    }
  }
  if ('chief' in o) {
    if (typeof o.chief !== 'string' || (o.chief && !/^(?:~\/|\/)./.test(o.chief))) throw new Error('org.chief 要是 ~/ 或 / 开头的文件路径');
    out.chief = o.chief;
  }
  for (const k of ['chiefWords', 'leadWords', 'headWords']) if (k in o) {
    if (typeof o[k] !== 'string') throw new Error('org.' + k + ' 要是正则的字符串');
    try { new RegExp(o[k], 'i'); } catch { throw new Error('org.' + k + ' 不是合法的正则'); }
    out[k] = o[k];
  }
  return out;
}
// Gemini 当 Claude Code 的模型（11/23，Khalil：「我们在 Claude Code 里用 Gemini 的模型……应该在模型列表里可以选」）。外壳还是 Claude Code：
// config.json 的 gemini 写 claude-gemini 外壳脚本的绝对路径，模型下拉里就多出下面这几个；选了哪个，就用
// `GEMINI_MODEL=<它> bash claude-gemini …` 起窗口（脚本自己起转接层、换环境变量、exec claude --model <它>）。不是第三个「交给谁」，别的行为（项目分组、
// 回话、归档）都不变。模型名是写死的白名单：进命令行的只有这几个字，不会是别人传来的任意字符串。
const GEMINI_MODELS = ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-hydrogen'];
const isGemini = (m) => typeof m === 'string' && GEMINI_MODELS.includes(m);
// gemini 键：脚本路径（绝对路径或 ~/ 开头）。写错只关这一项、日志一行；不写 = 关
function parseGemini(v) {
  if (v == null || v === false || v === '') return '';
  try {
    if (typeof v !== 'string') throw new Error('要是脚本的路径字符串');
    const p = v.startsWith('~/') ? path.join(HOME, v.slice(2)) : v;
    if (!path.isAbsolute(p) || /[\0\r\n]/.test(p)) throw new Error('要是绝对路径（或 ~/ 开头）');
    if (!fs.existsSync(p)) console.log(`config ${CONFIG_FILE}：gemini 指的脚本现在不在（${p}），脚本到位以前 Gemini 模型不出现`);
    return p;
  } catch (e) { console.log(`config ${CONFIG_FILE}：gemini 不用（${e.message}），Gemini 模型不出现`); return ''; }
}
// geminiLedgers 键（11/23，Khalil：「把 Google 的 API 还剩多少钱也放进去」）：记 Gemini 花费的账本路径（.tsv / .jsonl，绝对路径或 ~/ 开头），
// limits.mjs 拿锚点余额减掉它们记的钱。不是数组只关这一项、日志一行；数组里写错的那一条单独丢掉；不写 = 没有账本（有锚点也只显示锚点读数）
const GEMINI_LEDGERS_MAX = 8;
function parseGeminiLedgers(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { console.log(`config ${CONFIG_FILE}：geminiLedgers 不用（要是路径数组），余额只减不到花费`); return []; }
  const list = []; let bad = 0;
  for (const x of v) {
    const p = typeof x === 'string' ? (x.startsWith('~/') ? path.join(HOME, x.slice(2)) : x) : '';
    if (list.length < GEMINI_LEDGERS_MAX && p && path.isAbsolute(p) && !/[\0\r\n]/.test(p) && /\.(tsv|jsonl)$/i.test(p)) list.push(path.normalize(p)); else bad++;
  }
  if (bad) console.log(`config ${CONFIG_FILE}：geminiLedgers 丢掉 ${bad} 条（要 .tsv / .jsonl 的绝对路径或 ~/ 开头，最多 ${GEMINI_LEDGERS_MAX} 条）`);
  return list;
}
let CONFIG_OK = false;                  // 启动时 config.json 整份用上了没有。没用上（没有、坏了、某个键写错）就一直用默认值，自动续跑重读也不会把它打开（见 autoConf）
const CONFIG = (() => {
  const def = { autoTrust: false, codex: false, autoTidy: false, tidyJudge: false, accounts: [], defaultAccount: '', judgeAccount: '', gemini: '', geminiLedgers: [], accountFallback: null, org: { ...ORG_DEF }, auto: parseAutoConfig(), remote: parseRemote(), apns: parseApns(), update: parseUpdateConf() };
  let raw; try { raw = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch { console.log(`config ${CONFIG_FILE}：没有这个文件，用默认值`); return def; }
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('不是一个 JSON 对象');
    for (const k of ['autoTrust', 'codex', 'autoTidy', 'tidyJudge']) if (k in c && typeof c[k] !== 'boolean') throw new Error(k + ' 要是 true 或 false');
    const accounts = parseAccounts(c.accounts);
    // 没选账号时开哪个号（总管 11/17 17:3x）：只认 accounts 里登记过的 id；写错和别的键一样整份不用，不悄悄退回钥匙串当前登录的号
    if ('defaultAccount' in c && !accounts.some((a) => a.id === c.defaultAccount)) throw new Error('defaultAccount 要是 accounts 里登记过的 id');
    const defaultAccount = c.defaultAccount || '';
    // 判官（judge、自动续跑的小模型）用哪个号（总管 11/20 23:1x 定朋友号）：只认登记过的 id，规矩同 defaultAccount；不写就跟 defaultAccount，两个都没有才是钥匙串当前登录的号
    if ('judgeAccount' in c && !accounts.some((a) => a.id === c.judgeAccount)) throw new Error('judgeAccount 要是 accounts 里登记过的 id');
    const judgeAccount = c.judgeAccount || '';
    const gemini = parseGemini(c.gemini);              // 写错只关这一项（同 remote / apns），不连累整份
    const geminiLedgers = parseGeminiLedgers(c.geminiLedgers);   // 同上
    // 默认号到顶才退回哪个号（11/22 Khalil：「我之后新建的任务开到主号」）：写错只关这一项，不连累整份（同 remote / apns）
    const fbr = parseFallback(c.accountFallback, accounts, defaultAccount);
    if (fbr.error) console.log(`config ${CONFIG_FILE}：accountFallback 不用（${fbr.error}），默认号到顶也不退`);
    const update = parseUpdateConf(c);                 // updateCheck / autoUpdate 不是布尔就抛：整份不用，和 autoTrust 这些键一样
    const org = parseOrg(c.org);
    const auto = parseAutoConfig(c.autoContinue);
    const r = useRules({ projects: c.projects, neutral: c.neutral, roots: c.roots });
    CONFIG_OK = true;
    console.log(`config ${CONFIG_FILE}：${r.list.length} 个项目，autoTrust=${c.autoTrust === true}，codex=${c.codex === true}，autoTidy=${c.autoTidy === true}，tidyJudge=${c.tidyJudge === true}，accounts=${accounts.length}，defaultAccount=${defaultAccount || '无'}，judgeAccount=${judgeAccount || '跟 defaultAccount'}，gemini=${gemini ? '开' : '无'}，geminiLedgers=${geminiLedgers.length}，accountFallback=${fbr.fb ? `${fbr.fb.to}@${fbr.fb.at}%` : '无'}，org.chief=${org.chief || '无'}，org.seats=${Object.keys(org.seats).length}${org.seatsBad ? `（丢掉 ${org.seatsBad} 条写错的）` : ''}，autoContinue=${auto.on ? `on(周<${auto.weekMax}% 5h<${auto.fiveMax}% 连续≤${auto.maxRun})` : 'off'}`);   // 检查新版本是开是关另有一行 update …（见下面 updater）
    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: c.autoTidy === true, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, judgeAccount, gemini, geminiLedgers, accountFallback: fbr.fb, org, auto, update, remote: parseRemote(c.remote), apns: parseApns(c.apns) };   // remote / apns 写错各自关闭，不抛
  } catch (e) { useRules(); console.log(`config ${CONFIG_FILE}：读不了（${e.message}），用默认值`); return def; }
})();

function loadToken() {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

// ───────────── 检查新版本（11/22 Khalil：「已经装了的用户不会自动更新……有新 release 就在界面上提示，点一下就能下 dmg」「默认就是最新版本自动下载」）─────────────
// 只有公开 dmg 装的才有 app/.bundle-version（外壳换代码时写的「0.3.7 (12)」）；build.sh 装的（作者本机、一行安装脚本）没有，就不查、不连网。
// 试验场默认不连：给了 CCBOARD_UPDATE_BASE（测试的假服务器）才查，CCBOARD_UPDATE_CURRENT 顶替版本号。只读服务不查（要写 update.json）。
const UPDATE_CUR = (SANDBOX ? process.env.CCBOARD_UPDATE_CURRENT : '') || (() => { try { return fs.readFileSync(path.join(DIR, '.bundle-version'), 'utf8').trim(); } catch { return ''; } })();
const UPDATE_BASE = SANDBOX ? process.env.CCBOARD_UPDATE_BASE || '' : undefined;
const updater = UPDATE_CUR && CONFIG.update.check && !READONLY && UPDATE_BASE !== ''
  ? createUpdater({ current: UPDATE_CUR, dir: DATA, conf: CONFIG.update, ...(UPDATE_BASE ? { base: UPDATE_BASE } : {}), log: (m) => console.log(`${m.replace(/^update /, 'update ' + new Date().toISOString() + ' ')}`) })
  : null;
console.log(`update ${new Date().toISOString()} ${updater ? `on：本机 ${UPDATE_CUR}，autoUpdate=${CONFIG.update.auto}` : `off（${!UPDATE_CUR ? '不是公开安装包' : !CONFIG.update.check ? 'updateCheck=false' : READONLY ? '只读' : '试验场'}）`}`);

// ───────────── 手机远程（11/17 Khalil 14:13：「先在沙盒里把 server.mjs 的 Host 检查、配对、远程权限收窄做出来」）─────────────
// 只走 Tailscale：remote 开着时服务另听 127.0.0.1:<端口+1>（线上 4748），tailscale serve 把 https://<机器>.ts.net 转到那里；4747 照旧只认本机。
// 两个端口分开（11/17 晚，审查 M3 定的 B）：从远程端口进来的一律按远程认；remote 一关，那个端口就没人听。config.json 的 remote 关着时下面这些一个都不起作用。
// 设备表 remote-devices.json（0600）只存凭证的 sha256；配对码只在内存里。只读服务不写设备表（saveDevices 和所有 POST 一样被 READONLY 挡掉）。
const REMOTE = CONFIG.remote;
const REMOTE_PORT_RAW = String(process.env.CCBOARD_REMOTE_PORT || PORT + 1);
const REMOTE_PORT = /^\d{1,5}$/.test(REMOTE_PORT_RAW) ? Number(REMOTE_PORT_RAW) : 0;
const REMOTE_PORT_BAD = !(REMOTE_PORT >= 1 && REMOTE_PORT <= 65535) || REMOTE_PORT === PORT || REMOTE_PORT === PREVIEW_PORT;   // 写错就不听（只是手机连不上），不能把总控台本身带崩
const REMOTE_RETRY_MS = (SANDBOX && Number(process.env.CCBOARD_REMOTE_RETRY_MS)) || 30000;
let remoteDown = '';                       // 远程端口没听上的原因（被占了 / 写错）：不出配对码，「手机」弹层里写出来
if (REMOTE.on) console.log(`remote ${new Date().toISOString()} on：多认 ${REMOTE.hosts.length} 个名字 ${REMOTE.hosts.join(' ')}${REMOTE.why ? '（' + REMOTE.why + '）' : ''}`);
else if (REMOTE.why) console.log(`remote ${new Date().toISOString()} off：${REMOTE.why}`);
const DEV_FILE = path.join(DATA, 'remote-devices.json');
const PRUNE_MS = (SANDBOX && Number(process.env.CCBOARD_PRUNE_MS)) || 120000;   // 真退出须跨三拍与两分钟，试验场调短
const PAIR_TTL = (SANDBOX && Number(process.env.CCBOARD_PAIR_MS)) || PAIR_MS;   // 测试调短；线上固定 10 分钟
let devices = new Map(); try { devices = loadDevices(fs.readFileSync(DEV_FILE, 'utf8')); } catch {}
const devSeen = new Map();                 // 设备号 → 最近一次请求的时间（只在内存，不为它写盘）
let pairing = null;                        // 当前唯一有效的配对码 { hash, exp }
let devDirty = false;                      // 设备表没写进盘（撤销后写盘失败）：定时重试，免得重启后撤销的设备回来
function saveDevices() {                   // 返回 '' = 写好了；否则是错因（不抛）
  if (READONLY) return '';
  try {
    const tmp = DEV_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ devices: [...devices.values()] }, null, 1) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, DEV_FILE);
    if (devDirty) { remoteLog('devices 设备表补写好了'); try { fs.unlinkSync(DEV_FILE + '.stale'); } catch {} }
    devDirty = false; return '';
  } catch (e) { devDirty = true; return String((e && e.code) || (e && e.message) || e); }
}
const DEV_RETRY_MS = (SANDBOX && Number(process.env.CCBOARD_DEV_RETRY_MS)) || 30000;
if (REMOTE.on && !READONLY) setInterval(() => { if (devDirty) saveDevices(); }, DEV_RETRY_MS).unref();
const remoteSaid = new Map();              // 同一种拒绝一分钟最多记一行：撤销后的手机还在轮询时不刷屏
function remoteLog(m, key) {
  if (key) { const t = remoteSaid.get(key) || 0; if (Date.now() - t < 60000) return; remoteSaid.set(key, Date.now()); }
  console.log(`remote ${new Date().toISOString()} ${m}`);          // 这里永远不写配对码、凭证、配对链接
}
// 日志里的请求路径。远程预览的钥匙（/rp/<32 位十六进制>/…）不进日志（11/22 修）：连着 16 位以上的十六进制（含 %xx 写的）一律换成 <key>，
// 不按 /rp/ 开头认：/x/../rp/<钥匙> 这类写法 URL 规整后照样走 /rp/ 路由
const pathOf = (req) => String(req.url || '').split(/[?#]/)[0].replace(/(?:[0-9a-f]|%(?:3[0-9]|[46][1-6])){16,}/gi, '<key>').slice(0, 80);

// ───────────── APNs：通知合批之后才进来，网络和密钥只留在服务层 ─────────────
const APNS = CONFIG.apns;
const APNS_JWT_MS = 40 * 60000, APNS_KEY_RETRY_MS = 10 * 60000, APNS_REQUEST_MS = 10000;
const apnsSessions = new Map();
let apnsKey = null, apnsKeyTask = null, apnsKeyRetryAt = 0, apnsJWT = '', apnsJWTAt = 0;
const pushLog = (m) => console.log(`push ${new Date().toISOString()} ${m}`);
const pushCode = (e) => String(e?.code ?? 'key').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'key';
if (APNS.on) pushLog(`on：${APNS.keyId.slice(0, 4)}…`);
else if (APNS.why) pushLog('off：' + APNS.why);
async function pushKey() {
  if (apnsKey) return apnsKey;
  if (Date.now() < apnsKeyRetryAt) return null;
  if (apnsKeyTask) return apnsKeyTask;
  apnsKeyTask = (async () => {
    try {
      let raw;
      if (SANDBOX) {
        if (!process.env.CCBOARD_APNS_KEY_FILE) throw Object.assign(new Error(), { code: 'ENOKEY' });
        raw = await fs.promises.readFile(process.env.CCBOARD_APNS_KEY_FILE, 'utf8');
      } else raw = await new Promise((resolve, reject) => execFile('/usr/bin/security',
        ['find-generic-password', '-s', 'cc-board-apns', '-a', APNS.keyId, '-w'], { timeout: 5000 },
        (e, stdout) => e ? reject(e) : resolve(stdout)));
      const b64 = raw.trim();
      if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw Object.assign(new Error(), { code: 'EBADKEY' });
      const key = crypto.createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'));
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Object.assign(new Error(), { code: 'EBADKEY' });
      apnsKey = key; return key;
    } catch (e) {
      apnsKeyRetryAt = Date.now() + APNS_KEY_RETRY_MS;
      pushLog(`off：读不到密钥（${pushCode(e)}）`); return null;
    }
  })();
  try { return await apnsKeyTask; } finally { apnsKeyTask = null; }
}
function apnsSession(host) {
  let session = apnsSessions.get(host);
  if (session && !session.closed && !session.destroyed) return session;
  session = http2.connect(host); apnsSessions.set(host, session); session.unref();
  const discard = () => { if (apnsSessions.get(host) === session) apnsSessions.delete(host); };
  session.on('error', discard); session.on('close', discard);
  session.on('goaway', () => { discard(); session.close(); });
  return session;
}
function apnsRequest(host, token, jwt, payload) {
  return new Promise((resolve) => {
    let req, timer, status = 0, body = '', ended = false;
    const finish = (code, reason = '') => {
      if (ended) return; ended = true; clearTimeout(timer);
      resolve({ verdict: apnsVerdict(code, reason), status: code, reason });
    };
    try {
      req = apnsSession(host).request({ ':method': 'POST', ':path': '/3/device/' + token,
        authorization: 'bearer ' + jwt, 'apns-topic': APNS.topic, 'apns-push-type': 'alert',
        'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) });
      timer = setTimeout(() => req.destroy(Object.assign(new Error(), { code: 'ETIMEDOUT' })), APNS_REQUEST_MS);
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.setEncoding('utf8'); req.on('data', (s) => { if (body.length < 4096) body += s.slice(0, 4096 - body.length); });
      req.on('end', () => {
        let reason = ''; try { const r = JSON.parse(body).reason; if (typeof r === 'string' && /^[A-Za-z]{1,60}$/.test(r)) reason = r; } catch {}
        finish(status, reason);
      });
      req.on('error', (e) => finish(pushCode(e)));
      req.on('close', () => finish('ECLOSED'));
      req.end(JSON.stringify(payload));
    } catch (e) { finish(pushCode(e)); if (req) req.destroy(); }
  });
}
function pushReady() {
  return APNS.on && REMOTE.on && !READONLY && [...devices.values()].some((d) => d.push);
}
let idleUnknownAt = 0;
async function readHidIdleMs() {
  try {
    if (SANDBOX) {
      const file = SANDBOX && process.env.CCBOARD_IDLE_FILE;
      if (!file) return 0;
      const text = (await fs.promises.readFile(file, 'utf8')).trim(), ms = Number(text);
      if (/^\d+$/.test(text) && Number.isSafeInteger(ms)) return ms;
      throw Object.assign(new Error(), { code: 'EBADIDLE' });
    }
    const text = await new Promise((resolve, reject) => execFile('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'],
      { timeout: 2000 }, (e, stdout) => e ? reject(e) : resolve(stdout)));
    const ms = parseHidIdle(text);
    if (ms != null) return ms;
    throw Object.assign(new Error(), { code: 'EBADIDLE' });
  } catch (e) {
    if (Date.now() - idleUnknownAt >= APNS_KEY_RETRY_MS) { idleUnknownAt = Date.now(); pushLog('idle-unknown ' + pushCode(e)); }
    return null; // 空闲未知时不额外放行
  }
}
async function sendPush(items) {
  if (!pushReady()) return;
  const payload = pushPayload(items), key = payload.aps.alert['loc-key'];
  if (SANDBOX && !process.env.CCBOARD_APNS_URL) { pushLog('dry ' + key); return; }
  const privateKey = await pushKey(); if (!privateKey) return;
  const targets = [...devices.values()].filter((d) => d.push).map((d) => ({ d, push: d.push }));
  if (!targets.length) return;
  if (!apnsJWT || Date.now() - apnsJWTAt >= APNS_JWT_MS) { apnsJWTAt = Date.now(); apnsJWT = apnsJwt(privateKey, APNS.keyId, APNS.teamId, Math.floor(apnsJWTAt / 1000)); }
  const jwt = apnsJWT;
  const result = await Promise.all(targets.map(async ({ d, push }) => {
    if (devices.get(d.id) !== d || d.push !== push) return false;
    const { token, env } = push;
    const host = (SANDBOX && process.env.CCBOARD_APNS_URL) || (env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
    const r = await apnsRequest(host, token, jwt, payload);
    if (r.verdict === 'drop' && devices.get(d.id) === d && d.push === push) {
      delete d.push; saveDevices();
      pushLog(`drop ${d.id} ${token.slice(0, 8)} ${r.status} ${r.reason}`);
    } else if (r.verdict === 'err') pushLog(`err ${d.id} ${r.status} ${r.reason}`);
    return r.verdict === 'ok';
  }));
  pushLog(`sent ${result.filter(Boolean).length}/${targets.length} ${key}`);
}

function run(cmd, args, { input, timeout = 15000, env, maxBuffer = 8 << 20 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').replace(/\n$/, ''), err: String(stderr || (err && err.message) || '').trim() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const osa = (script, args = [], timeout) => run('/usr/bin/osascript', ['-', ...args], { input: script, timeout });
let TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => fs.existsSync(p)) || 'tmux';
// tmux 一律按会话找它住的那台：枚举时记下「会话名 → 套接字」；表里没有（刚开出来、枚举还没轮到）就看 tmux/<名字>.sock 在不在，不在才是老的 tmux.sock
const sockOf = new Map();
const sockFor = (name) => sockOf.get(name) || (fs.existsSync(sockPath(name)) ? sockPath(name) : TMUX_SOCKET);
const tmuxAt = (sock, args, opt) => run(TMUX_BIN, ['-S', sock, ...args], { ...opt, env: TMUX_ENV });
const tmuxFor = (name, args, opt) => tmuxAt(sockFor(name), args, opt);
// 旧写法 tmux([... '-t', 会话名 ...]) 照样能用：按 -t 后面的会话名找它住的那台（别的补丁、自动续跑还在用这个写法；[7e-2] 的会话开在它自己那台上，守着这一条）。
// 认不出会话名（没有 -t，或 -t 是 %窗格 / $会话号 / @窗口号）的打到老的 tmux.sock 并记一行：新代码别再用这个写法，用 tmuxFor(名字, …) / tmuxAt(套接字, …)
const tmux = (args, opt) => {
  const i = args.indexOf('-t'), t = i >= 0 ? String(args[i + 1] || '').replace(/^=/, '').split(/[:.]/)[0] : '';
  if (t && !/^[%$@]/.test(t)) return tmuxFor(t, args, opt);
  console.log(`tmux ${new Date().toISOString()} 旧写法 tmux(${args[0]}) 认不出会话名，打到老的 tmux.sock`);
  return tmuxAt(TMUX_SOCKET, args, opt);
};
// 给一个新窗口起它自己的那台 tmux：看护先把 tmux -D 起在前台，等它接得通（最多约 5 秒）再在上面开会话。看护起不来就退回不加看护（tmux 自己转后台）、日志写明
async function startServer(name) {
  const sock = sockPath(name);
  try {                                            // detached = 外层 sh 新开一个会话（setsid）：看护不在服务的进程组里，谁对服务的进程组发信号都碰不到它
    const outer = spawn('/bin/sh', ['-c', WATCH_SPAWN, 'ccb-spawn', WATCH_SH, TMUX_BIN, sock, name, TMUX_EXIT_LOG], { env: TMUX_ENV, detached: true, stdio: 'ignore' });
    outer.on('error', () => {}); outer.unref();
  } catch (e) { console.log(`tmux ${new Date().toISOString()} ${name} 看护没起来：${e.message}`); }
  const end = Date.now() + 5000;                    // 按钟点截止：每次探测各自限时 1 秒，机器很忙时也不会挂上几十秒
  while (Date.now() < end) {
    if ((await tmuxAt(sock, ['list-sessions'], { timeout: 1000 })).ok) return { sock, watched: true };   // -D 的服务器起来了、还没有会话：list-sessions 回 0、空输出
    await sleep(100);
  }
  console.log(`tmux ${new Date().toISOString()} ${name} 看护 5 秒内没把 tmux 起来，退回不加看护`);
  return { sock, watched: false };
}
// 开完要站得住（新开的会话偶尔一开就退）：选了号的那层 zsh 先读钥匙串、再 exec claude，claude 那一秒正被自动更新换掉时 exec 落空，会话 1 秒内才退，
// 这时 has-session 早过了，接口照样回 ok，开窗口的一方以为开成了。所以开完先看一次，之后 SETTLE_MS 里每 200 ms 再看一次（新任务因此多等这么久才回）。
// tmux 的回答分三种：在 / 确定没了（找不到会话、服务器不在、套接字文件不在：11/18 tmux 3.7c 实测的三句；11/19 又补两句：会话一开就退、那台 tmux 正关到一半时连上去，
// 回 server exited unexpectedly（话没说完服务器就没了）或 no current target（服务器还在、会话已经没了），自己的套接字上 1000 次里 19 + 5 次）/ 说不准（超时之类）。
// 只有确定没了才回 gone 让调用方重开；说不准的不算退：机器忙时 has-session 超时就重开，会开出两个一样的窗口
const SETTLE_MS = Number(process.env.CCBOARD_SETTLE_MS || 2000);
const RESPAWN_MS = Number(process.env.CCBOARD_RESPAWN_MS || 3000);
const GONE_RE = /can't find session|no server running|\(No such file or directory\)|server exited unexpectedly|no current target/;
const GONE_MSG = '会话一开就退了（claude 可能正在更新），重开一次也没起来，过一会儿再试';
// 在它自己那台上开会话。-D 会关掉 exit-empty：开完再打开，会话结束（他 /exit）那台 tmux 就自己退，不留空服务器（会话先退了再打开也一样会退，11/16 实测）
async function openSession(name, args) {
  const sv = await startServer(name);
  const r = await tmuxAt(sv.sock, ['new-session', '-d', '-s', name, ...args]);
  const e = await tmuxAt(sv.sock, ['set', '-g', 'exit-empty', 'on']);   // 不论开没开成、看护起没起来都下：没开成时空的 -D 服务器也自己退
  if (!r.ok) return { ok: false, error: 'tmux：' + r.err };
  if (!e.ok) console.log(`tmux ${new Date().toISOString()} ${name} exit-empty 没打开：${e.err}`);
  const settle = Date.now() + SETTLE_MS;
  for (let i = 0; i === 0 || Date.now() < settle; i++) {
    if (i) await sleep(200);
    const h = await tmuxAt(sv.sock, ['has-session', '-t', name]);
    if (h.ok) continue;
    if (!fs.existsSync(path.dirname(sv.sock))) return { ok: false, error: 'tmux 没开出会话（套接字目录 ' + TMUX_DIR + ' 还在吗？）' };   // -S 的目录不在时 new-session 也回 0；目录在就不是它的事（11/18 以前一律这么说）
    if (GONE_RE.test(h.err)) return { ok: false, gone: true, error: '会话一开就退了' };
    if (!i) return { ok: false, error: 'tmux 没开出会话：' + h.err };   // 刚开完那一下就说不准：照以前算没开成，不重开
  }
  sockOf.set(name, sv.sock);
  return { ok: true, sock: sv.sock };
}
// 新会话名：ccb- + 6 位随机。老的 tmux.sock 上和 tmux/ 下都不能已经有它
function newName() {
  for (;;) { const n = 'ccb-' + crypto.randomBytes(3).toString('hex'); if (!fs.existsSync(sockPath(n)) && !panes.some((p) => p.name === n)) return n; }
}
// 老的 tmux.sock 那台的全局环境里要是有 CLAUDE* / CCBOARD_* 变量（服务器是别人从 Claude 会话里起的，或者起在这个修复之前），拿掉（11/16 cc-board-9e envfix、datalock）。启动时一次，之后每分钟一次；已经开着的窗口不受影响。
// 每个窗口一台以后新窗口不再开在它上面（各自那台起的时候环境就是 TMUX_ENV），这里只管老的那台
async function scrubTmuxEnv() {
  if (READONLY) return;       // 只读的预览不改线上 tmux
  try {
    const r = await tmuxAt(TMUX_SOCKET, ['show-environment', '-g']);
    if (r.ok) for (const line of r.out.split('\n')) {
      const k = line.split('=')[0];
      if (line.includes('=') && /^(CLAUDE[A-Z0-9_]*|CCBOARD_[A-Z0-9_]+)$/.test(k) && (await tmuxAt(TMUX_SOCKET, ['set-environment', '-g', '-u', k])).ok) console.log(`tmux ${new Date().toISOString()} 拿掉全局环境里的 ${k}`);
    }
  } catch {}
  setTimeout(scrubTmuxEnv, 60000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screenLines = (text, n) => String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''))
  .filter((l) => l.trim() && !/^[\s─━═│┃╭╮╰╯┌┐└┘▔▁]+$/.test(l)).slice(-n).join('\n');

// ───────────── 对话记录 → 状态 ─────────────

function cleanPrompt(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim();
}

function toolLine(b) {
  const i = b.input || {};
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (b.name) {
    case 'Bash': return i.description || String(i.command || '').slice(0, 70);
    case 'Read': return '读 ' + base(i.file_path);
    case 'Edit': case 'Write': case 'NotebookEdit': return '改 ' + base(i.file_path || i.notebook_path);
    case 'Agent': case 'Task': return '派子任务：' + (i.description || '');
    case 'Workflow': return '跑多 agent 流程';
    case 'WebSearch': return '搜索：' + (i.query || '');
    case 'WebFetch': return '读网页';
    case 'Skill': return '用技能 ' + (i.skill || '');
    case 'SendMessage': return '给 ' + (i.to || '别的会话') + ' 发消息';
    case 'AskUserQuestion': return '在问你问题';
    case 'Grep': case 'Glob': return '找文件';
    case 'REPL': return i.description || '跑脚本';                   // Code Mode：模型发的一段 JS，description 是它自己写的一句说明
    default: return String(b.name || '').replace(/^mcp__/, '').replace(/__/g, ' · ').slice(0, 50);
  }
}

function userText(d) {
  const c = d.message && d.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
  return '';
}
function isToolResult(d) {
  const c = d.message && d.message.content;
  return Array.isArray(c) && c.some((x) => x && x.type === 'tool_result');
}
// 是不是用户本人打的字（不是别的 agent 发来的、不是斜杠命令、不是任务通知）
function isHuman(d, text) {
  if (d.origin) return d.origin.kind === 'human';
  if (d.turnOrigin) return d.turnOrigin === 'human';
  return !/^\s*</.test(text);
}

function newState() {
  return { files: new Map(), nHuman: 0, nTools: 0, nEdits: 0, title: null, custom: null, prompt: null, promptAt: null, result: null, resultAt: null, finalId: null,
    note: null, noteAt: null, tool: null, steps: 0, turnAt: null, ask: null, queued: null, lastAt: null, done: false,
    open: false, halt: null,            // open = 这一轮还没收尾；halt = 这一轮为什么停了 {kind, text, at}
    model: null, effort: null,          // 最近一条真回复（不是 <synthetic> 报错）用的模型 id 和强度；老版本、不支持强度的模型没有 effort
    codeMode: false,                    // 记录里最后一条 repl-mode 的 replMode（Code Mode，11/17）；一条都没有 = false
    // 架构视图：peers = 别的窗口发来的消息按发信人累计（键 pid|名字 → {pid, name, n, first, last}，毫秒）；human = 他本人开了几轮、最近一轮的时间；
    // turnPeer = 这一轮是别的窗口开的时，是谁开的（{pid, name, at}）；ctx = 最近一条主线真回复的上下文大小（token）
    peers: new Map(), human: null, turnPeer: null, ctx: null };
}
// 别的窗口发来的一条消息（记录里 origin.kind === 'peer'）记到发信人名下。每条都算，不只算开了一轮的那条。
// 记录里的样子：origin { kind:'peer', from:'uds:/tmp/cc-socks/<进程号>.sock', verifiedPeerPid: <进程号>, name:'<它当时的名字>', msg_id, body, … }
// 键是 pid + 名字：窗口改名后名字变了、进程号没变，两条照样在出状态时认成同一个会话、合在一起；进程号被别的窗口重用时名字多半不同，不会混进同一条。
function notePeer(st, d) {
  const o = d.origin || {};
  const pid = Number.isInteger(o.verifiedPeerPid) && o.verifiedPeerPid > 1 ? o.verifiedPeerPid : null;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!pid && !name) return null;
  const at = Date.parse(d.timestamp) || 0, key = (pid || '') + '|' + name;
  let p = st.peers.get(key);
  if (!p) {
    if (st.peers.size >= PEER_MAX) {                 // 满了：丢最久没动静的那个
      let old = null; for (const [k, v] of st.peers) if (!old || v.last < old[1].last) old = [k, v];
      st.peers.delete(old[0]);
    }
    p = { pid, name, n: 0, first: at, last: at }; st.peers.set(key, p);
  }
  p.n++; if (at > p.last) p.last = at; if (at && (!p.first || at < p.first)) p.first = at;
  return p;
}
// 按了 Esc 之后，记录里会多一条 user 消息，内容就是这句标记。它不是你说的话。
const isInterrupt = (text) => /^\s*\[Request interrupted by user/.test(text);
// API 报错在记录里是一条 model 为 <synthetic> 的 assistant 消息，error 字段说是哪一类
function haltOf(d, m) {
  const text = m.content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
  // 安全检查拦下这条消息（11/13 Khalil 定单独标出来）：error 是 invalid_request、stop_reason 是 refusal，正文是「<模型>'s safeguards flagged this message」。
  // 11/12 12:00 起本机 22 条 API 报错里 18 条是它。上下文过长也是 invalid_request，但 stop_reason 是 stop_sequence，不能认成它
  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);
  const kind = flagged ? 'flagged' : d.error === 'rate_limit' ? 'limit' : d.error === 'authentication_failed' ? 'auth' : 'error';
  return { kind, text: text.slice(0, 600), at: d.timestamp };
}

function apply(st, d, off) {
  switch (d.type) {
    case 'ai-title': if (d.aiTitle) st.title = d.aiTitle; return;
    case 'custom-title': st.custom = d.customTitle || d.title || st.custom; return;
    case 'repl-mode': st.codeMode = d.replMode === true; return;   // Code Mode：每次保存都写一条，他中途关掉会写 false；只认最后一条（Claude Code 自己读回也是 last-wins）
    case 'queue-operation':
      if (d.operation === 'enqueue' && d.content && !isKeepWarm(String(d.content))) st.queued = { text: String(d.content), at: d.timestamp };
      return;
    case 'user': {
      if (d.isSidechain) return;
      if (isToolResult(d)) {
        if (st.inKw) return;                                 // 保温那一轮里它还是调了工具：结果也不算
        if (st.ask && d.message.content.some((x) => x && x.tool_use_id === st.ask.id)) st.ask = null;
        st.lastAt = d.timestamp; return;
      }
      if (d.origin && d.origin.kind === 'peer') {          // 别的窗口发来的话
        st.inKw = false; st.kwN = 0; st.kwErr = false;       // 有人说话了：保温从头数
        const p = notePeer(st, d);                         // 每条都记到发信人名下（架构视图：谁在给它派活）
        if (!st.open) { st.turnBy = 'peer'; st.turnPeer = p ? { pid: p.pid, name: p.name, at: Date.parse(d.timestamp) || 0 } : null; }   // 它开了这一轮：这一轮交付的是给它的，不是给你的
        if (!st.open) newTurnWrites(st, off);                   // 它开了新的一轮：「这一轮改了哪些文件」从这里重新数；一轮做到一半发来的不算
        return;
      }
      if (d.isMeta || d.isCompactSummary) return;            // 压缩对话时自动写的摘要，不是你说的话
      const text = userText(d);
      // 总控台保温（11/20 khalil-99，见 autopilot.mjs 的 KW_MARK）：只为续缓存打的一句，整轮不算——卡片上的话、交付、状态行、时间、轮数都不动，
      // 只记这一次保温的时间和连着第几次。总管 khalil-4c 11/20 23:07 的条件：它回的那个点不能顶掉卡片上挂着的【待跟进】/【待审阅】。
      // 只在没有一轮开着时认（11/21 1b 审查 M4）：万一插进了正在做的一轮，这一句本身不算（不上卡片、不算轮数），后面的回复照常算那一轮的，不被当成保温的回复吞掉
      if (isKeepWarm(text)) { if (st.open) return; st.inKw = true; st.kwAt = d.timestamp; st.kwN = (st.kwN || 0) + 1; st.kwErr = false; return; }
      const wasKw = st.inKw; st.inKw = false; st.kwN = 0; st.kwErr = false;   // 别的话（他本人、后台通知、斜杠命令）：保温从头数
      if (isInterrupt(text)) {                               // 一轮做到一半被打断：记下来；没在做事时按的 Esc 不算
        if (wasKw) return;                                   // 打断的是保温那一轮：不算停住
        if (st.open) { st.halt = { kind: 'interrupt', text: '', at: d.timestamp }; st.open = false; st.ask = null; }
        st.lastAt = d.timestamp; return;
      }
      if (!isHuman(d, text)) {
        if (!/^\s*<(command-|local-command)/.test(text)) { st.turnAt = d.timestamp; st.steps = 0; st.open = true; }   // halt 不清：被后台通知叫醒不等于它真的往下走了
        return;
      }
      st.prompt = cleanPrompt(text); st.promptAt = d.timestamp; st.turnAt = d.timestamp;
      if (isAutoPrompt(text)) { st.turnBy = 'auto'; st.turnPeer = null; }   // 总控台自动续跑发的：卡片上照样显示，但不算他本人说的话（不计轮数、架构视图不算他接手）
      else {
        st.nHuman++; st.turnBy = 'human'; st.turnPeer = null;
        st.human = { n: st.nHuman, last: Date.parse(d.timestamp) || 0 };   // 架构视图：他本人开了几轮、最近一轮什么时候（他接连说话 = 他把这个窗口接过去了）
      }
      st.steps = 0; st.note = null; st.tool = null; st.done = false; st.ask = null; st.lastAt = d.timestamp;
      st.open = true; st.halt = null;
      newTurnWrites(st, off);                                     // 他本人开了新的一轮：上一轮改过的文件到这里才清
      return;
    }
    case 'assistant': {
      if (d.isSidechain) return;
      const m = d.message;
      if (!m || !Array.isArray(m.content)) return;
      if (st.inKw) {                                         // 保温那一轮的回复：只记上下文多大、有没有报错，交付和状态都不动
        if (m.model === '<synthetic>' && d.isApiErrorMessage) { st.kwErr = true; st.inKw = false; return; }   // 报错（额度用完、登录过期）：不再保温，等下一次有人说话
        if (m.model === '<synthetic>') return;                // 别的合成记录（Code Mode 的虚拟调用之类）不算回复
        if (m.usage && typeof m.usage === 'object') { const u = m.usage, c = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((a, k) => a + (Number.isFinite(u[k]) && u[k] > 0 ? u[k] : 0), 0); if (c > 0) st.ctx = c; }
        if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') st.inKw = false;   // 这一轮完了：之后的记录照常
        return;
      }
      if (m.model === '<synthetic>') {                       // 额度用完、登录过期、请求被拒：这一轮到此为止
        if (d.isApiErrorMessage) {
          const h = haltOf(d, m);                            // 同一种错连着报（额度没恢复时每次被叫醒都会再报一遍）算同一次停住，时间记第一次的
          if (st.halt && st.halt.kind === h.kind) st.halt.text = h.text; else st.halt = h;
          st.open = false; st.ask = null; st.lastAt = d.timestamp;
        } else if (d.isVirtual === true) noteVirtual(st, d, m);   // Code Mode 脚本里真正跑的工具（见 noteVirtual）
        return;
      }
      if (typeof m.model === 'string' && m.model) { st.model = m.model.slice(0, 60); st.effort = typeof d.effort === 'string' && /^[a-z]{2,10}$/.test(d.effort) ? d.effort : null; }   // 模型和强度跟着最近一条真回复走：/model、/effort 改了，下一条回复就是新的
      if (m.usage && typeof m.usage === 'object') {          // 上下文多大：这条回复读进去的全部输入（新的 + 缓存读 + 缓存写）；没有 usage 的不记，留着上一条的
        const u = m.usage, c = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((a, k) => a + (Number.isFinite(u[k]) && u[k] > 0 ? u[k] : 0), 0);
        if (c > 0) st.ctx = c;
      }
      const final = m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence';
      st.halt = null; st.open = !final;                      // 它又开口了 = 这一轮在往下走
      for (const b of m.content) {
        if (b.type === 'text' && b.text && b.text.trim()) {
          const eta = etaIn(b.text); if (eta) st.eta = { at: d.timestamp, mins: eta };   // 它自己报的预计（见 etaIn）：这一轮最新的一行算数
          if (final) {
            st.result = (st.finalId === m.id && st.result) ? st.result + '\n\n' + b.text : b.text;
            st.finalId = m.id; st.resultAt = d.timestamp; st.note = null; st.tool = null; st.done = true;
            st.resultBy = st.turnBy || 'human';             // 这次交付是给谁的：你本人开的头，还是别的窗口
          } else { st.note = b.text; st.noteAt = d.timestamp; st.done = false; }
        } else if (b.type === 'tool_use') {
          st.steps++; if (b.name !== 'Poll') st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);   // Poll（Code Mode 等后台脚本）不顶掉上一条：卡片上留着 REPL 那句说明
          st.nTools++; if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) st.nEdits++;
          if (WRITE_TOOLS.test(b.name) && b.input) noteWrite(st, b.input.file_path || b.input.notebook_path, d.timestamp);   // 这一轮改了哪些文件 + 撞车提示（记录里的时间）
          if (b.name === 'Bash' && b.input) for (const dir of bashWriteDirs(b.input.command, d.cwd)) noteWriteDir(st, dir, d.timestamp);   // Bash 里的 git / 重定向 / cp：只进撞车
          if (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode') st.ask = { id: b.id, name: b.name, input: b.input || {} };
        }
      }
      st.lastAt = d.timestamp;
    }
  }
}
// Code Mode 的虚拟调用（11/17）：模型发的是一个 REPL（input.code 是一段 JS），脚本里真正跑的 Bash / Read / Write / Edit 各自另记一条 assistant：
// model 是 <synthetic>、isVirtual: true、isApiErrorMessage: false、stop_reason 'stop_sequence'，content 里是普通的 tool_use。
// 它们在 REPL 返回之后才一批写进记录（写的先后和时间戳的先后不一定一致），所以只交给计数和「这一轮改了哪些文件 / 撞车」：
// 不碰这一轮的状态（open / done / final / result / halt / ask）和卡片上的当前工具（留着 REPL 的说明）。stop_reason 是 stop_sequence，当成普通回复会被认成「交付了」。
function noteVirtual(st, d, m) {
  for (const b of m.content) {
    if (!b || b.type !== 'tool_use') continue;
    st.steps++; noteTool(st.files, b.input);
    st.nTools++; if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) st.nEdits++;
    if (WRITE_TOOLS.test(b.name) && b.input) noteWrite(st, b.input.file_path || b.input.notebook_path, d.timestamp);
    if (b.name === 'Bash' && b.input) for (const dir of bashWriteDirs(b.input.command, d.cwd)) noteWriteDir(st, dir, d.timestamp);
  }
}

// ── 这一轮改了哪些文件（wrote）、两个窗口往同一个仓库里写（collide）──
// 「写」只认改文件的工具：Claude 的 Edit / Write / MultiEdit / NotebookEdit（input.file_path / notebook_path），一次调用算一次（MultiEdit 改五处也是一次）；
// Codex 的 apply_patch 补丁头（*** Add / Update / Delete File:、*** Move to:），一个补丁里每个文件算一次，路径可能是相对 cwd 的。
// Bash 里认得出的写（bashWriteDirs()：git 的写子命令、重定向、tee、cp / mv）只进撞车、不进 wrote：git 命令不说写了哪些文件。sed -i、脚本落盘这类猜不准，不认。
// 子 agent 的写在它自己的记录里（subagents/），这里读不到。
// st.wrote：这一轮写过的文件（写法原样 → { n 写了几次, seq 最后一次是第几个写 }）。新的一轮开始时清：他本人说话（一轮做到一半插话也算）、或别的窗口在上一轮收尾之后发来消息
//           （和 turnBy 同一处）、Codex 他说了新的一句；被后台任务通知、定时任务叫醒不算新的一轮。交付以后照旧留着：待审阅的卡片还要列出那一轮改了什么。
// st.writes：最近写过的文件夹（写法原样 → 记录里那条的时间，毫秒），跨轮次，只给撞车提示用。只按记录里的时间算（服务第一次读尾巴时读到的旧写不算新的），没有时间的不记。
const WROTE_MAX = 20;                                // 给界面最多列这么多个，多出来的只给个数（wroteMore）
const WROTE_KEEP = 1000, WRITES_KEEP = 256;          // 内存里一轮最多记这么多个文件、撞车最多看最近这么多个（一个补丁写几千个文件也不涨内存）
const COLLIDE_MS = Number(process.env.CCBOARD_COLLIDE_MS) || 30 * 60000;   // 两个窗口这么久之内都往同一个仓库里写过 = 撞车（多窗口时最常见的事故；宁可多报，不能漏）
const WRITE_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
// 窗口自己报的「预计多久交付」（11/18 Khalil 定，全局规矩「开工报预计」）：回复里单独一行 `【预计】N 分钟`，N 是从写这一行起到交付还要多久。
// 只认行首（前面只许空白和最多两个 ` 或 *），正文里提到这条规矩、举例写「【预计】20 分钟」的不算；一段话里有几行取最后一行；
// 前面可以带「还要 / 还需 / 再」「约 / ~」；写成范围（20–30 分钟）取大的那头；小时换成分钟；不在 (0, 1440] 的不认（卡片按「今天 / 明天」写钟点，超过一天写不对）。
const ETA_RE = /^[ \t]*[`*]{0,2}【预计】[ \t]*(?:还要|还需要?|还得|再)?[ \t]*(?:约|大约|大概|~|～)?[ \t]*(\d+(?:\.\d+)?)(?:[ \t]*(?:-|–|—|~|～|到|至)[ \t]*(\d+(?:\.\d+)?))?[ \t]*(分钟|分|小时|min(?:ute)?s?|h(?:ours?|rs?)?)(?![A-Za-z])/gm;
function etaIn(text) {
  if (typeof text !== 'string' || !text.includes('【预计】')) return null;
  let out = null;
  for (const m of text.matchAll(ETA_RE)) {
    const n = Number(m[2] || m[1]) * (/^(小时|h)/.test(m[3]) ? 60 : 1);
    if (n > 0 && n <= 1440) out = Math.round(n * 10) / 10;
  }
  return out;
}
// 新的一轮从这里算：「这一轮改了哪些文件」和它报的预计都清掉（被后台任务叫醒、一轮做到一半别的窗口发来的话都不走这里，预计照旧算数）
function newTurnWrites(st, off) { st.wrote = null; st.wroteOver = 0; st.turnOff = off; st.eta = null; }
function noteWrite(st, file, ts) {
  if (typeof file !== 'string' || !(file = file.trim()) || file.length > 1024) return;
  if (!st.wrote) st.wrote = new Map();
  st.wseq = (st.wseq || 0) + 1;
  const w = st.wrote.get(file);
  if (w) { w.n++; w.seq = st.wseq; }
  else if (st.wrote.size < WROTE_KEEP) st.wrote.set(file, { n: 1, seq: st.wseq });
  else st.wroteOver = (st.wroteOver || 0) + 1;      // 超出内存上限的写只计数（这时 wroteMore 按写的次数算，是个约数）
  noteWriteDir(st, path.dirname(file), ts);          // 撞车只看写在哪个文件夹（相对路径的 dirname 照样相对，出状态时再按工作目录补全）
}
function noteWriteDir(st, dir, ts) {
  const at = Date.parse(ts) || 0; if (!at || typeof dir !== 'string' || !dir) return;
  if (!st.writes) st.writes = new Map();
  st.writes.delete(dir); st.writes.set(dir, at);     // Map 按插入先后：最近写的在最后，满了丢最前面（最久没写的）
  if (st.writes.size > WRITES_KEEP) st.writes.delete(st.writes.keys().next().value);
}
// Codex 一次工具调用里补丁头写到的文件。补丁可能直接是 input（apply_patch 工具），也可能包在 exec 的 JS 源码、function_call 的 JSON 参数里（换行是 \n 两个字符）。
// 补丁头只认行首（真换行之后、或 \n 两个字符之后）：源码、grep 命令、说明文字里提到「*** Update File:」的不算
function patchFiles(...xs) {
  const out = new Set();
  for (const x of xs) {
    const s = typeof x === 'string' ? x : x ? JSON.stringify(x) : '';
    if (!s.includes('*** Begin Patch')) continue;
    for (const m of s.matchAll(/(?:^|[\n\r]|(?<!\\)\\n)\*\*\* (?:(?:Add|Update|Delete) File|Move to): ([^\n\r\\"]+)/g)) if (m[1].trim()) out.add(m[1].trim());
  }
  return out;
}
// Bash 里认得出的写在哪个文件夹（11/16 评审：本机 24 小时的真实记录里，撞车 6 段有 4 段只有 Bash 里的 git / cp 才看得出来，合补丁的窗口恰好全靠它）。只给撞车用。
// 认：git 的写子命令（仓库 = -C 给的，或当时所在的文件夹）；重定向 > >>（/dev/ 下的不算）；tee 的文件；cp / mv 的目标（最后一个参数）。
// 「当时所在的文件夹」从这条记录的 cwd 起，跟着命令里的 cd 走；cd 到认不出的地方（带 $、cd -）以后，相对路径和不带 -C 的 git 都不认。
// 先去掉 heredoc 的正文（<<EOF … EOF 里是写进文件、交给 python 的字，不是命令），再按引号分词；带 $ 变量、反引号、通配符的路径猜不准，不认。
const GIT_WRITE = new Set(['add', 'commit', 'checkout', 'switch', 'merge', 'apply', 'am', 'reset', 'rebase', 'cherry-pick', 'revert', 'stash', 'restore', 'rm', 'mv', 'pull']);
const SH_WRAP = new Set(['sudo', 'command', 'env', 'nohup', 'time', 'exec']);
function bashWriteDirs(cmd, cwd) {
  const out = new Set();
  if (typeof cmd !== 'string' || !cmd || cmd.length > 20000) return out;
  const kept = []; let end = null;
  for (const l of cmd.split('\n')) {
    if (end !== null) { if (l.replace(/^\t+/, '').trimEnd() === end) end = null; continue; }
    kept.push(l); const m = l.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/); if (m) end = m[2];
  }
  const s = kept.join('\n'), toks = []; let cur = null, q = null;
  const word = () => { if (cur !== null) { toks.push(cur); cur = null; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; else if (ch === '\\' && q === '"' && /["\\$`]/.test(s[i + 1] || '')) cur += s[++i]; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; if (cur === null) cur = ''; continue; }
    if (ch === '\\') { if (s[i + 1] === '\n') i++; else if (i + 1 < s.length) cur = (cur || '') + s[++i]; continue; }
    if (ch === ' ' || ch === '\t') { word(); continue; }
    const op = /^(?:&&|\|\||>>|[;\n|()&<>])/.exec(s.slice(i, i + 2));
    if (op) { if (op[0][0] === '>' && cur !== null && /^\d$/.test(cur)) cur = null; word(); toks.push({ op: op[0] }); i += op[0].length - 1; continue; }   // 2> 的 2 是文件描述符
    cur = (cur || '') + ch;
  }
  word();
  let dir = typeof cwd === 'string' && path.isAbsolute(cwd) ? path.resolve(cwd) : null, w = [];
  const abs = (p, from = dir) => (typeof p !== 'string' || !p || /[$`*?{}]/.test(p) ? null : /^~(?=\/|$)/.test(p) ? path.resolve(HOME + p.slice(1)) : path.isAbsolute(p) ? path.resolve(p) : from ? path.resolve(from, p) : null);
  const note = (p, asIs) => { const a = abs(p); if (a && !/^\/dev(\/|$)/.test(a)) out.add(asIs ? a : path.dirname(a)); };
  const run = () => {
    const a = w; w = [];
    let i = 0; while (i < a.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[i]) || SH_WRAP.has(a[i]))) i++;   // 前面的 VAR=值、sudo / env 这类
    const c = a[i] ? path.basename(a[i]) : '', r = a.slice(i + 1);
    if (c === 'cd') { dir = !r.length ? HOME : r[0] === '-' ? null : abs(r[0]); return; }
    if (c === 'git') {
      let repo = dir, k = 0;
      while (k < r.length && r[k].startsWith('-')) { if (r[k] === '-C') { repo = abs(r[k + 1], repo); k += 2; } else if (/^(-c|--git-dir|--work-tree|--namespace)$/.test(r[k])) k += 2; else k++; }
      if (repo && GIT_WRITE.has(r[k])) out.add(repo);
      return;
    }
    if (c === 'tee') { for (const x of r) if (!x.startsWith('-')) note(x); return; }
    if (c === 'cp' || c === 'mv') { const xs = r.filter((x) => !x.startsWith('-')); if (xs.length >= 2) note(xs[xs.length - 1], true); }   // 目标可能是文件夹也可能是文件：从它本身往上找仓库
  };
  for (let t = 0; t < toks.length; t++) {
    const x = toks[t];
    if (typeof x === 'string') { w.push(x); continue; }
    if (x.op === '>' || x.op === '>>') { if (typeof toks[t + 1] === 'string') { note(toks[t + 1]); t++; } continue; }
    if (x.op === '<') { if (typeof toks[t + 1] === 'string') t++; continue; }
    run();                                           // ; && || | 换行 ( ) & 都是一条命令的边界
  }
  run();
  return out;
}
const wrotePath = (p, cwd) => tildeOf(absOf(p, cwd) || p);
const tildeOf = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
function absOf(p, cwd) {                             // 写法原样的路径 → 完整路径；相对路径按会话的工作目录算，没有工作目录就不算
  if (/^~(?=\/|$)/.test(p)) return path.resolve(HOME + p.slice(1));
  if (path.isAbsolute(p)) return path.resolve(p);
  return cwd && path.isAbsolute(cwd) ? path.resolve(cwd, p) : null;
}
// 仓库 = 最近一层有 .git 的上级文件夹（.git 是文件夹 = 普通仓库；是文件 = worktree、子模块，各算各的）。只用 existsSync 往上走，不起 git。
// 主目录和更上层不算：有人把整个主目录放进 git 时，不能让所有窗口互相撞车。结果缓存一分钟（之后才 git init 的也认得出）。
const repoCache = new Map(), REPO_TTL = 60000;
function repoOf(dir) {
  const now = Date.now(), c = repoCache.get(dir);
  if (c && now - c.at < REPO_TTL) return c.repo;
  let repo = null;
  for (let d = dir; d !== HOME && !HOME.startsWith(d + '/') && d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) { repo = d; break; }
  }
  if (repo) try { repo = fs.realpathSync(repo); } catch {}   // 经符号链接写进同一个仓库的（link → repo、/tmp → /private/tmp）认成同一个
  if (repoCache.size > 4000) repoCache.clear();
  repoCache.set(dir, { repo, at: now });
  return repo;
}
// 出状态时调：all 里每个会话挂 wrote / wroteMore；wall（墙上的会话）两两比，30 分钟内往同一个仓库里写过的互相挂 collide。
// wrote：[{ path（~ 开头的缩写；相对路径按会话的工作目录补全，没有工作目录才原样）, n }]，写得多的在前，一样多的最近写的在前，最多 20 个；wroteMore = 没列出来的个数（0 = 都列了）。
// collide：[{ repo: '~/Projects/x', with: [{ sid, name（卡片上的标题） }] }]，没有撞车是 null。同一个会话写几次都只算它自己一个，不会撞自己。
function markWrites(all, wall) {
  const stOf = (o) => { const tr = (o.provider === 'codex' ? codexTracks : tracks).get(o.sid); return tr ? tr.st : null; };
  for (const o of all) {
    // 相对路径（Codex 补丁头常见）按会话的工作目录补全，界面上每一行都点得开；补全后是同一个文件的（一次写相对、一次写绝对）合成一行
    const st = stOf(o), cwd = String(o.cwd || '').replace(/^~(?=$|\/)/, HOME), m = new Map();
    if (st && st.wrote) for (const [p, w] of st.wrote) { const k = wrotePath(p, cwd), x = m.get(k); if (x) { x.n += w.n; x.seq = Math.max(x.seq, w.seq); } else m.set(k, { n: w.n, seq: w.seq }); }
    const list = [...m].sort((a, b) => (b[1].n - a[1].n) || (b[1].seq - a[1].seq));
    o.wrote = list.slice(0, WROTE_MAX).map(([p, w]) => ({ path: p, n: w.n }));
    o.wroteMore = Math.max(0, list.length - WROTE_MAX) + ((st && st.wroteOver) || 0);
    o.collide = null;
  }
  const now = Date.now(), byRepo = new Map();       // 仓库 → 这段时间里往里写过的会话（sid → 会话）
  for (const o of wall) {
    const st = stOf(o); if (!st || !st.writes) continue;
    const cwd = String(o.cwd || '').replace(/^~(?=$|\/)/, HOME);
    for (const [p, at] of st.writes) {
      if (now - at > COLLIDE_MS) continue;           // 只按记录里那条的时间算，不按服务读到它的时间
      const abs = absOf(p, cwd); if (!abs) continue;
      const repo = repoOf(abs); if (!repo) continue;  // st.writes 记的是文件夹；不在任何仓库里的不算
      let m = byRepo.get(repo); if (!m) byRepo.set(repo, (m = new Map()));
      m.set(o.sid, o);
    }
  }
  for (const [repo, m] of byRepo) {
    if (m.size < 2) continue;
    for (const o of m.values()) (o.collide || (o.collide = [])).push({ repo: tildeOf(repo), with: [...m.values()].filter((x) => x !== o).map((x) => ({ sid: x.sid, name: x.title })) });
  }
}

// 按需从已扫描的这一轮读取；状态只存轮首字节，不缓存补丁或文件内容。
const DIFF_MAX = 512 * 1024;
function patchTexts(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'object') return Object.values(value).flatMap(x => patchTexts(x, depth + 1));
  if (typeof value !== 'string' || !value.includes('*** Begin Patch')) return [];
  if (value.startsWith('*** Begin Patch\n') || value.startsWith('*** Begin Patch\r\n')) return [value];
  try { const parsed = JSON.parse(value); if (parsed !== value) return patchTexts(parsed, depth + 1); } catch {}
  const quoted = [...value.matchAll(/"(?:\\.|[^"\\])*"/g)].flatMap(m => { try { return patchTexts(JSON.parse(m[0]), depth + 1); } catch { return []; } });
  return quoted.length ? quoted : [value.replace(/(?<!\\)\\n/g, '\n')];
}
function filePatches(patch, wanted, cwd) {
  const blocks = [], re = /^\*\*\* (?:Add|Update|Delete) File: (.+)\r?$/gm;
  const heads = [...patch.matchAll(re)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i], stop = /^\*\*\* End Patch\r?$/m.exec(patch.slice(h.index));
    const end = Math.min(heads[i + 1]?.index ?? patch.length, stop ? h.index + stop.index : patch.length);
    const block = patch.slice(h.index, end);
    const files = [h[1].trim(), ...[...block.matchAll(/^\*\*\* Move to: (.+)\r?$/gm)].map(m => m[1].trim())];
    if (files.some(f => wrotePath(f, cwd) === wanted)) blocks.push(block);
  }
  return blocks;
}
function capDiff(out) {
  const size = () => Buffer.byteLength(JSON.stringify(out));
  if (size() <= DIFF_MAX) return out;
  out.truncated = true;
  const full = out.items; out.items = [];
  for (const item of full) {
    out.items.push(item);
    if (size() <= DIFF_MAX) continue;
    // 最后能容下的一笔只给前面几行；后面的笔不再给。
    const last = { ...item }; out.items[out.items.length - 1] = last;
    if (typeof item.patch === 'string') {
      let lo = 0, hi = item.patch.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); last.patch = item.patch.slice(0, mid); if (size() <= DIFF_MAX) lo = mid; else hi = mid - 1; }
      last.patch = item.patch.slice(0, lo);
    } else if (Array.isArray(item.hunks)) {
      last.hunks = [];
      for (const h of item.hunks) {
        const hh = { ...h, lines: [] }; last.hunks.push(hh);
        if (size() > DIFF_MAX) { last.hunks.pop(); break; }
        let lo = 0, hi = h.lines.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); hh.lines = h.lines.slice(0, mid); if (size() <= DIFF_MAX) lo = mid; else hi = mid - 1; }
        hh.lines = h.lines.slice(0, lo); if (lo < h.lines.length) break;
      }
    }
    if (size() > DIFF_MAX) out.items.pop();
    break;
  }
  return out;
}
function readDiff(tr, wanted, cwd) {
  const items = [], calls = new Map();
  // 轮首消息不含补丁；尾巴起点与状态扫描一样跳过首行。
  scanRange(tr.file, tr.st.turnOff, tr.pos, tr.st.turnOff > 0, null, (d) => {
    if (d.isSidechain) return;
    const content = d.message && d.message.content;
    if (!tr.codex && d.type === 'assistant' && Array.isArray(content) && (d.message.model !== '<synthetic>' || d.isVirtual === true)) {
      for (const b of content) if (b && b.type === 'tool_use' && WRITE_TOOLS.test(b.name) && b.input) {
        const file = b.input.file_path || b.input.notebook_path;
        if (typeof file === 'string') calls.set(b.id, { tool: b.name, at: d.timestamp, file: wrotePath(file, cwd) });
      }
    } else if (!tr.codex && d.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        const call = b && b.type === 'tool_result' && calls.get(b.tool_use_id);
        if (!call || call.file !== wanted) continue;
        const item = { at: call.at, tool: call.tool, hunks: [] }, result = d.toolUseResult;
        if (b.is_error || !result) item.failed = true;
        else if (Array.isArray(result.structuredPatch) && result.structuredPatch.length) item.hunks = result.structuredPatch;
        else if (call.tool === 'Write' && result.type === 'create' && typeof result.content === 'string') {
          const lines = result.content === '' ? [] : result.content.replace(/\r\n/g, '\n').split('\n');
          if (lines.length && lines[lines.length - 1] === '') lines.pop();
          item.create = true; item.hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map(x => '+' + x) }];
        } else item.nopatch = true;
        items.push(item);
      }
    } else if (tr.codex && d.type === 'response_item') {
      const p = d.payload || {};
      if (/_call$/.test(p.type || '')) for (const patch of [...patchTexts(p.input), ...patchTexts(p.arguments)]) {
        for (const block of filePatches(patch, wanted, cwd)) items.push({ at: d.timestamp, tool: 'apply_patch', patch: block });
      }
    }
  });
  return capDiff({ ok: true, path: wanted, items, truncated: false });
}

// ── Codex CLI 的会话记录（~/.codex/sessions/年/月/日/rollout-*.jsonl）──
function codexText(content) {
  return Array.isArray(content) ? content.filter((x) => x && typeof x.text === 'string').map((x) => x.text).join('\n') : '';
}
// Codex 会把 AGENTS.md、环境信息也记成「用户消息」，这些不是你说的话
const codexInjected = (t) => /^\s*</.test(t) || /^\s*# AGENTS\.md instructions/.test(t) || /<INSTRUCTIONS>/.test(t.slice(0, 300));
function newCodexState() {
  return { files: new Map(), nHuman: 0, nTools: 0, nEdits: 0, title: null, prompt: null, promptAt: null, firstPrompt: null, result: null, resultAt: null, note: null, noteAt: null,
    tool: null, steps: 0, turnAt: null, busy: false, done: false, lastText: null, lastAt: null, queued: null, halt: null };
}
function applyCodex(st, d, off) {
  const p = d.payload || {};
  if (d.type === 'event_msg') {
    if (p.type === 'task_started') { st.busy = true; st.turnAt = d.timestamp; st.steps = 0; st.note = null; st.tool = null; st.done = false; st.lastText = null; st.halt = null; }
    else if (p.type === 'task_complete') {
      st.busy = false; const text = (p.last_agent_message && String(p.last_agent_message)) || st.lastText;
      if (text) { st.result = text; st.resultAt = d.timestamp; st.done = true; st.halt = null; }
      st.note = null; st.tool = null;
    } else if (p.type === 'turn_aborted') { st.busy = false; st.halt = { kind: 'interrupt', text: '', at: d.timestamp }; }
    else if (p.type === 'error' && p.message) { st.halt = { kind: 'error', text: String(p.message).slice(0, 600), at: d.timestamp }; }
    else if (p.type === 'agent_message' && p.message) { st.note = String(p.message); st.noteAt = d.timestamp; st.lastText = st.note; const eta = etaIn(st.note); if (eta) st.eta = { at: d.timestamp, mins: eta }; }
  } else if (d.type === 'response_item') {
    if (p.type === 'message' && p.role === 'user') {
      const text = codexText(p.content);
      if (text.trim() && !codexInjected(text)) { st.prompt = cleanPrompt(text); st.promptAt = d.timestamp; st.nHuman++; if (!st.firstPrompt) st.firstPrompt = st.prompt; }
      if (text.trim() && !codexInjected(text)) newTurnWrites(st, off);   // 他说了新的一句：「这一轮改了哪些文件」从这里重新数
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = codexText(p.content);
      if (text.trim()) { st.lastText = text; if (st.busy) { st.note = text; st.noteAt = d.timestamp; } const eta = etaIn(text); if (eta) st.eta = { at: d.timestamp, mins: eta }; }
    } else if (/_call$/.test(p.type || '')) {
      st.steps++; st.tool = String(p.name || p.type || '').replace(/_/g, ' ').slice(0, 40); noteTool(st.files, p.arguments || p.input || ''); st.nTools++; if (/apply_patch/.test(p.name || '')) st.nEdits++;
      for (const f of patchFiles(p.input, p.arguments)) noteWrite(st, f, d.timestamp);   // 补丁头写到的文件（这一轮改了哪些 + 撞车提示）
    }
  }
  st.lastAt = d.timestamp || st.lastAt;
}
function readCodexTurns(file, want) {
  const size = fs.statSync(file).size; let span = Math.min(size, 8 << 20), turns = [];
  for (;;) {
    turns = []; let cur = null, lastText = null;
    scanRange(file, size - span, size, span < size, null, (d) => {
      const p = d.payload || {};
      if (d.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        const text = codexText(p.content);
        if (text.trim() && !codexInjected(text)) { cur = { prompt: cleanPrompt(text), at: d.timestamp, results: [], steps: 0 }; turns.push(cur); lastText = null; }
      } else if (!cur) { return; }
      else if (d.type === 'response_item' && p.type === 'message' && p.role === 'assistant') { const t = codexText(p.content); if (t.trim()) lastText = t; }
      else if (d.type === 'response_item' && /_call$/.test(p.type || '')) cur.steps++;
      else if (d.type === 'event_msg' && p.type === 'task_complete') { const t = (p.last_agent_message && String(p.last_agent_message)) || lastText; if (t) cur.results.push({ text: t, at: d.timestamp }); }
    });
    if (turns.length >= want || span >= size || span >= (64 << 20)) break;
    span = Math.min(size, span * 4);
  }
  return turns.slice(-want);
}

// 逐行读文件的一段，把每行 JSON 交给 onObj；体积大的记账行不解析
function scanRange(file, from, to, dropFirst, carry, onObj, carryOff = from - (carry ? carry.length : 0)) {
  const fd = fs.openSync(file, 'r');
  let rest = carry || Buffer.alloc(0), restOff = carryOff;
  try {
    const CH = 1 << 20;
    let off = from, first = dropFirst;
    while (off < to) {
      const n = Math.min(CH, to - off);
      const b = Buffer.allocUnsafe(n);
      const r = fs.readSync(fd, b, 0, n, off);
      if (r <= 0) break;
      let chunkOff = off; off += r;
      let chunk = r < n ? b.subarray(0, r) : b;
      if (first) {                       // 从文件中间开始读：丢掉开头那半行
        const nl = chunk.indexOf(10);
        if (nl < 0) continue;
        chunk = chunk.subarray(nl + 1); chunkOff += nl + 1; first = false;
      }
      const dataOff = rest.length ? restOff : chunkOff;
      let data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let start = 0;
      for (;;) {
        const nl = data.indexOf(10, start);
        if (nl < 0) break;
        const lineOff = dataOff + start;
        const line = data.subarray(start, nl); start = nl + 1;
        if (line.length < 12) continue;
        const head = line.subarray(0, 24).toString('latin1');
        if (head.startsWith('{"type":"api-request') || head.startsWith('{"type":"file-history')) continue;
        let d; try { d = JSON.parse(line.toString('utf8')); } catch { continue; }
        if (d && typeof d === 'object') onObj(d, lineOff);
      }
      rest = Buffer.from(data.subarray(start)); restOff = dataOff + start;
    }
  } finally { fs.closeSync(fd); }
  return rest;
}

function locate(sid, cwd) {
  const cand = path.join(PROJ_DIR, String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'), sid + '.jsonl');
  if (fs.existsSync(cand)) return cand;
  try {
    for (const d of fs.readdirSync(PROJ_DIR)) {
      const p = path.join(PROJ_DIR, d, sid + '.jsonl');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

class Track {
  constructor(sid, cwd, codexFile) { this.sid = sid; this.cwd = cwd; this.file = codexFile || null; this.pos = 0; this.rest = null; this.restOff = 0;
    this.codex = !!codexFile; this.mk = this.codex ? newCodexState : newState; this.ap = this.codex ? applyCodex : apply; this.st = this.mk(); this.loaded = false;
    this.quiet = 0; this.mark = ''; this.sideM = 0; this.sideAt = 0; this.sub = 0; }
  // 「显示在运行、却没有新记录」累计了多久。只在服务自己醒着的时候累计（电脑睡一觉不算），有新记录就清零。
  // 派出去的子任务写在旁边的 subagents 文件夹里，那里有动静也算。
  // live = 在跑（busy / shell）：只对它们每 SIDE_MS 读一次 subagents 文件夹（side()），同一次 readdir 既给这里看最新的改动时间，也数正在跑的子 agent（sub）；歇着的不读，sub 记 0。
  tick(busy, dt, live = busy) {
    if (!live) this.sub = 0;
    else if (!this.codex && this.file && Date.now() - this.sideAt > SIDE_MS) this.side();
    const mark = this.pos + ':' + this.sideM;            // 子 agent 有新动静 → sideM 变了 → 和有新记录一样清零
    if (!busy || mark !== this.mark) { this.mark = mark; this.quiet = 0; return 0; }
    this.quiet += dt;
    return this.quiet;
  }
  side() {
    const now = Date.now(); this.sideAt = now; let m = 0, n = 0;
    try {
      const dir = this.file.replace(/\.jsonl$/, '') + '/subagents';
      for (const f of fs.readdirSync(dir)) {
        let t = 0; try { t = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
        if (t > m) m = t;
        if (f.endsWith('.jsonl') && now - t < SUB_RECENT) n++;           // 子 agent 的记录 90 秒内有改动 = 还在跑（旁边的 .meta.json 不算）
      }
    } catch {}
    this.sub = n; if (m > this.sideM) this.sideM = m;
  }
  refresh() {
    if (!this.file) { this.file = locate(this.sid, this.cwd); if (!this.file) return; }
    let size; try { size = fs.statSync(this.file).size; } catch { this.file = null; return; }
    if (this.loaded && size < this.pos) this.loaded = false;
    if (!this.loaded) {
      let span = Math.min(size, TAIL_FIRST);
      for (;;) {                          // 先读尾巴；没读到用户的话就再往前多读
        this.st = this.mk(); this.st.turnOff = size - span;
        this.rest = scanRange(this.file, size - span, size, span < size, null, (d, off) => this.ap(this.st, d, off));
        if (this.st.prompt || span >= size || span >= TAIL_MAX) break;
        span = Math.min(size, TAIL_MAX, span * 4);
      }
      this.restOff = size - this.rest.length; this.pos = size; this.loaded = true; return;
    }
    if (size > this.pos) {
      this.rest = scanRange(this.file, this.pos, size, false, this.rest, (d, off) => this.ap(this.st, d, off), this.restOff);
      this.restOff = size - this.rest.length; this.pos = size;
    }
  }
}

// 干净的对话：每轮只留「你说的」和「它交付的」
function readTurns(file, want) {
  const size = fs.statSync(file).size;
  let span = Math.min(size, 8 << 20), turns = [];
  for (;;) {
    turns = []; let cur = null, finalId = null, kw = false, open = false;   // open：有一轮开着、还没收尾（和 apply() 的 st.open 一样，保温那句插在一轮中间时不认）
    scanRange(file, size - span, size, span < size, null, (d) => {
      if (d.isSidechain) return;
      if (kw && d.type === 'assistant') {                 // 保温那一轮的回复（含它还是调了的工具）：不算步数、不算交付；这一轮的最后一条（或报错）之后照常
        const m = d.message || {};
        if (d.isApiErrorMessage || (d.isVirtual !== true && (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence'))) kw = false;
        return;
      }
      if (d.type === 'assistant' && d.message) {          // 和 apply() 一样：报错收尾；它开口了就看这一条是不是最后一条（Code Mode 的虚拟调用不算开口）
        if (d.isApiErrorMessage) open = false;
        else if (d.message.model !== '<synthetic>') open = !(d.message.stop_reason === 'end_turn' || d.message.stop_reason === 'stop_sequence');
      }
      if (d.type === 'user' && !isToolResult(d) && !d.isMeta && !d.isCompactSummary) {
        const text = userText(d);
        if (isKeepWarm(text)) { if (!open) kw = true; return; }   // 总控台保温那一轮：不算一轮，它回的点也不算交付；插在一轮中间的不认，这一句本身也不算
        kw = false;
        if (isInterrupt(text)) open = false;
        else if (isHuman(d, text) || (!(d.origin && d.origin.kind === 'peer') && !/^\s*<(command-|local-command)/.test(text))) open = true;   // 他开了一轮、后台通知叫醒它；别的窗口的话和斜杠命令不动（apply() 也不动）
        if (isHuman(d, text) && !isInterrupt(text)) { cur = { prompt: cleanPrompt(text), at: d.timestamp, results: [], steps: 0 }; turns.push(cur); finalId = null; }
      } else if (d.type === 'assistant' && cur && d.message && Array.isArray(d.message.content) && d.message.model !== '<synthetic>') {
        const m = d.message, final = m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence';
        for (const b of m.content) {
          if (b.type === 'tool_use') cur.steps++;
          else if (b.type === 'text' && b.text && b.text.trim() && final) {
            if (finalId === m.id && cur.results.length) cur.results[cur.results.length - 1].text += '\n\n' + b.text;
            else cur.results.push({ text: b.text, at: d.timestamp });
            finalId = m.id;
          }
        }
      } else if (d.type === 'assistant' && cur && d.isVirtual === true && !d.isApiErrorMessage && d.message && d.message.model === '<synthetic>' && Array.isArray(d.message.content)) {
        for (const b of d.message.content) if (b && b.type === 'tool_use') cur.steps++;   // Code Mode 脚本里真正跑的工具：只算步数，不当交付（见 noteVirtual）
      }
    });
    if (turns.length >= want || span >= size || span >= (64 << 20)) break;
    span = Math.min(size, span * 4);
  }
  return turns.slice(-want);
}

// ───────────── 会话登记 ─────────────

const tracks = new Map();
let sessions = [];       // 给界面的列表（不含已归档）
let sessionsScanned = false;           // 启动恢复须等会话登记至少读过一轮
let allSessions = [];    // 所有活着的会话
let otherCount = 0;
let notices = [];        // 给界面弹一次的提示

let archive = { items: {} };
try { const a = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); if (a && a.items) archive = a; } catch {}
// 一起退出的记录（P0-0）：{ 编号: { id, at, last, sids, state, done, failed, … } }。读进来先核形状，坏的丢掉
archive.crashes = Object.fromEntries(Object.entries(archive.crashes && typeof archive.crashes === 'object' && !Array.isArray(archive.crashes) ? archive.crashes : {})
  .filter(([k, c]) => c && typeof c === 'object' && c.id === k && Number.isFinite(c.at) && Array.isArray(c.sids) && Array.isArray(c.failed) && Number.isFinite(c.done)));
function saveArchive() { if (READONLY) return; const tmp = ARCHIVE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(archive, null, 1)); fs.renameSync(tmp, ARCHIVE_FILE); }
const stopTimers = new Map();
const processed = new Map();   // 你点过「审完了」的：sid → { at: 那一次交付的时间, seenAt: 服务第一次知道的时间 }。界面发来，落盘 processed.json；不在墙上的会话由 watchTidy 清掉
// 落盘：线上服务一天会重启好几次（数 server.log 的 tmux -S 启动行就知道）。只在内存的话，手机上点的「审完了」、重启时手机又没开着，
// Mac 上那几张就回到待审阅，直到手机再打开重发。读回来的 seenAt 记成起服务的时刻：自动收工的 fast 线从这时起再等 10 分钟，和以前靠页面重发时一样，不会因为落盘收得更早
const PROCESSED_FILE = path.join(DATA, 'processed.json'), PROC_T0 = Date.now();
try {
  const j = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
  if (j && typeof j === 'object' && !Array.isArray(j)) for (const [k, at] of Object.entries(j)) if (/^[\w-]{8,64}$/.test(k) && typeof at === 'string') processed.set(k, { at, seenAt: PROC_T0 });
} catch {}
function saveProcessed() {
  if (READONLY) return;
  const out = {}; for (const [k, p] of processed) out[k] = p.at;
  try { const tmp = PROCESSED_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, PROCESSED_FILE); } catch (e) { console.log(`processed ${new Date().toISOString()} 写不进 processed.json：${e.message}`); }
}
// /api/state 的 processed：{ sid: 那一次交付的时间 }。只给墙上的、记的时间和它现在的 resultAt 对得上的（它又交付了一次，旧的那笔就不算）；
// 按 sid 排，会话先后变了不算「变了」（只回变过的那套按 JSON 比）。几台设备（Mac 窗口、手机）都读它：一台点了「审完了」，别的下一拍跟着算处理过
function processedView(list) {
  const o = {};
  for (const x of [...list].sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0))) { const p = processed.get(x.sid); if (p && x.resultAt && p.at === String(x.resultAt)) o[x.sid] = p.at; }
  return o;
}

const CODEX_HOME = path.join(HOME, '.codex');
const AGENTS_FILE = path.join(DATA, 'agents.json');   // 总控台起的 Codex 会话：tmux 名 → {cwd, at, prompt, sid, rollout}
let agents = {};
try { agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) || {}; } catch {}
function saveAgents() { if (READONLY) return; const tmp = AGENTS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(agents, null, 1)); fs.renameSync(tmp, AGENTS_FILE); }
const codexTracks = new Map();
const p2 = (n) => String(n).padStart(2, '0');
function findRollout(a) {                                  // 启动之后新出现的、文件夹对得上的那份记录
  const claimed = new Set(Object.values(agents).map((x) => x.rollout).filter(Boolean));
  for (const off of [0, 86400000]) {
    const dt = new Date(a.at + off);
    const dir = path.join(CODEX_HOME, 'sessions', String(dt.getFullYear()), p2(dt.getMonth() + 1), p2(dt.getDate()));
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f); if (claimed.has(fp)) continue;
      let head = '';
      try { if (fs.statSync(fp).birthtimeMs < a.at - 4000) continue; const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd); head = b.subarray(0, n).toString('utf8'); } catch { continue; }
      const cwd = (head.match(/"cwd":"((?:[^"\\]|\\.)*)"/) || [])[1];
      const id = (head.match(/"session_id":"([^"]+)"/) || head.match(/"id":"([0-9a-f-]{30,})"/) || [])[1];
      if (!id || !cwd) continue;
      let real = cwd; try { real = JSON.parse('"' + cwd + '"'); } catch {}
      const same = (x, y) => { try { return fs.realpathSync(x) === fs.realpathSync(y); } catch { return x === y; } };
      if (same(real, a.cwd)) return { rollout: fp, sid: id };
    }
  }
  return null;
}
function codexSessions(seen) {
  const out = []; let dirty = false;
  for (const [name, a] of Object.entries(agents)) {
    const pane = panes.find((x) => x.name === name);
    if (!pane) { if (panesAt > a.at + 6000) { delete agents[name]; if (a.sid) codexTracks.delete(a.sid); dirty = true; } continue; }
    if (!a.rollout) { const f = findRollout(a); if (!f) continue; a.rollout = f.rollout; a.sid = f.sid; dirty = true; }
    let tr = codexTracks.get(a.sid);
    if (!tr) { tr = new Track(a.sid, a.cwd, a.rollout); codexTracks.set(a.sid, tr); }
    try { tr.refresh(); } catch {}
    const st = tr.st; seen.add(a.sid);
    const first = a.prompt || st.firstPrompt || 'Codex 会话';
    const ws = waitScreens.get(name);
    const o = { sid: a.sid, provider: 'codex', pid: pane.pid, cwd: a.cwd, startedAt: a.at, status: ws && ws.dialog ? 'waiting' : st.busy ? 'busy' : 'idle', statusAt: null,
      screen: ws ? ws.screen : null, dialog: ws ? ws.dialog : null,
      regName: name, userNamed: false, title: first.replace(/\s+/g, ' ').slice(0, 28), aiTitle: null, custom: null,
      prompt: st.prompt || a.prompt || null, promptAt: st.promptAt, ...deliver(st.result), resultAt: st.resultAt, done: st.done,
      note: st.note, noteAt: st.noteAt, tool: st.tool, steps: st.steps, turnAt: st.turnAt, lastAt: st.lastAt, ask: null,
      channel: 'tmux', tmux: name, order: 5e5, model: a.model || null, effort: a.effort || null, ctx: null, sub: 0, halt: st.halt, file: tr.file, codeMode: false, eta: st.eta || null };   // Codex 读不到上下文和子 agent；Code Mode 只有 Claude Code 有
    o.quiet = tr.tick(o.status === 'busy', scanDt); o.alert = alertOf(o);
    o.project = classify(st.files, { title: o.title, prompt: o.prompt, cwd: o.cwd, home: HOME, pin: pinOf(name) });
    out.push(o);
  }
  if (dirty) saveAgents();
  return out;
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// ───────────── 停住了要让人知道 ─────────────
// 一个会话现在要不要你去跟进。key 相同 = 同一件事：界面上点过「先不管」、系统通知发过一次，就不再重复。
// ── 交付摘要：它这一轮最后那段话里，扫一眼就要知道的事 ──
// head = 一句结论；ask = 要你做的那一件事；need = reply（待跟进：要你本人做决定或动手）| review（待审阅：给你的结果）| fyi（无需处理：回给别的窗口的、过程汇报）| bg（它说还在后台跑）。
// Khalil 11/12 16:05 定的：「待跟进的意思就是 Agent 做完，需要我做决定」「有时候是交付给其他 Agent 的，并不是交给我的，要分清楚」。
// 它自己在最后写了一行【待跟进】/【待审阅】/【进展】（旧写法【在跑】）就以它为准（tag = true），那一行从正文里拿掉；没写就按正文猜：
// 问你、请你定 / 选 / 回一句 → 待跟进；写明「不需要你…」或这一轮是别的窗口开的头（by = 'peer'）→ 无需处理；其余 → 待审阅。
// skip = 正文开头那一段已经整段当成 head 显示了，界面从这里往后显示，同一句话不出现两遍。
// 英文的 [Needs you] / [Review] / [FYI]（公开仓库 PR #8）只认代码块外的最后一个非空行：正文中间一行 [FYI] 会抢走结尾问你的话（卡片变灰，问题容易漏看），
// 代码块里举例写的不算，`[Review](网址)` 这种链接也不算（后面紧跟「(」）。中文的照旧从下往上找。
const DG_TAG = /^\s*(?:\*\*)?(?:【(待跟进|待审阅|在跑|进展)】|\[(needs you|review|fyi)\](?!\())(?:\*\*)?\s*[:：]?\s*(.+?)\s*$/i;
const DG_STATUS = { 待跟进: 'reply', 待审阅: 'review', 在跑: 'bg', 进展: 'fyi', 'needs you': 'reply', review: 'review', fyi: 'fyi' };
const DG_TRIO = /^\s*(?:[-*]\s*)?(?:\*\*)?(做了什么|怎么做的|一个新词)(?:\*\*)?\s*[:：]/;
const DG_LEAD = /^(结论|一句话|总结|TL;?DR|简单说|先说结论)\s*[:：]\s*/i;
const DG_COND = /的话|如果|要是|假如|万一|不满意|有问题|不对劲|随时|想要|想停|想换|不急|有空|\bif\b|(错|不对|不行|不是|没有|没出现|看不到|卡住|失败|打不开)了?[，,]?\s*(就|再)?(告诉我|跟我说|说一声|叫我)/i;
const DG_LATER = /(出来|跑完|做完|合完|验完|好了|出图)(以?后|之后|，|我)|到时|点头后|点头了再/;
const DG_NONE = /不用你|不需要你|无需你|你不用|不用管|不需要做什么|不用做什么|不用回|\bno (?:further )?(?:action|reply) (?:is )?(?:needed|required)\b|\byou (?:do not|don't) need to reply\b|nothing for you/i;
const DG_STRONG = /请你|麻烦你|需要你|要你(定|选|确认|回|做|点|看|拍板|决定|处理)|你(来)?定[。！？，]|你选(?![的了过中])|你决定(?![的了过])|你拍板|你点头|等你(回|定|选|点头|确认|拍板|说|决定|的)|回(我)?一句|回我|你自己来|你自己点|交给你|留给你|\bplease (?:confirm|choose|pick|decide|reply|approve)\b|\bi need your (?:approval|decision|input|reply)\b|\bwaiting (for|on) you\b|\byour call\b/i;
const DG_QWORD = /你|要不要|行不行|好不好|可不可以|可以吗|对吗|吗[？?]|呢[？?]|哪个|哪种|哪一|还是|\byou\b|\bshould I\b|\bwhich (?:option|approach|one)\b/i;
const dgPlain = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
  .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim();
const dgSentences = (p) => (p.match(/[^。！？!?]+[。！？!?]?/g) || []).map((x) => x.trim()).filter(Boolean);
const dgClip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function digest(src, by) {
  const all = String(src || '').replace(/\r/g, '').split('\n');
  let tag = null, ti = -1, last = -1, fenced = false;
  all.forEach((l, i) => { if (/^\s*```/.test(l)) fenced = !fenced; else if (!fenced && l.trim()) last = i; });   // 代码块外的最后一个非空行
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i].match(DG_TAG);
    if (m && (m[1] || i === last)) { tag ={ need: DG_STATUS[m[1] ?? m[2].toLowerCase()], t: dgPlain(m[3]) }; ti = i; break; }
  }
  const lines = ti < 0 ? all : all.filter((_, i) => i !== ti); const text = lines.join('\n').trimEnd();
  const blocks = []; let buf = null, fence = false;
  const push = () => { if (buf) { blocks.push(buf); buf = null; } };
  const add = (i) => { if (!buf) buf = { a: i, b: i, t: [] }; buf.b = i; buf.t.push(lines[i]); };
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; push(); return; }
    if (fence || DG_TRIO.test(l)) { push(); return; }
    if (!l.trim() || /^\s*\|/.test(l) || /^\s*>/.test(l) || /^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(l)) { push(); return; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*#{1,6}\s/.test(l)) { push(); add(i); push(); return; }
    add(i);
  });
  push();
  const paras = blocks.map((b) => ({ ...b, p: dgPlain(b.t.join(' ')) })).filter((b) => b.p);
  let head = null, skip = 0;
  if (paras.length) {
    const p0 = paras[0], full = p0.p.replace(DG_LEAD, '').replace(/[：:]$/, ''), ss = dgSentences(full);
    head = ss[0] || full; if (head.length < 14 && ss[1]) head += ss[1];
    if (head.length < 14 && !ss[1] && paras[1]) { const nx = dgSentences(paras[1].p.replace(DG_LEAD, ''))[0]; if (nx) head += nx; }
    head = head.replace(/[：:]$/, '');
    if (head.length >= full.length && head.length <= 90 && lines.slice(0, p0.a).every((l) => !l.trim())) skip = lines.slice(0, p0.b + 1).join('\n').length;
    head = dgClip(head, 90);
  }
  if (tag) {
    const reply = tag.need === 'reply';
    return { text, tag: true, need: tag.need, head: reply ? head : dgClip(tag.t, 90), skip: reply ? skip : 0, ask: reply ? dgClip(tag.t, 90) : null };
  }
  const ss = []; paras.forEach((b, pi) => dgSentences(b.p).forEach((x) => ss.push({ x, pi })));
  const none = ss.some((o) => DG_NONE.test(o.x) && !DG_COND.test(o.x));
  let ask = null, score = 0;
  if (!none) for (const o of ss) {
    const u = o.x.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"/g, '「」'); if (DG_COND.test(u) || DG_LATER.test(u) || DG_NONE.test(u)) continue;
    const sc = (/[？?]$/.test(u) && DG_QWORD.test(u)) || DG_STRONG.test(u) ? 2 : 0;     // 「……了告诉我」这类顺口的不算：待跟进只给要你做决定的
    if (sc && sc >= score) { score = sc; let t = o.x; if ((/[：:]$/.test(t) || t.length < 10) && paras[o.pi + 1]) t += ' ' + paras[o.pi + 1].p; ask = dgClip(t.replace(/^[，,、\s]+/, ''), 90); }
  }
  return { text, tag: false, need: ask ? 'reply' : none || by === 'peer' ? 'fyi' : 'review', head, skip, ask };
}
const digestMemo = new Map();
function deliver(src, by) {                     // 交给界面的交付：去掉状态行的正文 + 摘要。同一段话只算一次
  if (!src) return { result: null, digest: null };
  const key = (by || '') + '\u0001' + src; let d = digestMemo.get(key);
  if (!d) { d = digest(src, by); digestMemo.set(key, d); if (digestMemo.size > 300) digestMemo.delete(digestMemo.keys().next().value); }
  return { result: d.text.length > 30000 ? d.text.slice(0, 30000) + '\n\n…（太长，剩下的去终端看）' : d.text || null,
    digest: { head: d.head, ask: d.ask, need: d.need, tag: d.tag, skip: d.skip } };
}

function alertOf(s) {
  if (s.ask || s.status === 'waiting') return null;                    // 「等你选」是另一种状态，卡片上本来就写明
  if (s.status === 'busy') return s.quiet >= STALL_MS ? { kind: 'stall', key: 'stall@' + (s.turnAt || s.promptAt || ''), text: '', at: null } : null;
  if (s.halt) return { kind: s.halt.kind, key: s.halt.kind + '@' + s.halt.at, text: s.halt.text || '', at: s.halt.at };
  if (s.done && s.result) return null;
  if (!(s.note || s.steps)) return null;
  if (s.status === 'shell') return null;                               // 它放到后台的活还在跑，跑完会自己接着做，不算「没做完就停了」
  const since = s.statusAt || Date.parse(s.lastAt || '') || 0;         // 刚停下的头 3 秒先不算：最后一句话可能还没落盘
  if (Date.now() - since < 3000) return null;
  return { kind: 'unfinished', key: 'unfinished@' + (s.noteAt || s.turnAt || s.promptAt || ''), text: '', at: s.lastAt || null };
}

let scanAt = 0, scanDt = 0;
const lastLive = new Map();    // 上一轮还活着的会话：sid → {title, cwd, provider, file, prompt, resultAt, mid, role, lastAt, tmux, sock}；mid = 当时一轮做到一半；role = 那时架构视图里的职级
const goneSince = new Map();   // 不见了的：sid → 第一次发现不见的时间
const leaving = new Map();     // 总控台自己停掉的（归档、删除）：sid → 时间。这些不算「意外退出」
// 一起退出（P0-0，11/16 11:42、12:10 两次 19–20 个窗口一起没了）：10 秒内 ≥ 3 个会话的进程没了、又不是总控台自己停的，算一起。
// 这时连闲着的一起记成「进程退出」（同一个 crash 编号），当场留一份快照，墙顶给一条「全部接回」。单个闲着的自己退出（他 /exit）照旧不记
const CRASH_N = 3, CRASH_WIN = 10000;
const goneLog = [];            // 最近不见了的（不算总控台自己停的）：{ sid, at, p }，留 60 秒
const goneCrash = new Map();   // sid → 它算进的那一起的编号
let crashOpen = null;          // 正在成形的那一起：它最后一个之后 10 秒内又不见的也算进去（一串慢慢倒下的不拆成两起）
let roleOf = new Map();        // sid → 架构视图里的职级（chief / lead / head / former / member）：接回时总管、负责人、分支负责人先
function noteRoles(org) { try { roleOf = new Map(Object.entries((org && org.nodes) || {}).map(([sid, n]) => [sid, n.role])); } catch {} }
// 做到一半、进程没了（终端被关、崩溃、重启）：卡片以前是直接消失。现在记进归档并标成 lost，界面上留一张卡告诉你。
function watchGone(out, seen) {
  const now = Date.now(); let dirty = false;
  for (const [sid, p] of lastLive) {
    if (seen.has(sid)) { goneSince.delete(sid); dropGone(sid); continue; }                // 又出现了（恢复会话时进程号会换，中间有个空档）
    if (archive.items[sid] || leaving.has(sid)) { lastLive.delete(sid); goneSince.delete(sid); dropGone(sid); continue; }   // 总控台自己停的（归档、删除）
    if (!goneSince.has(sid)) { goneSince.set(sid, now); goneLog.push({ sid, at: now, p }); }
  }
  clusterGone(now);
  for (const [sid, p] of lastLive) {
    if (seen.has(sid) || !goneSince.has(sid)) continue;
    const since = goneSince.get(sid);
    if (now - since < 6000) continue;                                  // 等 6 秒：恢复会话时进程号会换，中间有个空档
    const cid = goneCrash.get(sid);
    if (!p.mid && !cid) { if (now - since > CRASH_WIN + 2000) { lastLive.delete(sid); goneSince.delete(sid); } continue; }   // 闲着的：等过了「一起退出」的窗口还是单个，就不记
    const account = readTap(sid)?.account;
    archive.items[sid] = { sid, provider: p.provider, ...(typeof account === 'string' && account.trim() ? { account } : {}), title: p.title, cwd: p.cwd, file: p.file, prompt: p.prompt, resultAt: p.resultAt, ...(isGemini(p.model) ? { gemini: p.model } : {}),
      archivedAt: now, state: 'archived', lost: true, lostAt: since, project: p.project, role: p.role || null, lastAt: p.lastAt || 0, ...(cid ? { crash: cid, idle: !p.mid } : {}) };
    dirty = true; lastLive.delete(sid); goneSince.delete(sid);
    if (cid) {                                                         // 记成 lost 以后就不再挂在 goneCrash 上：它被接回、又上墙时不该把自己从这一起里拿掉（不然横幅的总数越接越小）
      goneCrash.delete(sid); for (let i = goneLog.length - 1; i >= 0; i--) if (goneLog[i].sid === sid) goneLog.splice(i, 1);
      const c = archive.crashes && archive.crashes[cid];
      if (c && !c.alerted) { c.alerted = true; queueAlert(c.sids.length + ' 个窗口', 'crash'); }   // 合成一条，等真记成进程退出了再发（看不到会话登记的那一轮不算）
    } else queueAlert(p.title, 'gone', sid);
  }
  for (const s of out) {
    const tr = tracks.get(s.sid) || codexTracks.get(s.sid);
    lastLive.set(s.sid, { title: s.title, cwd: s.cwd, provider: s.provider || 'claude', model: isGemini(s.model) ? s.model : null, file: (tr && tr.file) || s.file || null, prompt: s.prompt, resultAt: s.resultAt, project: s.project,
      mid: s.status === 'busy' || s.status === 'waiting', role: roleOf.get(s.sid) || null, lastAt: Math.max(Date.parse(s.lastAt || '') || 0, s.statusAt || 0), tmux: s.tmux || null, sock: s.tmux ? sockFor(s.tmux) : null });
  }
  for (const [sid, t] of leaving) if (now - t > 120000) leaving.delete(sid);
  if (dirty) saveArchive();
}
function dropGone(sid) {
  for (let i = goneLog.length - 1; i >= 0; i--) if (goneLog[i].sid === sid) goneLog.splice(i, 1);
  const cid = goneCrash.get(sid); goneCrash.delete(sid);
  const c = cid && archive.crashes && archive.crashes[cid];
  if (c && !(archive.items[sid] && archive.items[sid].crash === cid)) { c.sids = c.sids.filter((x) => x !== sid); saveArchive(); }   // 还没记成进程退出就回来了：不算这一起
}
function clusterGone(now) {
  for (let i = goneLog.length - 1; i >= 0; i--) if (now - goneLog[i].at > 60000) goneLog.splice(i, 1);
  const open = crashOpen && archive.crashes && archive.crashes[crashOpen];
  if (open) {
    for (const g of [...goneLog]) if (!goneCrash.has(g.sid) && g.at >= open.at && g.at - open.last <= CRASH_WIN) joinCrash(open, g);
    if (now - open.last > CRASH_WIN) { crashOpen = null; closeCrash(open); }
    return;
  }
  crashOpen = null;
  const free = goneLog.filter((g) => !goneCrash.has(g.sid)).sort((a, b) => a.at - b.at);
  for (let i = 0; i < free.length; i++) {
    const win = free.filter((g) => g.at >= free[i].at && g.at - free[i].at <= CRASH_WIN);
    if (win.length >= CRASH_N) { crashOpen = newCrash(win).id; return; }
  }
}
function joinCrash(c, g) {
  if (!c.sids.includes(g.sid)) c.sids.push(g.sid); c.last = Math.max(c.last, g.at);
  const it = archive.items[g.sid];
  if (it && it.lost) {                              // 做到一半的那几个可能在这一起成形之前已经记成进程退出了：补上编号，不再挂在 goneCrash 上
    if (!it.crash) it.crash = c.id;
    for (let i = goneLog.length - 1; i >= 0; i--) if (goneLog[i].sid === g.sid) goneLog.splice(i, 1);
  } else goneCrash.set(g.sid, c.id);
  saveArchive();
}
// 这一起合上（最后一个之后 10 秒没有新的）时重写 crash.json：成形之后才并进来的也在里面
function closeCrash(c) {
  if (!c || !c.dir) return;
  try { fs.writeFileSync(path.join(c.dir, 'crash.json'), JSON.stringify({ id: c.id, at: new Date(c.at).toISOString(), last: new Date(c.last).toISOString(),
    sessions: c.sids.map((sid) => { const it = archive.items[sid] || {}; return { sid, title: it.title || null, idle: it.idle === true, role: it.role || null, lastAt: it.lastAt ? new Date(it.lastAt).toISOString() : null, lostAt: it.lostAt ? new Date(it.lostAt).toISOString() : null }; }) }, null, 1)); } catch {}
}
const CRASH_DIR = path.join(DATA, 'crash');
function newCrash(win) {
  archive.crashes = archive.crashes || {};
  const at = win[0].at, id = 'c' + at.toString(36);
  const c = { id, at, last: at, sids: [], state: 'new', done: 0, failed: [], why: null, load: null, next: null, dir: null };
  archive.crashes[id] = c;
  for (const g of win) joinCrash(c, g);
  const keep = Object.values(archive.crashes).sort((a, b) => b.at - a.at).slice(0, 10).map((x) => x.id);   // 只留最近 10 起
  for (const k of Object.keys(archive.crashes)) if (!keep.includes(k)) delete archive.crashes[k];
  c.dir = READONLY ? null : snapDir(at); saveArchive();   // 只读的预览不写快照
  console.log(`crash ${new Date().toISOString()} ${id} n=${c.sids.length} ${c.dir || 'dry'}`);
  if (c.dir) snapCrash(c, win).catch((e) => console.log(`crash ${new Date().toISOString()} ${id} 快照没写完：${e.message}`));
  return c;
}
// 当场快照：<数据目录>/crash/<时间>/。判定一起退出的那一轮就写（log show 限时 30 秒、最多 2 MB），只留最近 10 份
const LOGSHOW = SANDBOX ? process.env.CCBOARD_LOGSHOW || null : '/usr/bin/log';   // 试验场里不跑真的 log show（测试给一个假命令）
function snapDir(at) {
  const d = new Date(at), base = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  let dir = path.join(CRASH_DIR, base), k = 1;
  while (fs.existsSync(dir)) dir = path.join(CRASH_DIR, base + '-' + ++k);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try { const old = fs.readdirSync(CRASH_DIR).filter((f) => /^\d{8}-\d{6}(-\d+)?$/.test(f)).sort(); for (const f of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(CRASH_DIR, f), { recursive: true, force: true }); } catch {}
  return dir;
}
function tailLines(file, n) {
  try { const fd = fs.openSync(file, 'r'); try { const size = fs.fstatSync(fd).size, len = Math.min(size, 256 << 10), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); return buf.toString('utf8').split('\n').filter((l, i, a) => l || i < a.length - 1).slice(-n).join('\n') + '\n'; } finally { fs.closeSync(fd); } } catch { return null; }
}
async function snapCrash(c, win) {
  const put = (f, t) => { try { fs.writeFileSync(path.join(c.dir, f), t); } catch {} };
  put('crash.json', JSON.stringify({ id: c.id, at: new Date(c.at).toISOString(), sessions: win.map((g) => ({ sid: g.sid, title: g.p.title, mid: g.p.mid, role: g.p.role, lastAt: g.p.lastAt ? new Date(g.p.lastAt).toISOString() : null, goneAt: new Date(g.at).toISOString(), tmux: g.p.tmux, sock: g.p.sock })) }, null, 1));
  const ml = tailLines(path.join(DATA, 'machine.log'), 120); if (ml !== null) put('machine.log.txt', ml);
  const xl = tailLines(TMUX_EXIT_LOG, 200); if (xl !== null) put('tmux-exit.txt', xl);
  const jobs = [
    ['swapusage.txt', '/usr/sbin/sysctl', ['vm.swapusage']],
    ['loadavg.txt', '/usr/sbin/sysctl', ['vm.loadavg']],
    ['memory_pressure.txt', '/usr/bin/memory_pressure', ['-Q'], (o) => o.trim().split('\n').pop()],
    ['ps.txt', '/bin/ps', ['-axm', '-o', 'pid,rss,%cpu,comm'], (o) => o.split('\n').slice(0, 31).join('\n')],   // -m 按内存排，表头 + 前 30
  ];
  if (LOGSHOW) jobs.push(['log.txt', LOGSHOW, ['show', '--last', '2m', '--style', 'compact', '--predicate', 'process == "kernel" OR sender == "jetsam"'], (o) => (o.length > (2 << 20) ? o.slice(-(2 << 20)) : o), 30000, 16 << 20]);   // 超 2 MB 留最后的（离出事最近）
  else put('log.txt', '试验场里不跑 log show\n');
  await Promise.all(jobs.map(async ([f, cmd, args, fmt, timeout, maxBuffer]) => {
    const r = await run(cmd, args, { timeout: timeout || 10000, maxBuffer: maxBuffer || 2 << 20 });
    const o = (fmt ? fmt(r.out || '') : r.out || '').slice(0, 2 << 20);
    put(f, o + '\n' + (r.ok ? '' : '[' + String(r.err || '').slice(0, 300) + ']\n'));
  }));
}
// 「全部接回」：服务端排队一个一个接。每接一个之前读 1 分钟负载，≥ 30 就等（15 秒看一次，最多 30 分钟，等不到就停下）；接一个之后隔 ≥ 20 秒。
// 顺序：总管 / 负责人先，再按最后动静从新到旧。手点单张卡片的「接回来」不排队（他自己点的）
const LOAD_MAX = 30;
const RESTORE_GAP = Number(process.env.CCBOARD_RESTORE_GAP_MS) || 20000;
const LOAD_POLL = Number(process.env.CCBOARD_LOAD_POLL_MS) || 15000;
const LOAD_WAIT = Number(process.env.CCBOARD_LOAD_WAIT_MS) || 30 * 60000;
function loadNow() {
  if (SANDBOX && process.env.CCBOARD_LOADAVG_FILE) { try { const v = Number(fs.readFileSync(process.env.CCBOARD_LOADAVG_FILE, 'utf8').trim()); if (Number.isFinite(v)) return v; } catch {} }
  return os.loadavg()[0];
}
const ROLE_RANK = { chief: 0, lead: 1, head: 1 };                // 分支负责人和负责人一起先接
function restoreOrder(c) {
  const tried = c.tried || [];                      // 每个只接一次：接过又倒下的记进 failed，不再排进来（不然一个起来就退的窗口会让队列每 20 秒重接它一次）
  return c.sids.filter((sid) => { const it = archive.items[sid]; return it && it.state === 'archived' && it.lost && it.crash === c.id && !c.failed.includes(sid) && !tried.includes(sid); })   // 点过「知道了」的、后来另外归档的不接
    .sort((a, b) => { const x = archive.items[a], y = archive.items[b]; return ((ROLE_RANK[x.role] ?? 2) - (ROLE_RANK[y.role] ?? 2)) || ((y.lastAt || 0) - (x.lastAt || 0)); });
}
let restoreBusy = null;        // 正在排队接回的那一起（一次只排一起）
function crashAction(id, action) {
  const c = archive.crashes && Object.prototype.hasOwnProperty.call(archive.crashes, id) ? archive.crashes[id] : null;
  if (!c) return { ok: false, error: '没有这一起' };
  if (action === 'dismiss') { c.state = 'dismissed'; c.stop = true; saveArchive(); return { ok: true }; }
  if (action === 'stop') { c.stop = true; if (restoreBusy !== id && c.state !== 'done') { c.state = 'stopped'; c.why = 'user'; } saveArchive(); return { ok: true }; }
  if (action !== 'restore') return { ok: false, error: '不认识的动作' };
  if (restoreBusy === id) return { ok: true, already: true };
  if (restoreBusy) return { ok: false, error: '另一起还在接回，等它接完或先停下它' };
  c.stop = false; c.state = 'running'; c.why = null; restoreBusy = id; saveArchive();
  restoreLoop(c).catch((e) => { console.error('restore', e); c.state = 'stopped'; c.why = 'error'; }).finally(() => { restoreBusy = null; try { saveArchive(); } catch (e) { console.error('restore', e); } });
  return { ok: true };
}
async function pause(c, ms) { const end = Date.now() + ms; while (Date.now() < end && !c.stop) await sleep(Math.min(250, end - Date.now())); }
async function restoreLoop(c) {
  for (;;) {
    if (c.stop) { if (c.state !== 'dismissed') { c.state = 'stopped'; c.why = 'user'; c.next = c.done + c.failed.length + 1; } return; }
    const todo = restoreOrder(c);
    if (!todo.length) { c.state = 'done'; c.next = null; c.load = null; console.log(`restore ${new Date().toISOString()} ${c.id} done ${c.done}/${c.sids.length}`); return; }
    c.next = c.done + c.failed.length + 1;
    const gapLeft = (c.restoredAt || 0) + RESTORE_GAP - Date.now();   // 上一个接完到这一个至少隔 RESTORE_GAP（新会话起来要吃一阵 CPU）；记在这一起上，跨「停下 → 接着接回」、跨服务重启也算
    if (gapLeft > 0) { await pause(c, gapLeft); if (c.stop) continue; }
    const t0 = Date.now(); let load = loadNow();
    while (load >= LOAD_MAX) {
      if (c.state !== 'waiting') console.log(`restore ${new Date().toISOString()} ${c.id} wait load=${load}`);
      c.state = 'waiting'; c.load = Math.round(load * 10) / 10; c.waitSince = t0;
      if (Date.now() - t0 >= LOAD_WAIT) { c.state = 'stopped'; c.why = 'load'; console.log(`restore ${new Date().toISOString()} ${c.id} stop load=${c.load} next=${c.next}`); return; }
      await pause(c, LOAD_POLL);
      if (c.stop) break;
      load = loadNow();
    }
    if (c.stop) continue;
    c.state = 'running'; c.load = Math.round(load * 10) / 10; c.waitSince = null;
    const sid = todo[0]; (c.tried = c.tried || []).push(sid);
    const r = await unarchive(sid);
    c.restoredAt = Date.now();
    if (r.ok) c.done++; else c.failed.push(sid);
    console.log(`restore ${new Date().toISOString()} ${c.id} ${sid.slice(0, 8)} ${r.ok ? 'ok ' + (r.name || '-') : 'fail ' + String(r.error || '').replace(/\s+/g, ' ').slice(0, 80)} ${c.done + c.failed.length}/${c.sids.length}`);
    saveArchive();
  }
}
function crashView() {
  const idle = (x) => (x.state === 'new' || x.state === 'stopped') && !restoreOrder(x).length;   // 一个个都自己接回、删掉了：横幅没事可做
  const busy = restoreBusy && archive.crashes && archive.crashes[restoreBusy];                    // 正在接的那一起先给（停得了它）
  const c = busy || Object.values(archive.crashes || {}).filter((x) => x.state !== 'dismissed' && Date.now() - x.at < 24 * 3600000 && !idle(x)).sort((a, b) => b.at - a.at)[0];
  if (!c) return null;
  return { id: c.id, at: c.at, n: c.sids.length, done: c.done, fail: c.failed.length, state: c.state, why: c.why || null, load: c.load ?? null, waitSince: c.waitSince || null, next: c.next ?? (c.done + c.failed.length + 1), max: LOAD_MAX };
}

// ───────────── 「先放着」带时间 ─────────────
// 待跟进的卡点「先放着」，选 1 小时 / 今晚 / 明早 9 点：推迟的是「这一次交付」，记在服务（<数据目录>/snooze.json），服务重启照样记得、到点照样醒。
// 推迟中只有两种情形提前醒：又交付了一次而且是【待跟进】（要他拍板的新事），或停下来等他选（选择框 / 弹框）。
// 【进展】【待审阅】、在跑都不叫醒：长任务会自己交付好几次，不能因此把推迟了的卡又翻上来。停住了（alert）不归这里管，卡片照常显示。
// 刚发了话、这一轮还没交付的不让推迟：要推迟的那次交付还没来。
const SNOOZE_FILE = path.join(DATA, 'snooze.json');
const SNOOZE_MAX_MS = 48 * 3600e3;
let snoozes = {};   // sid → { until（毫秒）, at（推迟的那一次交付的 resultAt）, setAt }
try {
  const j = JSON.parse(fs.readFileSync(SNOOZE_FILE, 'utf8'));
  if (j && typeof j === 'object' && !Array.isArray(j)) for (const [sid, z] of Object.entries(j)) if (/^[\w-]{8,64}$/.test(sid) && z && Number.isFinite(z.until) && typeof z.at === 'string') snoozes[sid] = { until: z.until, at: z.at, setAt: Number(z.setAt) || 0, ask: typeof z.ask === 'string' ? z.ask : '' };
} catch {}
function saveSnoozes() { if (READONLY) return; const tmp = SNOOZE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(snoozes, null, 1)); fs.renameSync(tmp, SNOOZE_FILE); }
function snoozeWake(s, z, now = Date.now()) {      // 该醒了回原因（due 到点 / ask 等你选 / reply 新的待跟进），没到回 null
  if (!(now < z.until)) return 'due';
  if (s.status === 'waiting' || s.ask) return 'ask';
  if (s.promptAt && Date.parse(s.promptAt) > Date.parse(z.at) && !isAutoPrompt(s.prompt || '')) return 'you';   // 他自己回了它（终端里或卡片上）：推迟作废，之后它交回来的照常显示
  if (s.done && s.resultAt && String(s.resultAt) !== z.at && s.digest && s.digest.need === 'reply') return 'reply';
  return null;
}
// 到点醒来时，推迟的那件事已经被后来的交付（【进展】【待审阅】）盖住了：把现在这一次交付改回待跟进、带推迟时那件事（和小模型判 yours 一样的改法）。
// 它再交付一次就作废（只认 at 这一次）。只在内存：服务在这中间重启，卡片照最新交付算。
const raised = new Map();   // sid → { at, ask }
function applyRaised(o) {
  const r = raised.get(o.sid);
  if (!r || r.at !== String(o.resultAt) || !o.digest || o.digest.need === 'reply') return;
  o.digest = { ...o.digest, need: 'reply', ask: r.ask || o.digest.ask || null, raised: true };
}
function watchSnooze() {          // 每轮扫描后：该醒的从表里拿掉、记一行日志。不在墙上的会话只等到点（服务刚起、还没扫到它时不能当它没了）
  const now = Date.now(), by = new Map(allSessions.map((x) => [x.sid, x])); let dirty = false;
  for (const [sid, z] of Object.entries(snoozes)) {
    const s = by.get(sid), why = !(now < z.until) ? 'due' : s ? snoozeWake(s, z, now) : null;
    if (!why) continue;
    delete snoozes[sid]; dirty = true;
    if (why === 'due' && s && s.done && s.resultAt && String(s.resultAt) !== z.at && s.digest && s.digest.need !== 'reply') { raised.set(sid, { at: String(s.resultAt), ask: z.ask || '' }); applyRaised(s); }
    console.log(`snooze ${new Date().toISOString()} ${sid.slice(0, 8)} wake ${why}${raised.has(sid) && why === 'due' ? ' raise' : ''}`);
  }
  for (const [sid, r] of raised) { const s = by.get(sid); if (!s || String(s.resultAt) !== r.at) raised.delete(sid); }
  if (dirty) try { saveSnoozes(); } catch (e) { console.log(`snooze ${new Date().toISOString()} 写不进 snooze.json：${e.message}`); }
}
const withSnooze = (o) => { const z = snoozes[o.sid]; return z && !snoozeWake(o, z) ? { ...o, snooze: { until: z.until, at: z.at } } : o; };   // 给界面：推迟中的会话多一个 snooze

// 系统通知：你不在总控台前面时才发；几个窗口一起停（比如额度用完）合成一条。
// 发三类：停住了（alert）、【待跟进】（reply：交付了、要你本人定）、停下来等你选（ask）。门：
// 没见过的会话当下的几件只记账不发（服务刚起的第一轮全是；后来才上墙的、接回来的也是）；同一件事只发一次（每类记一个 key）；
// 站稳才发（停住了 4 秒、没做完 15 秒、等你选 4 秒、待跟进 5 秒：这期间它又动了——自动续跑、后台通知把它叫醒——就不发）；
// 推迟中（先放着、没到点、没被叫醒）的不发，推迟期间出现的也不补发；被打断不发。
const WHY = { limit: '额度用完了', auth: '登录过期了', flagged: '被安全检查拦了', error: '报错了', interrupt: '被打断了', unfinished: '没做完就停了', stall: '可能卡住了', gone: '进程退出了', crash: '一起退出了', reply: '要你回', ask: '等你选' };
const alerted = new Map();     // sid → { alert, reply, ask }：每类已经提醒过（或算作已知道）的那一件的 key
const alertHold = new Map();   // sid + ' ' + 类 → {key, since}：站稳才算，免得状态闪一下就打扰你
const alertGone = new Map();   // sid → 第一次不在墙上的时间：一两轮读不到会话登记（文件正在写）不算没见过，60 秒后才忘
const askEp = new Map();       // sid → 这一段「等你选」的 key：一直停在选择框上就是同一件，离开再进来才算新的一件
const ALERT_FORGET_MS = 60000;
const REPLY_SHELL_MS = Number(process.env.CCBOARD_REPLY_SHELL_MS) || 60000;   // 交付了待跟进、后台命令还在跑（shell）：跑完它多半自己接着做，多等一会儿；一直不完也要告诉他
// 【待跟进】发过（或算作已知道）的那件记在 notified.json，服务重启也认得：重启前刚交付、还没站稳的，和重启后小模型才第一次判成待跟进的，照常发；已经发过的不重发。
// 停住了、等你选不存：重启后照旧只记账。
const NOTIFIED_FILE = path.join(DATA, 'notified.json');
const replyDisk = new Map();   // sid → 盘上记的 reply key（null = 记过、那时还没交付）
try { const j = JSON.parse(fs.readFileSync(NOTIFIED_FILE, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) for (const [sid, k] of Object.entries(j)) if (/^[\w-]{8,64}$/.test(sid) && (k === null || (typeof k === 'string' && k.length < 200))) replyDisk.set(sid, k); } catch {}
let replySaved = null;
const ALERT_BOOT = Date.now();
function saveNotified() {
  const early = process.uptime() < ALERT_FORGET_MS / 1000;
  if (!early && replyDisk.size) replyDisk.clear();                           // 过了头 60 秒，盘上那份只当刚起来时的底：之后才上墙的（接回来的）照旧只记账
  if (READONLY) return;
  const o = {}; for (const [sid, d] of alerted) o[sid] = d.reply ?? null;
  if (early) for (const [sid, k] of replyDisk) if (!(sid in o)) o[sid] = k;  // 刚起来、还没扫到的会话先留着（不在墙上 60 秒以后才忘，和内存里一样）
  const j = JSON.stringify(o); if (j === replySaved) return;
  try { const tmp = NOTIFIED_FILE + '.tmp'; fs.writeFileSync(tmp, j); fs.renameSync(tmp, NOTIFIED_FILE); replySaved = j; } catch (e) { console.log(`notified ${new Date().toISOString()} 写不进 notified.json：${e.message}`); replySaved = j; }
}
let alertQueue = [], alertTimer = null, uiFocusAt = 0;
function queueAlert(title, kind, sid = '', text = '') {
  alertQueue.push({ title: String(title || '').replace(/\s+/g, ' ').slice(0, 24), kind, sid, text: String(text || '').replace(/\s+/g, ' ').slice(0, 80) });
  if (!alertTimer) alertTimer = setTimeout(flushAlerts, 2500);
}
const asking = (s) => s.status === 'waiting' || !!s.ask;
function askKey(s) {
  let k = askEp.get(s.sid);
  if (!k) { const tr = tracks.get(s.sid); k = 'ask@' + ((tr && tr.st.ask && tr.st.ask.id) || s.statusAt || s.lastAt || Date.now()); askEp.set(s.sid, k); }
  return k;
}
function needsOf(s) {          // 这个会话此刻要你处理的事，每类至多一件：{ slot, kind, key, wait, text }
  const out = [];
  if (s.alert) out.push({ slot: 'alert', kind: s.alert.kind, key: s.alert.key, wait: s.alert.kind === 'unfinished' ? 15000 : 4000 });   // 原因不明的多等一会儿
  if (asking(s)) out.push({ slot: 'ask', kind: 'ask', key: askKey(s), wait: 4000, text: (s.ask && s.ask.questions && s.ask.questions[0] && s.ask.questions[0].q) || '' });
  else if (!s.alert && s.done && s.resultAt && s.digest && s.digest.need === 'reply' && !s.digest.raised && s.status !== 'busy') out.push({ slot: 'reply', kind: 'reply', key: 'reply@' + s.resultAt, wait: s.status === 'shell' ? REPLY_SHELL_MS : 5000, text: s.digest.ask || '' });
  return out;                  // raised（先放着到点、翻回来的那件）不另发：推迟的那件他已经知道
}
function baseOf(s) {           // 没见过的会话：当下的几件记成已知道。待跟进先看盘上（重启前的那一份服务记的）；盘上没有，当下这一次交付不论是不是待跟进都记上（头一回见到它，之后小模型再把它判成待跟进也不算新的）
  const b = { alert: s.alert ? s.alert.key : null, reply: s.resultAt ? 'reply@' + s.resultAt : null, ask: asking(s) ? askKey(s) : null };
  const stale = s.digest && s.digest.need === 'reply' && Date.parse(s.resultAt) < ALERT_BOOT - 120000;   // 服务停着的时候早就交付了的待跟进（停了很久、回滚到不写这个文件的旧版跑过一阵）：算旧的，不看盘
  if (replyDisk.has(s.sid) && !stale) b.reply = replyDisk.get(s.sid);
  return b;
}
function watchAlerts() {
  const now = Date.now(); const live = new Set();
  for (const s of sessions) {
    live.add(s.sid); alertGone.delete(s.sid);
    if (!asking(s)) askEp.delete(s.sid);
    const done = alerted.get(s.sid);
    if (!done) { alerted.set(s.sid, baseOf(s)); continue; }                   // 没见过的会话：当下的几件只记账不发
    const ns = needsOf(s), z = snoozes[s.sid];
    if (z && !snoozeWake(s, z, now)) {                                        // 推迟中：都不发。推迟的那件待跟进记成已知道（醒了也不补）；停住了不记，醒来时还停着就照常发
      const r = ns.find((n) => n.slot === 'reply'); if (r) done.reply = r.key;
      for (const n of ['alert', 'reply', 'ask']) alertHold.delete(s.sid + ' ' + n);
      continue;
    }
    for (const slot of ['alert', 'reply', 'ask']) {
      const n = ns.find((x) => x.slot === slot), hk = s.sid + ' ' + slot;
      if (!n) { alertHold.delete(hk); continue; }
      if (done[slot] === n.key) continue;                                     // 同一件事只发一次
      if (slot === 'ask' && s.provider === 'codex' && process.uptime() < 60) { done.ask = n.key; continue; }   // Codex 的弹框要等读屏（slowLoop）才知道，服务起来 60 秒内读到的算已有的
      const h = alertHold.get(hk);
      if (!h || h.key !== n.key || h.wait !== n.wait) { alertHold.set(hk, { key: n.key, since: now, wait: n.wait }); continue; }   // 要等多久变了（后台跑完 shell → idle）从头站稳
      if (now - h.since < n.wait) continue;
      done[slot] = n.key; alertHold.delete(hk);
      if (n.kind !== 'interrupt') queueAlert(s.title, n.kind, s.sid, n.text); // 被打断是你自己按的 Esc，界面上标出来就够了
    }
  }
  for (const k of [...alerted.keys()]) if (!live.has(k)) { const g = alertGone.get(k); if (!g) alertGone.set(k, now); else if (now - g > ALERT_FORGET_MS) { alerted.delete(k); alertGone.delete(k); askEp.delete(k); } }
  for (const k of [...alertHold.keys()]) if (!live.has(k.split(' ')[0])) alertHold.delete(k);
  saveNotified();
}
async function flushAlerts() {
  alertTimer = null; const q = alertQueue; alertQueue = []; if (!q.length) return;
  const title = q.length === 1 ? (q[0].kind === 'crash' ? q[0].title + WHY.crash : '「' + q[0].title + '」' + WHY[q[0].kind]) : q.length + (q.every((x) => x.kind === 'reply' || x.kind === 'ask') ? ' 个窗口在等你' : q.some((x) => x.kind === 'reply' || x.kind === 'ask') ? ' 个窗口要你处理' : ' 个窗口停住了');
  const body = q.length === 1 ? q[0].text || '打开总控台跟进一下' : q.slice(0, 3).map((x) => '「' + x.title + '」' + WHY[x.kind]).join('；') + (q.length > 3 ? ' 等' : '');
  const would = Date.now() - uiFocusAt < 6000 ? 'ui' : 'sent';                    // ui = 你正看着总控台，界面自己会提示
  const how = SANDBOX ? 'dry:' + would : would;                                  // 试验场里只写日志，不真发
  console.log(`alert ${new Date().toISOString()} ${how} n=${q.length} ${q.map((x) => x.kind).join(',')}`);
  console.log(`notify ${new Date().toISOString()} ${how} ${q.map((x) => x.kind + ':' + (x.sid ? x.sid.slice(0, 8) : '-')).join(',')} | ${title} | ${body}`);   // 本来会发 / 发了什么（试验场里测试读这一行）
  if (would === 'sent') void sendPush(q.map(({ kind, sid }) => ({ kind, sid })));
  else if (pushReady()) {
    const idleMs = await readHidIdleMs();
    if (pushWould(Date.now() - uiFocusAt, idleMs) === 'sent') void sendPush(q.map(({ kind, sid }) => ({ kind, sid })));
  }
  if (how !== 'sent') return;
  await new Promise((resolve) => execFile('/usr/bin/osascript', ['-e', 'display notification (system attribute "CCB_BODY") with title (system attribute "CCB_TITLE")'],
    { timeout: 8000, env: { ...process.env, CCB_TITLE: '总控台 · ' + title, CCB_BODY: body } }, () => resolve()));
}

function scanSessions() {
  const t0 = Date.now(); scanDt = scanAt ? Math.min(5000, t0 - scanAt) : 0; scanAt = t0;
  let files = [], readOk = true;
  try { files = fs.readdirSync(SESS_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch { readOk = false; }
  const out = []; let others = 0; const seen = new Set();
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8')); } catch { continue; }
    if (!d || !d.sessionId || !d.pid || !alive(d.pid)) continue;
    if (!(d.kind === 'interactive' && d.entrypoint === 'cli')) { others++; continue; }   // 别的程序起的 agent 不上墙
    seen.add(d.sessionId);
    let tr = tracks.get(d.sessionId);
    if (!tr) { tr = new Track(d.sessionId, d.cwd); tracks.set(d.sessionId, tr); }
    try { tr.refresh(); } catch (e) { /* 读不到就先显示登记信息 */ }
    const st = tr.st;
    const o = {
      sid: d.sessionId, provider: 'claude', pid: d.pid, cwd: d.cwd, startedAt: d.startedAt, status: d.status || 'idle',
      statusAt: d.statusUpdatedAt || d.updatedAt || null,
      regName: d.name || '', userNamed: d.nameSource && d.nameSource !== 'derived',
      title: st.custom || (d.nameSource && d.nameSource !== 'derived' ? d.name : null) || st.title || d.name || d.sessionId.slice(0, 8),
      aiTitle: st.title, custom: st.custom,
      prompt: st.prompt, promptAt: st.promptAt,
      ...deliver(st.result, st.resultBy),
      resultAt: st.resultAt, done: st.done,
      note: st.note, noteAt: st.noteAt, tool: st.tool, steps: st.steps, turnAt: st.turnAt, lastAt: st.lastAt,
      ask: st.ask ? askView(st.ask) : null, halt: st.halt, model: st.model, effort: st.effort, ctx: st.ctx,
      codeMode: st.codeMode === true,                     // 记录里最后一条 repl-mode（卡片上模型胶囊前面的「Code」）
      eta: st.eta || null,                                // 它自己报的预计 { at, mins }（见 etaIn），这一轮没报是 null
    };
    o.quiet = tr.tick(o.status === 'busy', scanDt, o.status === 'busy' || o.status === 'shell'); o.alert = alertOf(o);
    o.sub = tr.sub;                                        // 正在跑的子 agent 数（只数在跑的会话）
    o.project = classify(st.files, { title: o.title, prompt: o.prompt, cwd: o.cwd, home: HOME, pin: pinOf(panePid.get(d.pid)) });
    out.push(o);
  }
  attachChannels(out);
  if (CONFIG.codex) for (const c of codexSessions(seen)) out.push(c);   // codex 没打开：总控台起过的 Codex 会话和它们的记录都不读
  if (readOk) watchGone(out, seen);                        // 要在清掉 tracks 之前：记「它当时的对话记录在哪」。读不到会话登记的那一轮不判（不然所有窗口同一拍「不见」）
  for (const k of [...tracks.keys()]) if (!seen.has(k)) tracks.delete(k);
  for (const o of out) { applyJudged(o); applyAuto(o); }
  for (const o of out) applyRaised(o);                                       // 先放着到点、那件事被后来的交付盖住了：改回待跟进
  out.sort((a, b) => (a.order - b.order) || (a.startedAt - b.startedAt));
  let dirty = false;
  for (const [sid, it] of Object.entries(archive.items)) {
    if ((it.state === 'archived' || it.state === 'restoring') && seen.has(sid)) { delete archive.items[sid]; dirty = true; }   // 又活过来了（恢复成功，或他自己在终端里接上了）
    else if (it.state === 'restoring' && Date.now() - (it.restoreAt || 0) > 12000 && !panes.some((p) => p.name === it.tmux)) {
      it.state = 'archived'; dirty = true;
      const c = it.crash && archive.crashes && archive.crashes[it.crash];                 // 全部接回接过、起来又退了的：算没接成，不再排
      if (c && (c.tried || []).includes(sid) && !c.failed.includes(sid)) { c.failed.push(sid); c.done = Math.max(0, c.done - 1); }
    }
  }
  if (dirty) saveArchive();
  allSessions = out; if (readOk) sessionsScanned = true; otherCount = others;
  sessions = out.filter((x) => !archive.items[x.sid]);
  try { markWrites(out, sessions); } catch (e) { console.error('writes', e); }   // 这一轮改了哪些文件；墙上的会话两两比撞车（出错不拖垮这一轮扫描）
  watchSnooze();
  watchAlerts();
  watchTidy();
}

function askView(ask) {
  if (ask.name === 'ExitPlanMode') return { kind: 'plan', questions: [{ q: '它写好了计划，等你批准', options: [] }] };
  const qs = Array.isArray(ask.input.questions) ? ask.input.questions : [];
  return { kind: 'ask', questions: qs.map((q) => ({ q: q.question || '', options: (q.options || []).map((o) => o.label || '') })) };
}

// ───────────── 往会话里发话的两条通道 ─────────────
// 1) 你原来开在 Ghostty 标签里的会话：用 Ghostty 自带的脚本接口往那个标签里「粘贴 + 回车」
// 2) 从总控台新开的会话：跑在没有窗口的 tmux 里，用 tmux 往里送字

const ENUM = `
set sep to (character id 9)
set out to ""
tell application "Ghostty"
  set wids to id of every window
  repeat with widRef in wids
    set wid to widRef as text
    set w to a reference to (first window whose id is wid)
    set n to count of tabs of w
    repeat with i from 1 to n
      set t to a reference to (tab i of w)
      set tids to id of every terminal of t
      set tnames to name of every terminal of t
      repeat with j from 1 to (count of tids)
        set out to out & wid & sep & i & sep & (item j of tids) & sep & (item j of tnames) & linefeed
      end repeat
    end repeat
  end repeat
end tell
return out
`;

let terms = [], ghosttyOk = false, termsAt = 0;
let panes = [], panesAt = 0;          // [{name, pid}]

const stripGlyph = (name) => { const m = String(name).match(/^([^\p{L}\p{N}\s])\s+(.*)$/u); return m ? m[2] : String(name); };

async function refreshTerms() {
  if (SANDBOX) { terms = []; ghosttyOk = false; return; }
  const running = await run('/usr/bin/pgrep', ['-x', 'ghostty']);
  if (!running.ok) { terms = []; ghosttyOk = false; return; }
  const r = await osa(ENUM, [], 8000);
  if (!r.ok) { ghosttyOk = false; return; }       // 读到一半窗口变了：保留上一次的结果
  const list = []; let k = 0;
  for (const line of r.out.split('\n')) {
    const f = line.split('\t');
    if (f.length < 4) continue;
    list.push({ win: f[0], tab: Number(f[1]), id: f[2], name: f[3], title: stripGlyph(f[3]), order: k++ });
  }
  terms = list; ghosttyOk = true; termsAt = Date.now();
}

// 枚举老的 tmux.sock 与独立套接字。超时保留上一拍；独立死套接字只保留仍活着的窗格。确实退出交给跨拍裁剪。
// 看护会收走它自己那台的套接字，没看护的（退回的、看护被杀的）留下的死套接字连续 1 小时连不上再删（老的 tmux.sock 不删）
const DEAD_SOCK = /no server running|\(No such file or directory\)/;   // 只有这两种算「服务器没了」；别的 error connecting（资源不够之类）当一时没应答
const deadSince = new Map();   // 套接字 → 第一次连不上的时间
function winSocks() {
  try { return fs.readdirSync(TMUX_DIR).filter((f) => /^ccb-[\w-]+\.sock$/.test(f)).sort().map((f) => path.join(TMUX_DIR, f)); } catch { return []; }
}
// 11/18 线上 5 条活窗口的记录被删：单台死套接字报错仍能是活窗格，按上一拍的 pid 保留，不拖住全局 sure。
// 路径暂时消失交给跨拍裁剪；一小时清死套接字的原规则不变。
async function refreshPanes() {
  const socks = [TMUX_SOCKET, ...winSocks()];
  const prev = new Map(); for (const p of panes) { if (!prev.has(p.sock)) prev.set(p.sock, []); prev.get(p.sock).push(p); }
  const res = await Promise.all(socks.map((sock) => tmuxAt(sock, ['list-panes', '-a', '-F', '#{session_name}\t#{pane_pid}\t#{session_created}\t#{pane_current_path}'], { timeout: 4000 }).then((r) => ({ sock, r }))));
  const list = [], map = new Map(); let sure = true;
  for (const { sock, r } of res) {
    if (r.ok) {
      deadSince.delete(sock);
      for (const l of r.out.split('\n').filter(Boolean)) { const [name, pid, created, cwd] = l.split('\t'); list.push({ name, pid: Number(pid), created: Number(created) * 1000, cwd: cwd || '', sock }); if (!map.has(name)) map.set(name, sock); }
    } else if (DEAD_SOCK.test(r.err || '')) {   // 老的 tmux.sock 也一样：文件不在（新装的机器从来没有它）= 那台不存在，不然 sure 永远是 false、钉住和谁开的永远不清
      if (sock === TMUX_SOCKET || !/no server running/i.test(r.err || '')) continue;   // 1 小时删套接字只对「文件在、没人应答」计时
      if (!deadSince.has(sock)) deadSince.set(sock, Date.now());
      else if (!READONLY && Date.now() - deadSince.get(sock) > 3600000) { try { if (fs.lstatSync(sock).isSocket()) { fs.unlinkSync(sock); console.log(`tmux ${new Date().toISOString()} 删掉 1 小时连不上的套接字 ${path.basename(sock)}`); } } catch {} deadSince.delete(sock); }
      if (fs.existsSync(sock)) for (const q of prev.get(sock) || []) if (alive(q.pid)) { list.push(q); if (!map.has(q.name)) map.set(q.name, sock); }
    } else { sure = false; for (const q of prev.get(sock) || []) { list.push(q); if (!map.has(q.name)) map.set(q.name, sock); } }   // 一时没应答：不算会话没了，沿用上一轮这台的窗格
  }
  for (const k of [...deadSince.keys()]) if (!socks.includes(k)) deadSince.delete(k);
  panes = list; sockOf.clear(); for (const [k, v] of map) sockOf.set(k, v);
  panesAt = Date.now();
  if (sure) { restoreSpawns(); prunePins(); pruneSpawns(); }
}

const ppidCache = new Map();
async function ppidOf(pid) {
  if (ppidCache.has(pid)) return ppidCache.get(pid);
  const r = await run('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]);
  const v = r.ok ? Number(r.out.trim()) : 0;
  ppidCache.set(pid, v); return v;
}
const panePid = new Map();   // 会话 pid → tmux 会话名
async function resolvePanes() {
  panePid.clear();
  for (const s of allSessions) {
    let hit = panes.find((p) => p.pid === s.pid);
    if (!hit && panes.length) { const pp = await ppidOf(s.pid); hit = panes.find((p) => p.pid === pp); }
    if (hit) panePid.set(s.pid, hit.name);
  }
}

// 标题对得上、而且一对一，才认这个标签是这个会话的
function attachChannels(list) {
  const byTitle = new Map();
  for (const t of terms) { if (!byTitle.has(t.title)) byTitle.set(t.title, []); byTitle.get(t.title).push(t); }
  const claim = new Map();
  for (const s of list) {
    s.channel = null; s.term = null; s.order = 1e6;
    const tm = panePid.get(s.pid);
    if (tm) { s.channel = 'tmux'; s.tmux = tm; s.order = 5e5; const ws = waitScreens.get(tm); s.screen = ws ? ws.screen : null; s.dialog = ws ? ws.dialog : null; continue; }
    const cands = [...new Set([s.custom, s.userNamed ? s.regName : null, s.aiTitle].filter(Boolean))];
    for (const c of cands) {
      const arr = byTitle.get(c);
      if (arr && arr.length === 1) { s.term = arr[0].id; s.termTitle = arr[0].title; s.order = arr[0].order; break; }
    }
    if (s.term) { if (!claim.has(s.term)) claim.set(s.term, []); claim.get(s.term).push(s); }
  }
  for (const arr of claim.values()) {
    if (arr.length > 1) for (const s of arr) { s.term = null; s.order = 1e6; }
    else arr[0].channel = 'ghostty';
  }
}

const SEND_GHOSTTY = `
on run argv
  set tid to item 1 of argv
  tell application "Ghostty"
    set t to (first terminal whose id is tid)
    set nm to name of t
    repeat with i from 2 to (count of argv)
      input text (item i of argv) to t
      delay 0.45
    end repeat
    delay 0.15
    send key "enter" to t
    return nm
  end tell
end run
`;
const FOCUS_GHOSTTY = `
on run argv
  tell application "Ghostty"
    activate
    focus (first terminal whose id is (item 1 of argv))
  end tell
end run
`;
const OPEN_TMUX = `
on run argv
  tell application "Ghostty"
    activate
    set cfg to new surface configuration
    set command of cfg to (item 1 of argv)
    if (count of windows) > 0 then
      new tab in front window with configuration cfg
    else
      new window with configuration cfg
    end if
  end tell
end run
`;

// 「去终端」：已经有终端 attach 着这个会话就聚焦那个标签，没有才新开一个（11/15 21:41 同一个会话挂过 7 个、11/16 12:05 挂过 5 个 attach：
// 以前每点一次都 new tab）。认标签靠 tty：tmux list-clients 给每个客户端的 tty，Ghostty 的 terminal 有 tty 属性（11/16 拿线上 4 个客户端核过，都对得上）。
// attach 的是那个会话自己住的那台（老窗口 tmux.sock，新窗口 tmux/<名字>.sock）。试验场里不碰 Ghostty，只记一行
const FOCUS_TTY = `
on run argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with term in terminals of t
          set y to ""
          try
            set y to (tty of term) as text
          end try
          if argv contains y then
            activate
            focus term
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "none"
end run
`;
async function openAttach(name) {
  if (!/^ccb-[\w-]+$/.test(String(name || ''))) return { ok: false, error: '不是总控台开的会话' };   // 名字要拼进 shell 命令
  const sock = sockFor(name);
  const cl = await tmuxAt(sock, ['list-clients', '-t', name, '-F', '#{client_tty}']);
  const ttys = cl.ok ? [...new Set(cl.out.split('\n').map((x) => x.trim()).filter((x) => /^\/dev\/tty\w+$/.test(x)))] : [];
  if (SANDBOX) { console.log(`focus ${new Date().toISOString()} dry:${ttys.length ? 'reuse' : 'open'} ${name} ${ttys.length ? ttys.join(',') : '-S ' + sock}`); return { ok: true, dry: true }; }
  if (ttys.length) {
    const f = await osa(FOCUS_TTY, ttys, 8000);
    if (f.ok && f.out.trim() === 'ok') return { ok: true, reused: true };
  }
  const r = await osa(OPEN_TMUX, [`${TMUX_BIN} -S '${sock}' attach -t ${name}`]);
  return r.ok ? { ok: true } : { ok: false, error: r.err };
}

// 正文里的路径点了做什么。路径是模型写的，所以只有「看的东西」直接打开：普通文件夹（访达里打开），网页、图、音视频、PDF、文档、文本（默认程序打开）。
// 能执行的（.app、.command、.sh、.py…）、看着像文件夹的程序包（.app、.pkg）、认不出的，一律只在访达里选中。按符号链接指向的真身判断。
const OPEN_EXT = new Set(['html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg', 'bmp', 'tif', 'tiff', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg',
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'srt', 'vtt']);
function openAction(p) {
  let real, st; try { real = fs.realpathSync(p); st = fs.statSync(real); } catch { return null; }
  const ext = path.extname(real).slice(1).toLowerCase();
  if (st.isDirectory()) return ext ? 'reveal' : 'open';
  return OPEN_EXT.has(ext) ? 'open' : 'reveal';
}
// 正文里点的路径（file://…、~/…、完整路径）→ 磁盘上的完整路径。/api/open 和 /api/preview 共用。
function localPath(raw) {
  let p = String(raw || '').trim();
  if (/^file:\/\//i.test(p)) { try { p = decodeURIComponent(p.replace(/^file:\/\/(localhost)?/i, '')); } catch { return { error: '路径的编码不对' }; } }
  p = p.replace(/^~(?=$|\/)/, HOME);
  return path.isAbsolute(p) ? { p } : { error: '不是完整路径' };
}
function findSession(sid) { return sessions.find((s) => s.sid === sid); }

// ───────────── 远程预览（C1，11/21，remote-full-brief §3.2）─────────────
// 手机传 { sid, path }：服务先 realpath，再核这个真身出现在这个会话的交付正文、或「这一轮改的文件」里；不在就 404。
// 他本人说的话不算证据（远程能 /api/send，自己打一句路径就能自证）。手机自己编的路径、../、链接指到外面，真身都对不上。
// 11/22 修（1b 验收）：一个路径只解析一次（rpResolve），之后每道判断、发出去的都是这同一份真身，中间不再按原来的写法解析第二次。
// 真身收成一种写法：大小写不同的写法（/Users/Khalil）、firmlink 别名（/System/Volumes/Data/Users/khalil）都收成同一个；「是不是主目录 / 它的上层」按 dev+ino 比，不按字面
const FIRM = '/System/Volumes/Data';               // macOS 的数据卷：/Users、/private、/Volumes 这些在它下面另有一份同一个东西的写法（firmlink）
const idOf = (p) => { try { const s = fs.statSync(p, { bigint: true }); return s.dev + ':' + s.ino; } catch { return ''; } };
function rpCanon(p) {                              // 真身：realpathSync.native 收掉链接和大小写；firmlink 别名它收不掉，去掉前缀后是同一个东西（dev+ino）就用去掉前缀的那个。不在就抛错
  const r = fs.realpathSync.native(p);
  if (!r.startsWith(FIRM + '/')) return r;
  const id = idOf(r);
  try { const t = fs.realpathSync.native(r.slice(FIRM.length)); if (id && idOf(t) === id) return t; } catch {}
  return r;
}
const HOME_REAL = (() => { try { return rpCanon(HOME); } catch { return HOME; } })();
const rpHomeIds = () => { const ids = []; for (let a = HOME_REAL; ; a = path.dirname(a)) { ids.push(idOf(a)); if (a === path.dirname(a)) return ids; } };   // [主目录, 上一级, …, /] 的 dev+ino，每次现查
// 一个完整路径 → 只解析这一次。先按字面规整（path.resolve：结尾的 /.、/..、重复的 / 都收掉），「它本身是不是链接」看的是规整后的这一级；
// 再取真身。link：这一级本身是链接（lstat 到的和真身不是同一个东西）。取不到真身回 { n }
function rpResolve(p) {
  const n = path.resolve(p); let ls, real, st;
  try { ls = fs.lstatSync(n, { bigint: true }); real = rpCanon(n); st = fs.statSync(real, { bigint: true }); } catch { return { n }; }
  return { n, real, st, id: st.dev + ':' + st.ino, link: ls.isSymbolicLink() || ls.dev !== st.dev || ls.ino !== st.ino };
}
const RP_MS = (SANDBOX && Number(process.env.CCBOARD_RP_TTL_MS)) || RP_TTL;   // 钥匙多久作废；试验场可调短，线上不认
const rpKeys = new Map();                          // 钥匙 → { dev, login, real, name, fid（发钥匙时核过的 dev:ino）, exp }
const rpByFile = new Map();                        // 设备号 + 真身 → 钥匙（同一台再点同一个文件，网址不变、续期）
function rpEvidence(sid) {
  const tr = tracks.get(sid) || codexTracks.get(sid);
  const file = (tr && tr.file) || (Object.hasOwn(archive.items, sid) && archive.items[sid].file);
  if (!file || !fs.existsSync(file) || (file.includes('/.codex/') && !CONFIG.codex)) return null;
  const raws = [];
  for (const t of file.includes('/.codex/') ? readCodexTurns(file, 40) : readTurns(file, 40)) for (const r of t.results || []) raws.push(...pathsIn(r.text));
  const cur = sessions.find((x) => x.sid === sid);
  if (tr && tr.st && tr.st.wrote && cur) { const cwd = String(cur.cwd || '').replace(/^~(?=$|\/)/, HOME); for (const w of tr.st.wrote.keys()) { const a = absOf(w, cwd); if (a) raws.push(a); } }
  const abs = new Set(), real = new Set(), linked = new Set();
  for (const r of raws) { const { p } = localPath(r); if (!p) continue; const x = rpResolve(p); abs.add(x.n); if (x.real) (x.link ? linked : real).add(x.real); }   // 写到的是链接：它指去的地方不算写到（11/22 修：原来把链接的真身放进了证据，直接要它指去的那个就给了）
  return { abs, real, linked };
}
// 一个路径 → 能不能给。先核「对话里出现过」再说别的，不让手机拿「不在 / 不是文件」探出本机有哪些文件
function rpFile(raw, ev) {
  const { p } = localPath(raw); if (!p) return { why: 'bad-path' };
  const x = rpResolve(p);
  if (!x.real) return { why: ev.abs.has(x.n) ? 'missing' : 'not-in-conversation' };
  if (x.link) return { why: ev.real.has(x.real) || ev.linked.has(x.real) ? 'link' : 'not-in-conversation' };   // 要的这一级本身是链接（指到别处）不给，和本机预览「链接指到文件夹外面 404」同一条；上层文件夹是链接（/tmp）照常。只对写到过的说「是链接」
  if (!ev.real.has(x.real)) return { why: 'not-in-conversation' };
  const { real, st, id } = x;
  if (hiddenPath(real, HOME_REAL)) return { why: 'hidden' };
  if (!st.isFile()) return st.isDirectory() ? { why: 'folder', real, id } : { why: 'no-preview' };   // 文件夹带上真身和 dev:ino：单个路径点的是文件夹时走 rpGallery（C1.1）
  const kind = kindOf(path.extname(real).slice(1));
  return kind ? { real, id, size: Number(st.size), kind, name: path.basename(real), dir: path.dirname(real) } : { why: 'no-preview' };
}
// 文件夹 → 图集（C1.1，11/21 Khalil 本人要的）。文件夹本身要在交付里写到过（rpFile 已经核过：真身在证据里、本身不是链接、主目录以下没有点开头的段）；
// 只写到文件夹里某个文件不算写到这个文件夹。主目录、它的上层、/tmp 这种顶层不列。只列第一层、真放在里面的图和视频（链接一律不列），
// 达标线、排法、上限和本机图集一样（listGallery）；应答只带列出来的媒体文件名，文件夹里别的文件名不露
// 威胁模型见 CLAUDE.md「手机远程」的「远程预览」：防的是远程那一头；本机同一个用户在列完和逐张 lstat 之间换文件夹的竞态在信任边界里面，
// 这一车不修，留作已知会红的用例 test/known-red/preview-gallery-race.mjs（修法方向和「只调顺序不算修好」写在它的文件头）
function rpGallery(dir, id) {
  const home = rpHomeIds();
  if (id === home[0]) return { why: 'shallow' };                      // 主目录本身（按 dev+ino 比：/Users/Khalil、firmlink 别名都认得出，11/22 修）
  if (home.slice(1).includes(id)) return { why: 'shallow' };          // 主目录的上层
  const top = dir === FIRM ? '/' : dir.startsWith(FIRM + '/') ? dir.slice(FIRM.length) : dir;   // 数据卷下没有短写法的，按去掉前缀算层数（/System/Volumes/Data/mnt 也是顶层）
  if (top.split(path.sep).length <= (/^\/(private|Volumes)\//.test(top) ? 3 : 2)) return { why: 'shallow' };   // 顶层（/tmp 的真身是 /private/tmp，外接盘根是 /Volumes/<盘>）
  const g = listGallery(dir, { direct: true });
  if (g.error) return { why: g.error === 'missing' ? 'missing' : 'not-gallery' };
  if (idOf(dir) !== id) return { why: 'missing' };                    // 列的时候文件夹被换掉了：不给
  const media = [];
  for (const m of g.media) { let s; try { s = fs.lstatSync(m.real, { bigint: true }); } catch { continue; } if (s.isFile()) media.push({ ...m, id: s.dev + ':' + s.ino }); }   // 每张带上它的 dev:ino，钥匙绑这个
  return { ...g, media };
}
function rpKey(dev, login, f) {
  const k = dev.id + '\0' + f.real; let id = rpByFile.get(k);
  if (id && rpKeys.has(id)) rpKeys.delete(id); else id = crypto.randomBytes(16).toString('hex');
  rpKeys.set(id, { dev, login, real: f.real, name: f.name, fid: f.id, exp: Date.now() + RP_MS }); rpByFile.set(k, id);
  while (rpKeys.size > RP_KEEP) { const [old, it] = rpKeys.entries().next().value; rpKeys.delete(old); rpByFile.delete(it.dev.id + '\0' + it.real); }
  return '/rp/' + id + '/' + encodeURIComponent(f.name);
}
// 发之前按那一份真身打开，核打开的就是当时核过的那个文件（dev+ino），发的就是这个打开的 fd：核和发之间不再按路径解析第二次（11/22 修）。
// O_NOFOLLOW：最后一级被换成链接就打不开；O_NONBLOCK：被换成管道也不会卡住整个服务。对不上回 null
function rpOpen(real, fid) {
  let fd; try { fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return null; }
  let st = null; try { st = fs.fstatSync(fd, { bigint: true }); } catch {}
  if (!st || !st.isFile() || st.dev + ':' + st.ino !== fid) { fs.closeSync(fd); return null; }
  return { fd, size: Number(st.size) };
}
const rpName = (s) => String(s).replace(/[\x00-\x1f\x7f\s]/g, '_').slice(0, 80);   // 日志里只记文件名，换行伪造不出日志行
// PDF 按附件发（11/22 Khalil 定：远程不画 PDF，界面给一个下载链接）。文件名两份：ASCII 那份把别的字换成 _，filename* 那份 RFC 5987 编码
const rpAttach = (name) => 'attachment; filename="' + String(name).replace(/[^\x20-\x7e]|["\\]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const RP_CSP = "sandbox allow-scripts allow-popups allow-forms; frame-ancestors 'self'";
// 远程端口上发钥匙对应的那一个文件。一律套 CSP 沙盒（不给 allow-same-origin）：远程端口和总控台界面同源，不沙盒的话预览页能读走 localStorage 里的设备凭证。
// PDF 原来不套沙盒（沙盒里浏览器的 PDF 阅读器不显示），11/22 起远程不画 PDF、按附件发，就一起套上
function rpServe(req, res, u, rem) {
  const nope = () => reply(res, 404, { error: 'not found' });
  const m = /^\/rp\/([0-9a-f]{32})\/([^/]+)$/.exec(u.pathname); if (!m) return nope();
  const it = rpKeys.get(m[1]);
  if (!rpKeyOk(it, devices, rem.login, Date.now())) { if (it && it.exp <= Date.now()) rpKeys.delete(m[1]); { const why = it ? (it.exp <= Date.now() ? 'expired' : it.login !== rem.login ? 'other-login' : 'device-gone') : 'unknown'; remoteLog(`deny rp-key ${why} GET /rp/`, 'rp:' + why); } return nope(); }
  let name; try { name = decodeURIComponent(m[2]); } catch { return nope(); }
  const type = mimeOf(path.extname(it.real).slice(1));
  if (name !== it.name || !type) return nope();
  const o = rpOpen(it.real, it.fid); if (!o) return nope();          // 发钥匙以后文件被换成链接、换了一个文件、上层文件夹被换掉：不发
  devSeen.set(it.dev.id, Date.now());
  serveFile(req, res, { real: it.real, fd: o.fd, type, size: o.size }, { 'content-security-policy': RP_CSP, ...(type === 'application/pdf' ? { 'content-disposition': rpAttach(it.name) } : {}) });
}

async function waitDelivered(sid, text, since, files = []) {
  const key = text.replace(/\s+/g, ' ').trim().slice(0, 24);
  const names = files.map((f) => path.basename(f));
  const hit = (v) => { if (!v) return false; const t = String(v).replace(/\s+/g, ' ');
    return key ? t.includes(key) : (/\[Image #\d+\]/.test(t) || names.some((n) => t.includes(n))); };
  for (let i = 0; i < 24; i++) {
    await sleep(400);
    const tr = tracks.get(sid) || codexTracks.get(sid); if (!tr) break;
    try { tr.refresh(); } catch {}
    const st = tr.st;
    if (st.promptAt && Date.parse(st.promptAt) >= since - 2000 && hit(st.prompt)) return true;
    if (st.queued && Date.parse(st.queued.at) >= since - 2000 && hit(st.queued.text)) return true;
    if (isKeepWarm(text) && st.kwAt && Date.parse(st.kwAt) >= since - 2000) return true;   // 保温那句不进 st.prompt（整轮跳过），看保温的时间
  }
  return false;
}

async function sendTo(sid, text, rawFiles) {
  const files = await cleanFiles(rawFiles);
  if (!text && !files.length) return { ok: false, error: '没有内容' };
  const s0 = findSession(sid);
  if (!s0) return { ok: false, error: '这个会话已经不在了' };
  if (s0.ask || s0.status === 'waiting') return { ok: false, error: '它弹了一个选择框在等你选，直接打字会替你乱选，请点「终端」去回答' };
  const since = Date.now();
  if (s0.channel === 'tmux') {
    scanSessions();
    const s1 = findSession(sid);
    if (!s1 || s1.ask || s1.status === 'waiting') return { ok: false, error: '它弹了一个选择框在等你选，请点「终端」去回答' };
    const scr = await tmuxFor(s0.tmux, ['capture-pane', '-p', '-t', s0.tmux]);     // 屏幕上真有选择框就不发（登记的状态可能慢半拍）
    if (!scr.ok) return { ok: false, error: '这个会话已经不在了' };
    if (parseDialog(scr.out)) return { ok: false, error: '它弹了一个选择框在等你选，先在卡片上选完再发' };
    for (const piece of pieces(s0, text, files)) {
      const a = await tmuxFor(s0.tmux, ['load-buffer', '-b', 'ccb-in', '-'], { input: piece });   // 缓冲区是每台服务器自己的：放在目标会话那台上
      if (!a.ok) return { ok: false, error: 'tmux：' + a.err };
      const b = await tmuxFor(s0.tmux, ['paste-buffer', '-p', '-d', '-b', 'ccb-in', '-t', s0.tmux]);
      if (!b.ok) return { ok: false, error: 'tmux：' + b.err };
      await sleep(files.length ? 450 : 0);                      // 图片要等它读进来变成 [Image #n]
    }
    await sleep(500);
    await tmuxFor(s0.tmux, ['send-keys', '-t', s0.tmux, 'Enter']);
  } else {
    await refreshTerms(); scanSessions();            // 发之前重新对一次，标题变了就不发
    const s = findSession(sid);
    if (s && (s.ask || s.status === 'waiting')) return { ok: false, error: '它弹了一个选择框在等你选，请点「终端」去回答' };
    if (!s || s.channel !== 'ghostty' || !s.term) return { ok: false, error: '没对上它在 Ghostty 里的标签（标题重名或还没生成），请去终端里回' };
    const r = await osa(SEND_GHOSTTY, [s.term, ...pieces(s, text, files)], 30000);
    if (!r.ok) return { ok: false, error: 'Ghostty：' + r.err };
  }
  const delivered = await waitDelivered(sid, text, since, files);
  return { ok: true, delivered };
}

async function focusSession(sid) {
  const s = findSession(sid);
  if (!s) return { ok: false, error: '这个会话已经不在了' };
  if (s.channel === 'tmux') return openAttach(s.tmux);
  if (!s.term) return { ok: false, error: '没对上它在 Ghostty 里的标签' };
  const r = await osa(FOCUS_GHOSTTY, [s.term]);
  return r.ok ? { ok: true } : { ok: false, error: r.err };
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const isImage = (p) => IMAGE_EXT.has(path.extname(p).toLowerCase());
const SIPS = '/usr/bin/sips';
function uploadPath(name) {
  const d = new Date(); const dir = path.join(UPLOAD_DIR, d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '').slice(-60) || 'file';
  return path.join(dir, p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '-' + crypto.randomBytes(2).toString('hex') + '-' + base);
}
// 手机照片常是 HEIC，Claude Code 不认；太大的图也先缩一下。原文件不动，转出来的放进 uploads。
async function normalizeFile(p) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const ext = path.extname(p).toLowerCase();
  if (ext === '.heic' || ext === '.heif' || ext === '.tiff' || ext === '.tif' || ext === '.bmp') {
    const out = uploadPath(path.basename(p, path.extname(p)) + '.jpg');
    const r = await run(SIPS, ['-s', 'format', 'jpeg', '-Z', '2400', p, '--out', out], { timeout: 60000 });
    if (r.ok && fs.existsSync(out)) return out;
    return p;
  }
  if (isImage(p) && ext !== '.gif' && st.size > 5 * 1024 * 1024) {
    const out = uploadPath(path.basename(p, path.extname(p)) + '.jpg');
    const r = await run(SIPS, ['-s', 'format', 'jpeg', '-Z', '2400', p, '--out', out], { timeout: 60000 });
    if (r.ok && fs.existsSync(out)) return out;
  }
  return p;
}
function fileInfo(p) { let size = 0; try { size = fs.statSync(p).size; } catch {} return { path: p, name: path.basename(p), size, image: isImage(p) }; }
async function cleanFiles(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list.slice(0, 12) : []) {
    const p = String(f || ''); if (!path.isAbsolute(p)) continue;
    const n = await normalizeFile(p); if (n) out.push(n);
  }
  return out;
}
// 图片单独贴一段原始路径，Claude Code 会把它变成 [Image #n]；别的文件带引号当文字；最后才是你的话
function pieces(s, text, files) {
  const q = (f) => (isImage(f) ? f : '"' + f + '"');
  if (s.provider === 'codex') return [[...files.map((f) => '"' + f + '"'), text].filter(Boolean).join(' ')];
  const out = [];
  files.forEach((f, i) => { if (i) out.push(' '); out.push(q(f)); });
  if (text) out.push((files.length ? ' ' : '') + text);
  return out;
}
const PICK_FILES = `
on run argv
  tell me to activate
  set fs to choose file with prompt (item 1 of argv) with multiple selections allowed
  set out to ""
  repeat with f in fs
    set out to out & (POSIX path of f) & linefeed
  end repeat
  return out
end run
`;
function purgeUploads() {
  if (READONLY) return;
  try {
    for (const d of fs.readdirSync(UPLOAD_DIR)) {
      const full = path.join(UPLOAD_DIR, d); const st = fs.statSync(full);
      if (Date.now() - st.mtimeMs > KEEP_DELETED_DAYS * 86400000) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
}

const CLOSE_TERM = `
on run argv
  tell application "Ghostty" to close (first terminal whose id is (item 1 of argv))
end run
`;

// 停掉一个会话的进程。只认「登记里这个进程号现在还是这个会话」；不强杀。
async function stopSession(s) {
  leaving.set(s.sid, Date.now());                   // 是我们自己停的，别当成「意外退出」来提醒
  if (s.provider === 'codex') {                     // Codex 会话都是总控台自己起在 tmux 里的
    if (!/^ccb-[\w-]+$/.test(s.tmux || '')) return { ok: false, error: '不是总控台开的会话' };
    await tmuxFor(s.tmux, ['kill-session', '-t', s.tmux]);
    for (let i = 0; i < 25 && alive(s.pid); i++) await sleep(200);
    delete agents[s.tmux]; saveAgents(); codexTracks.delete(s.sid);
    return alive(s.pid) ? { ok: false, error: '它没停下来' } : { ok: true };
  }
  let reg = null;
  try { reg = JSON.parse(fs.readFileSync(path.join(SESS_DIR, s.pid + '.json'), 'utf8')); } catch {}
  if (!reg || reg.sessionId !== s.sid) return alive(s.pid) ? { ok: false, error: '进程号和会话对不上，没动它' } : { ok: true };
  if (s.channel === 'tmux' && /^ccb-[\w-]+$/.test(s.tmux || '')) {
    await tmuxFor(s.tmux, ['kill-session', '-t', s.tmux]);
  } else {
    const cmd = await run('/bin/ps', ['-o', 'command=', '-p', String(s.pid)]);
    if (!/claude/.test(cmd.out)) return { ok: false, error: '这个进程不是 Claude Code，没动它' };
    try { process.kill(s.pid, 'SIGTERM'); } catch {}
  }
  for (let i = 0; i < 40 && alive(s.pid); i++) await sleep(200);
  if (alive(s.pid)) return { ok: false, error: '它没停下来（我不强杀），请去终端里输入 /exit' };
  let tabClosed = false;
  if (s.channel === 'ghostty' && s.term) {          // 标签的标题确实变了（不再是这个会话）才关标签
    await sleep(700); await refreshTerms();
    const t = terms.find((x) => x.id === s.term);
    if (t && t.title !== s.termTitle) { const r = await osa(CLOSE_TERM, [s.term]); tabClosed = r.ok; }
  }
  return { ok: true, tabClosed };
}

function scheduleStop(sid) {
  const it = archive.items[sid]; if (!it) return;
  clearTimeout(stopTimers.get(sid));
  stopTimers.set(sid, setTimeout(async () => {
    stopTimers.delete(sid);
    const cur = archive.items[sid];
    if (!cur || cur.state !== 'archiving') return;
    const s = allSessions.find((x) => x.sid === sid);
    const r = s ? await stopSession(s) : { ok: true };
    if (r.ok && cur.drop) { dropArchived(sid, cur); return; }
    if (r.ok) { cur.state = 'archived'; delete cur.stopAt; }
    else { delete archive.items[sid]; notices.push({ id: crypto.randomBytes(4).toString('hex'), text: '「' + cur.title + '」没归档成：' + r.error }); }
    saveArchive(); scanSessions();
  }, Math.max(0, it.stopAt - Date.now())));
}

// 「归档」一个按钮（11/13 Khalil：「我就直接点一个归档，你就自己觉得该删的删，该记下来的记下来」）。
// 删：没留下东西的——一句话没说过；或者没改过文件、工具用了不到 4 次、你只说过一两句。其余留着（能接回来）。
// 在等你决定的（待跟进）一律留着。只看对话记录读进来的那一段（最近的 4 MB 起），长会话照样算「做了很多事」。
function tidyVerdict(s, st) {
  if (s.digest && s.digest.need === 'reply') return { keep: true, why: '它在等你决定' };
  if (!st.nHuman && !st.result) return { keep: false, why: '一句话都没说过' };
  if (!st.nEdits && st.nTools <= 3 && st.nHuman <= 2) return { keep: false, why: '只聊了几句，没改过文件' };
  return { keep: true, why: st.nEdits ? '改过 ' + st.nEdits + ' 次文件' : '用了 ' + st.nTools + ' 次工具' };
}
// 归档时记一笔：属于哪个项目、最后交付的那句结论、要你做的事、动过哪几个文件夹。归档列表里直接看得到
function tidyNote(s, st) {
  const roots = [...(st.files || new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r.replace(/^Projects\//, ''));
  const dg = s.digest || {};
  return { project: s.project ? s.project.name : null, head: dg.head || null, ask: dg.need === 'reply' ? dg.ask || null : null, roots, human: st.nHuman, tools: st.nTools, edits: st.nEdits };
}
function archiveSession(sid, force, auto) {      // auto = 自动收工的理由（字符串）；手点的不带
  const s = allSessions.find((x) => x.sid === sid);
  if (!s) return { ok: false, error: '这个会话已经不在了' };
  if (archive.items[sid]) return { ok: true, grace: GRACE };
  if (s.status === 'busy' && !force) return { ok: false, needConfirm: true, error: '它还在做事，归档会打断它。' };
  const tr = tracks.get(sid) || codexTracks.get(sid), st = tr ? tr.st : newState(), v = tidyVerdict(s, st);
  const why = auto ? auto + '，' + v.why : v.why;
  const account = readTap(sid)?.account;
  archive.items[sid] = { sid, provider: s.provider || 'claude', ...(typeof account === 'string' && account.trim() ? { account } : {}), title: s.title, cwd: s.cwd, file: tr ? tr.file : null, prompt: s.prompt, resultAt: s.resultAt, ...(isGemini(s.model) ? { gemini: s.model } : {}),
    archivedAt: Date.now(), state: 'archiving', stopAt: Date.now() + GRACE, note: tidyNote(s, st), why, ...(auto ? { auto: true } : {}), ...(v.keep ? {} : { drop: true }) };
  processed.delete(sid);
  saveArchive(); scheduleStop(sid); scanSessions();
  return { ok: true, grace: GRACE, keep: v.keep, why };
}

// ── 自动收工：这个窗口结束了没？（Khalil 11/13 16:10：「有些 Tab 我打完我就懒得关……自动分析当前窗口结束了没，然后你关掉」）──
// 「结束了」= 这一轮已经交付、现在歇着、没有人在等它、也没有人再理它。拿不准就不收：多留一个标签的代价是他现状，误关一个还在等他的窗口才是事故。
// 四条线（谁来收拾 → archiveSession；删还是留 → tidyVerdict，和手点「归档」同一套）：
//   fast   待审阅，他点过「审完了」，之后安静 TIDY_FAST_MS（他明说看完了）
//   fyi    无需处理的交付（回给别的窗口的、过程汇报），没人再理它 TIDY_FYI_MS
//   smart  同上，才安静 TIDY_SMART_MS，但小模型看过说「做完了」（tidyJudge 打开时；见下面 askJudge）
//   review 待审阅却一直没点「审完了」，TIDY_REVIEW_MS（他显然丢开了；归档笔记里留着那句结论）
// 绝不收：在跑 / 等你选 / 停住了（有 alert）/ 待跟进 / 它说后台还在跑 / 这一轮没收尾 / 还没交付过。
// 11/17 起还不收（watchTidy 里挡）：总管 / 负责人 / 分支负责人（car4，khalil-49）、它开的窗口还在墙上（car5）；
// 开着 tidyJudge 时四条线到点都先问小模型，只有明说 done 才收：waiting（它自己还有后续：在等别的窗口，或说了到点、明早、某件事之后由它来做、定了定时）、yours、判不出来都不收（car5）。
const tidySpan = (ms) => (ms < 90000 ? '几十秒' : ms < 5400000 ? Math.round(ms / 60000) + ' 分钟' : Math.round(ms / 3600000) + ' 小时');
function tidyDue(s, now) {
  if (snoozes[s.sid]) return null;                                                          // 先放着的不收：它推迟中又交付了【进展】，到点要回来
  if (s.status !== 'idle' || s.ask || s.alert || !s.done || !s.result || !s.digest) return null;
  const need = s.digest.need;                                                                // 下面四条线各认自己的 need：reply（待跟进）、bg（后台还在跑）哪条都不沾
  const t0 = Date.parse(s.resultAt || ''); if (!t0) return null;
  const last = Math.max(t0, Date.parse(s.lastAt || '') || 0, s.statusAt || 0);              // 交付之后它又有过什么动静，从那时算起
  const quiet = now - last, p = processed.get(s.sid);
  let d = null;
  if (need === 'review' && p && p.at === String(s.resultAt) && now - Math.max(last, p.seenAt) >= TIDY_FAST_MS) d = { line: 'fast', why: '你点过「审完了」' };
  else if (need === 'fyi' && quiet >= TIDY_FYI_MS) d = { line: 'fyi', why: '无需处理的交付，' + tidySpan(quiet) + '没人理它' };
  else if (need === 'fyi' && quiet >= TIDY_SMART_MS && judgeOn()) d = { line: 'smart', why: '无需处理的交付，' + tidySpan(quiet) + '没人理它，看过没有要你定的事' };
  else if (need === 'review' && quiet >= TIDY_REVIEW_MS) d = { line: 'review', why: '待审阅的交付，' + tidySpan(quiet) + '没点「审完了」' };
  if (!d || !judgeOn()) return d;                                                            // 没开小模型：照旧按时间（岗位和带着下级的在 watchTidy 里挡）
  // 开着小模型时，四条线收之前都先看这次交付的判断（11/17 car5，khalil-f7）。Khalil 11/17 22:4x：「我们以后不能在归档的时候，就把该做的直接自动收工了」。
  // 起因：一个总管窗口走 fast 线被收：他点过那次交付的「审完了」，而它那轮刚答应第二天早上还要替他做一件事、定了一次性定时，进程一停定时也没了；
  // 一个增长负责人窗口走 smart 线被收（小模型判 done，理由是要他本人动手的都是以后的事）。原来只有 smart 线问小模型，fast / fyi / review 只看时间。
  const j = judged.get(s.sid);
  if (!j || j.at !== String(s.resultAt)) return { line: 'judge', from: d.line };           // 这次交付还没问过：交给 watchTidy 去问（每次交付只问一次）
  if (j.v === 'pending') return null;
  if (!j.v && now - (j.failAt || 0) >= JUDGE_RETRY_MS) return { line: 'judge', from: d.line };   // 判不出来的隔一段再问（额度用完、登录过期，回来以后不能一直卡着；car5 复审 #5）
  // 只有明说做完了（done）才收。waiting = 它自己还有后续；yours = 还有要他定的事（三种答案互斥，同时有后续和问题时它可能只报 yours，所以 yours 也不收）；
  // 判不出来（命令失败、答非所问）= 保护性的判断拿不准，落在「不收」。离线考的数见 CLAUDE.md「还有后续的不收」
  const v = j.v ? j.v.verdict : null;
  if (v !== 'done') return { line: 'hold', from: d.line, why: v === 'waiting' ? '它自己还有后续：' + (j.v.why || '在等') : v === 'yours' ? '还有要你定的事：' + (j.v.ask || j.v.why || '') : j.quota ? '判官没额度，拿不准就不收（' + (j.failWhy || '') + '）' : '判不出来，拿不准就不收' };
  return d;
}
// ── 收之前看一眼（tidyJudge）：无需处理的交付安静了 TIDY_SMART_MS，让小模型读一遍它最后那段交付 ──
// Khalil 11/15：「交付了，4 个小时就可以关了……你可以智能地看看这个窗口还有没有什么值得我进一步定的；没有的话，就可以把它关了」。
// 只看状态行不够：11/15 量了过去 4 天安静 ≥ 4 小时的 27 次「进展」交付，正文里常留着要他本人做的事（过目一页、回一句话），
// 也常在等别的窗口（等另一个窗口给出快照号再重做）；按关键词分不开（「等你看过再定」里也有「等」字）。
// 三种答案（judge.mjs）：done → 收（smart 线不用等满 TIDY_FYI_MS）；waiting（它自己还有后续）→ 不收；yours → 不收，fyi 的卡片改成待跟进、亮出那件事（applyJudged）。
// 判不出来（命令失败、超时、答非所问）记成 null，不收，隔 JUDGE_RETRY_MS 再问（car5 起；之前是照旧等满 TIDY_FYI_MS 再收）。
// 每次交付只问一次（judged 按 resultAt 记，交付变了就重新问），一次只问一个。待审阅的交付不在 4 小时问（11/15 Khalil：「待审阅留 24 小时」），
// 11/17 car5 起在它到 fast 线（点了「审完了」）或 review 线（24 小时）时才问，问的是同一件事：它自己还有没有后续。
// 调用：claude -p，haiku，不读设置文件（没有 hook、插件、CLAUDE.md）、不带工具、不存会话。11/15 拿 27 次真实交付跑：平均 1818 token、4.3 秒，0 次判不出来。
// 试验场不调真的 claude：没给 CCBOARD_JUDGE（测试里的假命令）就当没打开。
// sid → { at: 那次交付的 resultAt, v: 'pending' | { verdict, ask, why } | null（判不出来）, failAt?, owed?: { at, why, tail }, seen }
// 落盘（judged.json，car5 复审 #2）：只放内存的话，服务一重启、会话登记读坏一轮它短暂不在墙上，hold 就没了，再问一次等于重掷一次。
// owed（复审 #1）：判成 waiting 的那次交付的结尾，之后每次交付都带给小模型（<earlier_followup>），直到某次判成 done 才清掉。
//   不带的话，「定了 08:04 定时，明早我做」之后它又回了别的窗口一句「收到」，只拿这句去问就是 done，照收。
const JUDGED_FILE = path.join(DATA, 'judged.json');
const JUDGE_RETRY_MS = Number(process.env.CCBOARD_JUDGE_RETRY_MS) || 3600000;
const JUDGED_KEEP_MS = 6 * 3600000;      // 不在墙上这么久才删（短暂读不到、刚归档又接回来的都还在）
const okVerdict = (v) => v === null || (v && typeof v === 'object' && VERDICTS.includes(v.verdict));
const judged = new Map();
try {
  const j = JSON.parse(fs.readFileSync(JUDGED_FILE, 'utf8'));
  if (j && typeof j === 'object' && !Array.isArray(j)) for (const [k, x] of Object.entries(j)) {
    if (!/^[\w-]{8,80}$/.test(k) || !x || typeof x.at !== 'string' || !okVerdict(x.v)) continue;   // 同 SID_RE（它定义在下面）
    const owed = x.owed && typeof x.owed.tail === 'string' ? { at: String(x.owed.at || ''), why: String(x.owed.why || ''), tail: x.owed.tail.slice(-1500) } : null;
    judged.set(k, { at: x.at, v: x.v, failAt: Number(x.failAt) || 0, quota: x.quota === true, failWhy: typeof x.failWhy === 'string' ? x.failWhy.slice(0, 160) : '', owed, seen: Date.now() });
  }
} catch {}
function saveJudged() {
  if (READONLY) return;
  const out = {}; for (const [k, x] of judged) if (x.v !== 'pending') out[k] = { at: x.at, v: x.v, ...(x.failAt ? { failAt: x.failAt } : {}), ...(x.quota ? { quota: true, failWhy: x.failWhy || '' } : {}), ...(x.owed ? { owed: x.owed } : {}) };
  try { const tmp = JUDGED_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out, null, 1)); fs.renameSync(tmp, JUDGED_FILE); } catch (e) { console.log(`judged ${new Date().toISOString()} 写不进 judged.json：${e.message}`); }
}
// 判官（judge、自动续跑）用哪个号：config.judgeAccount，不写就跟 defaultAccount（新窗口的默认号），都没写才是钥匙串当前登录的号。
// 起因：判官一直走钥匙串当前登录的号，那个号周额度用完以后，自动收工很长一段时间一个都没收。
// 登记的号这会儿用不了（钥匙串里没有它的 token）：这一次算判不出来、照旧不收，不悄悄退回当前登录的号（同 defaultAccount 的规矩）
// 服务刚起、号表还没读完（refreshAccounts 没 await）：这一拍先不问，什么都不记，下一拍再来。不然会记成假的「号不可用」、一小时后才重问（审查 #3）
const smallModelWaits = () => !!(CONFIG.judgeAccount || CONFIG.defaultAccount) && !acctLoaded;
function smallModelLaunch(cmd, args) {
  const id = CONFIG.judgeAccount || CONFIG.defaultAccount;
  if (!id) return { argv: [cmd, ...args] };
  const a = acctList.find((x) => x.id === id);
  if (!a || !a.ready) return { error: '号不可用：' + String(id).slice(0, 40) + '（钥匙串里没有它的 token）' };
  return { argv: wrapBackground(a, [cmd, ...args]) };
}
let judgeBusy = false;
const judgeOn = () => CONFIG.tidyJudge && (!SANDBOX || !!process.env.CCBOARD_JUDGE);
async function askJudge(s) {
  if (smallModelWaits()) return;
  const at = String(s.resultAt), tr = tracks.get(s.sid) || codexTracks.get(s.sid), prev = judged.get(s.sid), owed = (prev && prev.owed) || null;
  const text = (tr && tr.st.result) || s.result;
  judgeBusy = true; judged.set(s.sid, { at, v: 'pending', owed, seen: Date.now() });
  let v = null, err = '', quota = false, failWhy = '';
  try {
    const cmd = process.env.CCBOARD_JUDGE || await findClaude();
    const L = smallModelLaunch(cmd, judgeArgs());
    if (L.error) err = L.error;
    else {
      const r = await run(L.argv[0], L.argv.slice(1), { input: judgeInput({ title: s.title, prompt: s.prompt, text, earlier: owed ? owed.tail : '' }), timeout: 90000 });
      v = parseJudge(r.out);
      if (!v) { const f = failReason(r); quota = f.kind === 'quota'; failWhy = f.text; err = quota ? '判官没额度：' + f.text : f.kind ? '命令失败：' + f.text : '答非所问'; }
    }
  } catch (e) { err = e.message; }
  // owed：判 done 清掉；之前没欠着、这次判 waiting → 记下这次的结尾；别的（yours、判不出来、已经欠着又判 waiting）原样带着最早没了结的那次
  const next = v && v.verdict === 'done' ? null : owed || (v && v.verdict === 'waiting' ? { at, why: v.why, tail: String(text || '').slice(-1500) } : null);
  judged.set(s.sid, { at, v, failAt: v ? 0 : Date.now(), quota: !v && quota, failWhy: !v && quota ? failWhy : '', owed: next, seen: Date.now() });
  saveJudged();
  judgeBusy = false;
  console.log(`judge ${new Date().toISOString()} ${s.sid.slice(0, 8)} ${v ? v.verdict + ' ' + (v.ask || v.why) : 'fail ' + err}`);
}
function applyJudged(o) {        // 小模型说还有事要你定：这一次交付在墙上改成待跟进，那件事放进「要你做的事」
  const j = judged.get(o.sid);
  if (!j || !j.v || j.v === 'pending' || j.v.verdict !== 'yours' || j.at !== String(o.resultAt) || !o.digest || o.digest.need !== 'fyi') return;
  o.digest = { ...o.digest, need: 'reply', ask: j.v.ask, judged: true };
}
let tidyBusy = false;
const tidyLogged = new Set();   // 只读预览时每个会话只记一次「会收」，别每 1.2 秒刷一行
function watchTidy() {
  const live = new Set(sessions.map((x) => x.sid));
  if (Date.now() - PROC_T0 > 10000) { let pg = 0; for (const k of processed.keys()) if (!live.has(k)) { processed.delete(k); pg++; } if (pg) saveProcessed(); }     // 已经不在墙上的会话，它的「审完了」不用再记；起服务的头 10 秒不清（从盘上读回来的，别让还没扫全的头几轮当成都不在了）
  { const now0 = Date.now(); let gone = 0;                                     // 小模型的答案：在墙上的记一下时间；不在墙上满 JUDGED_KEEP_MS 才删（car5 复审 #2：读坏一轮、刚归档又接回来都还在）
    for (const [k, x] of judged) { if (live.has(k)) x.seen = now0; else if (now0 - (x.seen || 0) > JUDGED_KEEP_MS) { judged.delete(k); gone++; } }
    if (gone) saveJudged(); }
  if (!CONFIG.autoTidy || tidyBusy) return;              // archiveSession 里会再扫一遍：tidyBusy 挡住那一层
  const now = Date.now(), watching = now - uiFocusAt < 6000;   // 他正看着总控台：卡片不在他眼前消失，等他离开再收
  // 他看着的时候小模型照问（11/17 car5）：问不会让卡片消失；fast 线也要先问了，离开那一刻同一拍到点的能一起收，不用再一个个等回答
  const due = [];
  // 坐在岗位上的窗口（总管 / 负责人 / 分支负责人，架构视图 org.mjs 认的）不自动收，也不去问小模型（11/17 khalil-49）。
  // 起因：自动收拾曾经把一个分支负责人收掉了（它最后一条交付是好几个小时没动静的【进展】，小模型判成做完了），
  // 图上那个岗位就这么空了。长期带人的窗口交付多半是回别的窗口的【进展】，按交付判不出它还要不要在。
  // 架构算不出来（orgView 抛错）就这一轮谁都不收（car5 复审 #4：orgSafe 出错回空表，等于把岗位放行）
  let held = null, orgBad = false;
  const seated = (sid) => { if (!held) { let N = {}; try { N = orgView().nodes || {}; } catch (e) { orgBad = true; if (Date.now() - orgErrAt > 60000) { orgErrAt = Date.now(); console.error('org', e); } } held = new Map(Object.entries(N).filter(([, x]) => x && ['chief', 'lead', 'head'].includes(x.role)).map(([k, x]) => [k, x.role])); } return held.get(sid) || null; };
  // 它开出来的窗口还在墙上也不收（11/17 car5）：子窗口先收，下一轮再轮到它。认的是 spawn.json（/api/new 当场记的「谁开的」），不是架构里的 via spawn：
  // 架构里别的证据（他对子窗口说过话、负责人给它发过消息、钉到别的项目）会压过 spawn（复审 #4）。只认开窗口：发过几条消息太弱，会把顺手回过话的窗口一直钉着
  let kids = null;
  const spawned = (sid) => { if (!kids) { kids = new Map(); for (const x of sessions) { const by = spawnedBy(x.tmux); if (by && by !== x.sid) kids.set(by, (kids.get(by) || 0) + 1); } } return kids.get(sid) || 0; };
  const hold = (s, line, why) => { const k = 'hold:' + s.sid + '@' + s.resultAt + ':' + why.slice(0, 6); if (!tidyLogged.has(k)) { tidyLogged.add(k); console.log(`tidy ${new Date().toISOString()} hold ${s.sid.slice(0, 8)} ${line} 不收：${why}`); } };
  if (!panesAt) return;                                  // 还没对过一次 tmux 窗格：谁开的谁还认不出（复审 #4：重启头几秒父窗口会被收），这一拍先不收也不问
  for (const s of sessions) {
    const d = tidyDue(s, now); if (!d) continue;
    const role = seated(s.sid); if (orgBad) return;
    if (role) { const k = 'seat:' + s.sid + '@' + s.resultAt; if (!tidyLogged.has(k)) { tidyLogged.add(k); console.log(`tidy ${new Date().toISOString()} seat ${s.sid.slice(0, 8)} ${d.from || d.line} 不收：它是${{ chief: '总管', lead: '负责人', head: '分支负责人' }[role]}`); } continue; }
    const nk = spawned(s.sid); if (nk) { hold(s, d.from || d.line, '它开的 ' + nk + ' 个窗口还在墙上'); continue; }
    if (d.line === 'hold') { hold(s, d.from, d.why); continue; }
    if (d.line === 'judge') { if (!judgeBusy) askJudge(s); continue; }                     // 一次只问一个，问完下一轮扫描再看答案
    due.push({ s, d });
  }
  if (!due.length || watching) return;
  tidyBusy = true;
  try {
    const kept = [], dropped = [];
    for (const { s, d } of due) {
      const tag = `${s.sid.slice(0, 8)} ${d.line}`;
      if (READONLY) { const k = s.sid + '@' + s.resultAt; if (!tidyLogged.has(k)) { tidyLogged.add(k); console.log(`tidy ${new Date().toISOString()} dry ${tag} ${d.why}`); } continue; }
      const r = archiveSession(s.sid, false, d.why);
      console.log(`tidy ${new Date().toISOString()} ${r.ok ? (r.keep ? 'keep' : 'drop') : 'fail'} ${tag} ${r.ok ? r.why : r.error}`);
      if (r.ok) (r.keep ? kept : dropped).push(s.title);
    }
    const all = kept.concat(dropped);
    if (all.length) notices.push({ id: crypto.randomBytes(4).toString('hex'),
      text: '自动收工：留了 ' + kept.length + ' 个，删了 ' + dropped.length + ' 个（' + all.slice(0, 3).map((t) => '「' + String(t).replace(/\s+/g, ' ').slice(0, 14) + '」').join('') + (all.length > 3 ? ' 等' : '') + '）' });
  } finally { tidyBusy = false; }
}

// 接回时要不要带 Code Mode：记录里**最后一条** repl-mode 的 replMode（他中途在 Claude Code 里关掉会再写一条 false，Claude Code 自己读回也是 last-wins）。
// 从文件尾往前一块块读，找到就停；一条都没有 = 普通会话，不带。找不到记录、读不了、那一行坏了 → 一律不带，日志写一行（宁可少开，不替他开）。
// 只认整行就是 {"type":"repl-mode",…} 的：别的记录正文里提到这串字（比如一次 grep 的输出）不算。
const REPL_TAG = Buffer.from('"type":"repl-mode"');
const REPL_CHUNK = Math.max(16, Number(process.env.CCBOARD_REPL_CHUNK) || 256 << 10);   // 一块读多少字节；测试给 64，让夹具里的接回走跨块那几步（拼半行、超长行、切点）
async function lastReplMode(file, sid) {
  const say = (why) => { console.log(`codemode ${new Date().toISOString()} ${String(sid).slice(0, 8)} ${why}，接回不带 Code Mode`); return false; };
  if (!file) return say('找不到它的对话记录');
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const size = (await fh.stat()).size, CH = REPL_CHUNK;
    let end = size, carry = Buffer.alloc(0);           // carry：上一块（更靠后）开头那半行，接到这一块后面
    while (end > 0) {
      const start = Math.max(0, end - CH), buf = Buffer.alloc(end - start);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      if (bytesRead !== buf.length) return say('对话记录读到一半变短了');
      const all = Buffer.concat([buf, carry]);
      const cut = start > 0 ? all.indexOf(10) : -1;    // 这一块的第一行可能不完整：留给下一块（更靠前）接上
      if (start > 0 && cut < 0) { carry = all; end = start; continue; }
      const body = all.subarray(cut + 1);
      let i = body.lastIndexOf(REPL_TAG);
      while (i >= 0) {                                  // 从后往前一行一行看带这串字的行；不是 repl-mode 记录的整行跳过
        const a = body.lastIndexOf(10, i) + 1, z = body.indexOf(10, i), line = body.subarray(a, z < 0 ? body.length : z).toString('utf8').trim();
        let d = null; try { d = JSON.parse(line); } catch { if (line.startsWith('{"type":"repl-mode"')) return say('最后一条 repl-mode 那一行坏了'); }
        if (d && d.type === 'repl-mode') return d.replMode === true;
        i = a > 0 ? body.lastIndexOf(REPL_TAG, a - 1) : -1;
      }
      carry = start > 0 ? all.subarray(0, cut) : Buffer.alloc(0); end = start;
    }
    return false;                                       // 从来没开过
  } catch (e) { return say('读不了对话记录（' + (e.code || e.message) + '）'); }
  finally { if (fh) await fh.close().catch(() => {}); }
}

async function unarchive(sid) {
  const it = archive.items[sid];
  if (!it) return { ok: false, error: '归档里没有它' };
  if (it.state === 'archiving') {                   // 还没真停：直接放回墙上
    clearTimeout(stopTimers.get(sid)); stopTimers.delete(sid);
    delete archive.items[sid]; saveArchive(); scanSessions();
    return { ok: true, resumed: false };
  }
  if (it.state === 'restoring') return { ok: true, resumed: true, name: it.tmux };
  const dir = it.cwd && fs.existsSync(it.cwd) ? it.cwd : HOME;   // 已经停了：在后台把这段对话重新接上
  if (it.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };
  // 它当初是 Gemini 模型开的：接回也走 claude-gemini，不悄悄换成 Claude 的模型（占 Max 额度、模型也变了）；脚本没开 / 不在就不接，说清原因
  const gemM = it.provider !== 'codex' && isGemini(it.gemini) ? it.gemini : null;
  if (gemM && !geminiOn()) return { ok: false, error: '这个会话是用 Gemini 模型开的，config.json 的 gemini 没开或脚本不在，接回会变成 Claude 的模型，所以没接' };
  // 接回沿用原来的账号，否则会落到钥匙串当前登录的账号。
  let acct = null, accountSource = '';
  if (it.provider !== 'codex' && !gemM) {
    for (const [id, source] of [[it.account, 'archive'], [readTap(sid)?.account, 'tap']]) {
      if (typeof id !== 'string') continue;
      const found = acctList.find((a) => a.id === id);
      if (found) { acct = found; accountSource = source; break; }
    }
    if (!acct && CONFIG.defaultAccount) {
      acct = acctList.find((a) => a.id === CONFIG.defaultAccount); accountSource = 'default';
      if (!acct) return { ok: false, error: '没有这个账号：' + String(CONFIG.defaultAccount).slice(0, 40) };
    }
    if (acct && !acct.ready) return { ok: false, error: '钥匙串里还没有「' + acct.name + '」的 token' };
  }
  let name = newName();
  it.state = 'restoring'; it.tmux = name; it.restoreAt = Date.now();   // 先同步占住：排队接和他手点同一个、双击，都只会接一次（下面几个 await 期间别人看到的已经是 restoring）
  const cm = it.provider !== 'codex' && !gemM && await lastReplMode(it.file || locate(sid, it.cwd), sid);   // 所有接回（单张卡、一起退出后的排队接回）都从这里过：上次是 Code Mode 的，接回来还是
  const cl = it.provider === 'codex' ? null : [await findClaude(), '--resume', sid];   // Codex 不找 claude（第一次找可能等到 15 秒，接回的看护是 12 秒）
  let cmd = it.provider === 'codex' ? [codexBin || 'codex', 'resume', sid] : gemM ? geminiArgv(gemM, cl[0], ['--resume', sid]) : wrapLaunch(acct, cm ? withCodeMode(cl) : cl);
  let r = await openSession(name, ['-x', '160', '-y', '48', '-c', dir, ...cmd]);   // 接回来的也是自己一台 tmux
  if (r.gone && cl) {                               // 一开就退了：和 newSession 一样重开一次。先占上新名字、重新计 12 秒（重开前那几秒别人再点接回，拿到的是要开的那个）
    const was = name; name = newName(); if (archive.items[sid] === it) { it.tmux = name; it.restoreAt = Date.now(); }
    if (gemM) cmd = geminiArgv(gemM, await refindClaude(was), ['--resume', sid]); else cmd[cmd.length - cl.length] = await refindClaude(was);
    r = await openSession(name, ['-x', '160', '-y', '48', '-c', dir, ...cmd]);
  }
  if (!r.ok) { if (archive.items[sid] === it) { it.state = 'archived'; delete it.tmux; delete it.restoreAt; } return r.gone ? { ok: false, error: gemM ? GONE_GEM_MSG : cl ? GONE_MSG : '会话一开就退了' } : r; }
  if (it.provider === 'codex') { agents[name] = { cwd: dir, at: Date.now(), prompt: it.prompt || '', sid, rollout: it.file }; saveAgents(); }
  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // 11/15：恢复出来的窗口也要过信任框（主目录的信任不存）和可能有的首次向导，以前只有 newSession 点
  launches.set(name, { at: Date.now(), prompt: '恢复「' + it.title + '」', cwd: dir });
  if (acct) console.log(`account ${new Date().toISOString()} ${name} ${acct.id} ${accountSource} resume`);
  if (cm) console.log(`codemode ${new Date().toISOString()} ${name} resume ${sid.slice(0, 8)} on`);
  if (gemM) console.log(`gemini ${new Date().toISOString()} ${name} resume ${sid.slice(0, 8)} ${gemM}`);
  it.state = 'restoring'; it.tmux = name; it.restoreAt = Date.now(); saveArchive();
  await refreshPanes();
  return { ok: true, resumed: true, name };
}

async function deleteSession(sid) {
  const s = allSessions.find((x) => x.sid === sid);
  const it = archive.items[sid];
  if (!s && !it) return { ok: false, error: '找不到这个会话' };
  clearTimeout(stopTimers.get(sid)); stopTimers.delete(sid);
  const anyTr = tracks.get(sid) || codexTracks.get(sid);
  const file = (it && it.file) || (anyTr && anyTr.file) || (s && s.provider !== 'codex' && locate(sid, s.cwd));
  if (s) { const r = await stopSession(s); if (!r.ok) return r; }
  let moved = false;
  if (file && fs.existsSync(file)) {                // 对话记录不直接删：挪到暂存处，30 天后清
    fs.mkdirSync(DELETED_DIR, { recursive: true });
    const base = path.join(DELETED_DIR, Date.now() + '-' + sid);
    fs.renameSync(file, base + '.jsonl'); moved = true;
    const side = file.replace(/\.jsonl$/, '');
    try { if (fs.statSync(side).isDirectory()) fs.renameSync(side, base + '.d'); } catch {}
  }
  delete archive.items[sid]; saveArchive(); tracks.delete(sid); scanSessions();
  purgeSessionTmp(sid);
  return { ok: true, moved };
}

function moveToDeleted(file) {                   // 对话记录不直接删：挪到暂存处，30 天后清
  if (!file || !fs.existsSync(file)) return false;
  fs.mkdirSync(DELETED_DIR, { recursive: true });
  const base = path.join(DELETED_DIR, Date.now() + '-' + path.basename(file, '.jsonl'));
  fs.renameSync(file, base + '.jsonl');
  const side = file.replace(/\.jsonl$/, '');
  try { if (fs.statSync(side).isDirectory()) fs.renameSync(side, base + '.d'); } catch {}
  return true;
}
function dropArchived(sid, it) {
  const moved = moveToDeleted(it.file);
  delete archive.items[sid];
  archive.dropped = (archive.dropped || []).filter((x) => Date.now() - x.at < KEEP_DELETED_DAYS * 86400000);
  archive.dropped.unshift({ sid, title: it.title, prompt: it.prompt, why: it.why, note: it.note, at: Date.now(), moved });
  archive.dropped = archive.dropped.slice(0, 200);
  saveArchive(); tracks.delete(sid); codexTracks.delete(sid); scanSessions();
  purgeSessionTmp(sid);
}
function purgeDeleted() {
  if (READONLY) return;
  try {
    for (const f of fs.readdirSync(DELETED_DIR)) {
      const ts = Number(f.split('-')[0]);
      if (ts && Date.now() - ts > KEEP_DELETED_DAYS * 86400000) fs.rmSync(path.join(DELETED_DIR, f), { recursive: true, force: true });
    }
  } catch {}
  for (const it of Object.values(archive.items)) {          // 留着的：归档满 KEEP_TMP_MS 再清临时目录（还在归档中 / 正在接回的不碰）
    if (it.state === 'archived' && Date.now() - (it.archivedAt || 0) > KEEP_TMP_MS) purgeSessionTmp(it.sid);
  }
}

// ───────────── 会话的临时目录 ─────────────
// 只删 <CLAUDE_TMP>/<任一工作目录编码>/<会话号> 这一层。三道闸：名字是完整的会话号（挡路径穿越），
// 进程已经不在（接回来又在跑的不碰），是真目录（链接不跟）。别的窗口放在 CLAUDE_TMP 下的沙盒、worktree 名字不是会话号，碰不到。
const SID_RE = /^[\w-]{8,80}$/;   // 会话号只有字母、数字、- 和 _：没有 / 和 .，拼不出上一层
function purgeSessionTmp(sid) {
  if (READONLY) return 0;
  if (!SID_RE.test(sid || '') || sidAlive(sid)) return 0;
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_TMP, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return 0; }
  let n = 0;
  for (const d of dirs) {
    const p = path.join(CLAUDE_TMP, d.name, sid);
    try { if (!fs.lstatSync(p).isDirectory()) continue; } catch { continue; }
    try { fs.rmSync(p, { recursive: true, force: true }); n++; } catch {}
  }
  if (n) console.log(`tmp ${new Date().toISOString()} ${sid.slice(0, 8)} 清掉临时目录 ${n} 个`);
  return n;
}
function sidAlive(sid) {           // 不只看 allSessions：服务刚起时它还是空的（启动那次 purgeDeleted 在第一轮扫描之前），直接读会话登记
  if (allSessions.some((x) => x.sid === sid && alive(x.pid))) return true;
  let regs = []; try { regs = fs.readdirSync(SESS_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  for (const f of regs) {
    if (!alive(Number(f.slice(0, -5)))) continue;
    try { if (JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8')).sessionId === sid) return true; } catch {}
  }
  return false;
}

let claudeBin = null;
async function findClaude() {
  if (claudeBin) return claudeBin;
  const r = await run('/bin/zsh', ['-lc', 'command -v claude']);
  const p = r.out.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')).pop();
  claudeBin = p || 'claude';
  return claudeBin;
}
// 脚本在、config 里也开着，Gemini 模型才出现在下拉里、才能开
const geminiOn = () => !!CONFIG.gemini && fs.existsSync(CONFIG.gemini);
// 起一个 Gemini 窗口的命令行（argv，不过 shell）：env 设模型和 PATH，再 bash 跑外壳脚本，rest 是交给 claude 的其余参数（提示词、--resume <sid>）。
// PATH 加上 claude 所在的文件夹：脚本最后 exec "$(command -v claude)"，tmux 里的 PATH 不一定有它（总控台是从 App 起的，服务的 PATH 很短）
function geminiArgv(model, claude, rest) {
  const bin = path.isAbsolute(claude) ? path.dirname(claude) + ':' : '';
  return ['/usr/bin/env', 'GEMINI_MODEL=' + model, 'PATH=' + bin + (process.env.PATH || '/usr/bin:/bin'), '/bin/bash', CONFIG.gemini, ...rest];
}
const GONE_GEM_MSG = 'Gemini 会话一开就退了（claude 可能正在更新，或 claude-gemini 没起来：看 claude-gemini 转接层的日志），重开一次也没起来，过一会儿再试';
// 新开的会话一开就退了：多半是 claude 那一刻正被自动更新换掉（不止一次撞上过）。等 RESPAWN_MS 让更新写完，
// 丢掉缓存的路径重新找（缓存是服务起来后第一次找到的，更新那一秒找到的可能是空的、退回成光秃秃的 claude），调用方再换个新名字开一次。
// 不用原来的名字：那台 tmux 的看护在它退出后会 rm -f 那个套接字路径，同名新服务器的套接字可能被它删掉
async function refindClaude(name) {
  console.log(`launch ${new Date().toISOString()} ${name} 一开就退了，${RESPAWN_MS} ms 后重新找 claude、换个名字再开一次`);
  await sleep(RESPAWN_MS); claudeBin = null;
  return findClaude();
}

const BORDER = /^[\s─━═│┃╭╮╰╯┌┐└┘▔▁]+$/;
function parseDialog(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  let hint = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/enter\s+(to\s+)?(confirm|select)/i.test(lines[i])) { hint = i; break; }
  if (hint < 0) return null;
  let ci = -1;
  for (let i = hint - 1; i >= Math.max(0, hint - 14); i--) if (/[❯›]/.test(lines[i])) { ci = i; break; }   // ❯ 是 Claude Code 的光标，› 是 Codex 的
  if (ci < 0) return null;
  const strip = (l) => l.replace(/[❯›]/, ' ');
  const col = (l) => { const t = strip(l); return t.length - t.trimStart().length; };
  const c = col(lines[ci]);
  let a = ci, b = ci;
  while (a > 0 && lines[a - 1].trim() && col(lines[a - 1]) === c) a--;
  while (b + 1 < hint && lines[b + 1].trim() && col(lines[b + 1]) === c) b++;
  const options = [];
  for (let i = a; i <= b; i++) options.push(strip(lines[i]).trim());
  if (options.length < 2 || options.length > 8) return null;
  const question = lines.slice(Math.max(0, a - 10), a).filter((l) => l.trim() && !BORDER.test(l)).map((l) => l.trim()).join('\n');
  return { question, options, cursor: ci - a };
}
async function answerDialog(name, idx, text) {
  for (let i = 0; i < 12; i++) {
    const cap = await tmuxFor(name, ['capture-pane', '-p', '-t', name]);
    if (!cap.ok) return { ok: false, error: '这个会话已经不在了' };
    const d = parseDialog(cap.out);
    if (!d || d.options[idx] !== text) return { ok: false, error: '选择框的内容变了，再看一眼再选' };
    if (d.cursor === idx) { const r = await tmuxFor(name, ['send-keys', '-t', name, 'Enter']); return { ok: r.ok, error: r.err }; }
    await tmuxFor(name, ['send-keys', '-t', name, d.cursor < idx ? 'Down' : 'Up']);
    await sleep(250);
  }
  return { ok: false, error: '光标没挪到那一项，请点「终端」手动选' };
}
const waitScreens = new Map();   // tmux 会话名 → 弹框时屏幕上的字
async function refreshWaitScreens() {
  const names = new Set();
  for (const s of sessions) {
    if (s.channel !== 'tmux' || (s.status !== 'waiting' && s.provider !== 'codex')) continue;   // Codex 没有状态登记，只能看屏幕
    const cap = await tmuxFor(s.tmux, ['capture-pane', '-p', '-t', s.tmux]);
    if (!cap.ok) continue;
    const dialog = parseDialog(cap.out);
    if (s.provider === 'codex' && !dialog) continue;
    names.add(s.tmux);
    waitScreens.set(s.tmux, { screen: screenLines(cap.out, 14), dialog });
  }
  for (const k of [...waitScreens.keys()]) if (!names.has(k)) waitScreens.delete(k);
}
// ───────────── 输入框上的「预判」：灰字建议 + 下一步 1/2/3 ─────────────
// Khalil 11/13 16:10：原生 Claude Code 的输入框里有灰字（Tab 收下），next-steps 插件在输入框上方给「1 / 2 / 3」，总控台卡片的输入框也要有。
// 两样都只画在终端屏幕上、不写进对话记录（拿真实记录 grep 过），所以只能读屏幕，由 suggest.mjs 解析。读屏只读，不碰会话的输入框，不调模型。
// 只看 tmux 里的 Claude 会话、状态是 idle 或 shell、已经交付过一轮的：忙着的没有预判；没交付过的新会话输入框里的 Try "…" 也是暗色字。
const SUGGEST_MS = Number(process.env.CCBOARD_SUGGEST_MS || 2500);
const SUGGEST_STATUS = new Set(['idle', 'shell']);    // shell = 放到后台的命令还在跑，终端里照样能回话、照样显示建议
const suggests = new Map();   // tmux 会话名 → { ghost, options: [{ n, label }] }
async function refreshSuggest() {
  const names = new Set();
  for (const s of sessions) {
    if (s.channel !== 'tmux' || s.provider !== 'claude' || !SUGGEST_STATUS.has(s.status) || s.ask || !s.resultAt) continue;
    const cap = await tmuxFor(s.tmux, ['capture-pane', '-p', '-e', '-t', s.tmux]);
    const g = cap.ok ? parseSuggest(cap.out) : null;
    if (g) { suggests.set(s.tmux, g); names.add(s.tmux); }
  }
  for (const k of [...suggests.keys()]) if (!names.has(k)) suggests.delete(k);
}
const withSuggest = (s) => (SUGGEST_STATUS.has(s.status) && s.tmux && suggests.has(s.tmux) ? { ...s, suggest: suggests.get(s.tmux) } : s);   // 刚转忙的那一两秒不再带

// ───────────── 自动续跑（11/16 khalil-97）─────────────
// Khalil 11/16 11:09：「它这个 Tab 的决策就挺好的，那你为什么还要让我去点这个 Tab？你不能让它直接自己实现继续跑吗？……
// 总管们应该持续帮我继续跟进，而不是让我主动去催你们」。
// 一个总控台 tmux 里的 Claude 窗口交付完（无需处理），输入框里有灰字建议：
//   1. 够不够格：autopilot.mjs 的 autoBlock（歇着、没停住、交付是无需处理、不是总管和值班、交付在 2 小时内、他没取消、没连着自动发满几轮）和 quotaHold（这个号的额度）
//   2. 灰字稳住 AUTO_SETTLE_MS：next-steps 插件出建议要一会儿，别拿半截的去问
//   3. 第一道闸 hardStop() 按字面拦（对外、花钱、提审、删除、终端命令、替他下结论或放行）；过了再问小模型（askAuto，一次只问一个，每次交付 + 每句建议只问一次）
//   4. go → 卡片上倒数 AUTO_DELAY_MS，他可以取消或马上发；到点再读一遍屏幕，灰字没变才经 sendTo 发出去。发的是固定的 autoMessage()（AUTO_MARK 开头），不是灰字
//      yours（不论哪道闸说的）→ 不发，这一次交付在墙上改成待跟进（applyAuto）；wait / 判不出来 → 不发，卡片上一行灰字写为什么
// 全局 AUTO_GAP_MS 内最多自动发一次：上线那一刻十几个窗口一起醒，额度和机器都扛不住。手点「现在发」不受它限。
// 只存内存；服务重启后清空，交付还在 2 小时内的会重新问一遍。试验场里不调真的 claude：没给 CCBOARD_AUTO_JUDGE 就当没打开。
// 开关不用重启（11/17 修法 c）：config.json 里 autoContinue 这一个键最多每 AUTO_CFG_MS 重读一次（autoConf），删掉这个键 10 秒内就停，在倒数的一起撤掉。
// 11/16 23:42 上线后夜里要关，只能删键 + 用脚本代点「不发了」，再重启一次服务。
const AUTO_CFG_MS = Number(process.env.CCBOARD_AUTO_CFG_MS) || 10000;
const AUTO_DELAY_MS = Number(process.env.CCBOARD_AUTO_DELAY_MS) || 30000;
const AUTO_SETTLE_MS = Number(process.env.CCBOARD_AUTO_SETTLE_MS) || 5000;
const AUTO_GAP_MS = Number(process.env.CCBOARD_AUTO_GAP_MS) || 60000;
const AUTO_FRESH_MS = Number(process.env.CCBOARD_AUTO_FRESH_MS) || 2 * 3600000;
let autoCfg = { at: Date.now(), v: CONFIG.auto };
const autoDesc = (a) => (a.on ? `on(周<${a.weekMax}% 5h<${a.fiveMax}% 连续≤${a.maxRun})` : 'off');
function autoConf() {            // 现在的 autoContinue。读不了、不是对象、这个键写错 → 关（保护性的判断落到停）；启动时整份 config 没用上 → 一直关
  if (Date.now() - autoCfg.at < AUTO_CFG_MS) return autoCfg.v;
  let v = parseAutoConfig(), why = '';
  if (CONFIG_OK) try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('不是一个 JSON 对象');
    v = parseAutoConfig(c.autoContinue);
    if (!v.on) why = 'autoContinue' in c ? 'autoContinue 写的是关' : 'config.json 里没有 autoContinue';
  } catch (e) { v = parseAutoConfig(); why = '读不了（' + e.message + '）'; }
  const was = autoCfg.v; autoCfg = { at: Date.now(), v };
  if (autoDesc(v) !== autoDesc(was) || v.skip !== was.skip) console.log(`config ${new Date().toISOString()} autoContinue ${autoDesc(was)} → ${autoDesc(v)}${why ? '（' + why + '）' : ''}`);
  return v;
}
const autoOn = () => autoConf().on && (!SANDBOX || !!process.env.CCBOARD_AUTO_JUDGE);
const autoSeen = new Map();       // sid → { at, ghost, since }：这一次交付的这句建议从什么时候起没变过
const autoJudged = new Map();     // sid → { at, ghost, v: 'pending' | { verdict, ask, why, hard? } | null（判不出来） }
const autoArmed = new Map();      // sid → { at, ghost, fireAt }：在倒数
const autoCanceled = new Map();   // sid → 他取消（或发不出去）的那次交付的 resultAt：这一次交付不再自动发
const autoRuns = new Map();       // sid → { n, at, said }：他没说话以来自动发了几轮、最后一次什么时候、发的那一刻最近一句话的时间（said）；冒出一句别的、不带记号的话 = 他自己说了，清掉
const autoHold = new Map();       // sid → { at, why }：不够格、值得写在卡片上的原因（额度、发满了几轮、他取消了）
let autoAsking = false, autoFiring = false, autoLastFire = 0, autoSkipSrc = null, autoSkipRe = null;
const autoSkip = () => { const k = autoConf().skip; if (autoSkipSrc !== k) { autoSkipSrc = k; autoSkipRe = autoSkipSrc ? new RegExp(autoSkipSrc, 'i') : null; } return autoSkipRe; };
const autoLog = (s, what) => console.log(`auto ${new Date().toISOString()} ${s.sid.slice(0, 8)} ${String(what).replace(/\s+/g, ' ')}`);
function readTap(sid) { if (!SID_RE.test(sid)) return null; try { return JSON.parse(fs.readFileSync(path.join(LIMITS_DIR, TAP_PREFIX + sid + '.json'), 'utf8')); } catch { return null; } }
function watchAuto() {
  const live = new Set(sessions.map((x) => x.sid));
  for (const m of [autoSeen, autoJudged, autoArmed, autoCanceled, autoRuns, autoHold]) for (const k of [...m.keys()]) if (!live.has(k)) m.delete(k);
  if (!autoOn()) { for (const sid of autoArmed.keys()) autoLog({ sid }, 'disarm 自动续跑关了'); autoArmed.clear(); autoHold.clear(); return; }
  const now = Date.now(), chief = chiefNow().sid, skip = autoSkip(), cf = autoConf();
  for (const s0 of sessions) {
    const s = withSuggest(s0), at = String(s.resultAt), run0 = autoRuns.get(s.sid);
    if (run0 && s.prompt && !isAutoPrompt(s.prompt) && String(s.promptAt) !== run0.said) autoRuns.delete(s.sid);   // 他自己说了一句（最近那句话换了、不是我们发的）：重新数。不比时钟：对话记录里的时间和服务的钟不一定对得上
    const ghost = (s.suggest && s.suggest.ghost) || '';
    const b = autoBlock(s, { now, fresh: AUTO_FRESH_MS, maxRun: cf.maxRun, runs: (autoRuns.get(s.sid) || {}).n || 0, canceled: autoCanceled.get(s.sid), skip, chief });
    const q = b ? null : quotaHold(readTap(s.sid), LIMITS.claude, now, cf);
    if (b || q) {
      if (autoArmed.delete(s.sid)) autoLog(s, 'disarm ' + (q || b.code));
      const why = q || b.why;
      if (why) autoHold.set(s.sid, { at, why }); else autoHold.delete(s.sid);
      continue;
    }
    autoHold.delete(s.sid);
    const seen = autoSeen.get(s.sid);
    if (!seen || seen.at !== at || seen.ghost !== ghost) { autoSeen.set(s.sid, { at, ghost, since: now }); autoArmed.delete(s.sid); continue; }
    if (now - seen.since < AUTO_SETTLE_MS) continue;
    const j = autoJudged.get(s.sid);
    if (!j || j.at !== at || j.ghost !== ghost) {
      const h = hardStop(ghost);
      if (h) {
        const verdict = h.kind === 'yours' ? 'yours' : 'wait';
        autoJudged.set(s.sid, { at, ghost, v: { verdict, ask: h.ask || null, why: h.why, hard: true } });
        autoLog(s, `${verdict} hard ${h.why}`);
      } else if (!autoAsking) askAuto(s, at, ghost);
      continue;
    }
    if (!j.v || j.v === 'pending' || j.v.verdict !== 'go') continue;
    const a = autoArmed.get(s.sid);
    if (!a || a.at !== at || a.ghost !== ghost) { autoArmed.set(s.sid, { at, ghost, fireAt: now + AUTO_DELAY_MS }); autoLog(s, `arm ${Math.round(AUTO_DELAY_MS / 1000)}s ${ghost.slice(0, 80)}`); continue; }
    if (now < a.fireAt || autoFiring || now - autoLastFire < AUTO_GAP_MS) continue;
    fireAuto(s, a, false);
  }
}
async function askAuto(s, at, ghost) {
  if (smallModelWaits()) return;
  const tr = tracks.get(s.sid);
  autoAsking = true; autoJudged.set(s.sid, { at, ghost, v: 'pending' });
  let v = null, err = '';
  try {
    const cmd = process.env.CCBOARD_AUTO_JUDGE || await findClaude();
    const L = smallModelLaunch(cmd, autoArgs());
    if (L.error) err = L.error;
    else {
      const r = await run(L.argv[0], L.argv.slice(1), { input: autoInput({ title: s.title, prompt: s.prompt, text: (tr && tr.st.result) || s.result, next: ghost }), timeout: 90000 });
      v = parseAuto(r.out);
      if (!v) { const f = failReason(r); err = f.kind === 'quota' ? '判官没额度：' + f.text : f.kind ? '命令失败：' + f.text : '答非所问'; }
    }
  } catch (e) { err = e.message; }
  const cur = autoJudged.get(s.sid);
  if (cur && cur.at === at && cur.ghost === ghost) autoJudged.set(s.sid, { at, ghost, v });   // 问的这段时间里交付或建议变了：答案作废，下一轮重新问
  autoAsking = false;
  autoLog(s, v ? `${v.verdict} ${v.ask || v.why}` : `fail ${err}`);
}
async function fireAuto(s, a, byHand) {
  autoFiring = true; autoLastFire = Date.now(); autoArmed.delete(s.sid);
  try {
    const cap = await tmux(['capture-pane', '-e', '-p', '-t', s.tmux]);          // 到点再读一遍屏幕：灰字还是那一句（他在终端里打了字，灰字就没了）
    const g = cap.ok ? parseSuggest(cap.out) : null;
    if (!g || g.ghost !== a.ghost) { autoLog(s, 'skip 屏幕上的建议变了'); return; }
    if (!autoOn()) { autoLog(s, 'skip 自动续跑关了'); return; }                  // 读屏幕的这一下里 config 被改成关了
    if (READONLY) { autoCanceled.set(s.sid, a.at); autoLog(s, 'dry ' + a.ghost.slice(0, 80)); return; }
    const p = autoRuns.get(s.sid); autoRuns.set(s.sid, { n: (p ? p.n : 0) + 1, at: Date.now(), said: String(s.promptAt) });   // 先记一轮再发：sendTo 要等送达确认（最多约 10 秒），这期间下一次交付来了也不会多发一轮
    const r = await sendTo(s.sid, autoMessage());                                // 固定的一句，不带灰字（11/17 修法 f）
    if (!r.ok) autoCanceled.set(s.sid, a.at);                                    // 发不出去（弹了选择框之类）：这一次交付不再试，卡片上照常给他
    autoLog(s, r.ok ? `fire${byHand ? ' 手点' : ''}${r.delivered ? '' : '（没核到送达）'} ${a.ghost.slice(0, 80)}` : 'fail ' + r.error);   // 日志里记的是依据（灰字）：发出去的那句是固定的
  } catch (e) { autoLog(s, 'fail ' + e.message); }
  finally { autoFiring = false; }
}
function applyAuto(o) {          // 第一道闸或小模型说这一步要他本人来：这一次交付在墙上改成待跟进，那件事放进「要你做的事」。自动续跑关着时不改
  if (!autoOn()) return;
  const j = autoJudged.get(o.sid);
  if (!j || !j.v || j.v === 'pending' || j.v.verdict !== 'yours' || j.at !== String(o.resultAt) || !o.digest || o.digest.need !== 'fyi') return;
  o.digest = { ...o.digest, need: 'reply', ask: j.v.ask, judged: true };
}
function withAuto(o) {           // 给界面：在倒数（armed：text 是真要发的那句，basis 是依据的灰字）、在问（judging）、不自动发的原因（held）
  if (!autoOn()) return o;
  const at = String(o.resultAt), a = autoArmed.get(o.sid);
  if (a && a.at === at) return { ...o, auto: { state: 'armed', text: autoMessage(), basis: a.ghost, fireIn: Math.max(0, a.fireAt - Date.now()) } };
  const ghost = o.suggest && o.suggest.ghost, j = autoJudged.get(o.sid);
  if (ghost && j && j.at === at && j.ghost === ghost && o.digest && o.digest.need !== 'reply') {
    if (j.v === 'pending') return { ...o, auto: { state: 'judging' } };
    if (!j.v) return { ...o, auto: { state: 'held', why: '没判断出来，先不自动发' } };
    if (j.v.verdict === 'wait') return { ...o, auto: { state: 'held', why: j.v.why || '先不接着做' } };
  }
  const h = autoHold.get(o.sid);
  if (h && h.at === at && ghost) return { ...o, auto: { state: 'held', why: h.why } };
  return o;
}

const launches = new Map();   // tmux 会话名 → {at, prompt, cwd}
let codexBin = null;
async function findCodex() {
  const r = await run('/bin/zsh', ['-lc', 'command -v codex']);
  const p = r.out.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')).pop();
  codexBin = p && fs.existsSync(p) ? p : null;
}
// 账号表和「当前登录的是谁」放在内存里，每 30 秒刷新一次：providers() 每次轮询都要调，不能每次都读钥匙串和 170 KB 的 ~/.claude.json
let acctList = [], loginNow = null, acctLoaded = false;   // acctLoaded：号表读完过一次（判官换号要等它，见 smallModelWaits）
async function refreshAccounts() { acctList = await accountState(CONFIG.accounts, run); loginNow = acctList.length ? loginLabel(HOME) : null; acctLoaded = true; }
function providers() {
  let cm = null, ce = null, xm = null, xe = null;
  try { const j = JSON.parse(fs.readFileSync(path.join(HOME, '.claude/settings.json'), 'utf8')); cm = j.model || null; ce = j.effortLevel || null; } catch {}
  try { const t = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8');
    xm = (t.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || null; xe = (t.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || null; } catch {}
  const gem = geminiOn() ? GEMINI_MODELS : [];   // Gemini 模型放在 Claude Code 的模型列表里；geminiModels 告诉界面哪几个是 Gemini（分一组、不接强度、不接账号）
  return {
    claude: { label: 'Claude Code', ok: true, models: ['fable', 'opus', 'sonnet', 'haiku', ...gem], ...(gem.length ? { geminiModels: gem } : {}), efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultModel: cm, defaultEffort: ce,
      accounts: acctList, login: acctList.length ? loginNow : null, defaultAccount: CONFIG.defaultAccount || null },
    ...(CONFIG.codex ? { codex: { label: 'Codex', ok: !!codexBin, models: xm ? [xm] : [], efforts: ['low', 'medium', 'high', 'xhigh'], defaultModel: xm, defaultEffort: xe } } : {}),
  };
}
// ───────────── 在某一列列头开的新任务：记住它属于哪一列 ─────────────
// Khalil 11/13：「在每一个主题下面再放一个新任务」。tmux 名 → {key, name, at}。存文件是因为 ./build.sh update 会重启服务，
// 刚开的会话还没动过文件，提示一丢就跳回「其他」。tmux 里没了这个会话就删掉（开出来 1 分钟以内的先留着，它可能还没出现在列表里）。
const PINS_FILE = path.join(DATA, 'pins.json');
let pins = {}; try { pins = JSON.parse(fs.readFileSync(PINS_FILE, 'utf8')) || {}; } catch {}
function savePins() { if (READONLY) return; const tmp = PINS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(pins, null, 1)); fs.renameSync(tmp, PINS_FILE); }
const pinOf = (name) => (name && pins[name] ? { key: pins[name].key, name: pins[name].name } : null);
// 11/18 线上 5 条活窗口的记录被删：连续三拍完整枚举都没看见，且跨过 PRUNE_MS 才裁剪；出现即清零。
// sure=false 的拍不调用这里，不计数、不清零。计数只在内存，重启只会晚删。
const pinMissing = new Map(), spawnMissing = new Map();
function missingRecord(missing, key, present, now) {
  if (present) { missing.delete(key); return null; }
  const m = missing.get(key) || { first: now, n: 0 }; m.n++; missing.set(key, m);
  return m.n >= 3 && now - m.first >= PRUNE_MS ? m : null;
}
function prunePins() {
  let dirty = false; const now = Date.now();
  for (const [k, v] of Object.entries(pins)) {
    const m = missingRecord(pinMissing, k, panes.some((p) => p.name === k), now);
    if (!m || now - ((v && v.at) || 0) <= 60000) continue;
    delete pins[k]; pinMissing.delete(k); dirty = true;
    console.log(`pin-drop ${new Date(now).toISOString()} ${k} ${v && v.key || '-'} 不在 tmux 里 ${m.n} 拍 / ${Math.floor((now - m.first) / 1000)} 秒`);
  }
  if (dirty) savePins();
}
// ───────────── 架构视图：谁归谁管 ─────────────
// Khalil 11/15 22:3x：「我这个 Khalil Assistant 它会往下面去分配其他的窗口……做一个可视化的窗口上下级关系，模拟公司」。
// 规则全在 org.mjs 的 buildOrg()；这里只备料：谁开的这个窗口（spawn.json）、发信人是哪个活会话、哪个会话是点名的总管。

// 谁开的这个窗口：/api/new 当场记下。tmux 名 → { by: 开它的那个会话的 sid, at }。存文件是因为 ./build.sh update 会重启服务；
// 生命周期照 pins.json：开出来超过 1 分钟、连续三拍完整枚举不在、且跨过 PRUNE_MS 才删。
const SPAWN_FILE = path.join(DATA, 'spawn.json');
let spawns = {}; try { const j = JSON.parse(fs.readFileSync(SPAWN_FILE, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) spawns = j; } catch {}
function saveSpawns() { if (READONLY) return; const tmp = SPAWN_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(spawns, null, 1)); fs.renameSync(tmp, SPAWN_FILE); }
// 与 pins 共用跨拍判定，各自保留计数。11/18 线上 5 条活窗口的记录被删，删除必须留下原因。
function pruneSpawns() {
  let dirty = false; const now = Date.now();
  for (const [k, v] of Object.entries(spawns)) {
    const m = missingRecord(spawnMissing, k, panes.some((p) => p.name === k), now);
    if (!m || now - ((v && v.at) || 0) <= 60000) continue;
    delete spawns[k]; spawnMissing.delete(k); dirty = true;
    console.log(`spawn-drop ${new Date(now).toISOString()} ${k} ${String(v && v.by || '-').slice(0, 8)} 不在 tmux 里 ${m.n} 拍 / ${Math.floor((now - m.first) / 1000)} 秒`);
  }
  if (dirty) { try { saveSpawns(); } catch {} }
}
// 11/18 线上 5 条活窗口的记录被删：启动只按最后 4 MiB 的 spawn 原日志补一次。
// 等第一拍完整窗格与会话清单，窗口时代和唯一 sid8 同时对上才恢复；旧格式供外部工具读取，保持不变。
let spawnsRestored = false;
function restoreSpawns() {
  if (spawnsRestored || !sessionsScanned) return;
  spawnsRestored = true;
  let fd, text;
  try {
    fd = fs.openSync(path.join(DATA, 'server.log'), 'r'); const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 4 * 1024 * 1024), buf = Buffer.alloc(size - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start); text = buf.subarray(0, n).toString('utf8');
    if (start) text = text.slice(text.indexOf('\n') + 1);
  } catch { return; } finally { if (fd !== undefined) fs.closeSync(fd); }
  const latest = new Map();
  for (const line of text.split('\n')) {
    const m = /^spawn (\S+Z) (ccb-[\w-]+) ([\w-]{8}) (?:from|lsof)$/.exec(line);
    if (m) { const at = Date.parse(m[1]); if (Number.isFinite(at)) latest.set(m[2], { at, prefix: m[3] }); }
  }
  let dirty = false;
  for (const p of panes) {
    if (Object.hasOwn(spawns, p.name)) continue;
    const row = latest.get(p.name); if (!row || Math.abs(p.created - row.at) > 120000) continue;
    const hits = allSessions.filter((x) => String(x.sid).slice(0, 8) === row.prefix);
    if (hits.length !== 1) continue;
    spawns[p.name] = { by: hits[0].sid, at: row.at }; dirty = true;
    console.log(`spawn-restore ${new Date().toISOString()} ${p.name} ${row.prefix} server.log`);
  }
  if (dirty) { try { saveSpawns(); } catch {} }
}
const spawnedBy = (tm) => { const v = tm && Object.hasOwn(spawns, tm) ? spawns[tm] : null; return v && typeof v.by === 'string' && v.by ? v.by : null; };

// 调用 /api/new 的是哪个会话：按它连过来的端口找出连着这个端口的进程（去掉服务自己），沿父进程往上走最多 15 层，
// 第一个出现在会话登记（~/.claude/sessions/<pid>.json）里的就是。curl → Bash 工具的 shell → claude 本身，一般两三层就到。
// 整个过程限时 1.5 秒；认不出、超时、命令失败都当成「不知道」，绝不让 /api/new 失败或变慢。
function regSid(pid) {
  try { const d = JSON.parse(fs.readFileSync(path.join(SESS_DIR, pid + '.json'), 'utf8')); return d && d.pid === pid && typeof d.sessionId === 'string' && d.sessionId ? d.sessionId : null; } catch { return null; }
}
async function callerOf(port) {
  if (!Number.isInteger(port) || port <= 0) return null;
  const r = await run(LSOF, ['-nP', '-a', '-iTCP:' + port, '-sTCP:ESTABLISHED', '-Fp'], { timeout: CALLER_MS });
  const pids = [...new Set(String(r.out || '').split('\n').map((l) => /^p(\d+)$/.exec(l.trim())).filter(Boolean).map((m) => Number(m[1])))].filter((p) => p !== process.pid);
  for (const p0 of pids.slice(0, 4)) {
    let p = p0;
    for (let i = 0; i < 15 && p > 1; i++) {
      const sid = regSid(p); if (sid) return sid;
      const q = await run(PS, ['-o', 'ppid=', '-p', String(p)], { timeout: CALLER_MS });   // 不用 ppidOf 的缓存：进程号会被重用
      const pp = q.ok ? Number(q.out.trim()) : 0;
      if (!Number.isInteger(pp) || pp <= 1 || pp === p) break;
      p = pp;
    }
  }
  return null;
}
const findCaller = (port) => Promise.race([callerOf(port).catch(() => null), sleep(CALLER_MS).then(() => null)]);

// ───────────── 总管保温（11/20 khalil-99）─────────────
// Khalil 11/20 23:01：「你直接把保温和压缩后装回章程的 SessionStart 钩子做出来」。账和理由在 autopilot.mjs 的 KW_MARK 一节。
// 每一拍（suggestLoop，约 2.5 秒）看点名的会话（org.chief 的总管 + keepWarm.sids）：keepWarmDue 说该打了，再读一次屏幕确认输入框是空的，
// 经 sendTo 打 KW_TEXT。一次只打一个；同一个会话打过以后 KW_GAP_MS 内不再打（万一记录里一直没认出那一句，也不会每拍都打）。
// 开关不用重启：config.json 的 keepWarm 这一个键最多每 KW_CFG_MS 重读一次；写错或读不了 → 关，日志写一行。启动时不读它，写错不连累整份 config。
// 发之前（11/21 1b 审查 M1、M4）：同一次 tmux 查询核他是不是正对着这个窗口（kwPaneGate：只有一个窗格、不在 copy-mode、没有客户端 KW_QUIET_S 秒内按过键），
// 再重新扫一次会话登记、用最新的状态把 keepWarmDue 过一遍（读屏这一会儿它可能被叫醒了）。粘贴到 Enter 那 0.5 秒是 sendTo 本来就有的（/api/send 也一样），不在这里管。
// 真打字只在线上服务（M3）：只读预览可能指着线上数据目录和真窗口；试验服务（换了端口、数据目录或主目录）主目录没换、又没给私有套接字时看得到所有真窗口，
// 会和线上服务同时往真总管里打（11/16 两次总控台全体崩溃就是测试碰了线上 tmux）。试验场要真打：CCBOARD_KW_SANDBOX=1，并且 CCBOARD_TMUX_SOCKET 指着 ~/.cc-board 以外的私有套接字。
// 日志：kw <时间> <会话号前 8 位> fire n=<第几次> ctx=<上下文> delivered|sent-unconfirmed|fail …；只读服务、试验服务记 dry n=… <哪道闸> 不打；不打的原因变了才记一行 skip <原因>。
const KW_CFG_MS = Number(process.env.CCBOARD_KW_CFG_MS) || 10000;
const KW_GAP_MS = Number(process.env.CCBOARD_KW_GAP_MS) || 10 * 60000;
let kwCfg = { at: 0, v: parseKeepWarm(), desc: 'off' }, kwFiring = false;   // 起点当作 off：没开保温的机器启动时不多记一行（「写坏的 config 只有一行说明」）
const kwSent = new Map(), kwWhy = new Map();   // sid → 上次打的时刻（服务的钟）；sid → 上次记的不打原因
const kwLog = (sid, what) => console.log(`kw ${new Date().toISOString()} ${sid.slice(0, 8)} ${what}`);
const KW_RO = READONLY ? '只读' : '';
const KW_SB = SANDBOX && !(process.env.CCBOARD_KW_SANDBOX === '1' && process.env.CCBOARD_TMUX_SOCKET && !TMUX_SOCKET.startsWith(path.join(REAL_HOME, '.cc-board') + path.sep)) ? '试验服务' : '';
function kwConf() {
  if (Date.now() - kwCfg.at < KW_CFG_MS) return kwCfg.v;
  let v = parseKeepWarm(), why = '';
  if (CONFIG_OK) try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    v = parseKeepWarm(c && typeof c === 'object' && !Array.isArray(c) ? c.keepWarm : undefined);
  } catch (e) { v = parseKeepWarm(); why = '（读不了或写错：' + e.message + '）'; }
  const desc = v.on ? `on(空闲 ${v.idleMin}–${v.idleMax} 分、上下文≥${v.minCtx}、连续≤${v.maxRun}${v.chief ? '、总管' : ''}${v.sids.length ? '、另 ' + v.sids.length + ' 个' : ''})` : 'off';
  if (desc + why !== kwCfg.desc) console.log(`config ${new Date().toISOString()} keepWarm → ${desc}${why}`);
  kwCfg = { at: Date.now(), v, desc: desc + why }; return v;
}
async function watchKeepWarm() {
  const cf = kwConf();
  if (!cf.on || kwFiring) return;
  const chief = chiefNow().sid, live = new Set(sessions.map((x) => x.sid));
  for (const m of [kwSent, kwWhy]) for (const k of [...m.keys()]) if (!live.has(k)) m.delete(k);
  const skip = (sid, why) => { if (kwWhy.get(sid) !== why) { kwWhy.set(sid, why); kwLog(sid, 'skip ' + why); } };
  for (const s of sessions) {
    if (!((cf.chief && chief && s.sid === chief) || cf.sids.includes(s.sid))) continue;
    const tr = tracks.get(s.sid); if (!tr) continue;
    const pre = keepWarmDue(s, tr.st, cf, { now: Date.now(), chief, box: true });   // 别的条件都过了才去读屏幕
    if (pre !== null) { skip(s.sid, pre); continue; }
    if (Date.now() - (kwSent.get(s.sid) || 0) < KW_GAP_MS) { skip(s.sid, 'gap'); continue; }
    const cap = await tmuxFor(s.tmux, ['capture-pane', '-e', '-p', '-t', s.tmux]);   // -e 带颜色：promptEmpty 靠暗色认灰字
    const box = cap.ok ? promptEmpty(cap.out) : null;
    const why = keepWarmDue(s, tr.st, cf, { now: Date.now(), chief, box });
    if (why !== null) { skip(s.sid, why); continue; }
    const pg = await tmuxFor(s.tmux, ['list-panes', '-s', '-t', s.tmux, '-F', 'P #{pane_in_mode}', ';', 'list-clients', '-t', s.tmux, '-F', 'C #{client_activity}']);
    const near = pg.ok ? kwPaneGate(pg.out, Date.now() / 1000) : 'tmux-unknown';
    if (near !== null) { skip(s.sid, near); continue; }
    scanSessions();                                // 读屏、查 tmux 这一会儿它可能被叫醒了：用最新的登记再过一遍
    const s2 = sessions.find((x) => x.sid === s.sid), again = s2 ? keepWarmDue(s2, tr.st, cf, { now: Date.now(), chief, box }) : 'gone';
    if (again !== null) { skip(s.sid, again); continue; }
    const n = (tr.st.kwN || 0) + 1;
    kwSent.set(s.sid, Date.now()); kwWhy.delete(s.sid);
    if (KW_RO || KW_SB) { kwLog(s.sid, `dry n=${n} ctx=${s.ctx} ${KW_RO || KW_SB}`); return; }   // 只读预览、试验服务只记不打（见上面 M3）
    kwFiring = true;
    try {
      const r = await sendTo(s.sid, KW_TEXT);
      kwLog(s.sid, `fire n=${n} ctx=${s.ctx} ${r.ok ? (r.delivered ? 'delivered' : 'sent-unconfirmed') : 'fail ' + String(r.error || '').replace(/\s+/g, ' ')}`);
    } finally { kwFiring = false; }
    return;                                        // 一拍只打一个
  }
}

// config 里 org.chief 指向的文件（比如总管窗口自己维护的 state.json）：读 session_id 和 generation，最多每 10 秒读一次。
// 文件不在、不是 JSON、没有 session_id 都当成「没点名」，org.mjs 就按名字里的总管字样认。不往这个文件里写任何东西。
let chiefMemo = { at: 0, sid: null, gen: null };
function chiefNow() {
  const f = CONFIG.org.chief; if (!f) return { sid: null, gen: null };
  if (Date.now() - chiefMemo.at < CHIEF_MS) return chiefMemo;
  let sid = null, gen = null;
  try { const j = JSON.parse(fs.readFileSync(f.replace(/^~(?=\/)/, HOME), 'utf8')); if (j && typeof j.session_id === 'string' && j.session_id) { sid = j.session_id; gen = Number.isFinite(j.generation) ? j.generation : null; } } catch {}
  chiefMemo = { at: Date.now(), sid, gen }; return chiefMemo;
}

// config 里 org.seats 指的文件（11/17 khalil-49）：每个项目一份，点名这个项目的现任负责人，最多每 10 秒读一次，不往里写。
//   例：一份纯文本，第一行是「窗口名 [短号]」，会话号（UUID）在下面随便哪一行。
//   认法：JSON 带 session_id 的用它；文本取第一行开头的窗口名（到空格 / [ / （ 为止）和文件里所有的会话号（前 64 KB）。
// seatSids() 把它认成墙上的会话：会话号在文件里、名字也对得上的那一个（名字可以是登记名，或登记名末尾括号里的短名）；
//   文件里没写会话号 → 名字对得上的正好一个；没写名字 → 文件里第一个在墙上的会话号；两样都写了却对不上同一个会话 → 认不出。
//   文件不在、读坏、认不出、点名的不在墙上，都当这个项目没点名：org.mjs 照旧按字样认，整份 config 照常用。认的结果变了记一行日志。
let seatMemo = { at: 0, map: {} }, seatLog = '';
// 会话号的样子：8-4-4-4-12。真会话号是十六进制的 UUID；不限十六进制，是因为测试夹具的会话号带字母（unfin000-0000-…），限了会认不出、两样对不上时也退不回去（11/17 state.test 抓到的）
const UUID_RE = /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/gi;
// 历任名单保存会话与进程时代。11/18 17:4x 线上，换班后归档前任，gone 短名丢失岗位证据。
// 文件缺失或结构损坏当空表；每项目 40 任，每任 8 个 pid，last 仅在内存更新。
const SEAT_HISTORY_FILE = path.join(DATA, 'seat-history.json');
function loadSeatHistory() {
  try {
    const j = JSON.parse(fs.readFileSync(SEAT_HISTORY_FILE, 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    for (const rows of Object.values(j)) {
      if (!Array.isArray(rows)) return {};
      for (const r of rows) if (!r || typeof r.sid !== 'string' || !r.sid || typeof r.name !== 'string' || !Array.isArray(r.procs) ||
        !r.procs.every((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && p[0] > 0 && Number.isFinite(p[1]) && p[1] >= 0) ||
        !Number.isFinite(r.first) || !Number.isFinite(r.last)) return {};
    }
    return Object.fromEntries(Object.entries(j).map(([k, rows]) => [k, rows.sort((a, b) => a.first - b.first).slice(-40).map((r) => ({ ...r, procs: r.procs.slice(-8) }))]));
  } catch { return {}; }
}
const seatHistory = loadSeatHistory();
function saveSeatHistory() { if (READONLY) return; const tmp = SEAT_HISTORY_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(seatHistory, null, 1)); fs.renameSync(tmp, SEAT_HISTORY_FILE); }
function rememberSeat(dept, hit) {
  const now = Date.now(), rows = Object.hasOwn(seatHistory, dept) ? seatHistory[dept] : (seatHistory[dept] = []);
  let row = rows.find((r) => r.sid === hit.sid), dirty = false;
  if (!row) { row = { sid: hit.sid, name: hit.regName || '', procs: [], first: now, last: now }; rows.push(row); dirty = true; }
  const started = Number(hit.startedAt);
  if (Number.isInteger(hit.pid) && hit.pid > 0 && Number.isFinite(started) && started >= 0 && !row.procs.some(([pid, at]) => pid === hit.pid && at === started)) { row.procs.push([hit.pid, started]); row.procs = row.procs.slice(-8); dirty = true; }
  row.name = hit.regName || ''; row.last = now;
  if (rows.length > 40) seatHistory[dept] = rows.sort((a, b) => a.first - b.first).slice(-40);
  return dirty;
}
// 只按 sid / pid 和消息时代映射历任。名字可重复，不作为岗位证据。
function pastSeats(live, ghosts) {
  const liveIds = new Set(live.map((x) => x.sid)), past = {};
  for (const [dept, rows] of Object.entries(seatHistory)) {
    const ids = new Set();
    for (const row of rows) {
      if (liveIds.has(row.sid)) ids.add(row.sid);
      for (const [pid, started] of row.procs) {
        const g = ghosts.get(pid); if (!g) continue;
        const last = Math.max(0, ...[...g.depts.values()].map((d) => d.last));
        if (last >= started) ids.add(GONE + pid);
      }
    }
    past[dept] = [...ids];
  }
  return past;
}
function seatsNow() {
  const conf = CONFIG.org.seats || {}, keys = Object.keys(conf); if (!keys.length) return {};
  if (Date.now() - seatMemo.at < CHIEF_MS) return seatMemo.map;
  const map = {};
  for (const k of keys) {
    let txt; try { txt = fs.readFileSync(conf[k].replace(/^~(?=\/)/, HOME), 'utf8').slice(0, 65536); } catch (e) { map[k] = { err: '读不了文件（' + (e.code || e.message) + '）' }; continue; }
    let ids = null, name = '';
    try { const j = JSON.parse(txt); if (j && typeof j === 'object') { if (typeof j.session_id === 'string' && j.session_id) ids = [j.session_id.toLowerCase()]; if (typeof j.window === 'string') name = j.window; } } catch {}
    if (!ids) ids = [...new Set((txt.match(UUID_RE) || []).map((x) => x.toLowerCase()))];
    name = (String(name || txt.split('\n')[0] || '').trim().match(/^[^\s\[（(]+/) || [''])[0].slice(0, 80);
    map[k] = { ids, name };
  }
  seatMemo = { at: Date.now(), map }; return map;
}
function seatSids(live) {
  const out = {}, notes = []; let historyDirty = false;
  const nameIs = (x, n) => { const r = String(x.regName || ''); return !!n && (r === n || r.endsWith('（' + n + '）') || r.endsWith('(' + n + ')')); };
  for (const [k, p] of Object.entries(seatsNow())) {
    let hit = null, why = p.err || '';
    if (!why) {
      const byId = p.ids.map((id) => live.find((x) => String(x.sid).toLowerCase() === id)).filter(Boolean);
      if (p.ids.length && p.name) hit = byId.find((x) => nameIs(x, p.name)) || null;
      else if (p.name) { const c = live.filter((x) => nameIs(x, p.name)); hit = c.length === 1 ? c[0] : null; }
      else hit = byId[0] || null;
      if (!hit) why = p.ids.length || p.name ? '点名的窗口不在墙上，或名字和会话号对不上（' + (p.name || '没写名字') + ' / ' + (p.ids[0] ? p.ids[0].slice(0, 8) : '没写会话号') + '）' : '文件里没有窗口名和会话号';
    }
    if (hit) { out[k] = hit.sid; if (rememberSeat(k, hit)) historyDirty = true; }
    notes.push(k + ' → ' + (hit ? (hit.regName || '?') + '（' + String(hit.sid).slice(0, 8) + '）' : '认不出：' + why));
  }
  if (historyDirty) { try { saveSeatHistory(); } catch (e) { console.error('seat-history', e); } }
  const line = notes.join('；');
  if (line !== seatLog) { seatLog = line; if (line) console.log(`org ${new Date().toISOString()} 点名负责人 ${line}`); }
  return out;
}

// 发信人 → 活会话的 sid。先按进程号：活着、pid 相同、而且在那条消息之前就开了（防进程号被别的进程重用）；窗口会改名，所以不拿名字核 pid
// （khalil-a5 发消息时叫 khalil-a5，后来改名成「总指挥 · Fable（khalil-a5）」）。
// pid 认不出、也不是名单上的历任进程，再按名字：活会话里 regName 包含这个名字、或这个名字包含 regName 的正好一个才算（真实数据里有两个窗口都叫 khalil-0b，重名的不认）。
// 历任名单里的进程（11/19 评审必改 2）：活会话按 pid 认不出、这个 pid 在某一任的进程时代里（消息不早于它启动），只认名单上那个会话：
//   它在墙上就归它，不在就返回 null，交给 orgView 做成 gone 项给 pastSeats 认，不走名字兜底。不然前任归档后墙上另有一个重名窗口（短名只有 256 种），
//   前任的消息按名字算到那个窗口头上，gone 项不产生，队伍不跟岗位。同一个 pid 在名单里出现几次（进程号复用），取启动时间最晚、又不晚于消息的那一任。
function seatProcSid(pid, at) {
  let best = null, bt = -1;
  for (const rows of Object.values(seatHistory)) for (const r of rows) for (const [q, started] of r.procs) if (q === pid && started <= at && started > bt) { best = r.sid; bt = started; }
  return best;
}
function peerSid(p, at, live) {
  if (p.pid) { const hit = live.find((x) => x.pid === p.pid && Number(x.startedAt) <= at); if (hit) return hit.sid; }
  const hs = p.pid ? seatProcSid(p.pid, at) : null;
  if (hs) return live.some((x) => x.sid === hs) ? hs : null;
  if (p.name) { const c = live.filter((x) => x.regName && (x.regName.includes(p.name) || p.name.includes(x.regName))); if (c.length === 1) return c[0].sid; }
  return null;
}
// /api/state 的 org：{ chief, gen, nodes: { sid: { role, boss, via, n, last, from: [[sid, n, last]…], for } } }
// role / boss / via / n / last 原样来自 buildOrg；from = 认出了是谁的发信人（新的在前，最多 8 个，界面靠 last 变大画「消息飞过去」）；
// for = 这一轮是谁开的：他本人 'you'、别的窗口是它的 sid（认不出 null）、不知道 null。gen 只在总管真是文件点名的那个时给。
// 这里不缓存：会话不到几十个，每次出状态时算一遍（毫秒级），和 org.mjs 文件头写的一样。
// 已经不在的发信人（认不出是哪个活会话、但记录里有它的进程号）：做成一个 gone 项交给 buildOrg，sid 是 'gone:<pid>'（不会和真会话号撞）。
// 它名字里带负责人 / 总管字样时，org.mjs 把它算成那个岗位的前任，听它的窗口跟着岗位归现任（11/15：a5 归档后 9d、3b 掉队）。
// 同一个进程号改过名的几条合成一个；name = 它用过的名字（最近的在前，去重，最多 3 个，空格连起来）；
// dept = 收到它消息条数最多的那个项目（一样多取最近一条更晚的）。没有进程号的认不出的发信人照旧给 sid: null。
const GONE = 'gone:';
function ghostItems(ghosts) {
  const out = [];
  for (const [pid, g] of ghosts) {
    const names = [...g.names].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
    let dept = '', top = null;
    for (const [d, v] of g.depts) if (!top || v.n > top.n || (v.n === top.n && v.last > top.last)) { top = v; dept = d; }
    out.push({ sid: GONE + pid, name: names.join(' '), title: '', dept, startedAt: 0, human: null, from: [], by: null, gone: true });
  }
  return out;
}
function orgView() {
  const now = Date.now(), live = allSessions, list = [], extra = new Map();
  const ghosts = new Map();                         // pid → { names: Map(名字 → 最近一条), depts: Map(项目 → { n, last }) }
  for (const s of sessions) {
    const tr = s.provider === 'codex' ? null : tracks.get(s.sid), st = tr ? tr.st : null;    // Codex 的对话记录不取证据，字段缺着
    const dept = s.project ? s.project.key : '';
    const from = [], known = new Map(), gone = new Map();
    const add = (m, sid, p) => { const f = m.get(sid); if (f) { f.n += p.n; f.last = Math.max(f.last, p.last); } else { const g = { sid, n: p.n, last: p.last }; m.set(sid, g); from.push(g); } };
    if (st && st.peers) for (const p of st.peers.values()) {
      const sid = peerSid(p, p.first, live);        // 用这个发信人最早一条的时间核：它得在那之前就开了
      if (sid) { add(known, sid, p); continue; }
      if (!p.pid) { from.push({ sid: null, n: p.n, last: p.last }); continue; }     // 认不出、也没有进程号：照样给，它算分母
      add(gone, GONE + p.pid, p);                   // 认不出、有进程号：已经不在的窗口
      const g = ghosts.get(p.pid) || { names: new Map(), depts: new Map() }; ghosts.set(p.pid, g);
      if (p.name && !(g.names.get(p.name) >= p.last)) g.names.set(p.name, p.last);
      const d = g.depts.get(dept) || { n: 0, last: 0 }; d.n += p.n; d.last = Math.max(d.last, p.last); g.depts.set(dept, d);
    }
    list.push({ sid: s.sid, name: s.regName, title: s.title, dept, startedAt: s.startedAt, human: st ? st.human : null, from, by: spawnedBy(s.tmux) });
    const turn = !st ? null : st.turnBy === 'human' ? 'you' : st.turnBy === 'peer' && st.turnPeer ? peerSid(st.turnPeer, st.turnPeer.at, live) : null;
    extra.set(s.sid, { from: [...known.values()].sort((a, b) => b.last - a.last).slice(0, 8).map((f) => [f.sid, f.n, f.last]), turn });   // 给界面的只有活会话
  }
  for (const g of ghostItems(ghosts)) list.push(g);
  const ch = chiefNow(), seats = seatSids(sessions), past = pastSeats(sessions, ghosts);
  const o = buildOrg(list, { now, chief: ch.sid, seats, past, chiefWords: CONFIG.org.chiefWords, leadWords: CONFIG.org.leadWords, headWords: CONFIG.org.headWords });
  const nodes = {};
  for (const [sid, n] of Object.entries(o.nodes)) {
    if (sid.startsWith(GONE)) continue;             // org.mjs 本来就不出 gone 项；这里再挡一道，界面拿到的键都是活会话
    const x = extra.get(sid) || { from: [], turn: null }; nodes[sid] = { role: n.role, boss: n.boss, via: n.via, n: n.n, last: n.last, handed: !!n.handed, from: x.from, for: x.turn };
  }
  return { chief: o.chief, gen: ch.sid && o.chief === ch.sid ? ch.gen : null, nodes };
}
let orgErrAt = 0;
function orgSafe() {           // 架构视图出错不能把整个 /api/state 拖垮：出错给空的，日志一分钟最多一行
  try { return orgView(); } catch (e) { if (Date.now() - orgErrAt > 60000) { orgErrAt = Date.now(); console.error('org', e); } return { chief: null, gen: null, nodes: {} }; }
}

function pinNote(p) {          // 换掉 FOLDER_NOTE：项目他已经指了，不用它再猜
  const where = p.key.startsWith('dir:') ? '项目文件夹是 ~/Projects 下以「' + p.name + '」开头的那个' : '先查记忆和 ~/Projects 下的文件夹，找到这个项目的文件夹';
  return '\n\n<system-reminder>这条任务是在总控台「' + p.name + '」那一列里新建的，属于「' + p.name + '」这个项目。工作目录是主目录。' + where + '，在那里做，不要问放在哪。不要把工程文件直接放在主目录。</system-reminder>';
}

// ───────────── 开工前的「信任这个文件夹」：替他点 ─────────────
// Khalil 11/13：「新建的时候还要点一下那个 Trust……我感觉这个多余，直接帮我点了呀」。
// 主目录的信任 Claude Code 不存（~/.claude.json 里主目录一直是 false），所以每开一个都问，默认光标还停在「No, exit」。
// 11/15 Khalil：「为什么让 Agent 去新建一个窗口的时候，它还是要让我去按 Trust this folder……你可以自动的 Trust」。
// Agent 开窗口走 /api/new，几乎都带一个项目或沙盒文件夹的 cwd；11/13 那版只在主目录点，这些一个都没点到。
// 调这个接口的是他自己的 Agent，它本来就能在他的机器上跑任意命令，信任框拦不住它；所以不再看文件夹，config 打开就点。
// 只替总控台自己刚开的会话点，只认「Yes, I trust this folder」这一项；屏幕上是别的选择框就停手，照旧交给他在卡片上选。
const TRUST_OPT = /^yes,? i trust this folder$/i;
const TRUST_WAIT = Number(process.env.CCBOARD_TRUST_MS || 60000);    // 机器忙时 Claude Code 起得慢，多等一会儿
// 首次启动向导（11/15 23:19 Khalil：「每次总管他们新开窗口都会出现这种情况……我不想自己手动进去点」）。
// Claude Code 每次 /logout、/login 都把 ~/.claude.json 的 hasCompletedOnboarding 清成 false；到有人把向导走完之前，
// 新起的每个 claude（新任务、恢复归档）都先走一遍：Welcome + 选主题 → [选登录方式] → Security notes → [终端设置] → 信任框。
// 11/15 22:10–22:26 一共 5 个恢复出来的窗口卡在「选主题」上。只认下面三屏，每屏要屏幕上写死的几句话同时出现；
// 「选登录方式」「贴授权码」「API key」一概不碰（11/15 拿临时配置目录实测：在「选登录方式」回车会真的开始一次 OAuth 登录）。
// 选主题回车 = 接受光标所在那项（已有主题时光标就在它上面）；终端设置回车 = 改他的终端配置，所以按 Esc 跳过。
const ONBOARD = [
  { id: 'theme',          key: 'Enter',  all: [/Let's get started\./, /Choose the text style that looks best with your terminal/] },
  { id: 'security',       key: 'Enter',  all: [/Security notes:/, /Claude can make mistakes/] },
  { id: 'terminal-setup', key: 'Escape', all: [/Use Claude Code's terminal setup\?/, /No, maybe later/] },
];
async function autoTrust(name) {
  const end = Date.now() + TRUST_WAIT;
  const pressed = new Map();                   // 向导每一屏：按过几次、最近一次的时间。同一屏最多按 3 次，按完等 1.5 秒看它换屏
  while (Date.now() < end) {
    await sleep(400);
    const cap = await tmuxFor(name, ['capture-pane', '-p', '-t', name]);
    if (!cap.ok) return { ok: false, why: 'gone' };
    if (/bypass permissions on|\? for shortcuts/i.test(cap.out)) return { ok: true, why: 'no-dialog' };   // 已经到输入框了：这次没问
    const ob = ONBOARD.find((s) => s.all.every((re) => re.test(cap.out)));
    if (ob) {
      const p = pressed.get(ob.id) || { n: 0, at: 0 };
      if (p.n >= 3) return { ok: false, why: 'onboarding-stuck' };
      if (Date.now() - p.at < 1500) continue;
      const r = await tmuxFor(name, ['send-keys', '-t', name, ob.key]);
      pressed.set(ob.id, { n: p.n + 1, at: Date.now() });
      console.log(`onboard ${new Date().toISOString()} ${name} ${ob.id} ${ob.key} ${r.ok ? 'ok' : 'fail ' + r.err}`);
      continue;
    }
    const d = parseDialog(cap.out);
    if (!d) continue;
    const i = d.options.findIndex((o) => TRUST_OPT.test(o));
    if (i < 0) return { ok: false, why: 'other-dialog' };
    const r = await answerDialog(name, i, d.options[i]);
    console.log(`trust ${new Date().toISOString()} ${name} ${r.ok ? 'yes' : 'fail ' + r.error}`);
    return { ...r, why: 'answered' };
  }
  return { ok: false, why: 'timeout' };
}

const SAFE_ARG = /^[\w.\-:\[\]\/]{1,64}$/;
// 新任务不问「放哪个文件夹」（Khalil 11/12：「我也懒得去管……你就应该自己很聪明的去找应该在哪个项目文件夹，甚至新开一个文件夹」）。
// 会话一律开在主目录：共用的记忆和规矩只有在这里才读得到，它靠这些才找得对项目。再附下面这一段让它自己定文件夹；
// 包在 system-reminder 里，cleanPrompt 会把它滤掉，卡片上「你」那一行只显示他说的话。
const FOLDER_NOTE = '\n\n<system-reminder>这条任务是从总控台新建的，工作目录是主目录。用户没有指定文件夹，也不想被问放在哪里。请自己判断它属于哪个现有项目（先查记忆和 ~/Projects 下的文件夹），在那个项目的文件夹里做；是全新的东西就在 ~/Projects 下新建一个文件夹。不要把工程文件直接放在主目录。</system-reminder>';
const sameDir = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; } };
async function newSession(prompt, cwd, opt = {}) {
  let dir = String(cwd || '~').trim().replace(/^~(?=$|\/)/, HOME);
  if (!path.isAbsolute(dir)) dir = path.join(HOME, dir);
  try { if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch { return { ok: false, error: '没有这个文件夹：' + dir }; }
  if (opt.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };
  const provider = opt.provider === 'codex' ? 'codex' : 'claude';
  if (opt.codeMode === true && provider !== 'claude') return { ok: false, error: 'Code Mode 只有 Claude Code 有' };   // 报错不忽略：悄悄不开，调用方会以为开了（和写错档位同一个理由）
  const model = String(opt.model || '').trim(), effort = String(opt.effort || '').trim();
  if ((model && !SAFE_ARG.test(model)) || (effort && !SAFE_ARG.test(effort))) return { ok: false, error: '模型或强度的写法不对' };
  const gem = provider === 'claude' && isGemini(model);   // 选了 Gemini 模型：外壳还是 Claude Code，经 claude-gemini 脚本起。下面三样不接：报错不忽略（悄悄丢掉，调用方会以为生效了）
  if (gem) {
    if (!CONFIG.gemini) return { ok: false, error: 'Gemini 没有打开（config.json 的 gemini）' };
    if (!fs.existsSync(CONFIG.gemini)) return { ok: false, error: '找不到 claude-gemini 脚本：' + CONFIG.gemini };
    if (effort) return { ok: false, error: 'Gemini 模型没有强度这一项（用档位开窗口时档位会带强度，Gemini 别带档位）' };
    if (opt.account) return { ok: false, error: 'Gemini 模型不用 Claude 的账号' };
    if (opt.codeMode === true) return { ok: false, error: 'Code Mode 只有 Claude 的模型有' };
  }
  let acct = null;                                    // 选了账号：只认 config 里登记过、钥匙串里有 token 的
  let want = opt.account || (provider === 'claude' && !gem ? CONFIG.defaultAccount : '');   // 没选：config 有 defaultAccount 就用它（照样要钥匙串里有 token），没有才是钥匙串当前登录的号
  // 他从界面（含手机远程）新建、没明说账号的（「默认」、⌘T）：默认号这周或这 5 小时的读数到了 accountFallback.at 才退回 accountFallback.to（11/22）。
  // 只认带 Origin 的界面请求（opt.fromUi）：接口不带 account 的照旧开默认号（总管 4c：「保持现状」）；明说了账号的一律照明说的。
  // 退回的号钥匙串里没 token、或它自己也到了 toMax：照旧开默认号，不因为退不了就不开
  let fell = null;
  if (want && !opt.account && opt.fromUi === true && provider === 'claude' && CONFIG.accountFallback) {
    const d = pickDefault(CONFIG.defaultAccount, CONFIG.accountFallback, LIMITS.claude, Date.now()), kw = (k) => (k === 'week' ? '周' : '5 小时');
    const to = d.from ? acctList.find((a) => a.id === d.id) : null;
    if (to && to.ready) { want = d.id; fell = d; }
    else if (d.from) console.log(`account ${new Date().toISOString()} - 默认号 ${d.from} ${kw(d.key)}额度 ${d.used}%，该退回 ${d.id}，但它${to ? '钥匙串里没有 token' : '还不在号表里'}，照旧开 ${d.from}`);
    else if (d.blocked) {
      const b = d.blocked, s = `默认号 ${CONFIG.defaultAccount} ${kw(b.key)}额度 ${b.used}%，该退回的 ${b.to} ${kw(b.toKey)}额度也到了 ${b.toUsed}%（线 ${CONFIG.accountFallback.toMax}%），照旧开 ${CONFIG.defaultAccount}`;
      console.log(`account ${new Date().toISOString()} - ${s}`); noteOnce('blocked|' + b.key + '|' + b.resetsAt, s);
    }
  }
  if (want && provider === 'claude') {
    acct = acctList.find((a) => a.id === String(want));
    if (!acct) return { ok: false, error: '没有这个账号：' + String(want).slice(0, 40) };
    if (!acct.ready) return { ok: false, error: '钥匙串里还没有「' + acct.name + '」的 token' };
  }
  const files = await cleanFiles(opt.files);
  let text = (prompt || '').trim();
  if (files.length) text = (text ? text + '\n\n' : '') + '附件（先看这些文件再开始）：\n' + files.join('\n');
  const shown = text;                                 // 卡片上显示的那一份，不带下面附的那段
  const pin = opt.project ? pinnable(opt.project.key, opt.project.name) : null;   // 在哪一列的列头开的；核不过就当右上角开的
  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;   // 明确指定了别的文件夹（界面上已经没有这一格，接口还认）就不附
  let name = newName(), cl = null, gemMk = null;
  const args = ['-x', '160', '-y', '48', '-c', dir];                // openSession 在它自己那台 tmux 上 new-session -d -s <名字> 加上这些
  const base = args.length;
  if (provider === 'codex') {
    if (!codexBin) return { ok: false, error: '这台机器上没找到 codex 命令' };
    args.push(codexBin); if (model) args.push('-m', model); if (effort) args.push('-c', 'model_reasoning_effort="' + effort + '"');
    if (text) args.push(text);
  } else if (gem) {
    gemMk = (claude) => geminiArgv(model, claude, text ? [text] : []);   // 没有账号包装、没有 Code Mode：脚本自己设环境，不让 Claude 的登录混进来
    args.push(...gemMk(await findClaude()));
  } else {
    cl = [await findClaude()]; if (model) cl.push('--model', model); if (effort) cl.push('--effort', effort);
    if (text) cl.push(text);
    args.push(...wrapLaunch(acct, opt.codeMode === true ? withCodeMode(cl) : cl));   // 没选账号原样不变；选了就在外面包一层读钥匙串的 zsh。Code Mode 套在这一层里面
  }
  let r = await openSession(name, args);             // 每个窗口一台 tmux（P0-0）
  if (r.gone && cl) { args[args.length - cl.length] = await refindClaude(name); name = newName(); r = await openSession(name, args); }   // 一开就退了：重开一次。claude 那段总在 argv 最后（选号的 zsh、Code Mode 的 env 都包在它外面），只换它的路径
  if (r.gone && gemMk) { args.length = base; args.push(...gemMk(await refindClaude(name))); name = newName(); r = await openSession(name, args); }   // Gemini 窗口同样重开一次
  if (!r.ok) return r.gone ? { ok: false, error: gem ? GONE_GEM_MSG : cl ? GONE_MSG : '会话一开就退了' } : r;
  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });
  if (acct) console.log(`account ${new Date().toISOString()} ${name} ${acct.id}${opt.account ? '' : ' default'}${fell ? ` fallback ${fell.from} ${fell.key} ${fell.used}%` : ''}`);
  if (fell) noteOnce(fell.from + '|' + fell.key + '|' + fell.resetsAt, `默认号 ${fell.from} ${fell.key === 'week' ? '周' : '5 小时'}额度 ${fell.used}%（到了 ${CONFIG.accountFallback.at}%），新任务从 ${name} 起开在 ${fell.id}；${hmOf(fell.resetsAt)} 重置后回到 ${fell.from}`);
  const codeMode = provider === 'claude' && opt.codeMode === true;
  if (codeMode) console.log(`codemode ${new Date().toISOString()} ${name} new on`);
  if (gem) console.log(`gemini ${new Date().toISOString()} ${name} new ${model}`);
  if (pin) { pins[name] = { ...pin, at: Date.now() }; savePins(); }
  if (provider === 'codex') { agents[name] = { cwd: dir, at: Date.now(), prompt: shown, sid: null, rollout: null, model, effort }; saveAgents(); }
  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // config 里打开就替他点，开在哪个文件夹都一样；不等它，卡片先出来
  return { ok: true, name, project: pin, account: acct ? acct.id : null, codeMode, ...(gem ? { gemini: model } : {}), ...(fell ? { fallback: { from: fell.from, key: fell.key, used: fell.used } } : {}) };
}
// 退回时让总管知道（总管 khalil-4c 11/22 要的）：config 的 accountFallback.note 写了文件就追加一行。同一件事（同一个号、同一个额度窗口）只写一次（只记在内存：服务重启后可能再写一次）。
// 试验服务只往它自己的数据目录里写：拿真 config 拷贝起的试验服务不能往总管的 fyi.md 写假记录（11/22 审查）
const fellNoted = new Set();
const hmOf = (ms) => { const d = new Date(ms), z = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`; };
function noteOnce(k, text) {
  const fb = CONFIG.accountFallback; if (!fb || !fb.note || READONLY || fellNoted.has(k)) return;
  fellNoted.add(k);
  if (SANDBOX && !path.resolve(fb.note).startsWith(path.resolve(DATA) + path.sep)) { console.log(`account ${new Date().toISOString()} - 试验服务只往自己的数据目录里写退回记录，不写 ${fb.note}`); return; }
  try { fs.appendFileSync(fb.note, `- ${hmOf(Date.now())} 总控台：${text}\n`); } catch (e) { console.log(`account ${new Date().toISOString()} - 退回的记录写不进 ${fb.note}：${e.code || e.message}`); }
}

// 新开的会话如果卡在「是否信任这个文件夹」，界面上给一个确认按钮
async function pendingLaunches() {
  // 待处理 = 我们这个 tmux 里有、但还没作为会话出现在墙上的（多半卡在开工前的选择框）
  const out = [];
  const onWall = new Set(allSessions.filter((x) => x.tmux).map((x) => x.tmux));
  for (const k of [...launches.keys()]) if (!panes.some((p) => p.name === k)) launches.delete(k);
  for (const pane of panes) {
    if (onWall.has(pane.name)) { launches.delete(pane.name); continue; }
    if (agents[pane.name] && !CONFIG.codex) continue;           // codex 没打开：以前起的 Codex 窗格不当成「启动中」
    const L = launches.get(pane.name) || { at: pane.created, prompt: '', cwd: pane.cwd };
    const cap = await tmuxAt(pane.sock, ['capture-pane', '-p', '-t', pane.name]);
    const screen = cap.ok ? cap.out : '';
    out.push({ name: pane.name, prompt: L.prompt, cwd: L.cwd, at: L.at, provider: L.provider || (agents[pane.name] ? 'codex' : 'claude'), dialog: parseDialog(screen),
      screen: Date.now() - L.at > 20000 ? screenLines(screen, 12) : '' });
  }
  return out;
}

// ───────────── 循环 ─────────────

let pending = [];
async function slowLoop() {
  try { await refreshTerms(); } catch {}
  try { await refreshPanes(); await resolvePanes(); pending = await pendingLaunches(); await refreshWaitScreens(); } catch {}
  noteRoles(orgSafe());                             // 界面没开着时也记着各窗口的职级：一起退出时按它排接回的先后
  setTimeout(slowLoop, 4000);
}
async function suggestLoop() {
  try { await refreshSuggest(); } catch {}
  try { watchAuto(); } catch (e) { console.error('auto', e); }      // 读完屏幕马上看要不要自动续跑：灰字是它唯一的输入
  try { await watchKeepWarm(); } catch (e) { console.error('kw', e); }   // 总管空闲快到 1 小时：打一句续上缓存
  setTimeout(suggestLoop, SUGGEST_MS);
}
// 各订阅的周额度。Codex 只在 config.json 的 codex 打开时读（和「交给谁」同一个开关）；Claude 永远读，没人取数就是空数组。
// 顶栏写号的名字，和「新任务」的账号下拉同一个来源：config.json 的 accounts。没登记的 id 原样写；没标号的条目 name 是 null
const limitName = (id) => (id ? (CONFIG.accounts.find((a) => a.id === id) || { name: id }).name : null);
// Gemini 是 API 预付余额的估算（limits.mjs 的 geminiLimits）：没有锚点文件就是 null，顶栏不画。单独 try：它坏了不连累 Claude / Codex 那几格
let LIMITS = { claude: [], codex: null, gemini: null };
function limitsLoop() {
  try { const now = Date.now(); LIMITS = { claude: claudeLimits(LIMITS_DIR, now).map((e) => ({ ...e, name: limitName(e.account) })), codex: CONFIG.codex ? codexLimits(CODEX_HOME, now) : null, gemini: LIMITS.gemini }; } catch (e) { console.error('limits', e); }
  try { LIMITS.gemini = geminiLimits(LIMITS_DIR, Date.now(), { ledgers: CONFIG.geminiLedgers }); } catch (e) { console.error('limits gemini', e); LIMITS.gemini = null; }
  setTimeout(limitsLoop, LIMITS_MS);
}
function fastLoop() {
  try { scanSessions(); } catch (e) { console.error('scan', e); }
  setTimeout(fastLoop, 1200);
}

// ───────────── HTTP ─────────────

// 只接受总控台自己的页面发来的请求；预览页在另一个端口，也算外人。不带 Origin 的（curl、外壳）照旧靠口令
function fromBoard(req) { const og = req.headers.origin; return !og || og === 'http://127.0.0.1:' + PORT || og === 'http://localhost:' + PORT; }
function reply(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(data);
}
function readBody(req, max = 400000) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ───────────── /api/state?v=：只回变过的 ─────────────
// 界面每 1.5 秒拉一次，60 个窗口的整份约 300 KB，两次之间多数会话一个字都没变。带版本号来拉，服务只回这之后变过的：
//   v=<启动号>.<序号>。启动号每次起服务换一个；拿着上一台的、认不出的（v=0）、比忘掉的还早的，回整份（full: true）。
//   会话：变过的整个给（changed）；不见了的给名单（gone）；先后或成员变了给 ids（墙上的先后）。
//   quiet（在跑的会话多久没动静）每一拍都在涨，不算「变了」，不是 0 的单独放在 q 里。
//   全局字段（limits、org、crash、lost…）各自比，变了才给；now、notices 每次都给（notices 照旧只有不带 peek 的取走）。
// 不带 v 的老读法一个字段都不变：总管、值班、各种脚本都用 ?peek=1 读整份。
// 记账只在带 v 的请求里做：同一份 out 里每个会话跟上一次比，变了记下这一次的序号。几个页面同时拉也一样（每个页面带自己的 v）。
const ST_BOOT = crypto.randomBytes(4).toString('hex');
const ST_KEEP = new Set(['now', 'sessions', 'notices', 'peek']);     // 每次都给，或者另算
const ST_GONE_MAX = Number(process.env.CCBOARD_STATE_GONE_MAX) || 500;   // 不见了的名单最多记这么多；更早的忘掉，拿着更早版本号来的回整份（测试调小）
const stSess = new Map(), stGlob = new Map(), stGone = new Map();   // sid → { j, at }；字段名 → { j, at }；sid → 不见了的那一次
let stSeq = 0, stFloor = 0;
function stateSince(out, v) {
  let bumped = false; const at = () => (bumped ? stSeq : (bumped = true, ++stSeq));
  const seen = new Set();
  for (const s of out.sessions) {
    seen.add(s.sid); stGone.delete(s.sid);
    const j = JSON.stringify({ ...s, quiet: undefined }), c = stSess.get(s.sid);
    if (!c || c.j !== j) stSess.set(s.sid, { j, at: at() });
  }
  for (const sid of [...stSess.keys()]) if (!seen.has(sid)) { stSess.delete(sid); stGone.set(sid, at()); }
  while (stGone.size > ST_GONE_MAX) { const [sid, a] = stGone.entries().next().value; stGone.delete(sid); stFloor = Math.max(stFloor, a); }
  const glob = { ids: out.sessions.map((s) => s.sid) };
  for (const k of Object.keys(out)) if (!ST_KEEP.has(k)) glob[k] = out[k];
  for (const k of new Set([...Object.keys(glob), ...stGlob.keys()])) {
    const j = k in glob ? JSON.stringify(glob[k]) : undefined, c = stGlob.get(k);
    if (!c || c.j !== j) stGlob.set(k, { j, at: at() });
  }
  const now = ST_BOOT + '.' + stSeq;
  const m = /^([0-9a-f]{8})\.(\d{1,15})$/.exec(v || ''), base = m && m[1] === ST_BOOT ? Number(m[2]) : -1;
  if (base < stFloor || base > stSeq) return { ...out, v: now, full: true };
  const d = { now: out.now, v: now, base: v, changed: [], gone: [], q: {}, notices: out.notices };
  for (const s of out.sessions) {
    if (stSess.get(s.sid).at > base) d.changed.push(s);
    if (typeof s.quiet === 'number' && s.quiet !== 0) d.q[s.sid] = s.quiet;
  }
  for (const [sid, a] of stGone) if (a > base) d.gone.push(sid);
  for (const [k, c] of stGlob) if (c.at > base) d[k] = glob[k] ?? null;          // 没了的（或值是 undefined、整份里不出现的）给 null：不给的话界面会留着旧值
  if (out.peek) d.peek = true;
  return d;
}

const handle = async (req, res, via) => {
  try {
    if ((req.socket.localPort === REMOTE_PORT) !== (via === 'remote')) return reply(res, 403, { error: 'bad port' });   // 进来的端口和按哪一支判必须对得上
    const g = gate(req.headers, REMOTE, req.method, via);             // 第一道：本机端口只认本机（带代理头的也拒）；远程端口只认名单里的 *.ts.net + 登录头
    if (g.deny) { if (REMOTE.on) remoteLog(`deny ${g.deny} ${via === 'remote' ? '' : 'local-port '}${req.method} ${pathOf(req)}`, 'g:' + via + g.deny); return reply(res, 403, { error: g.deny }); }
    const rem = g.kind === 'remote' ? g : null;
    const u = new URL(req.url, 'http://127.0.0.1');
    if (rem) {                                                        // 第二、三道：远程只给页面、配对和白名单里的接口；接口要这台设备自己的凭证
      if (req.method === 'GET' && u.pathname === '/') {             // 不放口令：界面见到空口令就改带设备凭证。不许被别的页面嵌进去
        const html = fs.readFileSync(path.join(DIR, 'ui.html'), 'utf8').replace('__TOKEN__', '');   // 先读再写头：读失败时由外层 catch 回 500，不会在写过头以后再写一次头把服务弄崩
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "frame-ancestors 'none'" });
        return res.end(html);
      }
      if (req.method === 'GET' && u.pathname === '/pair') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        return res.end(PAIR_HTML);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/rp/')) return rpServe(req, res, u, rem);   // 远程预览的文件：网址里的钥匙就是凭证（媒体、iframe 带不了设备头）
      if (!(req.method === 'POST' && u.pathname === '/api/remote/claim')) {
        if (!allowed(req.method, u.pathname)) { remoteLog(`deny not-allowed ${req.method} ${pathOf(req)}`, 'a'); return reply(res, 403, { error: 'remote: not allowed' }); }   // 限流键固定：路径由对方定，不能每个新路径记一行
        const c = checkDevice(devices, req.headers['x-ccboard-device'], rem.login);
        if (c.deny) { remoteLog(`deny ${c.deny} ${req.method} ${pathOf(req)}`, 'd:' + c.deny); return reply(res, 401, { error: 'device', why: c.deny }); }
        rem.dev = c.dev; devSeen.set(c.dev.id, Date.now());
      }
    }
    if (u.pathname === '/health') return reply(res, 200, { ok: true, pid: process.pid, data: DATA, app: 'cc-board', sandbox: SANDBOX, readonly: READONLY });
    if (u.pathname === '/') {
      if (u.searchParams.get('k') !== TOKEN) return reply(res, 403, '用 ccboard 命令打开这个页面。', 'text/plain; charset=utf-8');
      const html = fs.readFileSync(path.join(DIR, 'ui.html'), 'utf8').replace('__TOKEN__', TOKEN);
      return reply(res, 200, html, 'text/html; charset=utf-8');
    }
    if (!u.pathname.startsWith('/api/')) return reply(res, 404, { error: 'not found' });
    if (!rem && req.headers['x-ccboard'] !== TOKEN) return reply(res, 403, { error: 'no token' });   // 远程的已经在上面核过设备凭证

    if (req.method === 'GET' && u.pathname === '/api/state') {
      if (u.searchParams.get('f') === '1' && !rem) uiFocusAt = Date.now();            // 你正看着总控台：停住了由界面提示，不另发系统通知（手机上看着不算）
      const peek = u.searchParams.get('peek') === '1' || !!rem;                      // 只看不取：后台守望脚本读状态，提示留给界面弹；手机读也不取走本机界面的提示
      const live = new Set(allSessions.filter((x) => x.tmux).map((x) => x.tmux));     // 已经上墙的就不再算「启动中」
      const lost = Object.values(archive.items).filter((x) => x.lost && x.state === 'archived')
        .map((x) => ({ sid: x.sid, provider: x.provider, title: x.title, cwd: x.cwd, prompt: x.prompt, lostAt: x.lostAt, crash: x.crash || null, idle: x.idle === true, project: x.project || classify(null, { title: x.title, prompt: x.prompt, cwd: x.cwd, home: HOME }) }));
      const out = { now: Date.now(), sessions: sessions.map((x) => withAuto(withSuggest(x))), others: otherCount, ghostty: ghosttyOk, pending: pending.filter((x) => !live.has(x.name)).map((x) => ({ ...x, project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME, pin: pinOf(x.name) }) })), home: HOME, notices, providers: providers(),
        archived: Object.values(archive.items).filter((x) => x.state !== 'restoring').length, lost, crash: crashView(), stallMs: STALL_MS, sandbox: SANDBOX, limits: LIMITS };
      out.sessions = out.sessions.map(withSnooze);                                                       // 先放着带时间：推迟中（没到点、没被叫醒）的会话多一个 snooze
      const uv = updater && !rem ? updater.view() : null; if (uv) out.update = uv;                                 // 有新版时界面顶栏出「安装 / 下载 X.Y.Z」；没有就不给这个键（老读法字段一个不变，同 remote）；只回变过的读法里没了给 null
      out.processed = processedView(out.sessions);                                                       // 「审完了」跨设备：本机端口、远程端口都给（见 processedView）
      if (REMOTE.on && !rem) out.remote = { hosts: REMOTE.hosts, devices: devices.size, port: REMOTE_PORT, ...(remoteDown ? { down: remoteDown } : {}) };      // 本机界面据此显示「手机」按钮；关着时没有这个键，和以前一样
      out.org = orgSafe(); noteRoles(out.org);                                                             // 架构视图：谁归谁管（只读，peek 不 peek 一样）
      if (peek) out.peek = true; else notices = [];
      if (u.searchParams.has('v')) return reply(res, 200, stateSince(out, u.searchParams.get('v')));   // 界面：只回变过的（见 stateSince）
      return reply(res, 200, out);
    }
    if (req.method === 'GET' && u.pathname === '/api/archive') {
      const items = Object.values(archive.items).sort((a, b) => b.archivedAt - a.archivedAt)
        .map((x) => ({ sid: x.sid, title: x.title, cwd: x.cwd, prompt: x.prompt, resultAt: x.resultAt, archivedAt: x.archivedAt, state: x.state, note: x.note || null, why: x.why || null, auto: x.auto === true }));
      const dropped = (archive.dropped || []).filter((x) => Date.now() - x.at < KEEP_DELETED_DAYS * 86400000);
      return reply(res, 200, { items, dropped, keepDays: KEEP_DELETED_DAYS });
    }
    if (req.method === 'GET' && u.pathname === '/api/diff') {
      const sid = u.searchParams.get('sid') || '', wanted = u.searchParams.get('path') || '';
      const tr = tracks.get(sid) || (CONFIG.codex && codexTracks.get(sid));
      const current = sessions.find(x => x.sid === sid);
      if (!tr || !tr.file || !fs.existsSync(tr.file) || !current) return reply(res, 404, { ok: false, error: '没有这段对话记录' });
      const cwd = String(current.cwd || '').replace(/^~(?=$|\/)/, HOME);
      if (!tr.st.wrote || ![...tr.st.wrote.keys()].some(p => wrotePath(p, cwd) === wanted)) return reply(res, 404, { ok: false, error: '这个文件不在这一轮的清单里' });
      try { return reply(res, 200, readDiff(tr, wanted, cwd)); }
      catch (e) { console.error('diff 读记录失败：' + String(e.message).replace(/[\r\n]/g, ' ')); return reply(res, 500, { ok: false, error: '没读到改动' }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/turns') {
      const sid = u.searchParams.get('sid') || '';
      const tr = tracks.get(sid) || codexTracks.get(sid);
      const file = (tr && tr.file) || (archive.items[sid] && archive.items[sid].file);
      if (!file || !fs.existsSync(file) || (file.includes('/.codex/') && !CONFIG.codex)) return reply(res, 404, { error: '没有这段对话记录' });
      const n = Math.min(40, Number(u.searchParams.get('n')) || 12);
      return reply(res, 200, { turns: file.includes('/.codex/') ? readCodexTurns(file, n) : readTurns(file, n) });
    }
    if (REMOTE.on && !rem && req.method === 'GET' && u.pathname === '/api/remote/devices') {   // 配对管理只在本机：列出已配对的设备（不给哈希）
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      return reply(res, 200, { ok: true, hosts: REMOTE.hosts, dirty: devDirty, down: remoteDown || null, pairing: pairing && pairing.exp > Date.now() ? { exp: pairing.exp } : null,
        devices: [...devices.values()].sort((a, b) => b.at - a.at).map((d) => ({ id: d.id, name: d.name, login: d.login, at: d.at, seenAt: devSeen.get(d.id) || null })) });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'method' });
    if (READONLY) return reply(res, 403, { ok: false, error: '只读模式，不能改东西' });
    const body = await readBody(req, u.pathname === '/api/upload' ? 48 * 1024 * 1024 : 400000);
    if (rem && rem.dev) {                            // 等正文的时候这台可能刚被撤销（审查 M1）：拿到正文再核一次，撤销了就不办
      if (devices.get(rem.dev.id) !== rem.dev) { remoteLog(`deny revoked-in-flight ${rem.dev.id} POST ${pathOf(req)}`, 'd:inflight:' + rem.dev.id); return reply(res, 401, { error: 'device', why: 'unknown device' }); }
      const sid8 = (/^[\w-]{1,8}/.exec(typeof body.sid === 'string' ? body.sid : '') || [''])[0];   // 只取字母数字横杠：正文里的换行不能伪造日志行
      remoteLog(`act ${rem.dev.id} ${rem.login} POST ${pathOf(req)}${sid8 ? ' ' + sid8 : ''}`);   // 远程做了什么留一行（不记正文）
    }
    if (rem && u.pathname === '/api/remote/push') {
      const d = rem.dev;
      const { token, env } = body;
      if (token !== null && !pushToken(token)) return reply(res, 400, { ok: false, error: 'bad token' });
      if (token !== null && !pushEnv(env)) return reply(res, 400, { ok: false, error: 'bad env' });
      let changed = false;
      if (token === null) { if (d.push) { delete d.push; changed = true; } }
      else {
        for (const other of devices.values()) if (other !== d && other.push?.token === token) { delete other.push; changed = true; }
        if (d.push?.token !== token || d.push?.env !== env) { d.push = { token, env, at: Date.now() }; changed = true; }
      }
      if (!changed) return reply(res, 200, { ok: true });
      const se = saveDevices();
      if (token !== null) {
        pushLog(`token ${d.id} ${env} ${token.slice(0, 8)}`);
      } else pushLog(`token ${d.id} cleared`);
      return reply(res, se ? 500 : 200, se ? { ok: false, error: 'save' } : { ok: true });
    }
    if (rem && u.pathname === '/api/remote/claim') {  // 手机打开配对链接：一次性的码换成这台设备自己的凭证。核对和作废之间没有 await
      const now = Date.now(), r = useCode(pairing, body.code, now);
      if (r.burn) pairing = null;                    // 过期了：这个码不再认
      if (!r.ok) { remoteLog(`claim deny ${r.deny} ${rem.login}`, 'c:' + r.deny); return reply(res, 403, { ok: false, error: r.deny }); }
      pairing = null;                                // 用一次就作废
      const { cred, dev } = newDevice(body.name, rem.login, now);
      devices.set(dev.id, dev);
      const se = saveDevices();
      if (se) { devices.delete(dev.id); remoteLog(`claim 设备表写不进去（${se}），这台没配上`); return reply(res, 500, { ok: false, error: 'save' }); }   // 没记进盘就不给凭证：免得重启后它凭空失效
      remoteLog(`claim ok ${dev.id} ${dev.name} ${rem.login}`);
      return reply(res, 200, { ok: true, device: cred, id: dev.id });
    }
    if (REMOTE.on && !rem && u.pathname === '/api/remote/pair') {   // 本机出配对码（再出一个，旧的就作废；cancel = 关掉弹层时作废）
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      if (body.cancel === true) { pairing = null; return reply(res, 200, { ok: true }); }
      if (remoteDown) return reply(res, 200, { ok: false, error: '远程端口没听上，手机现在连不上，先不出配对码' });   // 端口被别人占着时手机的请求会落到它那里：不让凭证往那儿送
      const host = REMOTE.hosts[0];
      if (!host) return reply(res, 200, { ok: false, error: 'config.json 的 remote.hosts 是空的' });
      const n = newCode(Date.now(), PAIR_TTL); pairing = n.slot;
      const url = 'https://' + host + '/pair#' + n.code;
      remoteLog(`pair 出了一个配对码（${Math.round(PAIR_TTL / 1000)} 秒内有效，用一次作废）`);
      return reply(res, 200, { ok: true, url, exp: n.slot.exp, ttl: PAIR_TTL, qr: qrSvg(url) });
    }
    if (REMOTE.on && !rem && u.pathname === '/api/remote/revoke') {   // 撤销一台设备：从表里删掉，它下一次请求就是 unknown device
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      const id = String(body.id || ''), d = devices.get(id);
      if (!d) return reply(res, 200, { ok: false, error: '没有这台设备' });
      devices.delete(id); devSeen.delete(id);        // 先从内存删：这一刻起就不认它
      const se = saveDevices();
      remoteLog(`revoke ${id} ${d.name} ${d.login}${se ? `（设备表没写进去：${se}，每 ${Math.round(DEV_RETRY_MS / 1000)} 秒重试）` : ''}`);
      if (se) {                                      // 审查 M2 / 复审 N2：别让界面以为撤干净了；旧表挪开，补写之前重启就是空表（宁可全部重配，不让撤掉的回来）
        try { fs.renameSync(DEV_FILE, DEV_FILE + '.stale'); } catch {}
        return reply(res, 200, { ok: false, error: '已经不认这台了，但设备表没写进盘，正在重试；写好之前重启，所有手机都要重新配对' });
      }
      return reply(res, 200, { ok: true });
    }
    if (u.pathname === '/api/crash') {              // 墙顶横幅：一起退出的那一起「全部接回」（restore）/「停下」（stop）/「先不管」「知道了」（dismiss）
      return reply(res, 200, crashAction(String(body.id || ''), String(body.action || '')));
    }
    if (u.pathname === '/api/ack') {                // 「知道了」：意外退出的那张卡收起来，对话留在归档里
      const it = archive.items[String(body.sid || '')];
      if (it && it.lost) { delete it.lost; saveArchive(); }
      return reply(res, 200, { ok: true });
    }
    if (u.pathname === '/api/auto') {               // 卡片上的自动续跑：cancel = 这一次交付不自动发了；now = 不等倒数，马上发
      const sid = String(body.sid || ''), s = sessions.find((x) => x.sid === sid);
      if (!s) return reply(res, 200, { ok: false, error: '这个会话已经不在了' });
      const a = autoArmed.get(sid), at = String(s.resultAt);
      if (body.op === 'cancel') { autoArmed.delete(sid); autoCanceled.set(sid, at); autoLog(s, 'cancel 你取消了'); return reply(res, 200, { ok: true }); }
      if (body.op === 'now') {
        if (!a || a.at !== at) return reply(res, 200, { ok: false, error: '它已经不在倒数了' });
        if (autoFiring) return reply(res, 200, { ok: false, error: '正在发另一条，过几秒再点' });
        fireAuto(withSuggest(s), a, true);
        return reply(res, 200, { ok: true });
      }
      return reply(res, 400, { error: 'op 要是 cancel 或 now' });
    }
    if (u.pathname === '/api/snooze') {             // 「先放着」带时间：{ sid, until（毫秒）} 推迟它这一次交付；{ sid, clear: true } 撤销
      const sid = String(body.sid || ''), s = sessions.find((x) => x.sid === sid), now = Date.now();
      if (!s) return reply(res, 400, { ok: false, error: '墙上没有这个会话' });
      if (body.clear === true) {
        if (snoozes[sid]) { delete snoozes[sid]; saveSnoozes(); console.log(`snooze ${new Date().toISOString()} ${sid.slice(0, 8)} clear`); }
        return reply(res, 200, { ok: true });
      }
      const until = Number(body.until);
      if (typeof body.until !== 'number' || !Number.isFinite(until) || until <= now || until > now + SNOOZE_MAX_MS) return reply(res, 400, { ok: false, error: '时间不对：要在现在之后、48 小时以内' });
      if (s.status === 'waiting' || s.ask) return reply(res, 200, { ok: false, error: '它在等你选，先放着会马上醒' });
      // 刚发了话、这一轮还没交付：记录里他的话一进来这一轮就没收尾（done 是 false），在跑的是 busy；他的话比交付新也算（兜底）
      if (s.status === 'busy' || !(s.done && s.result && s.resultAt) || (s.promptAt && Date.parse(s.promptAt) > Date.parse(s.resultAt))) return reply(res, 200, { ok: false, error: '刚发了话、它还没做完这一轮，不能先放着' });
      if (body.at !== undefined && String(body.at) !== String(s.resultAt)) return reply(res, 200, { ok: false, error: '它刚又交付了一次，先看一眼新的' });   // 界面看到的那一次和现在的不是同一次
      const ask = String((s.digest && (s.digest.ask || s.digest.head)) || '').slice(0, 300);
      snoozes[sid] = { until: Math.round(until), at: String(s.resultAt), setAt: now, ask }; saveSnoozes();
      console.log(`snooze ${new Date().toISOString()} ${sid.slice(0, 8)} set ${new Date(until).toISOString()}`);
      return reply(res, 200, { ok: true, until: snoozes[sid].until });
    }
    if (u.pathname === '/api/processed') {          // 界面把「审完了」告诉服务：map 新增 / 更新，clear 撤销。只增不整份替换：几个页面同时开着，后开的空页面不会把别人的清掉
      const okSid = (x) => typeof x === 'string' && /^[\w-]{8,64}$/.test(x);
      const m = body.map && typeof body.map === 'object' && !Array.isArray(body.map) ? body.map : {}; let ch = false;
      for (const [sid, at] of Object.entries(m).slice(0, 2000)) {
        if (!okSid(sid) || (typeof at !== 'string' && typeof at !== 'number')) continue;
        const prev = processed.get(sid);
        if (!prev || prev.at !== String(at)) { processed.set(sid, { at: String(at), seenAt: Date.now() }); ch = true; }
      }
      for (const sid of (Array.isArray(body.clear) ? body.clear : []).slice(0, 2000)) if (okSid(sid) && processed.delete(sid)) ch = true;
      if (ch) saveProcessed();                       // 变了才写（页面载入时整份重发，多半一笔都没变）
      return reply(res, 200, { ok: true, n: processed.size });
    }
    if (u.pathname === '/api/send') {
      return reply(res, 200, await sendTo(String(body.sid || ''), String(body.text || '').trim(), body.files));
    }
    if (u.pathname === '/api/upload') {             // 粘贴 / 拖进来的文件：存到 uploads，回它的路径
      const m = String(body.data || '').match(/^(?:data:[^;,]*;base64,)?([A-Za-z0-9+/=\s]+)$/);
      if (!m) return reply(res, 200, { ok: false, error: '文件内容读不出来' });
      const buf = Buffer.from(m[1], 'base64');
      if (!buf.length || buf.length > 30 * 1024 * 1024) return reply(res, 200, { ok: false, error: '单个文件最大 30 MB' });
      const dest = uploadPath(body.name || 'file');
      fs.writeFileSync(dest, buf, { mode: 0o600 });
      return reply(res, 200, { ok: true, ...fileInfo((await normalizeFile(dest)) || dest) });
    }
    if (u.pathname === '/api/pick') {               // 弹系统的选文件框；选的是磁盘上已有的文件，不用再传一遍
      const r = await osa(PICK_FILES, [String(body.prompt || '选要发给它的文件')], 600000);
      if (!r.ok) return reply(res, 200, { ok: true, files: [] });            // 取消也走这里
      const out = [];
      for (const line of r.out.split('\n').map((x) => x.trim()).filter(Boolean)) { const n = await normalizeFile(line); if (n) out.push(fileInfo(n)); }
      return reply(res, 200, { ok: true, files: out });
    }
    if (u.pathname === '/api/focus') return reply(res, 200, await focusSession(String(body.sid || '')));
    if (u.pathname === '/api/archive') return reply(res, 200, archiveSession(String(body.sid || ''), body.force === true));
    if (u.pathname === '/api/unarchive') return reply(res, 200, await unarchive(String(body.sid || '')));
    if (u.pathname === '/api/delete') return reply(res, 200, await deleteSession(String(body.sid || '')));
    if (u.pathname === '/api/new') {
      // 开窗口的一方（比如总指挥窗口）可以只说档位 tier（heavy / standard / light），由 route.mjs 翻成模型和强度；不说档位就和以前一样。
      // 档位写错在这里直接拦下，不开窗口：悄悄退回默认，调用方会以为已经省了钱。账号（account）是另一维，和档位互不影响。
      // 谁开的这个窗口（架构视图）：带 Origin 的是界面自己发的 = 他本人，不记；body.from 正好是一个活会话的 sid 就用它；
      // 否则现在就按端口去认（趁调用方的 curl 还连着；newSession 要好几秒），newSession 成功以后再等结果。认不出就不记，/api/new 照常。
      const fromOk = typeof body.from === 'string' && allSessions.some((x) => x.sid === body.from);
      const who = req.headers.origin ? null : fromOk ? Promise.resolve({ sid: body.from, how: 'from' }) : findCaller(req.socket.remotePort).then((sid) => (sid ? { sid, how: 'lsof' } : null), () => null);
      const rt = routeNew({ provider: body.provider, model: body.model, effort: body.effort, tier: body.tier });
      if (!rt.ok) return reply(res, 200, rt);
      if (body.codeMode != null && typeof body.codeMode !== 'boolean') return reply(res, 200, { ok: false, error: 'codeMode 只能是 true 或 false' });   // "1"、1 这类写法不猜：只有 true 才开
      const r = await newSession(String(body.prompt || ''), String(body.cwd || '~'), { provider: body.provider, model: rt.model, effort: rt.effort, account: body.account, fromUi: !!req.headers.origin, files: body.files, project: body.project && typeof body.project === 'object' ? body.project : null, codeMode: body.codeMode === true });
      if (r.ok) { await refreshPanes(); if (rt.tier) console.log(`route ${new Date().toISOString()} ${r.name} ${rt.tier} ${body.provider === 'codex' ? 'codex' : 'claude'} ${rt.model || '-'} ${rt.effort}`); }
      if (r.ok && who) {
        const w = await who;
        if (w) {
          spawns[r.name] = { by: w.sid, at: Date.now() }; try { saveSpawns(); } catch {}
          console.log(`spawn ${new Date().toISOString()} ${r.name} ${w.sid.slice(0, 8)} ${w.how}`);
          r.by = w.sid;                                    // 应答里带上：调用方看得到自己被记成了谁
        }
      }
      return reply(res, 200, r.ok && rt.tier ? { ...r, route: { tier: rt.tier, model: rt.model, effort: rt.effort, why: rt.why } } : r);   // 声明了档位才带 route：调用方看得到最后用了什么
    }
    if (u.pathname === '/api/update/open') {        // 顶栏「安装 X.Y.Z」：打开下好、核过 sha256 的 dmg（不在远程白名单里，手机点不了）
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      const st = updater && updater.state(), v = updater && updater.view();
      if (!v || !v.ready || !st.file || !fs.existsSync(st.file)) return reply(res, 200, { ok: false, error: '新版还没下好', page: v ? v.page : null });
      if (SANDBOX) { console.log(`update ${new Date().toISOString()} dry:open ${st.file}`); return reply(res, 200, { ok: true, dry: true }); }
      const r = await run('/usr/bin/open', [st.file]);
      console.log(`update ${new Date().toISOString()} open ${st.fileVer} ${r.ok ? 'ok' : r.err}`);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    if (u.pathname === '/api/update/check') {       // 「检查更新」：马上查一次（不等一天）；测试也走它
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      if (!updater) return reply(res, 200, { ok: false, error: '这台没开检查更新' });
      await updater.tick(true);
      return reply(res, 200, { ok: true, update: updater.view(), error: updater.state().error });
    }
    if (u.pathname === '/api/open') {               // 正文里的本机路径被点了（11/12 Khalil：「把资料直接把链接给我，我可以直接点进去」）
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      const { p, error } = localPath(body.path); if (error) return reply(res, 200, { ok: false, error });
      const action = openAction(p);
      if (!action) return reply(res, 200, { ok: false, error: '这个文件不在了：' + p });
      if (SANDBOX) { console.log(`open ${new Date().toISOString()} dry:${action} ${p}`); return reply(res, 200, { ok: true, action, dry: true }); }   // 试验场里只写日志，不真打开
      const r = await run('/usr/bin/open', action === 'open' ? [p] : ['-R', p]);
      return reply(res, 200, { ok: r.ok, action, error: r.err });
    }
    if (u.pathname === '/api/preview') {            // 正文里的路径点了：网页、PDF、图、音视频、文本在总控台里看（11/15 Khalil：「点 HTML 还要到浏览器里」「访达里的这种文件预览，也直接在我们的 APP 里打开」）
      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      if (body.paths !== undefined) {               // 一条交付里写了好几个图片路径：合成一个图集（11/15 Khalil：「直接把这些照片做成一个合集，我就不要一个一个去点开」）
        if (!Array.isArray(body.paths)) return reply(res, 200, { ok: false, error: '不是路径列表' });
        const many = preview.registerMany(body.paths.slice(0, 400).map((x) => localPath(x).p).filter(Boolean));     // 不是完整路径的直接丢掉
        if (many.ok) console.log(`preview ${new Date().toISOString()} gallery ${many.items.length} 个文件（${new Set(many.items.map((i) => i.dir)).size} 个文件夹）`);
        return reply(res, 200, many.ok ? many : { ok: false, reason: many.error, error: many.error === 'not-ready' ? '预览还没准备好，过一秒再点' : '这些图都打不开了' });
      }
      const { p, error } = localPath(body.path); if (error) return reply(res, 200, { ok: false, error });
      const r = preview.register(p);
      if (r.ok) console.log(r.kind === 'gallery' ? `preview ${new Date().toISOString()} gallery ${r.dir} ${r.items.length}/${r.total}` : `preview ${new Date().toISOString()} ${r.kind} ${r.dir}/${r.name}`);
      return reply(res, 200, r.ok ? r : { ok: false, reason: r.error, error: r.error === 'missing' ? '这个文件不在了：' + p : r.error === 'not-ready' ? '预览还没准备好，过一秒再点' : '这个文件不能在这里预览' });   // reason 不是 not-ready 时界面改走 /api/open（no-preview：文件夹、Word 这类；missing：由 /api/open 报同一句错）
    }
    if (u.pathname === '/api/remote/preview') {     // 手机远程的预览（C1）：只给这个会话对话里出现过的文件，见 rpEvidence / rpFile
      if (!rem || !rem.dev) return reply(res, 403, { ok: false, error: '只给手机远程用' });
      const sid = typeof body.sid === 'string' ? body.sid : '', sid8 = (/^[\w-]{1,8}/.exec(sid) || [''])[0];
      const ev = sid ? rpEvidence(sid) : null;
      const no = (why, code, reason, error) => { remoteLog(`rpreview ${rem.dev.id} ${sid8 || '-'} deny ${why}`); return reply(res, code, { ok: false, reason, error }); };
      if (!ev) return no('no-session', 404, 'missing', '没有这段对话记录');
      if (body.paths !== undefined) {
        if (!Array.isArray(body.paths)) return no('bad-paths', 400, 'bad', '不是路径列表');
        const seen = new Set(), items = []; let skipped = 0;
        for (const raw of body.paths.slice(0, 400)) {
          const f = rpFile(raw, ev);
          if (f.why || (f.kind !== 'image' && f.kind !== 'video')) { skipped++; continue; }
          if (seen.has(f.real)) continue; seen.add(f.real);
          if (items.length < 200) items.push({ name: f.name, kind: f.kind, dir: f.dir, url: rpKey(rem.dev, rem.login, f) });
        }
        if (!items.length) return no('gallery-empty', 404, 'no-preview', '这些图不在这段对话里，或者打不开了');
        remoteLog(`rpreview ${rem.dev.id} ${sid8} ok gallery ${items.length}`);
        return reply(res, 200, { ok: true, kind: 'gallery', total: seen.size, truncated: seen.size > items.length, skipped, items });
      }
      const f = rpFile(body.path, ev);
      if (f.why === 'folder') {
        const g = rpGallery(f.real, f.id);
        if (g.why === 'missing') return no('folder-missing', 404, 'missing', '这个文件夹不在了');
        if (g.why) return no('folder-' + g.why, 200, 'no-preview', g.why === 'shallow' ? '主目录这一层的文件夹远程不列' : '这个文件夹里不是一组图或视频，远程看不了');
        const items = g.media.map((m) => ({ name: m.name, kind: m.kind, dir: f.real, url: rpKey(rem.dev, rem.login, { real: m.real, name: m.name, id: m.id }) }));
        remoteLog(`rpreview ${rem.dev.id} ${sid8} ok folder ${items.length}`);
        return reply(res, 200, { ok: true, kind: 'gallery', name: path.basename(f.real), dir: f.real, total: g.total, truncated: g.truncated, items });
      }
      if (f.why === 'no-preview') return no(f.why, 200, 'no-preview', '这种文件远程预览不了');
      if (f.why === 'missing') return no(f.why, 404, 'missing', '这个文件不在了');
      if (f.why === 'link' || f.why === 'hidden') return no(f.why, 404, 'not-in-conversation', f.why === 'link' ? '这是指到别处的链接，远程不给看' : '点开头的文件夹（.ssh、.git 这类）远程不给看');
      if (f.why) return no(f.why, 404, 'not-in-conversation', '这个文件不在这段对话里，远程不给看');
      const r = { ok: true, kind: f.kind, name: f.name, dir: f.dir };
      if (f.kind === 'text' || f.kind === 'markdown') { const o = rpOpen(f.real, f.id), t = o && readText(f.real, o.size, o.fd); if (o) fs.closeSync(o.fd); if (!t) return no('missing', 404, 'missing', '这个文件不在了'); r.text = t.text; r.truncated = t.truncated; }   // 从核过的那个 fd 读（11/22）
      else r.url = rpKey(rem.dev, rem.login, f);
      remoteLog(`rpreview ${rem.dev.id} ${sid8} ok ${f.kind} ${rpName(f.name)}`);
      return reply(res, 200, r);
    }
    if (u.pathname === '/api/reveal') {             // 只在访达里选中，不直接打开（路径是模型写的，不能当命令跑）
      let p = String(body.path || '').trim().replace(/^~(?=$|\/)/, HOME);
      if (!path.isAbsolute(p)) return reply(res, 200, { ok: false, error: '不是完整路径' });
      if (!fs.existsSync(p)) return reply(res, 200, { ok: false, error: '这个文件不在了：' + p });
      const r = await run('/usr/bin/open', ['-R', p]);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    if (u.pathname === '/api/answer') {             // 用户在卡片上点了选择框里的某一项（只对总控台自己开的后台会话）
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name)) return reply(res, 400, { ok: false, error: '不是总控台开的会话' });
      return reply(res, 200, await answerDialog(name, Number(body.option), String(body.text || '')));
    }
    if (u.pathname === '/api/attach') {             // 把后台会话接到一个终端标签里看
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name)) return reply(res, 400, { ok: false, error: '不是总控台开的会话' });
      return reply(res, 200, await openAttach(name));
    }
    if (u.pathname === '/api/cancel') {             // 取消一个还没跑起来的新会话（只关自己开的）
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name) || !pending.some((p) => p.name === name)) return reply(res, 404, { ok: false, error: '没有这个待处理的新任务' });
      const r = await tmuxFor(name, ['kill-session', '-t', name]);
      launches.delete(name);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    return reply(res, 404, { error: 'not found' });
  } catch (e) {
    reply(res, 500, { error: String((e && e.message) || e) });
  }
};
const server = http.createServer((req, res) => handle(req, res, 'local'));

server.on('error', (e) => { console.error('listen', e.message); process.exit(1); });
const preview = startPreview({ port: PREVIEW_PORT, home: HOME, log: (m) => console.log(`preview ${new Date().toISOString()} ${m}`) });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc-board ${new Date().toISOString()} http://127.0.0.1:${PORT}/?k=${TOKEN} pid=${process.pid}`);
  if (REMOTE.on && REMOTE_PORT_BAD) { remoteDown = 'bad port'; remoteLog(`listen 远程端口写错（${REMOTE_PORT_RAW.slice(0, 20)}），不听，手机连不上`); }
  else if (REMOTE.on) {                              // 远程端口：只在 remote 开着时听，也只听 127.0.0.1（tailscale serve 在本机转过来）。听不上不连累总控台本身
    const rs = http.createServer((req, res) => handle(req, res, 'remote'));
    rs.requestTimeout = 30000; rs.headersTimeout = 10000; rs.maxConnections = 64;   // 远程的连接比本机收紧：没配对的设备挂不住连接
    const tryListen = () => { try { rs.listen(REMOTE_PORT, '127.0.0.1'); } catch (e) { remoteDown = String((e && e.code) || e); } };
    rs.on('listening', () => { remoteDown = ''; remoteLog(`listen 127.0.0.1:${REMOTE_PORT}（tailscale serve 指向这里）`); });
    rs.on('error', (e) => {                          // 被占着（别的进程先听了这个端口）：手机的请求会落到它那里，所以不出码；隔一阵再试，占着的走了就接上
      remoteDown = String((e && e.code) || (e && e.message) || e);
      remoteLog(`listen 127.0.0.1:${REMOTE_PORT} 没听上（${remoteDown}），手机连不上，${Math.round(REMOTE_RETRY_MS / 1000)} 秒后再试`, 'listen:' + remoteDown);
      setTimeout(tryListen, REMOTE_RETRY_MS).unref();
    });
    tryListen();
  }
  console.log(`tmux ${new Date().toISOString()} -S ${TMUX_SOCKET}`);
  if (!READONLY) for (const [sid, it] of Object.entries(archive.items)) if (it.state === 'archiving') scheduleStop(sid);   // 上次没来得及停的，接着办
  if (!READONLY) for (const c of Object.values(archive.crashes || {})) if (c.state === 'running' || c.state === 'waiting') { c.state = 'stopped'; c.why = 'restart'; c.stop = false; }   // 排到一半服务重启了：停在那里，横幅上能接着点
  if (!READONLY) try { if (fs.statSync(TMUX_EXIT_LOG).size > 1 << 20) fs.writeFileSync(TMUX_EXIT_LOG, tailLines(TMUX_EXIT_LOG, 2000)); } catch {}   // 看护写的日志超过 1 MB 留最后 2000 行
  if (!READONLY) { purgeDeleted(); purgeUploads(); purgeTaps(LIMITS_DIR); setInterval(() => { purgeDeleted(); purgeUploads(); purgeTaps(LIMITS_DIR); }, 12 * 3600 * 1000); }
  if (!READONLY) try { fs.writeFileSync(SERVER_FILE, JSON.stringify({ pid: process.pid, port: PORT, at: Date.now() }) + '\n'); } catch (e) { console.log(`datadir ${new Date().toISOString()} 记不了 ${SERVER_FILE}：${e.message}`); }
  if (CONFIG.codex) findCodex();
  refreshAccounts(); setInterval(refreshAccounts, 30000);
  if (updater) { setTimeout(() => updater.tick(), (SANDBOX && Number(process.env.CCBOARD_UPDATE_DELAY_MS)) || 60000).unref(); setInterval(() => updater.tick(), 3600000).unref(); }   // 起来一分钟后查一次，之后每小时看一眼（一天只真连一次）
  fastLoop(); slowLoop(); suggestLoop(); limitsLoop(); scrubTmuxEnv();
});
