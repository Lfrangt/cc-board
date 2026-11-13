/**
 * [INPUT]: 依赖 ../projects.mjs（或命令行给的另一份，比如改坏版）；依赖 ./fixture-config.json（通用的示例项目表，state.test.mjs 也用它）
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造 6 个改坏的 projects.mjs，每个都必须让本测试变红
 * [POS]: test/ 的分组规则测试。纯函数，不起服务，一秒内跑完。
 *        先测仓库默认（没有 config：空项目表、只认 ~/Projects 和 ~/Desktop），再换上示例表测计分：语音错字、标题压过零星文件、同分、中文标点、转义换行、共用测试锁、config 不合法时旧表不动。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/projects.test.mjs [projects.mjs 的路径]      node test/projects.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../projects.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'projects-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'no-neutral':       ['if (R.neutral.test(root)) return null;', '// 不排除共用文件夹'],
    'title-weightless': ['const TITLE_W = 10;', 'const TITLE_W = 0;'],
    'no-cjk-stop':      ['（）「」【】《》，。、；：！？]+', ']+'],
    'case-sensitive':   ["return new RegExp(v, 'i');", 'return new RegExp(v);'],
    'roots-in-order':   ['[...roots].sort((a, b) => b.length - a.length)', '[...roots]'],
    'cwd-not-relative': ["const rel = home && String(cwd).startsWith(home) ? String(cwd).slice(home.length) : String(cwd || '');", "const rel = String(cwd || '');"],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const red = r.status !== 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + (r.stdout.trim().split('\n').pop() || ''));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? `\n${bad} 个改坏版没被抓到` : '\n全部改坏版都被抓到'); process.exit(bad ? 1 : 0);
}
const { roots, noteTool, classify, useRules } = await import(SRC);
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-config.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};
const F = (o) => new Map(Object.entries(o));
const name = (files, info) => classify(F(files), info).name;

// ── 仓库默认（没有 config.json）：空项目表，只认 ~/Projects 和 ~/Desktop 下的文件夹 ──
useRules();
check('默认：项目表是空的，碰过的文件夹自成一组', classify(F({ 'Projects/fretflow-ui': 3 })), { key: 'dir:fretflow-ui', name: 'fretflow-ui' });
check('默认：Documents 和 iCloud 下的文件夹不算证据', [...roots('~/Documents/notes/a.md ~/Library/Mobile Documents/com~apple~CloudDocs/drafts/b')], []);
check('默认：~/Projects/shared 本身不算证据', name(Object.fromEntries([...roots('~/Projects/shared/tool-x/a.py')].map((r) => [r, 4]))), '其他');
{ useRules({ roots: ['Projects', 'Projects/shared'] }); check('roots 长的优先（Projects/shared 写在后面也一样）', [...roots('~/Projects/shared/tool-x/a.py')], ['Projects/shared/tool-x']); }

// ── 换上示例表 ──
useRules(FIXTURE);
{ let threw = false; try { useRules({ projects: [{ key: 'Bad Key', name: 'x' }] }); } catch { threw = true; }
  check('config 不合法：抛错，原来那一套不动', [threw, name({ 'Projects/acme-app': 2 })], [true, 'Acme App']); }

// ── 从工具参数里认文件夹 ──
check('cd 到项目文件夹', [...roots('cd ~/Projects/fretflow-xhs && ls')], ['Projects/fretflow-xhs']);
check('绝对路径 + shared 下的文件夹', [...roots('/Users/me/Projects/shared/tone-cmp-20261112/x.py')], ['Projects/shared/tone-cmp-20261112']);
check('JSON 里转义的换行不算进文件夹名', [...roots(JSON.stringify({ command: 'cd ~/Projects/cc-board\necho hi' }))], ['Projects/cc-board']);
check('中文括号结束路径', [...roots('看 ~/Projects/fretflow-ui（指向活目录）')], ['Projects/fretflow-ui']);
check('桌面和 iCloud（示例表的 roots 里有 iCloud 云盘根）', [...roots('~/Desktop/acme-notes/a.html ~/Library/Mobile Documents/com~apple~CloudDocs/docs-drafts/x')], ['Desktop/acme-notes', 'iCloud/docs-drafts']);
{ const m = new Map(); noteTool(m, { command: 'cp ~/Projects/cc-board/a ~/Projects/cc-board/b' }); noteTool(m, { file_path: '/Users/me/Projects/cc-board/ui.html' });
  check('一次调用里同一个文件夹只算一次', m.get('Projects/cc-board'), 2); }

// ── 认项目（示例表）──
check('FretFlow 的几个文件夹合成一组', name({ 'Projects/fretflow-sandbox': 675, 'Projects/fretflow': 155, 'Projects/fretflow-transcribe-eval': 85 }), 'FretFlow');
check('共用的测试锁不算 FretFlow', name({ 'Projects/shared/fretflow-lock': 50, 'Projects/cc-board': 3 }), '总控台');
check('发布片文件夹算总控台', name({ 'Projects/ccboard-launch-film': 132, 'Projects/cc-board': 123, 'Projects/other-film': 10 }), '总控台');
check('语音错字：Fragrant Flow', name({}, { title: 'Fragrant Flow 音频转和弦谱功能' }), 'FretFlow');
check('语音错字：Freight Flow', name({}, { title: 'Freight Flow 音频理解方案' }), 'FretFlow');
check('语音错字：FreightFlow 连写', name({}, { title: 'FreightFlow吉他APP总调度' }), 'FretFlow');
check('标题压过零星的别处文件', name({ 'Projects/fretflow-ui': 4, 'Desktop/acme-notes': 7 }, { title: 'Docs Site 首页改版' }), 'Docs Site');
check('标题里的「多窗口」算总控台', name({}, { title: 'Ghost体多窗口APP演示视频' }), '总控台');
check('shared 下的脚本文件夹按 dir 规则认', name({ 'Projects/shared/docs-build': 8 }, { title: '部署脚本' }), 'Docs Site');
check('桌面文件夹按名字认', name({ 'Desktop/总控台_封面新版': 3 }), '总控台');
check('他说的话也算', name({}, { prompt: '给我们这个总控台加一个智能分类' }), '总控台');
check('会话开在项目文件夹里', name({}, { cwd: '/Users/me/Projects/acme-app', home: '/Users/me' }), 'Acme App');
check('主目录本身在项目文件夹里时不算（测试的假主目录）', name({}, { cwd: '/u/Projects/cc-board/test/.tmp/home/work', home: '/u/Projects/cc-board/test/.tmp/home' }), '其他');

// ── 表里没有的 ──
check('没登记的文件夹自成一组', classify(F({ 'Projects/widget-lab': 5 })), { key: 'dir:widget-lab', name: 'widget-lab' });
check('组名去掉日期尾巴', classify(F({ 'Projects/shared/simulators-restore-20260924': 2 })).name, 'simulators-restore');
check('什么证据都没有 = 其他', classify(new Map(), { title: '抖音美国区下载限制' }), { key: 'other', name: '其他' });
check('同分时登记过的项目优先', name({ 'Projects/widget-lab': 10 }, { title: '吉他' }), 'FretFlow');

// ── 不该误认的词 ──
check('Acmeist 不算 Acme（词的边界）', name({}, { title: 'Acmeist 字体' }), '其他');
check('Doctor 不算 DOC（词的边界）', name({}, { title: 'Doctor 预约' }), '其他');

console.log(`\n${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
