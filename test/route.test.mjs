/**
 * [INPUT]: 依赖 ../route.mjs（或命令行给的另一份，比如改坏版）。不起服务、不碰 tmux。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 route.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「新窗口档位」测试。测：没声明档位原样放行（界面「默认」不变）；三档各自的模型和强度；显式给的 model / effort 压过档位；
 *        不认识的档位报错（含 __proto__、constructor 这类原型上的名字，和非字符串）；任何档位都不会给出 xhigh / max；Codex 的档位只管强度。
 *        /api/new 接上它之后的端到端断言在 state.test.mjs 的 [7g]。
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
    'heavy-is-max':       ["heavy:    { claude: { model: 'fable',  effort: 'high' }", "heavy:    { claude: { model: 'fable',  effort: 'max' }"],
    'light-is-xhigh':     ["light:    { claude: { model: 'sonnet', effort: 'medium' }", "light:    { claude: { model: 'sonnet', effort: 'xhigh' }"],
    'codex-gets-claude-model': ["const outModel = m || t.model || '';", "const outModel = m || t.model || TIERS[key].claude.model;"],
    'provider-ignored':   ["const pv = provider === 'codex' ? 'codex' : 'claude';", "const pv = 'claude';"],
    'object-tier-accepted': ["const key = text(tier).toLowerCase();", "const key = String(tier).toLowerCase();"],
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
same(pick(R.routeNew({ provider: 'claude', tier: 'heavy' })), { ok: true, tier: 'heavy', model: 'fable', effort: 'high' }, 'heavy → fable + high');
same(pick(R.routeNew({ provider: 'claude', tier: 'standard' })), { ok: true, tier: 'standard', model: 'opus', effort: 'high' }, 'standard → opus + high');
same(pick(R.routeNew({ provider: 'claude', tier: 'light' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'medium' }, 'light → sonnet + medium');
same(pick(R.routeNew({ tier: 'light' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'medium' }, '没写 provider 按 Claude Code 算');
same(pick(R.routeNew({ provider: 'claude', tier: '  Light ' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'medium' }, '大小写和空白不挑（总指挥写成 Light 也认）');

console.log('\n显式给的 model / effort 压过档位，没给的那一半才用档位的');
same(pick(R.routeNew({ tier: 'light', effort: 'xhigh' })), { ok: true, tier: 'light', model: 'sonnet', effort: 'xhigh' }, 'light + 显式强度 xhigh → 模型 sonnet、强度 xhigh');
same(pick(R.routeNew({ tier: 'light', model: 'opus' })), { ok: true, tier: 'light', model: 'opus', effort: 'medium' }, 'light + 显式模型 opus → 模型 opus、强度 medium');
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

console.log('\n成本护栏：任何档位都不会替你选 xhigh / max');
for (const name of R.TIER_NAMES) for (const pv of ['claude', 'codex']) {
  const r = R.routeNew({ provider: pv, tier: name });
  ok(r.ok && !['xhigh', 'max'].includes(r.effort), name + ' / ' + pv + ' 的强度是 ' + r.effort + '，不是 xhigh / max');
}
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

console.log('\n' + pass + ' 项过，' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
