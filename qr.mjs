/**
 * [INPUT]: 不依赖任何模块（不加 npm 包、不从 CDN 拉）。调用方给一段文字，一般是手机配对链接 https://<机器>.ts.net/pair#<43 位 token>（约 90 字节）。
 * [OUTPUT]: 导出 qrMatrix(text) → { size, modules }（modules[y][x] 为 true 是黑块）、qrSvg(text, { quiet }) → SVG 字符串（白底黑块，不带宽高，由页面 CSS 定）。
 *           装不下（10-M 最多 213 字节）抛 Error('二维码装不下：N 字节')，N 是 UTF-8 字节数。
 * [POS]: 配对页上给 iPhone 相机扫的二维码。总控台是零依赖的 Node 服务，所以照 ISO/IEC 18004 自己写，只做这个用途要的那一小块：
 *        字节模式（UTF-8）、纠错 M 级、1–10 版里自动选最小的、Reed–Solomon、分块交错、定位 / 分隔 / 时序 / 校正图形、暗块、
 *        格式信息、7 版以上的版本信息、8 种掩码都试一遍按 4 条罚分规则挑最低的。不起进程、不读文件，同一输入永远出同一张图。
 *        test/qr.test.mjs 用 macOS 的 Vision 框架（另一套解码器）把它画的图解回来核对。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// ───────────── GF(256)，本原多项式 0x11d ─────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

// 生成多项式 (x - α^0)(x - α^1)…(x - α^(n-1))，降幂存，首项的 1 不存
function rsGen(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g.slice(1);
}
// 数据多项式乘 x^n 再除以生成多项式，余数就是纠错字
function rsRem(data, gen) {
  const r = new Array(gen.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    if (f) for (let i = 0; i < gen.length; i++) r[i] ^= mul(gen[i], f);
  }
  return r;
}

// ───────────── 1–10 版 M 级的表（ISO/IEC 18004 表 9、附录 E） ─────────────
// [每块纠错字数, 第一组块数, 第一组每块数据字数, 第二组块数]；第二组每块比第一组多 1 个数据字
const BLOCKS = [null, [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0],
  [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const dataWords = (v) => { const [, g1, d, g2] = BLOCKS[v]; return g1 * d + g2 * (d + 1); };
const countBits = (v) => (v < 10 ? 8 : 16);   // 字节模式的长度字段：1–9 版 8 位，10 版起 16 位

// 掩码 0–7，x 是列、y 是行
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

// ───────────── 罚分（4 条规则，整张图算，掩码挑最低的） ─────────────
function penalty(G) {
  const n = G.length; let p = 0, dark = 0;
  const line = (at) => {
    let s = 0;
    for (let i = 0, run = 0; i < n; i++) {                       // 规则 1：同色连着 5 个 +3，再多一个 +1
      run = i && at(i) === at(i - 1) ? run + 1 : 1;
      if (run === 5) s += 3; else if (run > 5) s++;
    }
    const light = (a, b) => { for (let k = Math.max(a, 0); k < Math.min(b, n); k++) if (at(k)) return false; return true; };
    for (let i = 0; i + 7 <= n; i++)                               // 规则 3：黑白黑黑黑白黑，前或后接 4 个白（出界是静区，算白）+40
      if (at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6) && (light(i - 4, i) || light(i + 7, i + 11))) s += 40;
    return s;
  };
  for (let k = 0; k < n; k++) p += line((x) => G[k][x]) + line((y) => G[y][k]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (G[y][x]) dark++;
    if (x && y && G[y][x] === G[y - 1][x] && G[y][x] === G[y][x - 1] && G[y][x] === G[y - 1][x - 1]) p += 3;   // 规则 2：2×2 同色 +3
  }
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;                                   // 规则 4：黑块比例每偏离 50% 满 5% +10
}

// ───────────── 编码 ─────────────
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let v = 1;
  while (v <= 10 && 4 + countBits(v) + bytes.length * 8 > dataWords(v) * 8) v++;
  if (v > 10) throw new Error('二维码装不下：' + bytes.length + ' 字节');

  // 数据位流：模式 0100、长度、字节；终止符最多 4 个 0，补齐到整字节，再交替补 0xEC 0x11
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  const cap = dataWords(v) * 8;
  put(0b0100, 4); put(bytes.length, countBits(v)); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // 分块，每块各算纠错字；先按列交错数据字（短块少一列），再交错纠错字
  const [ec, g1, d1, g2] = BLOCKS[v], gen = rsGen(ec), blocks = [];
  for (let b = 0, k = 0; b < g1 + g2; b++) { const d = data.slice(k, k += d1 + (b < g1 ? 0 : 1)); blocks.push([d, rsRem(d, gen)]); }
  const words = [];
  for (let i = 0; i <= d1; i++) for (const [d] of blocks) if (i < d.length) words.push(d[i]);
  for (let i = 0; i < ec; i++) for (const [, e] of blocks) words.push(e[i]);

  // 功能图形：F 记哪些格不放数据
  const size = 17 + 4 * v;
  const M = Array.from({ length: size }, () => new Array(size).fill(false)), F = M.map((r) => r.slice());
  const set = (x, y, dark) => { M[y][x] = dark; F[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }            // 时序图形
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])                                   // 定位图形 + 一圈白的分隔符
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const al = ALIGN[v], last = al.length - 1;                                                       // 校正图形：三个定位角上的不画
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // 格式信息：纠错级别 M（00）+ 3 位掩码，BCH(15,5) 生成多项式 0x537，再异或 0x5412；左上一份，右上 + 左下拆开一份，外加暗块
  const format = (mask, put) => {
    const d = (0b00 << 3) | mask; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) put(8, i, bit(i));
    put(8, 7, bit(6)); put(8, 8, bit(7)); put(7, 8, bit(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
    put(8, size - 8, true);
  };
  format(0, set);                                                                                   // 先占位，挑完掩码再写真的
  if (v >= 7) {                                                                                     // 版本信息：6 位版本号 + BCH(18,6) 生成多项式 0x1f25，右上、左下各一块 3×6
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
  }

  // 数据：从右下角起两列一组之字形走，跳过第 6 列（竖的时序图形）；数据位用完的格（余位）填 0
  for (let right = size - 1, i = 0; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!F[y][x]) { M[y][x] = i < words.length * 8 && ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }

  // 8 种掩码都试，罚分最低的胜出（同分取编号小的）
  let best = null, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    const G = M.map((r) => r.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) G[y][x] = !G[y][x];
    format(m, (x, y, d) => { G[y][x] = d; });
    const p = penalty(G); if (p < bestP) { best = G; bestP = p; }
  }
  return { size, modules: best };
}

// ───────────── SVG：白底一个 rect，黑块一条 path（同一行相邻的黑块合成一段） ─────────────
// 不写宽高（页面 CSS 定），不用 currentColor：深色模式下也要白底黑块，相机才好扫
export function qrSvg(text, { quiet = 4 } = {}) {
  const { size, modules } = qrMatrix(text), q = Math.max(0, Math.trunc(quiet) || 0), n = size + 2 * q;
  let d = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      let e = x; while (e + 1 < size && row[e + 1]) e++;
      d += 'M' + (x + q) + ' ' + (y + q) + 'h' + (e - x + 1) + 'v1H' + (x + q) + 'z';
      x = e;
    }
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">'
    + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
}
