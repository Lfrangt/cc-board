# test/
> L2 | Parent: ../CLAUDE.md

成员清单

suggest.test.mjs: 输入框预判的解析测试。不起服务，断言 28 项：灰字和他打的字分得开（含真彩色里的 2、中途变回正常色）、折行的灰字接回去（中文不加空格、英文补空格）、`Try "…"` 示例不算、1/2/3 认得出（两条也认、0 行后面写什么都行、隔着空行和右对齐小提示、不从 1 起不认、正文里的编号列表不认、离边框太远不认）、不是输入框一律不认（没有输入框、分隔线之间、选择框提示行、对话里回显的 ❯）、模型写的字（tag 字符整条拒收、零宽字符去掉、一条不干净整组不要、长度上限）。夹具照真实 tmux 屏幕的结构手搭（边框、❯ 加不换行空格、暗色字、蓝色数字键）。`--mutants` 造 8 个改坏的 suggest.mjs，每个都必须让它变红。
projects.test.mjs: 分组规则测试。不起服务，断言 30 项：先测仓库默认（没有 config：空项目表、只认 ~/Projects 和 ~/Desktop、roots 长的优先），再换上 fixture-config.json 测计分（从工具参数里认文件夹、共用测试锁不算、语音错字、标题压过零星的别处文件、没登记的文件夹自成一组、工作目录只看主目录以下、词的边界、config 不合法时旧表不动）。`--mutants` 造 6 个改坏的 projects.mjs，每个都必须让它变红。
fixture-config.json: 通用的示例项目表（FretFlow、总控台、Acme App、Docs Site）和 neutral、roots。projects.test.mjs 直接用；state.test.mjs 起服务前把它加上 autoTrust、codex 两个开关写进假数据目录的 config.json。不放任何人的私人项目。
state.test.mjs: 服务端测试。在假主目录里造 30 个会话（其中 4 个的进程命令行带 claude-fake，归档能真停掉它们）（进程是自己起的 sleep），起一份服务，从 /api/state 和服务日志断言 99 项（含输入框上的预判 8 项：假终端窗格里画屏幕夹具、会话登记成它的进程，断言灰字和三条出现、打字时灰字没了、屏幕清空后字段跟着没有、会话转忙后不给、转成后台在跑（shell）照样给；被安全检查拦了 3 项：Opus 5.5、Fable 5.2 各一条真实原文，上下文过长仍是报错；项目分组 4 项、点开正文路径 4 项、「归档」定删还是留 4 项、列头新任务 9 项、开工前信任框 4 项、Codex 打开 3 项、config 写坏 5 项；含交付摘要 7 项：普通交付、问你选哪个、带问号的条件句、别的窗口开的头、写明不用你、别的窗口开的头但要你决定、它自己写的【待跟进】）。最后一段用一个假的 `claude`（只记下收到的参数和所在文件夹；任务里带 TRUSTME / OTHERDIALOG 时改由 `dialog.mjs` 画一个开工前的选择框，回车后把选中项写进 argv.trust）测新任务：服务的 PATH 里只有它，tmux 在自己的临时目录里，测完 kill-server。服务起之前写 config.json，并放一个总控台起过的 Codex 会话（agents.json + tmux 里一个窗格 + 两行记录；`--ui` 不放，界面测试按卡数断言）。最后一段 [8] 把 config.json 写坏、重起一份服务，测默认值。`--ui` 只搭场景并保持：等「进程退出」那张卡真的出现在 /api/state 里（最多 30 秒）才写 `.tmp/ui-fixture.json`，CI 和 ui-check 都以这个文件为「好了」。端口用 `T_PORT` 改，默认 4761。卡住的阈值在这里调成 3 秒。
mutants.mjs: 测试的反向对照。按字符串精确替换造 44 个改坏的 server.mjs（带名字参数时只跑那几个），各跑一遍 state.test.mjs，每个都必须变红。要替换的原文不唯一时报错。改坏版写在 `.tmp/mutants/`，旁边要拷 projects.mjs 和 suggest.mjs；服务没跑起来的单独报「没跑起来」，不算「没抓到」。
ui-check.mjs: 界面测试。静音无头 Chromium 打开 `--ui` 搭的实例，断言 116 项（含输入框上的预判 22 项：灰字显示和截省略号、Tab 收下、框里有字 Tab 不动、点第 1 / 2 条、没在打字时数字键、打字时数字照常、回车发出去后收起、封面里三条在输入框上面（深 / 浅）、英文提示；被安全检查拦了 2 项：药丸、封面一句、正文里怎么接着做、英文；点开正文路径 3 项；列头「＋ 新任务」中英文 10 项、英文名是 cc-board 1 项、codex 关着时不显示「交给谁」2 项（在浏览器里改 /api/state 的应答）；状态标志、交付、新任务，加按项目分组 19 项：每个项目一块、每块都在第一屏、卡片和平铺一样宽、一屏按 4 × 2 格子露出的张数、筛选后回到平铺、换位置的动画、收起 / 展开、封面里收起的项目、手机宽度；`/api/new` 拦在浏览器里，不真的开会话），截图放 `.tmp/shots/`。浏览器启动器是 `browser.mjs`。
browser.mjs: 静音无头 Chromium 的唯一入口（`playwright-core` + 三个静音参数）。浏览器路径按顺序找：环境变量 `CCBOARD_CHROMIUM`、playwright 自己的缓存、`~/Library/Caches/ms-playwright` 里最新的 headless shell。不碰真实的 Chrome。
.tmp/: 运行时的临时目录。每次运行自己清，留下的只有截图和 fixture。

法则

- 五个脚本都不碰真实的 `~/.claude` 和真实的 tmux。输入框预判那一段用自己的假终端窗格，不读真实会话的屏幕。假主目录让服务自认是试验场。
- 只停自己记下进程号的进程。
- tmux 的临时目录放在 `/tmp/ccb-tmux-*`（短路径），不放进仓库里的 `.tmp`：tmux 的套接字路径不能超过约 104 字节，仓库克隆在深目录里时会整批失败（21 项）。
- 改了 server.mjs 里被 mutants.mjs 引用的那几行，要同步改 mutants.mjs 里的原文。
- 服务用登录 shell（`zsh -lc 'command -v codex'`）找命令，开发机上找得到真的 codex。测 Codex 的 `/api/new` 一律带写坏的模型名，在起进程之前就被拦下；不要让测试真开 Codex 会话。
- 无头浏览器是重活。多个窗口共用一台机器时，外面包一把全机的锁（作者这台机器用 `~/Projects/shared/fretflow-lock/heavy-lock.py`）。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
