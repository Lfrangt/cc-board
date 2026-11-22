/**
 * [INPUT]: 依赖 ../accounts.mjs（或命令行给的另一份，比如改坏版）。不起服务、不碰 tmux、不碰钥匙串。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 accounts.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「没明说账号时开哪个号」测试（11/22 作者：「我之后新建的任务开到主号」）：parseFallback（config 的 accountFallback 怎么认）、
 *        pickDefault（默认号到顶才退回）。情形照总管 win-4c 11/22 列的：界面新建、主号高于以前的读数、主号到顶、5 小时到顶、重置以后、没有读数。
 *        接口带不带 account、退回的号没 token、日志和退回记录这几条要起服务，在 state.test.mjs 的 [8c]。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/accounts.test.mjs [accounts.mjs 的路径]      node test/accounts.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../accounts.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = fs.mkdtempSync(path.join(HERE, '.tmp-accounts-mut-'));
  const M = {
    'fb-ignores-reset':   ["w.resetsAt > now && w.used >= line", "w.used >= line"],
    'fb-strict-above':    ["w.used >= line", "w.used > line"],
    'fb-week-only':       ["(w.key === 'week' || w.key === 'five_hour')", "w.key === 'week'"],
    'fb-any-window':      ["(w.key === 'week' || w.key === 'five_hour')", "true"],
    'fb-any-account':     ["(x) => x && x.account === account", "(x) => x"],
    'fb-target-unchecked': ["  if (full) return", "  if (false) return"],
    'fb-unknown-keys-ok': ["  if (odd.length) return bad(", "  if (false) return bad("],
    'fb-tomax-default':   ["raw.toMax === undefined ? at : raw.toMax", "raw.toMax === undefined ? 100 : raw.toMax"],
    'fb-tomax-range':     ["toMax < 50 || toMax > 100", "toMax < 0 || toMax > 1000"],
    'fb-no-round':        ["used: Math.round(top.used), resetsAt: top.resetsAt };", "used: top.used, resetsAt: top.resetsAt };"],
    'fb-no-default-95':   ["raw.at === undefined ? 95 : raw.at", "raw.at === undefined ? 90 : raw.at"],
    'fb-to-unchecked':    ["if (!accounts.some((a) => a.id === raw.to)) return bad('to 要是 accounts 里登记过的 id');", ""],
    'fb-to-self-ok':      ["if (raw.to === defaultAccount) return bad('to 和 defaultAccount 是同一个号');", ""],
    'fb-range-open':      ["at < 50 || at > 100", "at < 0 || at > 1000"],
    'fb-note-relative':   ["!path.isAbsolute(raw.note)", "false"],
    'fb-always-on':       ["if (!defaultAccount || !fb) return { id: defaultAccount || '' };", "if (!defaultAccount) return { id: '' }; fb = fb || { to: 'friend', at: 95 };"],
  };
  let caught = 0; const names = Object.keys(M);
  for (const n of names) {
    const [a, b] = M[n]; const hits = src.split(a).length - 1;
    if (hits !== 1) { console.log(`  mutant ${n}: 原文出现 ${hits} 次（要正好 1 次）`); continue; }
    const f = path.join(dir, n + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const red = r.status !== 0; if (red) caught++;
    console.log(`  ${red ? 'caught' : 'MISSED'} ${n}${red ? '：' + ((r.stdout.match(/^FAIL .*/m) || [''])[0]).slice(0, 110) : ''}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${caught}/${names.length} 个改坏版被抓到`);
  process.exit(caught === names.length ? 0 : 1);
}

const { parseFallback, pickDefault } = await import(SRC);
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok   ' + what); } else { fail++; console.log('FAIL ' + what + (got === undefined ? '' : '  → ' + got)); } };
const J = JSON.stringify;

// ── config 的 accountFallback ──
const ACC = [{ id: 'main', name: '主号' }, { id: 'alt', name: '副号' }, { id: 'friend', name: '朋友号' }];
let r = parseFallback(undefined, ACC, 'main');
ok(r.fb === null && r.error === null, '不写 accountFallback：没有退回，也不算写错（和以前一样）', J(r));
r = parseFallback({ to: 'friend' }, ACC, 'main');
ok(r.fb && r.fb.to === 'friend' && r.fb.at === 95 && r.fb.toMax === 95 && r.fb.note === '' && r.error === null, '只写 to：到顶线默认 95%，退回的号自己的线（toMax）跟着 at', J(r));
r = parseFallback({ to: 'friend', at: 90 }, ACC, 'main');
ok(r.fb && r.fb.at === 90 && r.fb.toMax === 90, '只写 at 90：toMax 跟着是 90', J(r));
r = parseFallback({ to: 'friend', toMax: 78 }, ACC, 'main');
ok(r.fb && r.fb.at === 95 && r.fb.toMax === 78, 'toMax 78（退回的号自己的线）：照写的用', J(r));
r = parseFallback({ to: 'friend', at: 100, note: '/tmp/x/fyi.md' }, ACC, 'main');
ok(r.fb && r.fb.at === 100 && r.fb.note === '/tmp/x/fyi.md', 'at 100、note 完整路径：照写的用', J(r));
r = parseFallback({ to: 'friend', at: 50 }, ACC, 'main');
ok(r.fb && r.fb.at === 50, 'at 50（下界）可以', J(r));
for (const [raw, def, why] of [
  [{ to: 'nobody' }, 'main', 'to 是没登记的号'],
  [{ to: 'main' }, 'main', 'to 和默认号是同一个'],
  [{ to: 'friend' }, '', '没有 defaultAccount'],
  [{ to: 'friend', at: 49, toMax: 78 }, 'main', 'at 低于 50（toMax 写对了也不行）'],
  [{ to: 'friend', at: 101, toMax: 78 }, 'main', 'at 高于 100（toMax 写对了也不行）'],
  [{ to: 'friend', at: '95' }, 'main', 'at 写成字符串'],
  [{ to: 'friend', at: NaN }, 'main', 'at 是 NaN'],
  [{ to: 'friend', note: 'run/fyi.md' }, 'main', 'note 不是完整路径'],
  [{ to: 'friend', note: 3 }, 'main', 'note 不是字符串'],
  [{ to: 'friend', toMax: 49 }, 'main', 'toMax 低于 50'],
  [{ to: 'friend', toMax: '78' }, 'main', 'toMax 写成字符串'],
  [{ to: 'friend', notes: '/tmp/x.md' }, 'main', '不认识的键（note 拼成 notes：不然就悄悄没有记录）'],
  [{ to: 'friend', enabled: true }, 'main', '不认识的键（enabled）'],
  [['friend'], 'main', '写成数组'],
  [true, 'main', '写成 true'],
  [null, 'main', '写成 null'],
]) { const x = parseFallback(raw, ACC, def); ok(x.fb === null && typeof x.error === 'string' && x.error.length > 0, '写错只关这一项、说清原因：' + why, J(x)); }

// ── 没明说账号时开哪个号 ──
// 读数照 limits.mjs 的汇总条目：{ account, windows: [{ key: five_hour | week | other, used, resetsAt }] }。时间钉住，不看真钟
const NOW = Date.UTC(2026, 10, 22, 18, 30);
const H = 3600000, RESET = Date.UTC(2026, 10, 24, 18, 0);      // 主号周窗口的截止时间：离 NOW 约两天
const FB = { to: 'friend', at: 95, note: '' };
const ent = (account, week, five, wReset = RESET) => ({ account, windows: [...(five === undefined ? [] : [{ key: 'five_hour', used: five, resetsAt: NOW + 2 * H }]), { key: 'week', used: week, resetsAt: wReset }] });
const real = [ent('alt', 97, undefined, NOW + 1.5 * 24 * H), ent('friend', 60, undefined, NOW + 4 * 24 * H)];   // 另两个号的读数（alt 97%、friend 60%），主号的读数各条用例自己加
const pick = (entries, fb = FB, def = 'main', now = NOW) => pickDefault(def, fb, entries, now);
const P = (x) => x.id + (x.from ? ` ← ${x.from} ${x.key} ${x.used}%` : '');

let d = pick([...real, ent('main', 77)]);
ok(d.id === 'main' && !d.from, '界面新建，主号 77%：开主号', P(d));
d = pick([...real, ent('main', 90)]);
ok(d.id === 'main' && !d.from, '主号 90%：照开主号（没有「过了某个读数就分流」这回事）', P(d));
d = pick([...real, ent('main', 94, 94)]);
ok(d.id === 'main', '主号周 94%、5 小时 94%：还差 1 点，照开主号', P(d));
d = pick([...real, ent('main', 95)]);
ok(d.id === 'friend' && d.from === 'main' && d.key === 'week' && d.used === 95 && d.resetsAt === RESET, '主号周 95%（正好到线）：退回朋友号，带上从哪个号、哪个窗口、读数、几点重置', J(d));
d = pick([...real, ent('main', 100)]);
ok(d.id === 'friend' && d.key === 'week' && d.used === 100, '主号周 100%（真到顶）：退回朋友号', P(d));
d = pick([...real, ent('main', 60, 97)]);
ok(d.id === 'friend' && d.key === 'five_hour' && d.used === 97, '主号周 60%、5 小时 97%：5 小时到顶也退回（开出来马上就卡额度）', P(d));
d = pick([...real, ent('main', 99, undefined, NOW - 60000)]);
ok(d.id === 'main' && !d.from, '重置以后：周 99% 那个窗口的截止时间已经过了，读数不算，回到主号', P(d));
d = pick([...real, ent('main', 99, undefined, NOW)]);
ok(d.id === 'main', '截止时间正好是现在：当已经重置', P(d));
d = pick([...real, { account: 'main', windows: [{ key: 'week', used: 30, resetsAt: NOW + 6 * 24 * H }, { key: 'five_hour', used: 99, resetsAt: NOW - 1000 }] }]);
ok(d.id === 'main', '5 小时窗口过了截止时间：不算，照开主号', P(d));
d = pick(real);
ok(d.id === 'main' && !d.from, '主号没有读数（没有窗口说过话）：不知道到没到顶，照开主号', P(d));
d = pick([]); ok(d.id === 'main', '一个读数都没有：开主号', P(d));
d = pick(undefined); ok(d.id === 'main', '读数是 undefined：开主号', P(d));
d = pick([ent('friend', 99), ent('alt', 100)]);
ok(d.id === 'main', '别的号到顶不影响主号', P(d));
d = pick([...real, { account: 'main', windows: [{ key: 'other', used: 100, resetsAt: NOW + H }] }]);
ok(d.id === 'main', '认不出的窗口（other）100%：不算到顶', P(d));
d = pick([...real, { account: 'main' }]);
ok(d.id === 'main', '条目没有 windows：开主号，不抛', P(d));
d = pick([...real, ent('main', 99)], null);
ok(d.id === 'main' && !d.from, '没配 accountFallback：主号 99% 也照开主号（和以前一样）', P(d));
d = pick([...real, ent('main', 99)], FB, '');
ok(d.id === '' && !d.from, '没有默认号：回空（服务照旧用钥匙串当前登录的号）', P(d));
const FB78 = { to: 'friend', at: 95, toMax: 78, note: '' };
d = pick([ent('friend', 79), ent('main', 96)], FB78);
ok(d.id === 'main' && !d.from && d.blocked && d.blocked.key === 'week' && d.blocked.used === 96 && d.blocked.to === 'friend' && d.blocked.toKey === 'week' && d.blocked.toUsed === 79, '主号 96%、朋友号自己也到了 78%（它的停放线）：不退，照旧开主号，返回里写明两个号的读数', J(d));
d = pick([ent('friend', 77), ent('main', 96)], FB78);
ok(d.id === 'friend' && d.from === 'main', '主号 96%、朋友号 77%（没到 78%）：退回朋友号', P(d));
d = pick([ent('friend', 50, 80), ent('main', 96)], FB78);
ok(d.id === 'main' && d.blocked && d.blocked.toKey === 'five_hour', '朋友号周 50% 但 5 小时 80%：也算它到顶，不退', J(d));
d = pick([ent('friend', 99, undefined, NOW - 1000), ent('main', 96)], FB78);
ok(d.id === 'friend', '朋友号 99% 那个窗口已经过了截止时间：不算，照样退回朋友号', P(d));
d = pick([ent('friend', 94), ent('main', 96)]);
ok(d.id === 'friend', '不写 toMax：朋友号的线跟着 at（95），94% 照样退', P(d));
d = pick([...real, ent('main', 95.4)]);
ok(d.id === 'friend' && d.used === 95, '读数带小数 95.4：按原数比（≥95 退回），给人看的 used 取整成 95', J(d));
d = pick([...real, ent('main', 94.6)]);
ok(d.id === 'main', '94.6：没到 95，照开主号（不先取整再比）', P(d));
d = pick([...real, ent('main', 96, undefined, NOW + 5 * 24 * H)], { to: 'friend', at: 100, note: '' });
ok(d.id === 'main', 'at 设成 100：96% 不退', P(d));

console.log(`\n${pass} 过 ${fail} 没过`);
process.exit(fail ? 1 : 0);
