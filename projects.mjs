/**
 * [INPUT]: 无依赖（不读文件、不看时钟）。项目表由 server.mjs 启动时从 config.json 读出来交给 useRules()，这里只编译和使用它
 * [OUTPUT]: useRules(cfg) 换一套项目表（不合法就抛错，旧表不动）；rules() 当前这一套；noteTool(files, input) 记一次工具调用碰过的文件夹；
 *           classify(files, info) 认出会话属于哪个项目；pinnable(key, name) 核对界面传来的列（列头「新任务」用），只放行项目表里的和「自成一组」的文件夹
 * [POS]: cc-board 的「按项目分组」规则。server.mjs 读对话记录时对每次工具调用调 noteTool，每轮出状态时调 classify，
 *        结果放进会话的 project 字段；ui.html 只读这个字段分组，自己不猜。仓库里的默认表是空的：没登记的 ~/Projects 文件夹照样按文件夹名自成一组。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// ─────────────────────────────── 为什么这样认 ───────────────────────────────
// 窗口常常都开在主目录，cwd 认不出项目；标题可能是语音转写的，单看也不准。
// 最硬的证据是它动过哪些文件：每次工具调用的参数里出现的 ~/Projects/<文件夹>，数次数。
// 标题和他说的话只做加分：刚开的会话还没动过文件，靠它们先归一个组。

// ─────────────────────────────── 项目表 ───────────────────────────────
// 来自 config.json 的 projects：[{ key, name, dir, word }]。dir、word 是正则的字符串，一律不分大小写。
// dir：对「文件夹根」（形如 Projects/acme-app、Desktop/acme-notes）的规则
// word：对标题、他说的话、桌面上的文件名的规则
// neutral：谁都会碰、不说明在做哪个项目的文件夹根（共用的工具、截屏之类），不算证据
// roots：哪些文件夹下面的子文件夹算「文件夹根」，相对主目录写（如 Projects、Desktop）。长的优先，所以 Projects/shared 要和 Projects 一起列
export const DEFAULT_NEUTRAL = '^Projects/shared$';
export const DEFAULT_ROOTS = ['Projects', 'Desktop'];
const ROOT_OK = /^[\w .~-]+(\/[\w .~-]+)*$/;
const KEY_OK = /^[a-z][a-z0-9_-]{0,31}$/;
const NAME_BAD = /[<>\n\r]/;
function compile({ projects = [], neutral = DEFAULT_NEUTRAL, roots = DEFAULT_ROOTS } = {}) {
  if (!Array.isArray(projects)) throw new Error('projects 要是数组');
  const seen = new Set();
  const list = projects.map((p, i) => {
    const at = 'projects[' + i + ']';
    if (!p || typeof p !== 'object') throw new Error(at + ' 不是对象');
    if (typeof p.key !== 'string' || !KEY_OK.test(p.key) || p.key === OTHER.key || seen.has(p.key)) throw new Error(at + '.key 不对（小写字母开头，不能是 other，不能重复）');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || NAME_BAD.test(p.name)) throw new Error(at + '.name 不对');
    seen.add(p.key);
    const re = (v, f) => { if (v == null || v === '') return null; if (typeof v !== 'string') throw new Error(at + '.' + f + ' 要是字符串'); return new RegExp(v, 'i'); };
    return { key: p.key, name: p.name, dir: re(p.dir, 'dir'), word: re(p.word, 'word') };
  });
  if (typeof neutral !== 'string') throw new Error('neutral 要是字符串');
  if (!Array.isArray(roots) || !roots.length || !roots.every((r) => typeof r === 'string' && ROOT_OK.test(r) && !r.startsWith('~'))) throw new Error('roots 要是文件夹路径的数组（相对主目录，不以 ~ 开头，不带正则符号）');
  const alt = [...roots].sort((a, b) => b.length - a.length).map((r) => r.replace(/[.~]/g, (c) => '\\' + c) + '\\/' + STOP).join('|');
  return { list, neutral: new RegExp(neutral, 'i'), root: new RegExp('\\/(' + alt + ')', 'g') };
}
let R = null;                       // 当前这一套；OTHER 定义之后再编译默认表
export function useRules(cfg) { R = compile(cfg); return R; }
export const rules = () => R;
const hit = (re, text) => !!re && re.test(text);

export const OTHER = { key: 'other', name: '其他' };
const TITLE_W = 10;      // 标题命中一次 = 动过 10 次文件
const PROMPT_W = 3;      // 他说的话命中一次
const CWD_W = 5;         // 会话开在某个项目文件夹里
const PIN_W = 30;        // 他在某一列的列头点「新任务」开的：等于在那个项目里动过 30 次文件。别处的证据要多出 30 次才能把它拉走

// ─────────────────────────────── 记证据 ───────────────────────────────
// 文件夹根 = roots 里某个文件夹下面的一层：/Projects/<名>、/Desktop/<名>……iCloud 云盘根（com~apple~CloudDocs）下的记成 iCloud/<名>
const STOP = '[^\\/\\s"\'`\\\\)\\]},;:<>*?|&（）「」【】《》，。、；：！？]+';     // 中文标点也算路径的结尾
useRules();

export function roots(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(R.root)) out.add(m[1].replace(/^com~apple~CloudDocs\//, 'iCloud/'));
  return out;
}

// 一次工具调用里同一个文件夹只算一次。files 是 Map：文件夹根 → 次数
export function noteTool(files, input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input || {});
  for (const r of roots(s)) files.set(r, (files.get(r) || 0) + 1);
}

// ─────────────────────────────── 认项目 ───────────────────────────────
// 文件夹根 → 项目。表里没有的 ~/Projects 文件夹自成一组，组名就是文件夹名（去掉日期尾巴）
export function projectOfRoot(root) {
  if (R.neutral.test(root)) return null;
  for (const p of R.list) if (hit(p.dir, root)) return p;
  const name = root.replace(/^[^/]+\//, '');
  for (const p of R.list) if (hit(p.word, name)) return p;
  const m = root.match(/^Projects\/(?:shared\/)?(.+)$/);
  if (!m) return null;
  const folder = m[1].replace(/-\d{8}$/, '');
  return { key: 'dir:' + folder.toLowerCase(), name: folder };
}

// 分数最高的项目胜出；同分时表里的项目优先于「自成一组」的文件夹，再按表里的顺序。一分都没有 = 其他
// home：工作目录只看主目录以下那一段（~/Projects/<名>）。主目录本身在别的项目文件夹里时（测试的假主目录）不算证据
// pin：在哪一列的列头开的（{key, name}，服务端已用 pinnable 核过）。刚开的会话还没动过文件，靠它立刻落进那一列
export function classify(files, { title = '', prompt = '', cwd = '', home = '', pin = null } = {}) {
  const score = new Map(); const meta = new Map();
  const add = (p, v) => { if (!p || !v) return; score.set(p.key, (score.get(p.key) || 0) + v); meta.set(p.key, p); };
  if (pin && pin.key !== OTHER.key) add(pin, PIN_W);
  for (const [root, n] of files || []) add(projectOfRoot(root), n);
  const rel = home && String(cwd).startsWith(home) ? String(cwd).slice(home.length) : String(cwd || '');
  for (const r of roots(rel)) add(projectOfRoot(r), CWD_W);
  for (const p of R.list) {
    if (hit(p.word, title)) add(p, TITLE_W);
    if (hit(p.word, prompt)) add(p, PROMPT_W);
  }
  let best = null;
  for (const [key, v] of score) {
    if (!best) { best = key; continue; }
    const b = score.get(best);
    if (v > b || (v === b && rank(key) < rank(best))) best = key;
  }
  if (!best) return { ...OTHER };
  const p = meta.get(best);
  return { key: p.key, name: p.name };
}

// 界面传来的列：项目表里的按表里的名字；「自成一组」的文件夹（dir:<小写文件夹名>）名字要和 key 对得上。其余（含「其他」）不认
export function pinnable(key, name) {
  key = String(key || ''); name = String(name || '');
  const p = R.list.find((x) => x.key === key);
  if (p) return { key: p.key, name: p.name };
  const m = key.match(/^dir:([^\s/<>]{1,64})$/);
  if (m && name.toLowerCase() === m[1] && !/[\s<>]/.test(name)) return { key, name };
  return null;
}

function rank(key) { const i = R.list.findIndex((p) => p.key === key); return i < 0 ? R.list.length : i; }
