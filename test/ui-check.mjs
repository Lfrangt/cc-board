/**
 * [INPUT]: 依赖 .tmp/ui-fixture.json（state.test.mjs --ui 写的试验实例地址）；依赖 ./browser.mjs 的静音无头 Chromium
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过；截图放 .tmp/shots（墙 / 封面、深色 / 浅色、英文）
 * [POS]: test/ 的界面测试：逐张卡片核对右上角的状态标志、顶栏计数、排位、「先不管」、筛选、模糊卡片上那枚不模糊的标志、英文界面、按项目分组（墙一个项目一列、每列都在第一屏、筛选后回到平铺、换位置的动画、收起 / 展开一列、封面的组名、手机宽度）、正文里的本机路径能点、放大看（⌘O / 双击）、右上角「归档」、列头的「＋ 新任务」、codex 关着时不显示「交给谁」。
 *        只读页面 + 点「先不管」和筛选，不往任何会话里发话。真应用是 Safari 内核，这里测的是 Chrome 内核。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：先 node test/state.test.mjs --ui &（留着别关），再 node test/ui-check.mjs；重活，多个窗口共用一台机器时外面包一把全机的锁
import fs from 'node:fs'; import path from 'node:path';
import { launch, sleep } from './browser.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FX = JSON.parse(fs.readFileSync(path.join(HERE, '.tmp', 'ui-fixture.json'), 'utf8'));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '.tmp', 'shots')); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };

const browser = await launch();
async function open({ mode, scheme = 'dark', lang = 'zh', w = 1520, h = 900 }) {      // 无头浏览器的系统语言是英文，中文界面要明说
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
  await ctx.addInitScript((m) => { try { localStorage.setItem('ccb_mode', JSON.stringify(m)); } catch (e) {} }, mode);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(FX.url + (lang ? '&lang=' + lang : '')); await page.waitForSelector('.card'); await sleep(2600);
  return { ctx, page, errs };
}
const cardsOf = (page) => page.evaluate((sids) => {
  const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k])); const out = {};
  for (const el of document.querySelectorAll('.card')) {
    const sid = el.dataset.sid; const n = sid.startsWith('x:') ? 'gone' : name[sid] || sid; const meta = el.querySelector('.meta');
    const before = getComputedStyle(meta, '::before');
    out[n] = { cls: el.className, meta: meta.textContent, hidden: el.hidden, pill: getComputedStyle(meta).borderRadius !== '0px' && getComputedStyle(meta).backgroundColor !== 'rgba(0, 0, 0, 0)',
      anim: before.animationName, mark: before.content, why: (el.querySelector('.why') || {}).textContent || '', screen: (el.querySelector('pre.screen') || {}).textContent || '',
      btns: [...el.querySelectorAll('.body button')].map((b) => b.textContent), ask: (el.querySelector('.ask') || {}).textContent || '', head: (el.querySelector('.head') || {}).textContent || '', body: (el.querySelector('.body') || {}).textContent || '', op: el.style.opacity, you: (el.querySelector('.you') || {}).textContent || '', back: el.dataset.back, filter: el.style.filter, idx: [...document.querySelectorAll('.card')].indexOf(el) };
  }
  return { cards: out, segs: [...document.querySelectorAll('#filters button')].map((b) => b.textContent), title: document.title, posCur: (document.querySelector('#pos .cur') || {}).className || '', dots: document.querySelectorAll('#pos button:not(.pg)').length };
}, FX.sids);

try {
  // ── 墙视图（中文，深色）──
  let { ctx, page, errs } = await open({ mode: 'wall' });
  let s = await cardsOf(page); const c = s.cards;
  console.log('\n[墙 · 中文] 顶栏：' + s.segs.join(' | ') + '   标题：' + s.title);
  for (const [n, v] of Object.entries(c)) console.log('   ' + n.padEnd(9) + v.meta.padEnd(22) + v.cls.replace('card ', ''));
  ok(/^运行中 · /.test(c.run.meta) && /s-busy/.test(c.run.cls) && !/alert/.test(c.run.cls), 'run：右上角「运行中 · 时长」', c.run.meta);
  ok(c.run.pill && c.run.anim === 'live', 'run：是药丸，前面那颗点在呼吸（动画 live）', 'pill=' + c.run.pill + ' anim=' + c.run.anim);
  const want = { limit: '停住了 · 额度用完', auth: '停住了 · 登录过期', err: '停住了 · 报错', flag: '停住了 · 被安全检查拦了', intr: '停住了 · 被打断', unfin: '停住了 · 没做完', gone: '停住了 · 进程退出' };
  for (const [n, t] of Object.entries(want)) ok(c[n] && c[n].meta === t && /s-stopped/.test(c[n].cls) && /alert/.test(c[n].cls) && c[n].pill && c[n].mark === '"!"' && c[n].anim === 'none', `${n}：「${t}」，琥珀药丸带 !，不闪`, c[n] && (c[n].meta + ' / ' + c[n].cls + ' / mark=' + c[n].mark + ' anim=' + c[n].anim));
  ok(/^运行中 · \d+ 分钟没动静$/.test(c.stall.meta) && /s-busy/.test(c.stall.cls) && /alert/.test(c.stall.cls) && c.stall.mark === '"!"', 'stall：「运行中 · N 分钟没动静」，变成琥珀', c.stall.meta + ' / ' + c.stall.cls);
  ok(/^待审阅 · /.test(c.done.meta) && /s-review/.test(c.done.cls) && c.done.pill && c.done.mark === '"✓"' && c.done.head === '总结写好了。', 'done：交付了还没处理 → 青色药丸「✓ 待审阅 · 时间」，封面上一句结论', c.done.meta + ' / ' + c.done.cls + ' / ' + c.done.head);
  ok(/^后台在跑 · /.test(c.bg.meta) && /s-busy/.test(c.bg.cls) && /(^| )bg( |$)/.test(c.bg.cls) && c.bg.pill && c.bg.anim === 'live', 'bg：它自己歇着、后台的活还在跑 → 右上角「后台在跑 · 时长」，点在呼吸', c.bg.meta + ' / ' + c.bg.cls + ' pill=' + c.bg.pill + ' anim=' + c.bg.anim);
  ok(/^后台在跑 · /.test(c.bgOpen.meta) && !/alert|s-stopped/.test(c.bgOpen.cls), 'bgOpen：后台的活还在跑时，不说它「没做完就停了」', c.bgOpen.meta + ' / ' + c.bgOpen.cls);
  ok(/额度用完了/.test(c.limit.why) && /weekly limit/.test(c.limit.screen) && c.limit.btns.join() === '去终端看,先不管', 'limit：正文先说原因、带报错原文、有「去终端看 / 先不管」', c.limit.why + ' | ' + c.limit.btns.join());
  ok(c.intr.you.endsWith('重构播放器'), 'intr：你说的话没被打断标记顶掉', c.intr.you);
  ok(c.flag.head === '被安全检查拦了，这一轮停在这里。' && /按两下 Esc/.test(c.flag.body) && /\/model/.test(c.flag.body) && /可能再被拦/.test(c.flag.body) && /safeguards flagged/.test(c.flag.screen) && c.flag.btns.join() === '去终端看,先不管', 'flag：封面写「被安全检查拦了」，正文不用点开就写着「按两下 Esc / 用 /model 换模型、可能再被拦」，带原文', c.flag.head + ' | ' + (c.flag.body || '').slice(0, 80));
  ok(c.gone.btns.join() === '接回来,看对话,知道了' && /进程退出了/.test(c.gone.why), 'gone：有「接回来 / 看对话 / 知道了」');
  const nStop = Object.values(c).filter((v) => /alert/.test(v.cls)).length, nBusy = Object.values(c).filter((v) => /s-busy|(^| )bg( |$)/.test(v.cls)).length;
  ok(s.segs.includes('停住了' + nStop) && nStop === 9, '顶栏「停住了 9」', s.segs.join('|') + ' nStop=' + nStop);
  ok(s.segs.includes('运行中' + nBusy) && nBusy === 6, '顶栏「运行中 6」（4 个在做 + 2 个后台在跑）', s.segs.join('|') + ' nBusy=' + nBusy);
  const nTodo = nStop + Object.values(c).filter((v) => /s-review|s-reply/.test(v.cls)).length;
  ok(new RegExp('^\\(' + nTodo + '\\) ').test(s.title) && nTodo > nStop, '标题和 Dock 角标的数 = 待跟进 + 待审阅 + 停住了', s.title + ' nTodo=' + nTodo);
  const alertIdx = Object.values(c).filter((v) => /alert/.test(v.cls)).map((v) => v.idx), otherIdx = Object.values(c).filter((v) => !/alert/.test(v.cls)).map((v) => v.idx);
  ok(Math.max(...alertIdx) < Math.min(...otherIdx), '停住了的排在最前面');
  await page.screenshot({ path: path.join(OUT, 'wall-dark.png') });
  // 按项目分组（11/12 Khalil 16:06：「不要混起来」；16:4x：按行分会把后面的项目挤出屏幕，「改成竖着的，三个任务就是三列」）
  const groupsOf = () => page.evaluate((sids) => { const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k]));
    const nm = (el) => name[el.dataset.sid] || (el.dataset.sid.startsWith('x:') ? 'gone' : el.dataset.sid);
    const cols = [...document.querySelectorAll('#stage > .gcol')].map((col) => { const r = col.getBoundingClientRect(), h = col.querySelector('.ghead');
      return { h: h.firstChild.textContent, n: +h.querySelector('b').textContent, cards: [...col.querySelectorAll('.gbody > .card')].filter((x) => !x.hidden).map(nm),
        left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), headTop: Math.round(h.getBoundingClientRect().top),
        firstTop: Math.round((col.querySelector('.gbody > .card:not([hidden])') || h).getBoundingClientRect().top) }; });
    const loose = [...document.querySelectorAll('#stage > .card')].filter((x) => !x.hidden).map(nm);
    const m = document.querySelector('main');
    return { cols, loose, on: document.body.classList.contains('cols'), vh: innerHeight, mainScroll: m.scrollHeight - m.clientHeight, sw: document.documentElement.scrollWidth, vw: innerWidth }; }, FX.sids);
  // 一屏露出了几张：卡片整张落在它那一块的可见范围里
  const seen = () => page.evaluate(() => [...document.querySelectorAll('.gbody > .card')].filter((c) => { if (c.hidden || !c.offsetParent) return false; const r = c.getBoundingClientRect(), b = c.parentNode.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }).length);
  const gr = await groupsOf();
  ok(gr.on && gr.cols.length === 3 && !gr.loose.length && gr.cols.map((r) => r.h).sort().join() === ['FretFlow', '其他', '总控台'].sort().join(), '墙：三个项目三列，每列一个列头，没有落在列外的卡', JSON.stringify(gr.cols.map((r) => r.h)) + ' loose=' + gr.loose);
  ok(gr.cols.every((r) => r.n === r.cards.length) && (gr.cols.find((r) => r.h === 'FretFlow') || {}).cards + '' === 'projF' && (gr.cols.find((r) => r.h === '总控台') || {}).cards + '' === 'projC', '墙：列头的张数对得上；FretFlow 列只有 projF，总控台列只有 projC', JSON.stringify(gr.cols.map((r) => [r.h, r.n, r.cards.length])));
  ok(gr.cols[0] && gr.cols[0].h === '其他' && gr.cols[0].cards.some((n) => /^(limit|auth|err|intr|unfin|gone|stall|relimit)$/.test(n)), '墙：要你跟进的那一列排最左（列的先后看列里最靠前的那张）', JSON.stringify(gr.cols[0] && gr.cols[0].cards.slice(0, 3)));
  const cw = await page.evaluate(() => [...document.querySelectorAll('.gcol')].map((c) => Math.round((c.querySelector('.gbody > .card:not([hidden])') || c).getBoundingClientRect().width)));
  ok(gr.cols.every((r, i) => r.top === gr.cols[0].top && (i === 0 || r.left > gr.cols[i - 1].left)) && Math.max(...cw) / Math.min(...cw) < 1.12, '墙：各项目的块并排、顶端对齐；卡片和平铺时一样宽（不会因为分了块就变宽）', JSON.stringify({ blocks: gr.cols.map((r) => [r.h, r.w]), cardW: cw }));
  const n0 = await seen();
  ok(n0 === 6, '墙：一屏照样按 4 × 2 的格子放卡（17:3x Khalil：「还是只有 4 个，效率很低」）：其他 23 张占 2 格宽，另两个项目各 1 格，露出 6 张', 'seen=' + n0);
  ok(gr.cols.every((r) => r.headTop < gr.vh && r.firstTop < gr.vh - 100) && gr.mainScroll <= 1 && gr.sw <= gr.vw, '墙：每个项目打开就在第一屏（列头和第一张卡都看得见），页面本身不滚、不横向溢出', JSON.stringify({ heads: gr.cols.map((r) => r.headTop), first: gr.cols.map((r) => r.firstTop), vh: gr.vh, mainScroll: gr.mainScroll }));
  const geo = await page.evaluate(() => { const big = [...document.querySelectorAll('.gcol')].sort((a, b) => b.querySelectorAll('.card').length - a.querySelectorAll('.card').length)[0], body = big.querySelector('.gbody');
    const cs = [...body.querySelectorAll('.card:not([hidden])')].map((c) => c.getBoundingClientRect()); const br = body.getBoundingClientRect(); const cut = cs.find((r) => r.top < br.bottom - 8 && r.bottom > br.bottom + 8);
    return { n: cs.length, h: Math.round(cs[0].height), scrolls: body.scrollHeight > body.clientHeight, peek: cut ? Math.round(br.bottom - cut.top) : null, proj: getComputedStyle(document.querySelector('.card .proj')).display, anim: getComputedStyle(big).animationName }; });
  ok(geo.h >= 250 && geo.scrolls && geo.peek >= 10 && geo.peek <= 60 && geo.proj === 'none' && geo.anim === 'gcol-in', '墙：卡多的那一块自己往下滚，下一行露出一条边；卡片照样高；卡上不重复写项目名；块出现时淡入', JSON.stringify(geo));
  await page.screenshot({ path: path.join(OUT, 'wall-dark-columns.png') });
  await page.click('#filters [data-f="review"]'); await sleep(60);
  const an = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('card') && a.playState === 'running').length);
  ok(an > 0, '墙：换筛选时卡片从旧位置滑到新位置（查得到正在跑的动画；以前那版的动画被 layout() 清掉了，一个都查不到）', 'running=' + an);
  await page.click('#filters [data-f="all"]'); await sleep(700);
  // 收起一列（11/12 Khalil：「我不学的时候就可以把它折叠起来」）
  const w0 = await page.evaluate(() => Math.round(document.querySelector('.gcol').getBoundingClientRect().width));
  await page.evaluate(() => document.querySelector('.gcol [data-fold="fretflow"]').click()); await sleep(900);
  const fo = await page.evaluate(() => { const cols = [...document.querySelectorAll('.gcol')], f = cols.find((c) => c.classList.contains('folded')), r = f && f.getBoundingClientRect();
    return { n: cols.length, folded: f && f.querySelector('.ghead').textContent, fw: r && Math.round(r.width), fh: r && Math.round(r.height), cardShown: !!(f && f.querySelector('.card') && f.querySelector('.card').offsetParent),
      dots: f ? [...f.querySelectorAll('.gdots i')].map((i) => i.className) : [], other: cols.filter((c) => !c.classList.contains('folded')).map((c) => Math.round(c.getBoundingClientRect().width)), saved: localStorage.getItem('ccb_fold') }; });
  const n1 = await seen();
  ok(fo.n === 3 && /^FretFlow1/.test(fo.folded || '') && fo.fw <= 50 && fo.fh > 300 && !fo.cardShown && fo.dots.join() === 'review' && n1 === 7 && /fretflow/.test(fo.saved || ''), '墙：点「收起」这一块收成竖条（项目名、张数、有交付等你看亮青点）；腾出的格子给别的项目（其他占 3 格宽，露出 7 张），记在本机', JSON.stringify({ ...fo, w0, seen: n1 }));
  await page.screenshot({ path: path.join(OUT, 'wall-dark-folded.png') });
  await page.reload(); await page.waitForSelector('.card'); await sleep(2200);
  ok(await page.evaluate(() => !!document.querySelector('.gcol.folded[data-fold="fretflow"]')), '墙：重开总控台，收起的还是收起的');
  await page.evaluate(() => document.querySelector('.gcol.folded').click()); await sleep(900);
  const fo3 = await page.evaluate(() => ({ folded: document.querySelectorAll('.gcol.folded').length, saved: localStorage.getItem('ccb_fold') }));
  ok(fo3.folded === 0 && !/fretflow/.test(fo3.saved || ''), '墙：点竖条展开', JSON.stringify(fo3));
  // 点开、点正文都不算处理过；只有「审完了 / 先放着」或回它话才算（Khalil 11/12：看了不等于处理了）
  const nReview0 = Object.values(s.cards).filter((v) => /s-review/.test(v.cls)).length;
  await page.click(`.card[data-sid="${FX.sids.done}"] .body`); await sleep(400); s = await cardsOf(page);
  const anySeen = await page.evaluate(() => document.body.innerText.includes('已看'));
  ok(/^待审阅 · /.test(s.cards.done.meta) && /s-review/.test(s.cards.done.cls) && !anySeen, '点了正文还是「待审阅」，页面上没有「已看」两个字', s.cards.done.meta + ' / ' + s.cards.done.cls + ' anySeen=' + anySeen);
  ok(/^待跟进 · /.test(s.cards.askQ.meta) && /s-reply/.test(s.cards.askQ.cls) && /你选哪个/.test(s.cards.askQ.ask) && s.cards.askQ.mark === '"↩"', 'askQ：问你选哪个 → 琥珀「↩ 待跟进」，要你做的事单独一行', s.cards.askQ.meta + ' / ' + s.cards.askQ.ask + ' / mark=' + s.cards.askQ.mark);
  ok(/^待审阅 · /.test(s.cards.askCond.meta) && !s.cards.askCond.ask, 'askCond：「……的话，要不要我…？」是条件句，不算等你，是「待审阅」', s.cards.askCond.meta);
  ok(/^待跟进 · /.test(s.cards.askTag.meta) && s.cards.askTag.ask.endsWith('回 A 或 B，图在桌面') && !/【待跟进】/.test(s.cards.askTag.body), 'askTag：它自己写的【待跟进】那一行当成要你做的事，正文里不再出现', s.cards.askTag.ask + ' | ' + s.cards.askTag.body.slice(-30));
  const fyBtn = await page.evaluate((sid) => { const b = document.querySelector('.card[data-sid="' + sid + '"] [data-act="done"]'); return b ? b.hidden : null; }, FX.sids.peerDone);
  ok(/^无需处理 · /.test(s.cards.peerDone.meta) && /s-fyi/.test(s.cards.peerDone.cls) && !s.cards.peerDone.pill && fyBtn === true, 'peerDone：回给别的窗口的交付 → 灰字「无需处理」，不是药丸、没有「审完了」、不计数', s.cards.peerDone.meta + ' / ' + s.cards.peerDone.cls + ' btnHidden=' + fyBtn);
  ok(/^待跟进 · /.test(s.cards.peerAsk.meta), 'peerAsk：别的窗口开的头、但要你本人决定 → 还是「待跟进」', s.cards.peerAsk.meta);
  const lk = await page.evaluate((sid) => { const a = document.querySelector('.card[data-sid="' + sid + '"] .body a[href^="http://127.0.0.1:4791/?k=abc"]'); return a ? a.target + '|' + a.textContent : ''; }, FX.sids.askCond);
  ok(lk === '_blank|http://127.0.0.1:4791/?k=abc', '正文里直接贴的网址变成能点的链接（新窗口打开 = 原生外壳交给默认浏览器），后面的中文句号不算进去', lk);
  await page.click(`.card[data-sid="${FX.sids.done}"] [data-act="done"]`); await sleep(400); s = await cardsOf(page);
  ok(/^处理过 · /.test(s.cards.done.meta) && /s-handled/.test(s.cards.done.cls) && s.segs.includes('待审阅' + (nReview0 - 1)), '点「审完了」→「处理过」，顶栏的待审阅少一个', s.cards.done.meta + ' / ' + s.segs.join('|'));
  await page.click('#toast button'); await sleep(400); s = await cardsOf(page);
  ok(/^待审阅 · /.test(s.cards.done.meta) && s.segs.includes('待审阅' + nReview0), '提示条上点「撤销」→ 回到「待审阅」', s.cards.done.meta + ' / ' + s.segs.join('|'));
  // 「先不管」
  await page.click(`.card[data-sid="${FX.sids.limit}"] [data-act="ack"]`); await sleep(400); s = await cardsOf(page);
  ok(!/alert/.test(s.cards.limit.cls) && s.cards.limit.meta === '停住了 · 额度用完' && !s.cards.limit.pill && s.segs.includes('停住了' + (nStop - 1)), '点「先不管」：不再计数、药丸变回灰字，原因还写着', s.cards.limit.cls + ' / ' + s.segs.join('|'));
  ok(s.cards.limit.btns.join() === '去终端看', '点过之后只剩「去终端看」');
  // 筛选「停住了」
  await page.click('#filters [data-f="stop"]'); await sleep(300); s = await cardsOf(page);
  const vis = Object.entries(s.cards).filter(([, v]) => !v.hidden).map(([n]) => n).sort().join();
  ok(vis === 'auth,err,flag,gone,intr,relimit,stall,unfin', '筛选「停住了」只剩要跟进的 8 张', vis);
  const grf = await groupsOf();
  ok(!grf.on && grf.cols.length === 0 && grf.loose.length === 8, '筛选后只剩一个项目有卡：回到平铺的格子，不留空列', JSON.stringify({ on: grf.on, cols: grf.cols.length, loose: grf.loose.length }));
  await page.screenshot({ path: path.join(OUT, 'wall-dark-filter.png') });
  ok(errs.length === 0, '页面没有报错', errs.join(' | ')); await ctx.close();

  // ── 封面视图（中文，深色 + 浅色）──
  ({ ctx, page, errs } = await open({ mode: 'flow' })); s = await cardsOf(page);
  const front = Object.entries(s.cards).find(([, v]) => !/side/.test(v.cls));
  ok(front && /alert/.test(front[1].cls), '封面：站在最前面的是一张停住了的', front && front[0] + ' ' + front[1].cls);
  ok(s.cards.run.back === '1' && /blur\(3px\)/.test(s.cards.run.filter) && s.cards.run.pill && s.cards.run.anim === 'live', '封面：在跑的照旧退后，离远了变模糊，运行标志还在动', s.cards.run.filter + ' pill=' + s.cards.run.pill);
  ok(s.cards.stall.back === '0', '封面：可能卡住的那张不模糊', s.cards.stall.back);
  ok(/(^| )act( |$)/.test(s.posCur) && s.dots === Object.keys(s.cards).length, '封面：底下一排点一张卡一个，当前这张是琥珀（要你动手）', s.posCur + ' dots=' + s.dots);
  const cv = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'), fr = f.getBoundingClientRect(); const near = [...document.querySelectorAll('.card.side')].filter((c) => c.style.visibility !== 'hidden' && +c.style.opacity >= 0.6);
    return { title: parseFloat(getComputedStyle(f.querySelector('.title')).fontSize), head: (f.querySelector('.head') || {}).textContent || '', n: near.length, cover: near.map((c) => { const t = c.querySelector('.title').getBoundingClientRect(); return Math.max(0, Math.min(t.right, fr.right) - Math.max(t.left, fr.left)); }) }; });
  ok(cv.title >= 22 && cv.head.length > 0, '封面：标题至少 22px，下面有一句结论', JSON.stringify(cv));
  ok(cv.n >= 1 && cv.cover.every((x) => x === 0), '封面：两边的卡片标题没被中间那张挡住', JSON.stringify(cv.cover));
  await page.screenshot({ path: path.join(OUT, 'flow-dark.png') });
  // 「去终端」是右上角一直在的按钮，点一下就发 /api/focus（拦在浏览器里，不真的去切终端）；菜单里不再有它（Khalil 11/13）
  let focused = null; await page.route('**/api/focus', async (route) => { focused = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
  await page.evaluate((sid) => go(sid, true), FX.sids.done); await sleep(900);      // 最前面那张是「进程退出」的卡，它没有终端可去；先翻到一张普通的
  const fsid = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'); const b = f && f.querySelector('.chead [data-act="focus"]'); if (!b) return null; b.click(); return f.dataset.sid; }); await sleep(400);
  ok(fsid && focused && focused.sid === fsid, '封面：右上角「去终端」一点就让服务去切到它的终端', JSON.stringify({ fsid, focused }));
  const ab = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'); return { arch: !!f.querySelector('.chead [data-act="archive"]'), menu: !!document.querySelector('.card [data-act="menu"]') }; });
  ok(ab.arch && !ab.menu, '封面：右上角是「归档」按钮，没有「⋯」菜单了（11/13 Khalil：「直接点一个归档」）', JSON.stringify(ab));
  let archived = null; await page.route('**/api/archive', async (route) => { if (route.request().method() !== 'POST') return route.continue(); archived = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, keep: false, why: '只聊了几句，没改过文件', grace: 8000 }) }); });
  const asid = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'); f.querySelector('.chead [data-act="archive"]').click(); return f.dataset.sid; }); await sleep(300);
  const tt = await page.evaluate(() => document.querySelector('#toast span').textContent);
  ok(archived && archived.sid === asid && /^删了「.*」：只聊了几句，没改过文件（对话在暂存处放 30 天）$/.test(tt), '封面：点「归档」交给服务定删还是留，提示条说清楚删了还是留着', JSON.stringify({ archived, tt }));
  await page.unroute('**/api/archive');
  await page.unroute('**/api/focus');
  const runAt = await page.evaluate((sid) => { const i = order.indexOf(sid); go(order[i - 2], true); return i; }, FX.sids.run); await sleep(900);   // 翻到离 run 隔一张的位置：紧挨着的那张不糊，隔一张的才糊、才需要那枚不模糊的标志
  const hl = await page.evaluate((sid) => { const el = document.querySelector('.card[data-sid="' + sid + '"]'); const hs = [...document.querySelectorAll('.halo')];
    const h = hs.find((x) => x.style.transform === el.style.transform); const m = h && h.querySelector('.meta'); const a = m && m.getBoundingClientRect(), b = el.querySelector('.meta').getBoundingClientRect();
    return { n: hs.length, haloed: el.classList.contains('haloed'), text: m && m.textContent, inner: el.querySelector('.meta').textContent, hidden: getComputedStyle(el.querySelector('.meta')).visibility, filter: h && getComputedStyle(h).filter, dx: a && Math.abs(a.left - b.left), dy: a && Math.abs(a.top - b.top), cls: h && h.className }; }, FX.sids.run);
  ok(hl.haloed && hl.text === hl.inner && hl.hidden === 'hidden' && hl.filter === 'none' && hl.cls === 'halo s-busy' && hl.dx < 1.5 && hl.dy < 1.5, '封面：模糊的卡片上有一枚不模糊的标志，字一样、位置重合（差不到 1.5 px）', JSON.stringify(hl));
  await page.screenshot({ path: path.join(OUT, 'flow-dark-running-behind.png') });
  await page.click('#filters [data-f="busy"]'); await sleep(900); await page.screenshot({ path: path.join(OUT, 'flow-dark-running-front.png') });
  const fg = await page.evaluate(() => { const f = document.querySelector('.card:not(.side) .proj'); const keys = order.map((id) => cards.get(id).g.key); const back = keys.some((k, i) => i > 0 && k !== keys[i - 1] && keys.slice(0, i - 1).includes(k));
    return { labels: [...document.querySelectorAll('#pos .pg')].map((x) => x.textContent), proj: f && { t: f.textContent, d: getComputedStyle(f).display }, back }; });
  ok(fg.labels.length === 3 && !fg.back, '封面：同一项目的卡挨着；底下的点按项目隔开，每组前面写项目名', JSON.stringify(fg));
  ok(fg.proj && fg.proj.d !== 'none' && fg.labels.includes(fg.proj.t), '封面：卡片左上角写着它属于哪个项目', JSON.stringify(fg.proj));
  await page.evaluate(() => [...document.querySelectorAll('#pos .pg')].find((x) => x.textContent === 'FretFlow').click()); await sleep(900);
  const jumped = await page.evaluate(() => (document.querySelector('.card:not(.side)') || { dataset: {} }).dataset.sid);
  ok(jumped === FX.sids.projF, '封面：点组名跳到那一组的第一张', jumped);
  await page.screenshot({ path: path.join(OUT, 'flow-dark-groups.png') });
  // 封面：收起的项目不进轮播，底下点的后面写着它，点了展开并跳到那组第一张
  await page.evaluate(() => localStorage.setItem('ccb_fold', JSON.stringify(['fretflow']))); await page.reload(); await page.waitForSelector('.card'); await sleep(2200);
  const ff = await page.evaluate((sid) => ({ inOrder: order.includes(sid), hidden: (() => { const el = document.querySelector('.card[data-sid="' + sid + '"]'); return !el || el.hidden; })(), lab: [...document.querySelectorAll('#pos .pg.folded')].map((x) => x.textContent) }), FX.sids.projF);
  ok(!ff.inOrder && ff.hidden && ff.lab.join() === 'FretFlow 1', '封面：收起的项目不进轮播，底下点的后面写着「FretFlow 1」', JSON.stringify(ff));
  await page.evaluate(() => document.querySelector('#pos .pg.folded').click()); await sleep(900);
  const ff2 = await page.evaluate(() => ({ front: (document.querySelector('.card:not(.side):not([hidden])') || { dataset: {} }).dataset.sid, saved: localStorage.getItem('ccb_fold') }));
  ok(ff2.front === FX.sids.projF && !/fretflow/.test(ff2.saved || ''), '封面：点它展开，并跳到那一组的第一张', JSON.stringify(ff2));
  ok(errs.length === 0, '页面没有报错', errs.join(' | ')); await ctx.close();
  ({ ctx, page, errs } = await open({ mode: 'flow', scheme: 'light' })); await page.screenshot({ path: path.join(OUT, 'flow-light.png') }); await ctx.close();
  ({ ctx, page, errs } = await open({ mode: 'wall', scheme: 'light' })); await page.screenshot({ path: path.join(OUT, 'wall-light.png') }); await ctx.close();

  // ── 英文界面：新加的字都有英文 ──
  ({ ctx, page, errs } = await open({ mode: 'wall', lang: 'en' })); s = await cardsOf(page);
  console.log('\n[墙 · 英文] 顶栏：' + s.segs.join(' | '));
  for (const [n, v] of Object.entries(s.cards)) console.log('   ' + n.padEnd(9) + v.meta);
  ok(/^Background task · /.test(s.cards.bg.meta), '英文：后台在跑也是英文', s.cards.bg.meta);
  ok(/^Running · /.test(s.cards.run.meta) && s.cards.limit.meta === 'Stopped · out of quota' && s.cards.flag.meta === 'Stopped · blocked by safeguards' && s.cards.flag.head === "Blocked by the model's safeguards, so it stopped here." && s.cards.gone.meta === 'Stopped · process exited' && /^Running · no activity for \d+ min$/.test(s.cards.stall.meta), '英文：右上角的标志是英文', s.cards.run.meta + ' | ' + s.cards.limit.meta + ' | ' + s.cards.stall.meta);
  const zh = await page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('.meta,.why,.next,.lbl,.body button,.chead .done,#filters button,.pager,.reply textarea,.ghead')) { const t = (el.textContent || '') + ' ' + (el.getAttribute('placeholder') || ''); if (/[一-鿿]/.test(t)) bad.push(t.trim().slice(0, 40)); } return bad; });
  ok(zh.length === 0, '英文：标志、原因、按钮、顶栏里没有漏翻的中文', zh.join(' | '));
  await page.screenshot({ path: path.join(OUT, 'wall-dark-en.png') }); await ctx.close();
  ({ ctx, page, errs } = await open({ mode: 'wall', w: 390, h: 844 }));
  const nar = await page.evaluate(() => { const cols = [...document.querySelectorAll('.gcol')].map((c) => c.getBoundingClientRect()); return { sw: document.documentElement.scrollWidth, n: cols.length, stacked: cols.every((r, i) => i === 0 || r.top > cols[i - 1].top), ch: Math.round(document.querySelector('.gbody > .card:not([hidden])').getBoundingClientRect().height) }; });
  ok(nar.sw <= 390 && nar.n === 3 && nar.stacked && nar.ch >= 340, '手机宽度：三列叠成一列往下排，不横向溢出，卡片至少 340px 高', JSON.stringify(nar));
  await page.screenshot({ path: path.join(OUT, 'wall-phone-groups.png') }); ok(errs.length === 0, '手机宽度：页面没有报错', errs.join(' | ')); await ctx.close();

  // 正文里的本机路径能点（11/12 Khalil：「把资料直接把链接给我，我可以直接点进去」）
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  let opened = null; await page.route('**/api/open', async (route) => { opened = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'open' }) }); });
  const lp = await page.evaluate((sid) => { const c = document.querySelector('.card[data-sid="' + sid + '"]'); return { paths: [...c.querySelectorAll('.body [data-path]')].map((a) => a.dataset.path), http: c.querySelectorAll('.body a[href^="https"]').length }; }, FX.sids.links);
  ok(JSON.stringify(lp.paths) === JSON.stringify(['~/Desktop/总控台_封面新版/', '~/Library/Application Support/cc-board', '/Users/khalil/Desktop/x y.html']) && lp.http === 1, '正文里的路径变成可点的：直接写的、反引号里带空格的、file:// 百分号编码的；普通网址照旧', JSON.stringify(lp));
  await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .body [data-path]').click(), FX.sids.links); await sleep(300);
  ok(opened && opened.path === '~/Desktop/总控台_封面新版/', '点路径：交给服务的 /api/open（打开还是只在访达里选中由服务定）', JSON.stringify(opened));
  ok(errs.length === 0, '点路径：页面没有报错', errs.join(' | ')); await ctx.close();

  // 放大看：⌘O、双击封面；再按 ⌘O / 双击标题栏收回；双击正文里的字照旧选词（11/13 Khalil）
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  const dOpen = () => page.evaluate(() => ({ open: document.querySelector('#detail').open, title: document.querySelector('#dTitle').textContent }));
  const dsel = `.card[data-sid="${FX.sids.done}"]`;
  await page.hover(dsel + ' .head'); await page.keyboard.press('Meta+KeyO'); await sleep(500); const z1 = await dOpen();
  await page.keyboard.press('Meta+KeyO'); await sleep(300); const z2 = await dOpen();
  ok(z1.open && z1.title === 'w-done' && !z2.open, '⌘O：鼠标停在哪张卡上就放大哪张，再按一次收回', JSON.stringify([z1, z2]));
  await page.dblclick(dsel + ' .head'); await sleep(800); const z3 = await dOpen();
  const hasP = await page.evaluate(() => !!document.querySelector('#dBody p'));
  if (hasP) await page.dblclick('#dBody p'); await sleep(300); const z3b = await dOpen();
  await page.dblclick('#detail .dhead h1'); await sleep(300); const z4 = await dOpen();
  ok(z3.open && z3.title === 'w-done' && hasP && z3b.open && !z4.open, '双击卡片封面放大；大窗口里双击正文的字不收回，双击标题栏收回', JSON.stringify([z3, hasP, z3b, z4]));
  await page.dblclick(dsel + ' .body p', { position: { x: 14, y: 10 } }); await sleep(400); const z5 = await dOpen(); const sel = await page.evaluate(() => String(getSelection()).trim());   // 点在字上：段落比字宽，点正中间会落在字后面的空白
  ok(!z5.open && sel.length > 0, '双击卡片正文里的字：照旧选中词，不放大', JSON.stringify({ z5, sel }));
  await page.click(dsel + ' .title'); await sleep(400); const z6 = await dOpen();
  ok(!z6.open, '单击标题不再打开（免得和双击打架：第一下打开、第二下落在窗口外面又关上）', JSON.stringify(z6));
  ok(errs.length === 0, '放大看：页面没有报错', errs.join(' | ')); await ctx.close();
  // ── 新任务：模型是下拉菜单，已经记着 fable 时也能换成别的（11/12 Khalil：「怎么只有 Fable？我要 Opus」）──
  for (const saved of ['fable', 'claude-opus-5-5']) {
    const c2 = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark' });
    await c2.addInitScript((m) => { try { localStorage.setItem('ccb_new', JSON.stringify({ provider: 'claude', model: { claude: m }, effort: { claude: 'max' } })); } catch (e) {} }, saved);
    const pg = await c2.newPage(); let sent = null;
    await pg.route('**/api/new', async (route) => { sent = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'ccb-test00' }) }); });   // 拦在浏览器里，不真的开会话
    await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('.card'); await sleep(1800);
    await pg.click('#newBtn'); await sleep(500);
    const m = await pg.evaluate(() => { const el = document.querySelector('#nModel'); return { tag: el.tagName, value: el.value, opts: [...el.options].map((o) => o.value + '=' + o.textContent) }; });
    if (saved === 'fable') {
      const dlg = await pg.evaluate(() => ({ cwd: !!document.querySelector('#nCwd'), labels: [...document.querySelectorAll('#newDlg label, #newDlg .lab')].map((x) => x.textContent).join('|'), ph: document.querySelector('#nPrompt').placeholder }));
      ok(!dlg.cwd && dlg.labels === '要它做什么|交给谁|模型|强度' && /放在哪个文件夹它自己定/.test(dlg.ph), '新任务：不再问放哪个文件夹，提示里写明它自己定', JSON.stringify(dlg));
      ok(m.tag === 'SELECT' && m.value === 'fable' && m.opts.join('|') === '=默认|fable=Fable|opus=Opus|sonnet=Sonnet|haiku=Haiku', '新任务：模型是下拉菜单，记着 fable 时四个模型都列着', JSON.stringify(m));
      await pg.screenshot({ path: path.join(OUT, 'new-task.png') });
      await pg.selectOption('#nModel', 'opus'); await pg.fill('#nPrompt', '测试'); await pg.click('#nGo'); await sleep(600);
      ok(sent && sent.model === 'opus' && sent.provider === 'claude' && sent.effort === 'max' && sent.prompt === '测试', '新任务：选 Opus 再开工，发给服务的就是 opus', JSON.stringify(sent));
      ok(sent && sent.cwd === '~', '新任务：不带你选的文件夹，一律开在主目录', JSON.stringify(sent));
      const keptPick = await pg.evaluate(() => JSON.parse(localStorage.getItem('ccb_new')));
      ok(keptPick.model.claude === 'opus', '新任务：下次打开还记着 Opus', JSON.stringify(keptPick));
    } else {
      ok(m.value === saved && m.opts.includes(saved + '=' + saved) && m.opts.length === 6, '新任务：以前存的完整模型名还在列表里，没被丢掉', JSON.stringify(m));
    }
    await c2.close();
  }
  // ── 列头的「＋ 新任务」（11/13 Khalil：「在每一个主题下面再放一个新任务」）：点哪一列，任务就带着哪一列交给服务 ──
  for (const lang of ['zh', 'en']) {
    ({ ctx, page, errs } = await open({ mode: 'wall', lang })); let sent = null;
    await page.route('**/api/new', async (route) => { sent = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'ccb-test01' }) }); });   // 拦在浏览器里，不真的开会话
    const hd = await page.evaluate(() => [...document.querySelectorAll('#stage > .gcol:not(.folded)')].map((col) => { const h = col.querySelector('.ghead'), b = h.querySelector('.gnew'), f = h.querySelector('.gfold');
      const hr = h.getBoundingClientRect(), br = b && b.getBoundingClientRect();
      return { name: h.firstChild.textContent, key: b && b.dataset.newin, text: b && b.textContent.trim(), op: b && getComputedStyle(b).opacity, inside: !!br && br.left >= hr.left - 1 && br.right <= hr.right + 1 && br.height > 0, fold: !!f, beforeFold: !!(b && f && b.nextElementSibling === f) }; }));
    const want = lang === 'zh' ? '新任务' : 'New task';
    if (lang === 'en') { const nm = await page.evaluate(() => ({ brand: document.querySelector('.brand').textContent.trim(), title: document.title }));
      ok(nm.brand === 'cc-board' && /^(\(\d+\) )?cc-board$/.test(nm.title), 'en：英文名是 cc-board（11/13 定，不叫 Control Room）', JSON.stringify(nm)); }
    ok(hd.length === 3 && hd.every((x) => x.key && x.text === want && x.op === '1' && x.inside && x.fold && x.beforeFold), lang + '：每个展开的列头都有一个看得见的「' + want + '」，在「收起」按钮左边，没挤出列头', JSON.stringify(hd));
    if (lang === 'zh') await page.screenshot({ path: path.join(OUT, 'col-new.png'), clip: { x: 0, y: 40, width: 1520, height: 120 } });
    const go = async (sel, text) => { await page.click(sel); await sleep(400);
      const d = await page.evaluate(() => ({ open: document.querySelector('#newDlg').open, title: document.querySelector('#nTitle').textContent, ph: document.querySelector('#nPrompt').placeholder }));
      sent = null; await page.fill('#nPrompt', text); await page.click('#nGo'); await sleep(600); return d; };
    const dF = await go('.gcol .gnew[data-newin="fretflow"]', '列里开的');
    const titleF = lang === 'zh' ? '新任务 · FretFlow' : 'New task · FretFlow';
    ok(dF.open && dF.title === titleF && (lang === 'zh' ? /就在这个项目里做/.test(dF.ph) : /works in this project/.test(dF.ph)), lang + '：点 FretFlow 列头的按钮，弹窗标题写着「' + titleF + '」，提示说就在这个项目里做', JSON.stringify(dF));
    ok(sent && sent.prompt === '列里开的' && sent.project && sent.project.key === 'fretflow' && sent.project.name === 'FretFlow' && sent.cwd === '~', lang + '：发给服务的任务带着 FretFlow 这一列，照旧开在主目录', JSON.stringify(sent));
    if (lang === 'zh') {
      const dT = await go('#newBtn', '右上角开的');
      ok(dT.title === '新任务' && /放在哪个文件夹它自己定/.test(dT.ph) && sent && sent.project === null, '右上角的「新任务」：标题和提示回到原样，不带任何一列（不会沿用上一次点的列）', JSON.stringify({ dT, project: sent && sent.project }));
      const dO = await go('.gcol .gnew[data-newin="other"]', '其他列开的');
      ok(dO.title === '新任务' && sent && sent.project === null, '「其他」那一列的按钮：和右上角一样，让它自己找项目', JSON.stringify({ dO, project: sent && sent.project }));
    }
    ok(errs.length === 0, lang + '：列头新任务没有页面报错', errs.join(' | ')); await ctx.close();
  }
  // ── config.json 里 codex 没打开时，服务只报 Claude Code 一家：新任务里不显示「交给谁」。场景里 codex 是打开的，这里在浏览器里把 Codex 从应答里拿掉 ──
  for (const off of [false, true]) {
    const c3 = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark' }); const pg = await c3.newPage(); const e3 = [];
    pg.on('pageerror', (e) => e3.push(String(e)));
    if (off) await pg.route('**/api/state*', async (route) => { const r = await route.fetch(); const j = await r.json(); if (j.providers) delete j.providers.codex; await route.fulfill({ response: r, json: j }); });
    await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('.card'); await sleep(1800);
    await pg.click('#newBtn'); await sleep(400);
    const v = await pg.evaluate(() => ({ field: getComputedStyle(document.querySelector('#nProvField')).display, provs: [...document.querySelectorAll('#nProv button')].map((b) => b.textContent) }));
    if (off) ok(v.field === 'none' && v.provs.join() === 'Claude Code' && !e3.length, 'codex 关着：新任务里不显示「交给谁」', JSON.stringify({ v, e3 }));
    else ok(v.field !== 'none' && v.provs.join() === 'Claude Code,Codex', 'codex 打开：「交给谁」照旧显示 Claude Code / Codex', JSON.stringify(v));
    await c3.close();
  }
} finally { await browser.close(); }
console.log(`\n界面结果：${pass} 过，${fail} 没过；截图在 ${OUT}`);
process.exit(fail ? 1 : 0);
