# app/
> L2 | Parent: ../CLAUDE.md

成员清单

main.swift: 原生外壳。一个 NSWindow 装一个 WKWebView，载入 `http://127.0.0.1:4747/?k=<口令>`。服务没在跑就用 `~/.local/node/bin/node` 起 `~/Library/Application Support/cc-board/app/server.mjs`，服务退出后 0.6 秒重启并重新载入页面。页面经 `ccb` 消息通道发来三种消息：`badge`（Dock 角标数字）、`drag`、`zoom`，其余类型忽略。菜单的「新会话 / 新任务」调页面的 `window.ccbBlank` / `window.ccbNew`。
Info.plist: 应用的包信息。
AppIcon.icns: 图标。

法则

- 改了 main.swift 才需要重新编译（`../build.sh` 不带参数）。重新编译后 ad-hoc 签名身份会变，Khalil 要重新授权「控制 Ghostty」。
- 界面和服务的代码放在包外面（`~/Library/Application Support/cc-board/app/`），所以平时只跑 `../build.sh update`。
- 系统通知不走这里：服务用 osascript 发，通知中心里显示的来源是「脚本编辑器」。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
