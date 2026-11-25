/**
 * [INPUT]: 依赖 node:http / fs / path / crypto；不依赖 server.mjs 的任何状态
 * [OUTPUT]: 对外提供 startPreview({ port, home（canon 过的主目录）, log }) → { register(file), registerMany(files), registerCanvas(files), port() }；canon(路径)（真身：收掉链接、大小写、firmlink 别名）、isTop(真身)（顶层，纯函数）、homeIds(主目录)、idOf(路径)、FIRM（本机预览和 server.mjs 的远程预览共用这一份）；kindOf(ext)（能预览的类型：page / pdf / image / video / audio / text / markdown；register 对「多半是图 / 视频的文件夹」另回 gallery，图集不成立、第一层有 2 个以上网页的文件夹回 canvas）；listCanvas(dir)（画布的规则，纯函数）；ESC_HOOK（发 HTML 时加在末尾的 Esc 转发脚本）；mimeOf(ext)、readText(真身, 大小[, 已打开的 fd])、serveFile(req, res, 文件（可带已打开、核过的 fd）, 额外的头)、TEXT_MAX：远程预览（server.mjs 的 /rp/ 和 /api/remote/preview）用同一套类型表、文本上限和发文件的头
 * [POS]: 总控台「内置预览」的唯一出口。server.mjs 的 /api/preview 调 register()、registerMany() 或 registerCanvas() 拿网址和类型，ui.html 按类型显示：网页、PDF 用 iframe，图和音视频用自己的元素，文本由 register() 直接读出内容，gallery（文件夹 / 一批图）排成格子墙，canvas（文件夹 / 一批网页）活着摆在一张画布上。
 *        预览页跑在另一个端口（另一个源），所以页面里的脚本读不到总控台的口令、localStorage 和 /api；
 *        网址里的随机编号就是钥匙：一个编号只开一个文件夹，只发白名单里的文件类型，不进点开头的文件夹，不顺着符号链接出去。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ───────────── 发哪些文件 ─────────────
// 什么文件能预览、按哪一类显示（11/15 Khalil：「访达里的这种文件预览，也直接在我们的 APP 里打开」）。不在表里的（Word、Excel、Keynote、程序）照旧交给系统打开。
// 网址只发 MIME 表里的类型：网页引用的 CSS、脚本、字体也走它；文本类不走网址，内容由 register() 直接读给界面。
const KIND = {
  page: ['html', 'htm'], pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'heic', 'heif', 'tif', 'tiff'],
  video: ['mp4', 'm4v', 'mov', 'webm'], audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aif', 'aiff'],
  markdown: ['md', 'markdown'],
  text: ['txt', 'json', 'csv', 'tsv', 'log', 'srt', 'vtt', 'yaml', 'yml', 'toml', 'ini', 'xml', 'py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'sh', 'zsh', 'swift', 'css', 'sql', 'diff', 'patch'],
};
const KIND_OF = Object.fromEntries(Object.entries(KIND).flatMap(([k, exts]) => exts.map((e) => [e, k])));
export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || null;
const TEXT_MAX = 1024 * 1024;                     // 文本类最多读 1 MiB 给界面，再大的只看开头
const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', aif: 'audio/aiff', aiff: 'audio/aiff',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf',
};
const KEEP = 64;                                  // 最多记住 64 个预览；再多就忘掉最早的那个
// 图集（11/15 Khalil：「直接把这些照片做成一个合集，我就不要一个一个去点开」「打开预览的时候，不想切到外面去看」）：
// 点一个文件夹、或一条交付里提到的好几张图，在总控台里排成一面格子墙。只放图和视频；一个图集最多 GALLERY_MAX 个。
const GALLERY_MAX = 200;
// 文件夹要「多半是图 / 视频」才当图集：至少 2 个，且占这个文件夹里文件的 60% 以上。
// 不然 ~/Projects/某项目/ 里只要躺着一个 logo.png，他点文件夹想进访达，却看到一面只有 logo 的墙。
const GALLERY_MIN = 2, GALLERY_SHARE = 0.6;
const isMedia = (kind) => kind === 'image' || kind === 'video';

// 焦点在预览页里时，按键只到预览页，到不了总控台（两个源）。所以发 HTML 时在末尾加这一小段：
// 页面自己没用掉的 Esc（没 preventDefault）告诉父页面，由总控台关预览。磁盘上的文件不动。
// 挂在 window 的冒泡阶段：页面自己在元素、document 上的 Esc 处理先跑，它拦下了就不关。
export const ESC_HOOK = '<script>addEventListener("keydown",function(e){if(e.key==="Escape"&&!e.defaultPrevented&&parent!==window)parent.postMessage({ccb:"preview-esc"},"*")});</script>';
function withHook(html) {
  const i = html.toLowerCase().lastIndexOf('</body');   // 最后一个 </body> 前面；没有就接在末尾
  return i < 0 ? html + ESC_HOOK : html.slice(0, i) + ESC_HOOK + html.slice(i);
}

const inside = (root, p) => p === root || p.startsWith(root + path.sep);
// ── 真身和「哪些文件夹不往下钻」：本机预览（这个文件）和手机远程预览（server.mjs 的 rpResolve / rpGallery）共用这一份（11/25 起）。
// 之前两边各一份：远程 11/22 修了大小写和 firmlink，本机这边还是 JS 版 realpathSync + 按字面比主目录，交付里把主目录换个大小写、或写成 firmlink 写法就拿到往下钻的钥匙。
export const FIRM = '/System/Volumes/Data';               // macOS 的数据卷：/Users、/private、/Volumes 这些在它下面另有一份同一个东西的写法（firmlink）
export const idOf = (p) => { try { const s = fs.statSync(p, { bigint: true }); return s.dev + ':' + s.ino; } catch { return ''; } };
// 真身：realpathSync.native 收掉链接和大小写（JS 版 realpathSync 照抄给的大小写）；firmlink 别名它收不掉，去掉前缀后是同一个东西（dev+ino）就用去掉前缀的那个。不在就抛错
export function canon(p) {
  const r = fs.realpathSync.native(p);
  if (!r.startsWith(FIRM + '/')) return r;
  const id = idOf(r);
  try { const t = fs.realpathSync.native(r.slice(FIRM.length)); if (id && idOf(t) === id) return t; } catch {}
  return r;
}
// 顶层：只看字符串的纯函数，dir 要是 canon() 给的真身。去掉 FIRM 前缀后，/private 和 /Volumes 下面 3 段以内（/private/tmp、外接盘根 /Volumes/T7）、
// 其余 2 段以内（/tmp、/Users、/）算顶层；数据卷下没有短写法的也按去掉前缀算（/System/Volumes/Data/mnt 也是顶层）
export function isTop(dir) {
  const top = dir === FIRM ? '/' : dir.startsWith(FIRM + '/') ? dir.slice(FIRM.length) : dir;
  return top.split(path.sep).length <= (/^\/(private|Volumes)\//.test(top) ? 3 : 2);
}
// 主目录和它的上层：[主目录, 上一级, …, /] 的 dev+ino，按 dev+ino 比（换大小写、firmlink 别名都认得出），每次现查。home 要是 canon() 给的真身
export const homeIds = (home) => { const ids = []; for (let a = home; ; a = path.dirname(a)) { ids.push(idOf(a)); if (a === path.dirname(a)) return ids; } };

// 手机远程（C1，11/21）也用这几样：远程端口发对话里出现过的单个文件时，类型表、文本上限、发法（Range、HTML 加 Esc 那段）和本机一样
export const mimeOf = (ext) => MIME[String(ext).toLowerCase()] || null;
export { TEXT_MAX };
export function readText(real, size, fd0) {      // 文本类最多读 TEXT_MAX 给界面；读不了回 null。fd0：调用方已经打开、核过的 fd（远程预览），从它读、不关
  const buf = Buffer.alloc(Math.min(size, TEXT_MAX)); let fd = fd0;
  try { if (fd === undefined) fd = fs.openSync(real, 'r'); fs.readSync(fd, buf, 0, buf.length, 0); } catch { return null; } finally { if (fd0 === undefined && fd !== undefined) fs.closeSync(fd); }
  return { text: buf.toString('utf8'), truncated: size > TEXT_MAX };
}
// f = { real, type, size, fd? }；extra 是另加的响应头（远程加 CSP 沙盒）。
// f.fd（远程预览，11/22）：调用方已经打开、核过是同一个文件的 fd，从它读、发完关掉，不再按 f.real 打开；没有 fd 时和以前一样按路径打开（本机预览）
export function serveFile(req, res, f, extra = {}) {
  const own = f.fd !== undefined, done = () => { if (own) try { fs.closeSync(f.fd); } catch {} };
  const head = {
    'content-type': f.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',            // 页面去外网取东西时不把带编号的网址带出去
    'accept-ranges': 'bytes', ...extra,
  };
  if (f.type.startsWith('text/html')) {          // 网页整份发（不按段），末尾带上 Esc 的那一小段
    let body; try { body = Buffer.from(withHook(fs.readFileSync(own ? f.fd : f.real, 'utf8')), 'utf8'); } catch { done(); res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); return res.end('404'); }
    done();
    delete head['accept-ranges']; head['content-length'] = body.length;
    res.writeHead(200, head); return res.end(req.method === 'HEAD' ? undefined : body);
  }
  // 音视频要按段取（WebKit 的 <video> / <audio> 先要 bytes=0-1，不回 206 就不播）
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = f.size - 1, code = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); } else { start = Math.max(0, f.size - +m[2]); }
    if (start > end || start >= f.size) { done(); res.writeHead(416, { 'content-range': `bytes */${f.size}` }); return res.end(); }
    code = 206; head['content-range'] = `bytes ${start}-${end}/${f.size}`;
  }
  head['content-length'] = f.size ? end - start + 1 : 0;
  res.writeHead(code, head);
  if (req.method === 'HEAD' || !f.size) { done(); return res.end(); }
  const rs = fs.createReadStream(f.real, own ? { fd: f.fd, start, end } : { start, end });   // 给了 fd 时读它、读完自己关（autoClose）
  if (own) res.on('close', () => rs.destroy());
  rs.on('error', () => res.destroy()).pipe(res);
}

// 一个文件夹里能排成图集的图和视频（本机预览的 gallery() 和手机远程的文件夹图集共用，C1.1）。只看第一层；点开头的不列；
// 达标线：至少 GALLERY_MIN 个、占文件的 GALLERY_SHARE 以上；按数字排，最多 GALLERY_MAX 个。
// direct：只认文件夹里真放着的文件（真身就是 文件夹/名字，链接一律不列）；不给时和本机一样，链接指到文件夹里面的照列
export function listGallery(dir, { direct = false } = {}) {
  let names; try { names = fs.readdirSync(dir); } catch { return { error: 'missing' }; }
  let files = 0; const media = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    let real, st; try { real = canon(path.join(dir, name)); st = fs.statSync(real); } catch { continue; }
    if (!st.isFile()) continue;
    files++;
    const kind = kindOf(path.extname(real).slice(1));
    if (isMedia(kind) && (direct ? real === path.join(dir, name) : inside(dir, real))) media.push({ name, kind, real });
  }
  if (media.length < GALLERY_MIN || media.length < files * GALLERY_SHARE) return { error: 'no-preview' };
  media.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));   // 01、02、…、10：按数字排，不是按字母排
  const shown = media.slice(0, GALLERY_MAX);
  return { total: media.length, truncated: media.length > shown.length, media: shown };
}

// 画布（11/24 定：默认摆成画布；网格版另放一个按钮）：一次交付里有 2 个以上网页时，
// 所有网页按真尺寸活着摆在一张画布上，点一个推近（界面在 ui.html 的 renderCanvas）。这里只定「哪些网页、叫什么、按手机还是浏览器的框摆」。
const CANVAS_MIN = 2, CANVAS_MAX = 12;            // 至少 2 个网页才摆画布；最多 12 个活的 iframe，多出来的只报个数（more）
const CANVAS_HEAD = 64 * 1024;                    // 每页只读开头 64 KiB 取标题和说明：几 MB 的单文件网页不整份读
const PHONE_NAME = /phone|mobile|(?<![a-z])ios(?![a-z])|手机/i;      // 没写 <meta name="ccb:frame"> 时，文件名里有这几个词就按手机框摆；ios 只认整词（scenarios、studios 不算）
const isPage = (kind) => kind === 'page';
const byNumber = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });   // v2 在 v10 前面
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', middot: '·', hellip: '…' };
const ch = (n) => (n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : '');
const unent = (t) => t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, x, w) => (d ? ch(+d) : x ? ch(parseInt(x, 16)) : Object.hasOwn(NAMED, w.toLowerCase()) ? NAMED[w.toLowerCase()] : m));   // 只认 NAMED 自己的键：&constructor; 这种原型上的名字照原样留着
const clean = (t, n) => Array.from(unent(String(t || '')).replace(/\s+/g, ' ').trim()).slice(0, n).join('');   // 按字符截（Array.from），不切半个 emoji
// 一页的标签：<title>、<meta name="description">、<meta name="ccb:frame">（phone / browser）。只看开头 CANVAS_HEAD 字节；读不了回 null
export function pageMeta(real, name = path.basename(real)) {
  const buf = Buffer.alloc(CANVAS_HEAD); let n = 0, fd;
  try { fd = fs.openSync(real, 'r'); n = fs.readSync(fd, buf, 0, CANVAS_HEAD, 0); } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  const head = buf.subarray(0, n).toString('utf8');
  const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const at = {}; for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) at[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4];
    const k = (at.name || '').toLowerCase(); if (k && at.content !== undefined && !(k in meta)) meta[k] = at.content;
  }
  const fr = String(meta['ccb:frame'] || '').trim().toLowerCase();
  return { title: t ? clean(t[1], 160) : '', note: clean(meta.description, 240), frame: fr === 'phone' || fr === 'browser' ? fr : PHONE_NAME.test(name) ? 'phone' : 'browser' };
}
// 「这一层的版本」：名字是 vN.html / vN.htm，真身是网页、在这个文件夹里、是普通文件；几个名字指到同一个真身（v2 链到 v1）只算一个，留按数字排在前面的名字。
// 链到 .txt 的 vN.html 不算（不然两个链到文本的 vN 就让比例门槛失效）。versionsOf() 和 listCanvas() 的版本例外共用这一个判断；回按数字排的文件名
const VERSION = /^v\d+\.html?$/i;
function versionsIn(root, names) {
  const seen = new Set(), out = [];
  for (const n of names.filter((x) => VERSION.test(x)).sort(byNumber)) {
    let r; try { r = canon(path.join(root, n)); if (!fs.statSync(r).isFile()) r = null; } catch { r = null; }
    if (r && inside(root, r) && isPage(kindOf(path.extname(r).slice(1))) && !seen.has(r)) { seen.add(r); out.push(n); }
  }
  return out;
}
// 一个文件夹能不能摆成画布（本机预览的 canvas() 用）。不管图集，调用方先问 gallery()（folder() 就是这样），这里不再扫一遍图。
// 只看第一层的 .html / .htm；点开头的不列；符号链接要真身还在这个文件夹里才算网页。这一层有 package.json 或 .git 的不摊开（不把整个项目仓库摊开）。
// 成为画布：至少 CANVAS_MIN 个网页，并且网页占第一层文件（不算点开头的、不算文件夹）的一半以上，或者这一层有 CANVAS_MIN 个以上 vN.html
// （版本文件夹：旁边常放 SPEC.md、STATE.md 和脚本，不受比例限制）。~/Desktop 这种放成品的地方网页占不到一半，照旧进访达。按数字排，最多 CANVAS_MAX 个，多出来的写进 more。
// dir 要是真身（register 给的就是）：比的是 realpath 以后还在不在 dir 里面
export function listCanvas(dir) {
  let names; try { names = fs.readdirSync(dir); } catch { return { error: 'missing' }; }
  if (names.includes('package.json') || names.includes('.git')) return { error: 'no-preview' };
  const pages = []; let files = 0;
  for (const name of names) {
    if (name[0] === '.') continue;                                     // 点开头的（.DS_Store、.env）不摆，也不算进文件数
    let real, st; try { real = canon(path.join(dir, name)); st = fs.statSync(real); } catch { continue; }
    if (!st.isFile()) continue;
    files++;
    if (isPage(kindOf(path.extname(real).slice(1))) && inside(dir, real)) pages.push({ name, real });
  }
  if (pages.length < CANVAS_MIN) return { error: 'no-preview' };
  const versions = versionsIn(dir, names).length;
  if (!(pages.length * 2 > files || versions >= CANVAS_MIN)) return { error: 'no-preview' };   // 网页没过半，又不是版本文件夹
  pages.sort((a, b) => byNumber(a.name, b.name));
  const shown = pages.slice(0, CANVAS_MAX).map((p) => ({ ...p, ...(pageMeta(p.real, p.name) || { title: '', note: '', frame: PHONE_NAME.test(p.name) ? 'phone' : 'browser' }) }));
  return { total: pages.length, more: pages.length - shown.length, pages: shown };
}
// 一页是 vN.html 时，同一层的 v1…vK（ui-workbench 的版本，11/24 SPEC 入口第 3 条「并排看全部版本」）：按数字排的文件名；不到 2 个回 null。
// 超过 CANVAS_MAX 个时留最新的 CANVAS_MAX 个（比版本，最新的那几个最要紧）
function versionsOf(root, entry) {
  if (!VERSION.test(entry)) return null;
  let names; try { names = fs.readdirSync(root); } catch { return null; }
  const vs = versionsIn(root, names);
  return vs.length >= CANVAS_MIN ? vs.slice(-CANVAS_MAX) : null;
}

export function startPreview({ port, home, log = () => {} }) {
  const byId = new Map();                         // 编号 → { root, entry, shallow }
  const byFile = new Map();                       // 文件真身 → 编号（同一个文件再点，网址不变）
  let bound = 0;

  // 页面就在主目录或更上层（/Users、/）、或者在顶层（/tmp 的真身 /private/tmp、外接盘根 /Volumes/T7）时，只发和它同一层的文件，不往下钻：
  // 不然一张页面就能读走整个主目录、整块盘。主目录和上层按 dev+ino 比，顶层看 isTop，和远程预览是同一份；root 是 canon() 给的真身，home 是 server.mjs 传来的真身
  const isShallow = (root) => homeIds(home).includes(idOf(root)) || isTop(root);
  const evict = () => { while (byId.size > KEEP) { const old = byId.keys().next().value; const it = byId.get(old); byId.delete(old); byFile.delete(path.join(it.root, it.entry)); } };
  // 一个文件夹一把钥匙：图集里这个文件夹的每一张图共用它（entry 空着，byFile 的键就是文件夹自己）
  function claimDir(root) {
    let id = byFile.get(root);
    if (!id || !byId.has(id)) { id = crypto.randomBytes(16).toString('hex'); byId.set(id, { root, entry: '', shallow: isShallow(root) }); byFile.set(root, id); evict(); }
    return id;
  }
  const mediaUrl = (id, name) => `http://127.0.0.1:${bound}/${id}/${encodeURIComponent(name)}`;

  // 一个文件夹 → 图集。多半是图 / 视频才算（见 GALLERY_SHARE）；主目录、/tmp 这种顶层不当图集。
  // 列文件的规矩和 resolve() 一致：点开头的不列，符号链接指到文件夹外面的不列（列出来也是 404）。
  function gallery(dir) {
    if (!bound) return { ok: false, error: 'not-ready' };
    if (isShallow(dir)) return { ok: false, error: 'no-preview' };
    const g = listGallery(dir); if (g.error) return { ok: false, error: g.error };
    const id = claimDir(dir);
    return { ok: true, kind: 'gallery', name: path.basename(dir), dir, total: g.total, truncated: g.truncated,
      items: g.media.map((m) => ({ name: m.name, kind: m.kind, url: mediaUrl(id, m.name) })) };
  }

  // 一批文件 → 图集（一条交付里写了好几个图片路径）。不在了的、不是图 / 视频的、点开头的跳过，同一个文件只放一次；
  // 同一个文件夹里的图共用一把钥匙。
  function registerMany(files) {
    if (!bound) return { ok: false, error: 'not-ready' };
    const seen = new Set(), items = []; let skipped = 0;
    for (const f of files) {
      let real, st; try { real = canon(f); st = fs.statSync(real); } catch { skipped++; continue; }
      const kind = kindOf(path.extname(real).slice(1)), name = path.basename(real);
      if (!st.isFile() || !isMedia(kind) || name.startsWith('.')) { skipped++; continue; }
      if (seen.has(real)) continue; seen.add(real);
      if (items.length < GALLERY_MAX) items.push({ name, kind, url: mediaUrl(claimDir(path.dirname(real)), name), dir: path.dirname(real) });
    }
    if (!items.length) return { ok: false, error: 'no-preview' };
    return { ok: true, kind: 'gallery', total: seen.size, truncated: seen.size > items.length, skipped, items };
  }

  // 一个文件夹 → 画布（图集不成立时才问到这里）。和 gallery() 一样：主目录、/tmp 这种顶层不摊开；一个文件夹一把钥匙，每页的网址走预览端口（发 HTML 时带 ESC_HOOK）
  function canvas(dir) {
    if (!bound) return { ok: false, error: 'not-ready' };
    if (isShallow(dir)) return { ok: false, error: 'no-preview' };   // 主目录、/tmp 不摊开
    const c = listCanvas(dir); if (c.error) return { ok: false, error: c.error };
    const id = claimDir(dir);
    return { ok: true, kind: 'canvas', name: path.basename(dir), dir, total: c.total, more: c.more,
      items: c.pages.map((p) => ({ name: p.name, title: p.title, note: p.note, frame: p.frame, url: mediaUrl(id, p.name), dir })) };
  }
  // 文件夹：先看是不是图集，图集不成立（no-preview）再看是不是画布；别的错（not-ready、missing）照原样回
  const folder = (dir) => { const g = gallery(dir); return g.ok || g.error !== 'no-preview' ? g : canvas(dir); };

  // 一批文件 → 画布（一条交付里写了好几个网页路径，界面的「画布 · N 个」）。一张画布 = 一个文件夹 = 一把钥匙：画布上的 iframe 同源、没有 sandbox，
  // 一个网页读得到兄弟 iframe 的网址，网址里就是那个文件夹的钥匙，所以只摆同一个文件夹（按真身）里的网页。按真身所在的文件夹分组，摆网页最多的那组
  // （一样多时取正文里先出现的那组）；别的文件夹的网页不发钥匙、不读标题，只把个数写进 otherDirs。
  // 组里按给的顺序摆（和 registerMany 一样，正文里怎么排就怎么摆）；不在了的、不是网页的、点开头的跳过，同一个文件只放一次，最多 CANVAS_MAX 个。
  // 摆不出 2 个回 no-preview；网页够数、只是分在几个文件夹里时带 split（服务据此说明为什么）
  function registerCanvas(files) {
    if (!bound) return { ok: false, error: 'not-ready' };
    const seen = new Set(), groups = new Map(); let skipped = 0;
    for (const f of files) {
      let real, st; try { real = canon(f); st = fs.statSync(real); } catch { skipped++; continue; }
      const name = path.basename(real), dir = path.dirname(real);
      if (!st.isFile() || !isPage(kindOf(path.extname(real).slice(1))) || name.startsWith('.')) { skipped++; continue; }
      if (seen.has(real)) continue;                                  // 同一个文件只放一次
      seen.add(real);
      let g = groups.get(dir); if (!g) groups.set(dir, (g = []));    // 按真身所在的文件夹分组
      g.push({ name, real, dir });
    }
    let pick = [];
    for (const g of groups.values()) if (g.length > pick.length) pick = g;   // Map 按放进去的顺序走；用 > 不用 >=：一样多时留先出现的那组
    const keep = []; let more = 0;
    for (const p of pick) {
      if (keep.length >= CANVAS_MAX) { more++; continue; }
      const m = pageMeta(p.real, p.name); if (!m) { skipped++; continue; }   // 读不了的跳过，后面的补上
      keep.push({ ...p, m });
    }
    if (keep.length < CANVAS_MIN) return { ok: false, error: 'no-preview', split: groups.size > 1 && seen.size >= CANVAS_MIN };
    return { ok: true, kind: 'canvas', total: keep.length + more, more, otherDirs: seen.size - pick.length, skipped,
      items: keep.map((p) => ({ name: p.name, ...p.m, url: mediaUrl(claimDir(p.dir), p.name), dir: p.dir })) };
  }

  // 一个文件 → 预览网址和类型。只认真实存在、类型在 KIND 表里的普通文件，按符号链接的真身算。文本类顺带读出内容（最多 TEXT_MAX）。
  // 文件夹交给 folder()：多半是图 / 视频的是图集，第一层网页过半（或有 2 个以上 vN.html）的是画布，其余照旧 no-preview，界面改走 /api/open。
  function register(file) {
    let real, st;
    try { real = canon(file); st = fs.statSync(real); } catch { return { ok: false, error: 'missing' }; }
    const kind = st.isFile() ? kindOf(path.extname(real).slice(1)) : null;
    if (!kind) return st.isDirectory() ? folder(real) : { ok: false, error: 'no-preview' };
    if (!bound) return { ok: false, error: 'not-ready' };
    let id = byFile.get(real);
    if (!id || !byId.has(id)) {
      id = crypto.randomBytes(16).toString('hex');
      const root = path.dirname(real);
      byId.set(id, { root, entry: path.basename(real), shallow: isShallow(root) }); byFile.set(real, id);
      evict();
    }
    const it = byId.get(id);
    const r = { ok: true, kind, url: `http://127.0.0.1:${bound}/${id}/${encodeURIComponent(it.entry)}`, name: it.entry, dir: it.root };
    if (kind === 'text' || kind === 'markdown') {
      const t = readText(real, st.size); if (!t) return { ok: false, error: 'missing' };
      r.text = t.text; r.truncated = t.truncated;
    }
    if (kind === 'page') { const vs = versionsOf(it.root, it.entry); if (vs) r.versions = vs; }   // vN.html 有兄弟版本：界面顶栏放「并排看全部版本」
    return r;
  }

  // 请求路径 /<编号>/<文件夹里的相对路径> → 磁盘上的真身；不合规矩的一律 null（对外都是 404，不说为什么）
  function resolve(pathname) {
    const segs = pathname.split('/').slice(1);
    const it = byId.get(segs.shift());
    if (!it || !segs.length) return null;
    let parts;
    try { parts = segs.map((s) => decodeURIComponent(s)); } catch { return null; }
    if (parts.some((s) => !s || s.startsWith('.') || /[\\/\0]/.test(s))) return null;   // 空段、..、点开头的（.git、.env、.ssh）都不发
    if (it.shallow && parts.length > 1) return null;
    let real;
    try { real = canon(path.join(it.root, ...parts)); } catch { return null; }
    if (!inside(it.root, real)) return null;                                          // 符号链接指到文件夹外面
    const type = MIME[path.extname(real).slice(1).toLowerCase()];
    let st; try { st = fs.statSync(real); } catch { return null; }
    return type && st.isFile() ? { real, type, size: st.size } : null;
  }

  const server = http.createServer((req, res) => {
    const nope = (code) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(String(code)); };
    if (req.headers.host !== '127.0.0.1:' + bound && req.headers.host !== 'localhost:' + bound) return nope(403);   // 挡 DNS 重绑定
    if (req.method !== 'GET' && req.method !== 'HEAD') return nope(405);
    const f = resolve(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!f) return nope(404);
    serveFile(req, res, f);
  });

  // 端口被占（比如两份服务同时开着）就让系统随便给一个，预览照样能用
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port) { log(`port ${port} busy, using a free one`); port = 0; server.listen(0, '127.0.0.1'); }
    else log(e.message);
  });
  server.on('listening', () => { bound = server.address().port; log(`http://127.0.0.1:${bound}`); });
  server.listen(port, '127.0.0.1');

  return { register, registerMany, registerCanvas, port: () => bound };
}
