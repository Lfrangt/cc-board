/**
 * [INPUT]: 依赖 ../suggest.mjs（或命令行给的另一份，比如改坏版）。屏幕夹具照真实 tmux 屏幕的结构手搭（边框、❯ + 不换行空格、暗色字、蓝色数字键），文字用通用示例。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造 8 个改坏的 suggest.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「预判解析」测试。纯函数，不起服务，一秒内跑完。
 *        测：灰字和打的字分得开、1/2/3 认得出、长建议折行接得回去、两种来源单独出现、不是输入框的屏幕一律不认、模型写的字里藏的东西不放行。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/suggest.test.mjs [suggest.mjs 的路径]      node test/suggest.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../suggest.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'suggest-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'typed-is-ghost':   ["if (segs.some((s) => !s.dim && s.text.replace(BLANK, ''))) return '';", "if (false) return '';"],
    'no-try-filter':    ['return /^Try "/.test(g) ? \'\' : g;', 'return g;'],
    'truecolor-is-dim': ['if (p === 38 || p === 48 || p === 58) i += ps[i + 1] === 5 ? 2 : ps[i + 1] === 2 ? 4 : 0;', 'if (false) i += 0;'],
    'no-zero-row':      ["if (!zero || zero[1] !== '0') return [];", 'if (!zero) return [];'],
    'numbering-ignored': ['rows.every((r, k) => r.n === k + 1 && r.label)', 'rows.every((r) => r.label)'],
    'no-tag-refusal':   ["if (TAGS.test(text)) return '';", ''],
    'cjk-join-space':   ["/[^\\x00-\\x7f]$/.test(a) || /^[^\\x00-\\x7f]/.test(b) ? a + b : a + ' ' + b", "a + ' ' + b"],
    'no-blank-skip':    ['skip < 3', 'skip < 0'],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const red = r.status !== 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + (r.stdout.trim().split('\n').pop() || ''));
  }
  console.log(bad ? bad + ' 个改坏版没让测试变红' : '全部改坏版都让测试变红');
  process.exit(bad ? 1 : 0);
}

const { parseSuggest } = await import(SRC);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const same = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), name, JSON.stringify(got));

// ── 屏幕夹具：和真实屏幕同构 ──
const BORDER = '\x1b[38;5;245m' + '─'.repeat(140);
const HEAD = '\x1b[38;5;241m下一步：\x1b[39m';
const row = (n, label) => `  \x1b[38;5;69m${n}\x1b[39m: ${label}`;
const band = (labels) => [HEAD, ...labels.map((l, i) => row(i + 1, l)), row(0, '关闭')];
const GHOST = (t) => '\x1b[39m❯\xa0\x1b[2m' + t + '\x1b[0m';
const TYPED = (t) => '\x1b[39m❯\xa0' + t + '\x1b[39m';
const STATUS = '\x1b[39m  \x1b[38;5;160m⏵⏵ bypass permissions on\x1b[38;5;241m (shift+tab to cycle)\x1b[39m';
const screen = ({ above = ['⏺ 做完了，结果在桌面。'], chips = [], gap = [''], composer = [GHOST('')] }) =>
  [...above, '', ...chips, ...gap, BORDER, ...composer, BORDER, STATUS, ''].join('\n');

const SUG = '把这个改动提交，然后跑一遍全部测试';
const LABELS = ['提交并跑测试', '看一下改动', '先放着'];
const opts = (labels) => labels.map((label, i) => ({ n: i + 1, label }));

console.log('灰字');
same(parseSuggest(screen({ composer: [GHOST(SUG)] })), { ghost: SUG, options: [] }, '只有灰字（原生建议）');
same(parseSuggest(screen({ composer: [TYPED('我自己打的字')] })), null, '他自己在框里打的字不是建议');
same(parseSuggest(screen({ composer: ['\x1b[39m❯\xa0\x1b[38;2;10;20;30m我打的字，真彩色\x1b[0m'] })), null, '真彩色（38;2;r;g;b）里的 2 不算暗色');
same(parseSuggest(screen({ composer: [GHOST('')] })), null, '空输入框什么都没有');
same(parseSuggest(screen({ composer: [GHOST('Try "how does this repo work?"')] })), null, '新会话的示例 Try "…" 不是预判');
{
  const half = '把这个改动提交，然后跑一遍全部测试，再把结果和耗时逐项写进说明里';
  const wrapped = screen({ composer: [GHOST(half.slice(0, 20)), '  \x1b[2m' + half.slice(20) + '\x1b[0m'] });
  same(parseSuggest(wrapped), { ghost: half, options: [] }, '折成两行的中文灰字接回去，中间不加空格');
  const en = screen({ composer: [GHOST('run the full test suite and'), '  \x1b[2mcommit the result\x1b[0m'] });
  same(parseSuggest(en), { ghost: 'run the full test suite and commit the result', options: [] }, '折行的英文灰字接回去，补一个空格');
}
same(parseSuggest(screen({ composer: [GHOST('先看\x1b[22m\x1b[2m 一下')] })), { ghost: '先看 一下', options: [] }, '灰字中途重置又重设暗色，照样是一句');
same(parseSuggest(screen({ composer: [GHOST('先看\x1b[0m 一下')] })), null, '灰字中途变回正常颜色，后半段就是他打的字，整句不当建议');

console.log('1 / 2 / 3');
same(parseSuggest(screen({ chips: band(LABELS), composer: [GHOST(SUG)] })), { ghost: SUG, options: opts(LABELS) }, '三条 + 灰字');
same(parseSuggest(screen({ chips: band(LABELS), composer: [GHOST('')] })), { ghost: '', options: opts(LABELS) }, '只有三条（灰字没有）');
same(parseSuggest(screen({ chips: band(LABELS), composer: [TYPED('正在打')] })), { ghost: '', options: opts(LABELS) }, '他在框里打字时三条还在，灰字没有');
same(parseSuggest(screen({ chips: band(LABELS.slice(0, 2)), composer: [GHOST(SUG)] }))?.options, opts(LABELS.slice(0, 2)), '只有两条也认');
same(parseSuggest(screen({ chips: band(LABELS), gap: ['', '                                  new task? /clear to save 600.1k tokens'], composer: [GHOST(SUG)] }))?.options, opts(LABELS), '0 行和边框之间隔着空行和右对齐的小提示');
same(parseSuggest(screen({ chips: [HEAD, row(2, '乙'), row(3, '丙'), row(0, '关闭')], composer: [GHOST(SUG)] }))?.options, [], '数字不是从 1 起的不认（数字键要和位置对得上）');
same(parseSuggest(screen({ above: ['⏺ 两个办法：', '  1: 甲', '  2: 乙'], composer: [GHOST(SUG)] }))?.options, [], '回复正文里的编号列表（没有 0 行）不当成三选一');
same(parseSuggest(screen({ above: ['  1: 甲', '  2: 乙', '  0: 丙', '⏺ 后面还有一段正文', '  继续说'], composer: [GHOST(SUG)] }))?.options, [], '编号行离边框太远不认');
same(parseSuggest(screen({ chips: [HEAD, row(1, '在新项目里试用'), row(0, 'Dismiss')], composer: [GHOST(SUG)] }))?.options, opts(['在新项目里试用']), '「0」那行写什么字都行（英文插件也认）');

console.log('不是输入框');
same(parseSuggest('⏺ 只有正文\n  1: 甲\n  0: 乙\n'), null, '没有输入框');
same(parseSuggest(['⏺ 正文', '────────────────────────────────────', '这是 markdown 的分隔线之间的字', '────────────────────────────────────', '  \x1b[2m暗色的别的东西\x1b[0m'].join('\n')), null, '两条分隔线夹着的不是以 ❯ 开头的段落，不是输入框');
same(parseSuggest(['  Do you want to proceed?', '  ❯ 1. Yes', '    2. No', '  Enter to confirm · Esc to cancel', BORDER, GHOST(SUG), BORDER].join('\n')), null, '屏幕上有选择框的提示行就不认');
same(parseSuggest(['⏺ 之前他说过：', '\x1b[38;5;16m\x1b[48;5;253m❯ 这是对话里回显的上一条他发的话\x1b[39m', '', BORDER, TYPED(''), BORDER].join('\n')), null, '对话里回显的「❯ 他说的话」不是输入框');
same(parseSuggest(''), null, '空屏幕');

console.log('模型写的字');
same(parseSuggest(screen({ composer: [GHOST('正常的字\u{E0049}\u{E0047}\u{E004E}')] })), null, '带 Unicode tag 字符的整条拒收（它们只能用来藏指令）');
same(parseSuggest(screen({ composer: [GHOST('零宽\u200b字\u202e符')] }))?.ghost, '零宽字符', '零宽和方向控制字符去掉');
same(parseSuggest(screen({ chips: band(['正常', '带\u{E0041}tag', '第三']), composer: [GHOST(SUG)] }))?.options, [], '有一条标签不干净，整组三选一不要（位置和数字键要对得上）');
same(parseSuggest(screen({ composer: [GHOST('字'.repeat(700))] }))?.ghost.length, 600, '灰字最长 600 个字');
same(parseSuggest(screen({ chips: band(['字'.repeat(200)]), composer: [GHOST('')] }))?.options[0].label.length, 80, '标签最长 80 个字');

console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
