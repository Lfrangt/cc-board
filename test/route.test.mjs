/**
 * [INPUT]: 依赖 ../route.mjs（或命令行给的另一份，比如改坏版）。不起服务、不碰 tmux。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 route.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「新窗口档位」测试。测：没声明档位原样放行（界面「默认」不变）；三档各自的模型和强度；显式给的 model / effort 压过档位；
 *        不认识的档位报错（含 __proto__、constructor 这类原型上的名字，和非字符串）；任何档位都不会给出 max（11/15 20:4x 起 Claude 的 heavy / standard 给 xhigh，护栏从「不给 xhigh / max」收到「不给 max」）；Codex 的档位只管强度。
 *        /api/new 接上它之后的端到端断言在 state.test.mjs 的 [7g]。
 *        派活单 brief（11/24 brief-v2 车）：七栏英文中文栏名都认、固定版式（栏名补到 12 列、续行缩进 12 格、最前一行【派活单】+ 目标）、缺栏 / 空白 / 只写「无」/ 占位 / 「测试通过」/ 不认识的栏 / 写两遍 / 不是文字 / 不是对象都拒、
 *        派给和 tier / model 对不上就拒（没给 routeNew 的结果也按「请求里什么都没声明」核，不放行）。端到端（真开窗口、假 claude 记 argv）在 state.test.mjs 的 [7g-2]。
 *        FIX-1（11/24 15:5x 返修）：长串 100 ms 内返回（M1）；单个 \r 和 U+2028 / U+2029 / U+0085 / \v / \f 都当换行；看不见的字不算内容、也不拼进去；「无」剥一层括号或引号再比、多认 無 / 不适用 / 不涉及 / n.a.；
 *        占位后面带标点照拒；请求另带的 prompt 里又写一张派活单就拒（briefClash）；派给先认 tier X / model Y，认 Gemini 4 Neon、Opus5.5、全角；拼出来超过 BRIEF_MAX 字节就拒；表头按字符截。
 *        Droid（11/27）：parseDroidModels() 读 test/fixture-droid-help.txt（真 droid exec --help 的原样），条数另用 sed + grep 数；droidPick() 核 /api/new 给 Droid 的 model / effort。端到端在 state.test.mjs 的 [7d-2]。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/route.test.mjs [route.mjs 的路径]      node test/route.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../route.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'route-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'proto-names-pass':   ['if (!Object.hasOwn(TIERS, key)) {', 'if (!(key in TIERS)) {'],
    'unknown-tier-falls-back': ["return { ok: false, error: '档位只能是 '", "return { ok: true, tier: null, model: m, effort: e, why: '' }; const _x = { error: '档位只能是 '"],
    'tier-case-strict':   ['const key = text(tier).toLowerCase();', 'const key = text(tier);'],
    'tier-overrides-explicit-model': ['const outModel = m || t.model || \'\';', 'const outModel = t.model || m || \'\';'],
    'tier-overrides-explicit-effort': ['const outEffort = e || t.effort;', 'const outEffort = t.effort || e;'],
    'no-tier-forces-standard': ["if (tier === undefined || tier === null || tier === '') {", "if (false) {"],
    'light-is-opus':      ["light:    { claude: { model: 'sonnet'", "light:    { claude: { model: 'opus'"],
    'standard-is-fable':  ["standard: { claude: { model: 'opus'", "standard: { claude: { model: 'fable'"],
    'heavy-is-max':       ["heavy:    { claude: { model: 'fable',  effort: 'xhigh' }", "heavy:    { claude: { model: 'fable',  effort: 'max' }"],
    'light-is-xhigh':     ["light:    { claude: { model: 'sonnet', effort: 'high' }", "light:    { claude: { model: 'sonnet', effort: 'xhigh' }"],
    'standard-drops-back': ["standard: { claude: { model: 'opus',   effort: 'xhigh' }", "standard: { claude: { model: 'opus',   effort: 'high' }"],
    'codex-gets-claude-model': ["const outModel = m || t.model || '';", "const outModel = m || t.model || TIERS[key].claude.model;"],
    'provider-ignored':   ["const pv = provider === 'codex' ? 'codex' : 'claude';", "const pv = 'claude';"],
    'object-tier-accepted': ["const key = text(tier).toLowerCase();", "const key = String(tier).toLowerCase();"],
    // 派活单（11/24）：每个只拿掉 briefNew 的一道闸或版式的一处
    'brief-missing-passes':  ['if (!got.has(f.key)) { blank.push(f.key); continue; }', 'if (!got.has(f.key)) { text[f.key] = \'\'; continue; }'],
    'brief-blank-passes':    ['if (!t) { blank.push(f.key); continue; }', 'if (!t) { text[f.key] = t; continue; }'],
    'brief-none-passes':     ['if (!bare || BRIEF_NONE.test(bare)) none.push(f.key);', 'if (false) none.push(f.key);'],
    'brief-holder-passes':   ['else if (BRIEF_HOLDER.test(core)) problems.push(', 'else if (false) problems.push('],
    'brief-vague-passes':    ["else if (f.key === 'doneWhen' && BRIEF_VAGUE.test(bare))", 'else if (false)'],
    'brief-nonstring-passes': ["if (typeof v !== 'string') { problems.push(", "if (false) { problems.push("],
    'brief-unknown-passes':  ['if (!f) { unknown.push(k); continue; }', 'if (!f) { continue; }'],
    'brief-duplicate-passes': ['if (got.has(f.key)) {', 'if (false) {'],
    'brief-array-accepted':  ["if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {", "if (!brief || typeof brief !== 'object') {"],
    'brief-keys-strict':     ["s.trim().replace(/[：:]+$/, '').replace(/[\\s_-]+/g, '').toLowerCase(); };", 's; };'],
    'brief-to-unchecked':    ['if (text.to) problems.push(...toMismatch(text.to, rt));', ''],
    'brief-to-needs-rt':     ['if (text.to) problems.push(...toMismatch(text.to, rt));', 'if (text.to && rt) problems.push(...toMismatch(text.to, rt));'],
    'brief-to-no-boundary':  ['const TO_TIER = /(?<![a-z0-9_-])(heavy|standard|light)(?![a-z0-9_-])/g;', 'const TO_TIER = /(heavy|standard|light)/g;'],
    'brief-to-model-unchecked': ['const bad = models.filter((m) => !model.includes(m));', 'const bad = [];'],
    'brief-no-mark':         ["const lines = [BRIEF_MARK + (head.length > 80 ? head.slice(0, 79).join('') + '…' : head.join(''))];", 'const lines = [];'],
    'brief-no-pad':          ["const label = f.zh + '：' + ' '.repeat(Math.max(0, BRIEF_COL - 2 * (f.zh.length + 1)));", "const label = f.zh + '：';"],
    'brief-continuation-flat': ["lines.push(label + first + rest.map((l) => '\\n' + (l ? ' '.repeat(BRIEF_COL) + l : '')).join(''));", "lines.push(label + first + rest.map((l) => '\\n' + l).join(''));"],
    // FIX-1（11/24 返修）：M1 的三处线性写法、审查自挑的 M-a（brief-lone-cr）/ M-b（brief-tier-no-lookbehind），和每条新规则各拿掉一处
    'brief-trim-regex':      ['.map((l) => l.trimEnd())', ".map((l) => l.replace(/\\s+$/, ''))"],
    'brief-squeeze-regex':   ['const squeeze = (t) => { let i = t.length; while (i > 0 && SQZ.test(t[i - 1])) i--; return t.slice(0, i); };', "const squeeze = (t) => t.replace(/[\\s。．.，,；;！!]+$/u, '');"],
    'brief-normkey-uncut':   ["return s.length > 64 ? '\\0' + s.slice(0, 64) : s.trim()", 'return s.trim()'],
    'brief-normkey-slice':   ["return s.length > 64 ? '\\0' + s.slice(0, 64) : s.trim()", 'return s.slice(0, 64).trim()'],
    'brief-lone-cr':         ['const BRIEF_NL = /\\r\\n?|[', 'const BRIEF_NL = /\\r\\n|['],
    'brief-ls-kept':         [".replace(BRIEF_NL, '\\n').replace(BRIEF_INVIS, '').split('\\n').map(", ".replace(/\\r\\n?/g, '\\n').replace(BRIEF_INVIS, '').split('\\n').map("],
    'brief-invisible-kept':  [".replace(BRIEF_INVIS, '').split('\\n').map(", ".split('\\n').map("],
    'brief-no-unwrap':       ['const core = squeeze(t), bare = unwrap(core);', 'const core = squeeze(t), bare = core;'],
    'brief-holder-on-t':     ['else if (BRIEF_HOLDER.test(core))', 'else if (BRIEF_HOLDER.test(t))'],
    'brief-tier-no-lookbehind': ['const TO_TIER = /(?<![a-z0-9_-])(heavy', 'const TO_TIER = /(heavy'],
    'brief-tier-dash-boundary': ['(heavy|standard|light)(?![a-z0-9_-])/g;', '(heavy|standard|light)(?![a-z0-9])/g;'],
    'brief-to-template-ignored': ['let tiers = found(TO_TIER_T, s), models = found(TO_MODEL_T, s), loose = false;', 'let tiers = [], models = [], loose = false;'],
    'brief-to-no-nfkc':      ["const s = to.normalize('NFKC').toLowerCase();", 'const s = to.toLowerCase();'],
    'brief-model-digit-strict': ['|fable|opus|sonnet|haiku)(?![a-z])/g;\nconst modelId', '|fable|opus|sonnet|haiku)(?![a-z0-9])/g;\nconst modelId'],
    'brief-gemini-hyphen-only': ['const TO_MODEL = /(?<![a-z0-9])(gemini[\\s_-]*4[\\s_-]*(?:neon|carbon|hydrogen)|gemini|neon|carbon|hydrogen|', 'const TO_MODEL = /(?<![a-z0-9])(gemini-4-(?:neon|carbon|hydrogen)|'],
    'brief-clash-unchecked': ['const clash = briefClash(prompt);', 'const clash = null;'],
    'brief-clash-indented':  ['const CLASH = /^(?:', 'const CLASH = /^[ \\t]*(?:'],
    'brief-no-max':          ['if (bytes > BRIEF_MAX) {', 'if (false) {'],
    'brief-max-ignores-prompt': ['+ (extra ? 2 + Buffer.byteLength(extra) : 0);', '+ 0;'],
    'brief-max-no-gap':      ['(extra ? 2 + Buffer.byteLength(extra)', '(extra ? Buffer.byteLength(extra)'],
    'brief-head-utf16':      ["const head = [...text.goal.split('\\n')[0]];", "const head = text.goal.split('\\n')[0].split('');"],
    // FIX-2（11/24 16:4x 返修单 FIX-2.md）：R1–R3、nit 各拿掉一处；brief-max-utf16、brief-clash-no-nl 是复审 ⑦ 自挑、FIX-1 的测试没抓到的 A、C
    'brief-paren-ignored':   ['for (const m of s.matchAll(TO_PAREN))', 'for (const m of [])'],
    'brief-paren-no-space':  [`["']?\\s*\\(`, `["']?\\(`],
    'brief-paren-no-quote':  [`["']?\\s*\\(`, '\\s*\\('],
    'brief-tier-sep-narrow': [`tier[\\s:=_"'-]*(heavy`, 'tier[\\s:=]*(heavy'],
    'brief-model-sep-narrow': [`model[\\s:=_"'-]*(?:claude`, 'model[\\s:=]*(?:claude'],
    'brief-no-claude-prefix': ['(?:claude[\\s_-]*)?', ''],
    'brief-no-hint':         ['if (loose && out.length)', 'if (false)'],
    'brief-hint-always':     ['models = found(TO_MODEL_T, s), loose = false;', 'models = found(TO_MODEL_T, s), loose = true;'],
    'brief-clash-no-nfkc':   ["CLASH.test(l.normalize('NFKC'))", 'CLASH.test(l)'],
    'brief-max-utf16':       ['+ (extra ? 2 + Buffer.byteLength(extra) : 0);', '+ (extra ? 2 + extra.length : 0);'],
    'brief-clash-no-nl':     [".replace(BRIEF_NL, '\\n').replace(BRIEF_INVIS, '').split('\\n').find(", ".replace(BRIEF_INVIS, '').split('\\n').find("],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const red = r.status !== 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + (r.stdout.trim().split('\n').filter((l) => /FAIL/.test(l)).slice(0, 1).join('') || r.stdout.trim().split('\n').pop() || ''));
  }
  console.log(bad ? bad + ' 个改坏版没让测试变红' : '全部改坏版都让测试变红');
  process.exit(bad ? 1 : 0);
}

const R = await import(SRC);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const same = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), name, JSON.stringify(got));
const pick = (r) => r && { ok: r.ok, tier: r.tier, model: r.model, effort: r.effort };
// 改坏版放行了原型上的名字时，routeNew 会在 undefined.model 上抛异常；包一层，让它变成一条看得见的 FAIL，而不是整个进程崩掉、后面的断言都没跑
const tryRoute = (arg) => { try { return R.routeNew(arg); } catch (e) { return { ok: 'threw', error: String(e.message || e) }; } };

console.log('没声明档位：原样放行，界面「新任务 → 默认」不变');
same(pick(R.routeNew({ provider: 'claude' })), { ok: true, tier: null, model: '', effort: '' }, '什么都没给 → 空模型、空强度（启动时不带参数，沿用 settings.json）');
same(pick(R.routeNew({ provider: 'claude', model: 'opus', effort: 'low' })), { ok: true, tier: null, model: 'opus', effort: 'low' }, '显式给的模型和强度照传');
same(pick(R.routeNew({ model: '  opus ', effort: ' ', tier: '' })), { ok: true, tier: null, model: 'opus', effort: '' }, '空白去掉；tier 是空串等于没声明');
same(pick(R.routeNew({ tier: null })), { ok: true, tier: null, model: '', effort: '' }, 'tier 是 null 等于没声明');
same(pick(R.routeNew()), { ok: true, tier: null, model: '', effort: '' }, '连参数对象都没给也不崩');

console.log('\n三档（Claude Code）');
same(pick(R.routeNew({ provider: 'claude', tier: 'heavy' })), { ok: true, tier: 'heavy', model: 'fable', effort: 'xhigh' }, 'heavy → fable + xhigh');
same(pick(R.routeNew({ provider: 'claude', tier: 'standard' })), { ok: true, tier: 'standard', model: 'opus', effort: 'xhigh' }, 'standard → opus + xhigh');
same(pick(R.routeNew({ provider: 'claude', tier: 'light' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'high' }, 'light → sonnet + high');
same(pick(R.routeNew({ tier: 'light' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'high' }, '没写 provider 按 Claude Code 算');
same(pick(R.routeNew({ provider: 'claude', tier: '  Light ' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'high' }, '大小写和空白不挑（总指挥写成 Light 也认）');

console.log('\n显式给的 model / effort 压过档位，没给的那一半才用档位的');
same(pick(R.routeNew({ tier: 'light', effort: 'xhigh' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'xhigh' }, 'light + 显式强度 xhigh → 模型 sonnet、强度 xhigh');
same(pick(R.routeNew({ tier: 'light', model: 'opus' })), { ok: true, tier: 'light', model: 'opus', effort: 'high' }, 'light + 显式模型 opus → 模型 opus、强度 high（档位的）');
same(pick(R.routeNew({ tier: 'heavy', model: 'opus', effort: 'max' })), { ok: true, tier: 'heavy', model: 'opus', effort: 'max' }, '两样都显式：档位只当记录');
const withExplicit = R.routeNew({ tier: 'light', effort: 'xhigh' });
ok(/强度按你传的/.test(withExplicit.why) && !/模型按你传的/.test(withExplicit.why), 'why 说清哪一半是你传的', withExplicit.why);

console.log('\n不认识的档位：报错，不悄悄退回默认');
for (const bad of ['xl', 'medium', 'heavyy', 'auto', ' ']) {
  const r = R.routeNew({ tier: bad });
  ok(r.ok === false && /heavy/.test(r.error) && /standard/.test(r.error) && /light/.test(r.error), '档位 ' + JSON.stringify(bad) + ' → 报错，错误里列出三个合法档位', JSON.stringify(r));
}
for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
  const r = tryRoute({ tier: bad });
  ok(r.ok === false, '原型上的名字 ' + bad + ' 不能当档位', JSON.stringify(r));
}
for (const bad of [0, 1, true, false, {}, [], ['light'], { toString: () => 'light' }]) {
  const r = tryRoute({ tier: bad });
  ok(r.ok === false, '不是字符串的档位 ' + JSON.stringify(bad) + ' 一律报错', JSON.stringify(r));
}
ok(R.routeNew({ tier: 'x'.repeat(5000) }).error.length < 400, '很长的档位值不会把错误信息撑爆');
ok(R.routeNew({ tier: 'bogus', model: 'opus', effort: 'low' }).ok === false, '档位不对时就算 model / effort 都给了也报错（不放行半个请求）');

console.log('\n成本护栏：任何档位都不会替你选 max；xhigh 只有 Claude 的 heavy / standard 给');
for (const name of R.TIER_NAMES) for (const pv of ['claude', 'codex']) {
  const r = R.routeNew({ provider: pv, tier: name });
  ok(r.ok && r.effort !== 'max', name + ' / ' + pv + ' 的强度是 ' + r.effort + '，不是 max');
}
ok(['heavy', 'standard'].every((k) => R.routeNew({ provider: 'claude', tier: k }).effort === 'xhigh') && R.routeNew({ provider: 'claude', tier: 'light' }).effort === 'high' && R.TIER_NAMES.every((k) => R.routeNew({ provider: 'codex', tier: k }).effort !== 'xhigh'), 'xhigh 只给 Claude 的 heavy / standard：light 是 high，Codex 三档都不给 xhigh');
ok(R.TIER_NAMES.join() === 'heavy,standard,light', '档位恰好三个：heavy / standard / light（再加要有理由）', R.TIER_NAMES.join());
ok(R.TIERS.heavy.claude.model === 'fable' && ['standard', 'light'].every((k) => R.TIERS[k].claude.model !== 'fable'), '只有 heavy 开 Fable');

console.log('\nCodex：档位只管强度，模型留给它自己的 config.toml');
same(pick(R.routeNew({ provider: 'codex', tier: 'heavy' })), { ok: true, tier: 'heavy', model: '', effort: 'high' }, 'heavy → 不指定模型 + high');
same(pick(R.routeNew({ provider: 'codex', tier: 'standard' })), { ok: true, tier: 'standard', model: '', effort: 'medium' }, 'standard → 不指定模型 + medium');
same(pick(R.routeNew({ provider: 'codex', tier: 'light' })), { ok: true, tier: 'light', model: '', effort: 'low' }, 'light → 不指定模型 + low');
same(pick(R.routeNew({ provider: 'codex', tier: 'light', model: 'gpt-6-astra' })), { ok: true, tier: 'light', model: 'gpt-6-astra', effort: 'low' }, 'Codex 显式给的模型照传');

console.log('\n给 newSession 的值必须是它放行的写法');
const SAFE_ARG = /^[\w.\-:\[\]\/]{1,64}$/;   // 和 server.mjs 里同一条；档位表里的值写错了（带空格、太长）会在这里变红
for (const name of R.TIER_NAMES) for (const pv of ['claude', 'codex']) {
  const r = R.routeNew({ provider: pv, tier: name });
  ok((!r.model || SAFE_ARG.test(r.model)) && SAFE_ARG.test(r.effort), name + ' / ' + pv + ' 的模型和强度能通过 newSession 的写法检查');
}

// ───────────── 派活单 brief（11/24 brief-v2 车） ─────────────
// 没有 briefNew 的旧 route.mjs（gbal）上这一段每条都该是 FAIL，不能让进程崩掉、后面的断言没跑；改坏版抛异常时同理
const tryBrief = (b, rt, p) => { try { return typeof R.briefNew === 'function' ? R.briefNew(b, rt, p) : { ok: 'missing-fn' }; } catch (e) { return { ok: 'threw', error: String(e.message || e) }; } };
const errOf = (r) => String((r && r.error) || '');
const STD = R.routeNew({ provider: 'claude', tier: 'standard' }), NONE = R.routeNew({ provider: 'claude' });
const FULL = { to: 'tier standard（主号）', role: '写代码 + 补测试', goal: '/api/new 可以带 brief', context: '任务单 BRIEF.md\n规格 ROUTING.md 第五节', doneWhen: 'node test/route.test.mjs → 全过', doNot: '不部署；不碰 4747', report: '回给 win-1b，15 行以内，状态行写【进展】' };
const ZH = { 派给: FULL.to, 角色: FULL.role, 目标: FULL.goal, 背景: FULL.context, 做完的标准: FULL.doneWhen, 不要做: FULL.doNot, 回报: FULL.report };
// 期望的版式手写在这里（不从 BRIEF_FIELDS 拼）：栏名 + 全角冒号补到 12 个显示列，续行 12 个空格
const FULL_TEXT = '【派活单】/api/new 可以带 brief\n'
  + '派给：      tier standard（主号）\n'
  + '角色：      写代码 + 补测试\n'
  + '目标：      /api/new 可以带 brief\n'
  + '背景：      任务单 BRIEF.md\n'
  + '            规格 ROUTING.md 第五节\n'
  + '做完的标准：node test/route.test.mjs → 全过\n'
  + '不要做：    不部署；不碰 4747\n'
  + '回报：      回给 win-1b，15 行以内，状态行写【进展】';
const with_ = (over) => { const b = { ...FULL }; for (const [k, v] of Object.entries(over)) { if (v === undefined) delete b[k]; else b[k] = v; } return b; };

console.log('\n派活单 brief：七栏、固定版式');
ok(Array.isArray(R.BRIEF_FIELDS) && R.BRIEF_FIELDS.map((f) => f.key + '=' + f.zh).join(' ') === 'to=派给 role=角色 goal=目标 context=背景 doneWhen=做完的标准 doNot=不要做 report=回报', '七栏的英文名、中文名和先后照规格第五节', JSON.stringify(R.BRIEF_FIELDS));
let br = tryBrief(FULL, STD);
ok(br.ok === true && br.text === FULL_TEXT, '七栏都有：按固定版式拼出来，逐字一样', JSON.stringify(br.text || br));
{ const dw = (str) => [...str].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e7f ? 2 : 1), 0);
  const rows = String(br.text || '').split('\n').filter((l, i) => i > 0 && !l.startsWith(' '));
  ok(rows.length === 7 && rows.every((l) => { const at = l.indexOf('：') + 1; const pad = l.slice(at).match(/^ */)[0].length; return dw(l.slice(0, at)) + pad === 12; }), '每一栏的值都从第 12 个显示列起（中文和全角冒号按 2 列算）', JSON.stringify(rows)); }
same(tryBrief(ZH, STD).text, FULL_TEXT, '中文栏名（派给、角色…）拼出来和英文栏名一字不差');
same(tryBrief({ 'To': FULL.to, ROLE: FULL.role, 目标: FULL.goal, ' context ': FULL.context, done_when: FULL.doneWhen, 'do-not': FULL.doNot, '回报：': FULL.report }, STD).text, FULL_TEXT, '栏名不分大小写，下划线、横杠、首尾空白、结尾的冒号不算');
same(tryBrief(Object.fromEntries(Object.entries(FULL).reverse()), STD).text, FULL_TEXT, '对象里栏的先后不影响版式');
same(tryBrief(with_({ context: '\r\n  第一行  \r\n\r\n  - 子项\t\r\n\n' }), STD).text, FULL_TEXT.replace('背景：      任务单 BRIEF.md\n            规格 ROUTING.md 第五节', '背景：      第一行\n\n              - 子项'), '多行：CRLF 换成 LF、行尾空白和头尾空行去掉，中间的空行留成空行、续行自己的缩进留着');
{ const long = '目'.repeat(85), r = tryBrief(with_({ goal: long + '\n第二行' }), STD), first = String(r.text || '').split('\n')[0];
  ok(first === '【派活单】' + '目'.repeat(79) + '…' && String(r.text || '').includes('目标：      ' + long + '\n            第二行'), '最前一行是【派活单】+ 目标的第一行，超过 80 个字截断；目标那一栏照原样全写', first); }

console.log('\n派活单 brief：缺栏、空白、只写「无」就拒');
br = tryBrief(with_({ report: undefined }), STD);
ok(br.ok === false && JSON.stringify(br.missing) === '["report"]' && errOf(br).includes('回报（report）') && !errOf(br).includes('角色（role）'), '缺一栏：拒，报错只点名缺的那一栏', JSON.stringify(br));
br = tryBrief(with_({ context: undefined, doNot: undefined }), STD);
ok(br.ok === false && JSON.stringify(br.missing) === '["context","doNot"]' && errOf(br).includes('缺 背景（context）、不要做（doNot）'), '缺几栏：一次全列出来，按七栏的先后', JSON.stringify(br));
br = tryBrief({}, STD);
ok(br.ok === false && (br.missing || []).length === 7 && errOf(br).startsWith('派活单缺栏，没开窗口：缺 派给（to）、角色（role）'), '空对象：七栏都算缺', JSON.stringify(br));
for (const v of ['', '   ', '\n\t \r\n', '　']) {
  br = tryBrief(with_({ goal: v }), STD);
  ok(br.ok === false && JSON.stringify(br.missing) === '["goal"]' && errOf(br).includes('缺 目标（goal）'), '只有空白 ' + JSON.stringify(v) + '：算缺', JSON.stringify(br));
}
for (const v of ['无', '无。', '没有', ' n/a ', 'None', '-', '——', '？']) {
  br = tryBrief(with_({ doNot: v }), STD);
  ok(br.ok === false && JSON.stringify(br.missing) === '["doNot"]' && /不要做（doNot）只写了「无」/.test(errOf(br)) && /再加半句为什么/.test(errOf(br)), '只写了 ' + JSON.stringify(v) + '：也算缺，报错说要加半句为什么', JSON.stringify(br));
}
ok(tryBrief(with_({ doNot: '无（只读的活，不改任何文件）' }), STD).ok === true && tryBrief(with_({ doNot: '无，这次只是盘点' }), STD).ok === true, '「无」后面加了半句为什么：放行');
br = tryBrief(with_({ goal: '<一句话：要得到什么结果>' }), STD);
ok(br.ok === false && /目标还是模板里的占位/.test(errOf(br)), '还是模板里的 <…> 占位：拒', JSON.stringify(br));
for (const v of ['测试通过', '做好。', 'done']) {
  br = tryBrief(with_({ doneWhen: v }), STD);
  ok(br.ok === false && /对方自己能复核的/.test(errOf(br)), '做完的标准只写 ' + JSON.stringify(v) + '：拒（规格第 2 条）', JSON.stringify(br));
}
for (const v of [42, null, ['a', 'b'], { a: 1 }, true]) {
  br = tryBrief(with_({ role: v }), STD);
  ok(br.ok === false && /角色要是一段文字/.test(errOf(br)), '栏的值是 ' + JSON.stringify(v) + '：拒，要一段文字', JSON.stringify(br));
}
for (const b of ['写在一段话里', ['a'], 0, 42, true, null, undefined]) {
  br = tryBrief(b, STD);
  ok(br.ok === false && /brief 要是一个对象/.test(errOf(br)) && /派给（to）/.test(errOf(br)), 'brief 是 ' + JSON.stringify(b) + '：拒，报错列出七栏', JSON.stringify(br));
}
br = tryBrief(with_({ deadline: '今晚' }), STD);
ok(br.ok === false && /不认识的栏 "deadline"/.test(errOf(br)), '不认识的栏：拒（多半是栏名拼错了，悄悄丢掉对方就看不到）', JSON.stringify(br));
br = tryBrief(JSON.parse(JSON.stringify(FULL).replace('{', '{"__proto__":"x","constructor":"y",')), STD);
ok(br.ok === false && /不认识的栏 "__proto__"、"constructor"/.test(errOf(br)), '__proto__、constructor 当栏名：照不认识的栏拒，不崩', JSON.stringify(br));
br = tryBrief(with_({ 目标: '又写一遍' }), STD);
ok(br.ok === false && /目标写了两遍（goal 和 目标 只留一个）/.test(errOf(br)), '同一栏英文中文各写一遍：拒', JSON.stringify(br));
br = tryBrief({ to: FULL.to, role: '无', goal: FULL.goal, doneWhen: FULL.doneWhen, doNot: FULL.doNot, report: FULL.report, extra: 1 }, STD);
ok(br.ok === false && errOf(br).startsWith('派活单缺栏，没开窗口：缺 背景（context）；角色（role）只写了「无」') && /不认识的栏 "extra"/.test(errOf(br)) && JSON.stringify(br.missing) === '["role","context"]', '几处不对一次全报：缺的、只写「无」的、不认识的', JSON.stringify(br));
ok(errOf(tryBrief(with_({ doneWhen: '测试通过' }), STD)).startsWith('派活单不对，没开窗口：'), '不缺栏、只是写得不对：报错开头是「派活单不对」');
{ const huge = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['k' + i + 'x'.repeat(5000), 'v'])); const r = tryBrief(huge, STD), e = errOf(r); ok(r.ok === false && (r.missing || []).length === 7 && (r.problems || []).length >= 1 && e.length > 0 && e.length < 1200, '一百个很长的乱栏名：照样拒（七栏都算缺、报不认识的栏），报错不会被撑爆', JSON.stringify({ ok: r.ok, missing: (r.missing || []).length, problems: (r.problems || []).length, len: e.length })); }

console.log('\n派活单 brief：派给和 tier / model 对不上就拒');
ok(tryBrief(FULL, STD).ok === true, '派给写 standard、请求 tier 是 standard：放行');
br = tryBrief(with_({ to: 'tier light' }), STD);
ok(br.ok === false && /派给写的是 light，请求里的 tier 是 standard/.test(errOf(br)), '派给写 light、请求 tier 是 standard：拒，两边都写出来', JSON.stringify(br));
br = tryBrief(with_({ to: 'tier light' }), NONE);
ok(br.ok === false && /派给写的是 light，请求里没有 tier/.test(errOf(br)), '派给写了档位、请求里没声明 tier：拒（开出来不是那一档）', JSON.stringify(br));
ok(tryBrief(with_({ to: 'standard（不行就 heavy）' }), STD).ok === false, '派给里写了两个档位：拒');
ok(tryBrief(with_({ to: 'Tier STANDARD' }), STD).ok === true, '档位名不分大小写');
ok(tryBrief(with_({ to: '开一个 lightweight 的窗口，standardize 一下' }), NONE).ok === true, 'lightweight、standardize 里的 light / standard 不算档位');
ok(tryBrief(with_({ to: 'tier standard，Opus 5.5 + xhigh' }), STD).ok === true, '派给写的模型就是 tier 带出来的模型（opus）：放行');
br = tryBrief(with_({ to: 'fable' }), STD);
ok(br.ok === false && /派给写的是 fable，开出来的模型是 opus/.test(errOf(br)), '派给写 fable、tier standard 开出来是 opus：拒', JSON.stringify(br));
ok(tryBrief(with_({ to: 'model gemini-4-neon' }), R.routeNew({ provider: 'claude', model: 'gemini-4-neon' })).ok === true, '派给写 gemini-4-neon、请求 model 是 gemini-4-neon：放行');
br = tryBrief(with_({ to: 'model gemini-4-neon' }), NONE);
ok(br.ok === false && /请求里没有 model/.test(errOf(br)), '派给写 gemini-4-neon、请求里没给 model：拒', JSON.stringify(br));
ok(tryBrief(with_({ to: 'win-1b 那条线的新窗口' }), R.routeNew({ tier: 'light' })).ok === true, '派给没写档位也没写模型（写的是交给谁）：不核，放行');
ok(tryBrief(with_({ to: 'tier light' }), R.routeNew({ tier: 'light', model: 'opus' })).ok === true, '派给只写了档位、请求另外显式给了模型：只核档位');
ok(tryBrief(FULL).ok === false, '没给 routeNew 的结果：按「请求里什么都没声明」核，派给写了 standard 就拒（不放行）');

// ───────────── FIX-1（11/24 15:5x 返修单 FIX-1.md；编号照 REVIEW.md） ─────────────
const U = (...cps) => String.fromCodePoint(...cps);   // 看不见的字一律用码位写，测试文件里不放原字
const txt = (r) => String((r && r.text) || '');
const timed = (b, p) => { const t0 = performance.now(); const r = tryBrief(b, STD, p); return { r, ms: Math.round(performance.now() - t0) }; };
const tryClash = (p) => { try { return typeof R.briefClash === 'function' ? R.briefClash(p) : 'missing-fn'; } catch (e) { return 'threw: ' + String(e.message || e); } };

console.log('\n派活单 brief：长串不卡住服务（FIX-1 M1：每条 100 ms 内返回；改之前 6 万个字是秒级）');
{ const { r, ms } = timed(with_({ context: ' '.repeat(60000) + 'x' })); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === true && txt(r).includes('\n背景：      x\n'), '一栏是 6 万个空格加 x：100 ms 内返回（头上的空格去掉，背景就是 x）', ms + ' ms ' + errOf(r).slice(0, 80)); }
{ const { r, ms } = timed(with_({ context: 'a' + '。'.repeat(60000) + 'x' })); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === false && errOf(r).includes('背景太长（60002 字）'), '一栏是 a 加 6 万个「。」再加 x：100 ms 内返回（拒：太长）', ms + ' ms ' + errOf(r).slice(0, 80)); }
{ const { r, ms } = timed({ ...FULL, [':'.repeat(60000) + 'x']: 'v' }); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === false && /不认识的栏/.test(errOf(r)), '栏名是 6 万个冒号加 x：100 ms 内返回（拒：不认识的栏）', ms + ' ms ' + errOf(r).slice(0, 80)); }
{ const { r, ms } = timed(FULL, '派给' + ' '.repeat(60000) + 'x'); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === false && errOf(r).includes('prompt 太长（60003 字）'), 'prompt 是「派给」加 6 万个空格再加 x：100 ms 内返回（拒：太长）', ms + ' ms ' + errOf(r).slice(0, 80)); }
{ const { r, ms } = timed(with_({ to: 'tier' + '-'.repeat(60000) + 'x' })); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === false && errOf(r).includes('派给太长（60005 字）'), '派给是 tier 加 6 万个横杠再加 x：100 ms 内返回（FIX-2 放宽的分隔符；拒：太长）', ms + ' ms ' + errOf(r).slice(0, 80)); }
{ const { r, ms } = timed(with_({ to: 'tier standard(' + 'a'.repeat(60000) })); console.log('       ' + ms + ' ms');
  ok(ms < 100 && r.ok === false && errOf(r).includes('派给太长（60014 字）'), '派给是 tier standard( 加 6 万个 a、没有右括号：100 ms 内返回（FIX-2 R1 的括号；拒：太长）', ms + ' ms ' + errOf(r).slice(0, 80)); }
br = tryBrief({ ...FULL, ['goal' + ' '.repeat(70) + 'xyz']: 'v' }, STD);
ok(br.ok === false && /不认识的栏/.test(errOf(br)) && !/写了两遍/.test(errOf(br)), '超过 64 个字的栏名一律不认（不是截到 64 再认：goal + 70 个空格 + xyz 不当成 goal）', JSON.stringify(br));

console.log('\n派活单 brief：换行都归一（FIX-1 S4、审查 M-a）');
same(txt(tryBrief(with_({ context: 'a\rb' }), STD)).split('\n').slice(4, 6), ['背景：      a', '            b'], '单个 \\r 当换行（不归一的话终端里是「回到行首」，会显示成顶格的一行）');
for (const [nm, cp] of [['U+2028', 0x2028], ['U+2029', 0x2029], ['U+0085', 0x85], ['\\v', 0x0b], ['\\f', 0x0c]]) {
  const t = txt(tryBrief(with_({ context: 'a' + U(cp) + 'b' }), STD));
  ok(t.includes('\n背景：      a\n            b\n') && !t.includes(U(cp)), nm + ' 当换行：拼出来是两行，原字不留', JSON.stringify(t.split('\n').slice(4, 6)));
}

console.log('\n派活单 brief：看不见的字不算内容（FIX-1 S1）');
for (const [nm, cps] of [['U+200B 零宽空格', [0x200b]], ['U+200D 零宽连接', [0x200d]], ['U+2060', [0x2060]], ['U+00AD 软连字符', [0xad]], ['U+3164', [0x3164]], ['U+2800', [0x2800]], ['U+202E 方向控制加 U+E0041 tag 字符', [0x202e, 0xe0041]]]) {
  br = tryBrief(with_({ goal: U(...cps) }), STD);
  ok(br.ok === false && JSON.stringify(br.missing) === '["goal"]', '目标只有 ' + nm + '：算缺', JSON.stringify(br));
}
br = tryBrief(with_({ doNot: '无' + U(0x200b) }), STD);
ok(br.ok === false && JSON.stringify(br.missing) === '["doNot"]', '「无」后面跟一个零宽空格：还是只写了「无」', JSON.stringify(br));
br = tryBrief(with_({ context: 'a' + U(0x200b) + 'b' + U(0x202e) + 'c' + U(0x3164) }), STD);
ok(br.ok === true && txt(br).includes('\n背景：      abc\n') && ![0x200b, 0x202e, 0x3164].some((c) => txt(br).includes(U(c))), '拼进 prompt 的那份也去掉看不见的字（判的和发出去的是同一份）', JSON.stringify(txt(br).split('\n')[4]));

console.log('\n派活单 brief：「无」的变体（FIX-1 S2）、占位后面带标点（S3）');
for (const v of ['「无」', '（无）', '(无)', '『无』', '【无】', '"无"', '“无”', "'none'", '「无。」', '「无」。', '無', '不适用', '不涉及', 'n.a.', 'N.A', 'n.a']) {
  br = tryBrief(with_({ doNot: v }), STD);
  ok(br.ok === false && JSON.stringify(br.missing) === '["doNot"]' && /不要做（doNot）只写了「无」/.test(errOf(br)), '只写了 ' + JSON.stringify(v) + '：算缺', JSON.stringify(br));
}
for (const v of ['（无，只读的活）', '「无」以外的都先问一下', '无（不适用：只读）']) ok(tryBrief(with_({ doNot: v }), STD).ok === true, JSON.stringify(v) + '：括号里或括号后面还有话，放行');
for (const v of ['<一句话：要得到什么结果>。', '<一句话：要得到什么结果>；']) {
  br = tryBrief(with_({ goal: v }), STD);
  ok(br.ok === false && errOf(br).includes('目标还是模板里的占位 <一句话：要得到什么结果>，没填'), '占位后面多一个 ' + JSON.stringify(v.slice(-1)) + '：照拒', JSON.stringify(br));
}

console.log('\n派活单 brief：请求另带的 prompt 里又写了一张派活单就拒（FIX-1 S5）');
for (const [p, want] of [
  ['【派活单】又一张', '【派活单】又一张'],
  ['先看 A\n派给：tier light', '派给：tier light'],
  ['先看 A\r回报 ：发给 1b', '回报 ：发给 1b'],
  ['Goal: fix it', 'Goal: fix it'],
  ['DONE_WHEN：全过', 'DONE_WHEN：全过'],
  ['do-not:x', 'do-not:x'],
  ['doNot\t: x', 'doNot\t: x'],
  [U(0xfeff) + '背景：贴在最前面', '背景：贴在最前面'],
  ['做完的标准：' + 'x'.repeat(100), '做完的标准：' + 'x'.repeat(34)],
  // FIX-2 R3：每一行先做 NFKC，冒号前认全角空格；回的是原来那一行
  ['派给' + U(0x3000) + '：tier light', '派给' + U(0x3000) + '：tier light'],
  ['Ｔｏ：win-1b', 'Ｔｏ：win-1b'],
  ['派给﹕tier light', '派给﹕tier light'],
  // FIX-2（复审 ⑦ 的改坏版 C）：U+0085、\f、\v 也当换行；JS 的 m 模式自己不认这三个
  ['x' + U(0x85) + '派给：tier light', '派给：tier light'],
  ['x' + U(0xc) + '派给：tier light', '派给：tier light'],
  ['x' + U(0xb) + '目标：写 A', '目标：写 A'],
]) same(tryClash(p), want, 'briefClash 认出 ' + JSON.stringify(p.slice(0, 16)) + '，回那一行（最多 40 个字）');
for (const p of ['', '  派给：缩进的不算', '这一车的目标：写在句子中间不算', '派给 win-1b（没有冒号）', 'together: x', 'reporting: x', 'contexts: x', '目标', undefined, null, 42]) same(tryClash(p), null, 'briefClash 不认 ' + JSON.stringify(p));
// FIX-2 R3 定下的不认（CLAUDE.md「FIX-2 也没做的」）：markdown 前缀、繁体栏名、NFKC 以后变成两个点的 ︰
for (const p of ['- 派给：tier light', '**派给**：tier light', '> 派给：tier light', '派給：tier light', '派给︰tier light']) same(tryClash(p), null, 'briefClash 不认 ' + JSON.stringify(p) + '（FIX-2 定的）');
br = tryBrief(FULL, STD, '补充一句：先看 A\n回报：发给 1b');
ok(br.ok === false && errOf(br).includes('prompt 里又写了一张派活单，只留 brief') && errOf(br).includes('回报：发给 1b') && JSON.stringify(br.missing) === '[]', '带了 brief、prompt 里又有顶格的「回报：」：拒，报错点出那一行', JSON.stringify(br));
br = tryBrief(FULL, STD, '先看 A\nＴｏ：win-1b');
ok(br.ok === false && errOf(br).includes('prompt 里顶格的这一行：Ｔｏ：win-1b）'), 'prompt 里顶格的「Ｔｏ：」（全角）：拒，报错回的是原来那一行（FIX-2 R3）', errOf(br));
br = tryBrief(FULL, STD, '补充：先看 A');
ok(br.ok === true && br.text === FULL_TEXT, 'prompt 里没有第二张：放行，briefNew 拼出来的只有派活单（prompt 由 server 接在后面）', JSON.stringify(br));

console.log('\n派活单 brief：派给的判法，REVIEW.md ④ 那张表逐行，再加模板写法（FIX-1 S6、S8）；FIX-2 再加紧跟 tier X 的括号、放宽的分隔符（复审 ⑤ R1、R2）');
{ const rt = (o) => R.routeNew({ provider: 'claude', ...o });
  const LIGHT = rt({ tier: 'light' }), HEAVY_OPUS = rt({ tier: 'heavy', model: 'opus' }), CODEX_STD = R.routeNew({ provider: 'codex', tier: 'standard' }), NEON = rt({ model: 'gemini-4-neon' }), STD_LOW = rt({ tier: 'standard', effort: 'low' }), LIGHT_OPUS = rt({ tier: 'light', model: 'opus' }), HEAVY = rt({ tier: 'heavy' });
  for (const [to, req, rtv, want] of [
    ['tier standard（主号）', 'std', STD, true],
    ['Tier STANDARD', 'std', STD, true],
    ['开一个 lightweight 的窗口，standardize 一下', '不带 tier', NONE, true],
    ['highlight 一下', 'std', STD, true],
    ['enlighten 一下', 'std', STD, true],
    ['heavy（fable）', 'heavy + model opus', HEAVY_OPUS, false],
    ['standard（opus）', 'codex + tier standard', CODEX_STD, false],
    ['heavy', 'heavy + model opus', HEAVY_OPUS, true],
    ['Gemini 4 Neon', 'std', STD, false],
    ['gemini', 'std', STD, false],
    ['neon', 'std', STD, false],
    ['Opus5.5', 'light', LIGHT, false],
    ['fable5', 'std', STD, false],
    ['ｈｅａｖｙ', 'std', STD, false],
    ['standard（opus + xhigh）', 'std + effort low', STD_LOW, true],
    ['tier standard（不要因为保险选 heavy）', 'std', STD, true],
    ['standard，审完交给 Sonnet 复核', 'std', STD, false],
    ['light-weight 的活', 'std', STD, true],
    ['heavy_lane', 'std', STD, true],
    ['repoC-light-fix 那个窗口', 'std', STD, true],
    // 表外：模板写法和正面例子
    ['tier standard，审完交给 Sonnet 复核', 'std', STD, true],
    ['tier light（写理由时顺口提到 Opus 5.5）', 'light', LIGHT, false],   // FIX-1 是放；FIX-2 R1 起紧跟 tier X 的括号里的模型名照核
    ['tier：heavy', 'std', STD, false],
    ['tier=light', 'light', LIGHT, true],
    ['model opus，standard 那条线的活', 'light + model opus', LIGHT_OPUS, true],
    ['model sonnet', 'std', STD, false],
    ['model: Gemini-4-Neon', 'model gemini-4-neon', NEON, true],
    ['Gemini 4 Neon', 'model gemini-4-neon', NEON, true],
    ['neon', 'model gemini-4-neon', NEON, true],
    ['Gemini 4 Carbon', 'model gemini-4-neon', NEON, false],
    ['standard，Opus 5.5 + xhigh', 'std', STD, true],
    ['claude-opus-5-5', 'light', LIGHT, false],
    // FIX-2 R1：紧跟 tier X 的括号里的模型名照核（括号前可以隔空格、一个引号）；括号外的不核（上面「审完交给 Sonnet 复核」那条）
    ['tier light（opus + xhigh）', 'light', LIGHT, false],
    ['tier heavy（sonnet + high）', 'heavy', HEAVY, false],
    ['tier standard（claude-sonnet-5-5）', 'std', STD, false],
    ['tier standard （sonnet）', 'std', STD, false],
    ['tier="light"（opus）', 'light', LIGHT, false],
    ['tier standard(opus + xhigh)', 'std', STD, true],
    // FIX-2 R2：分隔符认下划线、横杠、引号；模型名认 claude- 前缀
    ['tier-light', 'std', STD, false],
    ['tier="light"，model opus', 'std', STD, false],
    ['tier standard，model claude-sonnet-5-5', 'std', STD, false],
    ['tier standard，model="sonnet"', 'std', STD, false],
    ['tier_standard，model：claude_opus', 'std', STD, true],
    ['tier standard，model opus', 'std', STD, true],
  ]) { const r = tryBrief(with_({ to }), rtv); ok(r.ok === want, '派给 ' + JSON.stringify(to) + '、请求 ' + req + '：' + (want ? '放' : '拒'), JSON.stringify(errOf(r) || r.ok)); } }

br = tryBrief(with_({ to: 'neon 灯那个页面' }), STD);
ok(br.ok === false && errOf(br).includes('派给写的是 gemini-4-neon，开出来的模型是 opus：两边要写成一样，写成 tier X / model Y 就只核这两处'), '整段找词拒的：报错最后多半句「写成 tier X / model Y 就只核这两处」（FIX-2 nit）', errOf(br));
br = tryBrief(with_({ to: 'heavy，sonnet' }), STD);
ok(br.ok === false && errOf(br).split('就只核这两处').length === 2, '整段找词、档位模型都对不上：那半句只加一次', errOf(br));
br = tryBrief(with_({ to: 'tier light' }), STD);
ok(br.ok === false && /派给写的是 light/.test(errOf(br)) && !errOf(br).includes('就只核这两处'), '模板写法拒的：不加那半句', errOf(br));

console.log('\n派活单 brief：拼出来太长就拒（FIX-1 S7，上限 BRIEF_MAX 字节）');
ok(R.BRIEF_MAX === 14000, '上限是 14000 字节（tmux 3.7c 一条命令最多约 16.3 KB，留出账号那层、FOLDER_NOTE、附件清单）', String(R.BRIEF_MAX));
{ const base = Buffer.byteLength(txt(tryBrief(with_({ context: 'a' }), STD))), fit = 'a'.repeat(1 + 14000 - base);
  br = tryBrief(with_({ context: fit }), STD);
  ok(br.ok === true && Buffer.byteLength(txt(br)) === 14000, '派活单正好 14000 字节：放行', String(Buffer.byteLength(txt(br))));
  br = tryBrief(with_({ context: fit + 'a' }), STD);
  ok(br.ok === false && errOf(br) === '派活单太长，没开窗口：背景太长（' + (fit.length + 1) + ' 字），长内容放进文件，背景里写路径（派活单拼出来 14001 字节，上限 14000：tmux 一条命令最多约 16 KB）' && JSON.stringify(br.missing) === '[]', '多 1 个字节：拒，点名最长的那一栏，叫它放进文件', errOf(br));
  const room = 14000 - base - 2;   // server 拼的是 派活单 + 空一行 + prompt
  ok(tryBrief(with_({ context: 'a' }), STD, 'p'.repeat(room)).ok === true, '派活单加空一行加 prompt 正好 14000 字节：放行');
  br = tryBrief(with_({ context: 'a' }), STD, 'p'.repeat(room + 1));
  ok(br.ok === false && errOf(br).includes('prompt 太长（' + (room + 1) + ' 字），长内容放进文件，prompt 里写路径（派活单加 prompt 拼出来 14001 字节'), '多 1 个字节：拒，点名 prompt', errOf(br)); }
br = tryBrief(with_({ context: '背'.repeat(5000) }), STD);
ok(br.ok === false && errOf(br).includes('背景太长（5000 字）'), '「N 字」数的是字，不是字节（5000 个汉字是 15000 字节）', errOf(br));
br = tryBrief(FULL, STD, '字'.repeat(4800));
ok(br.ok === false && errOf(br).includes('prompt 太长（4800 字）') && errOf(br).includes('派活单加 prompt 拼出来 ' + (Buffer.byteLength(FULL_TEXT) + 2 + 14400) + ' 字节'), 'prompt 是 4800 个汉字（14400 字节）：拒，prompt 也按字节算，不按 UTF-16 单位（FIX-2，复审 ⑦ 的改坏版 A）', errOf(br));

console.log('\n派活单 brief：表头按字符截（FIX-1 N1）');
{ const e = U(0x1f600), first = (g) => txt(tryBrief(with_({ goal: g }), STD)).split('\n')[0];
  same(first(e.repeat(85)), '【派活单】' + e.repeat(79) + '…', '目标是 85 个 emoji：表头留 79 个再加「…」，不切开代理项');
  same(first(e.repeat(80)), '【派活单】' + e.repeat(80), '目标正好 80 个 emoji：不截'); }

console.log('\nDroid 的模型清单：parseDroidModels 读 droid exec --help（夹具是真 Droid 的帮助原样）；droidPick 核 /api/new 给的 model / effort');
{ const FX = path.join(HERE, 'fixture-droid-help.txt'), P = R.parseDroidModels(fs.readFileSync(FX, 'utf8')), by = (id) => P.models.find((m) => m.id === id) || {};
  // 条数另数一遍，不经 parseDroidModels：Available Models 那一段里，去掉 [Deprecated] 和 auto 的行
  const g = spawnSync('/bin/sh', ['-c', "/usr/bin/sed -n '/^Available Models:/,/^$/p' \"$0\" | /usr/bin/grep -E '^  [^ ]' | /usr/bin/grep -v 'Deprecated' | /usr/bin/grep -vcE '^  auto '", FX], { encoding: 'utf8' });
  const want = Number(String(g.stdout || '').trim());
  ok(want > 40 && P.models.length === want, '模型条数 = 帮助里不带 [Deprecated]、不是 auto 的行数（sed + grep 另数）：' + want, P.models.length + ' / ' + want + ' ' + (g.stderr || ''));
  same(P.defaultModel, 'claude-opus-5-5', '默认模型是带 (default) 的 claude-opus-5-5');
  same([by('claude-opus-5-5').name, by('claude-opus-5-5').defaultEffort], ['Opus 5.5', 'medium'], 'claude-opus-5-5：显示名去掉 (default)，默认强度 medium');
  same([by('gemini-3.1-pro-preview').name, by('gemini-3.1-pro-preview').efforts, by('gemini-3.1-pro-preview').defaultEffort], ['Gemini 3.1 Pro', ['low', 'medium', 'high'], 'high'], 'gemini-3.1-pro-preview：Gemini 3.1 Pro，强度 low / medium / high，默认 high');
  same(by('gemini-3.5-flash').efforts, ['minimal', 'low', 'medium', 'high'], 'gemini-3.5-flash 的强度按 Model details 那一行（多一个 minimal）');
  ok(!by('deepseek-v4-pro').id && !by('sonnet-4-5').id && !by('claude-sonnet-4-5-20250929').id && !by('auto').id && !P.models.some((m) => /Deprecated|\(default\)/.test(m.name)), '停用的（deepseek-v4-pro、Sonnet 4.5…）和 auto 不列', JSON.stringify(P.models.map((m) => m.id)));
  same([P.models[0].id, P.models[P.models.length - 1].id], ['claude-fable-5.1', 'grok-4.5'], '顺序照帮助里列的');
  same(R.parseDroidModels('Usage: droid exec [options]'), { models: [], defaultModel: null }, '帮助里没有模型清单：空清单');
  same(R.droidPick({}, P), { ok: true, model: '', effort: '' }, '什么都没给：放行，不带模型和强度');
  same(R.droidPick({ model: 'gemini-3.1-pro-preview', effort: 'low' }, P), { ok: true, model: 'gemini-3.1-pro-preview', effort: 'low' }, '清单里的模型 + 它认的强度：放行');
  same(R.droidPick({ effort: 'high' }, P), { ok: true, model: '', effort: 'high' }, '只给强度：按默认模型（Opus 5.5）核，high 放行');
  let e = R.droidPick({ effort: 'off' }, P);
  ok(e.ok === false && e.error.includes('claude-opus-5-5（默认模型） 不认强度「off」，能选：low、medium、high、xhigh、max'), '只给强度、默认模型不认：拒，写明是默认模型和能选什么', e.error);
  e = R.droidPick({ model: '不存在' }, P);
  ok(e.ok === false && e.error.startsWith('Droid 不认模型「不存在」，能选：claude-fable-5.1、') && e.error.includes('gemini-3.1-pro-preview'), '不在清单里的模型：拒，点名这个值，列出能选的', e.error.slice(0, 80));
  e = R.droidPick({ model: 'gemini-3.1-pro-preview', effort: 'xhigh' }, P);
  ok(e.ok === false && e.error === 'Droid 的 gemini-3.1-pro-preview 不认强度「xhigh」，能选：low、medium、high', '模型不认的强度：拒，列出这个模型能选的', e.error);
  e = R.droidPick({ model: 'gemini-3.1-pro-preview' }, { models: [], defaultModel: null });
  ok(e.ok === false && /清单没读到/.test(e.error), '清单是空的（droid exec --help 读不到）：给了模型就拒，只能默认', e.error);
  ok(R.droidPick({ model: ['gemini-3.1-pro-preview'] }, P).ok === false && R.droidPick({ effort: 3 }, P).ok === false, 'model / effort 不是字符串：拒'); }

console.log('\n' + pass + ' 项过，' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
