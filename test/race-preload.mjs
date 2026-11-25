// state.test.mjs [10] 的固定竞态（11/24 ng 车，代替原来的 test/known-red/preview-gallery-race.mjs）。
// 用法：被测服务用 `node --import <这个文件的 file:// 网址> server.mjs` 起，环境里给 T_RACE = {"dir","decoy","away","arm"}（都是完整路径）。
// 服务的代码一个字不改：这里只在默认的 fs 对象上包几个同步函数（server.mjs、preview.mjs 都是 import fs from 'node:fs'，调用时才取属性，所以包得到）。
// 没有 T_RACE、或者 arm 这个文件不在，什么都不做；只认 dir 本身、dir/ 下面的完整路径，和（B 模式）相对路径。线上不会带 --import，这份文件也不在 build.sh 的拷贝表里。
//
// 扮演本机另一个同用户的进程，每一步都换得及时（这样「只把核文件夹挪到绑钥匙后面」那种只调顺序的修法也照样被骗）：
//   · 服务碰文件夹本身（stat / lstat / realpath / readdir dir）之前：把 dir 换回真的文件夹（核的时候总是对的）。
//   · readdir 之后，列图那一对（realpath dir/x，再 stat 它的真身）：真的。
//   · 列完以后再碰同一张图（绑钥匙时按路径 lstat / open、发图时 open）：把 dir 换成指到 decoy 的链接（decoy 里有同名的图）。
//   · arm 文件写 A：chdir(dir) 之前换成链接（钉住的会是 decoy）。写 B：chdir(dir) 时是真的，之后服务用相对路径碰任何东西都先换成链接
//     （真文件夹被挪到 away，cwd 还钉在它身上）。
//   · arm 写 R（11/24 返修）：chdir(dir) 之前把真文件夹挪到 away、把 decoy（另一个真文件夹）挪到 dir：路径对得上（cwd === dir），inode 不是核过的那个。
//     测试关掉 arm 以后自己挪回去：rename(dir, decoy) + rename(away, dir)。
//   · arm 写 P（11/24 返修，审查报告 ① 第 4 条的「换上一层」，照 review-harness/pp-preload.mjs）：只要碰 dir 或 dir/ 下面：realpath 之前把上一层换回真的，
//     别的（lstat / stat / readdir / open）和 chdir(dir) 之前把上一层换成指到 pdecoy 的链接（pdecoy/<dir 的名字>/ 里 a–e 都有）。这样 rpResolve 核出来的
//     dev+ino 就是外面那个文件夹的，后面「核 .」也对得上，只有 chdir 以后看 cwd 才认得出。换：rename(上一层, paway) + symlink(pdecoy, 上一层)。
// 换的办法：rename(dir, away) + symlink(decoy, dir)；换回：unlink(dir) + rename(away, dir)。看的是盘上真的样子（dir 是不是链接），不靠记号。
// 测试关掉 arm 以后自己把 dir 换回真的。
import fs from 'node:fs';
import path from 'node:path';

const cfg = (() => { try { return JSON.parse(process.env.T_RACE || ''); } catch { return null; } })();
if (cfg && [cfg.dir, cfg.decoy, cfg.away, cfg.arm].every((p) => typeof p === 'string' && p.startsWith('/'))) {
  const PP = path.dirname(cfg.dir), PX = [cfg.pdecoy, cfg.paway].every((p) => typeof p === 'string' && p.startsWith('/'));   // P 模式要的两个（没给就不演 P）
  const O = {
    lstat: fs.lstatSync, stat: fs.statSync, real: fs.realpathSync, realN: fs.realpathSync.native, readdir: fs.readdirSync, open: fs.openSync,
    read: fs.readFileSync, rename: fs.renameSync, symlink: fs.symlinkSync, unlink: fs.unlinkSync, chdir: process.chdir.bind(process),
  };
  const D = cfg.dir, PRE = D + '/';
  let mode = '', listed = new Set(), pair = '';
  const armed = () => {                               // A / B / ''（没开）。换了模式就把上一轮记的清掉
    let m = ''; try { m = String(O.read(cfg.arm, 'utf8')).trim(); } catch {}
    if (m !== mode) { mode = m; listed = new Set(); pair = ''; }
    return m;
  };
  const isLink = () => { try { return O.lstat(D).isSymbolicLink(); } catch { return false; } };
  const toReal = () => { if (isLink()) { O.unlink(D); O.rename(cfg.away, D); } };
  const toLink = () => { if (!isLink()) { O.rename(D, cfg.away); O.symlink(cfg.decoy, D); } };
  const pLink = () => { try { return O.lstat(PP).isSymbolicLink(); } catch { return false; } };
  const pToReal = () => { if (pLink()) { O.unlink(PP); O.rename(cfg.paway, PP); } };
  const pToLink = () => { if (!pLink()) { O.rename(PP, cfg.paway); O.symlink(cfg.pdecoy, PP); } };
  const toOther = () => { if (!isLink()) { O.rename(D, cfg.away); O.rename(cfg.decoy, D); } };   // R：同一个路径换成另一个真文件夹
  // 每个包过的调用先过这里。kind：'dir'（readdir）、'real'（realpath）、'stat'、其余（lstat / open）
  const before = (p, kind) => {
    if (typeof p !== 'string') return;
    if (!p.startsWith('/')) { if (armed() === 'B') toLink(); return; }
    if (p !== D && !p.startsWith(PRE)) return;
    const m = armed();
    if (!m) return;
    if (m === 'P') { if (PX) { if (kind === 'real') pToReal(); else pToLink(); } return; }
    if (m === 'R') return;                                                          // R 只在 chdir 那一刻动手
    if (p === D) { toReal(); if (kind === 'dir') { listed = new Set(); pair = ''; } return; }
    if (kind === 'real' && !listed.has(p)) { toReal(); return; }                 // 列图：realpath dir/x
    if (kind === 'stat' && p === pair) { toReal(); pair = ''; return; }          // 列图：紧接着 stat 那个真身
    if (listed.has(p)) toLink(); else toReal();                                  // 列完以后再碰同一张：换成链接
  };
  const after = (p, kind, r) => { if (kind === 'real' && typeof p === 'string' && p.startsWith(PRE) && mode) { listed.add(p); pair = typeof r === 'string' ? r : ''; } };
  const wrap = (fn, kind) => function (p, ...rest) { before(p, kind); const r = fn.call(this, p, ...rest); after(p, kind, r); return r; };
  fs.lstatSync = wrap(O.lstat, 'lstat');
  fs.statSync = wrap(O.stat, 'stat');
  fs.readdirSync = wrap(O.readdir, 'dir');
  fs.openSync = wrap(O.open, 'open');
  const real = wrap(O.real, 'real'); real.native = wrap(O.realN, 'real'); fs.realpathSync = real;
  process.chdir = (p) => {
    if (typeof p === 'string' && p === D) { const m = armed(); if (m === 'A') toLink(); else if (m === 'B') toReal(); else if (m === 'R') toOther(); else if (m === 'P' && PX) pToLink(); }
    return O.chdir(p);
  };
  process.stderr.write(`race-preload on ${path.basename(D)}\n`);
}
