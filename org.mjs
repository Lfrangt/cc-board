/**
 * [INPUT]: 不依赖任何模块。调用方（server.mjs）给一份活着的会话清单：每个会话的 sid、名字、标题、属于哪个项目、什么时候开的、
 *          你本人开过几轮（human）、哪些窗口给它发过消息（from，已经认成 sid 的和认不出的都给）、是谁开的这个窗口（by）。
 *          清单里可以带「已经不在的窗口」（gone: true）：调用方从别的窗口收到的消息里认出来的发信人，只有名字和项目。
 * [OUTPUT]: 导出 buildOrg()、wordsRe()、branchOf()、branchWords() 和几个常数。buildOrg 返回 { chief, leads, heads, nodes }（heads = { 项目: [分支负责人 sid…] }）：
 *           nodes[sid] = { role: 'chief' | 'lead' | 'head' | 'former' | 'member', boss: sid | null, via: 'seat' | 'spawn' | 'msg' | 'report' | 'contact' | 'dept' | null, n, last, handed }。
 *           opt.seats = { 项目: sid }：点名的负责人（服务从 config 的 org.seats 指的文件里读），和 opt.chief 一样压过字样；点名的不在墙上 / 不在这个项目里就当没点名。
 *           head = 分支负责人（「增长负责人」这类）：挂在本项目的负责人下面（没有负责人挂总管），不是负责人的前任。
 *           via 是依据：seat 按岗位；spawn 上级开的它；msg 最近主要听上级的（n 条、最近一条 last）；report 它一直在向负责人交东西（n、last 是它发出去的）；
 *           contact 没有哪个窗口在管它，但本项目的负责人 / 分支负责人给它发过消息（哪怕一条），挂到最近发的那个（n、last 是那个岗位发给它的）；
 *           dept 没有哪个窗口在管它（多半是你本人开的），也没有岗位给它发过消息，按项目挂到这个项目的岗位上（分支负责人 / 负责人 / 总管），n、last 是 0。
 *           boss 是 null 的普通窗口 = 它的项目里没有负责人、也没有总管（比如刚装的总控台），只能你自己带。handed: true = 它原来听前任的，换代以后跟着岗位到了现任名下。
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
// 第 5 步「岗位发过消息」只看这么久以内的（11/17 khalil-49）：不设期限的话，一个分支负责人一天前给几个功能窗口各发过一条消息，
// 那几个窗口就会一直挂在它下面；该挂上的消息都是几小时之内发的，所以超过半天的一条不再决定它现在归谁。
export const CONTACT_MS = 12 * 3600e3;

// 把 config 里的一段正则原文编成 RegExp；空的、写错的都当成「没有这条规则」，不让一处手误把整个服务带崩。
export function wordsRe(src) {
  if (src instanceof RegExp) return src;
  if (typeof src !== 'string' || !src.trim()) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }
}

// 分支负责人管的话题词（「按项目挂上」时拿它对别的窗口的标题）：分支字样前面紧挨着的那一串汉字（最多 16 个，中间可以夹「、/ & +」），
// 英文是 head of 后面最多 3 个词；去掉结尾的「分支 / 线 / 方向 / 组」，再按「与 / 、/ & / and」拆开。
//   例：「FretFlow 主题与配色负责人」取出 主题、配色；「录音与混音线分支负责人开工」去掉词尾的「线分支」后取出 录音、混音；「Head of Growth」取出 growth。
// 不用 branchOf()：它最多取 6 个汉字（够分辨是不是同一条分支），「录音与混音线分支」到它手里只剩「与混音线分支」。
// 不按「和」拆：「和弦」是 FretFlow 最常见的词。汉字词至少 2 个字、英文词至少 3 个字母，太短的不要：一个「歌」字会撞上一大片标题。
export function branchWords(label, re) {
  const s = String(label || ''), m = re && s.match(re); if (!m) return [];
  const pre = s.slice(0, m.index).match(/\p{Script=Han}[\p{Script=Han}、/&+]{0,15}$/u);
  const post = /[a-z]$/i.test(m[0]) ? s.slice(m.index + m[0].length).match(/^\s*([a-z][\w-]*(?:\s+[a-z][\w-]*){0,2})/i) : null;
  const tail = /(?:分支|方向|小组|线|组)+$/u;
  return [...new Set([pre ? pre[0] : '', post ? post[1] : ''].join(' ').split(/[\s与、&/+,，·]+|\band\b/i)
    .map((w) => w.replace(tail, '').trim().toLowerCase()).filter((w) => (/\p{Script=Han}/u.test(w) ? w.length >= 2 : w.length >= 3)))];
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
//   2. 每个项目的负责人：opt.seats 点名的那个；没点名就是名字 / 标题里带负责人字样的，有好几个（换过代）时，取「已经在给别的窗口发消息或开过窗口」里最晚开的；
//      比它早的算前任；开现任的那个同项目普通窗口（还带过别的窗口）也算前任。总管所在的项目，负责人就是总管自己。
//      同一条分支 = 话题词一样（branchWords 排序后连起来；取不出话题词的用 branchOf）。
//      分支负责人（带分支字样的，默认「X负责人」）同一个项目里按分支名分开、各自照同样的办法选现任，挂在负责人下面；
//      项目里没有负责人（也不是总管的项目）时，这个项目的分支负责人照 11/17 之前的规则一起选负责人。
//   3. 其余的窗口看证据：最近主要听谁的，就归谁管。听你本人的更多，就不归任何窗口管（boss: null）。
//   4. 上级是前任负责人的，改挂到现任身上：换代以后，原来那一队人跟着岗位走，不跟着人走。
//   5. 到这里还没有上级的（你本人开的、开它的窗口已经关了、谁也没给它派过活）：本项目的岗位给它发过消息就挂到那个岗位（contact），
//      否则按项目挂到这个项目的岗位上（dept），不算「你直接带」。
// 前任收工关掉以后也一样：已经不在的窗口（gone）只要名字里带负责人 / 总管字样，就算那个岗位的前任，
// 听它的那一队人照样归现任；不然前任一归档，它带过的窗口就全掉到「你自己在带」里（11/15 真实数据：a5 归档后 9d、3b 掉队）。
export function buildOrg(list, opt = {}) {
  const now = num(opt.now) || Date.now();
  const chiefRe = wordsRe(opt.chiefWords), leadRe = wordsRe(opt.leadWords), headRe = wordsRe(opt.headWords);
  const branchKey = (label) => { const w = branchWords(label, headRe); return w.length ? w.slice().sort().join('+') : branchOf(label, headRe); };
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
  const actedOn = new Map();                     // 它开过、发过消息的窗口有哪些（下面认「开现任的上一任」用）
  const touch = (a, b) => { acted.add(a); if (!actedOn.has(a)) actedOn.set(a, new Set()); actedOn.get(a).add(b); };
  for (const s of S) { if (s.by) touch(s.by, s.sid); for (const f of s.from) if (f.sid && byId.has(f.sid)) touch(f.sid, s.sid); }
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
  // 「<话题>分支」这种写法（11/17 khalil-49）多了一道：它得在带人（开过、或发过消息给一个不带总管 / 负责人字样的窗口）。对话里「分支」多半是 git 分支
  // （像「沙盒分支」「网页分支」「失败分支」这种说法），光凭标题就会把合补丁、跑测试的窗口也当成分支；真开出去的分支都在给手下派活。
  const seatish = (t) => { const x = byId.get(t); return !!x && ((chiefRe && chiefRe.test(x.label)) || (leadRe && leadRe.test(x.label))); };
  const directs = (s) => [...(actedOn.get(s.sid) || [])].some((t) => t !== s.sid && !seatish(t));
  const isHead = (s) => { const m = headRe ? s.label.match(headRe) : null;
    return !!m && !(leadRe && leadRe.test(s.label.replace(headG, ' '))) && (m[0] !== '分支' || directs(s)); };
  const leads = {}, heads = {};
  if (chief) leads[chief.dept] = chief.sid;
  // 点名的负责人（11/17 khalil-49，opt.seats = { 项目: sid }，服务从 config 的 org.seats 指的文件里读）：和点名的总管一样压过字样。
  // 起因：上线这一列交接过两次，后来的两任标题里都没写「负责人」三个字，图上当成负责人的一直是更早的那一任。
  // 点名的必须在墙上、就在这个项目里、不是总管、不在总管的项目里；不满足就当没点名，照旧按字样认。
  const pinned = new Map();
  if (opt.seats && typeof opt.seats === 'object') for (const [d, sid] of Object.entries(opt.seats)) {
    const s = typeof sid === 'string' ? here(byId.get(sid)) : null;
    if (s && s.dept === d && s !== chief && !(chief && d === chief.dept)) pinned.set(d, s);
  }
  const isPinned = (s) => pinned.get(s.dept) === s;
  const groups = new Map(), branches = new Map();
  for (const s of S) {
    if (s === chief || formerOf.has(s.sid) || isPinned(s)) continue;
    if (isHead(s)) {                                                      // 总管的项目里照样能有分支，挂在总管下面
      const k = s.dept + '\n' + branchKey(s.label);                      // 话题词一样就算同一条分支：一个写成「…线分支负责人开工」、一个写成「…分支交接」，也是一条
      if (!branches.has(k)) branches.set(k, []);
      branches.get(k).push(s);
    } else if (leadRe && leadRe.test(s.label) && !(chief && s.dept === chief.dept)) {   // 总管的项目里不再另立负责人
      if (!groups.has(s.dept)) groups.set(s.dept, []);
      groups.get(s.dept).push(s);
    }
  }
  for (const [dept, g] of groups) { if (pinned.has(dept)) continue; const lead = seat(g); if (lead) { leads[dept] = lead.sid; nodes[lead.sid].role = 'lead'; } }
  for (const [dept, p] of pinned) {               // 带负责人字样的里，比点名的早开的、已经不在的是前任；晚开的是普通窗口（和总管同一条）
    leads[dept] = p.sid; nodes[p.sid].role = 'lead';
    // 项目里没有带负责人字样的（总控台那一列只有「上线负责人」）：下面那条兜底本来会让这个项目的「X负责人」一起选负责人，它们就是这个岗位的历任，
    // 点名以后照样算前任 / 普通窗口，不当分支（预览时出过错：更早的那任上线负责人，在点名现任以后反被画成了一条分支）
    const lineage = groups.get(dept) || [];
    if (!lineage.length) for (const [k, g] of branches) if (g[0].dept === dept) { lineage.push(...g); branches.delete(k); }
    for (const s of lineage) if (s.gone || s.at < p.at) formerOf.set(s.sid, p.sid);
  }
  // 项目里没有总指挥这一级、也不是总管的项目：这个项目的「X负责人」照 11/17 之前的规则一起选负责人（那时它们都算负责人），画法和以前一样
  const byDept = new Map();
  for (const [k, g] of branches) { const d = g[0].dept; if (d in leads) continue; if (!byDept.has(d)) byDept.set(d, []); byDept.get(d).push(...g); branches.delete(k); }
  for (const [dept, g] of byDept) { const lead = seat(g); if (lead) { leads[dept] = lead.sid; nodes[lead.sid].role = 'lead'; } }
  for (const g of branches.values()) { const h = seat(g); if (h) { nodes[h.sid].role = 'head'; (heads[h.dept] = heads[h.dept] || []).push(h.sid); } }
  // 开现任负责人的那个同项目普通窗口是上一任：交接时上一任开新窗口，两边标题都不一定带负责人字样（上一任的标题只写着交接两个字，现任就是从它那里开出来的）。
  // 只认「除了现任还开过 / 发过消息给别的窗口」的：只为开这一个窗口而存在的（替他传话的）不算前任。比现任晚开的不算。
  for (const [dept, sid] of Object.entries(leads)) {
    if (chief && sid === chief.sid) continue;
    const cur = byId.get(sid), p = cur && cur.by ? byId.get(cur.by) : null;
    if (!p || p.gone || p.dept !== dept || p === chief || formerOf.has(p.sid) || nodes[p.sid].role !== 'member' || p.at > cur.at) continue;
    if ((actedOn.get(p.sid) || new Set()).size >= 2) formerOf.set(p.sid, sid);
  }
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

  // 5. 到这里还没有上级的普通窗口：按项目挂到这个项目的岗位上（via dept）。11/17 Khalil：「如果我自己新建一个任务的话，你要智能地把这些任务
  //    都分配到它们自己的项目……不能说是我直接带的，要把它归类到它在这个架构里面的位置」。他本人开的、开它的窗口已经关了的、谁也没给它派过活的，都走这里。
  //    放在拆圈和清掉 gone 之后：被拆开的、上级指着不在的窗口的，也一样挂上；目标都是岗位（它们的上级链里没有普通窗口），不会再指成圈。
  //    挂到哪：标题对得上本项目正好一条分支（分支的话题词出现在它的名字 / 标题里，对上的词最多的那条，两条一样多算对不上）→ 那个分支负责人；
  //    否则 → 项目负责人（总管的项目里就是总管）；项目没有负责人 → 总管；连总管都没有 → 还是你直接带。
  const topic = new Map();
  for (const hs of Object.values(heads)) for (const h of hs) topic.set(h, branchWords(byId.get(h).label, headRe));
  for (const s of S) {
    const n = nodes[s.sid];
    if (s.gone || !n || n.role !== 'member' || n.boss) continue;
    // 先看证据：本项目现任的负责人 / 分支负责人给它发过消息，哪怕只有一条（第 3 步要两条，而且要压过他本人），就挂到最近发的那个（via contact）。
    // 起因：有一批窗口只收过分支的一条消息，凑不够第 3 步的两条，结果都按标题挂到了总指挥下面。n / last 是那个岗位发给它的条数和最近一条。
    // 前任发的不算（只算现任本人发的，悬停写「X 给它发过 N 条」才是真的）：他本人说得比前任多的窗口不算听前任的（第 13 段 F），照旧按项目挂。
    let ct = null;
    for (const f of s.from) {
      const r = f.sid && nodes[f.sid] ? nodes[f.sid].role : null;
      if ((r !== 'lead' && r !== 'head') || byId.get(f.sid).dept !== s.dept || now - f.last > CONTACT_MS) continue;
      if (!ct || f.last > ct.last) ct = f;
    }
    if (ct) { nodes[s.sid] = { role: 'member', boss: ct.sid, via: 'contact', n: ct.n, last: ct.last, handed: false }; continue; }
    const lab = s.label.toLowerCase();
    let hit = null, hn = 0, tie = false;
    for (const h of heads[s.dept] || []) {
      const k = (topic.get(h) || []).filter((w) => lab.includes(w)).length;
      if (k > hn) { hit = h; hn = k; tie = false; } else if (k > 0 && k === hn) tie = true;
    }
    const up = (!tie && hit) || leads[s.dept] || (chief ? chief.sid : null);
    if (up && up !== s.sid && nodes[up]) nodes[s.sid] = { role: 'member', boss: up, via: 'dept', n: 0, last: 0, handed: false };
  }
  return { chief: chief ? chief.sid : null, leads, heads, nodes };
}
