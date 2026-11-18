/**
 * [INPUT]: 不依赖任何模块。调用方（server.mjs）给一份活着的会话清单：每个会话的 sid、名字、标题、属于哪个项目、什么时候开的、
 *          你本人开过几轮（human）、哪些窗口给它发过消息（from，已经认成 sid 的和认不出的都给）、是谁开的这个窗口（by）。
 *          清单里可以带「已经不在的窗口」（gone: true）：调用方从别的窗口收到的消息里认出来的发信人，只有名字和项目。
 * [OUTPUT]: 导出 buildOrg()、wordsRe()、branchOf() 和几个常数。buildOrg 返回 { chief, leads, heads, nodes }（heads = { 项目: [分支负责人 sid…] }）：
 *           nodes[sid] = { role: 'chief' | 'lead' | 'head' | 'former' | 'member', boss: sid | null, via: 'seat' | 'spawn' | 'msg' | 'report' | null, n, last, handed }。
 *           head = 分支负责人（「增长负责人」这类）：挂在本项目的负责人下面（没有负责人挂总管），不是负责人的前任。
 *           via 是依据：seat 按岗位；spawn 上级开的它；msg 最近主要听上级的（n 条、最近一条 last）；report 它一直在向负责人交东西（n、last 是它发出去的）。
 *           boss 是 null 的普通窗口 = 没有哪个窗口在管它，是你自己在带。handed: true = 它原来听前任的，换代以后跟着岗位到了现任名下。
 *           已经不在的窗口不出现在 nodes 里，也当不了任何人的上级；它只用来回答「这个窗口原来听的是哪个岗位」。
 * [POS]: 「架构」视图里谁归谁管的唯一决策点。server.mjs 每次出 /api/state 时调一次，界面只照着画，不自己推。
 *        它不起进程、不读文件、不读 config，所以 test/org.test.mjs 可以直接断言。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// ───────────── 几个数：改规则只改这里 ─────────────
// 半衰期：三小时前的一条消息只顶现在的半条。用来比「它最近主要听谁的」，不用来判「有没有上下级」。
export const HALF_LIFE_MS = 3 * 3600e3;
// 「它开的窗口」顶一条半消息，而且不随时间变淡：窗口开出来以后闷头干几个小时、谁也不理，它仍然归开它的那个窗口管；
// 你本人后来接连说了两轮以上，才算你把它接过去了。
export const SPAWN_W = 1.5;
// 负责人（和前任负责人、总管）发来的消息按一条半算：负责人发的是派活，同事之间发的多半是打招呼。
export const SEAT_W = 1.5;
// 没开过它的窗口，至少发来两条消息才可能是它的上级：一条消息多半只是知会一声。
export const MIN_MSGS = 2;
const CAP = 12;                                  // 一个来源最多按 12 条算，免得一个话痨把别的都淹掉

// 把 config 里的一段正则原文编成 RegExp；空的、写错的都当成「没有这条规则」，不让一处手误把整个服务带崩。
export function wordsRe(src) {
  if (src instanceof RegExp) return src;
  if (typeof src !== 'string' || !src.trim()) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }
}

// 分支名：分支字样那一段，连同它前面紧挨着的几个汉字（「FretFlow 推广负责人」→「推广负责人」），
// 英文连同后面那个词（「Head of Growth」→「head of growth」）。同一个项目里分支名一样的才算同一条分支（换代），不一样的各是各的。
export function branchOf(label, re) {
  const m = re && String(label).match(re); if (!m) return '';
  const pre = String(label).slice(0, m.index).match(/\p{Script=Han}{1,6}$/u), post = String(label).slice(m.index + m[0].length).match(/^\s*([a-z][\w-]*)/i);
  return ((pre ? pre[0] : '') + m[0] + (/[a-z]$/i.test(m[0]) && post ? ' ' + post[1] : '')).toLowerCase();
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const decay = (now, t) => (t > 0 ? Math.pow(0.5, Math.max(0, now - t) / HALF_LIFE_MS) : 0);

// ───────────── 谁归谁管 ─────────────
// 四步，前面的压过后面的：
//   1. 总管：调用方点名的那个会话（opt.chief）；没点名就取名字 / 标题里带总管字样的、最晚开的那个。
//   2. 每个项目的负责人：名字 / 标题里带负责人字样的。有好几个（换过代）时，取「已经在给别的窗口发消息或开过窗口」里最晚开的；
//      比它早的算前任。总管所在的项目，负责人就是总管自己。
//      分支负责人（带分支字样的，默认「X负责人」）同一个项目里按分支名分开、各自照同样的办法选现任，挂在负责人下面；
//      项目里没有负责人（也不是总管的项目）时，这个项目的分支负责人照 11/17 之前的规则一起选负责人。
//   3. 其余的窗口看证据：最近主要听谁的，就归谁管。听你本人的更多，就不归任何窗口管（boss: null）。
//   4. 上级是前任负责人的，改挂到现任身上：换代以后，原来那一队人跟着岗位走，不跟着人走。
// 前任收工关掉以后也一样：已经不在的窗口（gone）只要名字里带负责人 / 总管字样，就算那个岗位的前任，
// 听它的那一队人照样归现任；不然前任一归档，它带过的窗口就全掉到「你自己在带」里（11/15 真实数据：a5 归档后 9d、3b 掉队）。
export function buildOrg(list, opt = {}) {
  const now = num(opt.now) || Date.now();
  const chiefRe = wordsRe(opt.chiefWords), leadRe = wordsRe(opt.leadWords), headRe = wordsRe(opt.headWords);
  const S = (Array.isArray(list) ? list : []).filter((s) => s && typeof s.sid === 'string' && s.sid).map((s) => ({
    sid: s.sid, label: String(s.name || '') + ' ' + String(s.title || ''), dept: String(s.dept || ''), at: num(s.startedAt),
    hn: Math.min(CAP, num(s.human && s.human.n)), hl: num(s.human && s.human.last),
    from: (Array.isArray(s.from) ? s.from : []).filter((f) => f && typeof f === 'object').map((f) => ({ sid: typeof f.sid === 'string' && f.sid ? f.sid : null, n: Math.min(CAP, num(f.n)), last: num(f.last) })).filter((f) => f.n > 0),
    by: typeof s.by === 'string' && s.by ? s.by : null, gone: s.gone === true,
  }));
  const byId = new Map(S.map((s) => [s.sid, s]));
  for (const s of S) { if (s.by === s.sid || !byId.has(s.by)) s.by = null; s.from = s.from.filter((f) => f.sid !== s.sid); }
  const nodes = {}; for (const s of S) nodes[s.sid] = { role: 'member', boss: null, via: null, n: 0, last: 0, handed: false };
  const newest = (a) => a.slice().sort((x, y) => y.at - x.at || (x.sid < y.sid ? -1 : 1))[0] || null;

  // 1. 总管
  const chiefLike = chiefRe ? S.filter((s) => chiefRe.test(s.label)) : [];
  const here = (s) => (s && !s.gone ? s : null);                  // 还在墙上的才能坐在岗位上
  const chief = (typeof opt.chief === 'string' && here(byId.get(opt.chief))) || newest(chiefLike.filter(here));
  const formerOf = new Map();                    // 前任 sid → 现任 sid
  if (chief) {
    nodes[chief.sid].role = 'chief';
    for (const s of chiefLike) if (s !== chief && (s.gone || s.at < chief.at)) formerOf.set(s.sid, chief.sid);
  }

  // 2. 每个项目的负责人
  const acted = new Set();                       // 给别的窗口发过消息、或开过窗口的：它已经在带人了
  for (const s of S) { if (s.by) acted.add(s.by); for (const f of s.from) if (f.sid && byId.has(f.sid)) acted.add(f.sid); }
  // 一组带同一个岗位字样的窗口里谁坐在岗位上：已经在带人的里最晚开的，都没动静就取最晚开的；比它早开的、已经不在的是前任
  const seat = (g) => {
    const on = g.filter(here); if (!on.length) return null;               // 都不在了：这个岗位现在空着
    const doing = on.filter((s) => acted.has(s.sid)), cur = newest(doing.length ? doing : on);
    for (const s of g) if (s !== cur && (s.gone || s.at < cur.at)) formerOf.set(s.sid, cur.sid);
    return cur;
  };
  // 分支负责人（11/17 Khalil：「负责增长的那个窗口……是在总协调下面的一个分支，但优先级应该比较高」）：名字 / 标题里带分支字样的
  // （默认「X负责人」，X 不是「总」）。去掉分支字样以后还带负责人字样的（「FretFlow 总指挥 · 增长负责人」）照旧算负责人。
  const headG = headRe && new RegExp(headRe.source, headRe.flags.includes('g') ? headRe.flags : headRe.flags + 'g');
  const isHead = (s) => !!headRe && headRe.test(s.label) && !(leadRe && leadRe.test(s.label.replace(headG, ' ')));
  const leads = {}, heads = {};
  if (chief) leads[chief.dept] = chief.sid;
  const groups = new Map(), branches = new Map();
  for (const s of S) {
    if (s === chief || formerOf.has(s.sid)) continue;
    if (isHead(s)) {                                                      // 总管的项目里照样能有分支，挂在总管下面
      const k = s.dept + '\n' + branchOf(s.label, headRe);
      if (!branches.has(k)) branches.set(k, []);
      branches.get(k).push(s);
    } else if (leadRe && leadRe.test(s.label) && !(chief && s.dept === chief.dept)) {   // 总管的项目里不再另立负责人
      if (!groups.has(s.dept)) groups.set(s.dept, []);
      groups.get(s.dept).push(s);
    }
  }
  for (const [dept, g] of groups) { const lead = seat(g); if (lead) { leads[dept] = lead.sid; nodes[lead.sid].role = 'lead'; } }
  // 项目里没有总指挥这一级、也不是总管的项目：这个项目的「X负责人」照 11/17 之前的规则一起选负责人（那时它们都算负责人），画法和以前一样
  const byDept = new Map();
  for (const [k, g] of branches) { const d = g[0].dept; if (d in leads) continue; if (!byDept.has(d)) byDept.set(d, []); byDept.get(d).push(...g); branches.delete(k); }
  for (const [dept, g] of byDept) { const lead = seat(g); if (lead) { leads[dept] = lead.sid; nodes[lead.sid].role = 'lead'; } }
  for (const g of branches.values()) { const h = seat(g); if (h) { nodes[h.sid].role = 'head'; (heads[h.dept] = heads[h.dept] || []).push(h.sid); } }
  for (const [old, cur] of formerOf) nodes[old] = { role: 'former', boss: cur, via: 'seat', n: 0, last: 0, handed: false };
  for (const sid of Object.values(leads)) if (chief && sid !== chief.sid) nodes[sid] = { ...nodes[sid], boss: chief.sid, via: 'seat' };
  for (const [dept, hs] of Object.entries(heads)) for (const sid of hs) {   // 分支挂在本项目的负责人下面；没有负责人挂总管；都没有就是你直接带
    const up = leads[dept] || (chief ? chief.sid : null);
    nodes[sid] = { ...nodes[sid], boss: up, via: up ? 'seat' : null };
  }
  const seated = (sid) => !!sid && nodes[sid] && nodes[sid].role !== 'member';

  // 3. 其余的窗口：最近主要听谁的
  // weight(p → s)：p 在 s 这里有多大分量。s 的 from 里记着 p 发来几条、最后一条什么时候；p 开了 s 再加 SPAWN_W。
  const weight = (s, p) => {
    const f = s.from.find((x) => x.sid === p.sid);
    const msg = f ? f.n * decay(now, f.last) * (seated(p.sid) ? SEAT_W : 1) : 0;
    return msg + (s.by === p.sid ? SPAWN_W : 0);
  };
  // 你本人的分量。总控台替别的窗口开它时，那段开场白在记录里算成「你说的」，所以有 by 的先扣掉一轮。
  const mine = (s) => Math.max(0, s.hn - (s.by ? 1 : 0)) * decay(now, s.hl);
  const total = (s) => {
    let t = mine(s) + (s.by ? SPAWN_W : 0);
    for (const f of s.from) t += f.n * decay(now, f.last) * (seated(f.sid) ? SEAT_W : 1);     // 已经不在的窗口发来的也算分母：它确实带过这个窗口
    return t;
  };
  const dep = (s, p) => { const t = total(s); return t > 0 ? weight(s, p) / t : 0; };
  const near = (s, p) => p.dept === s.dept || (chief && (p === chief || formerOf.get(p.sid) === chief.sid));   // 别的项目的窗口是同事，不是上级；总管例外
  for (const s of S) {
    if (s.gone || nodes[s.sid].role !== 'member') continue;
    let best = null, bw = 0;
    for (const p of S) {
      if (p === s || !near(s, p)) continue;
      if (p.gone && !formerOf.has(p.sid)) continue;                       // 不在了、又不是哪个岗位的前任：当不了上级，只算分母
      const f = s.from.find((x) => x.sid === p.sid);
      if (s.by !== p.sid && !(f && f.n >= MIN_MSGS)) continue;            // 证据不够
      const w = weight(s, p);
      if (w > bw) { best = p; bw = w; }
    }
    if (best && bw > mine(s) && dep(s, best) > dep(best, s)) {
      const f = s.from.find((x) => x.sid === best.sid);
      nodes[s.sid] = { role: 'member', boss: best.sid, via: s.by === best.sid ? 'spawn' : 'msg', n: f ? f.n : 0, last: f ? f.last : 0, handed: false };
      continue;
    }
    // 它的记录里看不出听谁的（记录只读尾巴，早先的派活可能已经不在里面），但它一直在向负责人交东西，你本人又没怎么管它：归负责人。
    if (mine(s) >= 1) continue;
    let to = null, tn = 0, tl = 0;
    for (const p of S) {
      if (p === s || p.gone || !seated(p.sid) || !near(s, p)) continue;
      const f = p.from.find((x) => x.sid === s.sid);
      if (f && f.n >= MIN_MSGS && f.n > tn) { to = p; tn = f.n; tl = f.last; }
    }
    if (to) nodes[s.sid] = { role: 'member', boss: to.sid, via: 'report', n: tn, last: tl, handed: false };   // n / last 说的是它发给负责人的，不是负责人发给它的
  }

  // 4. 上级是前任的，跟着岗位走
  for (const s of S) { const n = nodes[s.sid]; if (n.role === 'member' && formerOf.has(n.boss)) { n.boss = formerOf.get(n.boss); n.handed = true; } }

  // 兜底：万一三个以上的窗口互相指成了一圈，把起头那个的上级拿掉，界面上不会少画任何一个窗口。
  for (const s of S) {
    const seen = new Set([s.sid]);
    for (let b = nodes[s.sid].boss; b; b = nodes[b] ? nodes[b].boss : null) {
      if (seen.has(b)) { nodes[s.sid] = { ...nodes[s.sid], boss: null, via: null, n: 0, last: 0, handed: false }; break; }
      seen.add(b);
    }
  }
  // 已经不在的窗口不出给界面；万一还有谁的上级指着它（不该发生），拿掉。
  for (const s of S) if (s.gone) delete nodes[s.sid];
  for (const s of S) { const n = nodes[s.sid]; if (n && n.boss && !nodes[n.boss]) nodes[s.sid] = { ...n, boss: null, via: null, n: 0, last: 0, handed: false }; }
  for (const d of Object.keys(heads)) { heads[d] = heads[d].filter((sid) => nodes[sid]); if (!heads[d].length) delete heads[d]; }
  return { chief: chief ? chief.sid : null, leads, heads, nodes };
}
