#!/bin/zsh
# 把总控台打成一个 macOS 应用，装到 ~/Applications/总控台.app
#   ./build.sh          编译 + 打包 + 安装（装完要重新点一次「允许控制 Ghostty」）
#   ./build.sh update   只把界面和服务的代码换成新版，不动应用本身（不用重新授权）
# English: no argument = compile the Swift shell, sign it ad hoc, install it (macOS asks again before it may control Ghostty);
#          `update`   = copy server.mjs / ui.html / projects.mjs into the data dir and restart the service. No rebuild, no re-authorization.
# NODE=/path/to/node overrides the node that checks syntax (the app itself looks in ~/.local/node/bin, /opt/homebrew/bin, /usr/local/bin).
set -e
cd "${0:a:h}"
NODE="${NODE:-$(command -v node || echo "$HOME/.local/node/bin/node")}"
[ -x "$NODE" ] || { echo "node not found: install Node 22+ or set NODE=/path/to/node" >&2; exit 1; }
NAME="总控台"; STAGE="build/$NAME.app"; DEST="$HOME/Applications/$NAME.app"
LIVE="$HOME/Library/Application Support/cc-board/app"
push_live() { mkdir -p "$LIVE"; /bin/cp server.mjs ui.html projects.mjs "$LIVE/"; }
if [ "$1" = "update" ]; then
  "$NODE" --check server.mjs
  "$NODE" --check projects.mjs     # server.mjs 引用它；少拷它服务就起不来
  push_live
  PID=$(/usr/bin/curl -s -m 2 http://127.0.0.1:${CCBOARD_PORT:-4747}/health | /usr/bin/sed -n 's/.*"pid":\([0-9]*\).*/\1/p')
  if [ -n "$PID" ] && /bin/ps -o command= -p "$PID" | /usr/bin/grep -q "server.mjs"; then kill "$PID"; echo "updated; service restarting"; else echo "updated (service not running)"; fi
  exit 0
fi
rm -rf build; mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
/usr/bin/swiftc -O -swift-version 5 -target arm64-apple-macos13 -framework Cocoa -framework WebKit app/main.swift -o "$STAGE/Contents/MacOS/ccboard"
/bin/cp app/Info.plist "$STAGE/Contents/Info.plist"
/bin/cp server.mjs ui.html projects.mjs "$STAGE/Contents/Resources/"
[ -f app/AppIcon.icns ] && /bin/cp app/AppIcon.icns "$STAGE/Contents/Resources/AppIcon.icns"
/usr/bin/codesign --force --sign - "$STAGE" >/dev/null 2>&1
push_live
mkdir -p "$HOME/Applications"; rm -rf "$DEST"; /bin/cp -R "$STAGE" "$DEST"
echo "installed: $DEST"
