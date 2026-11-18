#!/bin/sh
# 公开版的包信息：build.sh 在 CCBOARD_APP_NAME 不是「总控台」时调用（release/release.sh 走这里；官网一行安装脚本改钉到含它的提交以后也该走这里）。
#   app/public-info.sh <暂存的 .app> <名字>
# 名字换成 <名字>（cc-board），包标识换成 dev.ccboard.app，「控制 Ghostty」的说明默认英文、中文系统看中文。
# Khalil 本机的 总控台.app 不走这里：包标识一变，macOS 会把它当成另一个应用，要重新允许控制 Ghostty。
set -eu
APP="$1"; NAME="$2"; P="$APP/Contents/Info.plist"; HERE="$(cd "$(dirname "$0")" && pwd)"
/usr/bin/plutil -replace CFBundleName -string "$NAME" "$P"
/usr/bin/plutil -replace CFBundleDisplayName -string "$NAME" "$P"
/usr/bin/plutil -replace CFBundleIdentifier -string "dev.ccboard.app" "$P"
/usr/bin/plutil -replace CFBundleDevelopmentRegion -string "en" "$P"
/usr/bin/plutil -replace NSAppleEventsUsageDescription -string "$NAME uses Ghostty to type your replies into the matching session tab, and to switch to that tab when you click Open in terminal." "$P"
/bin/mkdir -p "$APP/Contents/Resources/zh-Hans.lproj"
/bin/cp "$HERE/zh-Hans.lproj/InfoPlist.strings" "$APP/Contents/Resources/zh-Hans.lproj/InfoPlist.strings"
/usr/bin/plutil -lint "$P" >/dev/null
