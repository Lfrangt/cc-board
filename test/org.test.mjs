/**
 * [INPUT]: 依赖 ../org.mjs（或命令行给的另一份，比如改坏版）。不起服务、不碰 tmux、不读文件。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 org.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「架构：谁归谁管」规则测试。测 buildOrg 的四步：总管（点名压过字样、没点名取最晚开的、前任 / 比总管晚开的不是前任）；
 *        每个项目的负责人（已经在带人的里最晚开的、早的是前任、负责人挂在总管下面、总管的项目不另立）；其余窗口看证据（开它的窗口、消息条数、
 *        他本人的分量、互相发消息比谁更依赖谁、负责人的消息按 1.5 倍、上级是前任的跟着岗位走、跨项目不算上级但总管例外、向负责人交东西的归负责人、
 *        已经不在的发信人只进分母）；垃圾输入和三个窗口指成一圈不崩不死循环；wordsRe；
 *        已经不在的窗口（gone 项）：名字带岗位字样的是前任、听它的跟着岗位归现任（handed）、普通的当不了上级、都不在了就没有负责人、不出现在 nodes 里。
 *        分支负责人（第 14 段，11/17）：「X负责人」挂在总指挥下面、不是它的前任；同一条分支换代；不同分支各自；照旧是负责人的写法；没有总指挥的项目兜底；branchOf。
 *        按项目挂上（第 15 段，11/17）：没有窗口在管的普通窗口挂到本项目的岗位（标题对得上一条分支 → 分支负责人，否则负责人，没有负责人 → 总管，都没有 → 你直接带）；branchWords。
 *        服务把对话记录里的证据交给它之后的端到端断言在 state.test.mjs 的 [1c]、[7h]。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/org.test.mjs [org.mjs 的路径]      node test/org.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../org.mjs'));

// ── 反向对照：每次只改坏一处规则，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'org-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'chief-ignores-named':  ["const chief = (typeof opt.chief === 'string' && here(byId.get(opt.chief))) || newest(chiefLike.filter(here));", 'const chief = newest(chiefLike.filter(here));'],
    'chief-later-former':   ['if (s !== chief && (s.gone || s.at < chief.at)) formerOf.set(s.sid, chief.sid);', 'if (s !== chief) formerOf.set(s.sid, chief.sid);'],
    'newest-is-oldest':     ['a.slice().sort((x, y) => y.at - x.at ||', 'a.slice().sort((x, y) => x.at - y.at ||'],
    'lead-ignores-acted':   ['cur = newest(doing.length ? doing : on);', 'cur = newest(on);'],
    'lead-not-under-chief': ["if (chief && sid !== chief.sid) nodes[sid] = { ...nodes[sid], boss: chief.sid, via: 'seat' };", 'if (false) nodes[sid] = nodes[sid];'],
    'lead-in-chief-dept':   ['leadRe.test(s.label) && !(chief && s.dept === chief.dept)) {', 'leadRe.test(s.label)) {'],
    'spawn-weak':           ['export const SPAWN_W = 1.5;', 'export const SPAWN_W = 0.5;'],
    'spawn-prompt-counted': ['Math.max(0, s.hn - (s.by ? 1 : 0))', 'Math.max(0, s.hn)'],
    'one-msg-enough':       ['export const MIN_MSGS = 2;', 'export const MIN_MSGS = 1;'],
    'human-ignored':        ['if (best && bw > mine(s) && dep(s, best) > dep(best, s)) {', 'if (best && bw > 0 && dep(s, best) > dep(best, s)) {'],
    'mutual-ignored':       ['if (best && bw > mine(s) && dep(s, best) > dep(best, s)) {', 'if (best && bw > mine(s)) {'],
    'seat-no-bonus':        ['export const SEAT_W = 1.5;', 'export const SEAT_W = 1;'],
    'no-follow-seat':       ["if (n.role === 'member' && formerOf.has(n.boss)) { n.boss = formerOf.get(n.boss); n.handed = true; }", 'if (false) { }'],
    'cross-dept-boss':      ['const near = (s, p) => p.dept === s.dept ||', 'const near = (s, p) => true ||'],
    'chief-not-near':       ['const near = (s, p) => p.dept === s.dept || (chief && (p === chief || formerOf.get(p.sid) === chief.sid));', 'const near = (s, p) => p.dept === s.dept;'],
    'fallback-always':      ['    if (mine(s) >= 1) continue;\n', ''],
    'dead-not-counted':     ['    for (const f of s.from) t += f.n', '    for (const f of s.from) if (f.sid) t += f.n'],
    'no-cycle-guard':       ['if (seen.has(b)) {', 'if (false) {'],
    'self-spawn-counts':    ['if (s.by === s.sid || !byId.has(s.by)) s.by = null;', 'if (!byId.has(s.by)) s.by = null;'],
    'words-empty-matches':  ["if (typeof src !== 'string' || !src.trim()) return null;", "if (typeof src !== 'string') return null;"],
    'words-throws':         ["try { return new RegExp(src, 'i'); } catch { return null; }", "return new RegExp(src, 'i');"],
    // 已经不在的窗口（gone，11/15 第二步）
    'gone-not-former-lead': ['for (const s of g) if (s !== cur && (s.gone || s.at < cur.at)) formerOf.set(s.sid, cur.sid);', 'for (const s of g) if (s !== cur && s.at < cur.at) formerOf.set(s.sid, cur.sid);'],
    'gone-not-former-chief': ['if (s !== chief && (s.gone || s.at < chief.at)) formerOf.set(s.sid, chief.sid);', 'if (s !== chief && s.at < chief.at) formerOf.set(s.sid, chief.sid);'],
    'gone-can-lead':        ['const on = g.filter(here);', 'const on = g;'],
    'no-lead-left-throws':  ['const on = g.filter(here); if (!on.length) return null;', 'const on = g.filter(here);'],
    'gone-chief-named':     ['here(byId.get(opt.chief))', 'byId.get(opt.chief)'],
    'gone-member-can-boss': ['      if (p.gone && !formerOf.has(p.sid)) continue;', ''],
    'gone-stays-in-nodes':  ['  for (const s of S) if (s.gone) delete nodes[s.sid];', ''],
    'handed-not-set':       ['n.boss = formerOf.get(n.boss); n.handed = true;', 'n.boss = formerOf.get(n.boss);'],
    'from-null-throws':     [".filter((f) => f && typeof f === 'object')", ''],
    // 分支负责人（11/17）
    'head-off':             ['return !!m && !(leadRe', 'return false && !(leadRe'],
    'head-lead-precedence': ["return !!m && !(leadRe && leadRe.test(s.label.replace(headG, ' '))) && (m[0]", 'return !!m && (m[0]'],
    'head-one-branch':      ["const k = s.dept + '\\n' + branchKey(s.label);", "const k = s.dept;"],
    'head-under-chief':     ['const up = leads[dept] || (chief ? chief.sid : null);', 'const up = chief ? chief.sid : null;'],
    'head-no-fallback':     ['  for (const [dept, g] of byDept) { const lead = seat(g); if (lead) { leads[dept] = lead.sid; nodes[lead.sid].role = \'lead\'; } }\n', ''],
    'branch-no-prefix':     ["return ((pre ? pre[0] : '') + m[0]", "return ('' + m[0]"],
    // 按项目挂上（11/17）
    'dept-off':             ["if (up && up !== s.sid && nodes[up]) nodes[s.sid] = { role: 'member', boss: up, via: 'dept'", "if (false) nodes[s.sid] = { role: 'member', boss: up, via: 'dept'"],
    'dept-no-chief':        ['const up = (!tie && hit) || leads[s.dept] || (chief ? chief.sid : null);', 'const up = (!tie && hit) || leads[s.dept] || null;'],
    'dept-no-branch':       ['const up = (!tie && hit) || leads[s.dept] ||', 'const up = leads[s.dept] ||'],
    'dept-tie-picks':       ['else if (k > 0 && k === hn) tie = true;', 'else if (false) tie = true;'],
    'dept-any-lead':        ['const up = (!tie && hit) || leads[s.dept] ||', 'const up = (!tie && hit) || leads[s.dept] || Object.values(leads)[0] ||'],
    'dept-overrides-boss':  ["if (s.gone || !n || n.role !== 'member' || n.boss) continue;", "if (s.gone || !n || n.role !== 'member') continue;"],
    'words-split-he':       ['split(/[\\s与、&/+,，·]+|', 'split(/[\\s与和、&/+,，·]+|'],
    'words-no-tail':        ["const tail = /(?:分支|方向|小组|线|组)+$/u;", "const tail = /(?!)/u;"],
    'words-six-chars':      ['[\\p{Script=Han}、/&+]{0,15}$/u', '[\\p{Script=Han}、/&+]{0,5}$/u'],
    'words-one-char':       ['/\\p{Script=Han}/u.test(w) ? w.length >= 2 :', '/\\p{Script=Han}/u.test(w) ? w.length >= 1 :'],
    // 点名的负责人、「…分支」、岗位发过消息的（11/17 win-49）
    'seats-ignored':        ["if (opt.seats && typeof opt.seats === 'object') for", 'if (false) for'],
    'seats-any-dept':       ['if (s && s.dept === d && s !== chief && !(chief && d === chief.dept)) pinned.set(d, s);', 'if (s) pinned.set(d, s);'],
    'seats-later-former':   ['for (const s of lineage) if (s.gone || s.at < p.at) formerOf.set(s.sid, p.sid);', 'for (const s of lineage) formerOf.set(s.sid, p.sid);'],
    'seats-no-lineage':     ['if (!lineage.length) for (const [k, g] of branches)', 'if (false) for (const [k, g] of branches)'],
    'spawner-not-former':   ['if ((actedOn.get(p.sid) || new Set()).size >= 2) formerOf.set(p.sid, sid);', 'if (false) formerOf.set(p.sid, sid);'],
    'spawner-relay-former': ['.size >= 2) formerOf.set(p.sid, sid);', '.size >= 1) formerOf.set(p.sid, sid);'],
    'branch-no-directs':    ["(m[0] !== '分支' || directs(s))", 'true'],
    'directs-counts-seats': ['(t) => t !== s.sid && !seatish(t)', '(t) => t !== s.sid'],
    'branch-key-old':       ["const k = s.dept + '\\n' + branchKey(s.label);", "const k = s.dept + '\\n' + branchOf(s.label, headRe);"],
    'contact-off':          ["if (ct) { nodes[s.sid] = { role: 'member', boss: ct.sid, via: 'contact'", "if (false) { nodes[s.sid] = { role: 'member', boss: ct.sid, via: 'contact'"],
    'contact-any-role':     ["if ((r !== 'lead' && r !== 'head') || byId.get(f.sid).dept !== s.dept ||", 'if (!r || byId.get(f.sid).dept !== s.dept ||'],
    'contact-cross-dept':   [" || byId.get(f.sid).dept !== s.dept || now - f.last", ' || now - f.last'],
    'contact-oldest':       ['if (!ct || f.last > ct.last) ct = f;', 'if (!ct || f.last < ct.last) ct = f;'],
    'contact-no-age':       [' || now - f.last > CONTACT_MS) continue;', ') continue;'],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, b));
    // 拿掉防死循环的那个改坏版会真的死循环：限时 20 秒，超时（status 是 null）也算变红
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8', timeout: 20000 });
    const red = r.status !== 0; if (!red) bad++;
    const why = r.status === null ? '超时（' + (r.signal || '?') + '）' : (String(r.stdout || '').trim().split('\n').filter((l) => /FAIL/.test(l)).slice(0, 1).join('') || String(r.stdout || '').trim().split('\n').pop() || '');
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：' + why);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' 个改坏版没让测试变红' : '全部改坏版（' + Object.keys(M).length + ' 个）都让测试变红');
  process.exit(bad ? 1 : 0);
}

const O = await import(SRC);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };

// ── 造输入：一个会话 = 名字、标题、项目、开的时间、他本人说了几轮、谁发来几条、谁开的 ──
const NOW = 1_800_000_000_000, H = 3600e3;
const BRANCH_TAIL = '(?<=[\\u4e00-\\u9fff]{2})(?<!合并|合进|合入|并入|清理|删除|删掉|切换|切到|新建|新开|拉取|拉出|推送|远程|本地|临时|功能|特性|发布|开发|修复|热修|上线|回滚|[主旧切删拉推建合])分支(?=\\s*(?:交接|接手|开工|接班)?\\s*$)';
const W = { chiefWords: '总管|chief of staff', leadWords: '总指挥|负责人|(?:^|[^a-z])lead(?:$|[^a-z])', headWords: '(?<=[\\u4e00-\\u9fff])(?<!总)负责人|head of|' + BRANCH_TAIL };   // 和 server.mjs 的默认字样一样（第 16 段 H 核对）
const S = (sid, o = {}) => ({ sid, name: o.name || sid, title: o.title || '', dept: o.dept || 'd', startedAt: NOW - (o.ago ?? 10) * H,
  human: o.human || { n: 0, last: 0 }, from: o.from || [], by: o.by || null });
const msg = (sid, n, agoH = 0.1) => ({ sid, n, last: NOW - agoH * H });
const dead = (n, agoH = 0.1) => ({ sid: null, n, last: NOW - agoH * H });
const hum = (n, agoH = 0.05) => ({ n, last: NOW - agoH * H });
const org = (list, opt = {}) => { try { return O.buildOrg(list, { now: NOW, ...W, ...opt }); } catch (e) { return { threw: String(e && e.message || e), chief: undefined, leads: {}, nodes: {} }; } };
const nd = (r, sid) => (r.nodes && r.nodes[sid]) || {};
const brief = (r) => JSON.stringify(Object.fromEntries(Object.entries(r.nodes || {}).map(([k, v]) => [k, [v.role, v.boss, v.via]]))) + (r.threw ? ' threw ' + r.threw : '');

console.log('1. 总管');
{
  const r = org([S('A', { name: '总管 · 旧窗口', ago: 5 }), S('B', { name: 'Ops Assistant', ago: 8 })], { chief: 'B' });
  ok(r.chief === 'B' && nd(r, 'B').role === 'chief' && nd(r, 'A').role === 'member', '点名的总管压过名字里带「总管」的（点名的 B 没有总管字样也算）', brief(r));
  const r2 = org([S('A', { name: '总管（第一代）', ago: 8 }), S('C', { name: '总管（第二代）', ago: 2 }), S('x', { name: '别的窗口', ago: 1 })]);
  ok(r2.chief === 'C' && nd(r2, 'C').role === 'chief', '没点名：带总管字样的里取最晚开的', brief(r2));
  ok(nd(r2, 'A').role === 'former' && nd(r2, 'A').boss === 'C' && nd(r2, 'A').via === 'seat', '比总管早开的同名窗口是前任（former），上级指向现任总管（via seat）', brief(r2));
  const r3 = org([S('B', { name: 'Ops Assistant', ago: 5 }), S('D', { name: '总管（刚开的新窗口）', ago: 1 })], { chief: 'B' });
  ok(r3.chief === 'B' && nd(r3, 'D').role === 'member' && nd(r3, 'D').via === 'dept' && nd(r3, 'D').boss === 'B', '比点名的总管晚开的、带总管字样的窗口不是前任，是普通窗口（同一个项目，按项目挂到总管下面，via dept）', brief(r3));
  const r4 = org([S('A', { name: '总管', ago: 3 }), S('B', { name: 'x', ago: 1 })], { chief: 'ghost' });
  ok(r4.chief === 'A', '点名的会话不在列表里（已经关了）：退回按字样认', brief(r4));
  const r5 = org([S('A', { name: 'x' }), S('B', { name: 'y' })]);
  ok(r5.chief === null && Object.values(r5.nodes).every((n) => n.role === 'member' && n.boss === null), '没点名、也没有带总管字样的：没有总管，谁都没有上级', brief(r5));
}

console.log('\n2. 每个项目的负责人');
{
  const base = () => [S('L1', { name: 'FretFlow 总指挥（旧）', dept: 'ff', ago: 6 }), S('L2', { name: 'FretFlow 总指挥（新）', dept: 'ff', ago: 2 })];
  const r = org([...base(), S('M', { dept: 'ff', from: [msg('L1', 2, 5), msg('L2', 3, 0.5)] })]);
  ok(r.leads.ff === 'L2' && nd(r, 'L2').role === 'lead' && nd(r, 'L1').role === 'former' && nd(r, 'L1').boss === 'L2' && nd(r, 'L1').via === 'seat', '两个总指挥都在带人：最晚开的是负责人，早的是前任、挂在现任下面', brief(r));
  ok(nd(r, 'L2').boss === null, '没有总管时，负责人没有上级', brief(r));
  const r2 = org([...base(), S('M', { dept: 'ff', from: [msg('L1', 2)] })]);
  ok(r2.leads.ff === 'L1' && nd(r2, 'L2').role === 'member', '只有早开的那个在给别人发消息：它是负责人；晚开的还没带人，是普通窗口（不是前任）', brief(r2));
  const r3 = org([...base(), S('M', { dept: 'ff', by: 'L1' })]);
  ok(r3.leads.ff === 'L1' && nd(r3, 'M').boss === 'L1', '开过窗口也算在带人：早开的那个开了 M，它是负责人', brief(r3));
  const r4 = org(base());
  ok(r4.leads.ff === 'L2' && nd(r4, 'L1').role === 'former', '都没动静：取最晚开的，早的是前任', brief(r4));
  const r5 = org([S('K', { name: '总管', dept: 'hq', ago: 9 }), ...base(), S('M', { dept: 'ff', from: [msg('L2', 3)] })]);
  ok(nd(r5, 'L2').boss === 'K' && nd(r5, 'L2').via === 'seat' && nd(r5, 'L1').boss === 'L2', '有总管时：负责人挂在总管下面（via seat），前任仍挂在现任负责人下面', brief(r5));
  const r6 = org([S('K', { name: '总管', dept: 'ff', ago: 9 }), S('L', { name: 'FretFlow 总指挥', dept: 'ff', ago: 2 }), S('M', { dept: 'ff', from: [msg('L', 3)] })]);
  ok(r6.leads.ff === 'K' && nd(r6, 'L').role === 'member', '总管所在的项目不另立负责人：那里的总指挥是普通窗口，负责人就是总管自己', brief(r6));
  const r7 = org([S('a', { name: 'misleading 窗口', dept: 'x', ago: 2 }), S('b', { name: 'Docs lead', dept: 'y', ago: 2 })]);
  ok(nd(r7, 'a').role === 'member' && nd(r7, 'b').role === 'lead', '默认字样：单独的 lead 一词算负责人，单词里间带 lead（misleading）不算', brief(r7));
}

console.log('\n3. 被某个窗口开出来的');
{
  const L = () => S('L', { name: '总指挥', ago: 6 });
  const r = org([L(), S('M', { by: 'L', human: hum(1) })]);
  ok(nd(r, 'M').boss === 'L' && nd(r, 'M').via === 'spawn', '负责人开的窗口：上级是它（via spawn）；开窗口时那段开场白算成「他说的」，先扣掉一轮', brief(r));
  const r2 = org([S('P'), S('M', { by: 'P', human: hum(2) })]);
  ok(nd(r2, 'M').boss === 'P' && nd(r2, 'M').via === 'spawn', '普通窗口开的也算；他本人后来只说了一轮：不翻', brief(r2));
  const r3 = org([S('P'), S('M', { by: 'P', human: hum(3) })]);
  ok(nd(r3, 'M').boss === null, '他本人后来接连说了两轮（最近）：他把它接过去了，回到没有上级', brief(r3));
  const r4 = org([S('P'), S('M', { by: 'P', human: hum(3, 12) })]);
  ok(nd(r4, 'M').boss === 'P', '他本人说的三轮是 12 小时前的：淡了，还是开它的那个窗口管', brief(r4));
}

console.log('\n4. 别的窗口发来的消息');
{
  const r = org([S('P'), S('M', { from: [msg('P', 1)] })]);
  ok(nd(r, 'M').boss === null, '没开过它的窗口只发来 1 条：只是知会一声，不算上级', brief(r));
  const r2 = org([S('P'), S('M', { from: [msg('P', 3)], human: hum(1) })]);
  ok(nd(r2, 'M').boss === 'P' && nd(r2, 'M').via === 'msg' && nd(r2, 'M').n === 3 && nd(r2, 'M').last === NOW - 0.1 * H, '发来 3 条、分量超过他本人：算上级（via msg），带上条数和最近一条的时间', brief(r2) + ' ' + JSON.stringify(nd(r2, 'M')));
  const r3 = org([S('P'), S('M', { from: [msg('P', 2)], human: hum(3) })]);
  ok(nd(r3, 'M').boss === null, '发来 2 条、但他本人说了 3 轮：他自己带着，不算', brief(r3));
}

console.log('\n5. 两个窗口互相发消息：更依赖对方的那个是下级');
{
  const r = org([S('A', { from: [msg('B', 9), dead(1)] }), S('B', { from: [msg('A', 3), dead(7)] })]);
  ok(nd(r, 'A').boss === 'B' && nd(r, 'B').boss === null, 'A 的消息九成来自 B，B 的消息三成来自 A：A 归 B 管，B 不归 A 管', brief(r));
}

console.log('\n6–7. 负责人的消息按 1.5 倍；上级是前任的，跟着岗位走');
{
  const team = (extra) => [S('L', { name: 'FretFlow 总指挥（现任）', dept: 'ff', ago: 1 }), S('F', { name: 'FretFlow 总指挥（前任）', dept: 'ff', ago: 6 }),
    S('C', { name: '同事', dept: 'ff' }), S('t', { dept: 'ff', from: [msg('L', 2, 0.2)] }), ...extra];
  const r = org(team([S('s', { dept: 'ff', from: [msg('F', 3, 2), msg('C', 3, 1.5)] })]));
  ok(r.leads.ff === 'L' && nd(r, 'F').role === 'former', '（前提）L 是现任负责人，F 是前任', brief(r));
  ok(nd(r, 's').boss === 'L' && nd(r, 's').via === 'msg' && nd(r, 's').n === 3, '同样 3 条：前任负责人的（2 小时前）按 1.5 倍压过同事的（1.5 小时前），归到负责人这个岗位（现任 L）', brief(r));
  const r2 = org(team([S('s2', { dept: 'ff', from: [msg('F', 3, 0.5)] })]));
  ok(nd(r2, 's2').boss === 'L', '只听前任的：上级改成现任（换代以后那一队人跟着岗位走）', brief(r2));
}

console.log('\n8. 别的项目的窗口是同事，不是上级；总管例外');
{
  const r = org([S('P', { dept: 'a' }), S('s', { dept: 'b', from: [msg('P', 10)] })]);
  ok(nd(r, 's').boss === null, '别的项目的普通窗口发来 10 条：不是上级', brief(r));
  const r2 = org([S('K', { name: '总管', dept: 'hq', ago: 9 }), S('s', { dept: 'b', from: [msg('K', 3)] })]);
  ok(nd(r2, 's').boss === 'K' && nd(r2, 's').via === 'msg', '总管跨项目发来 3 条：算上级', brief(r2));
}

console.log('\n9. 记录里看不出听谁的，但一直在向负责人交东西');
{
  const r = org([S('L', { name: '总指挥', from: [msg('s', 2), msg('s2', 2)] }), S('s'), S('s2', { human: hum(2) })]);
  ok(nd(r, 's').boss === 'L' && nd(r, 's').via === 'report' && nd(r, 's').n === 2, '向负责人发过 2 条、他本人没怎么管它：归负责人（via report，n 是它发出去的条数）', brief(r));
  ok(nd(r, 's2').via === 'dept' && nd(r, 's2').n === 0, '同样向负责人发过 2 条，但他本人最近说了 2 轮（分量 ≥ 1）：不走「交东西」（via 不是 report），按项目挂上（via dept，n 0）', brief(r));
  const r2 = org([S('L', { name: '总指挥', from: [msg('s', 1)] }), S('s')]);
  ok(nd(r2, 's').via === 'dept', '只向负责人发过 1 条：不走「交东西」，按项目挂上（via dept）', brief(r2));
}

console.log('\n10. 已经不在的发信人（sid 是 null）');
{
  // 按 org.mjs 现在的写法：不在的发信人只进 total（分母），只影响 dep() 的互相比较；「分量超过他本人」那一条是 weight > mine，不看分母
  // P 的另一个发信人 Q 在别的项目（只进 P 的分母，当不了 P 的上级）：P 对 s 的依赖固定是 1/3，改坏版拿掉不在的发信人也不变
  const r = org([S('Q', { dept: 'z' }), S('P', { from: [msg('s', 1), msg('Q', 2)] }), S('s', { from: [dead(10), msg('P', 3)] })]);
  ok(nd(r, 's').boss === null && nd(r, 'P').boss === null, '不在的那个给 s 发了 10 条：s 对 P 的依赖只剩 3/13，比不过 P 对 s 的 1/3，P 不是 s 的上级（起作用的是 dep 的互相比较）', brief(r));
  const r2 = org([S('P'), S('s', { from: [dead(10), msg('P', 3)] })]);
  ok(nd(r2, 's').boss === 'P', '……但 P 一点都不依赖 s 时（dep(P, s) = 0），不在的那个发得再多也挡不住：P 照样是上级', brief(r2));
}

console.log('\n11. 垃圾输入不抛错');
{
  const g = [org('x'), org(null), org(undefined), org({}), org([null, 1, 'a', {}, { sid: '' }, { sid: 5 }])];
  ok(g.every((r) => !r.threw && r.chief === null && Object.keys(r.nodes).length === 0), '不是数组、空、元素是垃圾：不抛错，空结果', g.map(brief).join(' | '));
  // from 里放 null / 数字 / 字符串的断言在第 13 段（11/15 第二步起 org.mjs 先过滤掉不是对象的项）
  const r = org([{ sid: 'ok', from: 'x', human: 'y', startedAt: 'z', by: 5, dept: { a: 1 } }, { sid: 'ok2', from: [3, { sid: 'ok', n: 'x' }, { sid: 'ok', n: 3, last: 'q' }], human: { n: -5 } }], { now: 'x', chiefWords: '(', leadWords: '[' });
  ok(!r.threw && Object.keys(r.nodes).sort().join() === 'ok,ok2', '字段类型都不对、正则写错、now 不是数：不抛错，两个会话都在', brief(r));
  const r2 = org([S('A', { by: 'A', human: hum(0) }), S('B', { by: 'nobody' })]);
  ok(!r2.threw && nd(r2, 'A').boss === null && nd(r2, 'B').boss === null, 'by 指向自己、指向不存在的会话：当没有', brief(r2));
  const r3 = org([S('L1', { name: '总指挥（旧）', ago: 6, by: 'L1' }), S('L2', { name: '总指挥（新）', ago: 2 })]);
  ok(r3.leads.d === 'L2', '自己开自己不算「在带人」：两个都没动静，取最晚开的', brief(r3));
  const r4 = org([S('A', { from: [msg('B', 5)] }), S('B', { from: [msg('C', 5)] }), S('C', { from: [msg('A', 5)] })]);
  const chains = ['A', 'B', 'C'].map((x) => { const seen = []; let b = x; for (let i = 0; i < 5 && b; i++) { seen.push(b); b = nd(r4, b).boss; } return b ? 'loop' : seen.join('>'); });
  ok(!r4.threw && Object.keys(r4.nodes).sort().join() === 'A,B,C' && !chains.includes('loop') && Object.values(r4.nodes).filter((n) => n.boss === null).length === 1, '三个窗口互相指成一圈：不死循环，三个都在，拆开一处（正好一个没有上级）', brief(r4) + ' ' + chains.join(' '));
}

console.log('\n12. wordsRe');
{
  const t = (x) => { try { return O.wordsRe(x); } catch (e) { return 'threw'; } };
  ok(t('') === null && t('   ') === null && t('(') === null && t('[a-') === null && t(42) === null && t(null) === null, '空串、全是空格、写错的正则、不是字符串 → null（当没有这条规则）');
  const re = t('总管|chief of staff');
  ok(re instanceof RegExp && re.test('作者 总管') && re.test('Chief Of Staff') && !re.test('总指挥'), '正常的原文编成不分大小写的 RegExp');
  const own = /x/; ok(t(own) === own, '已经是 RegExp 的原样返回');
}

console.log('\n13. 已经不在的窗口（gone：服务从消息里认出来的发信人，只有名字和项目）');
{
  // G 的开的时间故意给得比现任晚：规则说 gone 不看开的时间就是前任（服务交进来的 gone 开的时间是 0，测试里给晚一点，改坏版才分得出）
  const G = (sid, name, dept, o = {}) => ({ ...S(sid, { name, dept, ago: 0.5, ...o }), gone: true });
  const L = () => S('L', { name: 'FretFlow 总指挥（现任）', dept: 'ff', ago: 3 });
  const rA = org([L(), G('gone:1', 'FretFlow 总指挥（win-a5）', 'ff'), S('M', { dept: 'ff', from: [msg('gone:1', 3, 0.5)], human: hum(1) })]);
  ok(rA.leads.ff === 'L' && nd(rA, 'L').role === 'lead' && nd(rA, 'M').boss === 'L' && nd(rA, 'M').via === 'msg' && nd(rA, 'M').handed === true && nd(rA, 'M').n === 3,
    'A 不在的前任负责人（名字带「总指挥」）发来 3 条：听它的窗口跟着岗位归现任 L，handed 是 true', brief(rA) + ' ' + JSON.stringify(nd(rA, 'M')));
  ok(!('gone:1' in rA.nodes) && Object.values(rA.nodes).every((n) => n.boss !== 'gone:1'), 'A gone 项不出现在 nodes 里，也没有谁的上级指着它', Object.keys(rA.nodes).join());
  const rA2 = org([L(), S('M', { dept: 'ff', from: [dead(3, 0.5)], human: hum(1) })]);
  ok(nd(rA2, 'M').via === 'dept' && nd(rA2, 'M').boss === 'L' && nd(rA2, 'M').handed === false, 'A2 同样的 3 条、但发信人是 sid null（不交 gone 项，改之前的样子）：认不出谁在管它，按项目挂到负责人 L（via dept，不是 handed）', brief(rA2));
  const rB = org([S('P', { dept: 'ff' }), G('gone:2', 'win-xx', 'ff'), S('M', { dept: 'ff', from: [msg('gone:2', 5), msg('P', 3)] })]);
  ok(nd(rB, 'M').boss === 'P' && nd(rB, 'M').handed === false, 'B 不在的普通窗口（名字不带岗位字样）发来 5 条也当不了上级，只进分母：上级是发了 3 条的活窗口 P', brief(rB));
  const rC = org([G('gone:3', 'FretFlow 总指挥（旧）', 'ff'), S('M', { dept: 'ff', from: [msg('gone:3', 3)] })]);
  ok(!rC.threw && !('ff' in rC.leads) && nd(rC, 'M').boss === null && Object.keys(rC.nodes).join() === 'M', 'C 带负责人字样的都不在了：这个项目没有负责人，听它的窗口没有上级', brief(rC) + ' leads=' + JSON.stringify(rC.leads));
  const rD = org([L(), G('gone:4', 'FretFlow 总指挥（旧）', 'ff'), S('M', { dept: 'zz', from: [msg('gone:4', 3)] })]);
  ok(nd(rD, 'M').boss === null, 'D 别的项目的不在的负责人：不算上级（跨项目只有总管算）', brief(rD));
  const rE = org([S('K', { name: '总管（现任）', dept: 'hq', ago: 2 }), G('gone:5', 'Ops Assistant 总管（旧）', 'hq'), S('M', { dept: 'ff', from: [msg('gone:5', 3)] })]);
  ok(rE.chief === 'K' && nd(rE, 'M').boss === 'K' && nd(rE, 'M').handed === true, 'E 不在的前任总管（跨项目）发来 3 条：归现任总管 K，handed 是 true', brief(rE));
  const rF = org([L(), G('gone:1', 'FretFlow 总指挥（win-a5）', 'ff'), S('M', { dept: 'ff', from: [msg('gone:1', 3, 0.5)], human: hum(6) })]);
  ok(nd(rF, 'M').via === 'dept' && nd(rF, 'M').boss === 'L' && nd(rF, 'M').handed === false, 'F 他本人最近说了 6 轮，比不在的前任发来的 3 条分量大：不算听前任的（不是 handed），按项目挂到负责人 L（via dept）', brief(rF));
  const rG = org([G('gone:7', '总管（旧）', 'hq', { ago: 0.1 }), S('K', { name: '总管', dept: 'hq', ago: 4 })], { chief: 'gone:7' });
  ok(rG.chief === 'K' && !('gone:7' in rG.nodes), 'G opt.chief 指着一个不在的窗口：退回按字样认活着的 K', brief(rG) + ' chief=' + rG.chief);
  const rH = org([S('A', { from: [null, 3, 'x', msg('B', 2)] }), S('B')]);
  ok(!rH.threw && Object.keys(rH.nodes).sort().join() === 'A,B', 'H from 里有 null、数字、字符串：不抛错，两个会话都在', brief(rH));
  const team = [S('L', { name: 'FretFlow 总指挥（现任）', dept: 'ff', ago: 1 }), S('F', { name: 'FretFlow 总指挥（前任）', dept: 'ff', ago: 6 }),
    S('t', { dept: 'ff', from: [msg('L', 2, 0.2)] }), S('s', { dept: 'ff', from: [msg('F', 3, 0.5)] })];
  const rI = org(team);
  ok(nd(rI, 's').boss === 'L' && nd(rI, 's').handed === true && nd(rI, 't').boss === 'L' && nd(rI, 't').handed === false && nd(rI, 'F').handed === false,
    'I 活着的前任：听它的改挂到现任，handed 是 true；直接听现任的、前任自己都是 false', brief(rI) + ' ' + JSON.stringify(['s', 't', 'F'].map((x) => nd(rI, x).handed)));
}

console.log('\n14. 分支负责人（11/17 作者：推广负责人是总指挥下面优先级最高的分支，不是总指挥那一类）');
{
  const L = (o = {}) => S('L', { name: 'FretFlow 第 2 任总指挥（win-a2）', dept: 'ff', ago: 0.4, ...o });
  const Gw = (sid, o = {}) => S(sid, { name: sid, title: 'FretFlow 推广负责人', dept: 'ff', ago: 14, ...o });
  // A 真实的样子：推广负责人比现任总指挥早开 14 小时，总指挥在派活
  const rA = org([L(), Gw('G'), S('m', { dept: 'ff', from: [msg('L', 3)] })]);
  ok(nd(rA, 'G').role === 'head' && nd(rA, 'G').boss === 'L' && nd(rA, 'G').via === 'seat' && rA.leads.ff === 'L' && JSON.stringify(rA.heads) === '{"ff":["G"]}',
    'A 推广负责人（比总指挥早开）：role head，挂在现任总指挥 L 下面（via seat），不是前任；heads 里有它', brief(rA) + ' heads=' + JSON.stringify(rA.heads));
  // B 同一条分支换代：两个推广负责人，早开的是分支的前任，挂在新的下面；听旧的那个的窗口跟着岗位到新的
  const rB = org([L(), Gw('G1', { ago: 20 }), Gw('G2', { ago: 2 }), S('t', { dept: 'ff', from: [msg('G1', 3)] }), S('n', { dept: 'ff', by: 'G2' })]);   // 新的那个也开始派活了（开了 n）
  ok(nd(rB, 'G2').role === 'head' && nd(rB, 'G2').boss === 'L' && nd(rB, 'G1').role === 'former' && nd(rB, 'G1').boss === 'G2' && nd(rB, 't').boss === 'G2' && nd(rB, 't').handed === true,
    'B 两个推广负责人：晚开的是现任分支（归 L），早开的是它的前任；听前任的 t 跟着岗位归 G2，handed', brief(rB));
  // C 不同的分支各是各的
  const rC = org([L(), Gw('G'), S('D', { title: 'FretFlow 设计负责人', dept: 'ff', ago: 3 })]);
  ok(nd(rC, 'G').role === 'head' && nd(rC, 'D').role === 'head' && nd(rC, 'G').boss === 'L' && nd(rC, 'D').boss === 'L',
    'C 推广负责人和设计负责人是两条分支，都挂在总指挥下面，谁也不是谁的前任', brief(rC));
  // D 照旧是负责人的写法
  const rD = org([S('T', { title: '总负责人', dept: 'aa', ago: 1 }), S('P', { title: 'FretFlow 负责人', dept: 'bb', ago: 1 }), S('Q', { title: 'FretFlow 总指挥 · 推广负责人', dept: 'cc', ago: 1 }), Gw('G', { dept: 'cc', ago: 5 })]);
  ok(nd(rD, 'T').role === 'lead' && nd(rD, 'P').role === 'lead' && nd(rD, 'Q').role === 'lead' && nd(rD, 'G').role === 'head' && nd(rD, 'G').boss === 'Q',
    'D「总负责人」、前面不是汉字的「FretFlow 负责人」、去掉分支字样还带「总指挥」的，照旧是负责人', brief(rD));
  // E 项目里没有总指挥（总控台那一列：「上线负责人」）：照以前的规则当负责人，挂在总管下面
  const rE = org([S('K', { name: '总管', dept: 'hq', ago: 2 }), S('R', { title: 'cc-board 上线负责人接班', dept: 'cb', ago: 3 }), S('m', { dept: 'cb', from: [msg('R', 3)] })], { chief: 'K' });
  ok(nd(rE, 'R').role === 'lead' && nd(rE, 'R').boss === 'K' && rE.leads.cb === 'R' && !('cb' in (rE.heads || {})) && nd(rE, 'm').boss === 'R',
    'E 项目里没有总指挥：「上线负责人」照旧当负责人（归总管），这一列的画法和以前一样', brief(rE));
  const rE2 = org([S('R1', { title: 'cc-board 上线负责人', dept: 'cb', ago: 9 }), S('R2', { title: 'cc-board 上线负责人接班', dept: 'cb', ago: 3 })]);
  ok(nd(rE2, 'R2').role === 'lead' && nd(rE2, 'R1').role === 'former' && nd(rE2, 'R1').boss === 'R2', 'E2 没有总指挥、两个上线负责人：晚开的当负责人，早开的是前任（和 11/17 之前一样）', brief(rE2));
  // F 总管的项目里的分支：挂在总管下面
  const rF = org([S('K', { name: '总管', dept: 'hq', ago: 2 }), S('H', { title: '总管这边的值班负责人', dept: 'hq', ago: 1 })], { chief: 'K' });
  ok(nd(rF, 'H').role === 'head' && nd(rF, 'H').boss === 'K' && nd(rF, 'H').via === 'seat', 'F 总管所在的项目里的分支负责人：挂在总管下面', brief(rF));
  // G 分支负责人在派活：听它的窗口归它（它坐在岗位上，消息按 1.5 倍算）
  const rG = org([L(), Gw('G'), S('w', { dept: 'ff', by: 'G' }), S('v', { dept: 'ff', from: [msg('G', 3)] })]);
  ok(nd(rG, 'w').boss === 'G' && nd(rG, 'w').via === 'spawn' && nd(rG, 'v').boss === 'G' && nd(rG, 'v').via === 'msg', 'G 推广负责人开的窗口、给它派活的窗口都归它', brief(rG));
  // H 已经不在的旧推广负责人：不出给界面，听它的跟着岗位到现任
  const rH = org([L(), { ...Gw('gone:9', { name: 'FretFlow 推广负责人（win-f1）', title: '', ago: 0.5 }), gone: true }, Gw('G'), S('u', { dept: 'ff', from: [msg('gone:9', 3)] })]);
  ok(!('gone:9' in rH.nodes) && nd(rH, 'G').role === 'head' && nd(rH, 'u').boss === 'G' && nd(rH, 'u').handed === true, 'H 不在的旧推广负责人：不在 nodes 里，听它的 u 归现任 G，handed', brief(rH));
  // I 英文
  const rI = org([S('L', { title: 'Acme lead', dept: 'ac', ago: 1 }), S('E', { title: 'Head of Growth', dept: 'ac', ago: 4 })]);
  ok(nd(rI, 'E').role === 'head' && nd(rI, 'E').boss === 'L', 'I 英文「Head of Growth」是分支负责人，挂在 lead 下面', brief(rI));
  // J 没给分支字样（老的 config）：和 11/17 之前一样，推广负责人被当成总指挥的前任
  const rJ = org([L(), Gw('G')], { headWords: '' });
  ok(nd(rJ, 'G').role === 'former' && nd(rJ, 'G').boss === 'L', 'J 不给 headWords：规则和以前一样（这就是 11/17 他看到的那个样子）', brief(rJ));
  // K 照 11/17 14:2x 线上那组标题改写的（名字是编的；win-a9 报的；当时线上把后开、开过窗口的 2d 认成负责人，现任总指挥 2e 被画成前任）。
  //   「…分支」不带「负责人」的 45 默认认不出是分支，是普通窗口（「合并分支」这类会误中，默认不认）
  const rK = org([S('d8', { name: 'win-d8', title: 'FretFlow 总指挥上岗', dept: 'ff', ago: 1.5 }), S('x', { dept: 'ff', by: 'd8' }),
    S('2e', { name: 'win-2e', title: 'FretFlow 第3任总指挥交接', dept: 'ff', ago: 0.3 }), S('2d', { name: 'win-2d', title: '录音与混音线分支负责人开工', dept: 'ff', ago: 0.15, by: '2e' }),
    S('40', { name: 'win-40', title: 'FretFlow 推广负责人', dept: 'ff', ago: 15 }), S('w', { dept: 'ff', by: '2d' }), S('45', { name: 'win-45', title: 'FretFlow 和弦图分支', dept: 'ff', ago: 0.2, from: [msg('2e', 2)] })]);
  ok(rK.leads.ff === '2e' && nd(rK, 'd8').role === 'former' && nd(rK, 'd8').boss === '2e' && nd(rK, '2d').role === 'head' && nd(rK, '2d').boss === '2e' && nd(rK, '40').role === 'head' && nd(rK, '40').boss === '2e'
    && nd(rK, 'w').boss === '2d' && nd(rK, '45').role === 'member',
    'K 编的一组标题：第 3 任总指挥 2e 是负责人（不是前任），「录音与混音线分支负责人开工」2d 和「推广负责人」40 是挂在它下面的两条分支，2d 开的窗口归 2d；「和弦图分支」还没在带人（没开过窗口、没给手下发过消息），是普通窗口', brief(rK));
  const re = O.wordsRe(W.headWords), has = typeof O.branchOf === 'function';
  ok(has && O.branchOf('win-40 FretFlow 推广负责人', re) === '推广负责人' && O.branchOf('FretFlow 设计负责人（khalil-x）', re) === '设计负责人' && O.branchOf('x Head of Growth', re) === 'head of growth' && O.branchOf('FretFlow 总指挥', re) === '' && O.branchOf('推广负责人', null) === '',
    'branchOf：分支字样连同前面紧挨着的汉字；英文连同后面那个词；没有就是空串', has ? JSON.stringify(['win-40 FretFlow 推广负责人', 'x Head of Growth'].map((x) => O.branchOf(x, re))) : '没有 branchOf');
}

console.log('\n15. 没有窗口在管的：按项目挂到这个项目的岗位上（11/17 作者：「我自己新建一个任务……不能说是我直接带的，要归到它在架构里的位置」）');
{
  const K = (o = {}) => S('K', { name: '作者 总管', dept: 'hq', ago: 9, ...o });
  const L = (o = {}) => S('L', { name: 'FretFlow 第 3 任总指挥', dept: 'ff', ago: 3, ...o });
  // A 他本人开的、一直在跟它说话：以前是你直接带，现在挂到项目负责人下面
  const rA = org([K(), L(), S('m', { title: 'FretFlow 歌词字号放大一档', dept: 'ff', human: hum(5) })], { chief: 'K' });
  ok(nd(rA, 'm').boss === 'L' && nd(rA, 'm').via === 'dept' && nd(rA, 'm').role === 'member' && nd(rA, 'm').n === 0 && nd(rA, 'm').last === 0 && nd(rA, 'm').handed === false,
    'A 他本人开的、他说了 5 轮：挂到 FretFlow 负责人 L 下面（via dept，n / last 是 0：负责人没给它派过活）', brief(rA) + ' ' + JSON.stringify(nd(rA, 'm')));
  // B 项目没有负责人：挂到总管
  const rB = org([K(), S('m', { dept: 'cb', human: hum(3) })], { chief: 'K' });
  ok(nd(rB, 'm').boss === 'K' && nd(rB, 'm').via === 'dept', 'B 项目里没有负责人：挂到总管（总管带）', brief(rB));
  // C 没有负责人也没有总管：还是你直接带
  const rC = org([S('m', { dept: 'cb', human: hum(3) }), S('n', { dept: 'cb' })]);
  ok(nd(rC, 'm').boss === null && nd(rC, 'm').via === null && nd(rC, 'n').boss === null, 'C 没有负责人、也没有总管（刚装的总控台）：照旧你直接带', brief(rC));
  // D 总管自己的项目：挂到总管
  const rD = org([K(), S('w', { title: 'Ops Assistant 值班窗口', dept: 'hq' })], { chief: 'K' });
  ok(nd(rD, 'w').boss === 'K' && nd(rD, 'w').via === 'dept', 'D 总管所在的项目里：挂到总管', brief(rD));
  // E 证据压过按项目：别的普通窗口开的、发来消息的，照旧归它；按项目只管没人管的
  const rE = org([K(), L(), S('P', { dept: 'ff', human: hum(4) }), S('c', { dept: 'ff', by: 'P' }), S('d', { dept: 'ff', from: [msg('P', 3)] })], { chief: 'K' });
  ok(nd(rE, 'c').boss === 'P' && nd(rE, 'c').via === 'spawn' && nd(rE, 'd').boss === 'P' && nd(rE, 'd').via === 'msg' && nd(rE, 'P').boss === 'L' && nd(rE, 'P').via === 'dept',
    'E P 开的 c、P 派活的 d 照旧归 P；P 自己没人管，挂到负责人 L：整棵树跟着进 FretFlow 负责人下面', brief(rE));
  // F 岗位上的不动：负责人归总管（seat）、前任归现任（seat）、总管没有上级
  const rF = org([K(), L(), S('F', { name: 'FretFlow 第 13 任总指挥', dept: 'ff', ago: 8 }), S('m', { dept: 'ff' })], { chief: 'K' });
  ok(nd(rF, 'L').via === 'seat' && nd(rF, 'L').boss === 'K' && nd(rF, 'F').via === 'seat' && nd(rF, 'F').boss === 'L' && nd(rF, 'K').boss === null && nd(rF, 'm').via === 'dept',
    'F 负责人、前任、总管都不被按项目改挂', brief(rF));
  // G 别的项目的负责人不当它的上级（没有总管时）
  const rG = org([L(), S('m', { dept: 'cb', human: hum(2) })]);
  ok(nd(rG, 'm').boss === null, 'G 只有 FretFlow 有负责人、它在总控台：不挂到别的项目的负责人下面', brief(rG));
  // H 开它的窗口已经关了（spawn.json 指着不在墙上的 sid）：按项目挂到负责人
  const rH = org([K(), L(), S('m', { dept: 'ff', by: 'ghost-sid' })], { chief: 'K' });
  ok(nd(rH, 'm').boss === 'L' && nd(rH, 'm').via === 'dept', 'H 开它的窗口已经不在：按项目挂到负责人', brief(rH));
  // I 三个窗口指成一圈、拆开的那一个：也挂上，整圈都在负责人的树里，不再成圈
  const rI = org([K(), L(), S('A', { dept: 'ff', from: [msg('B', 5)] }), S('B', { dept: 'ff', from: [msg('C', 5)] }), S('C', { dept: 'ff', from: [msg('A', 5)] })], { chief: 'K' });
  const top = (x) => { let b = x; for (let i = 0; i < 8 && nd(rI, b).boss; i++) b = nd(rI, b).boss; return nd(rI, b).boss ? 'loop' : b; };
  ok(['A', 'B', 'C'].every((x) => top(x) === 'K') && ['A', 'B', 'C'].filter((x) => nd(rI, x).via === 'dept').length === 1, 'I 三个窗口指成一圈：拆开的那个按项目挂到负责人，三个都一路通到总管', brief(rI));
}

console.log('\n15b. 按项目挂上时，标题对得上一条分支就挂到那个分支负责人');
{
  const L = () => S('L', { name: 'FretFlow 第 3 任总指挥', dept: 'ff', ago: 3 });
  const B1 = () => S('B1', { title: 'FretFlow 主题与配色负责人', dept: 'ff', ago: 2 });
  const B2 = () => S('B2', { title: 'FretFlow 录音与混音负责人', dept: 'ff', ago: 2 });
  const G = () => S('G', { title: 'FretFlow 推广负责人', dept: 'ff', ago: 14 });
  const w = (sid, title) => S(sid, { title, dept: 'ff', human: hum(2) });
  const r = org([L(), B1(), B2(), G(),
    w('capo', 'FretFlow 深色主题预览'), w('fing', 'FretFlow 默认配色：主题与对比度规则'), w('sing', 'FretFlow 录音页只留波形和进度条'),
    w('band', 'FretFlow 练习页节拍器返修'), w('both', 'FretFlow 录音页里的主题提示'), w('grow', 'FretFlow 推广：海报初稿'), w('chord', 'FretFlow 歌词字号放大一档')]);
  ok(['B1', 'B2', 'G'].every((x) => nd(r, x).role === 'head' && nd(r, x).boss === 'L'), '（前提）三条分支都挂在总指挥 L 下面', brief(r));
  ok(nd(r, 'capo').boss === 'B1' && nd(r, 'capo').via === 'dept' && nd(r, 'fing').boss === 'B1', '标题里有「主题」「配色」→ 主题与配色那条分支', brief(r));
  ok(nd(r, 'sing').boss === 'B2' && nd(r, 'grow').boss === 'G', '「录音」→ 录音与混音；「推广」→ 推广负责人', brief(r));
  ok(nd(r, 'band').boss === 'L' && nd(r, 'chord').boss === 'L', '对不上任何一条分支（节拍器、歌词字号）→ 项目负责人', brief(r));
  ok(nd(r, 'both').boss === 'L' && nd(r, 'both').via === 'dept', '两条分支各对上一个词（录音、主题）：算对不上，挂到项目负责人', brief(r));
  const r2 = org([L(), B1(), S('capo', { title: 'FretFlow 深色主题预览', dept: 'ff', by: 'L' })]);
  ok(nd(r2, 'capo').boss === 'L' && nd(r2, 'capo').via === 'spawn', '负责人自己开的主题窗口：照旧归负责人（证据压过标题）', brief(r2));
  const r3 = org([S('L', { title: 'Acme lead', dept: 'ac', ago: 3 }), S('E', { title: 'Head of Growth', dept: 'ac', ago: 4 }), S('x', { title: 'growth experiments for ads', dept: 'ac' })]);
  ok(nd(r3, 'x').boss === 'E' && nd(r3, 'x').via === 'dept', '英文：「Head of Growth」的话题词 growth 对上「growth experiments」', brief(r3));
  const re = O.wordsRe(W.headWords), has = typeof O.branchWords === 'function';
  const bw = (t) => (has ? JSON.stringify(O.branchWords(t, re)) : '没有 branchWords');
  const cases = [['FretFlow 主题与配色负责人', '["主题","配色"]'], ['FretFlow 和弦与指法负责人', '["和弦","指法"]'], ['FretFlow 歌与弹唱负责人', '["弹唱"]'],
    ['录音与混音线分支负责人开工', '["录音","混音"]'], ['FretFlow 导入、平台方向负责人', '["导入","平台"]'], ['x Head of Growth and Ads', '["growth","ads"]'], ['FretFlow 总指挥', '[]'], ['FretFlow 推广负责人（win-40）', '["推广"]']];
  ok(cases.every(([t, w]) => bw(t) === w),
    'branchWords：分支字样前面那一串汉字（不止 6 个）去掉结尾的「分支 / 线 / 方向」，按「与 / 、」拆；不按「和」拆（和弦）；一个字的词不要；英文取 head of 后面的词', cases.map(([t, w]) => t + ' → ' + bw(t) + (bw(t) === w ? '' : '（要 ' + w + '）')).join(' | '));
  // 编的一条「…线分支负责人开工」H：标题里带录音、混音的窗口按话题词挂到它下面
  const r4 = org([L(), S('H', { name: 'win-2d', title: '录音与混音线分支负责人开工', dept: 'ff', ago: 0.1 }), w('sing', 'FretFlow 录音页只留波形和进度条'), w('stem', 'FretFlow 混音音量自动对齐')]);
  ok(nd(r4, 'H').role === 'head' && nd(r4, 'sing').boss === 'H' && nd(r4, 'stem').boss === 'H', '「录音与混音线分支负责人开工」：它是分支；录音页、混音的窗口挂到它下面', brief(r4));
}

console.log('\n16. 点名的负责人、「…分支」、负责人 / 分支发过消息的（11/17 win-49：作者 21:47「我交代的任务应该是哪一个高管、上一级是谁」）');
{
  const K = () => S('K', { name: '作者 总管', dept: 'hq', ago: 30 });
  // A 编的一组换代：d7「cc-board 上线负责人接班」开了 d8「总控台 cc-board 夜班交班」，d8 开了现任 30「cc-board 夜班交班 第二棒」
  const cb = () => [K(), S('d7', { name: 'win-d7', title: 'cc-board 上线负责人接班', dept: 'cb', ago: 6 }),
    S('d8', { name: 'win-d8', title: '总控台 cc-board 夜班交班', dept: 'cb', ago: 2.5, by: 'd7' }),
    S('30', { name: 'win-30', title: 'cc-board 夜班交班 第二棒', dept: 'cb', ago: 0.3, by: 'd8' }),
    S('98', { name: 'win-98', title: 'cc-board 快捷键说明', dept: 'cb', ago: 5, by: 'd7', from: [msg('d8', 2)] }),
    S('8f', { name: 'win-8f', title: 'CCBoard 文档目录整理', dept: 'cb', ago: 5, from: [msg('d7', 3), msg('d8', 1)] }),
    S('c0', { name: 'win-c0', title: '总控台图标发糊', dept: 'cb', ago: 1, human: hum(3) })];
  const r0 = org(cb(), { chief: 'K' });
  ok(r0.leads.cb === 'd7' && nd(r0, '30').role === 'member', 'A0（不点名时的样子）负责人是两任以前的 d7，现任 30 是普通窗口', brief(r0));
  const rA = org(cb(), { chief: 'K', seats: { cb: '30' } });
  ok(rA.leads.cb === '30' && nd(rA, '30').role === 'lead' && nd(rA, '30').boss === 'K' && nd(rA, '30').via === 'seat', 'A 点名 30：它是总控台的负责人，归总管（via seat）', brief(rA));
  ok(nd(rA, 'd7').role === 'former' && nd(rA, 'd7').boss === '30' && nd(rA, 'd8').role === 'former' && nd(rA, 'd8').boss === '30' && !(rA.heads.cb || []).length,
    'A d7（标题带「上线负责人」，这一列本来靠它当负责人）和 d8（开了 30、还带过 98、8f）都是前任，挂在 30 下面；d7 不被当成分支', brief(rA) + ' heads=' + JSON.stringify(rA.heads));
  ok(nd(rA, '98').boss === '30' && nd(rA, '98').handed === true && nd(rA, '8f').boss === '30' && nd(rA, '8f').handed === true && nd(rA, 'c0').boss === '30' && nd(rA, 'c0').via === 'dept',
    'A 前任带过的 98、8f 跟着岗位归 30（handed）；他本人开的 c0 按项目挂到 30', brief(rA));
  // B 点名无效的几种：当没点名，照旧按字样认，不抛错
  const rB1 = org(cb(), { chief: 'K', seats: { cb: 'ghost' } }), rB2 = org(cb(), { chief: 'K', seats: { ff: '30' } }), rB3 = org(cb(), { chief: 'K', seats: { cb: 'K' } });
  const rB4 = org(cb(), { chief: 'K', seats: { hq: 'c0' } }), rB5 = org(cb(), { chief: 'K', seats: 'x' }), rB6 = org(cb(), { chief: 'K', seats: null });
  ok(rB1.leads.cb === 'd7' && rB2.leads.cb === 'd7' && !('ff' in rB2.leads) && rB3.leads.cb === 'd7' && rB4.chief === 'K' && nd(rB4, 'c0').role === 'member' && rB5.leads.cb === 'd7' && rB6.leads.cb === 'd7',
    'B 点名的不在墙上、写在别的项目下、点名的是总管、在总管的项目里点名、seats 不是对象：都当没点名，照旧是 d7', [rB1, rB2, rB3, rB4, rB5, rB6].map((r) => r.threw || r.leads.cb).join(' '));
  // C 带负责人字样的：比点名的早开的、不在了的是前任；晚开的是普通窗口
  const rC = org([K(), S('L1', { title: 'FretFlow 第 16 任总指挥', dept: 'ff', ago: 5 }), S('P', { title: 'FretFlow 交接', dept: 'ff', ago: 3 }), S('L3', { title: 'FretFlow 第 18 任总指挥（刚开）', dept: 'ff', ago: 0.1 }),
    { ...S('gone:1', { name: 'FretFlow 总指挥（win-x1）', dept: 'ff', ago: 0 }), gone: true }, S('w', { dept: 'ff', from: [msg('gone:1', 3)] })], { chief: 'K', seats: { ff: 'P' } });
  ok(nd(rC, 'P').role === 'lead' && nd(rC, 'L1').role === 'former' && nd(rC, 'L1').boss === 'P' && nd(rC, 'L3').role === 'member' && nd(rC, 'w').boss === 'P' && nd(rC, 'w').handed === true,
    'C 点名 P（标题没有负责人字样）：早开的总指挥 L1 是前任，晚开的 L3 是普通窗口，听不在的前任的 w 跟着岗位归 P', brief(rC));
  // D 开现任的上一任：带过别的窗口才算；只开了这一个窗口的（替他传话的）不算
  const rD = org([K(), S('R', { title: '帮我开个新窗口接班', dept: 'ff', ago: 2 }), S('L', { title: 'FretFlow 第 17 任总指挥交接', dept: 'ff', ago: 1, by: 'R' })], { chief: 'K' });
  ok(nd(rD, 'L').role === 'lead' && nd(rD, 'R').role === 'member', 'D 只开了总指挥这一个窗口的 R 不是前任', brief(rD));

  // E 「…分支」：编的三个标题，都在带人 → 分支；它们带的窗口挂到各自下面
  const L = () => S('L', { name: 'win-16', title: 'FretFlow 第 20 任总指挥上岗', dept: 'ff', ago: 1 });
  const br = (sid, title, o = {}) => S(sid, { name: 'khalil-' + sid, title, dept: 'ff', ago: 3, ...o });
  const rE = org([K(), L(), br('45', 'FretFlow 和弦图分支'), br('b2', 'FretFlow 字体与排版分支'), br('b5', '录音与混音分支交接'),
    S('82', { title: 'FretFlow 深色主题预览', dept: 'ff', from: [msg('45', 2)], human: hum(2) }), S('39', { title: '设置页 iOS 截图补拍', dept: 'ff', from: [msg('b2', 1)] }),
    S('73', { title: 'FretFlow iOS 电平表接入', dept: 'ff', from: [msg('b5', 1)] }), S('48', { title: 'FretFlow 歌词字号放大一档', dept: 'ff', from: [msg('b5', 1)], human: hum(4) })], { chief: 'K' });
  ok(['45', 'b2', 'b5'].every((x) => nd(rE, x).role === 'head' && nd(rE, x).boss === 'L' && nd(rE, x).via === 'seat'), 'E 三个标题「FretFlow 和弦图分支」「FretFlow 字体与排版分支」「录音与混音分支交接」都在给手下发消息：都是分支，挂在总指挥下面', brief(rE));
  ok(nd(rE, '82').boss === '45' && nd(rE, '39').boss === 'b2' && nd(rE, '73').boss === 'b5' && nd(rE, '48').boss === 'b5', 'E 它们带的窗口挂在各自下面（45 不再被画到它的手下 82 下面）', brief(rE));
  // E2 反例：git 用语的「…分支」就算在给别人发消息也不是分支；对话记录里常见的「沙盒分支」「网页分支」「失败分支」没在带人、或只向总指挥汇报，也不是
  const gitT = ['car3 合并分支', 'FretFlow 清理旧分支', '切到主分支', 'org-place 新建分支'], idleT = ['已提交在沙盒分支', '真核对工具走失败分支'];
  const ws = gitT.map((t, i) => br('g' + i, t)).concat(gitT.map((t, i) => S('gw' + i, { dept: 'ff', from: [msg('g' + i, 2)] })))
    .concat(idleT.map((t, i) => br('i' + i, t))).concat([br('rep', 'FretFlow 网页分支')]);
  const rE2 = org([K(), { ...L(), from: [msg('rep', 3)] }, ...ws], { chief: 'K' });
  const notHead = ['g0', 'g1', 'g2', 'g3', 'i0', 'i1', 'rep'];
  ok(notHead.every((x) => nd(rE2, x).role === 'member'), 'E2 「car3 合并分支」「清理旧分支」「切到主分支」「新建分支」（git 用语，在发消息也不算）、「已提交在沙盒分支」「真核对工具走失败分支」（没在带人）、「FretFlow 网页分支」（只向总指挥汇报）都是普通窗口', brief(rE2));
  const re = O.wordsRe(W.headWords);
  const yes = ['win-45 FretFlow 和弦图分支', 'win-b2 FretFlow 字体与排版分支', 'win-b5 录音与混音分支交接', 'win-2d 录音与混音线分支负责人开工', 'x FretFlow 推广负责人'];
  const no = ['x car3 合并分支', 'x FretFlow 清理旧分支', 'x 切到主分支', 'x 新建分支跑测试', 'x 把 org-place 分支合进去', 'x tabscan worktree（分支 tabscan/wt）', 'x 清理 worktree 和分支', 'x FretFlow 总指挥'];
  ok(!!re && yes.every((t) => re.test(t)) && no.every((t) => !re.test(t)), 'E3 字样本身：上面 5 个认（含「X负责人」），git 用语和分支不在标题末尾的 8 个不认', re ? JSON.stringify({ 漏认: yes.filter((t) => !re.test(t)), 误认: no.filter((t) => re.test(t)) }) : 'wordsRe null');
  // F 同一条分支换了写法：「录音与混音线分支负责人开工」和「录音与混音分支交接」话题词都是 录音、混音 → 同一条，早开的是前任，它开的窗口跟着到现任
  const rF = org([K(), L(), br('2d', '录音与混音线分支负责人开工', { ago: 8 }), br('b5', '录音与混音分支交接'), S('w', { dept: 'ff', from: [msg('b5', 1)] }), S('v', { dept: 'ff', by: '2d' })], { chief: 'K' });
  ok(nd(rF, 'b5').role === 'head' && nd(rF, '2d').role === 'former' && nd(rF, '2d').boss === 'b5' && nd(rF, 'v').boss === 'b5' && nd(rF, 'v').handed === true,
    'F 「录音与混音线分支负责人开工」和「录音与混音分支交接」是同一条分支：2d 是 b5 的前任，2d 开的 v 跟着岗位归 b5', brief(rF));

  // G 岗位发过消息的（via contact）：一条就挂，挂到最近发的那个现任岗位；别的都不算
  const G = (o) => S('t', { title: o.title || 't', dept: 'ff', human: hum(3), from: o.from });
  const base = () => [K(), L(), br('45', 'FretFlow 和弦图分支', { ago: 4 }), S('m45', { dept: 'ff', from: [msg('45', 2)] }), br('b5', '录音与混音分支交接', { ago: 4 }), S('mb5', { dept: 'ff', from: [msg('b5', 2)] }), S('P', { dept: 'ff' })];
  const g1 = org([...base(), G({ from: [msg('L', 1, 0.5)] })], { chief: 'K' });
  ok(nd(g1, 't').boss === 'L' && nd(g1, 't').via === 'contact' && nd(g1, 't').n === 1 && nd(g1, 't').last === NOW - 0.5 * H && nd(g1, 't').handed === false, 'G1 总指挥给它发过 1 条（他本人说了 3 轮）：挂到总指挥（via contact，n 1、last 是那条的时间）', JSON.stringify(nd(g1, 't')));
  const g2 = org([...base(), G({ from: [msg('45', 1, 2), msg('L', 1, 0.2)] })], { chief: 'K' }), g2b = org([...base(), G({ from: [msg('45', 1, 0.1), msg('L', 1, 0.2)] })], { chief: 'K' });
  ok(nd(g2, 't').boss === 'L' && nd(g2b, 't').boss === '45', 'G2 两个岗位都发过：挂到最近发的那个', brief(g2) + ' | ' + brief(g2b));
  const g3 = org([...base(), G({ title: 'FretFlow 和弦图 x', from: [msg('b5', 1)] })], { chief: 'K' });
  ok(nd(g3, 't').boss === 'b5' && nd(g3, 't').via === 'contact', 'G3 标题对得上和弦图那条分支，但发消息的是录音与混音：挂 b5（证据压过标题）', brief(g3));
  const g4 = org([...base(), G({ from: [msg('P', 1)] })], { chief: 'K' });
  ok(nd(g4, 't').boss === 'L' && nd(g4, 't').via === 'dept', 'G4 发消息的是普通窗口 P：不算，按项目挂到总指挥（via dept）', brief(g4));
  const g5 = org([...base(), S('X', { title: '别的项目的总指挥', dept: 'zz', ago: 2 }), G({ from: [msg('X', 1)] })], { chief: 'K' });
  ok(nd(g5, 't').boss === 'L' && nd(g5, 't').via === 'dept', 'G5 别的项目的负责人发来的：不算，按本项目挂', brief(g5));
  const g6 = org([...base(), S('F', { title: 'FretFlow 第 15 任总指挥', dept: 'ff', ago: 9 }), S('n', { dept: 'ff', by: 'L' }), G({ from: [msg('F', 1)] })], { chief: 'K' });   // 现任 L 也在带人（开了 n），F 才是前任
  ok(nd(g6, 'F').role === 'former' && nd(g6, 't').boss === 'L' && nd(g6, 't').via === 'dept' && nd(g6, 't').handed === false, 'G6 前任发来的：不算（悬停要写「X 给它发过 N 条」，X 得是它真正的上级），按项目挂到现任', brief(g6));
  const g7 = org([...base(), G({ from: [msg('K', 1)] })], { chief: 'K' });
  ok(nd(g7, 't').boss === 'L' && nd(g7, 't').via === 'dept', 'G7 总管发来的 1 条（总管在别的项目）：不算，按项目挂', brief(g7));

  const g8 = org([...base(), G({ from: [msg('45', 1, 13)] })], { chief: 'K' }), g8b = org([...base(), G({ from: [msg('45', 1, 11)] })], { chief: 'K' });
  ok(nd(g8, 't').boss === 'L' && nd(g8, 't').via === 'dept' && nd(g8b, 't').boss === '45' && nd(g8b, 't').via === 'contact', 'G8 分支 13 小时前发的 1 条不算（按项目挂到总指挥）；11 小时前的算（挂到分支）。一天前的一条不该还决定它现在挂在谁下面', brief(g8) + ' | ' + brief(g8b));

  // H server.mjs 的默认字样和这里的 W 一样（这里的断言是拿 W 跑的；两边不一样，测的就不是线上的规则）
  const srv = fs.readFileSync(path.join(HERE, '../server.mjs'), 'utf8');
  const lit = (m) => (m ? Function('return \'' + m[1] + '\'')() : null);
  const sTail = lit(srv.match(/const BRANCH_TAIL = '((?:[^'\\]|\\.)*)';/)), sHead = lit(srv.match(/headWords: '((?:[^'\\]|\\.)*)' \+ BRANCH_TAIL/));
  ok(sTail !== null && sHead !== null && sHead + sTail === W.headWords, 'H server.mjs 的 headWords 默认值（含 BRANCH_TAIL）和本测试的 W 一字不差', JSON.stringify({ server: sHead + sTail, test: W.headWords }));
}

console.log(`\n结果：${pass} 过，${fail} 没过`);
process.exit(fail ? 1 : 0);
