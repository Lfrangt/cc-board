# app/
> L2 | Parent: ../CLAUDE.md

成员清单

main.swift: 原生外壳。一个 NSWindow 装一个 WKWebView，载入 `http://127.0.0.1:4747/?k=<口令>`。服务没在跑就用 node.swift 找到的 node 起 `~/Library/Application Support/cc-board/app/server.mjs`（公开包在启动那一刻先把包里的代码换进去，见 bundlecode.swift 和 `prepareReleaseCode()`：真换了而旧版服务还在跑，按 /health 报的 pid 停掉它；app/ 归 build.sh 管而且服务在跑时什么都不动），服务退出后 0.6 秒重启并重新载入页面。页面经 `ccb` 消息通道发来三种消息：`badge`（Dock 角标数字）、`drag`、`zoom`，其余类型忽略。菜单的「新会话 / 新任务」调页面的 `window.ccbBlank` / `window.ccbNew`。菜单和提示按系统首选语言出中文或英文（`L()`），应用名取包信息。
node.swift: 找 Node 22 以上的 node（`NodeLookup.find()`）：指定文件 → 三个固定位置 → Homebrew keg → 版本管理器 → 登录 shell，每个候选真跑 `--version`。测试是 `../test/app-shell.test.mjs`。
bundlecode.swift: 公开包（Info.plist 里 `CCBoardSyncCode = true`）起服务前把包里的 `.mjs` / `.html` 换进数据目录的 `app/`（`BundledCode.sync()`）：版本记号对得上而且文件一个不少才算已是这一版；先拷进 `app.incoming/`，齐了整个换上，失败时原样不动；几个实例同时启动用 `.bundle-sync.lock` 排队。测试同上。
Info.plist: 应用的包信息（作者本机的「总控台」）。公开版由 public-info.sh 在暂存的包上改。
public-info.sh: 公开版的包信息：名字 cc-board、包标识 `dev.ccboard.app`、英文的「控制 Ghostty」说明。`../build.sh` 在 `CCBOARD_APP_NAME` 不是「总控台」时调用。
zh-Hans.lproj/InfoPlist.strings: 公开版在中文系统上的「控制 Ghostty」说明。
AppIcon.icns: 图标。

法则

- 编译要把 main.swift、node.swift、bundlecode.swift 一起交给 swiftc（顶层语句只能写在 main.swift）。
- 改了 main.swift 才需要重新编译（`../build.sh` 不带参数）。重新编译后 ad-hoc 签名身份会变，Khalil 要重新授权「控制 Ghostty」。
- 界面和服务的代码放在包外面（`~/Library/Application Support/cc-board/app/`），所以平时只跑 `../build.sh update`。
- 系统通知不走这里：服务用 osascript 发，通知中心里显示的来源是「脚本编辑器」。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
