#!/bin/bash
# 假 vidscribe：transcribe.test.mjs 用，和真的（~/.local/bin/vidscribe）同一个合同——
#   第一个参数是音频文件，-o 给输出文件夹，结果写成 <文件名去扩展名>.txt。
# 文字由「音频」开头 8 个字节的记号决定（测试自己造的音频，开头写记号）：
#   ZH1 中文 | MIX 中英混写 | INJ 带控制 / 零宽 / 方向控制 / tag 字符 | INJ2 带方向隔离 / 软连字符 / 阿拉伯字母标记
#   EMPTY 只有空白 | FAIL 报错退出 | SLOW 慢 1 秒（测排队）| SLOW2 慢 2 秒（测断开 / 先查忙）| SLOW5 慢 5 秒（测同端口再起一份服务时第一份的转写不被动，FIX-2 N1）| HANG 卡 37 秒，而且像真的一样起一个孙进程（测超时杀整组）
#   NEEDP 要在 PATH 里找到 vox-helper（模拟真 vidscribe 要 ~/.local/bin 里的 mlx_audio）：找不到就 exit 127，找到了用它的输出当文字
#   NOTOOL 报「command not found」退出 127（缺程序，不是录音的问题）| ANSI 报带色码和响铃的错 | LONGERR 报一行 600 字的错
#   BIG 吐 5999 个 x 加两个 emoji（超 6000 个字，第 6000 个字是 emoji 的整个）
# 留下的痕迹（路径都从环境变量 T_OUT 来，测试读文件，不读服务自己的说法）：
#   $T_OUT.argv   收到的全部参数（NUL 分隔）   $T_OUT.calls  每次调用一行「记号 文件」
#   $T_OUT.lock   进来时 mkdir 的锁目录：mkdir 不成功 = 另一段还没转完就又进来一段 → 写 $T_OUT.overlap
#   $T_OUT.pids   自己的进程号和起的孙进程的进程号，一行一个（测试只认这些，不按名字找进程）
#   $T_OUT.env    收到的 HF_HUB_OFFLINE 和 PATH（「HF_HUB_OFFLINE|PATH」）
# 本文件不写任何不可见字符；要它们出现在输出里，只用 printf 的 \x 字节写法。
f="$1"
ALL=("$@")
shift
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; esac
  shift
done

printf '%s\0' "${ALL[@]}" > "${T_OUT}.argv"
echo "$$" >> "${T_OUT}.pids"
printf '%s|%s' "${HF_HUB_OFFLINE-unset}" "${PATH}" > "${T_OUT}.env"

have_lock=""
if mkdir "${T_OUT}.lock" 2>/dev/null; then
  have_lock=1
else
  : > "${T_OUT}.overlap"
fi
cleanup() { [ -n "${have_lock}" ] && rmdir "${T_OUT}.lock" 2>/dev/null; }
trap cleanup EXIT
trap 'exit 143' TERM

mark="$(head -c 8 "${f}" | tr -d '\0')"
base="$(basename "${f}")"
base="${base%.*}"
echo "${mark} ${f}" >> "${T_OUT}.calls"

case "${mark}" in
  ZH1*)   printf '%s' "你好，我想给总控台加一个录音按钮。" > "${out}/${base}.txt" ;;
  MIX*)   printf '%s' "把 FretFlow 的 Claude Code 窗口发到 TestFlight" > "${out}/${base}.txt" ;;
  # a \x01 b ZWSP c RLO d TAG(U+E0021) e 两个空格 f 四个换行 g
  INJ2*)  printf 'a\xe2\x81\xa6b\xe2\x81\xa9c\xc2\xadd\xd8\x9ce' > "${out}/${base}.txt" ;;
  INJ*)   printf 'a\x01b\xe2\x80\x8bc\xe2\x80\xaed\xf3\xa0\x80\xa1e  f\n\n\n\ng' > "${out}/${base}.txt" ;;
  EMPTY*) printf '  \n ' > "${out}/${base}.txt" ;;
  FAIL*)  echo "ffmpeg: Invalid data found" >&2; exit 1 ;;
  NOTOOL*) echo "ffmpeg: command not found" >&2; exit 127 ;;
  NEEDP*) txt="$(vox-helper 2>/dev/null)" || { echo "vox-helper: command not found" >&2; exit 127; }
          printf '%s' "${txt}" > "${out}/${base}.txt" ;;
  ANSI*)  printf 'boom \x1b[31mred\x1b[0m\x07 end\n' >&2; exit 1 ;;
  LONGERR*) { head -c 600 /dev/zero | tr '\0' e; echo; } >&2; exit 1 ;;
  BIG*)   { head -c 5999 /dev/zero | tr '\0' x; printf '\xf0\x9f\x98\x80\xf0\x9f\x98\x80'; } > "${out}/${base}.txt" ;;
  SLOW5*) /bin/sleep 5; printf '%s' "慢的那一段" > "${out}/${base}.txt" ;;
  SLOW2*) /bin/sleep 2; printf '%s' "慢的那一段" > "${out}/${base}.txt" ;;
  SLOW*)  /bin/sleep 1; printf '%s' "慢的那一段" > "${out}/${base}.txt" ;;
  HANG*)  /bin/sleep 37 & echo "$!" >> "${T_OUT}.pids"; wait ;;
  *)      printf '%s' "未知记号" > "${out}/${base}.txt" ;;
esac
