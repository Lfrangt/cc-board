/**
 * [INPUT]: 依赖 ../qr.mjs（或命令行给的另一份，比如改坏版）、/usr/bin/swiftc 和 macOS 的 Vision 框架。不起服务、不碰 tmux、不联网、不开浏览器。
 * [OUTPUT]: 逐项打印 ok / FAIL，最后一行「结果：N 过，M 没过」；退出码 0 = 全过，1 = 有没过的，2 = 环境不对（编不出 Swift 解码器、Vision 跑不起来）。
 *           带 --mutants 时改跑反向对照：造若干个改坏的 qr.mjs，每个都必须让本测试变红。
 * [POS]: test/ 的二维码测试。检查和被检查的不用同一种写法：qr.mjs 画的矩阵由这里自己转成 PNG（手写 IHDR / IDAT / IEND 和 CRC32，zlib 只做 deflate），
 *        交给 Vision（VNDetectBarcodesRequest，苹果的另一套解码器）解回来逐字比，并核 Vision 读到的版本号和纠错级别。
 *        先过两条对照：白纸找不到码、配对链接的图中间涂坏一块解不出原文（Vision 真在解，不是什么都回）。
 *        再测：真实形状的配对链接、1–10 每一版各两条（刚过上一版的上限、正好装满；容量照标准的表写死，不读 qr.mjs 的表）、
 *        中文 UTF-8、掩码（解码器看不出挑得好不好，所以另写一遍功能区和 4 条罚分，核 Vision 读到的掩码正是罚分最低的）、
 *        装不下报字节数、确定性、qrSvg 的结构，以及把 SVG 的 path 当几何读回矩阵逐格比。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/qr.test.mjs [qr.mjs 的路径]      node test/qr.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url), HERE = path.dirname(SELF);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../qr.mjs'));
const TMP = path.join(HERE, '.tmp', 'qr-' + process.pid);
const finish = (code) => { fs.rmSync(TMP, { recursive: true, force: true }); process.exit(code); };
const envBad = (why) => { console.log('环境不对：' + why); finish(2); };

// ── 独立的解码器：Vision。每张图一行：序号 \t 找到几个 \t 版本 \t 纠错级别 \t 掩码 \t 内容的 base64（没解出内容是 -） ──
const SWIFT = `import Foundation
import Vision
import CoreImage
for (i, p) in CommandLine.arguments.dropFirst().enumerated() {
  let req = VNDetectBarcodesRequest()
  req.symbologies = [.qr]
  var out = ["\\(i)", "0", "0", "-", "-1", "-"]
  do {
    try VNImageRequestHandler(url: URL(fileURLWithPath: p), options: [:]).perform([req])
    let rs = req.results ?? []
    out[1] = "\\(rs.count)"
    if let o = rs.first {
      if let d = o.barcodeDescriptor as? CIQRCodeDescriptor {
        out[2] = "\\(d.symbolVersion)"
        out[3] = String(UnicodeScalar(UInt8(truncatingIfNeeded: d.errorCorrectionLevel.rawValue)))
        out[4] = "\\(d.maskPattern)"
      }
      if let s = o.payloadStringValue { out[5] = Data(s.utf8).base64EncodedString() }
    }
  } catch { out[1] = "err" }
  print(out.joined(separator: "\\t"))
}
`;
function buildDecoder() {
  const given = process.env.QR_VISION_BIN;          // --mutants 编一次，交给每个改坏版复用
  if (given) { if (!fs.existsSync(given)) envBad('QR_VISION_BIN 指的文件不在：' + given); return given; }
  if (!fs.existsSync('/usr/bin/swiftc')) envBad('没有 /usr/bin/swiftc，编不出 Vision 解码器');
  fs.mkdirSync(TMP, { recursive: true });
  const src = path.join(TMP, 'vision.swift'), bin = path.join(TMP, 'vision');
  fs.writeFileSync(src, SWIFT);
  const cc = spawnSync('/usr/bin/swiftc', ['-swift-version', '5', src, '-o', bin], { encoding: 'utf8', timeout: 300000 });
  if (cc.status !== 0 || !fs.existsSync(bin)) envBad('Swift 解码器编不出来：' + String(cc.stderr || cc.error || '').split('\n').slice(0, 3).join(' '));
  return bin;
}

// ── 反向对照：每次只改坏一处，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'), dir = path.join(HERE, '.tmp', 'qr-mutants-' + process.pid);
  const bin = buildDecoder(); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'mask-mismatch':     ['if (!F[y][x] && MASKS[m](x, y)) G[y][x] = !G[y][x];', 'if (!F[y][x] && MASKS[5](x, y)) G[y][x] = !G[y][x];'],   // 数据固定用掩码 5，格式信息照写挑中的那个
    'format-xor':        ['^ 0x5412', '^ 0x4445'],                                    // 格式信息的掩码写成 Micro QR 的
    'interleave-off':    ['for (let i = 0; i <= d1; i++) for (const [d] of blocks) if (i < d.length) words.push(d[i]);', 'for (const [d] of blocks) words.push(...d);'],
    'rs-generator':      ['next[j + 1] ^= mul(g[j], EXP[i]);', 'next[j + 1] ^= mul(g[j], EXP[i + 1]);'],   // 生成多项式的根从 α^1 起
    'no-version-info':   ['if (v >= 7) {', 'if (v >= 70) {'],
    'align-table':       ['[6, 24, 42]', '[6, 26, 46]'],                              // 8 版抄成 9 版的校正图形位置
    'utf8-as-latin1':    ['new TextEncoder().encode(String(text))', 'Uint8Array.from(String(text), (c) => c.charCodeAt(0) & 255)'],
    'count-bits-v10':    ['(v < 10 ? 8 : 16)', '(v < 11 ? 8 : 16)'],
    'block-table-v9':    ['[22, 3, 36, 2]', '[22, 2, 36, 3]'],
    // 下面几个照样解得出来（掩码挑得不好不影响扫），只有「掩码」那一段抓得到
    'penalty-n1-flat':   ['if (run === 5) s += 3; else if (run > 5) s++;', 'if (run === 5) s += 3;'],
    'penalty-n2-off':    ['p += 3;', 'p += 0;'],
    'penalty-n3-off':    ['s += 40;', 's += 0;'],
    'penalty-n4-off':    ['/ (n * n)) * 10;', '/ (n * n)) * 0;'],
    'mask-always-0':     ['const p = penalty(G);', 'const p = m;'],
    // SVG
    'svg-currentcolor':  ['<path fill="#000"', '<path fill="currentColor"'],
    'svg-no-merge':      ['let e = x; while (e + 1 < size && row[e + 1]) e++;', 'let e = x;'],
    'svg-quiet-fixed':   ['q = Math.max(0, Math.trunc(quiet) || 0)', 'q = 4'],
    'svg-skewed-cell':   ["'v1H' + (x + q) + 'z'", "'v1H' + (x + q + 1) + 'z'"],
    'svg-has-size':      ['shape-rendering="crispEdges">', 'shape-rendering="crispEdges" width="240" height="240">'],
  };
  const run = (file) => spawnSync(process.execPath, [SELF, file], { encoding: 'utf8', timeout: 180000, env: { ...process.env, QR_VISION_BIN: bin } });
  const lines = (r) => String(r.stdout || '').trim().split('\n');
  const base = run(SRC);
  if (base.status !== 0) { console.log('FAIL 原版自己就没过（退出码 ' + base.status + '）：' + lines(base).pop()); fs.rmSync(dir, { recursive: true, force: true }); finish(1); }
  console.log('原版：' + lines(base).pop());
  let caught = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.split(a).join(b));
    const r = run(f), out = lines(r), res = out.filter((l) => l.startsWith('结果：')).pop();
    const red = r.status === 1 && !!res && !/，0 没过$/.test(res);     // 崩了没跑完、环境不对（2）都不算抓到
    if (red) caught++;
    const [what, because = ''] = red ? out.find((l) => l.startsWith('  FAIL ')).slice(7).split('  → ') : [r.status === 2 ? out[0] : r.status === 0 ? '测试照样全过' : '没跑完：' + String(r.stderr || '').trim().split('\n').slice(-1)[0]];
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + what.slice(0, 36) + (what.length > 36 ? '…' : '') + (because ? ' → ' + because.slice(0, 90) : ''));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const n = Object.keys(M).length;
  console.log(n + ' 个改坏版，' + caught + ' 个被测试抓到');
  finish(caught === n ? 0 : 1);
}

const Q = await import(SRC);
const BIN = buildDecoder(); fs.mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const matrixOf = (text) => { try { return Q.qrMatrix(text); } catch (e) { return { error: String(e && e.message || e) }; } };

// ── 矩阵 → PNG：每个模块 8 像素、四周 4 模块白边、8 位灰度 ──
const CRC_T = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), b = Buffer.alloc(body.length + 8);
  b.writeUInt32BE(data.length, 0); body.copy(b, 4); b.writeUInt32BE(crc32(body), body.length + 4); return b;
};
function png(modules, scale = 8, quiet = 4) {
  const n = modules.length, w = (n + 2 * quiet) * scale, raw = Buffer.alloc((w + 1) * w, 255);
  for (let py = 0; py < w; py++) {
    raw[py * (w + 1)] = 0;                                   // 每行开头的过滤类型：0（不过滤）
    const y = Math.floor(py / scale) - quiet;
    for (let px = 0; px < w; px++) { const x = Math.floor(px / scale) - quiet; if (y >= 0 && y < n && x >= 0 && x < n && modules[y][x]) raw[py * (w + 1) + 1 + px] = 0; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 0;   // 8 位、灰度、不隔行
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── 要解的图，一次交给 Vision ──
const PAIR = 'https://desk-mac-mini-01.tail1a2b3c.ts.net/pair#';
const CAP_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];   // 字节模式 M 级每版最多几字节（ISO/IEC 18004 表 7），不读 qr.mjs 的表
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~:/?#=&%+';
const filler = (n, seed) => { let s = seed >>> 0, o = ''; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; o += ABC[(s >>> 16) % ABC.length]; } return o; };
const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
const cases = [];
const add = (group, label, text, extra = {}) => { const c = { group, label, text, m: extra.mat || matrixOf(text), ...extra }; cases.push(c); return c; };

const blank = add('ctl', '白纸（25×25 全白）', null, { mat: { size: 25, modules: Array.from({ length: 25 }, () => new Array(25).fill(false)) } });
const links = Array.from({ length: 5 }, () => PAIR + crypto.randomBytes(32).toString('base64url'));
const ref = matrixOf(links[0]);
const smeared = ref.modules && { size: ref.size, modules: ref.modules.map((row, y) => row.map((v, x) => (x >= 9 && x < ref.size - 9 && y >= 9 && y < ref.size - 9 ? !v : v))) };
const smear = add('ctl', '配对链接的图把中间一块（9…size-9）整块反色', links[0], { mat: smeared || ref });
for (const [i, s] of links.entries()) add('pair', '配对链接 #' + (i + 1), s);
for (let v = 1; v <= 10; v++) {
  const lo = v === 1 ? 1 : CAP_M[v - 2] + 1, hi = CAP_M[v - 1];
  add('ver', '第 ' + v + ' 版，' + lo + ' 字节（刚过上一版）', filler(lo, v * 101 + 1), { v });
  add('ver', '第 ' + v + ' 版，' + hi + ' 字节（正好装满）', filler(hi, v * 101 + 2), { v });
}
// 罚分规则 4（黑块比例）几乎从不改变挑中的掩码：11/17 拿 2000 条 1–213 字节的随机串比过，拿掉规则 4 一条都没换。
// 这 5 条是在 1–26 字节的随机短串里搜的，前 1703 条里拿掉规则 4 就换掩码的就是它们，写死在这里
for (const s of ['#JpZQBo%FjGrCpeR', '=0iFsndw8g_pZqAVDVhoN#lMC', 'H_E#AEZg/ajbowIexQt0Gy?v3', '/HRrX3t', 'ZN4atuKSTMUuV']) add('pen', '规则 4 起作用的串 ' + JSON.stringify(s), s);
add('zh', '「总控台配对 测试」', '总控台配对 测试');
add('zh', '中文 + 配对链接（多块交错的版本）', '手机配对：' + links[1] + '（用相机扫一下，总控台就连上了）');
add('zh', '四字节字符', '配对 📱✅ 好了');

const files = [];
for (const [i, c] of cases.entries()) if (c.m && c.m.modules) { c.file = path.join(TMP, 'c' + i + '.png'); fs.writeFileSync(c.file, png(c.m.modules)); files.push(c); }
const dec = spawnSync(BIN, files.map((c) => c.file), { encoding: 'utf8', timeout: 120000 });
const rows = String(dec.stdout || '').trim().split('\n').filter(Boolean);
if (dec.status !== 0 || rows.length !== files.length) envBad('Vision 解码器没给全结果（退出码 ' + dec.status + '，' + rows.length + ' / ' + files.length + ' 行）' + String(dec.stderr || '').slice(0, 200));
for (const r of rows) {
  const [i, count, ver, ecl, mask, b64] = r.split('\t');
  if (count === 'err') envBad('Vision 读图报错：第 ' + i + ' 张');
  Object.assign(files[Number(i)], { found: Number(count), ver: Number(ver), ecl, mask: Number(mask), got: b64 === '-' ? null : Buffer.from(b64, 'base64').toString('utf8') });
}
const show = (s) => (s == null ? '（没解出）' : JSON.stringify(s.length > 60 ? s.slice(0, 57) + '…' : s));
const verOf = (c) => c.m && c.m.size ? (c.m.size - 17) / 4 : NaN;
const decoded = (c) => !c.m.error && c.found === 1 && c.got === c.text && c.ver === verOf(c) && c.ecl === 'M';
const why = (c) => c.m.error ? 'qrMatrix 抛错：' + c.m.error : !c.found ? 'Vision 没找到码（矩阵是 ' + verOf(c) + ' 版）'
  : '找到 ' + c.found + ' 个，Vision 读出 ' + c.ver + '-' + c.ecl + '（矩阵是 ' + verOf(c) + ' 版），内容 ' + show(c.got) + '，应为 ' + show(c.text);

console.log('对照：Vision 真在解（这两条不过，后面的「解对了」都不算数）');
ok(crc32(Buffer.from('123456789')) === 0xcbf43926, '手写 CRC32 对上标准校验值 0xCBF43926', crc32(Buffer.from('123456789')).toString(16));
ok(blank.found === 0 && blank.got === null, blank.label + ' → Vision 什么都没找到', why(blank));
ok(!!smeared && smear.got !== smear.text, smear.label + ' → 解不出原文', why(smear));

console.log('\n真实形状的配对链接（' + bytesOf(links[0]) + ' 字节，token 每次随机）');
ok(links.every((s) => /^[A-Za-z0-9_-]{43}$/.test(s.slice(PAIR.length))), 'token 是 43 位 base64url');
for (const c of cases.filter((x) => x.group === 'pair')) ok(decoded(c), c.label + ' 解出来逐字相等（Vision 读到的版本号、纠错级别 M 都对得上）', why(c) + '  原文 ' + c.text);

console.log('\n1–10 每一版：长度落在那一版，Vision 读到的版本号一致、解对（7 版起有版本信息，4 版起多块交错）');
for (const c of cases.filter((x) => x.group === 'ver')) ok(c.m.size === 17 + 4 * c.v && decoded(c), c.label + ' → ' + c.m.size + '×' + c.m.size + '，解对', why(c));

console.log('\n中文 UTF-8');
for (const c of cases.filter((x) => x.group === 'zh')) ok(decoded(c), c.label + '（' + bytesOf(c.text) + ' 字节）解对', why(c));

// ── 掩码挑得对不对：Vision 读出这张图用的是第 k 个掩码。这里另写一遍功能区、8 个掩码公式（i 行 j 列，照标准表 10）、
//    M 级 8 条格式信息（标准附录 C 的原值，不算 BCH）和 4 条罚分（按字符串和正则数），把图换成另外 7 个掩码，
//    罚分最低（同分取编号小的）的必须正是 k。CoreImage 的生成器和标准罚分不一致（11/17 比过 300 条，四成掩码不同），不拿它当参照。 ──
const ALIGN_REF = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const DATA_BITS = [0, 208, 359, 567, 807, 1079, 1383, 1568, 1936, 2336, 2768];      // 数据区的格数（码字 × 8 + 余位）
const FORMAT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
const MASK_REF = [(i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0];
function funcMap(v) {
  const n = 17 + 4 * v, F = Array.from({ length: n }, () => new Array(n).fill(false));
  const box = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) F[r][c] = true; };
  box(0, 0, 9, 9); box(0, n - 8, 9, 8); box(n - 8, 0, 8, 9);                         // 三个定位图形 + 分隔符 + 格式信息（含暗块）
  for (const r of ALIGN_REF[v]) for (const c of ALIGN_REF[v]) if (!F[r][c]) box(r - 2, c - 2, 5, 5);   // 校正图形，压着定位图形的不画
  box(6, 0, 1, n); box(0, 6, n, 1);                                                 // 时序图形放在校正图形之后：先画它，第 6 行 / 列上的校正图形会被当成重叠跳过
  if (v >= 7) { box(0, n - 11, 6, 3); box(n - 11, 0, 3, 6); }                       // 版本信息
  return F;
}
const fmtCells = (n) => [                                                           // 格式信息从最高位起的 15 个位置，两份
  [...[0, 1, 2, 3, 4, 5, 7, 8].map((c) => [8, c]), [7, 8], ...[5, 4, 3, 2, 1, 0].map((r) => [r, 8])],
  [...[1, 2, 3, 4, 5, 6, 7].map((k) => [n - k, 8]), ...[8, 7, 6, 5, 4, 3, 2, 1].map((k) => [8, n - k])],
];
function score(G) {
  const n = G.length, lines = [...G.map((row) => row.map(Number).join('')), ...G.map((_, c) => G.map((row) => +row[c]).join(''))];
  let p = 0, dark = 0;
  for (const s of lines) {
    for (const m of s.matchAll(/0{5,}|1{5,}/g)) p += m[0].length - 2;                // N1：同色连着 5 个以上，3 + 多出的个数
    const pad = '0000' + s + '0000';                                                 // N3：1011101 前或后有 0000（两边补 4 格静区）
    for (let i = pad.indexOf('1011101'); i !== -1; i = pad.indexOf('1011101', i + 1)) if (pad.slice(i - 4, i) === '0000' || pad.slice(i + 7, i + 11) === '0000') p += 40;
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (G[r][c]) dark++;
    if (r < n - 1 && c < n - 1 && G[r][c] === G[r][c + 1] && G[r][c] === G[r + 1][c] && G[r][c] === G[r + 1][c + 1]) p += 3;   // N2
  }
  return p + Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;              // N4
}
function maskCheck(c) {
  const v = verOf(c), k = c.mask, G = c.m.modules, n = c.m.size, F = funcMap(v), cells = fmtCells(n);
  const nData = F.flat().filter((f) => !f).length;
  if (nData !== DATA_BITS[v]) return '另写的功能区算出数据区 ' + nData + ' 格，标准是 ' + DATA_BITS[v] + '（是这里写错了）';
  const fmt = cells.map((cs) => cs.map(([r, cc]) => +G[r][cc]).join(''));
  if (fmt[0] !== FORMAT_M[k] || fmt[1] !== FORMAT_M[k]) return '格式信息两份是 ' + fmt.join(' / ') + '，M-' + k + ' 应为 ' + FORMAT_M[k];
  const pens = MASK_REF.map((mj, j) => {
    const H = G.map((row, r) => row.map((d, cc) => (F[r][cc] || MASK_REF[k](r, cc) === mj(r, cc) ? d : !d)));
    for (const cs of cells) cs.forEach(([r, cc], b) => { H[r][cc] = FORMAT_M[j][b] === '1'; });
    return score(H);
  });
  const best = pens.indexOf(Math.min(...pens));
  return best === k ? '' : '用的是掩码 ' + k + '，8 个掩码的罚分 ' + pens.join(' / ') + '，最低是 ' + best;
}
console.log('\n掩码：格式信息等于标准表的原值，用的正是另写的罚分算出来最低的那个');
const seen = files.filter((c) => c.group !== 'ctl' && c.got === c.text && c.mask >= 0);
const want = cases.filter((c) => c.group !== 'ctl').length;
ok(seen.length === want && want >= 33, '上面 ' + want + ' 张该解对的图（含 5 条规则 4 起作用的串）都解对了、Vision 报了掩码，一张不少地拿来核', seen.length + ' 张');
const bad = seen.map((c) => [c, maskCheck(c)]).filter(([, e]) => e);
ok(!bad.length, seen.length + ' 张图逐张核：格式信息两份都等于 M-k 的原值，k 是 8 个掩码里罚分最低的', bad.slice(0, 2).map(([c, e]) => c.label + '：' + e).join('；'));
const masks = [...new Set(seen.map((c) => c.mask))].sort();
ok(masks.length >= 6, '这些图用到的掩码不止一两种（' + masks.join(' ') + '）');

console.log('\n装不下就抛错，错误里是字节数');
const err = (s) => { const r = matrixOf(s); return r.error || ''; };
ok(/装不下/.test(err('x'.repeat(300))) && /300 字节/.test(err('x'.repeat(300))), '300 字节 → 抛「二维码装不下：300 字节」', err('x'.repeat(300)) || '没抛');
ok(/214 字节/.test(err('x'.repeat(214))) && !err('x'.repeat(213)), '213 字节还装得下，214 字节抛错', err('x'.repeat(214)) || '没抛');
ok(/300 字节/.test(err('配'.repeat(100))), '100 个汉字按 UTF-8 算 300 字节（数的是字节不是字）', err('配'.repeat(100)) || '没抛');

console.log('\n确定性和矩阵的形状');
const again = matrixOf(links[0]);
ok(!ref.error && JSON.stringify(ref) === JSON.stringify(again), '同一输入两次 qrMatrix 完全相同');
ok(!ref.error && ref.modules.length === ref.size && ref.modules.every((r) => r.length === ref.size && r.every((v) => v === true || v === false)), 'modules 是 size×size 的布尔值');
let svgA = '', svgB = '';
try { svgA = Q.qrSvg(links[0]); svgB = Q.qrSvg(links[0]); } catch (e) { svgA = 'threw ' + e.message; }
ok(svgA && svgA === svgB, '同一输入两次 qrSvg 完全相同', svgA.slice(0, 80));

// ── SVG：结构 + 把 path 当几何读回来（每个子路径必须是横平竖直、落在整数格上的矩形） ──
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
function pathRects(d) {
  const t = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [], polys = []; let x = 0, y = 0, pts = [], c = '';
  const close = () => { if (pts.length) polys.push(pts); pts = []; };
  for (let i = 0; i < t.length;) {
    if (/[A-Za-z]/.test(t[i])) { c = t[i++]; if (/[ZzMm]/.test(c)) close(); continue; }
    const n = () => Number(t[i++]);
    if (c === 'M') { x = n(); y = n(); c = 'L'; } else if (c === 'm') { x += n(); y += n(); c = 'l'; }
    else if (c === 'L') { x = n(); y = n(); } else if (c === 'l') { x += n(); y += n(); }
    else if (c === 'H') x = n(); else if (c === 'h') x += n(); else if (c === 'V') y = n(); else if (c === 'v') y += n();
    else throw new Error('path 里有认不出的命令 ' + c);
    pts.push([x, y]);
  }
  close();
  return polys.map((p) => {
    const xs = [...new Set(p.map((q) => q[0]))].sort((a, b) => a - b), ys = [...new Set(p.map((q) => q[1]))].sort((a, b) => a - b);
    const axis = p.every((q, k) => { const r = p[(k + 1) % p.length]; return q[0] === r[0] || q[1] === r[1]; });
    if (xs.length !== 2 || ys.length !== 2 || !axis || ![...xs, ...ys].every(Number.isInteger)) throw new Error('子路径不是整数格上的矩形：' + JSON.stringify(p));
    return [xs[0], ys[0], xs[1], ys[1]];
  });
}
function checkSvg(svg, m, q) {
  const N = m.size + 2 * q, open = (svg.match(/^<svg\b[^>]*>/) || [''])[0], sa = attrs(open);
  const rects = [...svg.matchAll(/<rect\b[^>]*>/g)].map((x) => attrs(x[0])), paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((x) => attrs(x[0]));
  const bad = [];
  if (sa.viewBox !== '0 0 ' + N + ' ' + N) bad.push('viewBox 是 ' + sa.viewBox + '，应为 0 0 ' + N + ' ' + N);
  if (sa['shape-rendering'] !== 'crispEdges') bad.push('没有 shape-rendering="crispEdges"');
  if ('width' in sa || 'height' in sa) bad.push('<svg> 写了宽高');
  if (!/<\/svg>$/.test(svg)) bad.push('不是以 </svg> 结尾');
  if (rects.length !== 1 || rects[0].fill !== '#fff' || rects[0].width !== String(N) || rects[0].height !== String(N) || +(rects[0].x || 0) || +(rects[0].y || 0)) bad.push('白底 rect 不对：' + JSON.stringify(rects));
  if (paths.length !== 1 || paths[0].fill !== '#000') bad.push('黑块不是正好一条 fill="#000" 的 path');
  if (/currentColor/i.test(svg)) bad.push('用了 currentColor');
  if (/<script/i.test(svg)) bad.push('有 <script');
  if (bad.length) return bad.join('；');
  let rs; try { rs = pathRects(paths[0].d); } catch (e) { return e.message; }
  const G = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const [x0, y0, x1, y1] of rs) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (y < 0 || x < 0 || y >= N || x >= N) return '黑块画到 viewBox 外面了'; G[y][x]++; }
  let diff = 0, runs = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inside = y >= q && x >= q && y < q + m.size && x < q + m.size, want = inside && m.modules[y - q][x - q];
    if (G[y][x] > 1) return '有格子被画了两遍';
    if (G[y][x] !== (want ? 1 : 0)) diff++;
    if (want && !(x > q && m.modules[y - q][x - q - 1])) runs++;
  }
  if (diff) return diff + ' 格和 qrMatrix 不同';
  if (rs.length !== runs) return '子路径 ' + rs.length + ' 段，同一行相邻黑块合并后应是 ' + runs + ' 段';
  return '';
}
console.log('\nqrSvg');
for (const [q, opt] of [[4, undefined], [2, { quiet: 2 }], [0, { quiet: 0 }]]) {
  let svg = '', e = '';
  try { svg = opt ? Q.qrSvg(links[0], opt) : Q.qrSvg(links[0]); } catch (x) { e = '抛错：' + x.message; }
  e = e || (ref.error ? 'qrMatrix 抛错' : checkSvg(svg, ref, q));
  ok(!e, (opt ? 'quiet ' + q : '默认 quiet 4') + '：viewBox、白底 rect、一条黑 path、没有 currentColor / <script / 宽高，path 读回矩阵和 qrMatrix 逐格相同、横向相邻合成一段（' + svg.length + ' 字）', e);
}

if (pass + fail === 0) ok(false, '一条断言都没跑');
console.log('\n结果：' + pass + ' 过，' + fail + ' 没过');
finish(fail ? 1 : 0);
