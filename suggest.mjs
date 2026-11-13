/**
 * [INPUT]: 依赖 `tmux capture-pane -p -e` 给出的屏幕文本（带样式码）。不读文件，不起进程，不联网。
 * [OUTPUT]: 导出 parseSuggest(screen) → { ghost, options: [{ n, label }] } | null
 * [POS]: 输入框上「预判」的唯一解析器。server.mjs 隔几秒读一次空闲会话的屏幕交给它，界面只收结果。
 *        两样东西都只画在终端上，不写进对话记录，所以只能从屏幕读：
 *        · 灰字：输入框第一行 ❯ 后面的暗色字（SGR 2）。Claude Code 自己的建议，或 next-steps 类插件放进去的第 1 条完整 prompt。
 *        · 1 / 2 / 3：输入框上边框之上的 `n: 标签` 行，以 `0:` 行收尾（next-steps 类插件）。屏幕上只有标签，第 2、3 条的完整 prompt 看不到。
 *        字是模型写的，读进来先过 clean()：只留人眼看得见的字，带 Unicode tag 字符的整条拒收（它们只能用来藏指令）。
 *        识别靠结构（两条边框夹住以 ❯ 开头的行）不靠字面，所以插件换了「下一步：」这类文字也认得。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

const ANSI = /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const BORDER = /^[─━═]{12,}$|^[─━═]{4,} .+ [─━═]{4,}$/;     // 输入框的上下边框；带名字的边框也算
const CHIP = /^\s{1,8}([0-3]): (\S.*)$/;                      // `  1: 标签`
const CONFIRM = /enter\s+(to\s+)?(confirm|select)/i;          // 选择框的提示行：屏幕上有它，就不是普通输入框
const PROMPT = '❯';
const GHOST_MAX = 600, LABEL_MAX = 80;
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Variation_Selector}ᅟᅠㅤﾠ]/gu;
const TAGS = /[\u{E0000}-\u{E007F}]/u;
const BLANK = /[\s ]/g;

function clean(text, max) {
  if (TAGS.test(text)) return '';
  const s = text.replace(/\s+/g, ' ').replace(UNSEEN, '').replace(/ {2,}/g, ' ').trim();
  const points = [...s];
  return points.length > max ? points.slice(0, max - 1).join('') + '…' : s;
}

// 一行拆成「同一种样式的片段」，只关心暗色（SGR 2）。38/48/58 后面跟的颜色参数里也有 2（真彩色的 38;2;r;g;b），要跳过。
function runs(line) {
  const out = []; let dim = false, last = 0;
  const re = /\x1b\[([0-9;:]*)m|\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  for (let m; (m = re.exec(line)); ) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), dim });
    last = re.lastIndex;
    if (m[1] === undefined) continue;
    const ps = m[1].split(/[;:]/).map(Number);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i] || 0;
      if (p === 38 || p === 48 || p === 58) i += ps[i + 1] === 5 ? 2 : ps[i + 1] === 2 ? 4 : 0;
      else if (p === 0 || p === 22) dim = false;
      else if (p === 2) dim = true;
    }
  }
  if (last < line.length) out.push({ text: line.slice(last), dim });
  return out;
}

function afterPrompt(rs) {                                   // 第一行：去掉 ❯ 和它前面的东西
  const out = []; let seen = false;
  for (const r of rs) {
    let t = r.text;
    if (!seen) { const k = t.indexOf(PROMPT); if (k < 0) continue; seen = true; t = t.slice(k + 1); }
    out.push({ text: t, dim: r.dim });
  }
  return out;
}

// 长建议在终端里折成几行：两边只要有一边是中日韩字就直接接，否则补一个空格
const joinWrapped = (parts) => parts.reduce((a, b) => (!a ? b : /[^\x00-\x7f]$/.test(a) || /^[^\x00-\x7f]/.test(b) ? a + b : a + ' ' + b), '');

function ghostOf(top, bot, raw) {
  const parts = [];
  for (let i = top + 1; i < bot; i++) {
    const segs = i === top + 1 ? afterPrompt(runs(raw[i])) : runs(raw[i]);
    if (segs.some((s) => !s.dim && s.text.replace(BLANK, ''))) return '';     // 有正常颜色的字 = 他自己在这个框里打的字，不是建议
    const t = segs.map((s) => s.text).join('').replace(/ /g, ' ').trim();
    if (t) parts.push(t);
  }
  const g = clean(joinWrapped(parts), GHOST_MAX);
  return /^Try "/.test(g) ? '' : g;                          // 新会话空输入框里的示例 Try "…" 也是暗色字，不是预判
}

function optionsOf(top, pl) {
  let i = top - 1, skip = 0;
  while (i >= 0 && !CHIP.test(pl[i]) && skip < 3) { i--; skip++; }   // 边框和 0 行之间可能隔着空行或右对齐的小提示
  const zero = i >= 0 ? CHIP.exec(pl[i]) : null;
  if (!zero || zero[1] !== '0') return [];
  const rows = [];
  for (i--; i >= 0; i--) {
    const m = CHIP.exec(pl[i]);
    if (!m || m[1] === '0') break;
    rows.unshift({ n: Number(m[1]), label: clean(m[2], LABEL_MAX) });
  }
  return rows.length && rows.every((r, k) => r.n === k + 1 && r.label) ? rows.slice(0, 3) : [];   // 必须是 1 2 (3)，有一条字不干净就整组不要（数字键和位置要对得上）
}

export function parseSuggest(screen) {
  const raw = String(screen || '').split('\n');
  const pl = raw.map((l) => l.replace(ANSI, '').replace(/ /g, ' ').replace(/\s+$/, ''));
  if (pl.some((l) => CONFIRM.test(l))) return null;
  let bot = -1, top = -1;
  for (let i = pl.length - 1; i >= 0 && top < 0; i--) if (BORDER.test(pl[i].trim())) { if (bot < 0) bot = i; else top = i; }
  if (top < 0 || bot - top < 2 || !pl[top + 1].startsWith(PROMPT)) return null;   // 输入框 = 最下面两条边框夹住、以 ❯ 开头的那段
  const ghost = ghostOf(top, bot, raw), options = optionsOf(top, pl);
  return ghost || options.length ? { ghost, options } : null;
}
