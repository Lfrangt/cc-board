# cc-board（总控台）- 把所有 Claude Code / Codex 会话收进一个窗口：你说的话、它在干嘛、它交付了什么、它为什么停了

Node 22（无依赖）+ 单文件 HTML + Swift / WKWebView 外壳 + tmux + Ghostty AppleScript

<directory>
app/ - 原生外壳（main.swift + Info.plist + 图标）
test/ - 隔离测试（7 个脚本：分组规则、输入框预判、订阅额度、新窗口档位、服务端、改坏对照、界面；假主目录 + 自己的端口）
build/ - 编译产物（build.sh 生成，可删）
publish/ - 本机的发帖素材（不进仓库）
docs/ - README 用的图和视频
.rollback/ - 每次上线前装着的那一版，按日期存
</directory>

<config>
server.mjs - 服务。读会话登记和对话记录，算出每个会话的状态，提供 /api。
projects.mjs - 分组规则。按会话动过的文件夹和标题认出它属于哪个项目；项目表由 server.mjs 从 config.json 读出来交给 useRules()。server.mjs 引用它，所以上线时九个文件一起拷（server.mjs、ui.html、projects.mjs、suggest.mjs、limits.mjs、statusline-tap.mjs、accounts.mjs、route.mjs、preview.mjs）。
route.mjs - 新窗口的档位（纯函数 `routeNew()`）：开窗口的一方在 /api/new 里说 `tier`（heavy / standard / light），这里翻成模型和强度；档位表是模型和强度的唯一出处。server.mjs 引用它，见「新窗口的模型和强度」一节。
suggest.mjs - 输入框上的预判的解析器（纯函数 `parseSuggest()`）。从 tmux 屏幕文本里取灰字建议和「下一步 1/2/3」。server.mjs 引用它，见「输入框上的预判」一节。
limits.mjs - 顶栏右上角的各订阅周额度。Codex 读 `~/.codex` 的 rollout 里 `token_count.rate_limits`，Claude 读 statusline-tap.mjs 存的取数文件，汇总成 `{ claude: [条目], codex: 条目 | null }`。server.mjs 引用它，见「订阅额度」一节。
accounts.mjs - 新任务选账号。config.json 的 `accounts` 登记号，token 在钥匙串 `ccboard-account-<id>`；开会话时包一层 zsh 读出 token、设 `CLAUDE_CODE_OAUTH_TOKEN` 和 `CCBOARD_ACCOUNT` 再 exec claude。server.mjs 引用它，见「新任务」里的「选账号」。
statusline-tap.mjs - 挂成 Claude Code 状态栏命令（settings.json 的 `statusLine`）的取数脚本：从状态栏 JSON 里只取走 `rate_limits` 存成文件，终端里顺手打一行 `5h 6% · 7d 1%`。和 limits.mjs 放在同一个目录（它 import limits.mjs 来定文件名）。
preview.mjs - 内置预览的只读文件服务（`startPreview()`）。另一个端口，按随机编号只发一个文件夹里白名单类型的文件。server.mjs 引用它，见「内置预览」一节。
<数据目录>/config.json - 本机设置（不在仓库里）：项目表、哪些文件夹算证据、自动点信任、Codex、自动收工。见下面「config.json」一节；测试用 test/fixture-config.json。
ui.html - 界面。轮询 /api/state，画卡片。
build.sh - `./build.sh update` 换界面和服务（server.mjs、ui.html、projects.mjs、suggest.mjs、limits.mjs、statusline-tap.mjs、accounts.mjs、route.mjs、preview.mjs）；不带参数是重新编译安装。外壳（app/main.swift）只认 server.mjs 和 ui.html 在不在，不列旁边的文件，所以新增文件不用重新编译。
README.md、CONTRIBUTING.md、LICENSE - 对外的英文文档和 MIT 许可。README 里写的每一句都要有代码依据。
package.json - 只有测试用的 playwright-core；服务和界面本身零依赖。
.github/workflows/ci.yml - macOS 上跑服务端测试和界面测试。
</config>

## 状态从哪来

服务每 1.2 秒读一遍 `~/.claude/sessions/<pid>.json`（状态 idle / busy / shell / waiting）和对话记录的新增部分。
`apply()` 把记录压成状态；`alertOf()` 回答「要不要你跟进」，结果放在会话的 `alert` 字段里。界面的 `view()` 只读这个字段。

| alert.kind | 记录里的依据 | 卡片右上角 |
|---|---|---|
| limit | assistant 消息 `model` 是 `<synthetic>`、`isApiErrorMessage`、`error: rate_limit` | 停住了 · 额度用完 |
| auth | 同上，`error: authentication_failed` | 停住了 · 登录过期 |
| flagged | 同上，`stop_reason: refusal`（`error` 是 invalid_request，正文「<模型>'s safeguards flagged this message」） | 停住了 · 被安全检查拦了 |
| error | 同上，其余 `error`（上下文超长等；上下文超长的 stop_reason 是 stop_sequence，不算 flagged） | 停住了 · 报错 |
| interrupt | user 消息正文是 `[Request interrupted by user…]`，且当时一轮没收尾 | 停住了 · 被打断 |
| unfinished | 状态不是 busy，这一轮有过动作，没有收尾的话 | 停住了 · 没做完 |
| stall | 状态是 busy，对话记录和 subagents 文件夹 20 分钟没有新内容 | 运行中 · N 分钟没动静 |
| （gone） | 上一轮状态是 busy / waiting，这一轮进程没了，且不是总控台自己停的 | 停住了 · 进程退出 |

- `flagged`（11/13 Khalil 定，khalil-3f 提的）：11/12 12:00 起本机 22 条 API 报错里 18 条是它（Opus 5.5 ×12、Fable 5.2 ×6），以前全落进「报错」。卡片正文多一行 `WHY_NEXT.flagged`，不用点开就看得到：按两下 Esc 改上一条消息，或用 /model 换个模型（照 Claude Code 报错里自己的建议），并写明同一段对话可能再被拦。不写「回一句话就能接着做」：被拦后的第一个动作，5 分钟内又被拦的有 5/18（回话 7 次里 2 次、/model 3 次里 2 次、/effort 4 次里 1 次）。
- 状态是 `shell`（它自己歇着，放到后台的命令还在跑，跑完会自己接着做）不在上表里：它不算停住，`alertOf` 对它不报 unfinished。界面的 `view()` 把它算在跑（`bg`），卡片左上角显示「后台在跑 · 时长」（点在呼吸），计入顶栏的「运行中」，排在要你处理的后面。
- 界面上没有「已看」这个词（Khalil 11/12：看过不等于处理过）。

## 交付：待跟进 / 待审阅（11/12 khalil-66）

Khalil 11/12 的原话：「已看这个 tag 打得非常没有用……你要说我是待跟进」「提醒我：哪边已经交付了结果，让我去审阅；哪些是要我输入新的指令去跟进的」；16:05 又说清：「待跟进的意思就是 Agent 做完，需要我做决定」「有时候是交付给其他 Agent 的，并不是交给我的，要分清楚」。

- 服务端 `digest()` 从每次交付里取三样，放在会话的 `digest` 字段：`head`（一句结论，取第一段的头一两句，太短就接下一段的第一句）、`ask`（要你做的那一件事）、`need`（`reply` = 待跟进：要他本人决定或动手；`review` = 待审阅：给他的结果；`fyi` = 无需处理：回给别的窗口的、过程汇报；`bg` = 它说还在后台跑）。`skip` 是正文开头那段已经整段当成 head 时，界面从哪里往后显示。
- 服务端记下每一轮是谁开的头（`turnBy`）：他本人的话 → `human`；别的窗口发来的消息（记录里 `origin.kind === 'peer'`、`isMeta: true`）在没开着的一轮上 → `peer`。任务通知叫醒的不改它（接着做的还是原来那件事）。交付时记成 `resultBy`。
- 它自己在回复最后写了一行「【待跟进】…」「【待审阅】…」「【进展】…」（旧写法「【在跑】…」），就以这一行为准（`tag: true`），这一行从正文里拿掉。这条写法 11/12 加进了 `~/.claude/CLAUDE.md` 和 `~/AGENTS.md` 的 Communication Rules。没写就按正文猜：问你问题、请你定 / 选 / 回一句 → 待跟进；写明「不需要你…」或 `resultBy` 是 `peer` → 无需处理；其余 → 待审阅。「……的话告诉我」「…了告诉我」「之后再…」都不算待跟进。11/12 拿最近 48 小时 785 条真实交付里的 220 条量过：38 条判成待跟进，抽查大部分对，少数误判（文件夹名里带「请你」）。
- 无需处理是灰字、不计数、没有按钮，排在在跑的后面。待审阅 / 待跟进只有两种动作算处理过：回它话，或点卡片上的「审完了」（待审阅）/「先放着」（待跟进）。记在 localStorage 的 `ccb_done`（会话 → 那次交付的时间），能撤销。看一眼、点开、点正文都不改状态。
- 排位：等你选 0 → 停住了要跟进 1 → 待跟进 2 → 待审阅 3 → 在跑（含后台在跑）4 → 无需处理 / 处理过 5 → 停住你已知道 6 → 空闲 7。停住了的原因写在封面那一句里，正文里的那一句藏起来（`:has(.head:not(:empty))`）。顶栏、窗口标题和 Dock 角标数「待跟进 + 待审阅 + 等你选 + 停住了」。

## 封面的样子

- 每张卡上半截是「封面」：左上角状态药丸（符号 + 字）→ 标题（宽屏 31px）→ 一句结论（20px）→ 要你做的事（琥珀色框，前面一个 ↩）→ 你说的话（一行）→ 正文（15px，一行最多 40 个字）。
- 卡片右上角一直有「去终端」按钮（11/13 Khalil：「每次还要点菜单不方便」），和正文里的「去终端看」走同一个 `data-act="focus"` → `goTerminal()`；「⋯」菜单里只剩归档 / 删除。「进程退出」和「启动中」的卡片用自己的模板，没有这个按钮。
- 卡头放不下时（11/13 Khalil「修吧」）：`.card` 是容器（`container-type:inline-size`），卡窄于 540 px（墙上 8 格的卡约 356–456 px；英文带字的按钮排一行要约 523 px）时「去终端」「归档」只留图标，名字留在 aria-label / title，间距和「审完了」的内边距收一点；还放不下就换行（`flex-wrap`），不切掉。英文药丸里交付时间去掉 ago（`when(…, pill)`），「被安全检查拦了」的英文药丸是 `safety block`。中文药丸不变。用容器查询不用窗口宽度：同一个窗口里墙的卡窄、封面的卡宽。
- 颜色只给状态：青 = 交付了 / 在跑，琥珀 = 要你动手，灰 = 处理过 / 空闲。按会话上色试过，他否了（11/12：「没什么质感，很 low」）；质感靠灰阶、细边和顶上一道光。
- 两边紧挨着的两张不糊、不压在中间那张上（窗口不够宽就缩小，最小 0.46 倍），只把正文淡到 0.28；隔一张以上的才模糊。底下一排点代替页码，一张卡一个点。
- 正文里直接贴的网址、写在反引号里的网址都变成链接（新窗口打开）。原生外壳把新窗口和外站的链接都交给默认浏览器，所以点了是在浏览器里开，不会把总控台本身换掉。
- 同一种报错连着出现算同一次停住，`alert.key` 记第一次的时间。key 相同就不再提醒、「先不管」也不失效。
- gone 不在 `alert` 里：会话已经不在列表中。服务把它记进 `archive.json` 并标 `lost`，`/api/state` 的 `lost` 数组给界面画卡片。
- 压缩摘要（`isCompactSummary`）和打断标记不算「你说的话」。

## 按项目分组（11/12 khalil-96）

Khalil 11/12 16:06 的原话：「如果我们都是在做 FretFlow 的话，你可以把这些放到一块去。如果我是做总控台的话，可以再放另外一块，不要让这些混起来」。
16:4x 看了按行分组的第一版：「这样就跟我们这个显示面积效率不是有矛盾了吗？……有几个窗口显示不到了」「你可以把它改成竖着的……如果我有三个任务，那就是三列」「动画好一点」。

- 他所有窗口都开在主目录，cwd 认不出项目；标题是语音转写的（FretFlow 常被写成 Freight Flow、Fragrant Flow）。所以证据以「它动过哪些文件夹」为主。
- 证据：每次工具调用的参数里出现的、config.json 的 `roots` 里那些文件夹下面一层的文件夹（默认是主目录下的 `~/Projects/<名>`、`~/Desktop/<名>`）。一次调用里同一个文件夹算一次，记在 `st.files`。服务首次只读对话记录的尾巴（4 MB 起），所以数的是最近的工作。
- 不算证据的：全机共用的测试锁 `shared/fretflow-lock`、讲解页 `shared/learning-pages`、桌面的 `边做边学`、截屏。
- 计分：文件夹每次 1 分；标题命中项目关键词 10 分；他说的话命中 3 分（新任务附的 FOLDER_NOTE 已被 `cleanPrompt()` 滤掉，里面的「总控台」不算）；工作目录在 `~/Projects/<名>` 下 5 分（只看主目录以下那一段）。分最高的胜，同分时项目表里的优先。一分都没有 = 其他。
- 项目表在 config.json 的 `projects`（见「config.json」一节）：每行 key、显示名、文件夹规则 dir、关键词规则 word。要给新项目起名字，就加一行，再 `./build.sh update` 重启服务。仓库里的默认表是空的。没登记的 `~/Projects` 文件夹自成一组，组名是文件夹名（去掉 `-日期` 尾巴）；界面上这种组只有一张卡时并进「其他」。
- 11/12 实测：本机 10 个活会话全对（FretFlow 5、总控台 3、学习 2）；最近 72 小时的 23 份对话记录抽看全对，语音错字也认对了。
- 界面：
  - 墙：两个以上项目有看得见的卡时（`body.cols`），每个项目一块，并排；块头写显示名 + 这一筛选下的张数，块里的卡各自上下滚，页面本身不滚，所以每个项目打开就都在第一屏（按行分组被否掉的原因：后面的项目被挤出屏幕）。
  - 一屏的格子数和平铺一样（宽屏横向 4 格，「8 格」2 行、「12 格」3 行）。横向的格子按卡数分给各个展开的项目（`lanes()`：先比一屏露出几张，再比和卡数成不成比例，再让排在前面的项目多露几张），每个项目至少 1 格；块里按自己的格数横着排满再往下（`.gbody` 是 `--k` 列的格子）。所以卡片大小和平铺一样，一屏照样放 8 张。17:3x 他看了「一个项目一列」那版：「还是只有 4 个，效率很低」。
  - 块与块之间的间距是卡片间距的两倍，靠块头和间距分开项目，不加边框和底色。每块底下留 28px 露出下一行的边，提示还能往下滚。展开的项目最多和横向格子一样多，多出来的、卡最少的并进「其他」（`setGroups()`）。
  - 收起（他 16:5x：「我不学的时候就可以把它折叠起来」）：块头右边的按钮把这一块收成 44px 的竖条，竖着写项目名和张数；有要你动手的亮琥珀点，有交付等你看的亮青点。腾出来的格子分给别的项目。点整条展开。收起记在本机 localStorage 的 `ccb_fold`（项目 key 的数组），重开还在；顶栏和 Dock 的计数照常包括收起的。封面里收起的项目不进轮播，底下的点后面写着「项目名 张数」，点了展开并跳到那组第一张。全都收起时等于没收。列宽变化走 `grid-template-columns` 的过渡。
  - 列里的 `.gbody` 关了滚动锚定（`overflow-anchor:none`）：开着时卡片一张张插进列里，浏览器会把列滚到中间，最前面那几张（停住了的）反而看不见。
  - 筛选后只剩一个项目有卡，回到平铺的格子，不留空列。手机宽度（≤700px）各列叠成一列往下排，页面滚。
  - 动画：卡片换位置、换列时从旧位置滑过去，新出现的淡入，新列淡入（`gcol-in`）。用 Web Animations（`flipFrom()`），放在 `layout()` 之后跑：`layout()` 在墙上每次都清卡片的内联样式，11/12 之前用内联 transform 做的 FLIP 因此从没真动起来过。减少动态效果的系统设置打开时不动。
  - 封面：`order` 按组排。组的先后 = 组里排最前那张的位置，组内顺序不变，所以最前面那张（最要你处理的）和不分组时一样。底下的点按组隔开，组名是按钮，点了跳到那组第一张；卡片左上角 `.proj` 写项目名（墙上不写，组头已经写了）。
  - 只有一个组时什么都不显示（`body` 没有 `.grouped`）。正在墙上打字时排序冻结（沿用上一次的 `order`，新来的卡放到它那一列最后），打字的那张也不挪（挪动 DOM 会让输入框失焦）。
- 没做的：认错了不能手动改组；Codex 会话只走过代码路径（`p.arguments` 里的路径），没拿真 Codex 会话验过。

## 正文里的本机路径能点（11/12 khalil-96）

Khalil 11/12 18:30：「以后你把这些资料直接把链接给我，我可以直接点进去」（经总设计师转来）。

- 认这几种写法（`ui.html` 的 `inline()`）：
  - 直接写的 `~/…` 或 `/Users/<名>/…`，遇到空格、中文标点（，。、；）」等）就断，结尾的英文标点还给正文。带空格的路径要放进反引号，或写成 `file://`。
  - 反引号里整段是路径（`~/`、`/Users/`、`/private/`、`/tmp/`、`/Volumes/` 开头），可以带空格和中文。
  - `file:///…` 或 `file://localhost/…`，百分号编码，直接贴或写成 `[文字](file:///…)` 都行。
  - `[文字](~/…)`、`[文字](/…)`、`[文字](<带空格的路径>)`。
- 点了交给服务的 `/api/open`，由服务决定（`openAction()`，按符号链接的真身判断）：普通文件夹在访达里打开；网页、图、音视频、PDF、文档、文本用默认程序打开；能执行的（`.app`、`.command`、`.sh`、`.py`…）、带扩展名的文件夹（程序包）、认不出的，只在访达里选中，界面提示一句。路径是模型写的，所以用白名单，不用黑名单。
- 只接受带口令的请求，`Origin` 不是 `http://127.0.0.1:<端口>` 的拒绝（403）。试验场里只写 `open … dry:<动作> <路径>` 日志，不真打开。
- `/api/reveal`（只在访达里选中）留着，界面已经不用它了。

## 内置预览（11/15 khalil-6d）

Khalil 11/15：「点击那个 HTML 的时候，我们还要到浏览器里。我想给我们这个总控台做一个内置的预览功能，这样就能更快速，不用点出去了。」14:2x 又扩到所有类型：「访达里的这种文件预览，也直接在我们的 APP 里打开……MP4 文件啊，还有 PDF 什么的，都会弹出去」。

- 类型表是 `preview.mjs` 的 `KIND`（唯一出处）：`page`（html、htm）、`pdf`、`image`（含 heic、tiff、svg）、`video`（mp4、mov、m4v、webm）、`audio`、`markdown`（md）、`text`（txt、json、csv、log、yaml、xml 和常见代码）。不在表里的（Word、Excel、Keynote、.app、文件夹）回 `reason: 'no-preview'`，界面改走 `/api/open`，和以前一样交给系统。
- 界面按类型显示（`openPreview()`）：网页、PDF 进 iframe；图、音视频用总控台自己的 `<img>` / `<video>` / `<audio>`（焦点不进 iframe，Esc 照样关；视频带控制条、不自动播放）；文本、Markdown 由 `register()` 直接把内容（最多 1 MiB，超了标 `truncated`）放进 `/api/preview` 的应答，界面用 `md()` 或 `<pre>` 排版，内容一律转义。
- 点击规则：以 `/` 结尾的路径（文件夹）和 ⌘ 点直接 `/api/open`；其余先问 `/api/preview`，除了 `not-ready` 之外的失败（`no-preview`、`missing`）都交给 `/api/open`，错误提示由它报，和以前一样。

- 网页的流程：界面调 `POST /api/preview`；服务交给 `preview.mjs` 的 `register()`，回一个网址 `http://127.0.0.1:<主端口+1000>/<32 位随机编号>/<文件名>`。界面用几乎占满窗口的 `<dialog id="preview">` 里的 iframe 打开它。⌘ 点、顶栏「在浏览器打开」照旧走 `/api/open`。服务回 `reason: 'not-page'`（叫 x.html 的文件夹之类）时界面改走 `/api/open`。
- 为什么另起一个端口：预览页是另一个源。页面里的脚本读不到总控台页面、口令和 localStorage；`/api/*` 要口令，`/api/open`、`/api/preview` 还查 `Origin`（`fromBoard()`），预览端口的 Origin 也算外人。没用 `<iframe sandbox>`：空源里 `localStorage` 一碰就抛错，讲解页、复习包这类页面会整段脚本停掉。
- 编号就是钥匙。一个编号只开那个 HTML 所在的文件夹（按符号链接的真身）。只发 `MIME` 表里的类型；路径里有空段、`..`、点开头的段（`.git`、`.env`）一律 404；符号链接指到文件夹外面 404；文件夹本身不列目录。页面就在主目录或更上层（`/tmp` 这种顶层）时只发同一层的文件。同一个文件再点，编号不变；最多记 64 个，服务重启后全部作废（界面每次点都重新要）。
- 响应头：`referrer-policy: no-referrer`（去外网取东西时不带出编号）、`cache-control: no-store`（改了文件点「重新载入」就是新的）。音视频按 `Range` 回 206：WebKit 的 `<video>` / `<audio>` 不回 206 就不播。预览端口查 `Host`（挡 DNS 重绑定），只认 GET / HEAD。
- 端口：`CCBOARD_PREVIEW_PORT`，默认主端口 + 1000（真实例 5747，测试 5761、改坏版 5770+）。被占就让系统给一个空闲端口，日志里有 `preview … port … busy`。
- 关掉弹层时 `clearPreview()`：iframe 换成 `about:blank`，音视频 `pause()` 并清掉源，图和文本清空。页面里、视频里的声音不在背后接着放。
- 焦点在预览页里时按键到不了总控台（两个源），所以预览端口发 HTML 时在最后一个 `</body>` 前加一小段脚本（`ESC_HOOK`，磁盘上的文件不动）：页面自己没 `preventDefault` 的 Esc 用 `postMessage({ccb:'preview-esc'})` 发给父页面；界面只认 `e.source === #pFrame.contentWindow` 的这条消息才关。页面自己要用 Esc（关它自己的弹窗）时先拦下，就不关预览。HTML 因此整份发、不按段（`content-length` 是加过脚本的长度）。页面的 CSP 不许内联脚本时这段不生效，退回点 ×。（11/15 Khalil：「焦点在预览页里面的时候 Esc 关不掉……别让我每次都去点 ×」）
- 外壳（main.swift）只放行 `127.0.0.1` 的 http 导航，所以预览网址必须写 `127.0.0.1`，不能写 `localhost`（会被交给默认浏览器）。预览页里点外网链接、`target=_blank` 一样交给默认浏览器。
- 没验到的：真应用窗口（WebKit）里只有我用测试推断的行为，测试跑的是 Chromium（无头 Chromium 放不了 H.264、看不了 HEIC，所以测试只核元素和网址，不核播放）；PDF 进的是 WebKit 自带的阅读器，点进 PDF 里面以后 Esc 能不能关没验过，PDF 不是网页，加不了 Esc 脚本；页面里嵌外网 iframe（YouTube 之类）时，外壳的导航策略会把它交给默认浏览器，预览里那一块是空的。

## 放大看、归档（11/13 khalil-96）

- 放大看：⌘O、双击卡片上半截的封面（状态、标题、结论、要你做的事、你说的话）、右上角 ⤢，三条路都走 `zoomCard()` → `openDetail()`（干净的对话大窗口）。收回：再按 ⌘O、Esc、点窗口外面、双击大窗口的标题栏或空白处。
  - ⌘O 放大哪一张（`zoomTarget()`）：正在哪张卡里打字就那张；否则鼠标停着的那张（`hoverId`）；封面里鼠标不在卡上时是最前面那张。外壳的菜单里没有 ⌘O，所以按键能到网页，不用重新编译。
  - 双击正文、回话框照旧是选词；大窗口里双击后选中了字就不收回。单击标题和「你说的」不再打开大窗口：第一下打开、第二下会落在窗口外面又把它关上，和双击打架。
- 归档（他 11/13：「我就直接点一个归档，你就自己觉得该删的删，该记下来的记下来」）：卡片右上角一个「归档」按钮，「⋯」菜单拿掉了。服务的 `tidyVerdict()` 定删还是留：
  - 删：一句话都没说过；或者没改过文件（Edit / Write / apply_patch 一次都没有）、工具用了不到 4 次、他只说过一两句。删 = 停掉会话，对话挪进 `deleted/` 放 30 天，`archive.json` 的 `dropped` 里留一行（标题、为什么删、记下的那一笔），归档列表下半截「自动删掉的」里能看到。
  - 留：其余的，和在等他决定的（待跟进）。照旧停掉、对话留在原处、能恢复，`note` 记下项目、最后那句结论、要他做的事、动过的文件夹，归档列表里直接显示。
  - 两种都先等 8 秒（`GRACE`），提示条上能撤销。计数（`nHuman`、`nTools`、`nEdits`）来自服务读进来的那一段对话记录（最近 4 MB 起），长会话照样算「做了很多事」。
  - 归档列表里每一行还能手动「删除」。
- 英文界面里，服务给的归档原因（`tidyVerdict` / `tidyDue` 的 `why`，带数字、用「，」连着几段）经 `ui.html` 的 `trWhy()` 一段一段翻；固定原因自己带「，」的先试相邻两段合起来。服务端新增或改动原因句式时，要在 `RULES` 里加对应的规则，`test/ui-check.mjs` 有一条按真实句式逐句核没有漏翻（11/15 khalil-be 报的「改过 1 次文件」原样露出）。

## 输入框上的预判（11/13 khalil-90）

Khalil 11/13 16:10：「原生 Claude Code 里有那个 Tab，它会预判我们下一步要干什么……Claude Code 有一次会给我预判 1、2、3 选项……也要在我们这个输入框里加入」。

- 两样东西：
  - 灰字：输入框空着时 Claude Code 显示的一句建议，Tab 收下。屏幕上是输入行 `❯` 后面的暗色字（SGR 2）。
  - 「下一步 1/2/3」：next-steps 类插件（`next-steps@claude-community` 或它的改写版）画在输入框上边框之上的三条。每轮结束后它 fork 一次会话，让模型写最多 3 条 `{label, prompt}`；按数字键把 prompt 填进输入框，0 关闭；第 1 条的 prompt 同时是灰字。屏幕上只有标签行 `n: 标签`，以 `0:` 行收尾。
- 数据只能从屏幕读。两样都不写进对话记录（11/13 拿两条真实建议在本机所有对话记录里 grep 过，一条都没有）。`suggestLoop()` 每 2.5 秒（`CCBOARD_SUGGEST_MS`）对「tmux 里的 Claude 会话、状态 idle 或 shell（放到后台的命令还在跑，终端里照样能回话）、交付过一轮」跑一次 `capture-pane -p -e`（只读，不碰输入框，不调模型），交给 `suggest.mjs` 的 `parseSuggest()`。结果放在会话的 `suggest` 字段：`{ ghost, options: [{ n, label }] }`；`withSuggest()` 只在状态仍是 idle / shell 时带上（刚转忙的那一两秒不带）。
- 认输入框靠结构，不靠字面：屏幕最下面两条边框（`─` 连成的线）夹住、第一行以 `❯` 开头的那段。三条靠「边框上面 3 行以内有一行 `0: …`，往上连着 `1:`（`2:` `3:`）」；`0:` 后面写什么字都行。屏幕上有 `Enter to confirm / select` 提示行就不认（那是选择框）。
- 灰字和他自己打的字靠颜色分：整段都是暗色才算灰字，有正常颜色的字 = 他在终端里打的，不当建议。真彩色 `38;2;r;g;b` 里的 `2` 不是暗色，解析时跳过。新会话空输入框里的 `Try "…"` 示例也是暗色字，认出来丢掉。
- 模型写的字先过 `clean()`：去掉控制字符、零宽和方向字符；带 Unicode tag 字符（U+E0000–E007F，只能用来藏指令）的整条不要；灰字最长 600 字，标签 80 字；三条里有一条不干净就整组不要（数字键要和位置对得上）。
- 界面（ui.html）：
  - 灰字盖在空输入框上（`.ghost`，单行、截省略号，右边一个 `Tab` 键帽）。框里有字或有附件就隐藏；灰字显示时输入框自己的提示字变透明。框里空着按 Tab 收下整句（`fillDraft()`）；框里有字时 Tab 不动它。
  - 三条在输入框上面（`.sg` / `.chip`）。点一条，或没在打字时按数字键（作用在 `zoomTarget()` 那张）：填进输入框、光标进框，**不会自己发出去**，改完回车才发。在输入框里打字时数字就是数字（中文输入法要拿它选字）。
  - 第 1 条填灰字的完整句子（终端里按 1 和按 Tab 是同一句；11/13 拿 5 个真会话核过，标签和灰字对得上）。第 2、3 条屏幕上只有标签，填标签。要拿到它们的完整 prompt，得让插件自己多存一份，总控台这边读不到。
  - 只给空闲、能回话的卡；刚回车发出去的 8 秒内不给；封面里旁边的卡（`.side`）和输入框一起淡掉。
- 没做的：开在 Ghostty 标签里的会话（不是 tmux）读不到屏幕，没有预判；Codex 没有。

## 自动收工（11/13 khalil-42）

Khalil 11/13 16:10 的原话：「有一些 Tab 我打完我就懒得关……能不能在总控台里加入这个功能：自动去分析当前窗口结束了没，OK 你关掉。关掉的话应该带有记忆性，你要去判断是可以删除，还是要保留记忆」。

- 开关：config.json 的 `autoTidy`（仓库默认 `false`，作者本机打开）。关着时 `watchTidy()` 什么都不做。
- 「删还是留」不新写：`watchTidy()` 调 `archiveSession(sid, false, 理由)`，和手点「归档」同一套（`tidyVerdict` 定删留、`tidyNote` 记笔记、停进程、关 Ghostty 标签、先等 8 秒）。归档记录多一个 `auto: true`，`why` 前面加收工的理由（如「你点过「审完了」，改过 3 次文件」）。
- 「结束了没」由 `tidyDue()` 判断。先要满足：状态 idle、这一轮已收尾且有交付（`done`）、没有 `alert`、没有 `ask`。再看三条线：

| 线 | 条件 | 常量（环境变量覆盖） |
|---|---|---|
| fast | 待审阅，他点过「审完了」，之后它再安静 10 分钟 | `TIDY_FAST_MS`（`CCBOARD_TIDY_FAST_MS`） |
| fyi | 无需处理的交付（回给别的窗口的、过程汇报），24 小时没人理 | `TIDY_FYI_MS` |
| review | 待审阅，一直没点「审完了」，24 小时 | `TIDY_REVIEW_MS` |

  「安静」从交付时间、最后一条对话记录、登记里的状态时间三者里最晚的那个算起。
- 绝不收：在跑、等你选、停住了（有 alert）、待跟进（含他点了「先放着」的）、它说后台还在跑、这一轮没收尾、还没交付过。多留一个标签是他现在的状态；误关一个还在等他的窗口才是事故，所以拿不准就不收。
- 他正看着总控台时不收（`uiFocusAt` 6 秒内）：卡片不在他眼前消失，等他离开再收。收了以后界面弹一条「自动收工：留了 N 个，删了 M 个（…）」，日志写 `tidy <时间> keep|drop|fail <会话 id 前 8 位> <线> <理由>`。
- 「审完了」是界面的 `ccb_done`（localStorage）。界面用 `syncDone()` 告诉 `POST /api/processed`：点的时候发 `map`（新增），撤销的时候发 `clear`，页面第一次轮询成功之后把 `ccb_done` 全发一遍。服务只增不整份替换：原生窗口和浏览器页同时开着，后开的空页面不会清掉别人的标记。服务只存内存（`processed`），每次扫描清掉已经不在墙上的会话。服务重启而页面没重载时，fast 线暂时不认人，fyi 和 review 两条线不受影响。服务只认「那一次交付」的标记：记的时间和会话现在的 `resultAt` 对不上就不算。
- 只读预览（`CCBOARD_READONLY=1`）只在日志里写 `tidy … dry …`，不归档、不停进程。上线前先这样预览一遍，看它会收哪几个。
- fyi 线的长度：11/13 拿真实会话预览，墙上 21 个窗口里 8 个是 fyi，全是 FretFlow 的总设计师、总调度、界面线、识谱线、音色这类长期项目的负责窗口。它们大多在回别的窗口，交付总被归成 fyi。12 小时的线会让他睡一觉就收掉这些协调窗口，所以当时定 48 小时。11/15 Khalil 问「过期的窗口自动处理实现了没有」：两天前的 5 个 fyi 窗口（43–44.5 小时）还挂在墙上，11 次自动收工全走快线（要他点「审完了」）。改成 24 小时：仍跨过一整夜；被收的协调窗口是「留着」，能从「归档」接回来。
- 临时目录（11/15 khalil-2b）：Claude Code 给每个会话一个 `/tmp/claude-<uid>/<工作目录编码>/<会话号>/`（scratchpad、后台命令输出、贴进来的图）。会话归档后没人管它，11/15 已归档的 23 个会话共 2.5 GB。`purgeSessionTmp(sid)` 清它：删掉的会话（`dropArchived`、归档列表里手动「删除」的 `deleteSession`）当场清；留着的归档满 `KEEP_TMP_MS`（3 天，`CCBOARD_KEEP_TMP_MS`）由 `purgeDeleted()` 清（启动时一次、之后每 12 小时）。三道闸：名字是会话号（`SID_RE`：只有字母、数字、- 和 _，拼不出上一层）；`sidAlive()` 说进程还在就不碰（服务刚起时 `allSessions` 还是空的，所以直接读会话登记）；真目录才删，链接不跟。别的窗口放在 `/tmp/claude-<uid>/` 根下的沙盒和 worktree 名字不是会话号，碰不到。日志写 `tmp <时间> <会话 id 前 8 位> 清掉临时目录 N 个`。试验场默认指向假主目录里的 `.claude-tmp`，测试用 `CCBOARD_CLAUDE_TMP`。不清的：没经过归档就关掉的会话（他在终端里 /exit 的）；会话自己用 nohup 起的后台进程。
- 没做的：收之前不问；归档列表里还没有「自动」标记（`/api/archive` 已返回 `auto`）。没验过：长期不关的协调窗口被 fyi 线收掉以后，别的窗口发给它的消息收不到，要先从「归档」接回来。11/13 Ghostty 被误退出后接回的窗口，名字全变了（khalil-46 变成 khalil-6c），所以靠窗口名找人本来就不稳。
- 11/13 16:3x 预览结果：本机 21 个窗口，一个都不会收（刚接回来，都在 2 小时内动过）。这只证明没有误收；「该收的会收」靠测试。

## 订阅额度（11/15 khalil-ee）

Khalil 11/15 11:00 的原话：「给我们总后台加入一个各个账号的 Token 使用情况，放在右上角……Codex 的订阅，还有 Claude Code 的订阅，这个 weekly limit 放在右上角提醒我」。当天他的 Claude 旧号周额度用完，又买了一个新的 $200 号（命令行钥匙串 10:43 起登的是新号），两个号轮着用，所以要一眼看到各自还剩多少。

- 顶栏「归档」左边一排灰色胶囊：`Claude · amy 91%`、`Claude · ben 1%`、`Codex 34%`。胶囊上是周额度的已用百分比（只有 5 小时窗口时前面写 `5h`）；鼠标停上去看每个窗口的已用、几点重置、还剩多久、数据多久前的。任何一个窗口 ≥ 85%（`WARN_AT`）胶囊变琥珀。灰、琥珀两档，不加别的颜色：颜色只给状态。
- 数据在 `/api/state` 的 `limits`：`{ claude: [条目], codex: 条目 | null }`，条目是 `{ id, provider, account, plan, at, windows: [{ key: five_hour | week | other, used, resetsAt(毫秒) }] }`。`limitsLoop()` 每 30 秒（`CCBOARD_LIMITS_MS`）让 limits.mjs 读一遍。汇总全在 limits.mjs，界面只收结果。
- **Codex**：读 `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl` 里最后一条 `token_count` 事件的 `rate_limits`。11/15 实测：`limit_id: codex`、`plan_type: prolite`、只有一个 10080 分钟窗口、`secondary` 是 null。按文件修改时间取最近 8 个文件（续跑的老会话记录在老日期的目录里），每个只读最后 256 KB，没变的文件不重读。只在 config.json 的 `codex` 打开时读和显示（和「交给谁」同一个开关）。这份数据只在 Codex 说话时更新，提示里的「更新于」就是为这个。
- **Claude Code**：本地没有现成数据（11/15 查过）。对话记录里只在「额度被拒」那条错误上带 `resetsAt`，没有百分比；命令行没有查用量的子命令。Claude Code 只在状态栏命令的 stdin JSON 里给 `rate_limits.five_hour / seven_day`（`used_percentage`、`resets_at` 秒；官方文档写明只有 Pro / Max / Ultra 订阅有，第一次 API 回复之后才出现）。所以挂一个状态栏命令 `statusline-tap.mjs`：只存 `rate_limits` 的两个窗口（不存路径、模型、对话），一个会话一个文件 `<数据目录>/limits/claude-<session_id>.json`（0600），10 秒内同样的数据不重写，终端里顺手打一行 `ben · 5h 6% · 7d 1%`。不读钥匙串，不联网，不用任何登录凭据。取数文件 14 天没动清掉（每 12 小时一次）。
- 不用的办法：`claude -p … --output-format stream-json` 的 `rate_limit_event` 带 `unifiedWindows.*.utilization`，能拿到数，但每次要发一次模型调用，花的正是要看的额度，还会触发全局 hook（11/15 11:07 我的探针被群聊 hook 记成「Khalil 说的话」，#11449），所以不能当轮询用。`/api/oauth/usage` 要读钥匙串里的登录令牌，不用。
- 账号怎么分：同一个号所有会话的周窗口截止时间相同，所以没标账号的数据按它分组（到分钟）。会话环境里设了 `CCBOARD_ACCOUNT=<id>`（khalil-bd 做「新任务选账号」时，启动器设它），tap 就把它写进取数文件，条目 `account` 带上，并把同截止时间的无标数据认给它。条目的 `name` 由 server.mjs 按 config.json 的 `accounts` 把 id 换成登记的名字（和新任务的账号下拉同名），没登记的 id 原样写；顶栏写 `name`。没有 `account` 又有两个以上 Claude 号时，名字后面写周窗口重置的星期几。默认登录开的窗口不带 `CCBOARD_ACCOUNT`，要靠同一个号有一个选账号开的窗口说过话，才按周截止时间认领到名字。账号标记只认 `[\w.@-]{1,40}`，会进文件和界面。
- 窗口过了 `resets_at` 就丢（Claude Code 自己的状态栏也这样）。Codex 的窗口过了，条目留着、窗口空，胶囊显示 `—`；Claude 没有任何数据时显示灰色的「Claude —」，提示里写怎么接入。
- 窄屏：≤ 1180 px 去掉进度条和账号后缀，≤ 1000 px 整条隐藏（顶栏在 900 px 时放不下，「新任务」会被挤出视口，11/15 实测）。进度条的类叫 `.mtr`，不要叫 `.bar`：`.bar` 是顶栏自己的类（`position:fixed`），11/15 起初起了这个名字，进度条被钉到屏幕顶上，ui-check 有断言守着。
- 状态栏挂载（要改 `~/.claude/settings.json`，所有窗口立刻生效）：`"statusLine": {"type": "command", "command": "node \"$HOME/Library/Application Support/cc-board/app/statusline-tap.mjs\""}`。11/15 在隔离的 tmux 里对照试过：挂了以后输入框下方多一行，底下的 `bypass permissions on` 还在，上下两条边框没变，所以 suggest.mjs 认输入框不受影响。官方文档写明自定义状态栏会去掉 `esc to interrupt` 这类键盘提示，这一点没有在忙的会话里试过。
- 测试：limits.test.mjs 37 项（含端到端跑一遍 tap 脚本）；state.test.mjs 的 [7f] 5 项和 [8] 1 项；ui-check.mjs 的「顶栏 · 订阅额度」19 项；mutants.mjs 两个（`limits-codex-ungated`、`limits-not-in-state`）。界面几条断言的改坏对照是手动跑的，在工程目录的拷贝里改 ui.html 后跑 `--ui` + ui-check：进度条改回 `.bar`、琥珀线去掉、英文「Updated」不翻、两条窄屏规则各去掉，每个都变红。
- 没做的：Claude 的套餐名拿不到（状态栏 JSON 不带），`plan` 一直是 null；没有显示「这个窗口现在挂在哪个账号」；没拿两个真实 Claude 号同时在线验过（只用夹具）；Codex 要等它自己说话才更新。

## 提醒走三条路

1. 卡片：右上角的药丸，排到最前面（只在「等你选」之后）。
2. 顶栏「停住了 N」、窗口标题、Dock 角标。点过「先不管」的不计数。
3. 系统通知：只在总控台不在前台时发（界面轮询带 `?f=1` 表示你正看着）。几个窗口一起停合成一条。启动后的第一轮只记账不发。被打断不发。

## 新任务

- 不问放哪个文件夹（Khalil 11/12 14:09：「我也懒得去管……你就应该自己很聪明的去找应该在哪个项目文件夹」）。界面上没有这一格。
- 会话一律开在主目录。他所有窗口都开在这里：共用的记忆（`~/.claude/projects/-Users-khalil/memory/`）和规矩只有在这里才读得到，新会话靠它们才找得对项目。
- 服务在任务后面附一段 `FOLDER_NOTE`（包在 `<system-reminder>` 里）：自己找对应的项目文件夹，全新的东西在 `~/Projects` 下新建，不要问。`cleanPrompt()` 会滤掉它，卡片上只显示他说的话。空会话和接口上明确给了文件夹的不附。
- 模型是下拉菜单（默认 / Fable / Opus / Sonnet / Haiku）。不要改回带输入建议的输入框：里面有字时建议只剩匹配项，他会以为只有一个模型。

### 新窗口的模型和强度：开窗口的一方只说档位（11/15 khalil-73 [c3e3d5]）

Khalil 11/15 11:37 的原话：「我的总指挥用的是 Fable，如果它新开一个窗口也是默认 Fable，那就很亏……我希望它可以自动调节所用的模型。还有 effort」。

- 现状（先查清再动手）：总指挥窗口开窗口走 `POST /api/new`，模型和强度是它**每次手写的一对值**。11/15 它开的三条线是界面 opus/high、识谱 fable/high、图片转谱 opus/high，没有共用的标准，也没有兜底。不传 `model` 时窗口用 `~/.claude/settings.json` 的默认（opus + xhigh），**不是 Fable**。「默认 Fable」真会发生的地方是子 agent 和 workflow：它们默认继承父窗口的模型（11/10 三个 workflow 各继承 Fable + max，约 480 万 token）。
- 11/14 00:00 起本机的实测（`usage_by_model` 那类脚本，加权单位，分不出各模型在额度里的折算）：Opus 73.7%、Sonnet 19.2%、Fable 6.7%。最大头是两个纯 Opus 窗口，各约 20%。所以模型只是一个杠杆，另一个是上下文大小（每走一步重读一遍）。
- 做法：`route.mjs` 的 `routeNew()` 是唯一决策点。调用方在 `/api/new` 里加 `tier`，服务翻成 `--model` / `--effort`。档位表在 `route.mjs` 顶上，换模型只改那一张表：

| tier | Claude Code | Codex | 用在 |
|---|---|---|---|
| `heavy` | fable + high | high | 设计判断、算法难点、没有现成答案的调查、审修复本身 |
| `standard` | opus + high | medium | 写代码、改界面、补测试、合入补丁、验收别人的交付、接手一条线 |
| `light` | sonnet + medium | low | 读文件做汇总、盘点状态、照写死的步骤跑一遍并报结果、改文案 |

- 规则：
  - 显式给的 `model` / `effort` 压过档位，没给的那一半才用档位的（`tier: light, effort: xhigh` → sonnet + xhigh）。
  - 不声明 `tier` = 和以前一样：没传的不带参数，沿用 settings.json。界面「新任务 → 默认」走这条。
  - 写错的 `tier`（含 `__proto__`、`constructor` 这类原型上的名字、非字符串）直接报错，不开窗口：悄悄退回默认，调用方会以为已经省了钱。
  - 档位不给 xhigh / max。最贵的两档要调用方显式传 `effort`。
  - Codex 的档位只管强度，模型留给它自己的 `config.toml`。
  - 账号（`account`，见「选账号」）是另一维，和档位互不影响，一起传也行；`routeNew()` 不看账号。
  - 声明了档位的，应答多一个 `route: { tier, model, effort, why }`，服务日志记一行 `route <时间> <窗口> <档位> <谁> <模型> <强度>`。
- 不做的：
  - 不从任务文字里猜档位。「设计」在「界面设计」里天天出现，猜错一次就把 Fable 开给机械活。升档要调用方声明，调用方是 LLM，它知道这活是什么。
  - 不做 config.json 的覆盖（没有第二个使用者；档位表就在 `route.mjs` 顶上）。
  - 不改界面「新任务」的下拉：11/15 `ui.html` 在 khalil-5d 做改版。要在界面上加「档位」，等它落地后再做。
- 调用示例（口令在数据目录的 `.token`，头名 `x-ccboard`）：

```bash
TOKEN=$(cat ~/Library/Application\ Support/cc-board/.token)
/usr/bin/curl -s -X POST http://127.0.0.1:4747/api/new -H "x-ccboard: $TOKEN" -H 'content-type: application/json' \
  -d '{"prompt":"…","cwd":"~","provider":"claude","tier":"light","project":{"key":"fretflow","name":"FretFlow"}}'
```

- 测试：`route.test.mjs` 52 项和它自己的 13 个改坏版；`state.test.mjs` 的 [7g] 9 项（假 claude 记下收到的 argv，断言 `--model` / `--effort`）；`mutants.mjs` 里 4 个接线改坏版（11/15 在并入选账号之前的拷贝上各抓到 1 次，并入之后只重跑了基线 136 项和它们原文的校验）。没验的：Codex 档位只测了翻译，没真开 Codex 会话；总指挥还没真用过。
- 子 agent（Agent 工具、Workflow）不经过这里，服务管不到。对应办法：开子 agent 时按同一张表传 `model`（`heavy` = fable、`standard` = opus、`light` = sonnet）。Agent 工具的 `effort` 参数写着「只在用户或 CLAUDE.md 明说时才设」，所以这条规矩要写进 CLAUDE.md 才算授权。`CLAUDE_CODE_SUBAGENT_MODEL` 环境变量能给所有子 agent 定一个固定默认（11/15 在 claude 二进制里搜到这个变量名，没试过效果，没设）；它不分任务，不替代档位。

### 选账号（11/15 khalil-bd）

Khalil 11/15：旧号周额度用完、买了新号以后，「你把总后台恢复一下，现在是加入可以选账号的功能」。

- Claude Code 的登录全机只有一份（钥匙串的 `Claude Code-credentials`），所有窗口共用；会话起来时读一次，之后不再读。所以 10:43 换登录以后，新开的都是新号，之前开着的老窗口还是旧号。
- 换号只换登录：给这一个会话设 `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token` 生成的长期 token）。11/15 实测：设了以后 `claude auth status` 的 `authMethod` 是 `oauth_token`，`configDirectory` 照旧是 `~/.claude`，钥匙串的修改时间不变。不用另开 `CLAUDE_CONFIG_DIR`：那会把记忆、对话记录也拆成两份。
- token 只在钥匙串里（service `ccboard-account-<id>`）。tmux 起的是 `/bin/zsh -fc <脚本> ccboard <security 路径> <service> <id> claude …`，脚本在会话里读钥匙串、设好两个变量再 `exec`；token 不进命令行参数、config.json、服务日志和 /api/state（`state.test.mjs` [7a] 断言后三样）。读不到就在屏幕上说原因，2 分钟后退出。
- 服务每 30 秒用 `security find-generic-password -s <service>`（不带 `-w`，不取值、不弹窗）看每个号在钥匙串里有没有 token，结果放在 `providers.claude.accounts` 的 `ready`；`login` 是 `~/.claude.json` 邮箱的前 3 个字符，界面写成「默认（当前登录 ben…）」。
- `/api/new` 的 `account`：空 = 默认，不包这一层；没登记的号、没有 token 的号直接报错，不开。Codex 忽略它。恢复（`unarchive`）照旧用默认号。
- `CCBOARD_ACCOUNT` 是顶栏额度条按号分组用的名字（statusline-tap.mjs），所以 id 也要满足它的 `[\w.@-]{1,40}`。
- 加一个号：`claude setup-token`（浏览器里登那个号）→ `security add-generic-password -U -a "$USER" -s ccboard-account-<id> -w`（在提示里贴 token）→ config.json 的 `accounts` 加一项 → `./build.sh update`。
- 测试用 `CCBOARD_SECURITY` 换成假的 security，真钥匙串碰不到。

### 列头的「＋ 新任务」（11/13 khalil-73）

Khalil 11/13 的原话：「在每一个主题下面再放一个新任务，在这个主题下面加一个新任务」。

- 墙上每个展开的列头都有「＋ 新任务」，在「收起」按钮左边，一直看得见（平时灰，指上去才亮）。收起的列和只有一个组的平铺没有它，右上角的照旧在。
- 点了打开同一个新任务弹窗，标题写「新任务 · 项目名」，`goNew` 多传 `project: {key, name}`。「其他」那一列的按钮等于右上角的（`newIn` 是 null）。右上角和 ⌘N 每次都把 `newIn` 清掉，不沿用上一次点的列。
- 服务不信界面传的名字：`pinnable()`（projects.mjs）只放行项目表里的 key（名字取表里的）和「自成一组」的 `dir:<小写文件夹名>`（名字要和 key 对得上、不带空格和尖括号）。核不过的当成右上角开的。
- 核过的：任务后面附 `pinNote()` 代替 `FOLDER_NOTE`（「属于这个项目，在那里做，不要问」）；`pins.json` 记 tmux 名 → 那一列。`classify()` 的 `pin` 给 30 分（`PIN_W`，等于动过 30 次文件），所以还没动过文件的「启动中」卡片就已经在那一列；之后它在别的项目动过的文件要多出 30 次才会被拉走。tmux 里没了这个会话、又开出来超过 1 分钟，就从 `pins.json` 删掉。存文件是因为 `./build.sh update` 会重启服务。

### 开工前的信任框替他点掉（11/13 khalil-73）

Khalil 11/13：「新建的时候还要点一下那个 Trust……我感觉这个多余，直接帮我点了呀」。

- 主目录的信任 Claude Code 不存（`~/.claude.json` 里主目录的 `hasTrustDialogAccepted` 一直是 false），所以总控台开的每个会话都先弹「Accessing workspace … ❯ No, exit / Yes, I trust this folder」，默认光标停在 No。
- 只在 config.json 的 `autoTrust` 是 true 时才替他点（仓库默认关；关着时信任框和别的选择框一样留在「启动中」卡片上）。开在哪个文件夹都点（11/15 改，见下）。
- 11/15 Khalil：「为什么让 Agent 去新建一个窗口的时候，它还是要让我去按 Trust this folder……你可以自动的 Trust」。11/13 那版只在会话开在主目录时点，理由是「别的文件夹可能是别人的仓库」。但 Agent 开窗口走 `/api/new`，几乎都带一个项目或沙盒文件夹的 `cwd`，所以 Agent 开的窗口一个都没点到；当天 14:27 一个开在 `fretflow-sandbox/ui-declutter-ios` 的窗口有 `route` 行、没有 `trust` 行。调 `/api/new` 的是他自己的 Agent，它本来就能在他的机器上跑任意命令，信任框对它不是防线，所以去掉「必须是主目录」这一条。留着的守卫只有一个：选项原文必须正好是 `Yes, I trust this folder`。
- `newSession` 开完 Claude 会话后不等待地跑 `autoTrust(name)`：每 0.4 秒看一次屏幕，最多 60 秒（`CCBOARD_TRUST_MS`）。看到选择框、而且有一项的原文正好是 `Yes, I trust this folder`，就交给 `answerDialog()`（每挪一格都重读屏幕、核对那一项的原文，光标到位才回车）；服务日志记 `trust <时间> <tmux名> yes`。
- 屏幕上是别的选择框就停手，照旧在「启动中」卡片上给他选。到了输入框（`bypass permissions on`、`? for shortcuts`）就停。Codex 不走这条（它的主目录已在 `~/.codex/config.toml` 里信任过）。

## config.json（11/13 khalil-73）

开源之前（khalil-d1 定的设计）：Khalil 自己的项目表、文件夹布局和两个开关从代码里拿出来，放进数据目录里的一个文件。git 历史公开后洗不掉，所以私人的表从来不进仓库。

- 位置：`<数据目录>/config.json`，数据目录是 `CCBOARD_DATA`，默认 `~/Library/Application Support/cc-board`。服务启动时读一次（`CONFIG`），改了要 `./build.sh update` 重启。
- 没有这个文件、不是合法 JSON、某个键的类型不对、正则写错：整份不用，全用默认值，日志里记一行 `config <路径>：…`，服务照常起来。
- 键（都可以不写）：

| 键 | 是什么 | 仓库默认 |
|---|---|---|
| `projects` | `[{ key, name, dir, word }]`。key 小写字母开头、不能是 other；dir、word 是正则的字符串，不分大小写 | `[]`（没登记的 `~/Projects` 文件夹照样按文件夹名自成一组） |
| `neutral` | 正则的字符串：哪些文件夹根不算证据 | `^Projects/shared$` |
| `roots` | 哪些上级文件夹下面的一层算证据，相对主目录写（长的优先，如 `Projects/shared` 和 `Projects` 一起列）。iCloud 云盘根写 `com~apple~CloudDocs`，记成 `iCloud/<名>` | `["Projects", "Desktop"]`（主目录下） |
| `autoTrust` | 总控台开的 Claude 会话（开在哪个文件夹都算），替他点「Yes, I trust this folder」 | `false` |
| `codex` | Codex 会话：新任务里的「交给谁」、开 Codex 会话、读以前起的 Codex 会话和记录 | `false` |
| `accounts` | `[{ id, name }]`：新任务能选的 Claude 号。id 是字母数字开头、40 个字符以内的 `[\w.-]`，不能重复；token 不写在这里，在钥匙串 | `[]`（不显示「账号」） |
| `autoTidy` | 自动收工：已经交付、歇着、没人在等、没人再理的会话，自动「归档」（见上面「自动收工」） | `false` |

- `codex` 关着时：服务的 `providers` 只报 Claude Code，界面不显示「交给谁」；`/api/new` 和恢复都拒绝 Codex；`agents.json` 里以前起的 Codex 会话不上墙、它们的窗格也不当成「启动中」。代码都留着，打开就和以前一样。
- 迁移核对（11/13）：作者本机的 config.json 从迁移前代码里的项目表原样导出，自己的文件夹布局写在它的 `roots` 里，不进仓库。换代码前后拿最近 7 天的 30 份对话记录、15369 次工具调用对比：认出的文件夹和分组 0 处不同；只读预览 15 个活会话，分组也一个不差。

## 样式（11/15 改版「墨线」，khalil-5d）

Khalil 11/15：「我们这个就特别潦草，就跟手搓的一样……他（Raft）的 UI 真的不错，你能不能去学习一下」。做了两个方向的对照（灰阶精修 / 墨线），他选了墨线；12:38 上线 1.5px 实心墨线后他说「有点太过了……弄得淡一点」，又做了浓 / 中 / 淡三档对照，他选了淡。

- 学的是 Raft 设计系统 raft-ui 的规则（`@botiverse/raft-ui`，MIT；公开文档 raft-design.botiverse.build/foundations/*.md），不是 Raft 应用的代码（那是 FSL-1.1，不能抄）。没有引入任何依赖，数值是我们自己的。
- 墨线：卡片、按钮、徽章、分段控件、顶栏底边都用一圈 `--ink` 划边界，不靠阴影和灰底。浓淡全在 token 里：`--ink`（线的颜色，现在是墨色 2 成：浅色 rgba(24,24,27,.2)、深色 rgba(230,230,233,.17)）、`--ink-w`（粗细，1px）、`--badge-line`（徽章描边跟着状态色走的浓度，30%）、`--drop`（封面最前面那张的影子）、`--ink-solid`（主按钮的实心底）。要再调浓淡只改这几个数。描边一律写成 `box-shadow: inset 0 0 0 var(--ink-w) var(--ink)`，不用 `border`：不占布局，卡宽和卡头的容器查询（540 px）不受影响。
- token 都在 `:root`：底分三层 `--bg`（米白纸面）< `--surface` < `--raised`（`--field` 是输入框）；线 `--ink` 加三档 `--hair` < `--hair-2` < `--hair-3`；悬停 / 按下叠一层墨 `--hover` / `--press`，不换底色；字分三档 `--text` > `--text-2` > `--text-3`。圆角 `--r-card` 8、`--r-cover` 10、`--r-ctl` 6、`--r-badge` 4。`--thumb`（黄）只给「你选中的那一项」（视图、筛选、格数）。
- 阴影只有两种：菜单 / 弹窗的软阴影 `--shadow-pop`；封面最前面那张浮起来的影子 `--drop`。提示条是中性深灰 `--hud`。
- 状态徽章 `setMeta()`：「待审阅 · 8 分钟前」拆成 `.mw` 状态词、`.ms` 分隔点、后半句；后半句是时间（`IS_TIME`）用等宽数字 `.mt`，是原因（额度用完）用 `.mr`。textContent 和原句一字不差，测试和读屏照旧。封面的光晕照抄 innerHTML。
- 等宽字体只给纯机器字：计数、列头、`.tick`、`.tag`、kbd、代码。中文时间不用等宽字体（「10 分钟前」的中文落进等宽字体会被拉开），只用 tabular-nums。
- 新加的界面零件照这套写：颜色、线、圆角只引用 token，不写新的颜色值。

## 按状态分列（11/15 khalil-5d）

Khalil 11/15：「再学 Raft 的看板，加按状态分列」。Raft 的任务看板按 Todo / In progress / In review 分列。

- 墙上顶栏多一个「按项目 | 按状态」开关（`#by`，只在墙上显示），记在本机 localStorage 的 `ccb_by`。默认按项目，和以前一样。
- 不另写一套布局：按项目分列的整套机制（`setGroups()` 分组、`lanes()` 分横向格子、列头、收起、换列动画）原样复用，只换「这张卡属于哪一组」这一问。`setGroups()` 里的 `raw()` 在 `groupBy === 'status'` 且在墙上时返回 `laneOf()`，组的 key 是 `s:act` / `s:review` / `s:busy` / `s:calm`，不和项目 key 撞，收起的状态照样记在 `ccb_fold`。
- 四列：要你处理（等你选、停住了、待跟进、进程退出）→ 待审阅 → 运行中（含后台在跑、启动中）→ 无需处理（回给别的窗口的、处理过的、空闲的）。判法和底下那排点的 `dotOf()` 同一套，所以列的先后就是排位。启动中的卡自带 `v`，弹着选择框的算要你处理。
- 按状态时列名已经说了状态，卡左上角的 `.proj` 改写它属于哪个项目（按项目时墙上不写，列头已经写了）。封面不受影响，照旧按项目。

## 上线

```bash
/usr/bin/lsappinfo info -only name "$(/usr/bin/lsappinfo front)" | head -1 | grep -q '"总控台"' && echo 总控台在最前面   # 在最前面时先别换：页面会重新载入，他正在打的字会丢
./build.sh update                                                  # 换界面和服务，应用自己重启服务并重新载入
/usr/bin/curl -s http://127.0.0.1:4747/health                      # 要看到 "sandbox":false
```

输出的第一行形如 `"总控台" ASN:0x0-…: (in front)`，名字在开头的引号里，不是 `"LSDisplayName"="…"`。11/13 15:01 按后一种格式取名字没认出来，总控台开在最前面时换了文件，页面当场重新载入。脚本里用上面这条 `grep`，写完先在总控台开在最前面时跑一次，确认它说「在最前面」。

上线前把装着的那一版拷进 `.rollback/<日期>/`。回滚 = 把那两个文件拷回工程目录再 `./build.sh update`。

## 测试

```bash
node test/projects.test.mjs              # 分组规则 30 项，不到 1 秒；--mutants 跑 6 个改坏版
node test/suggest.test.mjs               # 输入框预判的解析 28 项，不到 1 秒；--mutants 跑 8 个改坏版
node test/limits.test.mjs                # 订阅额度的解析和状态栏取数脚本 37 项，不到 2 秒；--mutants 跑 16 个改坏版
node test/route.test.mjs                 # 新窗口的档位 52 项，不到 1 秒；--mutants 跑 13 个改坏版
node test/state.test.mjs                 # 服务端 156 项，约 200 秒
node test/mutants.mjs                    # 86 个改坏版，每个都必须让上面的测试变红，约 30 分钟；`node test/mutants.mjs 名字,名字` 只跑这几个
node test/state.test.mjs --ui &          # 搭好场景并保持
python3 ~/Projects/shared/fretflow-lock/heavy-lock.py <窗口名> ccboard-ui -- ~/.local/node-v24.21.0-darwin-arm64/bin/node test/ui-check.mjs   # 界面 172 项
```

拿真实会话预览新逻辑：`CCBOARD_PORT=4791 CCBOARD_DATA=<临时目录> CCBOARD_READONLY=1 node server.mjs`。只读模式拒绝所有 POST。

## 规矩

- 不要跑不带参数的 `./build.sh`。重新编译后签名身份会变，Khalil 要重新点「允许控制 Ghostty」。所以尽量不改 `app/main.swift`。
- 测试不碰真实会话：不调真实例的 `/api/send`、`/api/answer`、`/api/archive`、`/api/delete`。状态 `waiting` 的会话里打字会替他乱选。
- 试验场保护是服务自己的默认行为：端口不是 4747、数据目录或主目录不是默认的，就不碰 Ghostty、不发通知。不要加绕过它的开关。
- 界面文字：中文是源，英文在 `ui.html` 的 `/* i18n:start */…/* i18n:end */` 之间。新增中文必须同步加英文，`test/ui-check.mjs` 会查漏翻。
- 界面改了以后，`~/Projects/ccboard-launch-film` 的快照就过期了。那边重出片之前要重新快照并跑核对。
- 设计照 Apple 质感 Playbook：一个强调色（青）加一个「要你处理」的琥珀色；状态 = 符号 + 文字；只有真在跑的东西有持续动画。改样式先改 `:root` 的 token，不在规则里写新的颜色值（见「样式」一节）。
