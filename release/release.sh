#!/bin/bash
# 出公开的 cc-board 安装包：Developer ID 签名 + 公证 + 钉上票据的 .dmg。说明见 release/CLAUDE.md。
#   release/release.sh 0.3.0            正式：钥匙串里要有一张「Developer ID Application」证书，公证密钥见下
#   release/release.sh 0.3.0 --adhoc    演练：同样的步骤，ad-hoc 签名、不上传公证；没有证书时用它核对包的结构
# 产物：release/out/cc-board-<版本>.dmg 和 .dmg.sha256。不碰 ~/Applications、不碰数据目录、不启动应用。
# 公证用 App Store Connect API 密钥：CCBOARD_NOTARY_ENV 指一个写着 ASC_KEY_ID= 和 ASC_ISSUER_ID= 的文件
#   （默认 ~/.config/cc-board/notary.env），密钥文件默认 ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8（CCBOARD_NOTARY_KEY 改）。
# 签名证书：CCBOARD_SIGN_ID 指定；不指定时钥匙串里必须正好一张 Developer ID Application。
set -euo pipefail
cd "$(dirname "$0")/.."

VER="${1:-}"; MODE="${2:-}"
[[ "${VER}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "用法：release/release.sh 0.3.0 [--adhoc]" >&2; exit 2; }
ADHOC=0
if [ "${MODE}" = "--adhoc" ]; then ADHOC=1; elif [ -n "${MODE}" ]; then echo "不认识的参数：${MODE}" >&2; exit 2; fi
NAME="cc-board"
OUT="release/out"; WORK="${OUT}/work-${VER}"; DMG="${OUT}/${NAME}-${VER}.dmg"
APP="${WORK}/${NAME}.app"; MNT="${WORK}/mnt"
ENT="release/entitlements.plist"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mrelease: %s\033[0m\n' "$*" >&2; exit 1; }
MOUNTED=0
cleanup() { if [ "${MOUNTED}" = 1 ]; then /usr/bin/hdiutil detach -quiet "${MNT}" || /usr/bin/hdiutil detach -force -quiet "${MNT}" || true; fi; }
trap cleanup EXIT

# ── 0. 先查条件，什么都还没动 ──
say "0. 检查"
COMMIT=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  [ "${ADHOC}" = 1 ] || die "工作区有没提交的改动。正式包必须对应一个提交（git stash 或先提交）。"
  echo "  演练：工作区有没提交的改动，照样打（正式包不允许）"
fi
echo "  提交 ${COMMIT}"
if [ "${ADHOC}" = 0 ]; then
  if [ -n "${CCBOARD_SIGN_ID:-}" ]; then SIGN_ID="${CCBOARD_SIGN_ID}"
  else
    IDS=$(/usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -c '"Developer ID Application:' || true)
    [ "${IDS}" = 1 ] || die "钥匙串里的 Developer ID Application 证书有 ${IDS} 张（要正好 1 张，或用 CCBOARD_SIGN_ID 指定）。建证书的步骤见 release/CLAUDE.md。"
    SIGN_ID=$(/usr/bin/security find-identity -v -p codesigning | /usr/bin/sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p')
  fi
  IDLIST=$(/usr/bin/security find-identity -v -p codesigning)
  SIGN_UP=$(printf '%s' "${SIGN_ID}" | tr 'a-f' 'A-F')                    # 也可以写证书的 SHA-1（同名的证书有两张时只能这样挑）
  if [[ "${IDLIST}" != *"\"${SIGN_ID}\""* ]] && ! { [[ "${SIGN_UP}" =~ ^[0-9A-F]{40}$ ]] && [[ "${IDLIST}" == *"${SIGN_UP}"* ]]; }; then
    die "钥匙串里没有这张证书：${SIGN_ID}"
  fi
  echo "  签名用 ${SIGN_ID}"
  NOTARY_ENV="${CCBOARD_NOTARY_ENV:-${HOME}/.config/cc-board/notary.env}"
  [ -r "${NOTARY_ENV}" ] || die "读不到公证密钥配置 ${NOTARY_ENV}"
  ASC_KEY_ID=$(/usr/bin/sed -n 's/^ASC_KEY_ID=//p' "${NOTARY_ENV}" | tr -d '"'"'"' \r')
  ASC_ISSUER_ID=$(/usr/bin/sed -n 's/^ASC_ISSUER_ID=//p' "${NOTARY_ENV}" | tr -d '"'"'"' \r')
  [ -n "${ASC_KEY_ID}" ] && [ -n "${ASC_ISSUER_ID}" ] || die "${NOTARY_ENV} 里缺 ASC_KEY_ID 或 ASC_ISSUER_ID"
  KEYFILE="${CCBOARD_NOTARY_KEY:-${HOME}/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"
  [ -r "${KEYFILE}" ] || die "读不到公证密钥文件（AuthKey_<密钥 ID>.p8）"
  echo "  公证密钥：在（内容不打印）"
fi
FREE_MB=$(/bin/df -m . | /usr/bin/awk 'NR==2 {print $4}')
[ "${FREE_MB}" -gt 500 ] || die "磁盘只剩 ${FREE_MB} MB"

staple() {     # 票据刚发出来时偶尔还查不到，隔 10 秒再试，最多 3 次
  local i
  for i in 1 2 3; do
    if /usr/bin/xcrun stapler staple "${1}"; then return 0; fi
    [ "${i}" = 3 ] || sleep 10
  done
  die "钉票据失败：${1}。公证已经过了：过几分钟手动跑 xcrun stapler staple \"${1}\" 就行；重跑这个脚本会从头再公证一遍。"
}

notarize() {   # $1 = 要公证的文件（zip 或 dmg），$2 = 名字（日志文件用）
  local json="${WORK}/notary-$2.json" status id
  echo "  上传公证：${1}（通常 1–5 分钟）"
  /usr/bin/xcrun notarytool submit "$1" --key "${KEYFILE}" --key-id "${ASC_KEY_ID}" --issuer "${ASC_ISSUER_ID}" \
    --wait --timeout 30m --output-format json > "${json}" || true
  status=$(/usr/bin/plutil -extract status raw -o - "${json}" 2>/dev/null || echo "?")
  id=$(/usr/bin/plutil -extract id raw -o - "${json}" 2>/dev/null || echo "")
  echo "  公证结果：${status}（${id}）"
  if [ "${status}" != "Accepted" ]; then
    if [ -n "${id}" ]; then
      /usr/bin/xcrun notarytool log "${id}" --key "${KEYFILE}" --key-id "${ASC_KEY_ID}" --issuer "${ASC_ISSUER_ID}" "${WORK}/notary-$2-log.json" || true
    fi
    die "公证没过（${2}）。苹果给的原因在 ${WORK}/notary-$2-log.json，应答在 ${json}"
  fi
}

# ── 1. 编译打包（公开版的名字和包信息），拷到工作目录 ──
say "1. 编译打包"
rm -rf "${WORK}" "${DMG}" "${DMG}.sha256"; mkdir -p "${WORK}"
CCBOARD_APP_NAME="${NAME}" /bin/zsh ./build.sh stage
/usr/bin/ditto "build/${NAME}.app" "${APP}"
PL="${APP}/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "${VER}" "${PL}"
/usr/bin/plutil -replace CFBundleVersion -string "$(/bin/date -u +%Y%m%d%H%M)" "${PL}"
/usr/bin/plutil -replace CCBoardSyncCode -bool true "${PL}"          # 应用启动时把包里的代码换进数据目录（main.swift 的 syncBundledCode）
/usr/bin/plutil -replace CCBoardCommit -string "${COMMIT}" "${PL}"
/usr/bin/plutil -lint "${PL}" >/dev/null
for f in server.mjs ui.html; do [ -f "${APP}/Contents/Resources/${f}" ] || die "包里少了 ${f}"; done
# 包里的代码文件要和仓库根目录的一样多：build.sh 的拷贝清单漏了一个，服务的 import 就会失败
N_REPO=$(ls ./*.mjs ui.html | wc -l | tr -d ' '); N_APP=$(ls "${APP}"/Contents/Resources/*.mjs "${APP}/Contents/Resources/ui.html" | wc -l | tr -d ' ')
[ "${N_REPO}" = "${N_APP}" ] || die "仓库根目录有 ${N_REPO} 个 .mjs/.html，包里只有 ${N_APP} 个：build.sh 的拷贝清单漏了"
echo "  ${APP}（代码文件 ${N_APP} 个，版本 ${VER}）"

# ── 2. 签名：hardened runtime + 时间戳 + 一条权限（发 Apple Event 给 Ghostty）──
say "2. 签名"
if [ "${ADHOC}" = 1 ]; then
  /usr/bin/codesign --force --options runtime --entitlements "${ENT}" --sign - --timestamp=none "${APP}"
else
  /usr/bin/codesign --force --options runtime --entitlements "${ENT}" --sign "${SIGN_ID}" --timestamp "${APP}"
fi
/usr/bin/codesign --verify --strict --deep -v "${APP}" || die "签名核对没过（上面是 codesign 的原话）"
# 先存进变量再查：grep -q 一匹配就退出，前面的 codesign 会吃 SIGPIPE，在 pipefail 下整条算失败（11/16 演练第二遍就这样误报过）
SIG=$(/usr/bin/codesign -dv "${APP}" 2>&1); ENTS=$(/usr/bin/codesign -d --entitlements - --xml "${APP}" 2>/dev/null)
[[ "${SIG}" == *"flags="*"runtime"* ]] || die "签名里没有 hardened runtime"
[[ "${ENTS}" == *"com.apple.security.automation.apple-events"* ]] || die "签名里没有 apple-events 权限"
[[ "${ENTS}" != *"get-task-allow"* ]] || die "签名里有 get-task-allow，公证会拒"
echo "  hardened runtime、apple-events 权限都在，没有 get-task-allow"

# ── 3. 公证应用本身并钉票据（拖出 dmg 后离线打开也认）──
if [ "${ADHOC}" = 0 ]; then
  say "3. 公证应用"
  /usr/bin/ditto -c -k --keepParent "${APP}" "${WORK}/app.zip"
  notarize "${WORK}/app.zip" app
  staple "${APP}"
  /usr/bin/xcrun stapler validate "${APP}"
else
  say "3. 公证应用（演练：跳过）"
fi

# ── 4. 打 dmg：应用 + 指向「应用程序」的替身 ──
say "4. 打 dmg"
mkdir -p "${WORK}/dmg"
/usr/bin/ditto "${APP}" "${WORK}/dmg/${NAME}.app"
ln -s /Applications "${WORK}/dmg/Applications"
/usr/bin/hdiutil create -quiet -volname "${NAME}" -srcfolder "${WORK}/dmg" -fs HFS+ -format UDZO -ov "${DMG}"
if [ "${ADHOC}" = 0 ]; then
  /usr/bin/codesign --sign "${SIGN_ID}" --timestamp "${DMG}"
  say "5. 公证 dmg"
  notarize "${DMG}" dmg
  staple "${DMG}"
  /usr/bin/xcrun stapler validate "${DMG}"
else
  say "5. 公证 dmg（演练：跳过）"
fi

# ── 6. 核对：挂上 dmg（不弹访达窗口）看里面的应用，过 Gatekeeper 的判断 ──
say "6. 核对"
/usr/bin/hdiutil verify -quiet "${DMG}"
mkdir -p "${MNT}"
/usr/bin/hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "${MNT}" "${DMG}"; MOUNTED=1
[ -d "${MNT}/${NAME}.app" ] || die "dmg 里没有 ${NAME}.app"
[ -L "${MNT}/Applications" ] || die "dmg 里没有「应用程序」替身"
MP="${MNT}/${NAME}.app/Contents/Info.plist"
for k in CFBundleName CFBundleIdentifier CFBundleShortVersionString CCBoardSyncCode; do
  echo "  ${k} = $(/usr/bin/plutil -extract "${k}" raw -o - "${MP}")"
done
if [ "${ADHOC}" = 0 ]; then
  /usr/sbin/spctl -a -t exec -vv "${MNT}/${NAME}.app" 2>&1 | sed 's/^/  /' || true
  GK=$(/usr/sbin/spctl -a -t exec -vv "${MNT}/${NAME}.app" 2>&1 || true)
  [[ "${GK}" == *"accepted"* && "${GK}" == *"source=Notarized Developer ID"* ]] || die "Gatekeeper 不认 dmg 里的应用"
  /usr/sbin/spctl -a -t open --context context:primary-signature -vv "${DMG}" 2>&1 | sed 's/^/  /' || true
  /usr/sbin/spctl -a -t open --context context:primary-signature "${DMG}" 2>/dev/null || die "Gatekeeper 不认这个 dmg"
else
  echo "  演练包是 ad-hoc 签名，Gatekeeper 一定拒（下面这行应该是 rejected）："
  /usr/sbin/spctl -a -t exec -vv "${MNT}/${NAME}.app" 2>&1 | head -1 | sed 's/^/  /' || true
fi
# 卸不下来不中断：两次公证都已经做完，产物是好的，只差下面的校验和
/usr/bin/hdiutil detach -quiet "${MNT}" || /usr/bin/hdiutil detach -force -quiet "${MNT}" || echo "  挂载点没卸下来：${MNT}（不影响产物）"
MOUNTED=0

# 工作目录里那几份 .app 删掉（公证记录留着）：别在出包的机器上留一个能双击的公开包，它启动时会去换数据目录里的代码
rm -rf "${APP}" "${WORK}/dmg" "${WORK}/app.zip"
rmdir "${MNT}" 2>/dev/null || true                                       # 只删空目录：上面没卸下来时它还挂着，不能 rm -rf

# ── 7. 校验和 ──
(cd "${OUT}" && /usr/bin/shasum -a 256 "$(basename "${DMG}")" > "$(basename "${DMG}").sha256")
SIZE=$(/usr/bin/du -h "${DMG}" | cut -f1)
say "好了：${DMG}（${SIZE}）"
echo "  sha256 $(cut -d' ' -f1 "${DMG}.sha256")"
echo "  提交 ${COMMIT}，版本 ${VER}$([ "${ADHOC}" = 1 ] && echo '，演练包：ad-hoc 签名、没公证，不能发')"
