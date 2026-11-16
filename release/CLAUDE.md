# release/
> L2 | Parent: ../CLAUDE.md

成员清单

release.sh: 出公开的 cc-board 安装包（Developer ID 签名 + 公证 + 钉票据的 .dmg）。`release/release.sh 0.3.0` 正式，`--adhoc` 演练（ad-hoc 签名、不上传公证，没有证书时核对包的结构）。产物在 `out/`。不碰 ~/Applications、数据目录，不启动应用。用 /bin/bash 写，变量一律 `${}`。
entitlements.plist: 签名时给的权限，只有 `com.apple.security.automation.apple-events`（hardened runtime 下没有它，发给 Ghostty 的 Apple Event 会被系统直接拒，不弹框）。不开沙盒。
out/: 产物和工作目录（不进仓库）。

第一次出正式包之前（只做一次）

1. Developer ID 证书（只有开发者账号的持有人能建）：Xcode → Settings → Accounts → 选持有人的 Apple ID → 个人团队 → Manage Certificates… → 左下角 + → Developer ID Application。建好后 `security find-identity -v -p codesigning` 里多一行 `Developer ID Application: <名字> (<团队 ID>)`。
2. 第一次用这张证书签名时，钥匙串会弹框问 codesign 能不能用这把私钥：要有人在机器前点「始终允许」（输登录密码）。没人在时这一步会一直卡住。
3. 公证用同一个团队的 App Store Connect API 密钥（团队密钥）。`~/.config/cc-board/notary.env` 写两行 `ASC_KEY_ID=…`、`ASC_ISSUER_ID=…`（或用 `CCBOARD_NOTARY_ENV` 指别的文件），密钥文件放 `~/.appstoreconnect/private_keys/AuthKey_<密钥 ID>.p8`（或 `CCBOARD_NOTARY_KEY`）。密钥 ID 和内容不写进仓库、看板、群聊。

出包

```bash
git status                          # 正式包要工作区干净：包里记着提交号
release/release.sh 0.3.0            # 约 5–10 分钟，大半是等苹果公证（两次：应用、dmg）
```

法则

- 正式包只从推到 GitHub 的提交出，出完把 dmg 和 .sha256 一起放到 GitHub Release（发布是对外动作，要 Khalil 点头）。
- 不要在作者这台机器上用真主目录打开 dmg 里的应用：总控台没开着时，它会把包里的代码拷进 `~/Library/Application Support/cc-board/app/`，盖掉 `build.sh update` 装的那一份。所以脚本出完包就删掉工作目录里的 .app，只留 dmg。
- 管道里不用 `grep -q`、`head`：`set -o pipefail` 下前面的命令会吃 SIGPIPE，整条被当成失败（11/16 演练第二遍「签名里没有 hardened runtime」就是这么误报的）。先存进变量再比。
- 系统命令写全路径；`spctl` 在 `/usr/sbin`，不在 `/usr/bin`。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
