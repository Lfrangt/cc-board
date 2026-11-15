/**
 * [INPUT]: 依赖 node:http / fs / path / crypto；不依赖 server.mjs 的任何状态
 * [OUTPUT]: 对外提供 startPreview({ port, home, log }) → { register(file), port() }；PAGE_EXT（能预览的扩展名）
 * [POS]: 总控台「内置预览」的唯一出口。server.mjs 的 /api/preview 调 register() 拿一个网址，ui.html 用 iframe 打开它。
 *        预览页跑在另一个端口（另一个源），所以页面里的脚本读不到总控台的口令、localStorage 和 /api；
 *        网址里的随机编号就是钥匙：一个编号只开一个文件夹，只发白名单里的文件类型，不进点开头的文件夹，不顺着符号链接出去。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ───────────── 发哪些文件 ─────────────
// 只有 PAGE_EXT 能当入口；页面引用的 CSS、脚本、图、字体、音视频按 MIME 表发，表外的一律 404。
export const PAGE_EXT = new Set(['html', 'htm']);
const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf',
};
const KEEP = 64;                                  // 最多记住 64 个预览；再多就忘掉最早的那个

const inside = (root, p) => p === root || p.startsWith(root + path.sep);

export function startPreview({ port, home, log = () => {} }) {
  const byId = new Map();                         // 编号 → { root, entry, shallow }
  const byFile = new Map();                       // 文件真身 → 编号（同一个文件再点，网址不变）
  let bound = 0;

  // 一个 HTML 文件 → 预览网址。只认真实存在的 .html / .htm 普通文件，按符号链接的真身算。
  function register(file) {
    let real, st;
    try { real = fs.realpathSync(file); st = fs.statSync(real); } catch { return { ok: false, error: 'missing' }; }
    if (!st.isFile() || !PAGE_EXT.has(path.extname(real).slice(1).toLowerCase())) return { ok: false, error: 'not-page' };
    if (!bound) return { ok: false, error: 'not-ready' };
    let id = byFile.get(real);
    if (!id || !byId.has(id)) {
      id = crypto.randomBytes(16).toString('hex');
      const root = path.dirname(real);
      // 页面就在主目录或更上层（/Users、/）时，只发和它同一层的文件，不往下钻：不然一张页面就能读走整个主目录
      const shallow = inside(root, home) || root.split(path.sep).length <= 2;   // 前一条：root 是主目录或它的上层；后一条：/tmp、/Volumes 这种顶层
      byId.set(id, { root, entry: path.basename(real), shallow }); byFile.set(real, id);
      while (byId.size > KEEP) { const old = byId.keys().next().value; const it = byId.get(old); byId.delete(old); byFile.delete(path.join(it.root, it.entry)); }
    }
    const it = byId.get(id);
    return { ok: true, url: `http://127.0.0.1:${bound}/${id}/${encodeURIComponent(it.entry)}`, name: it.entry, dir: it.root };
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
    try { real = fs.realpathSync(path.join(it.root, ...parts)); } catch { return null; }
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
    const head = {
      'content-type': f.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',            // 页面去外网取东西时不把带编号的网址带出去
      'accept-ranges': 'bytes',
    };
    // 音视频要按段取（WebKit 的 <video> / <audio> 先要 bytes=0-1，不回 206 就不播）
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = f.size - 1, code = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); } else { start = Math.max(0, f.size - +m[2]); }
      if (start > end || start >= f.size) { res.writeHead(416, { 'content-range': `bytes */${f.size}` }); return res.end(); }
      code = 206; head['content-range'] = `bytes ${start}-${end}/${f.size}`;
    }
    head['content-length'] = f.size ? end - start + 1 : 0;
    res.writeHead(code, head);
    if (req.method === 'HEAD' || !f.size) return res.end();
    fs.createReadStream(f.real, { start, end }).on('error', () => res.destroy()).pipe(res);
  });

  // 端口被占（比如两份服务同时开着）就让系统随便给一个，预览照样能用
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port) { log(`port ${port} busy, using a free one`); port = 0; server.listen(0, '127.0.0.1'); }
    else log(e.message);
  });
  server.on('listening', () => { bound = server.address().port; log(`http://127.0.0.1:${bound}`); });
  server.listen(port, '127.0.0.1');

  return { register, port: () => bound };
}
