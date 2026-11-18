/**
 * [INPUT]: 依赖 ../app/node.swift、../app/bundlecode.swift（环境变量 APP_NODE_SWIFT / APP_BUNDLE_SWIFT 换成别的，比如改坏版）和 /usr/bin/swiftc。
 *          不起服务、不碰 tmux、不碰真实主目录和数据目录。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 node.swift / bundlecode.swift，每个都必须让本测试变红
 * [POS]: test/ 的原生外壳测试。把两个文件和一个小驱动编译成命令行程序：
 *        找 node：在临时目录里搭假主目录、假 Homebrew 前缀，放会打印版本号的假 node（sh 脚本），断言挑中的是哪一个：固定位置照旧优先、
 *        指定文件最先、版本管理器里取最高、太旧的跳过并报出来、版本读不出来的不当成太旧（退回 11/16 之前的做法）、登录 shell 兜底。
 *        换代码：公开包把包里的 .mjs / .html 换进数据目录的 app/：第一次、版本没变不动、新版本整个换掉、包里不全不动、写不进去不动、
 *        上次中断留下的半成品不混进来、同版本少了文件补回来、app/ 是符号链接（含断掉的）、几个实例同时启动不弄残。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/app-shell.test.mjs      node test/app-shell.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync, spawn } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const NODE_SRC = path.resolve(process.env.APP_NODE_SWIFT || path.join(HERE, '../app/node.swift'));
const BUNDLE_SRC = path.resolve(process.env.APP_BUNDLE_SWIFT || path.join(HERE, '../app/bundlecode.swift'));
const TMP = path.join(HERE, '.tmp', 'app-shell-' + process.pid);

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const dir = path.join(HERE, '.tmp', 'app-shell-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'no-version-check':     ['node', 'if major(v) >= minMajor { return path }', 'return path'],
    'oldest-first':         ['node', 'return x != y ? y.lexicographicallyPrecedes(x) : a < b', 'return x != y ? x.lexicographicallyPrecedes(y) : a < b'],
    'string-sort':          ['node', 'return x != y ? y.lexicographicallyPrecedes(x) : a < b', 'return a > b'],
    'override-ignored':     ['node', 'if let ok = check(p) { return .found(ok) }\n        }\n        // 2.', '_ = p\n        }\n        // 2.'],
    'fixed-paths-skipped':  ['node', 'for p in [home + "/.local/node/bin/node"] + roots.map({ $0 + "/bin/node" }) {', 'for p in [String]() {'],
    'unknown-is-fatal':     ['node', 'if let u = firstUnknown { return .found(u) }', '_ = firstUnknown'],
    'login-shell-ignored':  ['node', 'if let p = loginShell?(), let ok = check(p) { return .found(ok) }', ''],
    'keg-ignored':          ['node', 'for p in versioned(r + "/opt", prefix: "node@", tail: "/bin/node") { if let ok = check(p) { return .found(ok) } }', '_ = r'],
    'no-stamp-check':       ['bundle', 'guard (try? String(contentsOfFile: live + "/" + stampName, encoding: .utf8)) == stamp else { return false }', ''],
    'stamp-not-written':    ['bundle', 'try stamp.write(toFile: incoming + "/" + stampName, atomically: true, encoding: .utf8)', ''],
    'html-not-copied':      ['bundle', '.filter { $0.hasSuffix(".mjs") || $0.hasSuffix(".html") }', '.filter { $0.hasSuffix(".mjs") }'],
    'no-completeness-check': ['bundle', 'guard files.contains("server.mjs"), files.contains("ui.html") else { return false }', ''],
    'copy-everything':      ['bundle', '.filter { $0.hasSuffix(".mjs") || $0.hasSuffix(".html") }', '.filter { _ in true }'],
    'stale-incoming-kept':  ['bundle', 'try? fm.removeItem(atPath: incoming)                                      // 上次中断留下的半成品', ''],
    'no-lock':              ['bundle', 'while flock(fd, LOCK_EX | LOCK_NB) != 0 {', 'while false {'],
    'stamp-only':           ['bundle', 'return files.allSatisfy { FileManager.default.fileExists(atPath: live + "/" + $0) }', 'return true'],
  };
  let bad = 0;
  for (const [name, [which, a, b]] of Object.entries(M)) {
    const SRC = which === 'node' ? NODE_SRC : BUNDLE_SRC; const src = fs.readFileSync(SRC, 'utf8');
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.swift'); fs.writeFileSync(f, src.replace(a, b));
    const env = { ...process.env, [which === 'node' ? 'APP_NODE_SWIFT' : 'APP_BUNDLE_SWIFT']: f };
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { encoding: 'utf8', env });
    const red = r.status !== 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + (r.stdout.trim().split('\n').filter((l) => /FAIL/.test(l)).slice(0, 1).join('') || r.stdout.trim().split('\n').pop() || ''));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' 个改坏版没让测试变红' : '全部改坏版都让测试变红');
  process.exit(bad ? 1 : 0);
}

// ── 编译：两个文件 + 一个小驱动 ──
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const DRIVER = `import Foundation
let a = CommandLine.arguments
if a[1] == "find" {                      // find home dataDir roots(逗号分隔) loginShell的答案(- = 不给)
  let roots = a[4].split(separator: ",").map(String.init)
  let shell: (() -> String?)? = a[5] == "-" ? nil : { a[5] }
  switch NodeLookup.find(home: a[2], dataDir: a[3], roots: roots, loginShell: shell) {
  case .found(let p): print("found " + p)
  case .tooOld(let p, let v): print("old " + p + " " + v)
  case .none: print("none")
  }
} else {                                 // sync res live stamp
  print(BundledCode.sync(from: a[2], to: a[3], stamp: a[4]) ? "synced" : "kept")
}
`;
fs.writeFileSync(path.join(TMP, 'main.swift'), DRIVER);
const BIN = path.join(TMP, 'shell');
const cc = spawnSync('/usr/bin/swiftc', ['-swift-version', '5', '-target', 'arm64-apple-macos13', NODE_SRC, BUNDLE_SRC, path.join(TMP, 'main.swift'), '-o', BIN], { encoding: 'utf8' });
if (cc.status !== 0) { console.log('FAIL 编译：' + (cc.stderr || '').split('\n').slice(0, 3).join(' ')); process.exit(1); }

// ── 夹具 ──
let n = 0;
function world() {                         // 一个新的假世界：主目录、数据目录、两个前缀
  const w = path.join(TMP, 'w' + (++n)); const home = path.join(w, 'home'); const data = path.join(home, 'data');
  const roots = [path.join(w, 'brew'), path.join(w, 'usrlocal')];
  for (const d of [home, data, ...roots]) fs.mkdirSync(d, { recursive: true });
  return { home, data, roots, w };
}
// kind: 版本号字符串（打印它）、'fail'（退出 1）、'hang'（不退出）、'noexec'（没有执行位）
function fake(file, kind) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = kind === 'fail' ? 'exit 1' : kind === 'hang' ? 'exec /bin/sleep 30' : 'echo ' + (kind === 'noexec' ? 'v22.0.0' : kind);
  fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n'); fs.chmodSync(file, kind === 'noexec' ? 0o644 : 0o755);
  return file;
}
function find(W, shell = '-') {
  const r = spawnSync(BIN, ['find', W.home, W.data, W.roots.join(','), shell], { encoding: 'utf8', timeout: 30000 });
  return (r.stdout || '').trim() || 'error ' + (r.stderr || r.status);
}
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want; ok ? pass++ : fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '\n       得到 ' + got + '\n       应为 ' + want));
}
const local = (W) => path.join(W.home, '.local/node/bin/node');
const brew = (W) => path.join(W.roots[0], 'bin/node');
const nvm = (W, v) => path.join(W.home, '.nvm/versions/node', v, 'bin/node');

// 1. 作者本机的样子：只有 ~/.local/node，v22 → 用它（11/16 之前的行为不变）
{ const W = world(); fake(local(W), 'v22.23.4'); eq('只有 ~/.local/node v22 → 用它', find(W), 'found ' + local(W)); }
// 2. 固定位置的 v22 和 nvm 的 v24 都有 → 固定位置优先（顺序没变）
{ const W = world(); fake(brew(W), 'v22.1.0'); fake(nvm(W, 'v24.1.0'), 'v24.1.0'); eq('固定位置 v22 + nvm v24 → 固定位置优先', find(W), 'found ' + brew(W)); }
// 3. 三个固定位置里排在前面的太旧、后面的够新 → 跳过太旧的
{ const W = world(); fake(local(W), 'v20.11.0'); fake(path.join(W.roots[1], 'bin/node'), 'v22.0.0'); eq('~/.local 是 v20、/usr/local 是 v22 → 用 /usr/local', find(W), 'found ' + path.join(W.roots[1], 'bin/node')); }
// 4. 只有太旧的 → 报太旧，带路径和版本
{ const W = world(); fake(brew(W), 'v20.11.0'); eq('只有 v20 → 报太旧', find(W), 'old ' + brew(W) + ' v20.11.0'); }
// 5. 什么都没有 → none
{ const W = world(); eq('什么都没有 → none', find(W), 'none'); }
// 6. nvm 里几个版本 → 取最高的，而且按数字比（22.11 > 22.3 > 9.x）
{ const W = world(); for (const v of ['v18.20.0', 'v22.3.0', 'v22.11.0', 'v9.11.2']) fake(nvm(W, v), v);
  eq('nvm 里 v9 / v18 / v22.3 / v22.11 → v22.11', find(W), 'found ' + nvm(W, 'v22.11.0')); }
// 7. nvm 最高的是 v24 → v24
{ const W = world(); for (const v of ['v22.11.0', 'v24.1.0', 'v20.0.0']) fake(nvm(W, v), v); eq('nvm 里 v20 / v22 / v24 → v24', find(W), 'found ' + nvm(W, 'v24.1.0')); }
// 8. nvm 里有认不出版本号的别名目录 → 排到最后，不挡住真版本
{ const W = world(); fake(nvm(W, 'lts'), 'v16.0.0'); fake(nvm(W, 'v22.1.0'), 'v22.1.0'); eq('nvm 里有 lts 别名 → 用 v22.1', find(W), 'found ' + nvm(W, 'v22.1.0')); }
// 9. 指定文件最先，支持 ~/
{ const W = world(); fake(local(W), 'v22.0.0'); const p = fake(path.join(W.home, 'tools/n/node'), 'v23.0.0');
  fs.writeFileSync(path.join(W.data, 'node'), '~/tools/n/node\n'); eq('数据目录 node 文件写 ~/tools/n/node → 用它', find(W), 'found ' + p); }
// 10. 指定的太旧 → 照样往下找
{ const W = world(); fake(local(W), 'v22.0.0'); const p = fake(path.join(W.w, 'old/node'), 'v18.0.0');
  fs.writeFileSync(path.join(W.data, 'node'), p); eq('指定的是 v18 → 往下找到 ~/.local 的 v22', find(W), 'found ' + local(W)); }
// 11. fnm（两处）、volta、mise、asdf、nodenv 的目录结构
{ const W = world(); const p = fake(path.join(W.home, '.local/share/fnm/node-versions/v22.5.0/installation/bin/node'), 'v22.5.0'); eq('fnm（~/.local/share）', find(W), 'found ' + p); }
{ const W = world(); const p = fake(path.join(W.home, 'Library/Application Support/fnm/node-versions/v22.5.0/installation/bin/node'), 'v22.5.0'); eq('fnm（Application Support）', find(W), 'found ' + p); }
{ const W = world(); const p = fake(path.join(W.home, '.volta/tools/image/node/22.5.0/bin/node'), 'v22.5.0'); eq('volta', find(W), 'found ' + p); }
{ const W = world(); const p = fake(path.join(W.home, '.local/share/mise/installs/node/22.5.0/bin/node'), 'v22.5.0'); eq('mise', find(W), 'found ' + p); }
{ const W = world(); const p = fake(path.join(W.home, '.asdf/installs/nodejs/22.5.0/bin/node'), 'v22.5.0'); eq('asdf', find(W), 'found ' + p); }
{ const W = world(); const p = fake(path.join(W.home, '.nodenv/versions/22.5.0/bin/node'), 'v22.5.0'); eq('nodenv', find(W), 'found ' + p); }
// 12. Homebrew 只装成 keg（node@22）
{ const W = world(); const p = fake(path.join(W.roots[0], 'opt/node@22/bin/node'), 'v22.9.0'); fake(path.join(W.roots[0], 'opt/node@24/bin/node'), 'v24.0.0');
  eq('Homebrew keg node@22 和 node@24 → node@24', find(W), 'found ' + path.join(W.roots[0], 'opt/node@24/bin/node')); }
// 13. 登录 shell 兜底：哪儿都没有，登录 shell 说在别处
{ const W = world(); const p = fake(path.join(W.w, 'elsewhere/bin/node'), 'v22.2.0'); eq('登录 shell 给的路径 → 用它', find(W, p), 'found ' + p); }
// 14. 登录 shell 给的也太旧 → 报太旧
{ const W = world(); const p = fake(path.join(W.w, 'elsewhere/bin/node'), 'v21.9.0'); eq('登录 shell 给的是 v21 → 报太旧', find(W, p), 'old ' + p + ' v21.9.0'); }
// 15. 版本读不出来（退出 1），别处也没有 → 照旧用它（11/16 之前不查版本）
{ const W = world(); fake(local(W), 'fail'); eq('~/.local/node 读不出版本、别处没有 → 照旧用它', find(W), 'found ' + local(W)); }
// 16. 版本读不出来，但 nvm 有 v22 → 用 nvm 的
{ const W = world(); fake(local(W), 'fail'); fake(nvm(W, 'v22.1.0'), 'v22.1.0'); eq('~/.local 读不出版本 + nvm v22 → nvm', find(W), 'found ' + nvm(W, 'v22.1.0')); }
// 17. 读不出版本的排在太旧的前面：两个都有、别处没有 → 用读不出的那个（和以前一样拿第一个能执行的去起）
{ const W = world(); fake(local(W), 'fail'); fake(brew(W), 'v20.0.0'); eq('读不出 + v20 → 用读不出的那个', find(W), 'found ' + local(W)); }
// 18. 没有执行位的不算
{ const W = world(); fake(local(W), 'noexec'); eq('没有执行位 → none', find(W), 'none'); }
// 19. 卡住不退出的（5 秒超时）→ 当成读不出版本，nvm 有 v22 就用 nvm
{ const W = world(); fake(local(W), 'hang'); fake(nvm(W, 'v22.1.0'), 'v22.1.0'); const t = Date.now();
  eq('~/.local/node 卡住 + nvm v22 → nvm', find(W), 'found ' + nvm(W, 'v22.1.0'));
  eq('卡住的那个 5 秒左右放弃（不到 10 秒）', String(Date.now() - t < 10000), 'true'); }

// ── 换代码：公开包把包里的 .mjs / .html 换进数据目录的 app/ ──
function bundle(dir, files) {             // files: { 名字: 内容 }；值是 null 的建成文件夹
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) { if (c === null) fs.mkdirSync(path.join(dir, f), { recursive: true }); else fs.writeFileSync(path.join(dir, f), c); }
  return dir;
}
const sync = (res, live, stamp) => { const r = spawnSync(BIN, ['sync', res, live, stamp], { encoding: 'utf8', timeout: 30000 }); return (r.stdout || '').trim() || 'error ' + (r.stderr || r.status); };
const ls = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f !== '.bundle-sync.lock').sort().join(',') : '(没有)';   // 锁文件留着是对的，不算残留
const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '(没有)';
let syncData = null;
try {
  const W = world(); const data = W.data; const live = path.join(data, 'app'); syncData = data;
  const v1 = bundle(path.join(W.w, 'res1'), { 'server.mjs': 's1', 'ui.html': 'u1', 'org.mjs': 'o1', 'AppIcon.icns': 'icon', 'zh-Hans.lproj': null });
  const v2 = bundle(path.join(W.w, 'res2'), { 'server.mjs': 's2', 'ui.html': 'u2', 'new.mjs': 'n2' });
  // 1. 第一次：数据目录里还没有 app/
  eq('第一次：换上', sync(v1, live, '0.3.0 (1)'), 'synced');
  eq('第一次：只拷 .mjs / .html，带版本记号', ls(live), '.bundle-version,org.mjs,server.mjs,ui.html');
  eq('第一次：内容是包里的', read(path.join(live, 'server.mjs')) + read(path.join(live, 'ui.html')), 's1u1');
  eq('第一次：版本记号', read(path.join(live, '.bundle-version')), '0.3.0 (1)');
  eq('第一次：旁边不留 app.incoming / app.old', ls(data).replace(/(^|,)node(,|$)/, '$1$2'), 'app');
  // 2. 版本没变：不动（数据目录里被改过的文件也不盖）
  fs.writeFileSync(path.join(live, 'server.mjs'), 'edited');
  eq('版本没变：不换', sync(v1, live, '0.3.0 (1)'), 'kept');
  eq('版本没变：数据目录里的文件不盖', read(path.join(live, 'server.mjs')), 'edited');
  // 3. 新版本：整个换掉（旧版本独有的文件也不留，免得被 import 到）
  eq('新版本：换上', sync(v2, live, '0.3.1 (2)'), 'synced');
  eq('新版本：文件是新包的那一套', ls(live), '.bundle-version,new.mjs,server.mjs,ui.html');
  eq('新版本：内容和版本记号', read(path.join(live, 'server.mjs')) + ' ' + read(path.join(live, '.bundle-version')), 's2 0.3.1 (2)');
  eq('新版本：旁边不留 app.incoming / app.old', ls(data), 'app');
  // 3b. 再一个新版本，文件名和上一版一模一样、只改了内容（最常见的升级）：只能靠版本记号认出来
  const v2b = bundle(path.join(W.w, 'res2b'), { 'server.mjs': 's2b', 'ui.html': 'u2b', 'new.mjs': 'n2b' });
  eq('新版本只改内容：换上', sync(v2b, live, '0.3.1 (2b)'), 'synced');
  eq('新版本只改内容：内容和版本记号都是新的', read(path.join(live, 'server.mjs')) + read(path.join(live, 'new.mjs')) + ' ' + read(path.join(live, '.bundle-version')), 's2bn2b 0.3.1 (2b)');
  // 4. 包里缺 ui.html：不动
  const bad = bundle(path.join(W.w, 'res-bad'), { 'server.mjs': 's3' });
  eq('包里缺 ui.html：不换', sync(bad, live, '0.3.2 (3)'), 'kept');
  eq('包里缺 ui.html：原样', read(path.join(live, 'server.mjs')) + ' ' + read(path.join(live, '.bundle-version')), 's2b 0.3.1 (2b)');
  // 5. 上次中断留下的 app.incoming（里面有别的东西）：不混进来
  bundle(path.join(data, 'app.incoming'), { 'junk.mjs': 'x', 'server.mjs': 'half' });
  eq('有半成品时：照样换上', sync(v1, live, '0.3.3 (4)'), 'synced');
  eq('有半成品时：半成品没混进来', ls(live), '.bundle-version,org.mjs,server.mjs,ui.html');
  eq('有半成品时：旁边清干净', ls(data), 'app');
  // 6. 数据目录写不进去：不动、不报错
  fs.chmodSync(data, 0o555);
  const r6 = sync(v2, live, '0.4.0 (5)');
  fs.chmodSync(data, 0o755);
  eq('写不进去：不换', r6, 'kept');
  eq('写不进去：原样（内容和版本记号）', read(path.join(live, 'server.mjs')) + ' ' + read(path.join(live, '.bundle-version')), 's1 0.3.3 (4)');
  eq('写不进去：旁边没留东西', ls(data), 'app');
} catch (e) {                              // 改坏版可能让前一步没换上，后一步写文件就抛：记成一条红，照样收尾
  fail++; console.log('FAIL 换代码这一段抛了异常：' + e.message);
} finally {
  if (syncData) try { fs.chmodSync(syncData, 0o755); } catch {}
}

// 7. 同一版本再启动时少了一个文件（被删、被别的程序动过）：补回来；app/ 是符号链接：换成真文件夹，原目标不动
try {
  const W = world(); const data = W.data; const live = path.join(data, 'app'); syncData = data;
  const v = bundle(path.join(W.w, 'res'), { 'server.mjs': 's', 'ui.html': 'u', 'org.mjs': 'o' });
  sync(v, live, 'A'); fs.rmSync(path.join(live, 'org.mjs'));
  eq('少了一个文件：同一版本再启动也补回来', sync(v, live, 'A'), 'synced');
  eq('少了一个文件：补齐了', ls(live), '.bundle-version,org.mjs,server.mjs,ui.html');
  const target = bundle(path.join(W.w, 'elsewhere'), { 'server.mjs': 'mine', 'ui.html': 'mine' });
  fs.rmSync(live, { recursive: true }); fs.symlinkSync(target, live);
  eq('app/ 是符号链接：换上', sync(v, live, 'B'), 'synced');
  eq('app/ 是符号链接：变成真文件夹', String(fs.lstatSync(live).isDirectory() && !fs.lstatSync(live).isSymbolicLink()), 'true');
  eq('app/ 是符号链接：原目标没被动', ls(target) + ' ' + read(path.join(target, 'server.mjs')), 'server.mjs,ui.html mine');
  fs.rmSync(live, { recursive: true }); fs.symlinkSync(path.join(W.w, 'gone'), live);
  eq('app/ 是断掉的符号链接：照样换上', sync(v, live, 'C') + ' ' + ls(live), 'synced .bundle-version,org.mjs,server.mjs,ui.html');
} catch (e) { fail++; console.log('FAIL 补文件 / 符号链接这一段抛了异常：' + e.message); }

// 8. 几个实例同时启动（dmg 里一份、「应用程序」里一份）：12 轮，每轮同时起 6 个；单数轮一半是另一个版本
try {
  const W = world(); const data = W.data; const live = path.join(data, 'app');
  const big = 'x'.repeat(64 * 1024);
  const mk = (tag) => { const f = { 'server.mjs': tag + 's', 'ui.html': tag + 'u' }; for (let i = 0; i < 40; i++) f['m' + String(i).padStart(2, '0') + '.mjs'] = tag + big; return bundle(path.join(W.w, 'res-' + tag), f); };
  const A = mk('A'), B = mk('B');
  const WANT = ['.bundle-version', 'server.mjs', 'ui.html', ...Array.from({ length: 40 }, (_, i) => 'm' + String(i).padStart(2, '0') + '.mjs')].sort().join(',');
  const run = (res, stamp) => new Promise((ok) => { const c = spawn(BIN, ['sync', res, live, stamp], { stdio: 'ignore' }); c.on('exit', ok); c.on('error', ok); });
  let broken = 0, first = '';
  for (let round = 0; round < 12; round++) {
    const jobs = [];
    for (let k = 0; k < 6; k++) { const useB = round % 2 === 1 && k % 2 === 1; jobs.push(run(useB ? B : A, (useB ? 'B' : 'A') + round)); }
    await Promise.all(jobs);
    const st = read(path.join(live, '.bundle-version')); const tag = st[0];
    const files = ls(live).split(',').filter((f) => f.startsWith('m'));
    const ok = ls(live) === WANT && read(path.join(live, 'server.mjs')) === tag + 's' && read(path.join(live, 'ui.html')) === tag + 'u'
      && files.every((f) => fs.readFileSync(path.join(live, f), 'utf8')[0] === tag) && ls(data) === 'app';
    if (!ok) { broken++; if (!first) first = '第 ' + round + ' 轮：记号 ' + st + '，文件 ' + ls(live).split(',').length + ' 个，数据目录 ' + ls(data); }
  }
  eq('同时启动 12 轮：每轮结束 app/ 都完整、内容和版本记号一致、旁边不留东西', broken ? broken + ' 轮坏了（' + first + '）' : '全好', '全好');
} catch (e) { fail++; console.log('FAIL 同时启动这一段抛了异常：' + e.message); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log(pass + ' 过 ' + fail + ' 红');
process.exit(fail ? 1 : 0);
