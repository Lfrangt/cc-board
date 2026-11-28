/**
 * [INPUT]: 依赖 ../preview.mjs（或命令行给的另一份，比如改坏版）和 node 自带的 fs / path / http / child_process。不装包、不联网。
 *          HTTP 服务只起在 127.0.0.1、端口由系统分，测完关掉；临时文件全在 fs.mkdtempSync 建的 test/tmp-preview-XXXXXX 里，结束时删掉。
 * [OUTPUT]: 逐项打印 ok / FAIL，最后一行「结果：N 过，M 没过」；退出码 0 = 全过，1 = 有没过的。
 *           带 --mutants 时改跑反向对照：造若干个改坏的 preview.mjs（放在临时目录里），每个都必须让本测试变红。
 * [POS]: test/ 的本机预览测试。分五段：类型表（kindOf / mimeOf）、真身（canon / isTop / idOf，自己造符号链接）、readText 的上限、
 *        文件夹规则（listGallery / listCanvas / pageMeta：多半是图、多半是网页、混杂、版本文件夹、仓库），
 *        和真起一个 startPreview 用 node:http 去要文件：白名单类型给，../ 跳出去、点开头的、不在 MIME 表里的、指到文件夹外的链接、
 *        顶层文件夹往下钻、错的 Host 和方法都不给，并且回的内容里没有那个文件的标记串。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/preview.test.mjs [preview.mjs 的路径]      node test/preview.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import http from 'node:http'; import net from 'node:net';
import { spawnSync } from 'node:child_process'; import { fileURLToPath, pathToFileURL } from 'node:url';
const SELF = fileURLToPath(import.meta.url), HERE = path.dirname(SELF);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../preview.mjs'));
const TMP = fs.mkdtempSync(path.join(HERE, 'tmp-preview-'));
let server = null;
const cleanup = () => { try { server?.closeAllConnections?.(); server?.close(); } catch {} fs.rmSync(TMP, { recursive: true, force: true }); };
process.on('exit', cleanup);                      // 中途抛错退出也删临时目录
const finish = (code) => { cleanup(); process.exit(code); };

// ── 反向对照：每次只改坏一处（no-dotdot-guard 改两处），本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8');
  const M = {
    'kindOf-null':      [['export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || null;', 'export const kindOf = (ext) => null;']],
    'kindOf-case':      [['KIND_OF[String(ext).toLowerCase()]', 'KIND_OF[String(ext)]']],
    'mimeOf-case':      [['MIME[String(ext).toLowerCase()]', 'MIME[String(ext)]']],
    // 拦 ../ 的两道：段里不许有点开头 / 斜杠（resolve 第一道），真身要在文件夹里（第二道）
    'no-dotdot-guard':  [["if (parts.some((s) => !s || s.startsWith('.') ||", "if (false && parts.some((s) => !s || s.startsWith('.') ||"], ['if (!inside(it.root, real)) return null;', '']],
    'no-segment-check': [["if (parts.some((s) => !s || s.startsWith('.') ||", "if (false && parts.some((s) => !s || s.startsWith('.') ||"]],
    'no-dot-check':     [["!s || s.startsWith('.') || ", '!s || ']],
    'no-slash-check':   [["s.startsWith('.') || /[", "s.startsWith('.') || false && /["]],
    'no-inside-check':  [['if (!inside(it.root, real)) return null;', '']],
    'inside-no-sep':    [['p.startsWith(root + path.sep)', 'p.startsWith(root)']],
    'no-shallow':       [['if (it.shallow && parts.length > 1) return null;', '']],
    'any-type':         [["const type = MIME[path.extname(real).slice(1).toLowerCase()];", "const type = MIME[path.extname(real).slice(1).toLowerCase()] || 'application/octet-stream';"]],
    'canon-js':         [['const r = fs.realpathSync.native(p);', 'const r = fs.realpathSync(p);']],
    'isTop-private-2':  [['? 3 : 2', '? 2 : 2']],
    'readText-no-cap':  [['Buffer.alloc(Math.min(size, TEXT_MAX))', 'Buffer.alloc(size)']],
    'gallery-dotfiles': [["if (name.startsWith('.')) continue;", '']],
    'gallery-no-sort':  [['media.sort((a, b)', 'media.slice((a, b)']],
    'canvas-dotfiles':  [["if (name[0] === '.') continue;", '']],
    'canvas-no-inside': [['if (isPage(kindOf(path.extname(real).slice(1))) && inside(dir, real)) pages.push', 'if (isPage(kindOf(path.extname(real).slice(1)))) pages.push']],
    'no-esc-hook':      [['body = Buffer.from(withHook(', 'body = Buffer.from((']],
  };
  const run = (file) => spawnSync(process.execPath, [SELF, file], { encoding: 'utf8', timeout: 60000 });
  const lines = (r) => String(r.stdout || '').trim().split('\n');
  const base = run(SRC);
  if (base.status !== 0) { console.log('FAIL 原版自己就没过（退出码 ' + base.status + '）：' + lines(base).pop()); finish(1); }
  console.log('原版：' + lines(base).pop());
  let caught = 0;
  for (const [name, edits] of Object.entries(M)) {
    let s = src, badEdit = '';
    for (const [a, b] of edits) { if (s.split(a).length !== 2) badEdit = a; else s = s.split(a).join(b); }
    if (badEdit) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处：' + badEdit.slice(0, 60)); continue; }
    const f = path.join(TMP, name + '.mjs'); fs.writeFileSync(f, s);
    const r = run(f), out = lines(r), res = out.filter((l) => l.startsWith('结果：')).pop();
    const red = r.status === 1 && !!res && !/，0 没过$/.test(res);     // 崩了没跑完不算抓到
    if (red) caught++;
    const first = red ? out.find((l) => l.startsWith('  FAIL ')).slice(7) : r.status === 0 ? '测试照样全过' : '没跑完：' + String(r.stderr || '').trim().split('\n').slice(-1)[0];
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + first.slice(0, 120) + (red ? '（' + res + '）' : ''));
  }
  const n = Object.keys(M).length;
  console.log(n + ' 个改坏版，' + caught + ' 个被测试抓到');
  finish(caught === n ? 0 : 1);
}

const Q = await import(pathToFileURL(SRC).href);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const tryIt = (f) => { try { return f(); } catch (e) { return { threw: String(e && e.code || e && e.message || e) }; } };
const J = (v) => JSON.stringify(v);

// ── 临时目录里的布景 ──
const ROOT = Q.canon(TMP);
const W = (rel, body = rel) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };
const L = (rel, target) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.symlinkSync(target, p); return p; };

console.log('kindOf / mimeOf：大小写不敏感，认识的回对的类别，不认识的回 null');
const KINDS = { html: 'page', HTM: 'page', PDF: 'pdf', Png: 'image', JPEG: 'image', HEIC: 'image', svg: 'image', MOV: 'video', webm: 'video', FLAC: 'audio', m4a: 'audio', MD: 'markdown', Markdown: 'markdown', JSON: 'text', Yml: 'text', tsx: 'text' };
const kindBad = Object.entries(KINDS).filter(([e, k]) => Q.kindOf(e) !== k).map(([e, k]) => e + '→' + Q.kindOf(e) + '（应为 ' + k + '）');
ok(!kindBad.length, Object.keys(KINDS).length + ' 个扩展名（混着大小写）归类都对', kindBad.join('，'));
ok(Q.kindOf('png') === Q.kindOf('PNG') && Q.kindOf('PNG') === 'image' && Q.kindOf('Html') === 'page', 'kindOf("png") / ("PNG") 都是 image，("Html") 是 page');
const kindNull = ['docx', 'xlsx', 'key', 'exe', 'zip', 'woff2', '', 'h tml', '.png'].filter((e) => Q.kindOf(e) !== null);
ok(!kindNull.length, '不认识的（docx、xlsx、key、exe、zip、woff2、空串、"h tml"、带点的 ".png"）回 null', kindNull.map((e) => J(e) + '→' + Q.kindOf(e)).join('，'));
const MIMES = { PNG: 'image/png', jpg: 'image/jpeg', Html: 'text/html; charset=utf-8', MJS: 'text/javascript; charset=utf-8', Css: 'text/css; charset=utf-8', WOFF2: 'font/woff2', wasm: 'application/wasm', MP4: 'video/mp4', pdf: 'application/pdf', md: 'text/plain; charset=utf-8' };
const mimeBad = Object.entries(MIMES).filter(([e, m]) => Q.mimeOf(e) !== m).map(([e, m]) => e + '→' + Q.mimeOf(e) + '（应为 ' + m + '）');
ok(!mimeBad.length, Object.keys(MIMES).length + ' 个扩展名（混着大小写）的 MIME 都对', mimeBad.join('，'));
const mimeNull = ['docx', 'yaml', 'py', 'sh', 'exe', ''].filter((e) => Q.mimeOf(e) !== null);
ok(!mimeNull.length, '不在 MIME 表里的（docx、exe、空串，以及能预览但不走网址的 yaml / py / sh）回 null', mimeNull.map((e) => e + '→' + Q.mimeOf(e)).join('，'));

console.log('\ncanon / idOf / isTop');
const realTxt = W('links/real.txt', 'REAL');
L('links/a.txt', 'real.txt'); L('links/b.txt', 'a.txt');                    // b → a → real：两层链接
W('links/dir/inner.txt', 'INNER'); L('links/dirlink', 'dir');
const want = fs.realpathSync.native(realTxt);
ok(Q.canon(path.join(ROOT, 'links/a.txt')) === want && Q.canon(path.join(ROOT, 'links/b.txt')) === want && Q.canon(realTxt) === want,
  '真文件、一层链接、两层链接，canon 收成同一个真身', [Q.canon(path.join(ROOT, 'links/b.txt')), want].join(' / '));
ok(Q.canon(path.join(ROOT, 'links/dirlink/inner.txt')) === path.join(ROOT, 'links/dir/inner.txt'), '经过「指向文件夹的链接」的路径，canon 回文件夹真身下的路径');
ok(Q.canon(path.join(ROOT, 'links/dir/../real.txt')) === want, '带 .. 的写法也收成同一个真身');
const upper = path.join(ROOT, 'links', 'REAL.TXT'), caseless = fs.existsSync(upper);
const cu = tryIt(() => Q.canon(upper));
ok(caseless ? cu === want : !!cu.threw, caseless ? '大小写不敏感的盘：canon("…/REAL.TXT") 收回原来的大小写 real.txt' : '大小写敏感的盘：canon("…/REAL.TXT") 抛错', J(cu));
const firm = Q.FIRM + ROOT, firmThere = process.platform === 'darwin' && fs.existsSync(firm);
ok(!firmThere || Q.canon(path.join(firm, 'links/b.txt')) === want, firmThere ? 'firmlink 写法（/System/Volumes/Data 前缀）canon 后去掉前缀' : '这台机器没有 firmlink，跳过（记作过）', firmThere ? Q.canon(path.join(firm, 'links/b.txt')) : '');
const gone = tryIt(() => Q.canon(path.join(ROOT, 'links/nope.txt')));
ok(gone && gone.threw === 'ENOENT', '不存在的路径 canon 抛 ENOENT', J(gone));
L('links/dangling.txt', 'nowhere.txt');
ok(tryIt(() => Q.canon(path.join(ROOT, 'links/dangling.txt'))).threw === 'ENOENT', '断了的链接 canon 也抛 ENOENT');
const idReal = Q.idOf(realTxt), idDir = Q.idOf(path.join(ROOT, 'links/dir/inner.txt'));
ok(/^\d+:\d+$/.test(idReal) && Q.idOf(path.join(ROOT, 'links/b.txt')) === idReal && idDir !== idReal, 'idOf 是「dev:ino」，跟着链接走：链接和真文件同一个编号，别的文件不同', [idReal, Q.idOf(path.join(ROOT, 'links/b.txt')), idDir].join(' / '));
ok(Q.idOf(path.join(ROOT, 'links/nope.txt')) === '' && Q.idOf(path.join(ROOT, 'links/dangling.txt')) === '', '不存在的、断了的链接，idOf 回空串');
const TOP = ['/', '/tmp', '/Users', '/private/tmp', '/Volumes/T7', Q.FIRM, Q.FIRM + '/Users', Q.FIRM + '/private/tmp', Q.FIRM + '/mnt'];
const NOT = ['/Users/Shared', '/Users/Shared/Projects/a/b', '/private/tmp/x', '/Volumes/T7/Photos', Q.FIRM + '/Users/Shared', ROOT, path.join(ROOT, 'links/dir')];
const topBad = [...TOP.filter((d) => Q.isTop(d) !== true), ...NOT.filter((d) => Q.isTop(d) !== false)];
ok(Q.isTop('/') === true, 'isTop("/") 是 true');
ok(!topBad.length, 'isTop：/tmp、/Users、/private/tmp、/Volumes/T7 和它们的 firmlink 写法是顶层；主目录、深目录、测试的临时目录不是', topBad.map((d) => d + '→' + Q.isTop(d)).join('，'));

console.log('\nreadText');
const small = W('text/small.txt', 'hello 中文\nline 2\n'), smallSize = fs.statSync(small).size;
const rs = Q.readText(small, smallSize);
ok(rs && rs.text === 'hello 中文\nline 2\n' && rs.truncated === false, '小文本读全、truncated false', J(rs));
const big = W('text/big.txt', Buffer.alloc(Q.TEXT_MAX + 4096, 'a'));
const rb = Q.readText(big, fs.statSync(big).size);
ok(Q.TEXT_MAX === 1024 * 1024 && rb && rb.text.length === Q.TEXT_MAX && rb.truncated === true, 'TEXT_MAX 是 1 MiB；超过的只读前 TEXT_MAX 字节、truncated true', rb && rb.text.length + ' ' + rb.truncated);
const exact = W('text/exact.txt', Buffer.alloc(Q.TEXT_MAX, 'b'));
const re = Q.readText(exact, Q.TEXT_MAX);
ok(re && re.text.length === Q.TEXT_MAX && re.truncated === false, '正好 TEXT_MAX 字节：读全、不算截断', re && re.text.length + ' ' + re.truncated);
const empty = W('text/empty.txt', '');
ok(J(Q.readText(empty, 0)) === J({ text: '', truncated: false }), '空文件回 { text: "", truncated: false }', J(Q.readText(empty, 0)));
ok(Q.readText(path.join(ROOT, 'text/nope.txt'), 10) === null, '不存在的路径回 null');
ok(Q.readText(path.join(ROOT, 'text'), 10) === null, '文件夹读不了，回 null');
const fd = fs.openSync(small, 'r'); const rf = Q.readText('/不会被打开的路径', 5, fd);
let fdOpen = true; try { fs.fstatSync(fd); } catch { fdOpen = false; }
fs.closeSync(fd);
ok(rf && rf.text === 'hello' && fdOpen, '给了已打开的 fd：从 fd 读（路径不看），读完不关它', J(rf) + ' fd 还开着：' + fdOpen);

console.log('\nlistGallery / listCanvas / pageMeta');
// 多半是图：6 个图 / 视频（含一个指到文件夹里的链接），一个文本，一个指到外面的链接；点开头的文件、点开头的文件夹、子文件夹都不该算
const PICS = path.join(ROOT, 'pics');
for (const n of ['10.jpg', '2.png', '1.PNG', '3.webp', 'clip.mp4', 'note.txt', '.hidden.png', '.thumbs/t1.png', '.thumbs/t2.png', 'sub/s1.png', 'sub/s2.png']) W('pics/' + n);
W('outside/secret.png', 'OUTSIDE-SECRET'); W('outside/page.html', '<title>OUTSIDE</title>');
L('pics/alias.png', '2.png'); L('pics/out.png', '../outside/secret.png');
const g = Q.listGallery(PICS);
const gNames = (g.media || []).map((m) => m.name);
ok(J(gNames) === J(['1.PNG', '2.png', '3.webp', '10.jpg', 'alias.png', 'clip.mp4']) && g.total === 6 && g.truncated === false,
  '图集：6 项按数字排（1、2、3、10），指到外面的链接、文本不列', J(g).slice(0, 200));
ok(!gNames.some((n) => n.startsWith('.')) && !gNames.some((n) => n.startsWith('s')), '图集里没有点开头的文件、点开头的文件夹和子文件夹里的图', J(gNames));
const gm = Object.fromEntries((g.media || []).map((m) => [m.name, m]));
ok(gm['clip.mp4']?.kind === 'video' && gm['1.PNG']?.kind === 'image' && gm['alias.png']?.real === path.join(PICS, '2.png') && gm['10.jpg']?.real === path.join(PICS, '10.jpg')
  && Object.keys(gm['1.PNG'] || {}).sort().join() === 'kind,name,real', '每项是 { name, kind, real }：视频是 video，链接的 real 是它指的真文件', J(gm['alias.png']));
const gd = Q.listGallery(PICS, { direct: true });
ok(J((gd.media || []).map((m) => m.name)) === J(['1.PNG', '2.png', '3.webp', '10.jpg', 'clip.mp4']), 'direct: true 时连指到文件夹里面的链接也不列', J(gd).slice(0, 200));
// 多半是网页：3 个网页、1 个 css、1 个指到外面的网页链接，外加点开头的网页
const SITE = path.join(ROOT, 'site');
W('site/a.html', '<html><head><title>\n  Alpha &amp;\n  Co &#8212; &#x263A; &constructor;  </title><meta name="description" content="  first   page "><meta name="description" content="second"></head></html>');
W('site/b-mobile.htm', '<p>no title</p>'); W('site/c.HTML', "<meta content='Phone ' name=ccb:frame><title>Gamma</title>");
W('site/style.css', 'body{}'); W('site/.draft.html', '<title>DRAFT</title>'); W('site/.old/x.html'); W('site/.old/y.html');
L('site/ext.html', '../outside/page.html');
const c = Q.listCanvas(SITE);
const cNames = (c.pages || []).map((p) => p.name);
ok(J(cNames) === J(['a.html', 'b-mobile.htm', 'c.HTML']) && c.total === 3 && c.more === 0, '画布：3 个网页按名字排，指到外面的网页链接、点开头的不列', J(c).slice(0, 200));
const pa = c.pages?.[0] || {}, pb = c.pages?.[1] || {}, pc = c.pages?.[2] || {};
ok(pa.real === path.join(SITE, 'a.html') && pa.title === 'Alpha & Co — ☺ &constructor;' && pa.note === 'first page' && pa.frame === 'browser',
  '每页带上 pageMeta：标题解实体、压空白，说明取第一条 description，默认 browser 框', J(pa));
ok(pb.title === '' && pb.note === '' && pb.frame === 'phone' && pc.title === 'Gamma' && pc.frame === 'phone', '没标题的回空串；名字带 mobile、或 ccb:frame="Phone "（单引号、无引号属性）按手机框', J([pb, pc]));
ok(Q.listGallery(SITE).error === 'no-preview', '多半是网页的文件夹，listGallery 回 no-preview');
ok(Q.listCanvas(PICS).error === 'no-preview', '多半是图的文件夹，listCanvas 回 no-preview');
// 混杂：2 图、2 网页、3 个别的
for (const n of ['p1.png', 'p2.jpg', 'one.html', 'two.html', 'notes.txt', 'data.json', 'run.py']) W('mix/' + n);
ok(J(Q.listGallery(path.join(ROOT, 'mix'))) === J({ error: 'no-preview' }) && J(Q.listCanvas(path.join(ROOT, 'mix'))) === J({ error: 'no-preview' }), '混杂的文件夹：图没到 60%、网页没过半，两个都回 { error: "no-preview" }');
for (const n of ['v1.html', 'v2.html', 'SPEC.md', 'STATE.md', 'run.sh', 'notes.txt']) W('vers/' + n, '<title>' + n + '</title>');
const cv = Q.listCanvas(path.join(ROOT, 'vers'));
ok(J((cv.pages || []).map((p) => p.name)) === J(['v1.html', 'v2.html']) && cv.total === 2, '版本文件夹（v1、v2 + 4 个别的）网页没过半也算画布', J(cv).slice(0, 160));
for (const n of ['a.html', 'b.html', 'package.json']) W('repo/' + n);
ok(Q.listCanvas(path.join(ROOT, 'repo')).error === 'no-preview', '有 package.json 的文件夹（项目仓库）不摆画布');
W('solo/only.png'); W('solo/.x.png'); W('solo/.y.png');
ok(Q.listGallery(path.join(ROOT, 'solo')).error === 'no-preview', '只有 1 张图（另有 2 张点开头的）不成图集：点开头的不凑数');
ok(Q.listGallery(path.join(ROOT, 'nope')).error === 'missing' && Q.listCanvas(path.join(ROOT, 'nope')).error === 'missing', '不存在的文件夹两个都回 { error: "missing" }');
const late = W('meta/late.html', '<!--' + 'x'.repeat(70 * 1024) + '--><title>Late</title><meta name="ccb:frame" content="phone">');
ok(J(Q.pageMeta(late)) === J({ title: '', note: '', frame: 'browser' }), 'pageMeta 只看开头 64 KiB：70 KiB 之后的标题和 frame 读不到', J(Q.pageMeta(late)));
const plain = W('meta/plain.html', '<meta name="ccb:frame" content="tablet">');
ok(Q.pageMeta(plain, 'ios-demo.html').frame === 'phone' && Q.pageMeta(plain, 'scenarios.html').frame === 'browser' && Q.pageMeta(plain, 'studios-phone.html').frame === 'phone',
  'frame 不是 phone / browser 时看名字：ios 只认整词（scenarios 不算），phone 算');
ok(Q.pageMeta(path.join(ROOT, 'meta/nope.html')) === null, '读不了的网页 pageMeta 回 null');

console.log('\nstartPreview：起在 127.0.0.1，用 node:http 去要文件');
W('srv/index.html', '<html><body><h1>INDEX-MARK</h1></body></html>');
W('srv/app.js', 'console.log("APP-MARK")'); W('srv/style.css', 'body{color:red}/*CSS-MARK*/');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('PNG-MARK-0123456789')]);
W('srv/pic.png', PNG); W('srv/sub/inner.png', 'INNER-MARK'); W('srv/deep/page.html', '<p>DEEP-MARK</p>');
W('srv/notes.yaml', 'YAML-SECRET'); W('srv/doc.docx', 'DOCX-SECRET'); W('srv/Makefile', 'MAKE-SECRET'); W('srv/readme.txt', 'TXT-MARK');
W('srv/.env', 'ENV-SECRET'); W('srv/.git/config', 'GIT-SECRET'); W('srv/.hidden.png', 'DOTPNG-SECRET');
W('srv-evil/x.png', 'EVIL-SECRET');
L('srv/in-link.png', 'pic.png'); L('srv/out-link.png', '../outside/secret.png'); L('srv/sublink', '../outside'); L('srv/evil-link.png', '../srv-evil/x.png');
W('home/top.html', '<p>HOME-TOP</p>'); W('home/top.png', 'HOME-PNG'); W('home/sub/inner.png', 'HOME-SUB-SECRET');

const origCreate = http.createServer;           // startPreview 不交出 server，借 createServer 拿到它，测完好关
http.createServer = (...a) => (server = origCreate.apply(http, a));
let P; try { P = Q.startPreview({ port: 0, home: path.join(ROOT, 'home') }); } finally { http.createServer = origCreate; }
const early = P.register(path.join(ROOT, 'srv/index.html'));
ok(early.ok === false && early.error === 'not-ready' && P.port() === 0, '还没开始监听时 register 回 not-ready、port() 是 0', J(early));
for (let i = 0; i < 200 && !P.port(); i++) await new Promise((r) => setTimeout(r, 25));
const PORT = P.port();
ok(PORT > 0 && server && server.address().address === '127.0.0.1' && server.address().port === PORT, '系统分了端口，只绑在 127.0.0.1', J(server && server.address()));
if (!PORT) { console.log('\n服务没起来，后面的 HTTP 测试跑不了'); console.log('\n结果：' + pass + ' 过，' + (fail + 1) + ' 没过'); finish(1); }

const get = (p, { method = 'GET', headers = {} } = {}) => new Promise((done) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers, agent: false }, (res) => {
    const parts = []; res.on('data', (x) => parts.push(x));
    res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
  });
  req.on('error', (e) => done({ status: 0, error: e.code || e.message, headers: {}, body: Buffer.alloc(0) }));
  req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  req.end();
});
const blocked = (r, mark) => r.status === 404 && !r.body.toString('latin1').includes(mark);
const said = (r) => r.status + ' ' + (r.error || r.body.toString('utf8').slice(0, 60));

const reg = P.register(path.join(ROOT, 'srv/index.html'));
const m = /^http:\/\/127\.0\.0\.1:(\d+)\/([0-9a-f]{32})\/index\.html$/.exec(reg.url || '');
ok(reg.ok && reg.kind === 'page' && m && +m[1] === PORT && reg.name === 'index.html' && reg.dir === path.join(ROOT, 'srv'), 'register 网页 → ok、page、网址是 127.0.0.1:端口/32 位编号/文件名', J(reg));
const ID = m ? m[2] : 'x';
ok(P.register(path.join(ROOT, 'srv/index.html')).url === reg.url, '同一个文件再 register，网址不变');
const u = (rel) => '/' + ID + '/' + rel;
const rIdx = await get(u('index.html'));
ok(rIdx.status === 200 && rIdx.headers['content-type'] === 'text/html; charset=utf-8' && rIdx.headers['x-content-type-options'] === 'nosniff' && rIdx.headers['cache-control'] === 'no-store',
  'GET 网页 200，text/html、nosniff、no-store', said(rIdx));
ok(rIdx.body.toString() === '<html><body><h1>INDEX-MARK</h1>' + Q.ESC_HOOK + '</body></html>', '网页内容原样，Esc 那段插在 </body> 前', rIdx.body.toString().slice(0, 120));
const WHITE = [['app.js', 'text/javascript; charset=utf-8', 'APP-MARK'], ['style.css', 'text/css; charset=utf-8', 'CSS-MARK'], ['readme.txt', 'text/plain; charset=utf-8', 'TXT-MARK'], ['sub/inner.png', 'image/png', 'INNER-MARK'], ['in-link.png', 'image/png', 'PNG-MARK']];
const rPic = await get(u('pic.png'));
ok(rPic.status === 200 && rPic.headers['content-type'] === 'image/png' && rPic.body.equals(PNG) && rPic.headers['content-length'] === String(PNG.length), '同一编号下 pic.png 200、image/png、字节一模一样', said(rPic));
for (const [rel, type, mark] of WHITE) {
  const r = await get(u(rel));
  ok(r.status === 200 && r.headers['content-type'] === type && r.body.toString('latin1').includes(mark), '白名单 ' + rel + ' → 200 ' + type, said(r));
}
const rRange = await get(u('pic.png'), { headers: { range: 'bytes=0-3' } });
ok(rRange.status === 206 && rRange.headers['content-range'] === 'bytes 0-3/' + PNG.length && rRange.body.equals(PNG.subarray(0, 4)), 'Range bytes=0-3 → 206、只回 4 字节', said(rRange));

const DENY = [
  ['..%2Foutside%2Fsecret.png', 'OUTSIDE-SECRET', '../ 跳出去（斜杠编码在段里）'],
  ['..%2F..%2Fsrv-evil%2Fx.png', 'EVIL-SECRET', '../../ 跳出去'],
  ['..%5Coutside%5Csecret.png', 'OUTSIDE-SECRET', '..\\ 反斜杠跳出去'],
  ['%2e%2e/outside/secret.png', 'OUTSIDE-SECRET', '%2e%2e/ 跳出去'],
  ['sub/..%2F..%2Foutside%2Fsecret.png', 'OUTSIDE-SECRET', '先进子文件夹再 ../ 跳出去'],
  ['.env', 'ENV-SECRET', '点开头的文件 .env'],
  ['%2Eenv', 'ENV-SECRET', '点编码成 %2E 的 .env'],
  ['.git/config', 'GIT-SECRET', '点开头的文件夹 .git/config'],
  ['.hidden.png', 'DOTPNG-SECRET', '点开头的 .hidden.png（类型在白名单里也不给）'],
  ['notes.yaml', 'YAML-SECRET', '不在 MIME 表里的 yaml（能预览，但不走网址）'],
  ['doc.docx', 'DOCX-SECRET', '不在 MIME 表里的 docx'],
  ['Makefile', 'MAKE-SECRET', '没有扩展名的 Makefile'],
  ['out-link.png', 'OUTSIDE-SECRET', '指到文件夹外面的符号链接'],
  ['sublink/secret.png', 'OUTSIDE-SECRET', '经过指到外面的文件夹链接'],
  ['evil-link.png', 'EVIL-SECRET', '指到名字是 srv 开头的兄弟文件夹（srv-evil）的链接'],
  ['sub', 'INNER-MARK', '文件夹本身'],
  ['', 'INDEX-MARK', '编号后面空着'],
  ['nope.png', 'nope', '不存在的文件'],
];
for (const [rel, mark, label] of DENY) { const r = await get(u(rel)); ok(blocked(r, mark), label + ' → 404，回的不是文件内容', said(r)); }
const rDeep = P.register(path.join(ROOT, 'srv/deep/page.html')), DID = (rDeep.url || '').split('/')[3];
const rUp = await get('/' + DID + '/..%2Fpic.png');
ok(rDeep.ok && blocked(rUp, 'PNG-MARK') && (await get('/' + DID + '/page.html')).status === 200, '子文件夹的编号拿不到上一层的 pic.png（..%2F），自己的 page.html 照给', said(rUp));
ok(blocked(await get('/' + 'f'.repeat(32) + '/index.html'), 'INDEX-MARK'), '不认识的编号 → 404');
const rHost = await get(u('index.html'), { headers: { host: 'evil.example:' + PORT } });
ok(rHost.status === 403 && !rHost.body.toString().includes('INDEX-MARK'), 'Host 不是 127.0.0.1 / localhost（DNS 重绑定）→ 403', said(rHost));
const rPost = await get(u('index.html'), { method: 'POST' });
ok(rPost.status === 405, 'POST → 405', said(rPost));
const rHead = await get(u('index.html'), { method: 'HEAD' });
ok(rHead.status === 200 && rHead.body.length === 0 && +rHead.headers['content-length'] > 0, 'HEAD 网页 → 200、有长度、没正文', said(rHead));

// 主目录（顶层）里的文件：只发同一层的，不往下钻
const rHome = P.register(path.join(ROOT, 'home/top.html')), HID = (rHome.url || '').split('/')[3];
const hTop = await get('/' + HID + '/top.png'), hSub = await get('/' + HID + '/sub/inner.png'), hEnc = await get('/' + HID + '/sub%2Finner.png');
ok(rHome.ok && hTop.status === 200 && blocked(hSub, 'HOME-SUB-SECRET') && blocked(hEnc, 'HOME-SUB-SECRET'), '主目录里的页面：同层 top.png 200；sub/inner.png 和 sub%2Finner.png 都 404', [said(hTop), said(hSub), said(hEnc)].join(' | '));

const rTxt = P.register(path.join(ROOT, 'srv/notes.yaml'));
ok(rTxt.ok && rTxt.kind === 'text' && rTxt.text === 'YAML-SECRET' && rTxt.truncated === false, 'register 文本类（yaml）直接回内容', J(rTxt));
ok(J(P.register(path.join(ROOT, 'srv/doc.docx'))) === J({ ok: false, error: 'no-preview' }) && J(P.register(path.join(ROOT, 'srv/nope.html'))) === J({ ok: false, error: 'missing' }),
  'register docx → no-preview，不存在的 → missing');
const rG = P.register(PICS);
const gItem = await get(new URL(rG.items?.[0]?.url || 'http://127.0.0.1/').pathname);
ok(rG.ok && rG.kind === 'gallery' && rG.total === 6 && J(rG.items.map((x) => x.name)) === J(gNames) && gItem.status === 200 && gItem.headers['content-type'] === 'image/png',
  'register 多半是图的文件夹 → gallery，第一项网址能取到', J(rG).slice(0, 160));
const rC = P.register(SITE);
ok(rC.ok && rC.kind === 'canvas' && J(rC.items.map((x) => x.name)) === J(cNames), 'register 多半是网页的文件夹 → canvas', J(rC).slice(0, 160));
ok(P.register(path.join(ROOT, 'mix')).error === 'no-preview' && P.register(path.join(ROOT, 'home')).error === 'no-preview', '混杂的文件夹、主目录本身 → no-preview');

// 11/27：请求行里的网址 new URL() 解析不了（`GET //[`）时回 400，服务不退（以前异常逃出请求回调，整个总控台进程跟着退出）
const raw = (line) => new Promise((done) => {
  const c = net.connect(PORT, '127.0.0.1'); let buf = '';
  c.on('connect', () => c.write(line + '\r\nHost: 127.0.0.1:' + PORT + '\r\nConnection: close\r\n\r\n'));
  c.on('data', (x) => { buf += x; }); c.on('end', () => done(buf)); c.on('error', (e) => done('ERR ' + (e.code || e.message)));
  c.setTimeout(5000, () => { c.destroy(); done(buf || 'TIMEOUT'); });
});
const bad = await raw('GET //[ HTTP/1.1'), still = await get(u('index.html'));
ok(/^HTTP\/1\.1 400 /.test(bad) && still.status === 200, '网址解析不了的请求（GET //[）回 400，之后照样能取文件', JSON.stringify(bad.slice(0, 40)) + ' / ' + still.status);
await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
const after = await get(u('index.html'));
ok(after.status === 0 && after.error === 'ECONNREFUSED', '关掉服务后再请求连不上（ECONNREFUSED）', said(after));
server = null;

if (pass + fail === 0) ok(false, '一条断言都没跑');
console.log('\n结果：' + pass + ' 过，' + fail + ' 没过');
finish(fail ? 1 : 0);
