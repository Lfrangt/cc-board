/**
 * [INPUT]: 依赖 .tmp/ui-fixture.json（state.test.mjs --ui 写的试验实例地址）；依赖 ./browser.mjs 的静音无头 Chromium；依赖 ./clips.mjs 的三段无声 WebM（图集 · 视频）
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过；截图放 .tmp/shots（墙 / 封面、深色 / 浅色、英文）
 * [POS]: test/ 的界面测试：逐张卡片核对右上角的状态标志、顶栏计数、排位、「先不管」、筛选、模糊卡片上那枚不模糊的标志、英文界面、按项目分组（墙一个项目一列、每列都在第一屏、筛选后回到平铺、换位置的动画、收起 / 展开一列、封面的组名、手机宽度）、列宽（拖分隔条跟手、松手吸附整格并记住、窄窗口里记了格数的列先拿、放不下的挤成窄条、点窄条先让一格、拖到底收起或挤开、双击 / Enter 恢复、方向键挪一格、宽卡大字）、正文里的本机路径能点、图集里的视频（格子里就地播、一次一个、⤢ 才放大、同时播放且只有指着的那格出声、对时间、进度条、全部放完复位）、放大看（⌘O / 双击；打开时从最新交付的第一行看起，不滚到最底）、右上角「归档」、列头的「＋ 新任务」、codex 关着时不显示「交给谁」、输入框上的预判（灰字 Tab 收下、1/2/3 填进输入框、数字键、封面视图）、点「审完了」/ 撤销 / 页面载入时把记录告诉服务（自动收工靠它）、架构视图（谁归谁管：入口、你 / 总管 / 每个项目一列、负责人的树和前任、你直接带的个数、三行字、悬停加重和依据、点开放大看、消息飞过去、没有数据、英文、窄窗口）。
 *        只读页面 + 点「先不管」和筛选，不往任何会话里发话。真应用是 Safari 内核，这里测的是 Chrome 内核。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：先 node test/state.test.mjs --ui &（留着别关），再 node test/ui-check.mjs；重活，多个窗口共用一台机器时外面包一把全机的锁
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { launch, sleep } from './browser.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FX = JSON.parse(fs.readFileSync(path.join(HERE, '.tmp', 'ui-fixture.json'), 'utf8'));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '.tmp', 'shots')); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const same = (got, want, name, extra = '') => ok(JSON.stringify(got) === JSON.stringify(want), name, extra || JSON.stringify(got));

const browser = await launch();
async function open({ mode, scheme = 'dark', lang = 'zh', w = 1520, h = 900 }) {      // 无头浏览器的系统语言是英文，中文界面要明说
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
  await ctx.addInitScript((m) => { try { localStorage.setItem('ccb_mode', JSON.stringify(m)); } catch (e) {} }, mode);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(FX.url + (lang ? '&lang=' + lang : '')); await page.waitForSelector(mode === 'org' ? '#org .onode .ot' : '.card'); await sleep(2600);   // 架构视图里卡片藏着，等方块里的标题
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

// 模型胶囊（挂在卡头下沿、右边和按钮对齐、和标题第一行同高）：夹具里 done 是 Fable 5.2 · max、limit 是 Opus 5.5 · xhigh、auth 是 Sonnet 4.5（老模型没有强度）、err 一条真回复都没有
// 位置用排版尺寸（offset*）量，不受封面里旁边那几张卡的缩放影响；seen 是眼睛看得到的字（窄卡把版本号藏了）
const chipsOf = (page) => page.evaluate((sids) => {
  const out = {};
  for (const [n, sid] of Object.entries(sids)) {
    const el = document.querySelector('.card[data-sid="' + sid + '"]'); if (!el || !el.querySelector('.mdl')) continue;     // 进程退出、启动中的卡用自己的模板，没有这个胶囊
    const c = el.querySelector('.mdl'), h = el.querySelector('.chead'), t = el.querySelector('.title'), mv = c.querySelector('.mv');
    out[n] = { shown: !c.hidden && c.offsetWidth > 0, text: c.textContent, title: c.title, h: c.offsetHeight, w: c.offsetWidth, ver: mv ? getComputedStyle(mv).display !== 'none' : null,
      seen: [...c.querySelectorAll('span')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent).join(''),
      trunc: c.scrollWidth > c.clientWidth, belowHead: c.offsetTop >= h.offsetHeight, edge: Math.round(h.offsetWidth - c.offsetLeft - c.offsetWidth), clear: parseFloat(getComputedStyle(t).paddingRight) >= c.offsetWidth + 4, inside: c.offsetLeft >= 0 };
  }
  return out;
}, FX.sids);

// ── 这一轮改了哪些文件（P1-9）、两个窗口同时在写一个仓库（P1-4）（11/16 win-f7）──
// 夹具（state.test.mjs --ui，只往现有的卡里补记录，不加卡）：askCond（待审阅）这一轮写了 ~/code/site 里 23 个文件（app.js 改 3 次）→ 服务列 20 个、wroteMore 3；
// tidyWork（待审阅）改了 ~/code/demo 里 2 个文件；run（在跑）也写了 ~/code/demo → run、tidyWork 两张卡各一行撞车提示。~/code 不在 roots 里，墙上、架构里的分组不变。
// UI_ONLY=wrote 只跑这一段（红阶段、改坏对照用），跑完直接出结果
// UI_ONLY=org 只跑「架构」那一段（11/17 分支负责人的红阶段、改坏对照用）
const ONLY_DONE = Symbol('only');
// 界面带 ?v= 拉 /api/state，服务只回变过的（第 2 条）。拦下来改应答的测试要整份：把 v 换成 0，服务回整份（full: true），界面整份换上
const fullState = (route) => route.fetch({ url: route.request().url().replace(/([?&]v=)[^&]*/, (m, p) => p + '0') });
const ev = (pg, fn, arg) => pg.evaluate(fn, arg).catch((e) => ({ err: String(e).slice(0, 160) }));
const wroteOf = (page, n) => ev(page, (sid) => {
  const el = document.querySelector('.card[data-sid="' + sid + '"]'); if (!el) return { missing: true };
  const vis = (x) => !!x && getComputedStyle(x).display !== 'none' && x.getClientRects().length > 0;
  const w = el.querySelector('.body .wrote'), cl = el.querySelector('.clash'), cr = el.getBoundingClientRect();
  const probe = document.createElement('span'); probe.style.color = 'var(--attn)'; el.append(probe); const attn = getComputedStyle(probe).color; probe.remove();
  return {
    wrote: w ? { lbl: ((w.querySelector('.wl .wt') || {}).textContent || '').trim(), first: el.querySelector('.body').firstElementChild === w,
      caret: ((w.querySelector('.wl .wc') || {}).textContent || '').trim(), exp: w.querySelector('.wl') ? w.querySelector('.wl').getAttribute('aria-expanded') : null,
      deliv: (() => { const md = [...el.querySelectorAll('.body .md')].find((x) => w.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING); if (!md) return null;   // 列表后面那段交付正文：第一行在正文区和卡里看得见
        const r = md.getBoundingClientRect(), b = el.querySelector('.body').getBoundingClientRect(); return r.top >= b.top - 1 && r.top + 14 <= b.bottom && r.top + 14 <= cr.bottom; })(),
      rows: [...w.querySelectorAll('li')].map((li) => { const a = li.querySelector('[data-path]'); return { path: a ? a.dataset.path : '', text: li.textContent.replace(/\s+/g, ' ').trim(), title: a ? a.title : '', vis: vis(li) }; }),
    } : null,
    clash: cl ? (() => { const r = cl.getBoundingClientRect(), lh = parseFloat(getComputedStyle(cl).lineHeight);
      return { shown: vis(cl) && !cl.hidden, text: cl.textContent.replace(/\s+/g, ' ').trim(), title: cl.title, attn: getComputedStyle(cl).color === attn, oneLine: r.height > 0 && r.height <= lh * 1.5, inCard: r.left >= cr.left && r.right <= cr.right + 0.5 }; })() : null,
  };
}, FX.sids[n]);
const visN = (w) => (w && w.rows ? w.rows.filter((r) => r.vis).length : -1);
const shotOf = async (page, n, file) => { try { await page.locator('.card[data-sid="' + FX.sids[n] + '"]').screenshot({ path: path.join(OUT, file) }); } catch (e) { console.log('  (截图没成：' + file + ' ' + String(e).slice(0, 80) + ')'); } };
// ── 弹层里回话（11/17 作者：「预览的时候，还有把窗口放大的时候，我回复不了……我希望一边预览，一边回复」）──
// 预览、放大看都是 showModal()，卡片上的回话框被挡在后面。现在弹层开着时，来源那张卡自己的回话框（.ap / .sg / .reply）挪进弹层底部（#dDock / #pDock），关掉还回卡片。
// 夹具：done、links 两张卡在浏览器里补上 tmux 通道（能回话）；done 再挂上预判和自动续跑的倒数。/api/send、/api/auto、/api/turns 拦在浏览器里，不往任何会话里发话。
// 单独跑这一段：UI_ONLY=dock node test/ui-check.mjs（改坏版逐个跑时用）
async function dockCheck() {
  const DSG = { ghost: '把改动提交并跑一遍测试', options: [{ n: 1, label: '提交并跑测试' }, { n: 2, label: '看一下改动' }] };
  const DAUTO = { state: 'armed', text: '【总控台自动续跑】（不是 Khalil 本人）接着做你上一轮自己提的下一步', basis: DSG.ghost, fireIn: 25000 };
  const PG = path.join(FX.home, 'Desktop', 'pvdock'); fs.mkdirSync(PG, { recursive: true });
  fs.writeFileSync(path.join(PG, 'page.html'), '<!doctype html><body style="margin:0;font:16px system-ui;padding:40px"><h1>预览中的页面</h1><p>' + '一段正文。'.repeat(80) + '</p></body>');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const D = FX.sids.done, K = FX.sids.links;
  const setup = async (page, opt = {}) => {
    const h = { sent: [], auto: [], turns: 0, drop: false };
    await page.route('**/api/state*', async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }   // 夹具服务偶尔断一次连接：这一次轮询作罢，界面下一拍再取
      for (const x of j.sessions) if (x.sid === D || x.sid === K) { x.channel = 'tmux'; x.tmux = 'ccb-fake'; if (x.sid === D) { x.suggest = DSG; x.auto = DAUTO; } }
      if (h.drop) j.sessions = j.sessions.filter((x) => x.sid !== D);
      await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/send', async (route) => { h.sent.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, delivered: true }) }); });
    await page.route('**/api/auto', async (route) => { h.auto.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await page.route(/\/api\/turns\?/, async (route) => { h.turns++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ turns: [
      { prompt: '整理一下', at: Date.now() - 3600e3, steps: 3, results: [{ at: Date.now() - 3000e3, text: '做好了，页面在 `/Users/khalil/Desktop/x y.html`，你看一眼。\n\n' + '说明文字。'.repeat(60) }] }] }) }); });
    await page.route('**/api/preview', async (route) => { const b = JSON.parse(route.request().postData() || '{}'); await route.continue({ postData: JSON.stringify(b.paths ? b : { path: path.join(PG, 'page.html') }) }); });   // 夹具里那条路径换成真实存在的页面
    await sleep(2800); return h;
  };
  // 回话框此刻在哪：卡片里（哪张）还是哪个弹层底部；两个弹层开没开；底部的零件和次序
  const where = (page) => page.evaluate(({ D, K }) => {
    const q = (s) => document.querySelector(s), card = (sid) => q('.card[data-sid="' + sid + '"]');
    const home = (sid) => { const c = card(sid); if (!c) return 'gone'; const rp = c.querySelector(':scope > .reply'); if (!rp) return 'away';
      const kids = [...c.children], b = kids.indexOf(c.querySelector(':scope > .body')), ap = kids.indexOf(c.querySelector(':scope > .ap')), sg = kids.indexOf(c.querySelector(':scope > .sg')), r = kids.indexOf(rp);
      return b < ap && ap < sg && sg < r ? 'card' : 'card-misordered'; };
    const dock = (id) => { const d = q(id); if (!d) return { hidden: true, sid: '', kids: '', to: '', val: null, focus: false, taH: 0, inDlg: false, note: '', ph: '', missing: true };
      const ta = d.querySelector('textarea'), r = d.getBoundingClientRect(), dl = d.closest('dialog').getBoundingClientRect();
      return { hidden: d.hidden, sid: d.dataset.sid || '', kids: [...d.children].map((x) => x.className.split(' ')[0]).filter((x) => x !== 'note').join(','), to: (d.querySelector('.dto') || {}).textContent || '',
        val: ta ? ta.value : null, focus: !!ta && document.activeElement === ta, taH: ta ? Math.round(ta.getBoundingClientRect().height) : 0, inDlg: !d.hidden && r.top >= dl.top && r.bottom <= dl.bottom + 1 && r.height > 40,
        note: (d.querySelector(':scope > .note') || {}).textContent || '', ph: ta ? ta.placeholder : '' }; };
    return { dOpen: q('#detail').open, pOpen: q('#preview').open, dDock: dock('#dDock'), pDock: dock('#pDock'), done: home(D), links: home(K),
      doneVal: (card(D) && card(D).querySelector('textarea') || {}).value, doneTaH: card(D) && card(D).querySelector('textarea') ? Math.round(card(D).querySelector('textarea').getBoundingClientRect().height) : 0 };
  }, { D, K });
  // 点 / 填 / 双击找不到元素时只等 3 秒、不抛：改之前的代码上没有底栏，要让每一条各自变红，而不是整段卡在 30 秒超时上
  const tap = (page, s) => page.click(s, { timeout: 3000 }).catch(() => {}), put = (page, s, v) => page.fill(s, v, { timeout: 3000 }).catch(() => {}), dbl = (page, s) => page.dblclick(s, { timeout: 3000 }).catch(() => {});
  const shown = (page, sel) => page.waitForFunction((s) => getComputedStyle(document.querySelector(s)).opacity === '1', sel, { timeout: 3000 }).catch(() => {});

  for (const lang of ['zh', 'en']) {
    let { ctx, page, errs } = await open({ mode: 'wall', lang }); const h = await setup(page); const L = lang + '：';
    // ① 放大看：回话框挪到大窗口底部
    const w0 = await where(page);
    await page.evaluate((sid) => zoomCard(sid), D); await sleep(700); const w1 = await where(page);
    ok(w0.done === 'card' && w1.dOpen && !w1.dDock.hidden && w1.dDock.sid === D && w1.dDock.kids === 'ap,sg,reply' && w1.done === 'away' && w1.dDock.to === '' && w1.dDock.inDlg,
      '弹层里回话（' + L + '放大看）：这张卡的回话框（自动续跑一行、预判、输入框）挪到大窗口底部，卡片上暂时没有；大窗口标题就是这张卡，不另写「回给」', JSON.stringify({ w0: w0.done, w1 }));
    ok(w1.dDock.taH >= 36 && w1.pDock.hidden, '弹层里回话（' + L + '放大看）：底部输入框是大一号的（和封面里一样高）；预览的底栏收着', JSON.stringify({ taH: w1.dDock.taH, p: w1.pDock.hidden }));
    if (lang === 'en') {
      const en = await page.evaluate(() => { const d = document.querySelector('#dDock'); if (!d) return '没有底栏'; return d.innerText + '|' + [...d.querySelectorAll('[title],[aria-label],[placeholder]')].map((x) => (x.title || '') + (x.getAttribute('aria-label') || '') + (x.placeholder || '')).join('|'); });
      const fixture = [DAUTO.text, DAUTO.text.replace('【总控台自动续跑】', ''), DSG.ghost, ...DSG.options.map((o) => o.label)];   // 提示里「会发：」后面是去掉记号的那句      // 夹具里模型写的字（会发的那句、灰字、三条的标签）本来就不翻
      ok(!/[一-鿿]/.test(fixture.reduce((t, x) => t.split(x).join(''), en)), '弹层里回话（en · 放大看）：底部看得见的字、提示、占位都是英文', en);
    }
    await shown(page, '#detail'); await page.screenshot({ path: path.join(OUT, 'dock-detail-' + lang + '-dark.png') });
    if (lang === 'zh') {
      // ② 灰字 Tab、点预判、点自动续跑的按钮：挪进来以后照样能用（点击不再经过卡片）
      await tap(page, '#dDock textarea'); await page.keyboard.press('Tab'); await sleep(150); const t1 = await where(page);
      await put(page, '#dDock textarea', ''); await tap(page, '#dDock .chip[data-sg="2"]'); await sleep(150); const t2 = await where(page);
      await put(page, '#dDock textarea', ''); await tap(page, '#dDock [data-ap="now"]'); await sleep(200);
      const gtBox = await page.evaluate(() => { const g = document.querySelector('.ghost .gt'); if (!g) return null; const a = getComputedStyle(g, '::after'); return { bg: getComputedStyle(g).backgroundColor, after: a.content, ring: a.boxShadow }; });
      ok(gtBox && gtBox.bg === 'rgba(0, 0, 0, 0)' && gtBox.after === 'none', '灰字建议没有被图集的格子样式（也叫 .gt）套上底色和描边框', JSON.stringify(gtBox));
      ok(t1.dDock.val === DSG.ghost && t1.dDock.focus && t2.dDock.val === '看一下改动', '弹层里回话（放大看）：空框按 Tab 收下灰字；点预判第 2 条填进框里', JSON.stringify({ t1: t1.dDock.val, t2: t2.dDock.val }));
      ok(h.auto.some((a) => a.sid === D && a.op === 'cancel') && h.auto.some((a) => a.sid === D && a.op === 'now'), '弹层里回话（放大看）：在底部打字照样取消一次自动续跑的倒数；点「现在发」照样交给 /api/auto', JSON.stringify(h.auto));
      // ③ 回车发出去：发给这张卡的会话；大窗口不关，重读一遍对话；「已送达」出在底部
      const t0 = h.turns; await tap(page, '#dDock textarea'); await page.keyboard.type('放大里回一句'); await page.keyboard.press('Enter'); await sleep(900); const s1 = await where(page);
      ok(h.sent.length === 1 && h.sent[0].sid === D && h.sent[0].text === '放大里回一句' && s1.dOpen && s1.dDock.val === '', '弹层里回话（放大看）：回车发出去，发给的是这张卡的会话；大窗口不关，框清空', JSON.stringify({ sent: h.sent, s1: s1.dDock }));
      ok(h.turns > t0 && s1.dDock.note === '已送达', '弹层里回话（放大看）：送达后重读一遍对话（刚说的出在最下面）；「已送达」出在大窗口底部，不出在被挡住的卡片上', JSON.stringify({ turns: [t0, h.turns], note: s1.dDock.note }));
      // ④ 写一半按 Esc：大窗口关掉，回话框回到卡片原来的位置，字还在；高度回到墙上的小号
      await put(page, '#dDock textarea', ''); await dbl(page, '#dDock textarea'); await sleep(300); const s2a = await where(page);      // 空框里双击：没有选中任何字，以前那条「选中了字就不收」挡不住
      await tap(page, '#dDock textarea'); await page.keyboard.type('写了一半'); await dbl(page, '#dDock textarea'); await sleep(300); const s2 = await where(page);
      ok(s2a.dOpen && s2.dOpen, '弹层里回话（放大看）：在底部输入框里双击（空框里、或在字上选词）都不会把大窗口收回', JSON.stringify([s2a.dOpen, s2.dOpen]));
      await page.keyboard.press('Escape'); await sleep(400); const s3 = await where(page);
      ok(!s3.dOpen && s3.done === 'card' && s3.doneVal === '写了一半' && s3.dDock.hidden && s3.dDock.kids === '' && s3.doneTaH <= 34, '弹层里回话（放大看）：写一半按 Esc 关掉 → 回话框回到卡片原来的位置（正文之后），草稿还在，底栏收起，输入框回到墙上的高度', JSON.stringify(s3));
      await put(page, `.card[data-sid="${D}"] textarea`, '');
      // ⑤ 预览：从卡片上点开的，回话框跟着进预览底部，写明回给哪个窗口
      await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .body [data-path$=".html"]').click(), K);
      await page.waitForFunction(() => document.querySelector('#pWait').hidden, null, { timeout: 5000 }).catch(() => {}); const p1 = await where(page);
      ok(p1.pOpen && !p1.pDock.hidden && p1.pDock.sid === K && p1.links === 'away' && p1.pDock.inDlg && p1.pDock.to === '回给w-links' && p1.dDock.hidden,
        '弹层里回话（预览）：从卡片上点开预览，那张卡的回话框挪到预览底部，上面一行写「回给 <它的标题>」', JSON.stringify(p1));
      await shown(page, '#preview'); await page.screenshot({ path: path.join(OUT, 'dock-preview-zh-dark.png') });
      await tap(page, '#pDock textarea'); await page.keyboard.type('预览里回一句'); await page.keyboard.press('Enter'); await sleep(900); const p2 = await where(page);
      ok(h.sent.length === 2 && h.sent[1].sid === K && h.sent[1].text === '预览里回一句' && p2.pOpen && p2.pDock.note === '已送达', '弹层里回话（预览）：一边看预览一边回车发出去，发给来源那张卡；预览不关', JSON.stringify({ sent: h.sent[1], p2: p2.pDock }));
      await page.keyboard.press('Escape'); await sleep(400); const p3 = await where(page);
      ok(!p3.pOpen && p3.links === 'card' && p3.pDock.hidden, '弹层里回话（预览）：Esc 关掉预览，回话框还给卡片', JSON.stringify(p3));
      // ⑥ 大窗口里点文件：预览叠在上面，回话框跟到预览底部；关掉预览，回到大窗口底部
      await page.evaluate((sid) => zoomCard(sid), K); await sleep(700);
      await tap(page, '#dBody [data-path]'); await page.waitForFunction(() => document.querySelector('#preview').open && document.querySelector('#pWait').hidden, null, { timeout: 5000 }).catch(() => {}); const q1 = await where(page);
      ok(q1.dOpen && q1.pOpen && q1.pDock.sid === K && !q1.pDock.hidden && q1.dDock.hidden, '弹层里回话（大窗口里点开预览）：回话框跟到最上面的预览底部，大窗口的底栏收起', JSON.stringify(q1));
      await page.keyboard.press('Escape'); await sleep(400); const q2 = await where(page);
      ok(q2.dOpen && !q2.pOpen && q2.dDock.sid === K && !q2.dDock.hidden && q2.links === 'away', '弹层里回话（大窗口里点开预览）：Esc 只关预览，回话框回到大窗口底部', JSON.stringify(q2));
      await page.keyboard.press('Escape'); await sleep(400);
      // ⑦ 图集放大时在底部打字：← → 挪光标，不翻图；离开输入框再按才翻
      await page.evaluate(({ sid, png }) => { previewSid = sid; renderGallery({ items: [{ name: 'a.png', kind: 'image', url: png }, { name: 'b.png', kind: 'image', url: png }] }, ''); galShow(1); }, { sid: D, png: PNG }); await sleep(400);
      await tap(page, '#pDock textarea'); await page.keyboard.type('ab'); await page.keyboard.press('ArrowLeft'); await sleep(100);
      const g1 = await page.evaluate(() => ({ i: gal && gal.i, caret: (document.querySelector('#pDock textarea') || {}).selectionStart }));
      await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('ArrowLeft'); await sleep(100); const g2 = await page.evaluate(() => gal && gal.i);
      ok(g1.i === 1 && g1.caret === 1 && g2 === 0, '弹层里回话（图集）：在底部输入框里按 ← 是挪光标、不翻图；离开输入框再按 ← 照旧翻到上一张', JSON.stringify({ g1, g2 }));
      await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(400); const g3 = await where(page);
      ok(!g3.pOpen && g3.done === 'card' && g3.doneVal === 'ab', '弹层里回话（图集）：Esc 两下关掉，回话框和草稿回到卡片', JSON.stringify(g3));
      await put(page, `.card[data-sid="${D}"] textarea`, '');
      // ⑧ 大窗口开着时这张卡从墙上没了（归档了、进程没了）：底栏收起，不报错
      await page.evaluate((sid) => zoomCard(sid), D); await sleep(700); h.drop = true; await sleep(2800); const r1 = await where(page);
      ok(r1.dOpen && r1.dDock.hidden && r1.dDock.kids === '' && r1.done === 'gone', '弹层里回话：大窗口开着时这张卡从墙上没了 → 底栏跟着收起（不留一个发不出去的框）', JSON.stringify(r1));
      h.drop = false; await page.keyboard.press('Escape'); await sleep(2800); const r2 = await where(page);
      ok(r2.done === 'card', '弹层里回话：它回到墙上，卡片照常有回话框', JSON.stringify(r2.done));
      // ⑨ 归档列表这类不在墙上的会话：放大看没有底栏
      await page.evaluate(() => openDetail('not-on-wall', 'x')); await sleep(500); const n1 = await where(page);
      ok(n1.dOpen && n1.dDock.hidden, '弹层里回话：不在墙上的会话（归档列表里的「对话」）放大看没有底栏', JSON.stringify(n1.dDock));
      await page.keyboard.press('Escape'); await sleep(300);
      // ⑩ 正在卡片里打字时按 ⌘O：放大看，光标接着在底部的框里，字还在
      await tap(page, `.card[data-sid="${D}"] textarea`); await page.keyboard.type('接着打'); await page.keyboard.press('Meta+KeyO'); await sleep(700); const o1 = await where(page);
      ok(o1.dOpen && o1.dDock.sid === D && o1.dDock.focus && o1.dDock.val === '接着打', '弹层里回话：正在卡片里打字时按 ⌘O 放大 → 光标接着在大窗口底部的框里，字还在', JSON.stringify(o1.dDock));
      await page.keyboard.press('Escape'); await sleep(400); await put(page, `.card[data-sid="${D}"] textarea`, '');
    } else {
      await page.keyboard.press('Escape'); await sleep(400);
      await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .body [data-path$=".html"]').click(), K);
      await page.waitForFunction(() => document.querySelector('#pWait').hidden, null, { timeout: 5000 }).catch(() => {}); const p1 = await where(page);
      ok(p1.pOpen && p1.pDock.sid === K && p1.pDock.to.startsWith('Reply to') && !/[一-鿿]/.test(p1.pDock.to.replace('w-links', '') + p1.pDock.ph), '弹层里回话（en · 预览）：底部写「Reply to <标题>」，占位字是英文', JSON.stringify(p1.pDock));
      await shown(page, '#preview'); await page.screenshot({ path: path.join(OUT, 'dock-preview-en-dark.png') });
      await page.keyboard.press('Escape'); await sleep(300);
    }
    ok(errs.length === 0, '弹层里回话（' + lang + '）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  // 浅色、封面：样子；封面里从底部发出去后最前面换成下一张，关掉时回话框回到原来那张卡
  {
    const { ctx, page, errs } = await open({ mode: 'flow', scheme: 'light' }); const h = await setup(page);
    await page.evaluate((sid) => zoomCard(sid), D); await sleep(700); await shown(page, '#detail'); await page.screenshot({ path: path.join(OUT, 'dock-detail-zh-light.png') });
    await tap(page, '#dDock textarea'); await page.keyboard.type('封面里回一句'); await page.keyboard.press('Enter'); await sleep(900); await page.keyboard.press('Escape'); await sleep(500); const f1 = await where(page);
    ok(h.sent.length === 1 && h.sent[0].sid === D && !f1.dOpen && f1.done === 'card', '弹层里回话（封面、浅色）：从大窗口底部发出去；关掉后回话框回到原来那张卡', JSON.stringify({ sent: h.sent, f1: f1.done }));
    await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .body [data-path$=".html"]').click(), K);
    await page.waitForFunction(() => document.querySelector('#preview').open && document.querySelector('#pWait').hidden, null, { timeout: 5000 }).catch(() => {});
    await shown(page, '#preview'); await page.screenshot({ path: path.join(OUT, 'dock-preview-zh-light.png') }); await page.keyboard.press('Escape'); await sleep(300);
    ok(errs.length === 0, '弹层里回话（封面、浅色）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
}

// ── 「先放着」带时间：待跟进的卡点「先放着」出三档（20 点以后没有「今晚」）+ 原来的「等它下次交付」；选 1 小时 → 服务记着（/api/state 里有 snooze），
//    卡片样子同处理过、药丸写到几点，不再算待跟进；提示条「撤销」→ 服务清掉、回到待跟进。待审阅的「审完了」照旧一点就处理、不出菜单。
//    中文浅色、英文深色各一遍，截图。服务端的醒 / 不醒在 state.test.mjs 的 [3s]。单独跑：UI_ONLY=snooze
async function snoozeCheck() {
  console.log('\n[先放着带时间]');
  const X = FX.sids.askTag, sel = '.card[data-sid="' + X + '"]';
  const card = (page) => page.evaluate((sel) => { const c = document.querySelector(sel); return c ? { cls: c.className, meta: c.querySelector('.meta').textContent, btn: c.querySelector('.done').textContent } : null; }, sel);
  const srv = (page) => page.evaluate((sid) => api('/api/state?peek=1').then((p) => (p.sessions.find((s) => s.sid === sid) || {}).snooze || null), X);
  for (const [lang, scheme] of [['zh', 'light'], ['en', 'dark']]) {
    const { ctx, page, errs } = await open({ mode: 'wall', lang, scheme });
    await page.evaluate((sid) => api('/api/snooze', { sid, clear: true }), X).catch(() => {}); await sleep(1600);     // 上一次在同一份夹具上跑到一半留下的推迟先清掉
    const zh = lang === 'zh', b0 = await card(page), hour = await page.evaluate(() => new Date().getHours());
    await page.click(sel + ' .done'); await sleep(400);
    const menu = await page.evaluate(() => { const m = document.querySelector('#menu');
      return { on: m.classList.contains('on'), items: [...m.querySelectorAll('[data-z]')].map((b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()), clock: (m.querySelector('.mz') || {}).textContent || '' }; });
    await page.screenshot({ path: path.join(OUT, `snooze-menu-${lang}-${scheme}.png`) });
    const want = zh ? ['1 小时', ...(hour < 20 ? ['今晚'] : []), '明早 9 点', '等它下次交付'] : ['1 hour', ...(hour < 20 ? ['Tonight'] : []), 'Tomorrow 9 AM', 'Until its next delivery'];
    ok(!!b0 && /s-reply/.test(b0.cls) && b0.btn === (zh ? '先放着' : 'Later') && menu.on && JSON.stringify(menu.items) === JSON.stringify(want) && (zh ? /^(明天 )?\d\d:\d\d$/ : /^(tomorrow )?\d\d:\d\d$/).test(menu.clock),
      `先放着（${lang}）：待跟进的卡点「先放着」出 ${want.length} 项（${hour} 点${hour < 20 ? '，有今晚' : '，20 点以后没有今晚'}），1 小时那项带钟点`, JSON.stringify({ b0, menu }));
    const t0 = Date.now(); await page.click('#menu [data-z]:first-child'); await sleep(1800);
    const a1 = await card(page), z1 = await srv(page), toast = await page.evaluate(() => ({ on: document.querySelector('#toast').classList.contains('on'), text: document.querySelector('#toast span').textContent }));
    ok(!!z1 && Math.abs(z1.until - (t0 + 3600e3)) < 15000 && !!a1 && !/s-reply/.test(a1.cls) && /s-handled/.test(a1.cls) && (zh ? /^先放着 · 到 (明天 )?\d\d:\d\d$/ : /^Later · until (tomorrow )?\d\d:\d\d$/).test(a1.meta) && a1.btn === (zh ? '不放了' : 'Bring back')
      && toast.on && (zh ? /^先放着到 (明天 )?\d\d:\d\d$/ : /^Later until (tomorrow )?\d\d:\d\d$/).test(toast.text),
      `先放着（${lang}）：选 1 小时 → 服务记到一小时后，卡片样子同处理过、不再算待跟进，药丸「${a1 && a1.meta}」，按钮换成「${a1 && a1.btn}」，提示条「${toast.text}」`, JSON.stringify({ z1, a1, toast }));
    await page.screenshot({ path: path.join(OUT, `snooze-card-${lang}-${scheme}.png`) });
    await page.click('#toast button'); await sleep(1800);
    const a2 = await card(page), z2 = await srv(page);
    ok(!z2 && !!a2 && /s-reply/.test(a2.cls), `先放着（${lang}）：提示条点「撤销」→ 服务清掉，回到待跟进`, JSON.stringify({ z2, a2 }));
    if (zh) {      // 待审阅的「审完了」照旧：一点就处理，不出菜单
      const R = '.card[data-sid="' + FX.sids.tidyWork + '"]'; const r0 = await page.evaluate((R) => { const c = document.querySelector(R); return c ? { cls: c.className, btn: c.querySelector('.done').textContent } : null; }, R);
      await page.click(R + ' .done'); await sleep(600);
      const r1 = await page.evaluate((R) => ({ cls: document.querySelector(R).className, menu: document.querySelector('#menu').classList.contains('on') }), R);
      ok(!!r0 && /s-review/.test(r0.cls) && r0.btn === '审完了' && !r1.menu && /s-handled/.test(r1.cls), '先放着：待审阅的「审完了」照旧一点就算处理过，不出时间菜单', JSON.stringify({ r0, r1 }));
      await page.click('#toast button').catch(() => {}); await sleep(600);     // 撤销：服务那边的「审完了」也清掉，不让自动收工的快线在后面的段里收走它
    }
    await page.evaluate((sid) => api('/api/snooze', { sid, clear: true }), X).catch(() => {});     // 不管上面过没过，都别把推迟留给后面的段
    ok(errs.length === 0, `先放着（${lang}）：页面没报错`, errs.join(' | ')); await ctx.close();
  }
}

// ── 只回变过的（拉数据瘦身）：界面带 ?v= 拉 /api/state，第一次整份、之后只收变过的，拼出来的墙和服务的整份一样；
//    会话真的不见了（这里用真的「归档」，所以放在整套最后），卡也真的没了；拼不上马上要一次整份。服务端的断言在 state.test.mjs 的 [2v]。
//    单独跑：UI_ONLY=delta node test/ui-check.mjs
async function deltaCheck() {
  console.log('\n[只回变过的（拉数据瘦身）]');
  const { ctx, page, errs } = await open({ mode: 'wall' });
  const got = [];      // 界面每次轮询 /api/state 的应答（不含下面核对用的 peek 读法）：带的 v、字节数、整份还是只回变过的、changed / gone
  page.on('response', async (res) => { const u = res.url(); if (!u.includes('/api/state?') || /[?&]peek=1/.test(u)) return; const t = Date.now();
    try { const b = await res.body(), j = JSON.parse(b.toString('utf8')); got.push({ t, v: new URL(u).searchParams.get('v'), n: b.length, full: j.full === true, sessions: 'sessions' in j, changed: (j.changed || []).map((s) => s.sid), gone: j.gone || [] }); } catch {} });
  // 和服务同一个版本号下的整份逐字段比：先让界面拉一拍，紧跟着带 v=0 要一份整份（peek，不取走提示）；两边版本号一样（中间服务没扫出新东西）才比，不一样就重来。
  // 比：会话的先后、每个会话的每个字段（quiet 差 3 秒以内算一样：服务每 1.2 秒扫一次，在跑的会话 quiet 每扫一次都涨）、每个全局字段、每个会话都有卡
  const wallNow = () => page.evaluate(async () => {
    const SKIP = new Set(['now', 'notices', 'v', 'full', 'peek', 'sessions']);
    for (let i = 1; i <= 20; i++) {
      await poll(); const p = await api('/api/state?peek=1&v=0');
      if (!sv || p.v !== sv.v) { await new Promise((r) => setTimeout(r, 150)); continue; }
      const diffs = [], ids = p.sessions.map((s) => s.sid), mine = sv.sessions.map((s) => s.sid);
      if (JSON.stringify(ids) !== JSON.stringify(mine)) diffs.push('先后：' + mine.length + ' 对 ' + ids.length);
      const S = new Map(sv.sessions.map((s) => [s.sid, s])); let busyQ = 0;
      for (const s of p.sessions) { const m = S.get(s.sid); if (!m) continue;
        if (JSON.stringify({ ...m, quiet: 0 }) !== JSON.stringify({ ...s, quiet: 0 })) diffs.push('会话 ' + s.sid.slice(0, 8));
        if (Math.abs((m.quiet || 0) - (s.quiet || 0)) > 3000) diffs.push('quiet ' + s.sid.slice(0, 8) + ' ' + m.quiet + ' 对 ' + s.quiet);
        busyQ = Math.max(busyQ, s.quiet || 0); }
      const keys = new Set([...Object.keys(p), ...Object.keys(sv)].filter((k) => !SKIP.has(k)));
      for (const k of keys) if (JSON.stringify(sv[k]) !== JSON.stringify(p[k])) diffs.push('全局 ' + k);
      const cards = new Set([...document.querySelectorAll('#stage .card[data-sid]')].map((c) => c.dataset.sid));
      return { tries: i, n: ids.length, diffs, busyQ, missing: ids.filter((x) => !cards.has(x)), sids: ids };
    }
    return { tries: 20, sameV: false, diffs: ['20 次都没对上版本号'], missing: [], sids: [] };
  });
  const fresh = await page.evaluate((x) => api('/api/state?peek=1').then((p) => x.every((sid) => p.sessions.some((s) => s.sid === sid))), [FX.sids.intrIdle, FX.sids.stall]);
  ok(fresh, '只回变过的：夹具还新鲜（intrIdle、stall 这两个 15 分钟后会退出的会话都还在墙上；不在的话下面几条红是夹具过期，不是这一段的毛病）', '');
  const tReload = Date.now(); await page.reload(); await page.waitForSelector('.card'); await sleep(6000);
  const fi = got.findIndex((g) => g.t >= tReload && g.v === '0'), first = got[fi] || {}, rest = fi >= 0 ? got.slice(fi + 1) : [];
  ok(fi >= 0 && first.full && first.sessions, '页面打开后第一次拉：带 v=0，拿到整份', JSON.stringify(first).slice(0, 200));
  ok(rest.length >= 2 && rest.every((g) => g.v && g.v !== '0' && !g.full && !g.sessions && g.n < first.n / 3),
    '之后每一拍带着上一次的版本号，只收变过的（夹具里 run / compact / hint 一直在加记录）：整份 ' + first.n + ' 字节，之后 ' + rest.map((g) => g.n).join(' / ') + ' 字节', JSON.stringify(rest.map((g) => ({ v: g.v, n: g.n, full: g.full, ch: g.changed.length }))));
  const w1 = await wallNow();
  ok(w1.diffs.length === 0 && w1.missing.length === 0 && w1.n > 4, '拼出来的状态和服务同一个版本号下的整份一样：' + w1.n + ' 个会话的先后、每个字段、每个全局字段，每个会话都有卡（对上版本号试了 ' + w1.tries + ' 次）',
    JSON.stringify({ diffs: (w1.diffs || []).slice(0, 8), missing: w1.missing }));
  ok(w1.busyQ > 3000, '在跑没动静的会话（stall）的 quiet 跟着涨：拼出来的和整份差不到 3 秒，最大的 ' + w1.busyQ + ' ms（不套 q 的话停在页面打开那一刻）', JSON.stringify({ busyQ: w1.busyQ }));
  // 拼不上（应答的 base 对不上界面手上的版本号）：不画半张墙，马上（不等 1.5 秒）要一次整份
  let bent = 0, bentV = null;
  await page.route('**/api/state*', async (route) => { const url = route.request().url(); if (bent || /[?&]peek=1/.test(url) || /[?&]v=0(&|$)/.test(url)) return route.continue(); bent++; bentV = new URL(url).searchParams.get('v');
    const r = await route.fetch(); const j = await r.json(); j.base = 'deadbeef.1'; await route.fulfill({ response: r, json: j }); });
  const nB = got.length; await sleep(3500); await page.unroute('**/api/state*');
  const after = got.slice(nB), bi = after.findIndex((g) => g.v === bentV && !g.full), nx = after[bi + 1] || {};
  ok(bent === 1 && bi >= 0 && nx.v === '0' && nx.full && nx.t - after[bi].t < 1000, '拼不上的那一拍：马上带 v=0 再要一次整份（隔 ' + (nx.t - (after[bi] || {}).t) + ' ms）', JSON.stringify({ bentV, after: after.map((g) => ({ v: g.v, full: g.full })) }));
  const w2 = await wallNow();
  ok(w2.diffs.length === 0 && w2.missing.length === 0, '拼不上之后墙照旧和服务同一个版本号下的整份一样', JSON.stringify({ diffs: (w2.diffs || []).slice(0, 8), missing: w2.missing }));
  // 会话真的不见了：用服务真的「归档」拿掉一个（不拦），下一拍只回变过的里 gone 带着它，卡从墙上没了
  const X = FX.sids.intrIdle, nG = got.length;
  const ar = await page.evaluate((sid) => api('/api/archive', { sid }), X);
  await page.waitForFunction((sid) => !document.querySelector('#stage .card[data-sid="' + sid + '"]'), X, { timeout: 8000 }).catch(() => {});
  const g = await page.evaluate((sid) => ({ card: !!document.querySelector('#stage .card[data-sid="' + sid + '"]'), inSv: sv.sessions.some((s) => s.sid === sid) }), X);
  const via = got.slice(nG).find((x) => x.gone.includes(X));
  ok(!!ar && ar.ok && !g.card && !g.inSv && !!via && !via.full && !via.sessions, '服务那边真的拿掉一个会话（归档）：只回变过的那一拍 gone 里有它，卡从墙上没了', JSON.stringify({ ar, g, via }));
  const w3 = await wallNow();
  ok(w3.diffs.length === 0 && w3.missing.length === 0 && !w3.sids.includes(X), '拿掉以后墙和服务同一个版本号下的整份还是一样（归档数、架构这些全局字段也跟着变了）', JSON.stringify({ diffs: (w3.diffs || []).slice(0, 8), missing: w3.missing }));
  ok(errs.length === 0, '只回变过的：页面没报错', errs.join(' | ')); await ctx.close();
}


// ── 图集 · 视频在格子里播（11/17 作者：「我想直接播放……不用把它放到全屏」「甚至你可以加入这个同时播放」，win-35）──
// 夹具：假主目录 Desktop/galv/ 放三段没有声音的 VP8（a、b 6 秒，c 4 秒，test/clips.mjs）；Desktop/galone/ 一段视频 + 一张图。/api/preview 把夹具路径换成真文件，走真的预览端口。
// 核：点格子就地播 / 停、不进放大层；一次只播一个；⤢ 才放大且格子里的停下；「同时播放」全播、只有一格出声、出声的跟着鼠标走、被拉开的会对回去；
// 全部暂停 / 全部继续不回到开头；联动时点一格 = 全停 / 全播；进度条拖动不算点播放、联动时一起挪；短的先放完长的接着播；全部放完回到「同时播放」、再点从头；
// 关掉预览全停；只有一段视频的图集没有这个按钮；英文；浅色。单独跑：UI_ONLY=galv node test/ui-check.mjs（红阶段、改坏版逐个跑时用）
async function galVideoCheck() {
  const { CLIPS } = await import('./clips.mjs');
  const shown = (page, sel) => page.waitForFunction((x) => getComputedStyle(document.querySelector(x)).opacity === '1', sel, { timeout: 3000 }).catch(() => {});
  const GV = path.join(FX.home, 'Desktop', 'galv'), G1 = path.join(FX.home, 'Desktop', 'galone'); fs.mkdirSync(GV, { recursive: true }); fs.mkdirSync(G1, { recursive: true });
  for (const k of ['a', 'b', 'c']) fs.writeFileSync(path.join(GV, k + '.webm'), Buffer.from(CLIPS[k], 'base64'));
  fs.writeFileSync(path.join(G1, 'a.webm'), Buffer.from(CLIPS.a, 'base64'));
  fs.writeFileSync(path.join(G1, 'b.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const st = (page) => ev(page, () => { const q = (s) => document.querySelector(s), vids = [...document.querySelectorAll('#pGal .ggrid video')];
    const sy = q('#pSync') || { hidden: true, textContent: '', title: '' };       // 红阶段（旧界面）没有这些元素：读成「没有」，断言照常变红，不让整段崩掉
    return { open: q('#preview').open, lb: !!q('#pGal .lb'), lbVid: !!q('#pGal .lb video'), dir: q('#pDir').textContent, sync: { hidden: sy.hidden, text: sy.textContent.trim(), title: sy.title },
      v: vids.map((v) => { const t = v.closest('.gv') || v.parentNode, g = t.querySelector('.gplay'), b = t.querySelector('.gbar i');
        return { paused: v.paused, muted: v.muted, t: Math.round(v.currentTime * 100) / 100, d: v.duration, ended: v.ended, ctrl: v.controls, aud: t.classList.contains('aud'), play: t.classList.contains('play'), badge: g ? g.textContent : '', bar: b ? b.style.transform : '' }; }) }; });
  const tap = (page, sel) => page.click(sel, { timeout: 3000 }).catch(() => {}), over = (page, sel) => page.hover(sel, { timeout: 3000 }).catch(() => {});
  const spread = (s) => { const ts = s.v.filter((x) => !x.ended).map((x) => x.t); return ts.length ? Math.max(...ts) - Math.min(...ts) : 0; };
  const loud = (s) => s.v.map((x, i) => (x.muted ? -1 : i)).filter((i) => i >= 0);
  for (const [lang, scheme] of [['zh', 'dark'], ['en', 'dark'], ['zh', 'light'], ['en', 'light']]) {
    const tag = '图集 · 视频（' + lang + (scheme === 'light' ? '、浅色' : '') + '）：';
    const { ctx, page, errs } = await open({ mode: 'wall', lang, scheme });
    let target = GV + '/';
    await page.route('**/api/preview', (route) => route.continue({ postData: JSON.stringify({ path: target }) }));
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<a id="tGalv" class="file" data-path="~/Desktop/galv/">galv</a>'));
    const openIt = async () => { await page.evaluate(() => document.querySelector('#tGalv').click());
      await page.waitForFunction(() => document.querySelector('#pBody').dataset.kind === 'gallery' && [...document.querySelectorAll('#pGal .ggrid video')].every((v) => v.readyState >= 1), null, { timeout: 8000 }).catch(() => {}); await sleep(200); };
    await openIt();
    let s = await st(page);
    ok(s.open && s.v.length === 3 && s.v.every((x) => x.d > 3.5 && !x.ctrl && x.paused && x.badge === '▶') && !s.sync.hidden && s.sync.text === (lang === 'zh' ? '同时播放' : 'Play all'),
      tag + '3 段视频排成格子，不带原生控制条、都停着、写 ▶；顶栏多一个「同时播放」', JSON.stringify(s));
    if (lang === 'en') {
      const lb = await ev(page, () => [...document.querySelectorAll('#pSync,#pGal [aria-label],#pGal [title]')].map((x) => (x.getAttribute('aria-label') || '') + '|' + (x.getAttribute('title') || '') + '|' + (x.id === 'pSync' ? x.textContent : '')).join(' '));
      ok(!/[一-鿿]/.test(lb) && /Play a\.webm/.test(lb) && /Enlarge/.test(lb) && /you hear the one under the pointer/.test(lb), tag + '按钮、格子的读屏名和提示都翻好了', lb);
    }
    if (lang === 'zh' && scheme === 'dark') {
      // ① 点格子：就地播，不进放大层；一次只播一个
      await tap(page, '#pGal [data-gp="0"]'); await sleep(500); s = await st(page);
      ok(s.v.length === 3 && s.open && !s.lb && !s.v[0].paused && !s.v[0].muted && s.v[0].play && s.v[0].badge === '❚❚' && s.v[1].paused && s.v[2].paused, tag + '点第 1 格 → 就在格子里播（有声、写 ❚❚），没进放大层、预览没关', JSON.stringify(s));
      await tap(page, '#pGal [data-gp="1"]'); await sleep(400); s = await st(page);
      ok(s.v.length === 3 && s.v[0].paused && !s.v[1].paused && s.v[2].paused, tag + '再点第 2 格 → 它播、第 1 格停下（一次只播一个）', JSON.stringify(s.v));
      await tap(page, '#pGal [data-gp="1"]'); await sleep(300); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => x.paused) && s.v[1].t > 0.1 && s.v[1].badge === '▶', tag + '再点同一格 → 停下，停在原处', JSON.stringify(s.v));
      // ② ⤢ 才放大；放大时格子里在播的先停
      await tap(page, '#pGal [data-gp="2"]'); await sleep(300); await tap(page, '#pGal .gz[data-gi="0"]'); await sleep(300); s = await st(page);
      ok(s.v.length === 3 && s.lb && s.lbVid && s.v.every((x) => x.paused), tag + '点右上角 ⤢ → 进放大层，格子里在播的那格停下', JSON.stringify(s));
      await page.keyboard.press('Escape'); await sleep(250); s = await st(page);
      ok(s.v.length === 3 && s.open && !s.lb, tag + 'Esc 回到格子墙', JSON.stringify(s));
      // ③ 同时播放：最后指过的那格出声，别的静音
      await over(page, '#pGal [data-gp="1"]'); await tap(page, '#pSync'); await sleep(700); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => !x.paused) && JSON.stringify(loud(s)) === '[1]' && s.v[1].aud && !s.v[0].aud && !s.v[2].aud && s.sync.text === '全部暂停' && s.dir.endsWith('· 鼠标停在哪一格，就听哪一格'),
        tag + '先指第 2 格再点「同时播放」→ 三格都播、只有第 2 格出声（描青线），按钮变「全部暂停」，顶栏写「鼠标停在哪一格，就听哪一格」', JSON.stringify(s));
      ok(s.v.length === 3 && s.v.every((x) => x.t < 1.2), tag + '「同时播放」从头开始（刚才停在半截的那格也回到开头）', JSON.stringify(s.v.map((x) => x.t)));
      await over(page, '#pGal [data-gp="2"]'); await sleep(250); s = await st(page);
      ok(s.v.length === 3 && JSON.stringify(loud(s)) === '[2]' && s.v[2].aud && !s.v[1].aud && s.v.every((x) => !x.paused), tag + '鼠标移到第 3 格 → 换成它出声，别的静音，都接着播', JSON.stringify(s.v));
      await over(page, '#pGal [data-gp="1"]'); await ev(page, () => { const v = document.querySelectorAll('#pGal .ggrid video')[0]; v.currentTime += 1.2; }); await sleep(700); s = await st(page);
      ok(s.v.length === 3 && spread(s) < 0.35, tag + '把第 1 格拉开 1.2 秒 → 一会儿就对回出声那格的时间', JSON.stringify(s.v.map((x) => x.t)));
      // ④ 全部暂停 / 全部继续：不回到开头
      await tap(page, '#pSync'); await sleep(250); const p1 = await st(page);
      ok(p1.v.length === 3 && p1.v.every((x) => x.paused) && p1.sync.text === '全部继续', tag + '点「全部暂停」→ 都停，按钮变「全部继续」', JSON.stringify(p1));
      await tap(page, '#pSync'); await sleep(300); s = await st(page);
      ok(s.v.length === 3 && p1.v.length === 3 && s.v.every((x) => !x.paused) && s.sync.text === '全部暂停' && s.v.every((x, i) => x.t >= p1.v[i].t - 0.05), tag + '点「全部继续」→ 从停下的地方接着播，不回到开头', JSON.stringify([p1.v.map((x) => x.t), s.v.map((x) => x.t)]));
      // ⑤ 联动时点一格 = 全停 / 全播
      await tap(page, '#pGal [data-gp="0"]'); await sleep(250); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => x.paused) && s.sync.text === '全部继续', tag + '联动时点任意一格 → 全停', JSON.stringify(s.v));
      await tap(page, '#pGal [data-gp="0"]'); await sleep(250); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => !x.paused), tag + '再点一下 → 全播', JSON.stringify(s.v));
      await tap(page, '#pSync'); await sleep(200);
      // ⑥ 进度条：点 1/5 处 → 不算点播放；联动时三格一起挪到同一处（点之前三格都在 1.8 秒以后：挪的距离够大，只挪一格时另两格对不上）
      const pre = await st(page);
      const bar = await ev(page, () => { const r = document.querySelectorAll('#pGal .gbar')[1].getBoundingClientRect(); return { x: r.left + r.width / 5, y: r.bottom - 3 }; });
      if (bar.x != null) await page.mouse.click(bar.x, bar.y); await sleep(350); s = await st(page);
      ok(s.v.length === 3 && pre.v.length === 3 && pre.v.every((x) => x.t > 1.8) && s.v.every((x) => x.paused) && s.v.every((x) => Math.abs(x.t - s.v[1].d / 5) < 0.3) && /scaleX\(0\.[12]/.test(s.v[1].bar), tag + '点第 2 格进度条 1/5 处 → 三格都从 1.8 秒以后挪到 1.2 秒附近、照旧停着，进度条画到 1/5', JSON.stringify([pre.v.map((x) => x.t), s.v]));
      // ⑦ 短的先放完，长的接着播；全部放完回到「同时播放」
      await tap(page, '#pSync'); await page.waitForFunction(() => { const v = document.querySelectorAll('#pGal .ggrid video')[2]; return !!v && v.ended; }, null, { timeout: 5000 }).catch(() => {}); s = await st(page);
      ok(s.v.length === 3 && s.v[2].ended && !s.v[0].paused && !s.v[1].paused && s.sync.text === '全部暂停', tag + '4 秒的那格先放完 → 另两格接着播，按钮仍是「全部暂停」', JSON.stringify(s));
      await page.waitForFunction(() => [...document.querySelectorAll('#pGal .ggrid video')].every((v) => v.ended), null, { timeout: 6000 }).catch(() => {}); await sleep(200); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => x.ended) && s.sync.text === '同时播放' && !s.v.some((x) => x.aud) && !s.dir.includes('鼠标'), tag + '全部放完 → 按钮回到「同时播放」，出声的青线和顶栏那句都收起', JSON.stringify(s));
      await tap(page, '#pSync'); await sleep(500); s = await st(page);
      ok(s.v.length === 3 && s.v.every((x) => !x.paused && x.t < 1.2), tag + '再点「同时播放」→ 从头再来', JSON.stringify(s.v));
      await over(page, '#pGal [data-gp="2"]'); await sleep(400);
      await shown(page, '#preview'); await page.screenshot({ path: path.join(OUT, 'galv-zh-dark.png') });
      // ⑧ 关掉预览：全停、拆掉
      await page.keyboard.press('Escape'); await sleep(300);
      const c = await ev(page, () => ({ open: document.querySelector('#preview').open, kids: document.querySelector('#pGal').childElementCount, sync: document.querySelector('#pSync').hidden, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length }));
      ok(!c.open && c.kids === 0 && c.sync && c.playing === 0, tag + 'Esc 关掉预览 → 没有视频在播，格子拆掉，「同时播放」收起', JSON.stringify(c));
      // ⑨ 只有一段视频的图集：没有「同时播放」
      target = G1 + '/'; await openIt(); s = await st(page);
      ok(s.open && s.v.length === 1 && s.sync.hidden, tag + '只有 1 段视频的图集 → 没有「同时播放」', JSON.stringify(s));
      await page.keyboard.press('Escape'); await sleep(250);
    } else {
      // 英文、浅色：按钮的字跟着状态走，出声那格的青线是这个主题的 --accent
      await over(page, '#pGal [data-gp="0"]'); await tap(page, '#pSync'); await sleep(600); s = await st(page);
      const ring = await ev(page, () => { const t = document.querySelector('#pGal .gv.aud .gt'); const p = document.createElement('span'); p.style.color = 'var(--accent)'; document.body.append(p); const a = getComputedStyle(p).color; p.remove(); return { sh: t ? getComputedStyle(t, '::after').boxShadow : '', a }; });
      ok(s.v.length === 3 && s.v.every((x) => !x.paused) && JSON.stringify(loud(s)) === '[0]' && s.sync.text === (lang === 'zh' ? '全部暂停' : 'Pause all') && s.dir.endsWith(lang === 'zh' ? '· 鼠标停在哪一格，就听哪一格' : '· sound follows the pointer'),
        tag + '「同时播放」三格都播、只有指着的那格出声，按钮和顶栏那句是这种语言', JSON.stringify(s));
      ok(ring.sh.includes(ring.a) && /2px/.test(ring.sh), tag + '出声那格描 2px 的青线，颜色是这个主题的 --accent', JSON.stringify(ring));
      await over(page, '#pGal [data-gp="1"]'); await sleep(400);
      await shown(page, '#preview'); await page.screenshot({ path: path.join(OUT, 'galv-' + lang + '-' + scheme + '.png') });
      await page.keyboard.press('Escape'); await sleep(250);
    }
    ok(errs.length === 0, tag + '页面没有报错', errs.join(' | ')); await ctx.close();
  }
}

try {
  if (process.env.UI_ONLY === 'snooze') { await snoozeCheck(); console.log('\n（UI_ONLY=snooze：只跑了「先放着带时间」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'delta') { await deltaCheck(); console.log('\n（UI_ONLY=delta：只跑了「只回变过的」这一段，不是整套）'); throw ONLY_DONE; }
  let ctx, page, errs;                                   // 架构那一段也用这三个；UI_ONLY=org 时它前面的整段不跑，所以提到这里声明
  if (process.env.UI_ONLY !== 'org') {
  if (process.env.UI_ONLY === 'dock') { await dockCheck(); console.log('\n（UI_ONLY=dock：只跑了「弹层里回话」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'galv') { await galVideoCheck(); console.log('\n（UI_ONLY=galv：只跑了「图集 · 视频」这一段，不是整套）'); throw ONLY_DONE; }
  // ── 性能（11/17 win-1f）：作者「窗口多了之后有点卡卡的……新窗口交付完，它弹到上面的时候，动画不是很流畅」。
  // 页面里停掉轮询，拿当前这份数据改一张卡（挪到 sessions 最前、改成等你选 = 排位最前）再 paint()，核：
  // ① 墙上的列不换位（以前那个项目整列跑到最左，WebKit 要把整列拔出来重建，弹到顶那一下停 0.3 秒）；② 从列底下（看不见的地方）升到顶的卡就地浮现，不从两三千像素外飞上来；
  // ③ 看不见的卡不起动画；④ 同样的数据再画一次，卡片、列、分隔条上一个属性都不改（以前每 1.5 秒给每张卡重写 class / 内联样式 / data-back）；
  // ⑤ 墙上的卡 content-visibility:auto（看不见的不排版、不绘制）、封面不加；⑥ 封面里远处的卡站到最前时，从同一侧最外面一格滑进来，不横扫整个屏幕。
  // UI_ONLY=perf 只跑这一段
  if (!process.env.UI_ONLY || process.env.UI_ONLY === 'perf') {
    console.log('\n[性能]');
    const lift = (page, name) => page.evaluate((sid) => {      // 把这张卡改成等你选、挪到最前，重画一次；回：列的先后（前 / 后）、#stage 下增删了几个列、这张卡和墙上卡片正在跑的动画
      clearTimeout(pollT); const st = structuredClone(last), s = st.sessions.find((x) => x.sid === sid);
      st.sessions = [s, ...st.sessions.filter((x) => x !== s)]; s.status = 'waiting';
      const cols = () => [...document.querySelectorAll('#stage > .gcol')].map((c) => c.dataset.key);
      const el = document.querySelector('.card[data-sid="' + sid + '"]'), col0 = cols();
      const gb = el.closest('.gbody'), r0 = el.getBoundingClientRect(), br = (gb || document.querySelector('main')).getBoundingClientRect(), wasOn = r0.bottom > br.top && r0.top < br.bottom;
      const moves = []; const ob = new MutationObserver((ms) => { for (const m of ms) for (const n of [...m.addedNodes, ...m.removedNodes]) if (n.classList && n.classList.contains('gcol')) moves.push(n.dataset.key); });
      ob.observe(document.getElementById('stage'), { childList: true }); paint(st); ob.disconnect();
      const kf = el.getAnimations().map((a) => a.effect.getKeyframes()[0]);
      const run = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('card') && a.playState === 'running');
      const offRun = run.filter((a) => { const t = a.effect.target, g = t.closest('.gbody'); if (!g) return false; const r = t.getBoundingClientRect(), b = g.getBoundingClientRect();
        const k0 = a.effect.getKeyframes()[0].transform || ''; const m = /translate\(([-\d.]+)px, *([-\d.]+)px\)/.exec(k0); const dy = m ? +m[2] : 0;      // 起点（变换前）和终点都在列露出来的那块外面
        return (r.bottom <= b.top || r.top >= b.bottom) && (r.bottom + dy <= b.top || r.top + dy >= b.bottom); });
      const pos = el.closest('.gbody') ? [...el.closest('.gbody').children].indexOf(el) : -1;
      return { col0, col1: cols(), moves, wasOn, pos, kf: kf.map((k) => ({ o: k.opacity, t: k.transform })), run: run.length, offRun: offRun.length };
    }, FX.sids[name]);
    {
      const { ctx, page, errs } = await open({ mode: 'wall' });
      const cv = await page.evaluate(() => [...document.querySelectorAll('#stage .card')].map((c) => getComputedStyle(c).contentVisibility));
      ok(cv.length > 20 && cv.every((x) => x === 'auto'), '性能 · 墙上的卡 content-visibility:auto（列里滚出去的不排版、不绘制、不占图层）', JSON.stringify([...new Set(cv)]));
      const a = await lift(page, 'projC');
      ok(a.col0.join() === a.col1.join() && a.moves.length === 0 && a.pos === 0, '性能 · 总控台那一列的卡升到最前：它在自己那一列顶上，各列不换位置、没有整列从 DOM 里拔出来重插', JSON.stringify(a));
      await sleep(900);
      const tail = await page.evaluate(() => {         // 卡最多那一列的最后一张（在列底下，看不见）
        const g = [...document.querySelectorAll('.gcol')].sort((x, y) => y.querySelectorAll('.card').length - x.querySelectorAll('.card').length)[0];
        const cs = [...g.querySelectorAll('.gbody > .card:not([hidden])')].filter((c) => !c.dataset.sid.includes(':')); return cs[cs.length - 1].dataset.sid; });
      const tname = Object.keys(FX.sids).find((k) => FX.sids[k] === tail);
      const c = tname ? await lift(page, tname) : null;
      ok(!!c && !c.wasOn && c.pos === 0 && c.kf.length === 1 && c.kf[0].o === '0' && !/translate\(/.test(c.kf[0].t || ''), '性能 · 列底下看不见的卡升到顶：就地浮现（从透明、略小变到原样），不从列底下飞上来', JSON.stringify({ tname, ...(c || {}) }));
      ok(!!c && c.offRun === 0 && c.run > 0, '性能 · 换位置前后都在看不见的地方的卡不起动画（看得见的照常滑）', JSON.stringify(c && { run: c.run, offRun: c.offRun }));
      await sleep(900);
      // 「写了一样的值」Chromium 不记 MutationObserver 记录，WebKit（真应用）记、而且照样让样式作废，所以在 API 这一层数：#stage 里每一次 setAttribute / dataset / hidden / 内联样式的写，
      // 和去掉本来就没有的 class。同样的数据再画一次，这些一次都不该有
      const churn = await page.evaluate(() => {
        clearTimeout(pollT); const st = structuredClone(last); paint(st);            // 先画一次，让这份数据成为「上一次」
        const hits = [], on = { v: false }, inSt = (n) => on.v && n && n.closest && !!n.closest('#stage'), d = (n) => n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0];
        const undo = [];
        const patch = (proto, name, make) => { const o = Object.getOwnPropertyDescriptor(proto, name); Object.defineProperty(proto, name, make(o)); undo.push(() => Object.defineProperty(proto, name, o)); };
        patch(Element.prototype, 'setAttribute', (o) => ({ ...o, value: function (a, v) { if (inSt(this)) hits.push('setAttribute:' + d(this) + '@' + a); return o.value.call(this, a, v); } }));
        patch(Element.prototype, 'removeAttribute', (o) => ({ ...o, value: function (a) { if (inSt(this) && this.hasAttribute(a)) hits.push('removeAttribute:' + d(this) + '@' + a); return o.value.call(this, a); } }));
        patch(HTMLElement.prototype, 'hidden', (o) => ({ ...o, set(v) { if (inSt(this)) hits.push('hidden:' + d(this)); return o.set.call(this, v); } }));
        patch(HTMLElement.prototype, 'dataset', (o) => ({ ...o, get() { const ds = o.get.call(this), el = this; return new Proxy(ds, { get: (t, k) => t[k], set: (t, k, v) => { if (inSt(el)) hits.push('dataset:' + d(el) + '@' + String(k)); t[k] = v; return true; }, deleteProperty: (t, k) => { if (inSt(el) && k in t) hits.push('dataset-del:' + d(el) + '@' + String(k)); delete t[k]; return true; } }); } }));
        patch(CSSStyleDeclaration.prototype, 'cssText', (o) => ({ ...o, set(v) { if (on.v) hits.push('cssText'); return o.set.call(this, v); } }));
        patch(DOMTokenList.prototype, 'remove', (o) => ({ ...o, value: function (...t) { if (on.v && t.some((x) => !this.contains(x))) hits.push('classList.remove(没有的):' + t.join()); return o.value.apply(this, t); } }));
        const recs = []; const ob = new MutationObserver((ms) => recs.push(...ms)); ob.observe(document.getElementById('stage'), { subtree: true, attributes: true, childList: true, characterData: true });
        on.v = true; try { paint(structuredClone(st)); } finally { on.v = false; undo.reverse().forEach((f) => f()); }
        ob.disconnect(); recs.push(...ob.takeRecords());
        const dn = (n) => (n.nodeType === 1 ? d(n) : n.nodeName);
        return { hits, muts: recs.map((m) => m.type + ':' + dn(m.target) + (m.attributeName ? '@' + m.attributeName : '')) };
      });
      const tally = (a) => Object.entries(a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).map(([k, n]) => k + ' ×' + n).slice(0, 8).join('  ');
      ok(churn.hits.length === 0 && churn.muts.length === 0, '性能 · 同样的数据再画一次：卡片、列、分隔条上不写任何属性、class、内联样式（以前每 1.5 秒给每张卡重写一遍）', churn.hits.length + ' 次写、' + churn.muts.length + ' 条改动：' + tally(churn.hits) + ' | ' + tally(churn.muts));
      ok(errs.length === 0, '性能 · 墙：页面没报错', errs.join(' | ')); await ctx.close();
    }
    {
      const { ctx, page, errs } = await open({ mode: 'flow' });
      const cvf = await page.evaluate(() => getComputedStyle(document.querySelector('#stage .card')).contentVisibility);
      ok(cvf === 'visible', '性能 · 封面不加 content-visibility（卡片是一张张移进来的，不能让它晚一帧才画出来）', cvf);
      const f = await page.evaluate(() => {
        clearTimeout(pollT); const i0 = order.indexOf(cur);      // 离当前最远的、还不是「新交付」的卡（排位 > 3；已经是交付的再改成等你选不算「新来的」，不会站到最前）
        const far = order.filter((id) => id.indexOf(':') < 0 && cards.get(id).s && cards.get(id).v && cards.get(id).v.rank > 3).sort((a, b) => Math.abs(order.indexOf(b) - i0) - Math.abs(order.indexOf(a) - i0))[0]; if (!far) return { far: null };
        const el = cards.get(far).el, x0 = new DOMMatrix(getComputedStyle(el).transform).m41;
        const st = structuredClone(last), s = st.sessions.find((x) => x.sid === far); st.sessions = [s, ...st.sessions.filter((x) => x !== s)]; s.status = 'waiting';
        navAt = 0; paint(st);
        const start = new DOMMatrix(getComputedStyle(el).transform).m41;           // 过渡刚开始：计算值就是起点
        return { far, cur: cur === far, x0: Math.round(x0), start: Math.round(start), vw: innerWidth };
      });
      ok(f.far && f.cur && Math.abs(f.x0) > f.vw && Math.abs(f.start) < f.vw, '性能 · 封面：远处的卡站到最前时从屏幕边上滑进来（起点在一屏以内），不从几千像素外横扫过来', JSON.stringify(f));
      ok(errs.length === 0, '性能 · 封面：页面没报错', errs.join(' | ')); await ctx.close();
    }
    if (process.env.UI_ONLY === 'perf') { console.log('\n（UI_ONLY=perf：只跑了「性能」这一段，不是整套）'); throw ONLY_DONE; }
  }
  {
    let { ctx, page, errs } = await open({ mode: 'wall' });
    console.log('\n[这一轮改了哪些文件 · 撞车]');
    const ac = await wroteOf(page, 'askCond'), tw = await wroteOf(page, 'tidyWork'), rn = await wroteOf(page, 'run');
    const acw = ac.wrote || { rows: [] };
    ok(acw.first === true && acw.lbl === '这一轮改了 23 个文件 · 另有 3 个没列出' && acw.rows.length === 20, '改了哪些文件 · askCond（待审阅）：正文最上面「这一轮改了 23 个文件 · 另有 3 个没列出」，列 20 行', JSON.stringify(ac.wrote || ac).slice(0, 300));
    ok(!!acw.rows[19] && acw.rows[0].path === '~/code/site/app.js' && /^app\.js .*×3$/.test(acw.rows[0].text) && acw.rows[1].path === '~/code/site/pages/p22.html' && acw.rows[19].path === '~/code/site/pages/p04.html' && !/×/.test(acw.rows[1].text) && acw.rows[0].title === '点开 ~/code/site/app.js',
      '改了哪些文件 · 顺序照服务给的（改了 3 次的 app.js 在最前、写「×3」，其余最近写的在前），改一次的不写次数，悬停写「点开 <路径>」', JSON.stringify(acw.rows.slice(0, 2)));
    ok(visN(acw) === 0 && acw.caret === '▸' && acw.exp === 'false' && acw.deliv === true, '改了哪些文件 · 默认收起：只有「这一轮改了 23 个文件 · 另有 3 个没列出 ▸」一行，一行文件都不露，后面的交付正文在卡内看得见',
      JSON.stringify({ vis: visN(acw), caret: acw.caret, exp: acw.exp, deliv: acw.deliv }));
    await shotOf(page, 'askCond', 'p19-askCond-collapsed.png');
    const moreSel = '.card[data-sid="' + FX.sids.askCond + '"] .wrote [data-act="wmore"]';
    if (await page.$(moreSel)) { await page.click(moreSel); await sleep(1600); }     // 隔一次轮询（1.2 秒）再看：重画也不收回去
    let ac2 = await wroteOf(page, 'askCond');
    ok(!!ac2.wrote && visN(ac2.wrote) === 20 && ac2.wrote.caret === '▾' && ac2.wrote.exp === 'true', '改了哪些文件 · 点那一行 → 20 行都列出来（▾）；隔一次轮询仍展开着', JSON.stringify({ vis: visN(ac2.wrote), caret: ac2.wrote && ac2.wrote.caret, exp: ac2.wrote && ac2.wrote.exp }));
    await shotOf(page, 'askCond', 'p19-askCond-expanded.png');
    if (await page.$(moreSel)) await page.click(moreSel);
    ac2 = await wroteOf(page, 'askCond');
    ok(!!ac2.wrote && visN(ac2.wrote) === 0 && ac2.wrote.caret === '▸' && ac2.wrote.exp === 'false' && ac2.wrote.deliv === true, '改了哪些文件 · 再点那一行 → 收回成一行（▸），交付正文又在卡内看得见',
      JSON.stringify({ vis: visN(ac2.wrote), caret: ac2.wrote && ac2.wrote.caret, deliv: ac2.wrote && ac2.wrote.deliv }));
    if (await page.$(moreSel)) await page.click(moreSel);                                        // 再展开，点「审完了」，再「撤销」
    await page.click('.card[data-sid="' + FX.sids.askCond + '"] [data-act="done"]'); await sleep(400);
    const acDone = await wroteOf(page, 'askCond');
    await page.click('#toast button'); await sleep(400);
    const acBack = await wroteOf(page, 'askCond');
    ok(!!acDone && acDone.wrote === null && !!acBack.wrote && visN(acBack.wrote) === 20 && acBack.wrote.caret === '▾',
      '改了哪些文件 · 展开后点「审完了」→ 列表收走（处理过的卡不列）；提示条上「撤销」→ 列表回来、仍是展开的（按会话 + 那一次交付记，正文重画也不丢）', JSON.stringify({ done: acDone && acDone.wrote, back: acBack.wrote && { vis: visN(acBack.wrote), caret: acBack.wrote.caret } }));
    if (await page.$(moreSel)) await page.click(moreSel);
    const tww = tw.wrote || { rows: [] };
    ok(tww.lbl === '这一轮改了 2 个文件' && tww.rows.map((r) => r.path).join(' ') === '~/code/demo/test/ui-check.mjs ~/code/demo/ui.html' && visN(tww) === 0 && tww.caret === '▸' && tww.deliv === true, '改了哪些文件 · tidyWork：只有 2 个文件也一样默认收起（后写的在前），交付正文看得见', JSON.stringify(tw.wrote));
    const others = { run: rn }; for (const n of ['askQ', 'done', 'peerDone', 'limit']) others[n] = await wroteOf(page, n);
    ok(Object.values(others).every((x) => x && !x.missing && !x.err && x.wrote === null), '改了哪些文件 · 只给待审阅的卡：在跑的 run（这一轮也写了文件）、待跟进、无需处理、停住了的、没写过文件的待审阅 done 都没有这一块',
      JSON.stringify(Object.fromEntries(Object.entries(others).map(([k, v]) => [k, v && (v.missing ? 'missing' : v.err || !!v.wrote)]))));
    // 点一行：和正文里的路径同一条路（先问 /api/preview，预览不了交给 /api/open；⌘ 点直接 /api/open）
    let asked = null, opened = null;
    await page.route('**/api/preview', async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'no-preview', error: 'x' }) }); });
    await page.route('**/api/open', async (route) => { opened = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'open' }) }); });
    const rowSel = '.card[data-sid="' + FX.sids.tidyWork + '"] .wrote li [data-path]', twMore = '.card[data-sid="' + FX.sids.tidyWork + '"] .wrote [data-act="wmore"]';
    if (await page.$(twMore)) await page.click(twMore);                                         // 先点开那一行，文件才露出来
    if (await page.$(rowSel)) { await page.click(rowSel); await sleep(500); }
    ok(!!asked && asked.path === '~/code/demo/test/ui-check.mjs' && !!opened && opened.path === '~/code/demo/test/ui-check.mjs', '改了哪些文件 · 点一行 → 先问 /api/preview（和正文里的路径同一条路），预览不了再交给 /api/open', JSON.stringify({ asked, opened }));
    asked = null; opened = null;
    if (await page.$(rowSel)) { await page.click(rowSel, { modifiers: ['Meta'] }); await sleep(500); }
    ok(!asked && !!opened && opened.path === '~/code/demo/test/ui-check.mjs', '改了哪些文件 · ⌘ 点一行 → 直接 /api/open，不问预览', JSON.stringify({ asked, opened }));
    await page.unroute('**/api/preview'); await page.unroute('**/api/open');
    if (await page.$(twMore)) await page.click(twMore);                                         // 收回去：后面的截图照默认的样子
    const live = await ev(page, ({ tw, rn }) => {   // 在浏览器里改上一份 /api/state、同步重画、量完换回（同一段同步脚本里，轮询插不进来）
      const a = last.sessions.find((x) => x.sid === tw), b = last.sessions.find((x) => x.sid === rn); if (!a || !b) return { missing: true };
      const keep = [a.wrote, a.wroteMore, b.collide];
      a.wrote = [{ path: '~/Projects/app-sandbox/ios/FretFlow/Features/Practice/Views/PracticeView.swift', n: 1 }, { path: '~/x/<img src=x id=pwnw>.md', n: 2 }]; a.wroteMore = 0;
      b.collide = [{ repo: '~/Projects/board-wip/p19-files2-a-very-long-sandbox-name/sub', with: [{ sid: 'nope', name: 'win-5b' }] }];
      paint(last);
      const w = document.querySelector('.card[data-sid="' + tw + '"] .wrote'), cl = document.querySelector('.card[data-sid="' + rn + '"] .clash');
      const r = { rows: w ? [...w.querySelectorAll('li [data-path]')].map((x) => x.dataset.path) : [], pwn: document.querySelectorAll('#pwnw').length, angle: !!w && w.textContent.includes('<img src=x id=pwnw>.md') };
      if (w) { w.classList.add('open'); w.style.width = '220px'; } if (cl) cl.style.width = '220px';
      const cut = (el) => (el ? el.scrollWidth > el.clientWidth + 1 : null);
      Object.assign(r, { wb: cut(w && w.querySelector('li .wb')), wd: cut(w && w.querySelector('li .wd')), cw: cut(cl && cl.querySelector('.cw')), cr: cut(cl && cl.querySelector('.cr')), clash: cl ? cl.textContent.replace(/\s+/g, ' ').trim() : '' });
      if (w) { w.classList.remove('open'); w.style.width = ''; } if (cl) cl.style.width = '';
      [a.wrote, a.wroteMore, b.collide] = keep; paint(last);
      return r;
    }, { tw: FX.sids.tidyWork, rn: FX.sids.run });
    ok(!!live && JSON.stringify(live.rows) === '["~/Projects/app-sandbox/ios/FretFlow/Features/Practice/Views/PracticeView.swift","~/x/<img src=x id=pwnw>.md"]' && live.pwn === 0 && live.angle === true,
      '改了哪些文件 · 服务给的列表变了，下一次画就跟着变；文件名里的尖括号照字显示，不当 HTML', JSON.stringify(live));
    ok(!!live && live.wb === false && live.wd === true && live.cw === false && live.cr === true && /^⇄ 和 win-5b 同时在写 ~\/Projects\/board-wip\//.test(live.clash || ''),
      '窄到 220 px：文件行先截文件夹、文件名留全；撞车那一行先截仓库路径、名字留全', JSON.stringify(live));
    const dlg = await ev(page, () => !!document.querySelector('#detail[open], dialog#detail[open]'));
    ok(dlg === false, '改了哪些文件 · 点一行不会顺带打开放大看', JSON.stringify(dlg));
    // 撞车
    const rc = rn.clash || {}, tc = tw.clash || {};
    ok(rc.shown === true && /^⇄ 和 w-tidyWork 同时在写 ~\/code\/demo$/.test(rc.text) && tc.shown === true && /^⇄ 和 w-run 同时在写 ~\/code\/demo$/.test(tc.text),
      '撞车 · run（在跑）和 tidyWork（待审阅）都在写 ~/code/demo：两张卡各一行「和 <短名> 同时在写 <仓库>」', JSON.stringify({ run: rc.text, tidyWork: tc.text }));
    ok(rc.attn === true && tc.attn === true && rc.oneLine && tc.oneLine && rc.inCard && tc.inCard && rc.title === '和 w-tidyWork 同时在写 ~/code/demo', '撞车 · 那一行是琥珀色（--attn）、只占一行、不出卡，悬停写全', JSON.stringify({ rc, tc }));
    const noClash = {}; for (const n of ['askCond', 'done', 'limit', 'askQ', 'bg']) noClash[n] = ((await wroteOf(page, n)).clash || {}).shown;
    ok(Object.values(noClash).every((x) => x === false), '撞车 · 没撞的卡（askCond 只有它一个在写 ~/code/site；其余没写过文件）不显示这一行', JSON.stringify(noClash));
    const cf = await ev(page, () => {
      const S = new Map([['a', { sid: 'a', regName: 'FretFlow 总指挥 · Fable（win-a5）', title: '总指挥' }], ['b', { sid: 'b', regName: 'win-89', title: 'x' }]]);
      const f = (collide) => { const r = clashOf({ collide }, S); return r && [r.line, r.repo, r.more]; };
      const two = clashOf({ collide: [{ repo: '~/P/x', with: [{ sid: 'b' }] }, { repo: '~/P/y', with: [{ sid: 'a' }] }] }, S);
      return { one: f([{ repo: '~/Projects/app', with: [{ sid: 'a', name: '总指挥' }] }]), two: f([{ repo: '~/P/x', with: [{ sid: 'a' }, { sid: 'b' }] }]),
        three: f([{ repo: '~/P/x', with: [{ sid: 'a' }, { sid: 'b' }, { sid: 'gone1', name: '刚归档的窗口' }] }]), gone: f([{ repo: '~/P/x', with: [{ sid: 'zz', name: '<b>不在这一份里</b>' }] }]),
        repos: two && [two.line, two.repo, two.more, two.title],
        bad: [null, [], 'x', [{ repo: 1, with: [{ sid: 'a' }] }], [{ repo: '~/x', with: [] }], [{ repo: '~/x', with: 'a' }], [{ repo: '~/x', with: [{ name: '没有 sid' }] }]].map(f) };
    });
    ok(JSON.stringify([cf.one, cf.two, cf.three]) === '[["和 win-a5 同时在写","~/Projects/app",""],["和 win-a5、win-89 同时在写","~/P/x",""],["和 win-a5 等 3 个窗口同时在写","~/P/x",""]]',
      '撞车 · 称呼用短名（登记名末尾括号里的 win-a5，和架构视图同一个 shortName）；两个用「、」连，三个以上写「等 N 个窗口」', JSON.stringify(cf));
    ok(JSON.stringify(cf.gone) === '["和 <b>不在这一份里</b> 同时在写","~/P/x",""]' && JSON.stringify(cf.repos) === '["和 win-89 同时在写","~/P/x","等 2 个仓库","和 win-89 同时在写 ~/P/x\\n和 win-a5 同时在写 ~/P/y"]' && Array.isArray(cf.bad) && cf.bad.every((x) => x === null),
      '撞车 · 这一份里认不出的窗口用服务给的标题；撞了两个仓库写第一个加「等 2 个仓库」，悬停里两个都列；坏数据（不是数组、没有 repo / with / sid）一律不显示', JSON.stringify(cf));
    const inj = await ev(page, (sid) => { const s = JSON.parse(JSON.stringify(last.sessions.find((x) => x.sid === sid))); s.collide = [{ repo: '~/x"><img src=x onerror=alert(1)>', with: [{ sid: 'nope', name: '<img src=x>' }] }];   // 名字 20 字以内（再长会被 cut() 截断）
      const box = document.createElement('p'); paintClash(box, s, new Map()); return { imgs: box.querySelectorAll('img').length, text: box.textContent.replace(/\s+/g, ' ').trim() }; }, FX.sids.done);
    ok(inj && inj.imgs === 0 && inj.text === '⇄ 和 <img src=x> 同时在写 ~/x"><img src=x onerror=alert(1)>', '撞车 · 标题和仓库路径里的尖括号照字显示，不当 HTML', JSON.stringify(inj));
    const clSel = '.card[data-sid="' + FX.sids.run + '"] .clash .cr';
    if (await page.$(clSel)) { await page.dblclick(clSel); await sleep(400); }                    // 没有这一行（旧界面）时记一条红，不让整段等 30 秒后崩掉
    const zoomed = await ev(page, () => !!document.querySelector('#detail[open]'));
    await page.keyboard.press('Escape'); await sleep(300);
    ok(zoomed === true, '撞车 · 双击那一行和双击封面别处一样放大看', JSON.stringify(zoomed));
    await shotOf(page, 'tidyWork', 'p19-tidyWork-dark.png'); await shotOf(page, 'run', 'p19-run-dark.png');
    await page.screenshot({ path: path.join(OUT, 'p19-wall-dark.png') });
    ok(errs.length === 0, '改了哪些文件 · 撞车：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {   // 封面：同一张卡上也有
    let { ctx, page, errs } = await open({ mode: 'flow' });
    const fl = await wroteOf(page, 'tidyWork');
    ok(!!fl.clash && /和 w-run 同时在写 ~\/code\/demo$/.test(fl.clash.text) && (await ev(page, (sid) => document.querySelector('.card[data-sid="' + sid + '"] .clash').hidden, FX.sids.tidyWork)) === false && !!fl.wrote && fl.wrote.rows.length === 2,
      '封面：同一张卡上也有撞车那一行和文件列表', JSON.stringify(fl).slice(0, 300));
    ok(errs.length === 0, '封面（改了哪些文件 · 撞车）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {   // 英文
    let { ctx, page, errs } = await open({ mode: 'wall', lang: 'en' });
    const ea = await wroteOf(page, 'askCond'), et = await wroteOf(page, 'tidyWork'), er = await wroteOf(page, 'run');
    ok(!!ea.wrote && ea.wrote.lbl === 'Changed 23 files this turn · 3 more not listed' && ea.wrote.caret === '▸' && !!et.wrote && et.wrote.lbl === 'Changed 2 files this turn' && /^Open ~\/code\/demo\//.test((et.wrote.rows[0] || {}).title || ''),
      'en 改了哪些文件：那一行和悬停是英文', JSON.stringify([ea.wrote && [ea.wrote.lbl, ea.wrote.caret], et.wrote && [et.wrote.lbl, (et.wrote.rows[0] || {}).title]]));
    const moreSel = '.card[data-sid="' + FX.sids.askCond + '"] .wrote [data-act="wmore"]';
    if (await page.$(moreSel)) await page.click(moreSel);
    const ea2 = await wroteOf(page, 'askCond');
    ok(!!ea2.wrote && ea2.wrote.caret === '▾' && visN(ea2.wrote) === 20, 'en 改了哪些文件：点开以后 20 行都列出来', JSON.stringify(ea2.wrote && [ea2.wrote.caret, visN(ea2.wrote)]));
    ok(/^⇄ w-tidyWork is also writing ~\/code\/demo$/.test((er.clash || {}).text || '') && /^⇄ w-run is also writing ~\/code\/demo$/.test((et.clash || {}).text || '') && (et.clash || {}).title === 'w-run is also writing ~/code/demo',
      'en 撞车：「<短名> is also writing <仓库>」，悬停也是英文', JSON.stringify([er.clash, et.clash]));
    const tr = await ev(page, () => {
      const S = new Map([['a', { sid: 'a', regName: 'FretFlow 总指挥 · Fable（win-a5）' }], ['b', { sid: 'b', regName: 'win-89' }]]);
      const c = (w, n = 1) => clashOf({ collide: Array.from({ length: n }, (_, i) => ({ repo: '~/P/' + i, with: w })) }, S);
      const box = document.createElement('p'); paintClash(box, { collide: [{ repo: '~/P/0', with: [{ sid: 'z', name: 'pay $& me' }] }] }, S);
      return [c([{ sid: 'a' }, { sid: 'b' }]).line, c([{ sid: 'a' }, { sid: 'b' }, { sid: 'z', name: 'n' }]).line, c([{ sid: 'z', name: '界面、识谱两条线' }]).line,
        c([{ sid: 'a' }], 2).more, c([{ sid: 'a' }], 3).more, box.textContent.replace(/\s+/g, ' ').trim(), T('这一轮改了 1 个文件')];
    });
    ok(JSON.stringify(tr) === JSON.stringify(['win-a5 and win-89 are also writing', 'win-a5 and 2 others are also writing', '界面、识谱两条线 is also writing', 'and 1 more repo', 'and 2 more repos', '⇄ pay $& me is also writing ~/P/0', 'Changed 1 file this turn']),
      'en 撞车：两个、三个以上、几个仓库的英文；名字带「、」「$&」也照原样（英文在 clashOf 里直接拼，不走正则规则）', JSON.stringify(tr));
    const zh = await ev(page, () => { const els = [...document.querySelectorAll('.clash:not([hidden]), .wrote')]; return { n: els.length, bad: els.map((x) => x.textContent + ' ' + (x.title || '') + ' ' + [...x.querySelectorAll('[title]')].map((y) => y.title).join(' ')).filter((t) => /[一-鿿]/.test(t)).map((t) => t.slice(0, 60)) }; });
    ok(zh && zh.n >= 4 && Array.isArray(zh.bad) && zh.bad.length === 0, 'en：撞车那一行、文件列表（含悬停）没有漏翻的中文', JSON.stringify(zh));
    await shotOf(page, 'tidyWork', 'p19-tidyWork-en.png'); await shotOf(page, 'askCond', 'p19-askCond-en-expanded.png');
    ok(errs.length === 0, 'en 改了哪些文件 · 撞车：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {   // 窄一点的窗口（卡更窄）和浅色：撞车那一行照样一行、不出卡
    let { ctx, page, errs } = await open({ mode: 'wall', w: 1100, h: 800 });
    const nr = await wroteOf(page, 'run'), nt = await wroteOf(page, 'tidyWork');
    ok(!!nr.clash && !!nt.clash && nr.clash.shown && nt.clash.shown && nr.clash.oneLine && nt.clash.oneLine && nr.clash.inCard && nt.clash.inCard, '1100 px：撞车那一行照样一行、不出卡（放不下截省略号）', JSON.stringify([nr.clash, nt.clash]));
    await shotOf(page, 'tidyWork', 'p19-tidyWork-1100.png');
    ok(errs.length === 0, '1100 px（改了哪些文件 · 撞车）：页面没有报错', errs.join(' | ')); await ctx.close();
    ({ ctx, page, errs } = await open({ mode: 'wall', scheme: 'light' }));
    await shotOf(page, 'tidyWork', 'p19-tidyWork-light.png'); await shotOf(page, 'askCond', 'p19-askCond-light.png');
    ok(errs.length === 0, '浅色（改了哪些文件 · 撞车）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  if (process.env.UI_ONLY === 'wrote') { console.log('\n（UI_ONLY=wrote：只跑了「这一轮改了哪些文件 · 撞车」这一段，不是整套）'); throw ONLY_DONE; }

  // ── 墙视图（中文，深色）──
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
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
  const ch = await chipsOf(page);
  ok(ch.done && ch.done.shown && ch.done.text === 'Fable 5.2 · max' && ch.limit.text === 'Opus 5.5 · xhigh' && ch.auth.text === 'Sonnet 4.5', '模型胶囊：done「Fable 5.2 · max」（取最近一条真回复：不是前面那条 opus，也不是子 agent 的 haiku）、limit「Opus 5.5 · xhigh」（后面的额度报错不盖掉它）、auth「Sonnet 4.5」（老模型没有强度）', JSON.stringify([ch.done && ch.done.text, ch.limit && ch.limit.text, ch.auth && ch.auth.text]));
  ok(ch.err && !ch.err.shown && !ch.gone, '模型胶囊：一条真回复都没有的（err）不画；进程退出的卡（gone）用自己的模板，没有胶囊', JSON.stringify([ch.err && ch.err.shown, !!ch.gone]));
  ok(['done', 'limit', 'auth'].every((n) => ch[n].h === 22 && ch[n].belowHead && ch[n].inside && ch[n].edge >= 8 && ch[n].edge <= 12 && ch[n].clear), '模型胶囊：挂在卡头下沿（不在头行里，头行不会因它换行）、右边缘离卡边 10 px 和按钮对齐、高 22、标题右边给它让出了位置（待审阅那张头行本来就满）', JSON.stringify(['done', 'limit', 'auth'].map((n) => ch[n])));
  ok(['done', 'limit', 'auth', 'unfin'].every((n) => ch[n] && ch[n].shown && !ch[n].trunc) && ch.unfin.seen === 'Sonnet · medium', '模型胶囊：窄卡里最长的真实组合 Sonnet · medium（15 个字符）和 Opus · xhigh 都完整显示，不被截成省略号（线上第一天 Sonnet · xhigh 被截成 Sonnet · xhi…，强度是要看的那个字）', JSON.stringify(['done', 'limit', 'auth', 'unfin'].map((n) => ch[n] && [ch[n].seen, ch[n].trunc, ch[n].w])));
  ok(ch.done.seen === 'Fable · max' && ch.done.ver === false, '模型胶囊：墙上的窄卡（< 540 px）不写版本号：Fable · max，版本在 title 里', ch.done.seen + ' ver=' + ch.done.ver);
  ok(/claude-fable-5-2/.test(ch.done.title) && /max/.test(ch.done.title) && /最近一条回复用的/.test(ch.done.title) && !/强度/.test(ch.auth.title), '模型胶囊：鼠标停上去写完整模型 id 和强度，说明是最近一条回复用的；没有强度就不写「强度」', ch.done.title + ' | ' + ch.auth.title);
  ok(c.gone.btns.join() === '接回来,看对话,知道了' && /进程退出了/.test(c.gone.why), 'gone：有「接回来 / 看对话 / 知道了」');
  const nStop = Object.values(c).filter((v) => /alert/.test(v.cls)).length, nBusy = Object.values(c).filter((v) => /s-busy|(^| )bg( |$)/.test(v.cls)).length;
  ok(s.segs.includes('停住了' + nStop) && nStop === 9, '顶栏「停住了 9」', s.segs.join('|') + ' nStop=' + nStop);
  ok(s.segs.includes('运行中' + nBusy) && nBusy === 6, '顶栏「运行中 6」（4 个在做 + 2 个后台在跑）', s.segs.join('|') + ' nBusy=' + nBusy);
  const nTodo = nStop + Object.values(c).filter((v) => /s-review|s-reply/.test(v.cls)).length;
  ok(new RegExp('^\\(' + nTodo + '\\) ').test(s.title) && nTodo > nStop, '标题和 Dock 角标的数 = 待跟进 + 待审阅 + 停住了', s.title + ' nTodo=' + nTodo);
  const alertIdx = Object.values(c).filter((v) => /alert/.test(v.cls)).map((v) => v.idx), otherIdx = Object.values(c).filter((v) => !/alert/.test(v.cls)).map((v) => v.idx);
  ok(Math.max(...alertIdx) < Math.min(...otherIdx), '停住了的排在最前面');
  await page.screenshot({ path: path.join(OUT, 'wall-dark.png') });
  // 按项目分组（11/12 作者 16:06：「不要混起来」；16:4x：按行分会把后面的项目挤出屏幕，「改成竖着的，三个任务就是三列」）
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
  ok(n0 === 6, '墙：一屏照样按 4 × 2 的格子放卡（17:3x 作者：「还是只有 4 个，效率很低」）：其他 23 张占 2 格宽，另两个项目各 1 格，露出 6 张', 'seen=' + n0);
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
  // 收起一列（11/12 作者：「我不学的时候就可以把它折叠起来」）
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
  // 按状态分列（11/15 作者：「再学 Raft 的看板，加按状态分列」）：一列一种状态，顺序 = 排位；卡上改写项目名；记在本机，重开还在
  const lanesOf = () => page.evaluate(() => [...document.querySelectorAll('#stage > .gcol')].map((col) => ({
    head: (col.querySelector('.ghead').firstChild || {}).textContent || '',
    cards: [...col.querySelectorAll('.card:not([hidden])')].map((c) => ({ cls: c.className, proj: getComputedStyle(c.querySelector('.chead .proj') || c).display === 'none' ? '' : ((c.querySelector('.chead .proj') || {}).textContent || ''), title: (c.querySelector('.title') || {}).textContent })) })));
  await page.click('#by [data-by="status"]'); await sleep(900);
  const ln = await lanesOf(); const heads = ln.map((x) => x.head.trim());
  const ORDER = ['要你处理', '待审阅', '运行中', '无需处理'], rank = heads.map((h) => ORDER.indexOf(h));
  ok(heads.length >= 3 && rank.every((r, i) => r >= 0 && (i === 0 || r > rank[i - 1])) && heads[0] === '要你处理' && heads.includes('待审阅'), '按状态：一列一种状态，顺序是 要你处理 → 待审阅 → 运行中 → 无需处理', JSON.stringify(heads));
  const fits = { '要你处理': (c) => /\balert\b|s-reply|s-ask/.test(c), '待审阅': (c) => /s-review/.test(c), '运行中': (c) => /s-busy|\bbg\b/.test(c) && !/\balert\b/.test(c), '无需处理': (c) => !/\balert\b|s-reply|s-ask|s-review|s-busy|\bbg\b/.test(c) };
  const wrong = ln.flatMap((x) => x.cards.filter((c) => fits[x.head.trim()] && !fits[x.head.trim()](c.cls)).map((c) => x.head + '/' + c.title + ':' + c.cls));
  ok(wrong.length === 0 && ln.every((x) => x.cards.length > 0), '按状态：每张卡都在它状态的那一列', JSON.stringify(wrong.slice(0, 4)));
  const pf = ln.flatMap((x) => x.cards).find((c) => c.title === 'w-projF');
  ok(pf && pf.proj === 'FretFlow' && !ln.flatMap((x) => x.cards).some((c) => ORDER.includes(c.proj)), '按状态：卡上写它属于哪个项目（不是列名）', JSON.stringify(pf));
  await page.reload(); await page.waitForSelector('.card'); await sleep(1200);
  // store() 存的是 JSON（"status" 带引号），读出来先解析再比
  const kept = await page.evaluate(() => ({ by: JSON.parse(localStorage.getItem('ccb_by') || 'null'), pressed: document.querySelector('#by [data-by="status"]').getAttribute('aria-pressed'), head: (document.querySelector('#stage > .gcol .ghead').firstChild || {}).textContent }));
  ok(kept.by === 'status' && kept.pressed === 'true' && /要你处理/.test(kept.head || ''), '按状态：重开总控台还是按状态', JSON.stringify(kept));
  // 11/16：上面那条只查了存的值、按钮和列头，卡上的项目名没查。启动时 setMode() 把 body 的 class 整个重写，bystatus 被冲掉，项目名就不显示了
  const keptPf = (await lanesOf()).flatMap((x) => x.cards).find((c) => c.title === 'w-projF'), keptBody = await page.evaluate(() => document.body.className);
  ok(keptPf && keptPf.proj === 'FretFlow' && /\bbystatus\b/.test(keptBody), '按状态：重开以后卡上还写着它属于哪个项目', JSON.stringify({ pf: keptPf, body: keptBody }));
  await page.click('#by [data-by="project"]'); await sleep(900);
  const back = await lanesOf();
  ok(back.some((x) => /FretFlow/.test(x.head)) && !back.some((x) => ORDER.includes(x.head.trim())) && back.flatMap((x) => x.cards).every((c) => c.proj === ''), '切回按项目：列是项目，卡上不写项目名', JSON.stringify(back.map((x) => x.head)));
  // 点开、点正文都不算处理过；只有「审完了 / 先放着」或回它话才算（作者 11/12：看了不等于处理了）
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
  const procReq = []; const onProc = (r) => { if (r.method() === 'POST' && r.url().includes('/api/processed')) { try { procReq.push(JSON.parse(r.postData() || '{}')); } catch (e) {} } }; page.on('request', onProc);   // 自动收工靠界面把「审完了」告诉服务
  await page.click(`.card[data-sid="${FX.sids.done}"] [data-act="done"]`); await sleep(400); s = await cardsOf(page);
  ok(/^处理过 · /.test(s.cards.done.meta) && /s-handled/.test(s.cards.done.cls) && s.segs.includes('待审阅' + (nReview0 - 1)), '点「审完了」→「处理过」，顶栏的待审阅少一个', s.cards.done.meta + ' / ' + s.segs.join('|'));
  ok(procReq.length === 1 && typeof procReq[0].map[FX.sids.done] === 'string' && procReq[0].clear.length === 0, '点「审完了」→ 同时告诉服务（POST /api/processed，带这一次交付的时间）', JSON.stringify(procReq));
  await page.click('#toast button'); await sleep(400); s = await cardsOf(page);
  ok(/^待审阅 · /.test(s.cards.done.meta) && s.segs.includes('待审阅' + nReview0), '提示条上点「撤销」→ 回到「待审阅」', s.cards.done.meta + ' / ' + s.segs.join('|'));
  page.off('request', onProc);
  ok(procReq.length === 2 && procReq[1].clear.length === 1 && procReq[1].clear[0] === FX.sids.done && Object.keys(procReq[1].map).length === 0, '点「撤销」→ 也告诉服务（clear 里是这个会话），自动收工不再认它', JSON.stringify(procReq[1]));
  const ctxS = await browser.newContext({ viewport: { width: 1200, height: 800 } }); const pgS = await ctxS.newPage(); const loadSync = [];      // 页面一载入：把已经点过的全发一遍（服务重启后靠它恢复）
  pgS.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/processed')) loadSync.push(r.postData()); });
  await pgS.goto(FX.url + '&lang=zh'); await pgS.waitForSelector('.card'); await sleep(2600); await ctxS.close();
  ok(loadSync.length === 1 && /"map":\{/.test(loadSync[0]), '页面载入、第一次轮询成功之后：把已点过的「审完了」发给服务，只发这一次', JSON.stringify(loadSync));
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

  // ── 按状态时换视图再回墙（11/16）：换视图会重写 body 的 class，bystatus 要跟着 groupBy 补回去。单开一页，不打扰上面那一页后面的断言 ──
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  await page.click('#by [data-by="status"]'); await sleep(900);
  const projOnCard = () => page.evaluate(() => { const el = [...document.querySelectorAll('.card')].find((c) => (c.querySelector('.title') || {}).textContent === 'w-projF'), pj = el && el.querySelector('.chead .proj');
    return { body: document.body.className, shown: !!pj && getComputedStyle(pj).display !== 'none', text: pj ? pj.textContent : null, head: ((document.querySelector('#stage > .gcol .ghead') || {}).firstChild || {}).textContent || '' }; });
  for (const [via, word] of [['flow', '封面'], ['org', '架构']]) {
    await page.click('#modes [data-mode="' + via + '"]'); await sleep(900);
    await page.click('#modes [data-mode="wall"]'); await sleep(1300);
    const r = await projOnCard();
    ok(r.shown && r.text === 'FretFlow' && /\bbystatus\b/.test(r.body) && /要你处理/.test(r.head), '按状态：切去' + word + '再回墙，还是按状态，卡上还写着项目', JSON.stringify(r));
  }
  ok(errs.length === 0, '按状态换视图：页面没有报错', errs.join(' | ')); await ctx.close();

  // ── 封面视图（中文，深色 + 浅色）──
  ({ ctx, page, errs } = await open({ mode: 'flow' })); s = await cardsOf(page);
  const chW = await chipsOf(page);
  ok(chW.limit.shown && chW.limit.ver === true && chW.limit.seen === 'Opus 5.5 · xhigh' && chW.limit.belowHead && chW.limit.edge >= 14 && chW.limit.edge <= 18 && chW.limit.clear, '模型胶囊：封面里的宽卡写全：Opus 5.5 · xhigh，右边缘和卡头按钮对齐（16 px），标题给它让出了位置', JSON.stringify(chW.limit));
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
  // 「去终端」是右上角一直在的按钮，点一下就发 /api/focus（拦在浏览器里，不真的去切终端）；菜单里不再有它（作者 11/13）
  let focused = null; await page.route('**/api/focus', async (route) => { focused = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
  await page.evaluate((sid) => go(sid, true), FX.sids.done); await sleep(900);      // 最前面那张是「进程退出」的卡，它没有终端可去；先翻到一张普通的
  const fsid = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'); const b = f && f.querySelector('.chead [data-act="focus"]'); if (!b) return null; b.click(); return f.dataset.sid; }); await sleep(400);
  ok(fsid && focused && focused.sid === fsid, '封面：右上角「去终端」一点就让服务去切到它的终端', JSON.stringify({ fsid, focused }));
  const ab = await page.evaluate(() => { const f = document.querySelector('.card:not(.side)'); return { arch: !!f.querySelector('.chead [data-act="archive"]'), menu: !!document.querySelector('.card [data-act="menu"]') }; });
  ok(ab.arch && !ab.menu, '封面：右上角是「归档」按钮，没有「⋯」菜单了（11/13 作者：「直接点一个归档」）', JSON.stringify(ab));
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
  ok(/^Running · /.test(s.cards.run.meta) && s.cards.limit.meta === 'Stopped · out of quota' && s.cards.flag.meta === 'Stopped · safety block' && s.cards.flag.head === "Blocked by the model's safeguards, so it stopped here." && s.cards.gone.meta === 'Stopped · process exited' && /^Running · no activity for \d+ min$/.test(s.cards.stall.meta), '英文：右上角的标志是英文', s.cards.run.meta + ' | ' + s.cards.limit.meta + ' | ' + s.cards.stall.meta);
  const zh = await page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('.meta,.why,.next,.lbl,.body button,.chead .done,#filters button,.pager,.reply textarea,.ghead')) { const t = (el.textContent || '') + ' ' + (el.getAttribute('placeholder') || ''); if (/[一-鿿]/.test(t)) bad.push(t.trim().slice(0, 40)); } return bad; });
  ok(zh.length === 0, '英文：标志、原因、按钮、顶栏里没有漏翻的中文', zh.join(' | '));
  const chE = await chipsOf(page);
  ok(chE.done.text === 'Fable 5.2 · max' && chE.done.title === 'Model claude-fable-5-2 · Effort max — used by its latest reply' && chE.auth.title === 'Model claude-sonnet-4-5-20250929 — used by its latest reply' && !/[一-鿿]/.test(Object.values(chE).map((x) => x.title).join('')), '英文：模型胶囊的 title 是英文（Model … · Effort … — used by its latest reply）', chE.done.title + ' | ' + chE.auth.title);
  // 归档提示和归档列表里服务给的原因（11/15 win-be 报：「改过 1 次文件」原样露出来）：照服务真实会拼出的几种句子逐句翻
  const whyEn = await page.evaluate(() => [
    T('已归档「Crash on launch」：改过 1 次文件，能接回来'), T('已归档「x」：用了 12 次工具，能接回来'), T('删了「x」：一句话都没说过（对话在暂存处放 30 天）'),
    T('已归档「x」：无需处理的交付，25 小时没人理它，改过 3 次文件，能接回来'), T('删了「x」：待审阅的交付，30 分钟没点「审完了」，只聊了几句，没改过文件（对话在暂存处放 30 天）'),
    trWhy('你点过「审完了」，它在等你决定'), trWhy('无需处理的交付，几十秒没人理它，用了 2 次工具'), T('要你：'), trWhy('无需处理的交付，5 小时没人理它，看过没有要你定的事，改过 3 次文件')]);
  const whyZh = whyEn.filter((x) => /[一-鿿]/.test(x));
  ok(whyZh.length === 0 && whyEn[0] === 'Archived “Crash on launch”: file edits: 1 — can be resumed' && whyEn[4].includes('only a short chat, no files changed') && whyEn[8].includes('nothing left for you to decide'), '英文：归档提示和归档列表里服务给的原因（带数字、几段连着的，含 smart 线的「看过没有要你定的事」）都翻了', JSON.stringify(whyEn));
  await page.screenshot({ path: path.join(OUT, 'wall-dark-en.png') }); await ctx.close();
  ({ ctx, page, errs } = await open({ mode: 'wall', w: 390, h: 844 }));
  const nar = await page.evaluate(() => { const cols = [...document.querySelectorAll('.gcol')].map((c) => c.getBoundingClientRect()); return { sw: document.documentElement.scrollWidth, n: cols.length, stacked: cols.every((r, i) => i === 0 || r.top > cols[i - 1].top), ch: Math.round(document.querySelector('.gbody > .card:not([hidden])').getBoundingClientRect().height) }; });
  ok(nar.sw <= 390 && nar.n === 3 && nar.stacked && nar.ch >= 340, '手机宽度：三列叠成一列往下排，不横向溢出，卡片至少 340px 高', JSON.stringify(nar));
  await page.screenshot({ path: path.join(OUT, 'wall-phone-groups.png') }); ok(errs.length === 0, '手机宽度：页面没有报错', errs.join(' | '));
  ok(await page.evaluate(() => [...document.querySelectorAll('.gsplit')].every((s) => getComputedStyle(s).display === 'none')), '手机宽度：没有分隔条（各列叠着排，不分格子）'); await ctx.close();

  // 列宽（11/15 作者：「FretFlow 是我主要的开发，窗口小的时候会被缩到一列，我希望它能占两列」「模仿苹果的窗口管理，可以左右滑动」）
  // 拖两列之间的分隔条：两列跟着手走，松手吸附到整格并记住；窗口变窄时记住格数的列先拿格子，放不下的挤成窄条；双击 / Enter 恢复自动
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  const colsNow = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#stage > .gcol')].map((c) => [c.dataset.key, {
    span: +c.dataset.span, sq: c.classList.contains('squeezed'), fold: c.classList.contains('folded') && !c.classList.contains('squeezed'), w: Math.round(c.getBoundingClientRect().width),
    k: c.querySelector('.gbody').style.getPropertyValue('--k'), peek: c.dataset.peek || '' }])));
  const splits = () => page.evaluate(() => [...document.querySelectorAll('.gsplit')].map((s) => ({ a: s.dataset.a, b: s.dataset.b, role: s.getAttribute('role'), shown: getComputedStyle(s).display !== 'none' })));
  const saved = () => page.evaluate(() => ({ span: JSON.parse(localStorage.getItem('ccb_span') || 'null'), fold: JSON.parse(localStorage.getItem('ccb_fold') || 'null') }));
  const unit = (a, b) => page.evaluate(([a, b]) => { const A = document.querySelector('.gcol[data-key="' + a + '"]'), B = document.querySelector('.gcol[data-key="' + b + '"]');
    return (A.getBoundingClientRect().width + B.getBoundingClientRect().width) / (+A.dataset.span + +B.dataset.span); }, [a, b]);
  // 按住分隔条横着拖 dx 像素（分 10 步，像手在拖），mid 在松手前调用一次，量拖的过程
  const dragBy = async (sp, dx, mid) => {
    const box = await page.locator('.gsplit[data-a="' + sp.a + '"][data-b="' + sp.b + '"]').boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(x + dx * i / 10, y); await sleep(16); }
    await sleep(120); const m = mid ? await mid() : null; await page.mouse.up(); await sleep(900); return m;
  };
  const c0 = await colsNow(), s0 = await splits();
  ok(s0.length === 2 && s0.every((x) => x.role === 'separator' && x.shown) && c0.other && c0.other.span === 2 && c0.fretflow.span === 1 && c0.ccboard.span === 1,
    '列宽：三列展开时相邻两列之间各有一根分隔条（role=separator）；没拖过时格子和以前一样分（其他 2 格，另两列各 1）', JSON.stringify({ s0, c0 }));
  const spF = s0.find((x) => x.a === 'fretflow' || x.b === 'fretflow'), dir = spF.a === 'fretflow' ? 1 : -1, nb = spF.a === 'fretflow' ? spF.b : spF.a;
  const u0 = await unit(spF.a, spF.b);
  const mid = await dragBy(spF, dir * u0 * 0.8, () => page.evaluate(() => ({ resizing: document.body.classList.contains('resizing'), guide: !!document.querySelector('.gsnap:not([hidden])'),
    fw: Math.round(document.querySelector('.gcol[data-key="fretflow"]').getBoundingClientRect().width), saved: localStorage.getItem('ccb_span') })));
  ok(mid.resizing && mid.guide && mid.fw > c0.fretflow.w + u0 * 0.6 && mid.saved === null, '列宽：拖的时候 FretFlow 那列跟着手变宽，标出松手会吸附到哪；还没松手就不记', JSON.stringify({ ...mid, before: c0.fretflow.w, u: Math.round(u0) }));
  const c1 = await colsNow(), sv1 = await saved();
  const font = () => page.evaluate((sids) => Object.fromEntries(['projF', 'projC'].map((n) => { const el = document.querySelector('.card[data-sid="' + sids[n] + '"]');
    return [n, { w: Math.round(el.getBoundingClientRect().width), title: getComputedStyle(el.querySelector('.title')).fontSize }]; })), FX.sids);
  const f1 = await font();
  ok(c1.fretflow.span === 2 && c1.other.span === 1 && c1.ccboard.span === 1 && JSON.stringify(sv1.span) === '[["fretflow",2]]' && !(await page.evaluate(() => document.body.classList.contains('resizing'))),
    '列宽：拖过 0.8 格松手，吸附到整格：FretFlow 2 格；已经只有 1 格的列不动，由还有余量的「其他」让出 1 格（推开）；拖宽的那列记在本机', JSON.stringify({ nb, c1, saved: sv1.span }));
  ok(f1.projF.w > f1.projC.w * 1.8 && f1.projF.title === '19px' && f1.projC.title === '16px', '列宽：FretFlow 只有一张卡，它占满两格宽；宽卡的标题大一号（按卡自己的宽度排字，不按窗口）', JSON.stringify(f1));
  await page.screenshot({ path: path.join(OUT, 'wall-span-wide.png') });
  await page.reload(); await page.waitForSelector('.card'); await sleep(2200);
  ok((await colsNow()).fretflow.span === 2, '列宽：重开总控台，FretFlow 还是 2 格');
  // 窗口变窄（横向只剩 2 格）：以前三列放不下会把卡少的项目并进「其他」，现在记了 2 格的 FretFlow 占满，另两列挤成窄条
  await page.setViewportSize({ width: 1000, height: 900 }); await sleep(1200);
  const c2 = await colsNow(), g2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, splits: document.querySelectorAll('.gsplit').length }));
  ok(c2.fretflow.span === 2 && !c2.fretflow.sq && c2.other.sq && c2.ccboard.sq && c2.other.peek === 'other' && c2.other.w <= 50 && g2.sw <= g2.vw && g2.splits === 0,
    '列宽：窗口窄到只剩 2 格时，FretFlow 照样占 2 格；放不下的两列挤成窄条（不并进「其他」，不横向溢出）', JSON.stringify({ c2, g2 }));
  await page.screenshot({ path: path.join(OUT, 'wall-span-narrow.png') });
  await page.evaluate(() => { const q = document.querySelector('.gcol.squeezed[data-peek="other"]'); if (q) q.click(); }); await sleep(900);
  const c3 = await colsNow();
  ok(c3.other.span === 1 && !c3.other.sq && c3.fretflow.span === 1 && c3.ccboard.sq && JSON.stringify((await saved()).span) === '[["fretflow",2]]', '列宽：点挤到旁边的窄条，先给它让一格（FretFlow 这次让成 1 格，记的 2 格不变）', JSON.stringify(c3));
  // 恢复：双击分隔条
  await page.setViewportSize({ width: 1520, height: 900 }); await sleep(1200);
  const s4 = (await splits()).find((x) => x.a === 'fretflow' || x.b === 'fretflow');
  if (s4) { await page.dblclick('.gsplit[data-a="' + s4.a + '"][data-b="' + s4.b + '"]'); await sleep(900); } else ok(false, '列宽：FretFlow 旁边有分隔条（双击要用）', JSON.stringify(await splits()));
  const c4 = await colsNow(), sv4 = await saved();
  ok(c4.fretflow.span === 1 && c4.other.span === 2 && c4.ccboard.span === 1 && !(sv4.span || []).some((p) => p[0] === 'fretflow'), '列宽：双击分隔条恢复自动分配（其他 2、另两列各 1），不再记 FretFlow 的格数', JSON.stringify({ c4, saved: sv4.span }));
  // 键盘：分隔条拿到焦点后 ← → 挪一格，Enter 恢复
  const s5 = (await splits())[0]; await page.focus('.gsplit[data-a="' + s5.a + '"][data-b="' + s5.b + '"]');
  const a5 = (await colsNow())[s5.a].span; await page.keyboard.press(a5 > 1 ? 'ArrowLeft' : 'ArrowRight'); await sleep(900);
  const c5 = await colsNow(), want5 = a5 > 1 ? a5 - 1 : a5 + 1;
  ok(c5[s5.a].span === want5 && (await page.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('gsplit')))), '列宽：方向键一次挪一格，焦点还在分隔条上', JSON.stringify({ s5, a5, c5 }));
  await page.focus('.gsplit[data-a="' + s5.a + '"][data-b="' + s5.b + '"]'); await page.keyboard.press('Enter'); await sleep(900);
  ok((await colsNow())[s5.a].span === a5 && !((await saved()).span || []).length, '列宽：Enter 恢复自动', JSON.stringify(await colsNow()));
  // 往只剩 1 格的列那边再多拖过半格：松手它让出去（像 iPad 分屏把一边拖出屏幕）；宽屏里还有空位，所以是收起，点竖条展开
  const s6 = (await splits()).find((x) => x.a === 'fretflow' || x.b === 'fretflow') || { a: 'none', b: 'fretflow' }, nb6 = s6.a === 'fretflow' ? s6.b : s6.a, d6 = s6.a === 'fretflow' ? -1 : 1;
  const span6 = ((await colsNow())[nb6] || {}).span;
  const mid6 = s6.a === 'none' ? null : await dragBy(s6, d6 * (await unit(s6.a, s6.b)) * 0.7, () => page.evaluate(() => document.querySelector('.gcol[data-key="fretflow"]').classList.contains('yield')));
  const c6 = await colsNow(), sv6 = await saved(), toast6 = await page.evaluate(() => document.querySelector('#toast').classList.contains('on'));
  ok(mid6 && c6.fretflow.fold && c6[nb6] && c6[nb6].span === span6 + 1 && (sv6.fold || []).includes('fretflow') && toast6, '列宽：FretFlow 已经只有 1 格、再往它那边多拖过半格：它变暗提示，松手收起（宽屏里还有空位，所以是收起不是挤开）；旁边那列接过它的格子，提示怎么展开', JSON.stringify({ mid6, c6, fold: sv6.fold, toast6 }));
  await page.evaluate(() => { const f = document.querySelector('.gcol.folded[data-fold="fretflow"]'); if (f) f.click(); }); await sleep(900);
  const c7 = await colsNow();
  ok(!c7.fretflow.fold && !c7.fretflow.sq && c7.fretflow.span >= 1, '列宽：点竖条展开，即使旁边那列记了格数也先给它让一格（不会展开成一根窄条）', JSON.stringify(c7));
  ok(errs.length === 0, '列宽：页面没有报错', errs.join(' | ')); await ctx.close();
  // 没拖过任何列、窗口只有 2 格：三个项目不再把卡少的并进「其他」
  ({ ctx, page, errs } = await open({ mode: 'wall', w: 1000 }));
  const c8 = await colsNow(), mix = await page.evaluate((sids) => { const col = document.querySelector('.card[data-sid="' + sids.projF + '"]').closest('.gcol'); return col && col.dataset.key; }, FX.sids);
  ok(Object.keys(c8).sort().join() === 'ccboard,fretflow,other' && Object.values(c8).filter((x) => x.sq).length === 1 && mix === 'fretflow', '列宽：窄窗口三列放不下时挤一列成窄条，FretFlow 的卡还在 FretFlow 列（不并进其他）', JSON.stringify({ c8, mix }));
  // 窄窗口里把 FretFlow 拖满两格：旁边那列挤成窄条，但不是「收起」——窗口拉宽了它自己回来
  if (c8.fretflow && c8.fretflow.sq) { await page.evaluate(() => document.querySelector('.gcol.squeezed[data-peek="fretflow"]').click()); await sleep(900); }
  const s9 = (await splits()).find((x) => x.a === 'fretflow' || x.b === 'fretflow'), nb9 = s9 && (s9.a === 'fretflow' ? s9.b : s9.a);
  if (s9) await dragBy(s9, (s9.a === 'fretflow' ? 1 : -1) * (await unit(s9.a, s9.b)) * 0.85);
  const c9 = await colsNow(), sv9 = await saved();
  ok(s9 && c9.fretflow.span === 2 && c9[nb9].sq && !(sv9.fold || []).includes(nb9), '列宽：窄窗口里把 FretFlow 拖满两格，旁边那列挤成窄条（不记成收起）', JSON.stringify({ s9, c9, fold: sv9.fold }));
  await page.setViewportSize({ width: 1520, height: 900 }); await sleep(1200);
  const c10 = await colsNow();
  ok(c10.fretflow.span === 2 && Object.values(c10).every((x) => !x.sq && !x.fold), '列宽：窗口拉宽到 4 格，挤到旁边的列自己回来，FretFlow 还是 2 格', JSON.stringify(c10));
  await page.screenshot({ path: path.join(OUT, 'wall-span-wide-again.png') });
  ok(errs.length === 0, '窄窗口：页面没有报错', errs.join(' | ')); await ctx.close();

  // 正文里的本机路径能点（11/12 作者：「把资料直接把链接给我，我可以直接点进去」）
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  let opened = null; await page.route('**/api/open', async (route) => { opened = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'open' }) }); });
  const lp = await page.evaluate((sid) => { const c = document.querySelector('.card[data-sid="' + sid + '"]'); return { paths: [...c.querySelectorAll('.body [data-path]')].map((a) => a.dataset.path), http: c.querySelectorAll('.body a[href^="https"]').length }; }, FX.sids.links);
  ok(JSON.stringify(lp.paths) === JSON.stringify(['~/Desktop/示例_封面/', '~/Library/Application Support/cc-board', '/Users/khalil/Desktop/x y.html']) && lp.http === 1, '正文里的路径变成可点的：直接写的、反引号里带空格的、file:// 百分号编码的；普通网址照旧', JSON.stringify(lp));
  await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .body [data-path]').click(), FX.sids.links); await sleep(300);
  ok(opened && opened.path === '~/Desktop/示例_封面/', '点路径：交给服务的 /api/open（打开还是只在访达里选中由服务定）', JSON.stringify(opened));
  ok(errs.length === 0, '点路径：页面没有报错', errs.join(' | ')); await ctx.close();

  // 内置预览（11/15 作者：「点 HTML 还要到浏览器里……做一个内置的预览功能」）：.html 路径在总控台里开，⌘ 点照旧去浏览器
  const PVD = path.join(FX.home, 'Desktop', 'pv'); fs.mkdirSync(path.join(PVD, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(PVD, 'page.html'), '<!doctype html><link rel="stylesheet" href="sub/s.css"><h1>preview ok</h1><script>localStorage.setItem("k", "v")</script>');
  fs.writeFileSync(path.join(PVD, 'sub', 's.css'), 'h1{color:rgb(255,0,0)}');
  fs.writeFileSync(path.join(PVD, 'own-esc.html'), '<!doctype html><h1>own esc</h1><script>document.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); })</script>');   // 页面自己要用 Esc（比如关它自己的弹窗）
  let pvTarget = path.join(PVD, 'page.html');
  for (const lang of ['zh', 'en']) {
    ({ ctx, page, errs } = await open({ mode: 'wall', lang }));
    let asked = null, opened2 = null;
    await page.route('**/api/preview', async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await route.continue({ postData: JSON.stringify({ path: pvTarget }) }); });   // 夹具里那条路径换成真实存在的页面，走真的预览端口
    await page.route('**/api/open', async (route) => { opened2 = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'open' }) }); });
    const htmlLink = `.card[data-sid="${FX.sids.links}"] .body [data-path$=".html"]`;
    await page.evaluate((sel) => document.querySelector(sel).click(), htmlLink);
    await page.waitForFunction(() => document.querySelector('#pWait').hidden, null, { timeout: 5000 }).catch(() => {});
    const pv = await page.evaluate(() => { const d = document.querySelector('#preview'), r = d.getBoundingClientRect(), f = document.querySelector('#pFrame');
      return { open: d.open, name: document.querySelector('#pTitle').textContent, dir: document.querySelector('#pDir').textContent, src: f.src, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
        head: [...document.querySelectorAll('#preview .dhead button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join('|') }; });
    const fr = page.frames().find((x) => /\/page\.html$/.test(x.url()));
    const inner = fr ? await fr.evaluate(async (probe) => {
      let parentRead = 'read'; try { void parent.document.title; } catch { parentRead = 'blocked'; }
      let api = 'skipped'; if (probe) try { const r = await fetch(location.origin.replace(/:(\d+)$/, (m, n) => ':' + (n - 1000)) + '/api/state'); api = 'status ' + r.status; } catch { api = 'blocked'; }
      return { text: document.querySelector('h1').textContent, color: getComputedStyle(document.querySelector('h1')).color, ls: localStorage.getItem('k'), parentRead, api, origin: location.origin };
    }, lang === 'zh') : null;   // 只在中文那遍探 /api：浏览器会为被拦的请求打两行报错，下面「没有报错」要把这两行认出来扣掉
    const boardPort = Number(new URL(FX.url).port);
    if (lang === 'zh') {
      ok(asked && asked.path === '/Users/khalil/Desktop/x y.html' && !opened2, '预览：点正文里的 .html 路径 → 问服务要预览网址，不再交给浏览器', JSON.stringify([asked, opened2]));
      ok(pv.open && pv.name === 'page.html' && pv.dir === '~/Desktop/pv' && Number(new URL(pv.src).port) === boardPort + 1000 && pv.w >= pv.vw - 40 && pv.h >= pv.vh - 40, '预览：几乎占满窗口，顶栏写文件名和 ~ 开头的文件夹，页面在另一个端口', JSON.stringify(pv));
      ok(inner && inner.text === 'preview ok' && inner.color === 'rgb(255, 0, 0)' && inner.ls === 'v', '预览：页面、它子文件夹里的 CSS、localStorage 都正常（不是被沙盒的空源）', JSON.stringify(inner));
      ok(inner && inner.parentRead === 'blocked' && (inner.api === 'blocked' || /^status 4/.test(inner.api)), '预览：页面里的脚本读不到总控台的页面，也调不通 /api', JSON.stringify(inner));
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#preview')).opacity === '1', null, { timeout: 3000 }).catch(() => {});   // 弹层淡入约 0.2 秒，截在中途会是半透明的
      await page.screenshot({ path: path.join(OUT, 'preview-dark.png') });
      await page.keyboard.press('Escape'); await sleep(400);
      const closed = await page.evaluate(() => ({ open: document.querySelector('#preview').open, src: document.querySelector('#pFrame').getAttribute('src') }));
      ok(!closed.open && closed.src === 'about:blank', '预览：Esc 关掉，页面跟着卸载（音视频不在背后接着放）', JSON.stringify(closed));
      // 焦点在预览页里面时（点过页面）按 Esc 也要关：预览端口在 HTML 末尾加的脚本把 Esc 发给总控台
      const isOpen = () => page.evaluate(() => document.querySelector('#preview').open);
      const openAndFocus = async (name) => {
        await page.evaluate((sel) => document.querySelector(sel).click(), htmlLink);
        let f = null;                                   // 等这一次的页面真的载出来：#pWait 可能还是上一次留下的「已隐藏」，不能拿它当信号
        for (let i = 0; i < 50 && !f; i++) { await sleep(100); f = page.frames().find((x) => x.url().endsWith('/' + name)) || null; }
        if (f) { await f.waitForSelector('h1', { timeout: 5000 }).catch(() => {}); await f.click('h1'); }
        return f ? await f.evaluate(() => document.hasFocus()) : false;
      };
      const inFocus = await openAndFocus('page.html'); await page.keyboard.press('Escape'); await sleep(400); const afterEsc = await isOpen();
      ok(inFocus && !afterEsc, '预览：点进页面里（焦点在 iframe）再按 Esc 也能关', JSON.stringify({ inFocus, afterEsc }));
      pvTarget = path.join(PVD, 'own-esc.html');
      const inFocus2 = await openAndFocus('own-esc.html'); await page.keyboard.press('Escape'); await sleep(400); const keptOpen = await isOpen();
      await page.evaluate(() => postMessage({ ccb: 'preview-esc' }, '*')); await sleep(200); const forged = await isOpen();
      ok(inFocus2 && keptOpen && forged, '预览：页面自己拦下的 Esc 不关预览；不是这个 iframe 发的消息也不关', JSON.stringify({ inFocus2, keptOpen, forged }));
      await page.keyboard.press('Escape'); await page.click('#preview [data-close]'); await sleep(300); pvTarget = path.join(PVD, 'page.html');
      // 别的类型（11/15 作者：「访达里的这种文件预览，也直接在我们的 APP 里打开」）：图、视频、Markdown、纯文本在总控台自己的页面里显示
      fs.writeFileSync(path.join(PVD, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
      fs.writeFileSync(path.join(PVD, 'clip.mp4'), Buffer.alloc(2048, 1)); fs.writeFileSync(path.join(PVD, '笔记.md'), '# 标题一\n\n- 第一条\n- 第二条\n'); fs.writeFileSync(path.join(PVD, 'run.log'), '<b>not html</b>\nline 2');
      await page.unroute('**/api/preview');
      const shown = () => page.evaluate(() => { const v = (id) => !document.querySelector(id).hidden; const vid = document.querySelector('#pVid');
        return { open: document.querySelector('#preview').open, kind: document.querySelector('#pBody').dataset.kind, frame: v('#pFrame'), img: v('#pImg'), vid: v('#pVid'), text: v('#pText'),
          imgW: document.querySelector('#pImg').naturalWidth, imgSrc: document.querySelector('#pImg').getAttribute('src') || '', vidSrc: vid.getAttribute('src') || '', paused: vid.paused, controls: vid.controls,
          h: (document.querySelector('#pText h1, #pText h2, #pText h3') || {}).textContent || '', li: document.querySelectorAll('#pText li').length, pre: (document.querySelector('#pText pre.raw') || {}).textContent || '', bold: document.querySelectorAll('#pText b').length }; });
      const pvOpen = async (n) => { await page.evaluate((p) => openPreview(p), path.join(PVD, n)); await sleep(700); return shown(); };
      const sImg = await pvOpen('dot.png');
      ok(sImg.open && sImg.kind === 'image' && sImg.img && !sImg.frame && sImg.imgW === 1 && Number(new URL(sImg.imgSrc).port) === boardPort + 1000, '预览：图片用总控台自己的 <img> 显示，图从预览端口取', JSON.stringify(sImg));
      const sVid = await pvOpen('clip.mp4');
      ok(sVid.kind === 'video' && sVid.vid && !sVid.img && sVid.controls && sVid.paused && /\/clip\.mp4$/.test(sVid.vidSrc), '预览：视频用 <video>，带控制条、不自动播放；换文件时上一张图收起', JSON.stringify(sVid));
      await page.focus('#pVid'); await page.keyboard.press('Escape'); await sleep(400); const sClosed = await shown();
      ok(!sClosed.open && sClosed.vidSrc === '', '预览：焦点在视频上按 Esc 关掉，视频的源清掉（不在背后接着放）', JSON.stringify(sClosed));
      const sMd = await pvOpen('笔记.md');
      ok(sMd.kind === 'markdown' && sMd.text && sMd.h === '标题一' && sMd.li === 2, '预览：Markdown 按卡片正文的样式排版（标题、列表）', JSON.stringify(sMd));
      const sTxt = await pvOpen('run.log');
      ok(sTxt.kind === 'text' && sTxt.pre === '<b>not html</b>\nline 2' && sTxt.bold === 0, '预览：纯文本原样显示，里面的标签不当成 HTML', JSON.stringify(sTxt));
      await page.click('#preview [data-close]'); await sleep(300);
      await page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })), htmlLink); await sleep(300);
      ok(opened2 && opened2.path === '/Users/khalil/Desktop/x y.html' && !(await page.evaluate(() => document.querySelector('#preview').open)), '预览：⌘ 点同一条路径 → 照旧交给 /api/open（默认浏览器）', JSON.stringify(opened2));
      opened2 = null; await page.unroute('**/api/preview');
      await page.route('**/api/preview', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'no-preview', error: 'x' }) }));
      await page.evaluate((sel) => document.querySelector(sel).click(), htmlLink); await sleep(300);
      ok(opened2 && !(await page.evaluate(() => document.querySelector('#preview').open)), '预览：服务说预览不了（文件夹、Word 这类）→ 改走 /api/open', JSON.stringify(opened2));
    } else {
      const zhLeft = pv.head.match(/[一-鿿]+/g) || [];
      ok(pv.open && zhLeft.length === 0 && /Open in browser/.test(pv.head), '预览（英文）：顶栏按钮都翻好了', pv.head);
    }
    const probeErr = (m) => m.includes("from origin 'http://127.0.0.1:" + (boardPort + 1000) + "' has been blocked by CORS") || m === 'Failed to load resource: net::ERR_FAILED';   // 上面故意探 /api 被拦的那两行
    const realErrs = lang === 'zh' ? errs.filter((m) => !probeErr(m)) : errs;
    ok(realErrs.length === 0 && (lang !== 'zh' || errs.length - realErrs.length <= 2), '预览（' + lang + '）：页面没有报错（中文那遍除了故意探 /api 被拦的两行）', errs.join(' | ')); await ctx.close();
  }

  // 图集（11/15 作者：「直接把这些照片做成一个合集，我就不要一个一个去点开」「打开预览的时候，我不想切到外面去看」）
  // 点一个多半是图的文件夹 → 格子墙，点一张放大，← → 翻页，Esc 先回格子墙；正文里提到 2 张以上的图 → 正文最上面一个「图集」小按钮
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const mkpng = (w, h, [r, g, b]) => {      // 真的 w × h 的纯色 PNG：要量「不裁切、按各自的比例排」，1×1 的图量不出来
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
  };
  const GALD = path.join(FX.home, 'Desktop', 'gal'); fs.mkdirSync(GALD, { recursive: true });
  fs.writeFileSync(path.join(GALD, 'shot1.png'), mkpng(120, 260, [200, 70, 60])); fs.writeFileSync(path.join(GALD, 'shot2.png'), mkpng(300, 200, [60, 140, 200]));
  fs.writeFileSync(path.join(GALD, 'shot10.png'), mkpng(160, 160, [90, 180, 110])); fs.writeFileSync(path.join(GALD, 'clip.mp4'), Buffer.alloc(2048, 1));
  fs.writeFileSync(path.join(PVD, 'other.png'), mkpng(200, 100, [180, 150, 60]));
  const galPaths = [path.join(GALD, 'shot1.png'), path.join(GALD, 'shot2.png'), path.join(PVD, 'other.png')];
  for (const lang of ['zh', 'en']) {
    ({ ctx, page, errs } = await open({ mode: 'wall', lang }));
    let asked = null, openedG = null, reqBody = { path: GALD + '/' };
    await page.route('**/api/preview', async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await route.continue({ postData: JSON.stringify(reqBody) }); });   // 夹具里的假路径换成真文件，走真的服务和预览端口
    await page.route('**/api/open', async (route) => { openedG = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'open' }) }); });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<a id="tFolder" class="file" data-path="~/Desktop/gal/">gal</a><div id="tChip"></div>'));
    const galState = () => page.evaluate(() => { const q = (s) => document.querySelector(s), imgs = [...document.querySelectorAll('#pGal .gt img')];
      return { open: q('#preview').open, kind: q('#pBody').dataset.kind, title: q('#pTitle').textContent, dir: q('#pDir').textContent, openBtn: q('#pOpen').textContent.trim(), openHidden: q('#pOpen').hidden, reloadHidden: q('#pReload').hidden,
        names: [...document.querySelectorAll('#pGal .gn')].map((x) => x.textContent), tiles: document.querySelectorAll('#pGal .gi').length, vids: document.querySelectorAll('#pGal .gt video').length,
        others: ['#pFrame', '#pImg', '#pVid', '#pAud', '#pText'].filter((s) => !q(s).hidden),
        imgs: imgs.map((i) => { const r = i.getBoundingClientRect(); return { w: r.width, h: r.height, nw: i.naturalWidth, nh: i.naturalHeight }; }) }; });
    const waitGal = async () => { await page.waitForFunction(() => document.querySelector('#pBody').dataset.kind === 'gallery' && document.querySelectorAll('#pGal .gi').length > 0, null, { timeout: 5000 });
      await page.waitForFunction(() => [...document.querySelectorAll('#pGal .gt img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {}); };
    // ① 点文件夹（路径以 / 结尾）：先问服务，不再直接交给访达
    await page.evaluate(() => document.querySelector('#tFolder').click()); await waitGal();
    const G = await galState();
    ok(asked && asked.path === '~/Desktop/gal/' && !openedG, '图集（' + lang + '）：点以 / 结尾的文件夹路径 → 先问 /api/preview，没有直接去访达', JSON.stringify({ asked, openedG }));
    ok(G.open && G.kind === 'gallery' && G.tiles === 4 && G.title === 'gal' && G.dir.startsWith('~/Desktop/gal') && G.others.length === 0, '图集（' + lang + '）：文件夹排成格子墙（4 格），顶栏写文件夹名和 ~ 开头的位置，别的显示层都收起', JSON.stringify({ ...G, imgs: undefined }));
    ok(G.dir.endsWith(lang === 'zh' ? '共 4 个' : '4 items') && G.openBtn === (lang === 'zh' ? '在访达中显示' : 'Show in Finder') && !G.openHidden && !G.reloadHidden, '图集（' + lang + '）：顶栏写共几个；「在浏览器打开」换成「在访达中显示」，重新载入还在', JSON.stringify([G.dir, G.openBtn, G.openHidden, G.reloadHidden]));
    ok(JSON.stringify(G.names) === JSON.stringify(['clip.mp4', 'shot1.png', 'shot2.png', 'shot10.png']) && G.vids === 1, '图集（' + lang + '）：按文件名里的数字排（shot1、shot2、shot10）；视频是一格带 ▶ 的小视频', JSON.stringify(G.names));
    const ratios = G.imgs.map((i) => i.w / i.h), natural = G.imgs.map((i) => i.nw / i.nh);
    ok(G.imgs.length === 3 && G.imgs.every((i) => Math.abs(i.h - G.imgs[0].h) <= 1 && i.nw > 0) && ratios.every((r, i) => Math.abs(r - natural[i]) / natural[i] < 0.03) && G.imgs[0].w < G.imgs[1].w, '图集（' + lang + '）：高度统一、宽度随图（竖图窄、横图宽），不裁切', JSON.stringify(G.imgs.map((i) => [Math.round(i.w), Math.round(i.h), i.nw, i.nh])));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#preview')).opacity === '1', null, { timeout: 3000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, 'gallery-' + lang + '.png') });
    // ② 放大、翻页、Esc 先回格子墙
    const lbState = () => page.evaluate(() => { const lb = document.querySelector('#pGal .lb'); if (!lb) return null; const q = (s) => lb.querySelector(s);
      return { cap: q('.lcap').textContent, img: q('.lstage img') ? q('.lstage img').getAttribute('src') : '', vid: q('.lstage video') ? { paused: q('.lstage video').paused, controls: q('.lstage video').controls } : null,
        prevOff: q('[data-gstep="-1"]').disabled, nextOff: q('[data-gstep="1"]').disabled, labels: [...lb.querySelectorAll('[aria-label],[title],button')].map((x) => (x.getAttribute('aria-label') || '') + '|' + (x.getAttribute('title') || '') + '|' + x.textContent).join(' '),
        w: Math.round(lb.querySelector('.lstage img') ? lb.querySelector('.lstage img').getBoundingClientRect().width : 0), stageW: Math.round(lb.querySelector('.lstage').getBoundingClientRect().width) }; });
    await page.click('#pGal [data-gi="2"]'); await sleep(200);
    const L1 = await lbState();
    ok(L1 && /3 \/ 4/.test(L1.cap) && /shot2\.png$/.test(L1.cap) && /\/shot2\.png$/.test(L1.img) && !L1.prevOff && !L1.nextOff && L1.w > 0 && L1.w <= L1.stageW, '图集（' + lang + '）：点第 3 格 → 放大，写 3 / 4 和文件名，前后都能翻，图不超出窗口', JSON.stringify(L1));
    if (lang === 'zh') {
      await page.keyboard.press('ArrowRight'); await sleep(100); const L2 = await lbState();
      await page.keyboard.press('ArrowRight'); await sleep(100); const L3 = await lbState();
      ok(/4 \/ 4/.test(L2.cap) && L2.nextOff && /\/shot10\.png$/.test(L2.img) && /4 \/ 4/.test(L3.cap), '图集：→ 翻到下一张；到最后一张「下一张」灰掉，再按 → 不动', JSON.stringify([L2.cap, L2.nextOff, L3.cap]));
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(150); const L4 = await lbState();
      ok(/1 \/ 4/.test(L4.cap) && L4.prevOff && L4.vid && L4.vid.controls && L4.vid.paused, '图集：← 翻回第一张（是视频：带控制条、不自动播放），「上一张」灰掉', JSON.stringify(L4));
      await page.keyboard.press('Escape'); await sleep(200);
      const E1 = await page.evaluate(() => ({ open: document.querySelector('#preview').open, lb: !!document.querySelector('#pGal .lb'), focus: (document.activeElement.dataset || {}).gi, grid: !!document.querySelector('#pGal .ggrid') }));
      ok(E1.open && !E1.lb && E1.grid && E1.focus === '0', '图集：放大时按一下 Esc → 回到格子墙（预览没关），光标回到刚才那一格', JSON.stringify(E1));
      await page.click('#pGal [data-gi="1"]'); await sleep(150);
      const box = await page.evaluate(() => { const r = document.querySelector('#pGal .lstage').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 }; });
      await page.mouse.click(box.x, box.y); await sleep(150);
      ok(!(await page.evaluate(() => !!document.querySelector('#pGal .lb'))), '图集：点放大图旁边的空白 → 回格子墙', '');
      await page.click('#pGal [data-gi="1"]'); await sleep(100); await page.click('#pGal [data-gstep="1"]'); await sleep(100);
      const L5 = await lbState(); await page.click('#pGal [data-gback]'); await sleep(100);
      ok(/3 \/ 4/.test(L5.cap) && !(await page.evaluate(() => !!document.querySelector('#pGal .lb'))), '图集：点「图集」按钮回格子墙，点「下一张」按钮翻页', JSON.stringify(L5.cap));
      await page.click('#pGal [data-gi="3"]'); await sleep(100);
      await page.screenshot({ path: path.join(OUT, 'gallery-lightbox.png') });
      await page.keyboard.press('Escape'); await sleep(100); await page.keyboard.press('Escape'); await sleep(300);
      const E2 = await page.evaluate(() => ({ open: document.querySelector('#preview').open, kids: document.querySelector('#pGal').childElementCount, hidden: document.querySelector('#pGal').hidden }));
      ok(!E2.open && E2.kids === 0 && E2.hidden, '图集：再按一下 Esc 才关预览，图集整个拆掉', JSON.stringify(E2));
    } else {
      ok(L1 && !/[一-鿿]/.test(L1.labels) && /Previous/.test(L1.labels) && /Next/.test(L1.labels) && /Gallery/.test(L1.labels), '图集（英文）：放大层的按钮和提示都翻好了', L1 && L1.labels);
      await page.keyboard.press('Escape'); await sleep(150); await page.keyboard.press('Escape'); await sleep(300);
    }
    // ③ ⌘ 点文件夹：照旧直接交给访达，不问预览
    asked = null; openedG = null;
    await page.evaluate(() => document.querySelector('#tFolder').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))); await sleep(300);
    ok(openedG && openedG.path === '~/Desktop/gal/' && !asked && !(await page.evaluate(() => document.querySelector('#preview').open)), '图集（' + lang + '）：⌘ 点文件夹 → 照旧直接 /api/open（访达），不问预览', JSON.stringify({ openedG, asked }));
    // ④ 服务说这个文件夹不是图集（项目文件夹、没几张图）→ 先问了预览，再交给访达
    openedG = null; asked = null; await page.unroute('**/api/preview');
    await page.route('**/api/preview', async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'no-preview', error: 'x' }) }); });
    await page.evaluate(() => document.querySelector('#tFolder').click()); await sleep(300);
    ok(asked && asked.path === '~/Desktop/gal/' && openedG && openedG.path === '~/Desktop/gal/' && !(await page.evaluate(() => document.querySelector('#preview').open)), '图集（' + lang + '）：服务回 no-preview 的文件夹 → 先问预览，再交给访达', JSON.stringify({ asked, openedG }));
    await page.unroute('**/api/preview');
    await page.route('**/api/preview', async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await route.continue({ postData: JSON.stringify(reqBody) }); });
    // ⑤ 正文里提到 2 张以上不同的图 → 最上面一个「图集」小按钮；只有 1 张、同一张写两遍、不是图、文件夹都不出
    const C = await page.evaluate(() => {
      const q = (h) => { const d = document.createElement('div'); d.innerHTML = L(md(h)); return d.querySelector('[data-gallery]'); };
      const two = q('结果在 ~/Desktop/gal/shot1.png 和 ~/Desktop/pv/other.png'), bt = q('`/tmp/x y/1.png` 和 `/tmp/x y/2.mp4`');
      return { one: !!q('看 ~/Desktop/gal/shot1.png'), two: !!two, list: two && JSON.parse(two.dataset.gallery), text: two && two.textContent.trim(), title: two && two.title, same: !!q('~/Desktop/a.png 再看 ~/Desktop/a.png'),
        mixed: !!q('~/Desktop/a.png 和 ~/Desktop/b.md'), folders: !!q('~/Desktop/a/ 和 ~/Desktop/b/'), bt: bt && JSON.parse(bt.dataset.gallery), first: md('~/Desktop/gal/shot1.png ~/Desktop/pv/other.png').startsWith('<div class="gchip-row">'), sinkReset: fileSink === null };
    });
    ok(!C.one && !C.same && !C.mixed && !C.folders && C.two && C.first, '图集（' + lang + '）：正文里 2 张以上不同的图才出「图集」按钮，放在最上面；1 张、同一张写两遍、一张图加一个笔记、只有文件夹都不出', JSON.stringify(C));
    ok(JSON.stringify(C.list) === JSON.stringify(['~/Desktop/gal/shot1.png', '~/Desktop/pv/other.png']) && JSON.stringify(C.bt) === JSON.stringify(['/tmp/x y/1.png', '/tmp/x y/2.mp4']) && C.sinkReset, '图集（' + lang + '）：认路径用的是 inline() 那套（直接写的、反引号里带空格的、图和视频都算），渲染完收集器清空', JSON.stringify([C.list, C.bt, C.sinkReset]));
    ok(C.text === (lang === 'zh' ? '图集 · 2 张' : 'Gallery · 2') && (lang === 'zh' ? /2 张/.test(C.title) : /2 images/.test(C.title)), '图集（' + lang + '）：按钮上写几张，提示也翻成当前语言', JSON.stringify([C.text, C.title]));
    // ⑥ 点按钮：整条交付的路径一起交给服务（paths），图集里没有「在访达中显示」和重新载入
    reqBody = { paths: galPaths };
    await page.evaluate((paths) => { document.querySelector('#tChip').innerHTML = L(md(paths.join(' '))); }, ['~/Desktop/gal/shot1.png', '~/Desktop/gal/shot2.png', '~/Desktop/pv/other.png']);
    asked = null; await page.evaluate(() => document.querySelector('#tChip .gchip').click()); await waitGal();
    const G2 = await galState();
    ok(asked && JSON.stringify(asked.paths) === JSON.stringify(['~/Desktop/gal/shot1.png', '~/Desktop/gal/shot2.png', '~/Desktop/pv/other.png']) && G2.kind === 'gallery' && G2.tiles === 3 && G2.title === (lang === 'zh' ? '图集' : 'Gallery'), '图集（' + lang + '）：点「图集」按钮 → 把这条交付里的路径一起交给服务（paths），3 张排成格子墙，标题是「图集」', JSON.stringify({ asked, G2: { ...G2, imgs: undefined } }));
    ok(G2.openHidden && G2.reloadHidden && G2.dir === (lang === 'zh' ? '共 3 个' : '3 items') && G2.imgs.every((i) => i.nw > 0) && G2.names.join() === 'shot1.png,shot2.png,other.png', '图集（' + lang + '）：一批图拼成的图集没有对应的文件夹 → 顶栏的「在访达中显示」和重新载入都收起；跨两个文件夹的图都取得到', JSON.stringify([G2.openHidden, G2.reloadHidden, G2.dir, G2.names]));
    // ⑦ 关掉后再点别的类型（网页）：顶栏按钮恢复成「在浏览器打开」，格子墙不残留
    await page.click('#preview [data-close]'); await sleep(300);
    reqBody = { path: path.join(PVD, 'page.html') }; await page.evaluate(() => document.querySelector('#tFolder').click());
    await page.waitForFunction(() => document.querySelector('#pBody').dataset.kind === 'page', null, { timeout: 5000 });
    const H = await page.evaluate(() => ({ open: document.querySelector('#pOpen').textContent.trim(), hidden: document.querySelector('#pOpen').hidden || document.querySelector('#pReload').hidden, gal: document.querySelector('#pGal').hidden, kids: document.querySelector('#pGal').childElementCount }));
    ok(H.open === (lang === 'zh' ? '在浏览器打开' : 'Open in browser') && !H.hidden && H.gal && H.kids === 0, '图集（' + lang + '）：图集关掉再开网页 → 顶栏恢复「在浏览器打开」和重新载入，格子墙不残留', JSON.stringify(H));
    await page.click('#preview [data-close]'); await sleep(200);
    ok(errs.length === 0, '图集（' + lang + '）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  console.log('\n[图集 · 视频]'); await galVideoCheck();

  // 放大看：⌘O、双击封面；再按 ⌘O / 双击标题栏收回；双击正文里的字照旧选词（11/13 作者）
  ({ ctx, page, errs } = await open({ mode: 'wall' }));
  const dOpen = () => page.evaluate(() => ({ open: document.querySelector('#detail').open, title: document.querySelector('#dTitle').textContent }));
  const dsel = `.card[data-sid="${FX.sids.done}"]`;
  await page.hover(dsel + ' .head'); await page.keyboard.press('Meta+KeyO'); await sleep(500); const z1 = await dOpen();
  await page.keyboard.press('Meta+KeyO'); await sleep(300); const z2 = await dOpen();
  ok(z1.open && z1.title === 'w-done' && !z2.open, '⌘O：鼠标停在哪张卡上就放大哪张，再按一次收回', JSON.stringify([z1, z2]));
  await page.dblclick(dsel + ' .head'); await sleep(800); const z3 = await dOpen();
  const hasP = await page.evaluate(() => !!document.querySelector('#dBody p'));
  // 点在字上（和下面卡片正文那条一样）：段落比字宽，正中间是字后面的空白。11/17 大窗口底下多了回话框以后，空白处双击选中的是换行而不是句号，照「双击空白处收回」把大窗口关了；以前是碰巧选中了「。」才没关
  if (hasP) await page.dblclick('#dBody p', { position: { x: 14, y: 10 } }); await sleep(300); const z3b = await dOpen();
  await page.dblclick('#detail .dhead h1'); await sleep(300); const z4 = await dOpen();
  ok(z3.open && z3.title === 'w-done' && hasP && z3b.open && !z4.open, '双击卡片封面放大；大窗口里双击正文的字不收回，双击标题栏收回', JSON.stringify([z3, hasP, z3b, z4]));
  await page.dblclick(dsel + ' .body p', { position: { x: 14, y: 10 } }); await sleep(400); const z5 = await dOpen(); const sel = await page.evaluate(() => String(getSelection()).trim());   // 点在字上：段落比字宽，点正中间会落在字后面的空白
  ok(!z5.open && sel.length > 0, '双击卡片正文里的字：照旧选中词，不放大', JSON.stringify({ z5, sel }));
  await page.click(dsel + ' .title'); await sleep(400); const z6 = await dOpen();
  ok(!z6.open, '单击标题不再打开（免得和双击打架：第一下打开、第二下落在窗口外面又关上）', JSON.stringify(z6));
  // 放大看打开时从哪里看起（11/15 作者：「默认是从下面到结尾，但是我不知道从哪里开始」）：滚到最新交付的第一行（长的顶在窗口顶），不是一律滚到最底；顶不上去的短交付由浏览器夹在最底，不垫空白。
  // /api/turns 拦在浏览器里，造四种形状的对话（最新交付很长 / 很短 / 这一轮还没有交付 / 一屏放得下），再加没有对话和英文
  let turnsNow = [];
  await page.route(/\/api\/turns\?/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ turns: turnsNow }) }));
  const para = (n, tag) => Array.from({ length: n }, (_, i) => tag + ' 第 ' + (i + 1) + ' 段：' + '这是一段用来撑高的正文，写得长一点，免得一行就放完。'.repeat(3)).join('\n\n');
  const mkTurn = (prompt, texts, steps = 223) => ({ prompt, at: Date.now() - 3600e3, steps, results: texts.map((x, i) => ({ at: Date.now() - 3000e3 + i * 600e3, text: x })) });
  const zoomShape = async (turns, shot) => {
    turnsNow = turns; await page.evaluate((sid) => zoomCard(sid), FX.sids.done); await sleep(700);
    if (shot) await page.screenshot({ path: path.join(OUT, shot) });
    const g = await page.evaluate(() => {
      const b = document.querySelector('#dBody'), br = b.getBoundingClientRect(), st = [...b.querySelectorAll('[data-start]')], s = st[0], mds = [...b.querySelectorAll('.md')];
      const sr = s && s.getBoundingClientRect(), nm = b.querySelector('.md.new'), er = nm ? nm.getBoundingClientRect() : sr;     // er = 最新那条交付（没有交付时是那一轮）的范围
      return { n: st.length, el: s ? s.tagName + '.' + s.className : '', gap: s ? Math.round(sr.top - br.top) : null, top: Math.round(b.scrollTop), room: Math.round(b.scrollHeight - b.clientHeight),
        pad: b.style.paddingBottom, labels: [...b.querySelectorAll('.turn .m')].map((x) => x.textContent), news: b.querySelectorAll('.md.new').length, lastMdNew: mds.length > 0 && mds[mds.length - 1].classList.contains('new'),
        seen: !!s && sr.top >= br.top && er.bottom <= br.bottom + 1, end: er ? Math.round(br.bottom - er.bottom) : null };      // seen = 起点和整条都在窗口里；end = 它下面还剩多少（只有内边距，说明没垫空白）
    });
    await page.keyboard.press('Escape'); await sleep(400); return g;
  };
  const gA = await zoomShape([mkTurn('旧问题', [para(30, '旧')]), mkTurn('新问题', [para(3, '第一条'), para(60, '最新')])], 'zoom-latest-long.png');
  ok(gA.n === 1 && gA.el === 'DIV.m num new' && Math.abs(gA.gap - 10) <= 2 && gA.top > 0 && gA.pad === '' && gA.news === 1 && gA.lastMdNew,
    '放大看：最新交付很长 → 它的第一行贴着窗口顶（上面留 10px），不落在最底；不垫空白；只有它标成最新', JSON.stringify(gA));
  ok(/^最新交付 · .+ · 中间 223 步没显示$/.test(gA.labels[gA.labels.length - 1]) && gA.labels.filter((x) => /^交付 · /.test(x)).length === 2,
    '放大看：同一轮里前面几条仍写「交付」，只有最后一条写「最新交付」', JSON.stringify(gA.labels));
  const gB = await zoomShape([mkTurn('旧问题', [para(40, '旧')]), mkTurn('新问题', ['【进展】一句话。'])], 'zoom-latest-short.png');
  ok(gB.n === 1 && gB.pad === '' && gB.top > 0 && Math.abs(gB.top - gB.room) <= 2 && gB.gap > 10 && gB.seen && gB.end <= 40,
    '放大看：最新交付只有一两句 → 不垫空白（短交付垫了会是个几乎全空的大窗口），滚到最底，上面照常露出前文，标签和整条交付都在窗口里', JSON.stringify(gB));
  const gC = await zoomShape([mkTurn('旧问题', [para(40, '旧')]), mkTurn('正在做的事', [], 12)]);
  ok(gC.n === 1 && gC.el.startsWith('SECTION') && gC.news === 0 && gC.pad === '' && gC.seen && gC.top > 0 && /^这一轮还没有交付，已经做了 12 步$/.test(gC.labels[gC.labels.length - 1]),
    '放大看：最后一轮还没有交付 → 起点是那一轮「你说的话」（不是别处），不垫空白，没有「最新交付」标记', JSON.stringify(gC));
  const gD = await zoomShape([mkTurn('只有一句', ['短'])]);
  ok(gD.n === 1 && gD.pad === '' && gD.top === 0 && gD.room <= 0, '放大看：整段对话一屏放得下 → 不垫空白、不滚', JSON.stringify(gD));
  const gE = await zoomShape([]);
  ok(gE.n === 0 && gE.pad === '' && gE.top === 0, '放大看：没有对话 → 不报错、不滚', JSON.stringify(gE));
  await page.unroute(/\/api\/turns\?/);
  ok(errs.length === 0, '放大看：页面没有报错', errs.join(' | ')); await ctx.close();
  {   // 英文：最新交付的标签有英文，没有漏翻
    const en = await open({ mode: 'wall', lang: 'en' }); let tn = [mkTurn('Question', [para(2, 'a'), para(3, 'b')])];
    await en.page.route(/\/api\/turns\?/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ turns: tn }) }));
    await en.page.evaluate((sid) => zoomCard(sid), FX.sids.done); await sleep(700);
    const lab = await en.page.evaluate(() => [...document.querySelectorAll('#dBody .turn .m')].map((x) => x.textContent));
    ok(lab.some((x) => /^Latest delivery · .+ · 223 steps hidden$/.test(x)) && lab.some((x) => /^Delivered · /.test(x)) && !/[一-鿿]/.test(lab.join('|')), '放大看（英文）：「Latest delivery」「Delivered」标签，没有漏翻的中文', JSON.stringify(lab));
    ok(en.errs.length === 0, '放大看（英文）：页面没有报错', en.errs.join(' | ')); await en.ctx.close();
  }
  await dockCheck();      // 弹层里回话（预览、放大看时也能回话）：见上面 dockCheck()
  // ── 新任务：模型是下拉菜单，已经记着 fable 时也能换成别的（11/12 作者：「怎么只有 Fable？我要 Opus」）──
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
      ok(!dlg.cwd && dlg.labels === '要它做什么|交给谁|模型|强度|账号' && /放在哪个文件夹它自己定/.test(dlg.ph), '新任务：不再问放哪个文件夹，提示里写明它自己定', JSON.stringify(dlg));
      ok(m.tag === 'SELECT' && m.value === 'fable' && m.opts.join('|') === '=默认|fable=Fable|opus=Opus|sonnet=Sonnet|haiku=Haiku', '新任务：模型是下拉菜单，记着 fable 时四个模型都列着', JSON.stringify(m));
      await pg.screenshot({ path: path.join(OUT, 'new-task.png') });
      const ac = await pg.evaluate(() => [...document.querySelector('#nAcct').options].map((o) => o.value + '=' + o.textContent + (o.disabled ? '(灰)' : '')));
      ok(ac.join('|') === '=默认|good=旧号|none=还没存 token 的号（钥匙串里还没有 token）(灰)', '新任务：账号下拉列出 config 里的号，钥匙串里没有 token 的灰着不能选', JSON.stringify(ac));
      const acD = await ev(pg, () => { const c = last.providers.claude, keep = c.defaultAccount; c.defaultAccount = 'good'; fillNew(); const t = document.querySelector('#nAcct').options[0].textContent; c.defaultAccount = keep; fillNew(); return t; });
      ok(acD === '默认（旧号）', '新任务：config 设了 defaultAccount，「默认」那一项写那个号的名字，不再写当前登录的号', JSON.stringify(acD));
      await pg.selectOption('#nModel', 'opus'); await pg.selectOption('#nAcct', 'good'); await pg.fill('#nPrompt', '测试'); await pg.click('#nGo'); await sleep(600);
      ok(sent && sent.account === 'good', '新任务：选了「旧号」，发给服务的 account 是 good', JSON.stringify(sent));
      ok(sent && sent.model === 'opus' && sent.provider === 'claude' && sent.effort === 'max' && sent.prompt === '测试', '新任务：选 Opus 再开工，发给服务的就是 opus', JSON.stringify(sent));
      ok(sent && sent.cwd === '~', '新任务：不带你选的文件夹，一律开在主目录', JSON.stringify(sent));
      const keptPick = await pg.evaluate(() => JSON.parse(localStorage.getItem('ccb_new')));
      ok(keptPick.model.claude === 'opus' && keptPick.account === 'good', '新任务：下次打开还记着 Opus 和选的号', JSON.stringify(keptPick));
    } else {
      ok(m.value === saved && m.opts.includes(saved + '=' + saved) && m.opts.length === 6, '新任务：以前存的完整模型名还在列表里，没被丢掉', JSON.stringify(m));
    }
    await c2.close();
  }
  // ── 列头的「＋ 新任务」（11/13 作者：「在每一个主题下面再放一个新任务」）：点哪一列，任务就带着哪一列交给服务 ──
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
    if (off) await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json(); if (j.providers) delete j.providers.codex; await route.fulfill({ response: r, json: j }); });
    await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('.card'); await sleep(1800);
    await pg.click('#newBtn'); await sleep(400);
    const v = await pg.evaluate(() => ({ field: getComputedStyle(document.querySelector('#nProvField')).display, provs: [...document.querySelectorAll('#nProv button')].map((b) => b.textContent) }));
    if (off) ok(v.field === 'none' && v.provs.join() === 'Claude Code' && !e3.length, 'codex 关着：新任务里不显示「交给谁」', JSON.stringify({ v, e3 }));
    else ok(v.field !== 'none' && v.provs.join() === 'Claude Code,Codex', 'codex 打开：「交给谁」照旧显示 Claude Code / Codex', JSON.stringify(v));
    await c3.close();
  }
  // ── 输入框上的预判（11/13）：灰字 Tab 收下；1/2/3 填进输入框，不会自己发出去。读屏幕那一半在 state.test.mjs 的 [7e]；这里把 suggest 塞进应答，只测界面 ──
  const SGX = { ghost: '把这个改动提交，然后跑一遍全部测试，再把结果和耗时逐项写进说明里，最后把说明发到群里让大家看一眼', options: [{ n: 1, label: '提交并跑测试' }, { n: 2, label: '看一下改动' }, { n: 3, label: '先放着' }] };
  for (const lang of ['zh', 'en']) {
    ({ ctx, page, errs } = await open({ mode: 'wall', lang })); let sentTo = [];
    await page.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json();
      for (const x of j.sessions) if (x.sid === FX.sids.done || x.sid === FX.sids.run) { x.channel = 'tmux'; x.tmux = 'ccb-fake'; x.suggest = SGX; }      // done 是空闲的，run 是忙着的
      await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/send', async (route) => { sentTo.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, delivered: true }) }); });
    await sleep(2800);
    const dc = `.card[data-sid="${FX.sids.done}"]`, rc = `.card[data-sid="${FX.sids.run}"]`;
    const sgs = (sel) => page.evaluate((q) => { const c = document.querySelector(q), g = c.querySelector('.ghost'), ta = c.querySelector('textarea'), gr = g.getBoundingClientRect(), tr = ta.getBoundingClientRect(), cl = c.querySelector('.clip').getBoundingClientRect();
      const ch = c.querySelector('.chip'); return { chips: [...c.querySelectorAll('.sg .chip')].map((b) => b.querySelector('kbd').textContent + ':' + b.querySelector('span').textContent), sgHidden: c.querySelector('.sg').hidden,
        ghost: g.hidden ? null : c.querySelector('.gt').textContent, key: g.querySelector('kbd').textContent, value: ta.value, phClear: getComputedStyle(ta, '::placeholder').color === 'rgba(0, 0, 0, 0)',
        inside: gr.left >= tr.left && gr.right <= cl.left + 1 && gr.height > 0, ellipsis: getComputedStyle(c.querySelector('.gt')).textOverflow === 'ellipsis', focus: document.activeElement === ta, title: ch ? ch.title : '' }; }, sel);
    const a0 = await sgs(dc), b0 = await sgs(rc);
    ok(a0.chips.join('|') === '1:提交并跑测试|2:看一下改动|3:先放着' && !a0.sgHidden && a0.ghost === SGX.ghost && a0.key === 'Tab', lang + '：空闲的卡：输入框上方 1 / 2 / 3 三条，输入框里是灰字，旁边一个 Tab 键帽', JSON.stringify(a0));
    ok(a0.phClear && a0.inside && a0.ellipsis, lang + '：灰字显示时输入框自己的提示字透明（不叠在一起）；很长的灰字截成省略号，不压到回形针和发送键', JSON.stringify({ phClear: a0.phClear, inside: a0.inside, ellipsis: a0.ellipsis }));
    ok(b0.sgHidden && b0.ghost === null, lang + '：忙着的卡不显示预判（屏幕上的建议是上一轮的）', JSON.stringify(b0));
    if (lang === 'en') { ok(a0.title === 'Fill the box, edit, then send', 'en：三条的提示语是英文', a0.title); ok(errs.length === 0, 'en：预判没有页面报错', errs.join(' | ')); await ctx.close(); continue; }
    await page.locator(dc).screenshot({ path: path.join(OUT, 'suggest-wall.png') });
    await page.click(dc + ' textarea'); await page.keyboard.press('Tab'); await sleep(150); const a1 = await sgs(dc);
    ok(a1.value === SGX.ghost && a1.ghost === null && a1.focus, 'Tab：空输入框里按 Tab，收下灰字（整句进输入框），灰字让位，光标还在框里', JSON.stringify({ value: a1.value, ghost: a1.ghost, focus: a1.focus }));
    await page.fill(dc + ' textarea', ''); await sleep(100); const a2 = await sgs(dc);
    ok(a2.ghost === SGX.ghost, '把框清空：灰字又出来', JSON.stringify(a2.ghost));
    await page.fill(dc + ' textarea', '先写了一半'); await page.keyboard.press('Tab'); await sleep(150); const a3 = await sgs(dc);
    ok(a3.value === '先写了一半' && a3.ghost === null, '框里已经有字：Tab 不碰它（灰字也不显示）', JSON.stringify({ value: a3.value, ghost: a3.ghost }));
    await page.fill(dc + ' textarea', ''); await page.click(dc + ' .chip[data-sg="2"]'); await sleep(150); const c2 = await sgs(dc);
    ok(c2.value === '看一下改动' && c2.focus && sentTo.length === 0, '点第 2 条：标签填进输入框当草稿、光标进框，没有自己发出去', JSON.stringify({ value: c2.value, focus: c2.focus, sent: sentTo.length }));
    await page.fill(dc + ' textarea', ''); await page.click(dc + ' .chip[data-sg="1"]'); await sleep(150); const c1 = await sgs(dc);
    ok(c1.value === SGX.ghost, '点第 1 条：和 Tab 是同一句（终端里按 1 和按 Tab 也是同一句）', JSON.stringify(c1.value));
    await page.fill(dc + ' textarea', ''); await page.evaluate((q) => document.querySelector(q + ' textarea').blur(), dc); await page.hover(dc + ' .head'); await page.keyboard.press('3'); await sleep(150); const k3 = await sgs(dc);
    ok(k3.value === '先放着' && k3.focus, '没在打字时，鼠标停在哪张卡上，按数字键 3 就填它的第 3 条', JSON.stringify({ value: k3.value, focus: k3.focus }));
    await page.fill(dc + ' textarea', ''); await page.click(dc + ' textarea'); await page.keyboard.press('2'); await sleep(100); const k2 = await sgs(dc);
    ok(k2.value === '2', '在输入框里打字时数字就是数字（不被当成快捷键）', JSON.stringify(k2.value));
    await page.fill(dc + ' textarea', ''); await page.click(dc + ' textarea'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await sleep(800); const s1 = await sgs(dc);
    ok(sentTo.length === 1 && sentTo[0].text === SGX.ghost && sentTo[0].sid === FX.sids.done, 'Tab 收下后回车：发给服务的就是那整句', JSON.stringify(sentTo));
    ok(s1.sgHidden && s1.ghost === null, '发出去以后：这张卡上的预判马上收起（它们是上一轮的）', JSON.stringify({ sg: s1.sgHidden, ghost: s1.ghost }));
    ok(errs.length === 0, '预判：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  // 封面视图（一张一张翻）和浅色：灰字和三条的样子
  for (const scheme of ['light', 'dark']) {
    ({ ctx, page, errs } = await open({ mode: 'flow', scheme }));
    await page.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json(); for (const x of j.sessions) if (x.sid === FX.sids.done) { x.channel = 'tmux'; x.tmux = 'ccb-fake'; x.suggest = SGX; } await route.fulfill({ response: r, json: j }); });
    await sleep(2800);
    const fr = await page.evaluate((sid) => { const c = document.querySelector('.card[data-sid="' + sid + '"]'); const sg = c.querySelector('.sg'), rp = c.querySelector('.reply'); return { side: c.classList.contains('side'), sg: sg.hidden ? null : sg.getBoundingClientRect().height, above: sg.getBoundingClientRect().bottom <= rp.getBoundingClientRect().top + 1 }; }, FX.sids.done);
    if (!fr.side) { ok(fr.sg > 40 && fr.above, `封面（${scheme}）：三条在输入框上面、不压住它`, JSON.stringify(fr)); await page.screenshot({ path: path.join(OUT, `suggest-flow-${scheme}.png`) }); }
    else { const front = await page.evaluate(() => document.querySelector('.card:not(.side)').dataset.sid); await page.evaluate((sid) => { document.querySelector('.card[data-sid="' + sid + '"]').click(); }, FX.sids.done); await sleep(900);
      const fr2 = await page.evaluate((sid) => { const c = document.querySelector('.card[data-sid="' + sid + '"]'); const sg = c.querySelector('.sg'), rp = c.querySelector('.reply'); return { side: c.classList.contains('side'), sg: sg.hidden ? null : sg.getBoundingClientRect().height, above: sg.getBoundingClientRect().bottom <= rp.getBoundingClientRect().top + 1 }; }, FX.sids.done);
      ok(!fr2.side && fr2.sg > 40 && fr2.above, `封面（${scheme}）：翻到这张后三条在输入框上面、不压住它`, JSON.stringify({ front, fr2 })); await page.screenshot({ path: path.join(OUT, `suggest-flow-${scheme}.png`) }); }
    ok(errs.length === 0, `封面（${scheme}）预判：页面没有报错`, errs.join(' | ')); await ctx.close();
  }
  // ── 自动续跑（11/16 win-60）：倒数一行（青色「自动接着做」+ 秒数 + 真要发的那句 + 现在发 / 不发了）、不自动发的原因一行（灰）、「你」那一行认出自动发的话。
  //    11/17 修法 f：发出去的是固定的一句，倒数这一行显示的就是它；灰字只当依据，放在提示里
  //    重开前 ②③（11/17 总管批）+ ② v2（cc-board-9e 定）：一行里不放那句话（每张卡发的都是同一句，写出来不带信息，卡片宽度下还只露得出几个字），
  //    只剩「自动接着做 · N 秒后发 · 现在发 · 不发了」；会发的整句和依据写在整行的提示里。墙上最窄的卡也不截字。倒数的假卡是无需处理（新服务只让无需处理的倒数），截图要像真的
  //    服务端整条路在 state.test.mjs 的 [7e-2]；这里把 auto 塞进应答、拦下 /api/auto，只测界面 ──
  console.log('\n[自动续跑]');
  const AM = '【总控台自动续跑】', BODY = '（不是 Khalil 本人）接着做你上一轮自己提的下一步；要他本人听、看、点头、登录、付款、发布的事不做，停下写状态行', ATEXT = AM + BODY;   // 照抄 autopilot.mjs 的 AUTO_TEXT
  const BODY_EN = "(Not Khalil) Carry on with the next step you proposed last turn; anything he has to listen to, look at, approve, sign in, pay or publish: don't, stop and write the status line";
  const TIP = (body, basis) => '会发：' + body + '\n依据（它预判你下一句会说的，只用来判断，不会发出去）：' + basis;   // 整行的提示，两段
  const TIP_EN = (body, basis) => 'Will send: ' + body + '\nBased on (its guess at what you would say next; only used to decide, never sent): ' + basis;
  const FYI = (x) => { x.digest = { ...(x.digest || {}), need: 'fyi' }; };   // 自动续跑只会出现在无需处理的卡上
  for (const lang of ['zh', 'en']) {
    ({ ctx, page, errs } = await open({ mode: 'wall', lang })); const autoPosts = [];
    const due = Date.now() + 25000; let armAll = false;   // armAll：量宽度时把墙上每张歇着的卡都挂上倒数
    await page.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json();
      for (const x of j.sessions) {
        if (armAll && x.status === 'idle' && !x.auto && x.sid !== FX.sids.links && x.sid !== FX.sids.noneDone) { x.channel = 'tmux'; x.tmux = x.tmux || 'ccb-w' + x.sid.slice(0, 6); x.auto = { state: 'armed', text: ATEXT, basis: '量宽度', fireIn: 29500 }; }   // 30 秒：最宽的秒数
        if (x.sid === FX.sids.done) { FYI(x); x.channel = 'tmux'; x.tmux = 'ccb-fake'; x.suggest = SGX; x.auto = { state: 'armed', text: ATEXT, basis: SGX.ghost, fireIn: Math.max(0, due - Date.now()) }; }
        if (x.sid === FX.sids.links) { FYI(x); x.status = 'idle'; x.channel = 'tmux'; x.tmux = 'ccb-fake2'; x.suggest = { ghost: '现在就做外观补丁', options: [] }; x.auto = { state: 'held', why: lang === 'en' ? '这个号周额度用了 92%' : '交付写明等负责人排期' }; x.prompt = ATEXT; }
        if (x.sid === FX.sids.peerDone) { FYI(x); x.status = 'idle'; x.channel = 'tmux'; x.tmux = 'ccb-fake3'; x.auto = { state: 'armed', text: ATEXT, basis: '排在后面的一句', fireIn: 0 }; }
        if (x.sid === FX.sids.noneDone) { FYI(x); x.status = 'idle'; x.channel = 'tmux'; x.tmux = 'ccb-fake5'; x.suggest = { ghost: '我听完了，挺好，直接接进 App', options: [] }; x.auto = { state: 'held', why: '建议替你下了结论（听完了 / 可以…）' }; }   // 重开前 ①：替他下结论的灰字只是不发
        if (x.sid === FX.sids.run) { x.channel = 'tmux'; x.tmux = 'ccb-fake4'; x.auto = { state: 'armed', text: ATEXT, basis: '忙着的卡不该显示', fireIn: 5000 }; }   // run 是忙着的
      }
      await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/auto', async (route) => { autoPosts.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await sleep(2800);
    const apOf = (sid) => page.evaluate((q) => { const c = document.querySelector('.card[data-sid="' + q + '"]'); if (!c) return null; const ap = c.querySelector('.ap'), rp = c.querySelector('.reply'); if (!ap) return { missing: true };
      const t = (k) => { const e = ap.querySelector(k); return e ? e.textContent : null; };
      const tok = (v) => { const e = document.createElement('span'); e.style.color = 'var(' + v + ')'; document.body.appendChild(e); const col = getComputedStyle(e).color; e.remove(); return col; };
      const ar = ap.getBoundingClientRect(), cr = c.getBoundingClientRect();
      return { hidden: ap.hidden, cls: c.className, row: ap.hidden ? '' : ap.textContent, w: t('.apw'), sec: t('.apt'), text: t('.apx'), tipRow: ap.title, fits: !ap.hidden && ap.scrollWidth <= ap.clientWidth && [...ap.children].every((e) => e.scrollWidth <= e.clientWidth), held: t('.aph'), btns: [...ap.querySelectorAll('button')].map((b) => b.dataset.ap + ':' + b.textContent),
        above: ap.hidden || ar.bottom <= rp.getBoundingClientRect().top + 1, inCard: ap.hidden || (ar.left >= cr.left - 0.5 && ar.right <= cr.right + 0.5),
        oneLine: ap.hidden || ar.height < 40,
        wColor: ap.querySelector('.apw') ? getComputedStyle(ap.querySelector('.apw')).color : null, hColor: ap.querySelector('.aph') ? getComputedStyle(ap.querySelector('.aph')).color : null,
        accent: tok('--accent'), text3: tok('--text-3'), who: c.querySelector('.you .who') ? c.querySelector('.you .who').textContent : null, you: c.querySelector('.you') ? c.querySelector('.you').textContent : null }; }, sid);
    const dc = `.card[data-sid="${FX.sids.done}"]`;
    const a = await apOf(FX.sids.done), h = await apOf(FX.sids.links), q = await apOf(FX.sids.peerDone), b = await apOf(FX.sids.run), z = await apOf(FX.sids.noneDone);
    const secN = (x) => Number(((x && x.sec) || '').replace(/\D/g, '')) || -1;
    if (lang === 'zh') {
      ok(a && !a.hidden && a.w === '自动接着做' && /^2\d 秒后发$/.test(a.sec) && a.text === null && a.row === '自动接着做' + a.sec + '现在发不发了' && a.btns.join('|') === 'now:现在发|cancel:不发了', '倒数中的卡：输入框上方一行只有「自动接着做 · N 秒后发 · 现在发 · 不发了」，不放那句话（重开前 ② v2）', JSON.stringify(a));
      ok(a.tipRow === TIP(BODY, SGX.ghost), '整行的提示两段：「会发：」整句（含「不是 Khalil 本人」）、「依据：」灰字（11/17 修法 f、重开前 ② v2）', JSON.stringify(a.tipRow));
      ok(!a.row.includes('不是 Khalil') && !a.row.includes('接着做你上一轮') && !a.row.includes(SGX.ghost) && a.tipRow.includes(BODY), '倒数行看得见的字里没有那句话、没有「不是 Khalil」、没有灰字；提示里有整句（重开前 ② v2）', JSON.stringify([a.row, a.tipRow]));
      ok(!/s-review|s-reply/.test(a.cls) && !/s-review|s-reply/.test(q.cls), '倒数的卡是无需处理，不是待审阅 / 待跟进（新服务只让无需处理的倒数；截图里要像真的，重开前 ③）', JSON.stringify([a.cls, q.cls]));
      ok(a.above && a.inCard && a.oneLine && a.fits && q.fits, '这一行在输入框上面、在卡内、只占一行，一个字都不截（整行和每一段都是 scrollWidth ≤ clientWidth）', JSON.stringify({ above: a.above, inCard: a.inCard, oneLine: a.oneLine, fits: a.fits, qFits: q.fits }));
      ok(a.wColor === a.accent, '「自动接着做」用强调色（青），和墙上「在跑 / 交付了」同一种颜色', JSON.stringify([a.wColor, a.accent]));
      ok(h && !h.hidden && h.held === '没自动接着做：交付写明等负责人排期' && h.hColor === h.text3 && h.btns.length === 0, '不自动发的卡：一行灰字写原因，没有按钮', JSON.stringify(h));
      ok(z && !z.hidden && z.held === '没自动接着做：建议替你下了结论（听完了 / 可以…）' && z.btns.length === 0 && !/s-review|s-reply/.test(z.cls), '灰字替他下结论的卡：一行灰字写原因，卡片仍是无需处理（重开前 ①）', JSON.stringify(z));
      ok(h.who === '自动续跑' && h.you === '自动续跑' + BODY, '「你」那一行：自动发出去的话写成「自动续跑」，后面是去掉记号的那句', JSON.stringify([h.who, h.you]));
      ok(q && q.sec === '排队中' && q.row === '自动接着做排队中现在发不发了' && q.tipRow === TIP(BODY, '排在后面的一句'), '倒数到 0 还没发（全局一分钟只发一条）：写「排队中」，提示照样两段', JSON.stringify(q));
      ok(b && b.hidden, '忙着的卡：不显示自动续跑（服务给了也不显示）', JSON.stringify(b));
      await sleep(2500); const a2 = await apOf(FX.sids.done);
      ok(secN(a2) < secN(a) && secN(a2) > 0, '秒数每次轮询往下走', JSON.stringify([a.sec, a2.sec]));
      await page.locator(dc).screenshot({ path: path.join(OUT, 'auto-wall.png') });
      const clickIf = async (sel) => { try { await page.click(sel, { timeout: 3000 }); return true; } catch { return false; } };   // 按钮不在（改坏了）就记一条红，不让整套测试崩掉
      await clickIf(dc + ' .ap [data-ap="cancel"]'); await sleep(300);
      await clickIf(dc + ' .ap [data-ap="now"]'); await sleep(300);
      ok(JSON.stringify(autoPosts) === JSON.stringify([{ sid: FX.sids.done, op: 'cancel' }, { sid: FX.sids.done, op: 'now' }]), '点「不发了」/「现在发」：各发一次 /api/auto（cancel / now），带这张卡的会话号', JSON.stringify(autoPosts));
      const n0 = autoPosts.length; await page.click(dc + ' textarea'); await page.keyboard.type('我自己说'); await sleep(400);
      ok(autoPosts.length === n0 + 1 && autoPosts[n0].op === 'cancel' && autoPosts[n0].sid === FX.sids.done, '在倒数中的卡上打字：自动取消一次（打几个字都只发一次）', JSON.stringify(autoPosts.slice(n0)));
      await page.fill(dc + ' textarea', '');
    } else {
      ok(a && a.w === 'Auto-continue' && /^in 2\ds$/.test(a.sec) && a.btns.join('|') === 'now:Send|cancel:Cancel', 'en：Auto-continue · in Ns · Send · Cancel（重开前 ② v2 改短：原来的 Sends in 30s / Send now / Don\'t send 一行 340 px，墙上最窄的卡 293 px 放不下）', JSON.stringify(a));
      ok(h && h.held === 'Not auto-continued: This account is at 92% of its weekly limit' && h.who === 'Auto' && q && q.sec === 'Queued', 'en：服务给的固定原因翻成英文、「你」写 Auto、排队中写 Queued', JSON.stringify([h && h.held, h && h.who, q && q.sec]));
      ok(a && a.text === null && a.row === 'Auto-continue' + a.sec + 'Send' + 'Cancel' && h && h.you === 'Auto' + BODY_EN && a.tipRow === TIP_EN(BODY_EN, SGX.ghost) && q && q.tipRow === TIP_EN(BODY_EN, '排在后面的一句'), 'en：一行只有标签、秒数、两个按钮；「你」那一行、整行提示的两段都是英文（灰字本身是它写的，原样）', JSON.stringify([a && a.row, h && h.you, a && a.tipRow]));
      ok(z && z.held === 'Not auto-continued: The suggestion speaks for you (listened / OK…)', 'en：替他下结论的原因翻成英文（重开前 ①）', JSON.stringify(z && z.held));
      ok(a && !/Not Khalil|Carry on/.test(a.row) && a.fits && q && q.fits && a.tipRow.includes(BODY_EN), 'en：倒数行看得见的字里没有那句话、没有「Not Khalil」，不截字；提示里有整句（重开前 ② v2）', JSON.stringify([a && a.row, a && a.fits, q && q.fits, a && a.tipRow]));
      const zh = await page.evaluate(() => [...document.querySelectorAll('.ap')].filter((x) => !x.hidden).map((x) => [...x.querySelectorAll('.apw,.apt,.apx,.aph,button')].map((e) => e.textContent).join(' ')).join(' | '));
      ok(!/[一-鿿]/.test(zh), 'en：这一行里我们自己写的字（标签、秒数、按钮、固定原因）没有漏翻的中文', zh);
    }
    // 重开前 ② v2：墙上最窄的卡也一个字不截。墙在 700 / 1080 / 1500 px 换成 2 / 3 / 4 格（ui.html 的 slotsAcross），刚过这三条线时卡最窄；
    // 每个宽度把墙上每张歇着的卡都挂上倒数（30 秒，最宽的秒数），量每一行：整行和每一段 scrollWidth ≤ clientWidth、只占一行、在卡内
    armAll = true; const sweep = [];
    for (const vw of [701, 1081, 1440, 1501, 1520, 1728]) {
      await page.setViewportSize({ width: vw, height: 900 }); await sleep(2600);
      sweep.push(await page.evaluate((vw) => { let n = 0, minCard = 1e9; const bad = [];
        for (const c of document.querySelectorAll('.card')) { if (c.hidden || !c.offsetWidth) continue; const ap = c.querySelector('.ap'); if (!ap || ap.hidden || !ap.querySelector('.apw') || !ap.offsetWidth) continue;
          n++; const cr = c.getBoundingClientRect(), ar = ap.getBoundingClientRect(); minCard = Math.min(minCard, cr.width);
          const over = ap.scrollWidth > ap.clientWidth || [...ap.children].some((e) => e.scrollWidth > e.clientWidth);
          if (over || ar.height >= 40 || ar.left < cr.left - 0.5 || ar.right > cr.right + 0.5) bad.push({ card: Math.round(cr.width), row: ap.scrollWidth + '/' + ap.clientWidth, h: Math.round(ar.height), kids: [...ap.children].map((e) => e.textContent + ' ' + e.scrollWidth + '/' + e.clientWidth).join(' | ') }); }
        return { vw, n, minCard: Math.round(minCard), nBad: bad.length, bad: bad.slice(0, 2) }; }, vw));
    }
    armAll = false; await page.setViewportSize({ width: 1520, height: 900 }); await sleep(1500);
    ok(sweep.every((x) => x.n > 0 && x.nBad === 0), lang + '：墙上最窄的卡（' + Math.min(...sweep.map((x) => x.minCard)) + ' px）也放得下整行倒数：不截字、不折行、不出卡（701 / 1081 / 1440 / 1501 / 1520 / 1728 px，每个宽度量每一张，共 ' + sweep.reduce((t, x) => t + x.n, 0) + ' 行）', JSON.stringify(sweep));
    ok(errs.length === 0, lang + '：自动续跑没有页面报错', errs.join(' | ')); await ctx.close();
  }
  // ── 卡片头部不溢出（11/13 作者「修吧」）：墙上的窄卡里药丸 + 按钮排不下，按钮被切掉、点不到（英文 1520 px 时几乎每张都这样）。
  //    中英文 × 三种窗口宽：每张看得见的卡，卡头都放得下（scrollWidth ≤ clientWidth），卡头里的按钮都在卡内、都有名字（字或 aria-label）──
  for (const lang of ['zh', 'en']) for (const w of [1440, 1520, 1728]) {
    const c4 = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark' });
    await c4.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('wall')); } catch (e) {} });
    const pg = await c4.newPage(); await pg.goto(FX.url + '&lang=' + lang); await pg.waitForSelector('.card'); await sleep(2200);
    const r = await pg.evaluate(() => { const out = { n: 0, over: [], outside: [], noName: 0, iconOnly: 0, wrapped: [], chips: 0, chipBad: [], chipTrunc: [] };
      for (const el of document.querySelectorAll('.card')) { if (el.hidden || !el.offsetWidth) continue; out.n++;
        const h = el.querySelector('.chead'), cr = el.getBoundingClientRect();
        if (h.scrollWidth > h.clientWidth) out.over.push((el.querySelector('.meta') || {}).textContent + ' +' + (h.scrollWidth - h.clientWidth));
        const tops = [...h.children].filter((x) => x.offsetWidth && !x.classList.contains('mdl')).map((x) => Math.round(x.getBoundingClientRect().top + x.getBoundingClientRect().height / 2));
        const mc = h.querySelector('.mdl'); if (mc && mc.offsetWidth) { const tt = el.querySelector('.title'); if (!(mc.offsetTop >= h.offsetHeight && mc.offsetLeft >= 0 && parseFloat(getComputedStyle(tt).paddingRight) >= mc.offsetWidth + 4)) out.chipBad.push(((el.querySelector('.meta') || {}).textContent || '') + ' ' + mc.textContent); if (mc.scrollWidth > mc.clientWidth) out.chipTrunc.push(mc.textContent); out.chips++; }   // 模型胶囊不在头行的排版流里（挂在下沿），所以不算「头行换行」；它自己另查：在卡内、在头行下面、标题让出了位置
        if (Math.max(...tops) - Math.min(...tops) > 4) out.wrapped.push((el.querySelector('.meta') || {}).textContent);   // 换行只是兜底：这几种常见宽度下都该排在一行
        for (const b of h.querySelectorAll('button')) { if (!b.offsetWidth) continue; const br = b.getBoundingClientRect();   // display:none 的（比如没交付时的「审完了」）不算
          if (br.right > cr.right + 0.5 || br.left < cr.left - 0.5) out.outside.push(b.className + ':' + (b.getAttribute('aria-label') || b.textContent.trim()));
          if (!(b.getAttribute('aria-label') || b.textContent.trim())) out.noName++;
          if (b.classList.contains('go') && br.width <= 26) out.iconOnly++; } }
      return out; });
    ok(r.n > 0 && !r.over.length && !r.outside.length && !r.noName && !r.wrapped.length, lang + ' ' + w + ' px 墙：' + r.n + ' 张卡的卡头都排在一行、放得下，按钮都在卡内、都有名字（' + r.iconOnly + ' 个按钮收成了图标）', JSON.stringify({ over: r.over.slice(0, 4), outside: r.outside.slice(0, 4), noName: r.noName, wrapped: r.wrapped.slice(0, 4) }));
    ok(r.chips > 0 && !r.chipBad.length && !r.chipTrunc.length, lang + ' ' + w + ' px 墙：' + r.chips + ' 张卡的模型胶囊都在头行下面、没出卡、标题给它让出了位置、没被截断', JSON.stringify({ bad: r.chipBad.slice(0, 4), trunc: r.chipTrunc.slice(0, 4) }));
    if (lang === 'en' && w === 1520) {      // 兜底：卡再窄（硬压到 260 px），图标也排不下时换行，不切掉
      const z = await pg.evaluate(() => { let over = 0, outside = 0, n = 0;
        for (const el of document.querySelectorAll('.card')) { if (el.hidden || !el.offsetWidth) continue; el.style.width = '260px'; el.style.maxWidth = '260px'; }
        for (const el of document.querySelectorAll('.card')) { if (el.hidden || !el.offsetWidth) continue; n++; const h = el.querySelector('.chead'), cr = el.getBoundingClientRect();
          if (h.scrollWidth > h.clientWidth) over++;
          for (const b of h.querySelectorAll('button')) { if (!b.offsetWidth) continue; const br = b.getBoundingClientRect(); if (br.right > cr.right + 0.5) outside++; } }
        return { n, over, outside }; });
      ok(z.n > 0 && z.over === 0 && z.outside === 0, 'en 墙：卡硬压到 260 px 时卡头换行，不溢出、按钮不出卡', JSON.stringify(z));
    }
    await c4.close();
  }
  // 封面不变：最前面那张宽卡里「去终端」照旧带字，卡头也放得下
  for (const lang of ['zh', 'en']) {
    const c5 = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark' });
    await c5.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('flow')); } catch (e) {} });
    const pg = await c5.newPage(); await pg.goto(FX.url + '&lang=' + lang); await pg.waitForSelector('.card'); await sleep(2200);
    // 两边的卡是用 transform 缩小的，量布局宽度（offsetWidth），不量缩小后的样子
    const f = await pg.evaluate(() => { const rows = [...document.querySelectorAll('.card')].filter((x) => !x.hidden && x.offsetWidth).map((x) => {
        const h = x.querySelector('.chead'), sp = h.querySelector('.go[data-act="focus"] > span');
        return { over: h.scrollWidth - h.clientWidth, textW: sp ? sp.offsetWidth : null }; }).filter((r) => r.textW !== null);
      return { n: rows.length, over: rows.filter((r) => r.over > 0).length, narrow: rows.filter((r) => r.textW <= 20).length }; });
    ok(f.n > 0 && f.over === 0 && f.narrow === 0, lang + ' 封面：' + f.n + ' 张带「去终端」的卡都照旧带字，卡头放得下', JSON.stringify(f));
    await c5.close();
  }
  // ── 顶栏右上角的订阅额度（夹具：Claude amy 周 91% / ben 周 1%，Codex 周 34%）──
  console.log('\n[顶栏 · 订阅额度]');
  const readLimits = (page) => page.evaluate(() => {
    const bar = document.querySelector('header.bar'), lim = document.querySelector('#limits'), nb = document.querySelector('#newBtn');
    const vis = (e) => !!e && e.offsetWidth > 0;
    const chips = [...lim.querySelectorAll('.lq')].map((c) => { const m = c.querySelector('.mtr'), r = c.getBoundingClientRect(); return { text: c.textContent, warn: c.classList.contains('warn'), tip: c.title, aria: c.getAttribute('aria-label') || '', meter: vis(m), meterPos: m ? getComputedStyle(m).position : '', tag: vis(c.querySelector('.tg')), inBar: r.top >= 0 && r.bottom <= bar.clientHeight, tab: c.tabIndex };
    });
    return { shown: vis(lim), chips, over: bar.scrollWidth > bar.clientWidth, newIn: nb.getBoundingClientRect().right <= innerWidth };
  });
  for (const [lang, w] of [['zh', 1520], ['en', 1520], ['zh', 1100], ['zh', 960]]) {
    const { ctx, page, errs } = await open({ mode: 'flow', lang, w }); const r = await readLimits(page); const tag = lang + ' ' + w + ' px';
    const names = r.chips.map((c) => c.text);
    if (w >= 1500) {
      same(names, ['Claude · amy91%', 'Claude · ben1%', 'Codex34%'], tag + '：三条额度，两个 Claude 号带账号、Codex 一条（周额度的百分数）', JSON.stringify(names));
      ok(r.chips.length === 3 && r.chips[0].warn && !r.chips[1].warn && !r.chips[2].warn, tag + '：只有用到 91% 的那条是琥珀色（≥ 85%），1% 和 34% 是灰的', JSON.stringify(r.chips.map((c) => c.warn)));
      ok(r.chips.length === 3 && r.chips.every((c) => c.meter && c.tag === (c.text.includes('·')) && c.inBar && c.tab === 0), tag + '：进度条和账号后缀都在、胶囊整个在顶栏里、能用 Tab 聚焦', JSON.stringify(r.chips.map((c) => [c.meter, c.tag, c.inBar, c.tab])));
      ok(r.chips.length === 3 && r.chips.every((c) => c.meterPos !== 'fixed'), tag + '：进度条不吃顶栏 .bar 的 position:fixed（同名的类曾把它钉到屏幕顶上）', JSON.stringify(r.chips.map((c) => c.meterPos)));
      const t0 = r.chips[0] ? r.chips[0].tip : '';
      ok(lang === 'zh' ? /周额度已用 91%.*重置（.*后）/.test(t0) && /5 小时额度已用 100%/.test(t0) && /更新于 /.test(t0) : /Weekly limit used: 91%.*resets .*\(in .*\)/.test(t0) && /5-hour limit used: 100%/.test(t0) && /Updated /.test(t0), tag + '：提示里有每个窗口的已用、重置时间和还剩多久、数据多久前的', JSON.stringify(t0));
      ok(r.chips[2] && /prolite/.test(r.chips[2].tip), tag + '：Codex 的提示里带套餐名', JSON.stringify(r.chips[2] && r.chips[2].tip));
      if (lang === 'en') ok(!r.chips.some((c) => /[一-鿿]/.test(c.text + c.tip + c.aria)), 'en 1520 px：额度条的文字、提示、读屏标签里没有漏翻的中文', JSON.stringify(r.chips.map((c) => c.tip)));
    } else if (w === 1100) {
      ok(r.shown && r.chips.length === 3 && r.chips.every((c) => !c.meter && !c.tag), tag + '：窗口窄了先去掉进度条和账号后缀，三条还在', JSON.stringify(r.chips.map((c) => [c.text, c.meter, c.tag])));
    } else {
      ok(!r.shown, tag + '：再窄（≤ 1000 px）整条让位给按钮', JSON.stringify(r.shown));
    }
    ok(!r.over && r.newIn && errs.length === 0, tag + '：顶栏不溢出、「新任务」在视口里、页面没报错', JSON.stringify({ over: r.over, newIn: r.newIn, errs }));
    if (lang === 'zh' && w === 1520) await page.screenshot({ path: path.join(OUT, 'topbar-limits.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } });
    await ctx.close();
  }
  // ── 过时的额度（11/16 win-ee）：超过 1 小时没更新的那格变灰、写「N 小时前」、不亮琥珀（额度用完以后顶栏还写着前一天的旧数）。
  //    夹具的取数文件都是刚写的，这里在浏览器里直接喂 paintLimits 一份造的数据，读画出来的 DOM。
  //    A 是真实会有的组合（两个 Claude 号一旧一新 + 一个几小时没用的 Codex），查顶栏放得下；B 查 3 天前和没有窗口的那格 ──
  console.log('\n[顶栏 · 过时的额度]');
  const paintStale = (page, set) => page.evaluate((set) => {
    const now = Date.now(), H = 3600000, wk = (u) => [{ key: 'week', used: u, resetsAt: now + 86400000 }];
    const mk = (id, ago, u, ws, provider = 'claude') => ({ id, provider, account: provider === 'claude' ? id : undefined, name: provider === 'claude' ? id : undefined, at: now - ago, windows: ws || wk(u) });
    const sets = { A: { claude: [mk('old', 3 * H + 60000, 91), mk('new', 59 * 60000, 91)], codex: mk('codex', 5 * H + 60000, 34, null, 'codex') }, B: { claude: [mk('days', 3 * 86400000, 40), mk('empty', 5 * H, 0, [])], codex: null } };
    window.__staleSt = { now, limits: sets[set] }; paintLimits(window.__staleSt);
    const bar = document.querySelector('header.bar'), nb = document.querySelector('#newBtn');
    return { over: bar.scrollWidth > bar.clientWidth, newIn: nb.getBoundingClientRect().right <= innerWidth, chips: Object.fromEntries([...document.querySelectorAll('#limits .lq')].map((c) => { const a = c.querySelector('.ago'), r = c.getBoundingClientRect(); return [c.dataset.lq, { stale: c.classList.contains('stale'), warn: c.classList.contains('warn'), ago: a && a.offsetWidth > 0 ? a.textContent : null, op: +getComputedStyle(c).opacity, tip: c.title, inBar: r.bottom <= bar.clientHeight }]; })) };
  }, set);
  for (const lang of ['zh', 'en']) {
    const { ctx, page, errs } = await open({ mode: 'flow', lang, w: 1520 }); const tag = lang + ' 1520 px', en = lang === 'en';
    const a = await paintStale(page, 'A'), c = a.chips;
    ok(c.old && c.old.stale && !c.old.warn && c.old.ago === (en ? '3h ago' : '3 小时前') && c.old.op > 0.5 && c.old.op < 0.9, tag + '：3 小时没更新的那格变灰（不透明度 0.5–0.9，还读得清）、写着「3 小时前」、91% 也不亮琥珀', JSON.stringify(c.old));
    ok(c.old && (en ? /over an hour/.test(c.old.tip) : /超过 1 小时/.test(c.old.tip)), tag + '：过时那格的提示里说明数字可能已经变了', JSON.stringify(c.old && c.old.tip));
    ok(c.new && !c.new.stale && c.new.warn && c.new.ago === null && c.new.op === 1, tag + '：59 分钟前更新的照旧（不灰、91% 亮琥珀、不写多久前）', JSON.stringify(c.new));
    ok(c.codex && c.codex.stale && c.codex.ago === (en ? '5h ago' : '5 小时前'), tag + '：5 小时没用的 Codex 同样变灰写「5 小时前」', JSON.stringify(c.codex));
    ok(!a.over && a.newIn && Object.values(c).every((x) => x.inBar), tag + '：两个 Claude 号 + Codex、两格带「N 小时前」时顶栏放得下，「新任务」在视口里', JSON.stringify({ over: a.over, newIn: a.newIn }));
    if (lang === 'zh') { await page.evaluate(() => paintLimits(window.__staleSt)); await page.screenshot({ path: path.join(OUT, 'topbar-limits-stale.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } }); }
    const b = (await paintStale(page, 'B')).chips;
    ok(b.days && b.days.stale && b.days.ago === (en ? '3d ago' : '3 天前'), tag + '：3 天没更新写「3 天前」', JSON.stringify(b.days));
    ok(b.empty && !b.empty.stale && b.empty.ago === null, tag + '：没有额度窗口的那格不算过时（本来就写「—」）', JSON.stringify(b.empty));
    ok(errs.length === 0, tag + '（过时的额度）：页面没报错', JSON.stringify(errs));
    await ctx.close();
  }
  {
    const { ctx, page, errs } = await open({ mode: 'flow', lang: 'zh', w: 1100 }); const a = await paintStale(page, 'A'), c = a.chips;
    ok(c.old && c.old.stale && c.old.ago === null && c.codex && c.codex.ago === null && !a.over && a.newIn && errs.length === 0, 'zh 1100 px：窄了「N 小时前」跟账号后缀一起藏起来，过时的照样是灰的，顶栏不溢出', JSON.stringify({ old: c.old, over: a.over, newIn: a.newIn, errs }));
    await ctx.close();
  }
  }   // UI_ONLY=org：到这里为止的整段不跑
  // ── 架构（11/16 win-a0）：窗口之间谁归谁管，画成一张从上往下的架构图。上下级由服务端的 org 定（org.mjs），界面只照着画。
  //    夹具（test/CLAUDE.md「架构场景」）：总管 projC（第 3 代，总控台列，列里没有别人）；其他列：负责人 peerDone，下面 hint（它开的）、unfin（听它的）、
  //    done（原来听前任 askQ、跟着岗位过来）、askQ（前任，排最后、淡一点）；intr 在 unfin 下面（两层）；run 在跑、这一轮是 peerDone 派的、2 个子 agent；
  //    links 名字里带「总管」但只是普通窗口；其余没有上级 = 你直接带。期望值从 /api/state 原始数据另算，不读界面自己的模型 ──
  console.log('\n[架构]');
  const tryEval = (pg, fn, arg) => pg.evaluate(fn, arg).catch((e) => ({ err: String(e).slice(0, 160) }));
  const orgOf = (pg) => tryEval(pg, (sids) => {
    const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k])), O = document.querySelector('#org'), nodes = {};
    for (const b of document.querySelectorAll('#org .onode')) {
      const sid = b.dataset.sid, li = b.closest('.oli'), up = li && li.parentElement && li.parentElement.closest('.oli'), col = b.closest('.ocol'), grp = b.closest('.ogrp'), rl = b.querySelector('.orole'), r = b.getBoundingClientRect(), q = (s) => (b.querySelector(s) || {}).textContent || '';
      nodes[name[sid] || sid] = { cls: b.className, title: q('.ot'), role: rl && getComputedStyle(rl).display !== 'none' ? rl.textContent : '', br: q('.obr'), word: q('.ow'), l2: q('.o2'), l3: q('.o3'),
        parent: up ? name[up.dataset.sid] || up.dataset.sid : null, col: col ? col.dataset.key : b.closest('.ochief') ? 'top' : null, grp: grp ? grp.dataset.g : null,
        kids: li && li.querySelector(':scope > .okids') ? [...li.querySelector(':scope > .okids').children].map((x) => name[x.dataset.sid] || x.dataset.sid) : [],
        left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), op: +getComputedStyle(b).opacity,
        anim: b.querySelector('.meta') ? getComputedStyle(b.querySelector('.meta'), '::before').animationName : '', hot: b.classList.contains('hot'), ping: b.classList.contains('ping') };
    }
    const cols = [...document.querySelectorAll('#org .ocol')].map((c) => { const r = c.getBoundingClientRect(); return { key: c.dataset.key, head: (c.querySelector('.ghead') || {}).textContent || '', labs: [...c.querySelectorAll('.olab')].map((x) => x.textContent),
      top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), hot: (c.querySelector('.olines path.eh') || { getAttribute: () => '' }).getAttribute('d') || '',
      sp: (c.querySelector('.olines path.sb') || { getAttribute: () => '' }).getAttribute('d') || '', sph: (c.querySelector('.olines path.sh') || { getAttribute: () => '' }).getAttribute('d') || '',
      font: getComputedStyle(c.querySelector('.ghead') || c).fontFamily, kids: { lead: [...c.querySelectorAll('.ogrp[data-g="lead"] > .otree > .oli')].map((x) => name[x.dataset.sid] || x.dataset.sid), chief: [...c.querySelectorAll('.ogrp[data-g="chief"] > .otree > .oli')].map((x) => name[x.dataset.sid] || x.dataset.sid), you: [...c.querySelectorAll('.ogrp[data-g="you"] > .otree > .oli')].map((x) => name[x.dataset.sid] || x.dataset.sid) } }; });
    const you = O && O.querySelector('.oyou'), tip = document.querySelector('#otip'), m = document.querySelector('main');
    return { on: document.body.classList.contains('org'), shown: !!O && getComputedStyle(O).display !== 'none', stage: getComputedStyle(document.querySelector('#stage')).display,
      youName: you ? (you.querySelector('b') || {}).textContent : '', youLine: you ? (you.querySelector('span') || {}).textContent : '', youHot: !!you && you.classList.contains('hot'),
      youLine2: you ? (you.querySelector('.oyn2') || {}).textContent || '' : '', youRun: you && you.querySelector('.orun') ? [you.querySelector('.orun').textContent, getComputedStyle(you.querySelector('.orun')).color] : null,
      youAct: you && you.querySelector('.oact') ? [you.querySelector('.oact').textContent, getComputedStyle(you.querySelector('.oact')).color] : null,
      ink: (() => { const t = document.createElement('i'); document.body.appendChild(t); const c = (v) => { t.style.color = 'var(' + v + ')'; return getComputedStyle(t).color; }; const o = { accent: c('--accent'), attn: c('--attn') }; t.remove(); return o; })(),
      tip: tip && !tip.hidden ? tip.textContent : '', busHot: (document.querySelector('#org .obus path.hot') || { getAttribute: () => '' }).getAttribute('d') || '',
      trunkHot: [...document.querySelectorAll('#org .ovl')].map((x) => x.classList.contains('hot')), nodes, cols, sw: document.documentElement.scrollWidth, vw: innerWidth, mainSW: m.scrollWidth - m.clientWidth };
  }, FX.sids);
  // 期望值：直接从 /api/state 的原始数据数，不经过界面的任何函数
  const rawOrg = async (pg) => { const j = await tryEval(pg, () => api('/api/state?peek=1')); const N = (j.org && j.org.nodes) || {}, ch = j.org && j.org.chief;
    const you = (j.sessions || []).filter((s) => s.sid !== ch && !(N[s.sid] && N[s.sid].boss) && !(N[s.sid] && N[s.sid].role === 'lead')).length;
    const withBoss = (j.sessions || []).filter((s) => N[s.sid] && N[s.sid].boss).length;
    return { n: (j.sessions || []).length, you, chief: ch, direct: (j.sessions || []).length - withBoss, withBoss, at: Object.fromEntries((j.sessions || []).map((s) => [s.sid, s.startedAt])), role: Object.fromEntries(Object.entries(N).map(([k, v]) => [k, v.role])) }; };
  // 期望的先后：照墙上卡片自己的 class 分档（琥珀 0 → 在跑 1 → 待审阅 2 → 其余 3），同一档按 /api/state 的开的时间，前任最后；不经过架构图的排序函数
  const bucketsOf = (pg) => tryEval(pg, (sids) => { const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k])), o = {};
    for (const c of document.querySelectorAll('#stage .card')) { if (/^[xp]:/.test(c.dataset.sid)) continue; const k = c.className; o[name[c.dataset.sid] || c.dataset.sid] = /(^| )alert( |$)|s-reply|s-ask/.test(k) ? 0 : /s-busy|(^| )bg( |$)/.test(k) ? 1 : /s-review/.test(k) ? 2 : 3; }
    return o; }, FX.sids);
  const sortWant = (list, bk, raw) => list.slice().sort((a, b) => (raw.role[FX.sids[a]] === 'former') - (raw.role[FX.sids[b]] === 'former') || bk[a] - bk[b] || raw.at[FX.sids[a]] - raw.at[FX.sids[b]]);
  // 悬停提示的几何：骑在被悬停方块的下边线上、靠右，不碰到它下面的任何标题行 / 组名 / 列头
  const tipGeo = (pg, sid) => tryEval(pg, (sid) => {
    const b = document.querySelector('#org .onode[data-sid="' + sid + '"]'), t = document.querySelector('#otip'); if (!b || !t || t.hidden) return null;
    const r = b.getBoundingClientRect(), q = t.getBoundingClientRect(), col = b.closest('.ocol') || document.querySelector('#org');
    const below = [...col.querySelectorAll('.onode .o1, .olab, .ghead')].map((e) => e.getBoundingClientRect()).filter((e) => e.top >= r.bottom - 0.5 && e.left < q.right && e.right > q.left);
    return { top: Math.round(q.top - r.bottom), bottom: Math.round(q.bottom - r.bottom), mid: Math.round((q.top + q.bottom) / 2 - r.bottom), right: Math.round(r.right - q.right), h: Math.round(q.height),
      hit: below.filter((e) => e.top < q.bottom - 0.5 && e.bottom > q.top + 0.5).length, next: below.length ? Math.round(Math.min(...below.map((e) => e.top)) - r.bottom) : null,
      names: [...t.querySelectorAll('.nw')].map((e) => [e.textContent, e.getClientRects().length]) };
  }, sid);
  // 竖线（列头接到负责人 / 总管带）：起点在列顶 y = 0、和总线的落线同一根；每一段横线的终点（换算成相对某个方块的位置）
  const spineOf = (pg, sid, cls = 'sb') => tryEval(pg, ([sid, cls]) => {
    const b = document.querySelector('#org .onode[data-sid="' + sid + '"]'), col = b && b.closest('.ocol'), row = document.querySelector('#org .orow'); if (!col) return null;
    const cr = col.getBoundingClientRect(), br = b.getBoundingClientRect(), rr = row.getBoundingClientRect(), d = (col.querySelector('.olines path.' + cls) || { getAttribute: () => '' }).getAttribute('d') || '', bus = (row.querySelector('.obus path') || { getAttribute: () => '' }).getAttribute('d') || '';
    const m = d.match(/^M(-?[\d.]+) (-?[\d.]+)/), ends = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)/g)].map((x) => [Math.round(+x[3] + cr.left - br.left), Math.round(+x[2] + cr.top - br.top)]);
    const drops = [...bus.matchAll(/M(-?[\d.]+) 0V22/g)].map((x) => +x[1] + rr.left);
    return { d: d.length, y0: m ? +m[2] : null, drop: !!m && drops.some((x) => Math.abs(x - (+m[1] + cr.left)) <= 1), colTop: Math.round(cr.top - rr.top), ends };
  }, [sid, cls]);
  const onBox = (sp) => !!sp && sp.ends.some(([dx, dy]) => Math.abs(dx) <= 1 && dy >= 7 && dy <= 27);
  const hoverTip = async (pg, sid) => { const sel = '#org .onode[data-sid="' + sid + '"]'; if (!(await pg.$(sel))) return null; await pg.hover(sel); await sleep(250); return orgOf(pg); };
  {
    // 入口：点「架构」切过去。不用 open()：它的 initScript 每次载入都把 ccb_mode 写回去，测不了「重开还在」
    ctx = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 2 }); page = await ctx.newPage(); errs = [];
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(FX.url + '&lang=zh'); await page.waitForSelector('.card'); await sleep(2600);
    await tryEval(page, () => { const b = document.querySelector('#modes [data-mode="wall"]'); if (b) b.click(); }); await sleep(1200);
    const wallFont = await tryEval(page, () => { const h = document.querySelector('.gcol .ghead'); return h ? getComputedStyle(h).fontFamily : null; });
    const btn = await tryEval(page, () => { const b = document.querySelector('#modes [data-mode="org"]'); if (b) b.click(); return b ? b.textContent : null; }); await sleep(1500);
    let g = await orgOf(page); const saved = await tryEval(page, () => localStorage.getItem('ccb_mode'));
    ok(btn === '架构' && g.on && g.shown && g.stage === 'none' && saved === '"org"', '架构：「封面 / 墙」旁边多了第三个「架构」，点了切过去（墙的卡片藏起来、架构图出来），选择记在本机', JSON.stringify({ btn, on: g.on, shown: g.shown, stage: g.stage, saved }));
    await page.reload(); await page.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(2400); g = await orgOf(page);
    ok(g.on && g.nodes.done && g.nodes.done.title === 'w-done', '架构：重开总控台还在架构视图，窗口都画出来了（等的是窗口的标题，不是空容器）', JSON.stringify({ on: g.on, done: g.nodes.done && g.nodes.done.title }));
    const raw = await rawOrg(page);
    const cnt = await tryEval(page, () => { const cs = [...document.querySelectorAll('#stage .card')].filter((c) => !/^[xp]:/.test(c.dataset.sid));       // 墙上那套卡片自己的 class（paint 照常给它们算），不经过架构图的代码
      return { run: cs.filter((c) => /s-busy|(^| )bg( |$)/.test(c.className)).length, act: cs.filter((c) => /(^| )alert( |$)|s-reply|s-ask/.test(c.className)).length }; });
    ok(Object.keys(g.nodes).length === raw.n && raw.n === 30 && !g.nodes.gone, '架构：墙上 30 个会话每个画一个方块（进程退出的那张卡不画）', 'nodes=' + Object.keys(g.nodes).length + ' raw=' + raw.n);
    ok(g.youName === '你' && g.youLine === raw.n + ' 个窗口 · ' + cnt.run + ' 个在跑 · ' + cnt.act + ' 件事等你' && cnt.act > 0 && cnt.run > 0, '架构：最上面是「你」，一句平常话写有几个窗口、几个在跑、几件事等你（在跑 = 墙上卡片的运行中，等你 = 要你处理的那类：停住了 / 待跟进 / 等你选）', JSON.stringify({ name: g.youName, line: g.youLine, cnt }));
    const ch = g.nodes.projC || {};
    ok(raw.chief === FX.sids.projC && ch.col === 'top' && ch.role === '总管' && /第 3 代/.test(ch.br) && Object.values(g.nodes).filter((x) => x.title === 'w-projC').length === 1, '架构：总管 projC 画在「你」下面，标「总管」和「第 3 代」，列里不再重复画它', JSON.stringify(ch));
    ok(g.cols.map((c) => c.key).join() === 'other,fretflow' && /^其他\s*28$/.test(g.cols[0].head) && /^FretFlow\s*1$/.test(g.cols[1].head), '架构：一个项目一列，名字和顺序和墙上一样（其他 28、FretFlow 1）；总控台列里只有总管（画在上面了），这一列不出', JSON.stringify(g.cols.map((c) => [c.key, c.head])));
    const pd = g.nodes.peerDone || {};
    ok(pd.col === 'other' && pd.grp === 'lead' && pd.role === '负责人' && pd.br === '带 4 个', '架构：负责人 peerDone 在其他列最上面一组，标「负责人」，右边写「带 4 个」', JSON.stringify(pd));
    ok(pd.kids && pd.kids.length === 4 && [...pd.kids].sort().join() === 'askQ,done,hint,unfin' && pd.kids[3] === 'askQ' && (g.nodes.intr || {}).parent === 'unfin' && (g.nodes.hint || {}).parent === 'peerDone' && (g.nodes.done || {}).parent === 'peerDone',
      '架构：hint（它开的）、unfin（听它的）、done（跟着岗位过来的）挂在负责人下面，前任 askQ 排最后；intr 在 unfin 下面（两层）', JSON.stringify({ kids: pd.kids, intr: (g.nodes.intr || {}).parent }));
    const bk = await bucketsOf(page), oc = g.cols.find((c) => c.key === 'other') || { kids: { you: [] } };
    const wantKids = sortWant(pd.kids || [], bk, raw), wantYou = sortWant(oc.kids.you, bk, raw);
    ok(JSON.stringify(pd.kids) === '["unfin","hint","done","askQ"]' && JSON.stringify(pd.kids) === JSON.stringify(wantKids) && oc.kids.you.length === 22 && JSON.stringify(oc.kids.you) === JSON.stringify(wantYou) && bk[oc.kids.you[0]] === 0,
      '架构：同一个上级下面按状态排：要你动手的（琥珀）→ 在跑 → 待审阅 → 其余，同一档按开的先后，前任最后（负责人下面 unfin → hint → done → askQ；你直接带的 22 个和照墙上卡片状态另排的一样）', JSON.stringify({ kids: pd.kids, wantKids, you: oc.kids.you, wantYou }));
    await sleep(3200); const g2 = await orgOf(page), oc2 = (g2.cols || []).find((c) => c.key === 'other') || {};
    ok(JSON.stringify(oc2.kids) === JSON.stringify(oc.kids) && JSON.stringify((g2.nodes.peerDone || {}).kids) === JSON.stringify(pd.kids), '架构：状态没变时，隔两次轮询顺序一样（不会每次都跳）', JSON.stringify({ before: oc.kids, after: oc2.kids }));
    ok(g.youRun && g.youRun[0] === String(cnt.run) && g.youRun[1] === g.ink.accent && g.youAct && g.youAct[0] === String(cnt.act) && g.youAct[1] === g.ink.attn && g.youLine2 === raw.direct + ' 个你直接带 · ' + raw.withBoss + ' 个有窗口在带' && raw.direct === 24 && raw.withBoss === 6,
      '架构：「你」第一行在跑的数青色、等你的数琥珀色；第二行「24 个你直接带 · 6 个有窗口在带」（从 /api/state 的 boss 另数，加起来是窗口数）', JSON.stringify({ run: g.youRun, act: g.youAct, ink: g.ink, l2: g.youLine2, raw: [raw.direct, raw.withBoss] }));
    const z0 = await tryEval(page, () => { const d = document.createElement('div'); d.innerHTML = orgYouLine(30, 0, 0); return { text: d.textContent, run: !!d.querySelector('.orun'), act: !!d.querySelector('.oact') }; });
    ok(z0.text === '30 个窗口 · 0 个在跑 · 没有事等你' && !z0.run && !z0.act, '架构：数是 0 时不着色（0 个在跑、没有事等你）', JSON.stringify(z0));
    ok(!!wallFont && g.cols.length === 2 && g.cols.every((c) => c.font === wallFont), '架构：列头的字体和墙上的列头同一套（墙上列头本来就是等宽字体，照墙）', JSON.stringify({ wall: wallFont, org: g.cols.map((c) => c.font) }));
    const sp0 = await spineOf(page, FX.sids.peerDone);
    ok(sp0 && sp0.y0 === 0 && sp0.drop && sp0.colTop === 22 && onBox(sp0), '架构：有负责人的列，列头上那根竖线接着往下，落到负责人方块上（标题那一行），和总线的落线是同一根', JSON.stringify(sp0));
    const ind1 = (g.nodes.hint || {}).left - pd.left, ind2 = (g.nodes.intr || {}).left - (g.nodes.unfin || {}).left;
    ok(ind1 >= 16 && ind1 <= 28 && ind2 === ind1, '架构：下级缩进一层，下级的下级再缩进一层（每层一样宽）', JSON.stringify({ ind1, ind2 }));
    const aq = g.nodes.askQ || {};
    ok(aq.role === '前任' && /former/.test(aq.cls) && aq.op >= 0.6 && aq.op <= 0.85, '架构：前任 askQ 标「前任」，整体淡一点但字照样读得清（不透明度 0.6–0.85）', JSON.stringify({ role: aq.role, op: aq.op }));
    ok(g.nodes.links && g.nodes.links.role === '' && g.nodes.links.grp === 'you' && !Object.values(g.nodes).some((x) => x !== ch && x.role === '总管'), '架构：links 名字里带「总管」，只是普通窗口：没有职级标签，在「你直接带」里', JSON.stringify(g.nodes.links));
    const youLabs = g.cols.flatMap((c) => c.labs.filter((l) => /^你直接带 · \d+$/.test(l)).map((l) => [c.key, +l.split(' · ')[1]]));
    ok(raw.you === 23 && youLabs.reduce((a, x) => a + x[1], 0) === raw.you && JSON.stringify(youLabs) === '[["other",22],["fretflow",1]]' && !g.cols.some((c) => c.labs.some((l) => /^总管带/.test(l))),
      '架构：「你直接带 · N」的个数和 /api/state 里没有上级的窗口一样（其他 22、FretFlow 1，共 23）；没有总管直接带的，就不出「总管带」这一组', JSON.stringify({ raw: raw.you, youLabs }));
    const nd = g.nodes;
    ok(nd.done && nd.done.word === '待审阅' && nd.done.l2.includes('总结写好了。') && nd.limit && nd.limit.word === '停住了' && nd.run && nd.run.word === '运行中', '架构：第二行是状态词 + 墙上卡片同一句话（done 待审阅「总结写好了。」、limit 停住了、run 运行中）', JSON.stringify([nd.done && nd.done.l2, nd.limit && nd.limit.l2, nd.run && nd.run.l2]));
    ok(nd.run && /2 个子 agent 在跑/.test(nd.run.l3) && /win-p2 派的/.test(nd.run.l3) && nd.hint && /你派的/.test(nd.hint.l3) && nd.done && /上下文 4\.1 万/.test(nd.done.l3) && !/派的/.test(nd.done.l3) && nd.limit && /上下文 7000/.test(nd.limit.l3) && /Fable 5\.2/.test(nd.done.l3),
      '架构：第三行写模型、上下文、几个子 agent 在跑；在跑的写这一轮是谁派的（run：win-p2 派的；hint：你派的），歇着的不写', JSON.stringify([nd.run && nd.run.l3, nd.hint && nd.hint.l3, nd.done && nd.done.l3, nd.limit && nd.limit.l3]));
    ok(nd.done && nd.done.h > 0 && nd.done.h <= 80, '架构：一个窗口的方块比墙上的卡片矮得多（≤ 80 px），三十多个一屏多一点就看完', 'h=' + (nd.done && nd.done.h));
    const live = await tryEval(page, () => { const o = document.querySelector('#org'); if (!o) return null; const bad = [];
      for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (!t || !o.contains(t) || a.playState !== 'running') continue; const n = t.closest('.onode'); if (!n || !/s-busy|(^| )bg( |$)/.test(n.className)) bad.push((n && n.dataset.sid) || t.className); }
      return bad; });
    ok(nd.run && nd.run.anim === 'live' && nd.bg && nd.bg.anim === 'live' && nd.done && nd.done.anim === 'none' && Array.isArray(live) && live.length === 0, '架构：状态点沿用墙上卡片的样子，在跑的点在呼吸；不在跑的窗口没有任何持续动画', JSON.stringify({ run: nd.run && nd.run.anim, done: nd.done && nd.done.anim, bad: live }));
    ok(g.sw <= g.vw && g.mainSW <= 0, '架构：1520 px 宽整页不横向溢出（列放得下就不横着滚；放不下也只有列区域自己滚）', JSON.stringify({ sw: g.sw, vw: g.vw, mainSW: g.mainSW }));
    await page.screenshot({ path: path.join(OUT, 'org-dark.png') });
    // 悬停：它往上一直到「你」的汇报线加重，同时提示依据（一句人话）
    const tips = {};
    for (const n of ['hint', 'unfin', 'done', 'peerDone', 'askQ', 'links', 'intr', 'projC']) { const h = await hoverTip(page, FX.sids[n]); tips[n] = h && h.tip; }
    ok(tips.hint === 'win-p2 开的窗口' && /^最近 3 条消息来自 win-p2，最近一条 (\d+ 分钟前|\d+ 小时前|刚刚)$/.test(tips.unfin || '') && tips.done === '原来听前任的，换代后跟着岗位归 win-p2' && tips.peerDone === '项目负责人，归总管' && tips.askQ === '已交接给 win-p2' && tips.links === '没有窗口在管它，你自己在带' && /^最近 3 条消息来自 w-unfin，/.test(tips.intr || '') && tips.projC === '总管，直接归你',
      '架构：悬停提示依据：开的窗口 / 最近 N 条消息来自谁 / 换代后跟着岗位 / 项目负责人归总管 / 已交接给现任 / 你自己在带', JSON.stringify(tips));
    await hoverTip(page, FX.sids.hint); const tg1 = await tipGeo(page, FX.sids.hint);
    ok(tg1 && tg1.h <= 22 && tg1.top < 0 && tg1.bottom > 0 && Math.abs(tg1.mid) <= 2 && Math.abs(tg1.right - 10) <= 2 && tg1.hit === 0 && tg1.bottom <= tg1.next,
      '架构：悬停提示骑在被悬停方块的下边线上、靠右（竖直方向以下边线为中心），只盖下内边距和两个方块之间的空隙，不碰下一个方块的标题行', JSON.stringify(tg1));
    await hoverTip(page, FX.sids.askQ); const tg2 = await tipGeo(page, FX.sids.askQ);
    ok(tg2 && tg2.top < 0 && tg2.bottom > 0 && tg2.hit === 0, '架构：下面紧跟着组名「你直接带」的方块，提示也不盖住组名', JSON.stringify(tg2));
    const hv = await hoverTip(page, FX.sids.intr);
    const hotSet = hv && Object.entries(hv.nodes).filter(([, x]) => x.hot).map(([k]) => k).sort().join();
    const sph = await spineOf(page, FX.sids.peerDone, 'sh');
    ok(hv && hotSet === 'intr,peerDone,projC,unfin' && hv.youHot && hv.trunkHot.every(Boolean) && hv.busHot.length > 0 && hv.cols[0].hot.split('M').length - 1 === 2 && onBox(sph), '架构：悬停 intr → intr、unfin、peerDone、总管 projC 和「你」这一串加重，两层的连线、列和总管之间的线都加重，别的不变', JSON.stringify(hv && { hotSet, you: hv.youHot, trunk: hv.trunkHot, bus: hv.busHot, col: hv.cols[0] && hv.cols[0].hot }));
    await page.screenshot({ path: path.join(OUT, 'org-hover.png') });
    const hl = await hoverTip(page, FX.sids.links);
    const hotL = hl && Object.entries(hl.nodes).filter(([, x]) => x.hot).map(([k]) => k).join();
    ok(hl && hotL === 'links' && hl.youHot && !hl.trunkHot.some(Boolean) && hl.busHot === '' && hl.cols[0].hot === '' && hl.cols[0].sph === '', '架构：悬停「你直接带」的 links → 只有它和「你」加重，不经过总管那条线（它不归总管）', JSON.stringify(hl && { hotL, you: hl.youHot, trunk: hl.trunkHot, bus: hl.busHot }));
    await page.mouse.move(5, 300); await sleep(200);
    const hn = await orgOf(page);
    ok(!Object.values(hn.nodes).some((x) => x.hot) && !hn.youHot && hn.tip === '', '架构：鼠标移开，加重和提示都收起', JSON.stringify({ hot: Object.entries(hn.nodes).filter(([, x]) => x.hot).map(([k]) => k), tip: hn.tip }));
    const kb = await tryEval(page, (sid) => { const b = document.querySelector('#org .onode[data-sid="' + sid + '"]'); if (!b) return null; b.focus(); return { tip: (document.querySelector('#otip') || {}).textContent, hidden: (document.querySelector('#otip') || {}).hidden, hot: b.classList.contains('hot') }; }, FX.sids.hint);
    ok(kb && kb.hot && !kb.hidden && kb.tip === 'win-p2 开的窗口', '架构：用键盘聚焦到一个窗口，和悬停一样加重并提示依据', JSON.stringify(kb));
    // 点一个窗口 = 和墙上放大看是同一个动作；双击不会开了又关
    await page.mouse.move(5, 300);
    const dsel = '#org .onode[data-sid="' + FX.sids.done + '"]';
    if (await page.$(dsel)) await page.click(dsel); await sleep(500);
    const z1 = await tryEval(page, () => ({ open: document.querySelector('#detail').open, title: document.querySelector('#dTitle').textContent }));
    await page.keyboard.press('Escape'); await sleep(300);
    if (await page.$(dsel)) await page.dblclick(dsel); await sleep(600);
    const z2 = await tryEval(page, () => ({ open: document.querySelector('#detail').open, title: document.querySelector('#dTitle').textContent }));
    await page.keyboard.press('Escape'); await sleep(300);
    ok(z1.open && z1.title === 'w-done' && z2.open && z2.title === 'w-done', '架构：点一个窗口就放大看它（和墙上放大看同一个大窗口）；双击也不会刚打开就被第二下关掉', JSON.stringify([z1, z2]));
    // 「消息飞过去」的判断：直接喂前后两份状态
    const fl = await tryEval(page, () => {
      const st = (now, nodes) => ({ now, org: { chief: null, gen: null, nodes } }), n = (from) => ({ role: 'member', boss: null, from });
      return { first: orgFlights(null, st(1000, { b: n([['a', 3, 900]]) })), same: orgFlights(st(1000, { b: n([['a', 3, 900]]) }), st(2000, { b: n([['a', 3, 900]]) })),
        bump: orgFlights(st(1000, { b: n([['a', 3, 900]]) }), st(2000, { b: n([['a', 4, 1500]]) })), fresh: orgFlights(st(1000, { b: n([['a', 3, 900]]) }), st(2000, { b: n([['c', 1, 1800], ['a', 3, 900]]) })),
        stale: orgFlights(st(100000, { b: n([]) }), st(101000, { b: n([['c', 2, 50000]]) })), newRecv: orgFlights(st(1000, {}), st(2000, { b: n([['a', 3, 1900]]) })),
        self: orgFlights(st(1000, { b: n([['b', 1, 900]]) }), st(2000, { b: n([['b', 2, 1900]]) })),
        junk: [orgFlights(st(1, null), st(2, { b: null })), orgFlights({ now: 1 }, { now: 2, org: { nodes: { b: { from: [null, ['a'], [5, 1, 2]] } } } }), orgFlights({ now: 1, org: { nodes: { b: { from: 'x' } } } }, { now: 2, org: { nodes: { b: { from: [['a', 1, 9]] } } } })] }; });
    same(fl, { first: [], same: [], bump: [{ from: 'a', to: 'b' }], fresh: [{ from: 'c', to: 'b' }], stale: [], newRecv: [], self: [], junk: [[], [], [{ from: 'a', to: 'b' }]] },
      '架构：「消息飞过去」只在某个发信人的最近一条变新时飞（第一次载入、没变、自己发给自己、刚出现的窗口的旧消息都不算；坏数据不报错）');
    ok(errs.length === 0, '架构：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {   // 消息飞过去（在浏览器里把 unfin 收到 peerDone 的最近一条改新）：从发信人飞到收信人，到了收信人亮一下；第一次载入不飞；减少动态效果时不飞，只亮
    for (const reduce of [false, true]) {
      const c6 = await browser.newContext({ viewport: { width: 1520, height: 1000 }, colorScheme: 'dark', reducedMotion: reduce ? 'reduce' : 'no-preference' });
      await c6.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('org')); } catch (e) {}
        window.__fly = []; window.__ping = [];
        new MutationObserver((ms) => { for (const m of ms) {
          for (const n of m.addedNodes || []) if (n.classList && n.classList.contains('ofly')) { const a = n.getAnimations()[0]; window.__fly.push(a ? a.effect.getKeyframes().map((k) => k.transform) : []); }
          if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('ping') && m.target.classList.contains('onode')) window.__ping.push(m.target.dataset.sid); } })
          .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); });
      const pg = await c6.newPage(); const e6 = []; pg.on('pageerror', (e) => e6.push(String(e)));
      let bump = 0;
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json(); const x = j.org && j.org.nodes && j.org.nodes[FX.sids.unfin];
        if (bump && x && Array.isArray(x.from)) { const f = x.from.find((y) => y[0] === FX.sids.peerDone); if (f) { f[1] = 4; f[2] = bump; } } await route.fulfill({ response: r, json: j }); });
      await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(3000);
      const f0 = await tryEval(pg, () => [window.__fly.length, window.__ping.length]);
      bump = Date.now(); await sleep(3600);
      const f1 = await tryEval(pg, (sids) => { const o = document.querySelector('#org'); if (!o) return null; const or = o.getBoundingClientRect(), c = (sid) => { const b = o.querySelector('.onode[data-sid="' + sid + '"]'); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2 - or.left), Math.round(r.top + r.height / 2 - or.top)]; };
        return { fly: window.__fly, ping: window.__ping, from: c(sids.peerDone), to: c(sids.unfin), left: o.querySelectorAll('.ofly').length }; }, FX.sids);
      const xy = (t) => (String(t || '').match(/-?[\d.]+/g) || []).map(Number).map(Math.round);
      if (!reduce) {
        const kf = f1 && f1.fly[0] ? f1.fly[0] : [], a = xy(kf[0]), b = xy(kf[kf.length - 1]);
        ok(f0.length === 2 && f0[0] === 0 && f0[1] === 0, '架构：第一次载入不飞、不亮（已经有的消息不算刚到的）', JSON.stringify(f0));
        ok(f1 && f1.fly.length === 1 && f1.from && f1.to && Math.abs(a[0] - f1.from[0]) <= 3 && Math.abs(a[1] - f1.from[1]) <= 3 && Math.abs(b[0] - f1.to[0]) <= 3 && Math.abs(b[1] - f1.to[1]) <= 3 && f1.left === 0,
          '架构：unfin 收到 peerDone 一条新消息 → 一个小点从 peerDone 飞到 unfin，恰好一次（之后几次轮询数据没变，不再飞），飞完就拿掉', JSON.stringify({ f1, a, b }));
        ok(f1 && f1.ping.includes(FX.sids.unfin) && !f1.ping.includes(FX.sids.peerDone), '架构：飞到以后收信人 unfin 的描边亮一下（发信人不亮）', JSON.stringify(f1 && f1.ping));
        await pg.screenshot({ path: path.join(OUT, 'org-dark-after-message.png') });
      } else ok(f1 && f1.fly.length === 0 && f1.ping.includes(FX.sids.unfin), '架构：系统设置里减少动态效果时不飞，只让收信人亮一下', JSON.stringify(f1));
      ok(e6.length === 0, '架构（消息' + (reduce ? '，减少动态效果' : '') + '）：页面没有报错', e6.join(' | ')); await c6.close();
    }
  }
  {   // 没有数据时：org.nodes 是空的（服务端出错时）/ 整个 org 都没有 / 某个会话不在 nodes 里 → 都按「你直接带」画，不报错
    for (const kind of ['empty', 'missing', 'partial']) {
      const c7 = await browser.newContext({ viewport: { width: 1520, height: 1000 }, colorScheme: 'light' });
      await c7.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('org')); } catch (e) {} });
      const pg = await c7.newPage(); const e7 = []; pg.on('pageerror', (e) => e7.push(String(e)));
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json();
        if (kind === 'empty') j.org = { chief: null, gen: null, nodes: {} }; else if (kind === 'missing') delete j.org; else if (j.org && j.org.nodes) delete j.org.nodes[FX.sids.hint];
        await route.fulfill({ response: r, json: j }); });
      await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(2800);
      const g7 = await orgOf(pg), labs = g7.cols && g7.cols.flatMap((c) => c.labs.filter((l) => /^你直接带 · \d+$/.test(l)).map((l) => +l.split(' · ')[1])), sum = (labs || []).reduce((a, b) => a + b, 0);
      if (kind === 'partial') ok(g7.nodes && g7.nodes.hint && g7.nodes.hint.grp === 'you' && g7.nodes.hint.parent === null && g7.nodes.peerDone && g7.nodes.peerDone.br === '带 3 个' && e7.length === 0, '架构：某个会话不在 nodes 里（刚启动）→ 它按「你直接带」画，别的关系照旧', JSON.stringify({ hint: g7.nodes && g7.nodes.hint, pd: g7.nodes && g7.nodes.peerDone && g7.nodes.peerDone.br, e7 }));
      else ok(g7.nodes && Object.keys(g7.nodes).length === 30 && sum === 30 && !Object.values(g7.nodes).some((x) => x.role || x.col === 'top') && !g7.err && e7.length === 0, '架构：org ' + (kind === 'empty' ? '的 nodes 是空的（服务端出错）' : '整个没有') + ' → 30 个窗口都画在「你直接带」里，没有总管、没有职级标签，页面不报错', JSON.stringify({ n: g7.nodes && Object.keys(g7.nodes).length, labs, err: g7.err, e7 }));
      if (kind === 'empty') await pg.screenshot({ path: path.join(OUT, 'org-light-no-data.png') });
      await c7.close();
    }
  }
  {   // 服务端改过以后的写法（在浏览器里改 /api/state 的应答造出来）：done 是 via: 'report'（它一直在向负责人交东西，n / last 是它发出去的）；
      // unfin 仍是 via: 'msg'，但 from 里拿掉上级（界面不该再拿 from 去猜）；links 改成直接归总管（「总管带」一组，竖线要接到它）
    for (const lang of ['zh', 'en']) {
      const c8 = await browser.newContext({ viewport: { width: 1520, height: 1000 }, colorScheme: 'dark' });
      await c8.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('org')); } catch (e) {} });
      const pg = await c8.newPage(); const e8 = []; pg.on('pageerror', (e) => e8.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') e8.push(m.text()); });
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json(); const N = j.org && j.org.nodes;
        if (N && N[FX.sids.done]) Object.assign(N[FX.sids.done], { via: 'report', handed: false, n: 2, last: Date.now() - 5 * 60e3 });
        if (N && N[FX.sids.unfin]) N[FX.sids.unfin].from = [];
        if (N && N[FX.sids.links]) Object.assign(N[FX.sids.links], { boss: FX.sids.projC, via: 'msg', n: 3, last: Date.now() - 10 * 60e3, from: [[FX.sids.projC, 3, Date.now() - 10 * 60e3]] });
        await route.fulfill({ response: r, json: j }); });
      await pg.goto(FX.url + '&lang=' + lang); await pg.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(2800);
      const tv = {}; for (const n of ['done', 'unfin', 'links']) { const h = await hoverTip(pg, FX.sids[n]); tv[n] = h && h.tip; }
      await hoverTip(pg, FX.sids.done); const tgr = await tipGeo(pg, FX.sids.done);      // 循环最后悬停的是 links：量之前回到 done 上
      await pg.mouse.move(5, 300); await sleep(200);
      const gv = await orgOf(pg), oc = (gv.cols || []).find((c) => c.key === 'other') || { kids: {}, labs: [] }, spv = await spineOf(pg, FX.sids.links), spl = await spineOf(pg, FX.sids.peerDone);
      const ind = gv.nodes && gv.nodes.links && oc.kids.you && oc.kids.you[0] && gv.nodes[oc.kids.you[0]] ? gv.nodes.links.left - gv.nodes[oc.kids.you[0]].left : null;
      if (lang === 'zh') {
        ok(tv.done === '一直在向 win-p2 交东西（2 条，最近一条 5 分钟前）' && /^最近 3 条消息来自 win-p2，最近一条 /.test(tv.unfin || '') && /^最近 3 条消息来自 w-projC，最近一条 /.test(tv.links || ''),
          '架构：via: report 写「一直在向 X 交东西（N 条，最近一条 Y 前）」；via: msg 照旧写「最近 N 条消息来自 X」，不再看上级在不在 from 里', JSON.stringify(tv));
        ok(JSON.stringify(oc.kids.chief) === '["links"]' && oc.labs.includes('总管带 · 1') && onBox(spv) && onBox(spl) && spv.y0 === 0 && spv.drop && ind >= 18 && ind <= 26,
          '架构：直接归总管的 links 在「总管带 · 1」里，列头那根竖线经过负责人、一直接到它（它和负责人都比「你直接带」缩进一层，给竖线让位）', JSON.stringify({ chief: oc.kids.chief, labs: oc.labs, spv, ind }));
        await pg.screenshot({ path: path.join(OUT, 'org-dark-report-chief.png') });
      } else {
        ok(tv.done === 'Keeps delivering to win-p2 (2 messages, the latest 5 min ago)' && /^Last 3 messages came from win-p2, the latest /.test(tv.unfin || '') && oc.labs.includes('Under the chief · 1'),
          'en 架构：via: report 的依据和「总管带」组名是英文', JSON.stringify({ tv, labs: oc.labs }));
      }
      ok(tgr && tgr.top < 0 && tgr.bottom > 0 && tgr.hit === 0, lang + ' 架构：report 那句提示也骑在下边线上、不盖下一个方块的标题行', JSON.stringify(tgr));
      ok(e8.length === 0, lang + ' 架构（report / 总管带）：页面没有报错', e8.join(' | ')); await c8.close();
    }
  }
  {   // 分支负责人（11/17 的需求：负责增长的那个窗口固定在架构里靠上的位置，能点它直接派活）。
      // 在浏览器里改 /api/state 的应答：links 改成 role head、挂在负责人 peerDone 下面（FretFlow 的推广负责人那种）；limit 改成 role head、直接归总管（项目里没有负责人、总管的项目那种）。
      // 要看的：links 排在 peerDone 下面第一个（压过要你动手的 unfin、在跑的 hint），标「分支」，隔两次轮询还在第一个；limit 在「总管带」里、标「分支」；悬停依据；点 links 打开放大看、底下是它自己的回话框
    for (const [lang, scheme] of [['zh', 'dark'], ['zh', 'light'], ['en', 'dark'], ['en', 'light']]) {
      const c9 = await browser.newContext({ viewport: { width: 1520, height: 1000 }, colorScheme: scheme });
      await c9.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('org')); } catch (e) {} });
      const pg = await c9.newPage(); const e9 = []; pg.on('pageerror', (e) => e9.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') e9.push(m.text()); });
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = await r.json(); const N = j.org && j.org.nodes;
        if (N && N[FX.sids.links]) Object.assign(N[FX.sids.links], { role: 'head', boss: FX.sids.peerDone, via: 'seat', n: 0, last: 0, handed: false });
        if (N && N[FX.sids.limit]) Object.assign(N[FX.sids.limit], { role: 'head', boss: FX.sids.projC, via: 'seat', n: 0, last: 0, handed: false });
        // 真实的分支负责人都开在总控台的 tmux 里（线上的分支窗口都是 channel: tmux），回话框才能打字；夹具里的 links 没有通道，这里补上
        const L = (j.sessions || []).find((x) => x.sid === FX.sids.links); if (L) L.channel = 'tmux';
        await route.fulfill({ response: r, json: j }); });
      await pg.goto(FX.url + '&lang=' + lang); await pg.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(2800);
      const g1 = await orgOf(pg); await sleep(2600); const g2 = await orgOf(pg);
      const n1 = (g1.nodes || {}), pd = n1.peerDone || { kids: [] }, lk = n1.links || {}, lm = n1.limit || {}, k2 = ((g2.nodes || {}).peerDone || { kids: [] }).kids;
      const lc = (g1.cols || []).find((c) => (c.kids.chief || []).includes('limit')) || { kids: {}, labs: [] };
      const tl = await hoverTip(pg, FX.sids.links), tm = await hoverTip(pg, FX.sids.limit); await pg.mouse.move(5, 300); await sleep(250);
      const tag = lang === 'zh' ? '分支' : 'Branch';
      ok(pd.kids[0] === 'links' && lk.parent === 'peerDone' && lk.role === tag && pd.kids.includes('unfin') && pd.kids.includes('hint') && JSON.stringify(k2) === JSON.stringify(pd.kids),
        lang + '/' + scheme + ' 架构：分支负责人 links 挂在负责人下面、排第一个（压过要你动手的 unfin、在跑的 hint），标「' + tag + '」，隔两次轮询还是这个顺序', JSON.stringify({ kids: pd.kids, k2, parent: lk.parent, role: lk.role }));
      ok(lm.grp === 'chief' && lm.role === tag && (lc.kids.chief || [])[0] === 'limit', lang + '/' + scheme + ' 架构：直接归总管的分支负责人 limit 在「总管带」那一组、排第一个，标「' + tag + '」', JSON.stringify({ grp: lm.grp, role: lm.role, chief: lc.kids.chief }));
      const want = lang === 'zh' ? [(tl && tl.tip) === '分支负责人，归 win-p2', (tm && tm.tip) === '分支负责人，归总管'] : [(tl && tl.tip) === 'Branch lead, reports to win-p2', (tm && tm.tip) === 'Branch lead, reports to the chief'];
      ok(want.every(Boolean), lang + '/' + scheme + ' 架构：悬停依据写「分支负责人，归 <负责人短名>」/「分支负责人，归总管」（英文 Branch lead…）', JSON.stringify({ links: tl && tl.tip, limit: tm && tm.tip }));
      if (scheme === 'dark') await pg.screenshot({ path: path.join(OUT, 'org-head-' + lang + '-dark.png') }); else await pg.screenshot({ path: path.join(OUT, 'org-head-' + lang + '-light.png') });
      // 点它就能派活：放大看打开，底部是这个窗口自己的回话框（1f 的 #dDock：卡片的回话框挪进弹层）
      await pg.click('#org .onode[data-sid="' + FX.sids.links + '"]'); await sleep(900);
      const dk = await pg.evaluate((sid) => { const d = document.querySelector('#detail'), h = document.querySelector('#dDock'), ta = h && h.querySelector('textarea');
        return { open: !!(d && d.open), dock: !!h && !h.hidden, sid: h && h.dataset.sid, ta: !!ta, ok: !!ta && !ta.disabled, vis: !!ta && ta.getBoundingClientRect().height > 0 }; }, FX.sids.links);
      ok(dk.open && dk.dock && dk.sid === FX.sids.links && dk.ta && dk.ok && dk.vis, lang + '/' + scheme + ' 架构：点分支负责人打开放大看，底部是它自己的回话框（能打字），点了就能直接派活', JSON.stringify(dk));
      if (lang === 'zh' && scheme === 'dark') await pg.screenshot({ path: path.join(OUT, 'org-head-zh-dark-click.png') });
      ok(e9.length === 0, lang + '/' + scheme + ' 架构（分支负责人）：页面没有报错', e9.join(' | ')); await c9.close();
    }
  }
  {   // 英文界面：新加的字都有英文
    ({ ctx, page, errs } = await open({ mode: 'org', lang: 'en' })); const g = await orgOf(page);
    const zh = await tryEval(page, () => { const bad = []; for (const el of document.querySelectorAll('#modes button, #org .oyou, #org .orole, #org .obr, #org .ow, #org .o3, #org .olab, #org .ghead')) if (/[一-鿿]/.test(el.textContent)) bad.push(el.textContent.trim().slice(0, 40)); return bad; });
    const nd = g.nodes || {}, pd = nd.peerDone || {};
    ok(Array.isArray(zh) && zh.length === 0 && g.nodes && Object.keys(g.nodes).length === 30, 'en 架构：视图按钮、你那一行、职级、带几个、状态词、第三行、组名、列头里没有漏翻的中文', JSON.stringify(zh));
    ok(await tryEval(page, () => document.querySelector('#modes [data-mode="org"]') && document.querySelector('#modes [data-mode="org"]').textContent) === 'Org' && g.youName === 'You' && /^30 windows · \d+ running · \d+ need(s)? you$/.test(g.youLine)
      && (nd.projC || {}).role === 'Chief' && /gen 3/.test((nd.projC || {}).br) && pd.role === 'Lead' && pd.br === '4 reports' && (nd.askQ || {}).role === 'Former'
      && g.cols.some((c) => c.labs.includes('Directly under you · 22')) && /^Other\s*28$/.test((g.cols[0] || {}).head || '') && /41k context/.test((nd.done || {}).l3) && /2 subagents running/.test((nd.run || {}).l3) && /from win-p2/.test((nd.run || {}).l3) && (nd.done || {}).word === 'To review',
      'en 架构：Org / You / 30 windows · N running · N need you / Chief · gen 3 / Lead · 4 reports / Former / Directly under you · 22 / 41k context / 2 subagents running / from win-p2', JSON.stringify({ you: g.youLine, chief: nd.projC && [nd.projC.role, nd.projC.br], lead: [pd.role, pd.br], labs: g.cols && g.cols.map((c) => c.labs), done: nd.done && nd.done.l3, run: nd.run && nd.run.l3 }));
    const te = {}; for (const n of ['hint', 'unfin', 'done', 'peerDone', 'askQ', 'links', 'projC']) { const h = await hoverTip(page, FX.sids[n]); te[n] = h && h.tip; }
    await hoverTip(page, FX.sids.done); const tge = await tipGeo(page, FX.sids.done);
    ok(tge && tge.h > 30 && tge.top < 0 && tge.bottom > 0 && Math.abs(tge.right - 10) <= 2 && tge.hit === 0, 'en 架构：长的依据（换代后跟着岗位）写成两行，照样骑在下边线上、靠右，不盖下一个方块的标题行', JSON.stringify(tge));
    ok(tge && tge.names.length === 1 && tge.names[0][0] === 'win-p2' && tge.names[0][1] === 1, 'en 架构：提示折行时不把短名从连字符处拆开（win-p2 整个在一行里）', JSON.stringify(tge && tge.names));
    ok(te.hint === 'Opened by win-p2' && /^Last 3 messages came from win-p2, the latest (\d+ min ago|\d+ h ago|just now)$/.test(te.unfin || '') && te.done === 'Used to report to the previous holder; moved to win-p2 with the seat' && te.peerDone === 'Project lead, reports to the chief' && te.askQ === 'Handed over to win-p2' && te.links === 'No window manages it; you lead it yourself' && te.projC === 'Chief, reports to you',
      'en 架构：悬停提示的依据都是英文', JSON.stringify(te));
    await page.mouse.move(5, 300); await sleep(200); await page.screenshot({ path: path.join(OUT, 'org-dark-en.png') });
    ok(errs.length === 0, 'en 架构：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {   // 窄窗口（和墙同一个断点 700 px）：各列上下叠成一列，页面不横向溢出
    ({ ctx, page, errs } = await open({ mode: 'org', w: 420, h: 900 })); const g = await orgOf(page);
    const bar = await tryEval(page, () => { const b = document.querySelector('header.bar'), nb = document.querySelector('#newBtn'); return { over: b.scrollWidth > b.clientWidth, newIn: nb.getBoundingClientRect().right <= innerWidth }; });
    ok(g.cols && g.cols.length === 2 && g.cols[1].top >= g.cols[0].bottom && Math.abs(g.cols[1].left - g.cols[0].left) <= 1 && g.sw <= 420 && g.mainSW <= 0 && Object.keys(g.nodes).length === 30, '架构 420 px：各列上下叠成一列往下排，页面不横向溢出', JSON.stringify({ cols: g.cols && g.cols.map((c) => [c.key, c.top, c.bottom, c.left]), sw: g.sw, mainSW: g.mainSW }));
    ok(!bar.over && bar.newIn, '架构 420 px：顶栏放得下（多了「架构」按钮以后「新任务」还在视口里）', JSON.stringify(bar));
    await page.screenshot({ path: path.join(OUT, 'org-phone.png'), fullPage: false });
    ok(errs.length === 0, '架构 420 px：页面没有报错', errs.join(' | ')); await ctx.close();
    ({ ctx, page, errs } = await open({ mode: 'org', scheme: 'light' })); await page.screenshot({ path: path.join(OUT, 'org-light.png') });
    ok(errs.length === 0, '架构（浅色）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  // ── 架构 · 完 ──
  if (process.env.UI_ONLY === 'org') { console.log('\n（UI_ONLY=org：只跑了「架构」这一段，不是整套）'); throw ONLY_DONE; }

  // ── 一起退出 · 横幅（P0-0，win-bf）：10 秒内 ≥ 3 个窗口一起退出时墙顶一条横幅，「全部接回」交给服务端排队。
  //    在浏览器里拦下 /api/state 换上各种状态的 crash（服务端的状态机在 state.test.mjs [5b] 测），拦下 POST /api/crash 记下发了什么 ──
  console.log('\n[一起退出 · 横幅]');
  {
    let CR = null; const posts = [];
    // 「11:43」按浏览器自己的时区算：无头 Chromium 自带的时区表和 macOS 不一定一样（11/17 本机：系统和 node 是 UTC-7，Chromium 还按 UTC-8，同一个时刻差一小时）
    const at1143 = (page) => page.evaluate(() => { const d = new Date(); d.setHours(11, 43, 0, 0); return d.getTime(); });
    const C = (o) => ({ id: 'cTEST', at: null, n: 20, done: 0, fail: 0, why: null, load: null, waitSince: null, next: null, max: 30, ...o });
    const hook = async (page) => {
      await page.route('**/api/state*', async (r) => { const res = await fullState(r); const j = await res.json(); j.crash = CR; for (const x of j.lost || []) { x.crash = CR ? CR.id : null; x.idle = !!CR; } await r.fulfill({ response: res, json: j }); });
      await page.route('**/api/crash', async (r) => { posts.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ json: { ok: true } }); });
    };
    const setCR = async (page, c) => { CR = c && c.at === null ? { ...c, at: await at1143(page) } : c; await page.evaluate(() => refresh()); await sleep(1200); };
    const banner = (page) => page.evaluate(() => {
      const el = document.querySelector('#crash'), bar = document.querySelector('header.bar').getBoundingClientRect();
      if (!el || el.hidden || !el.offsetParent && getComputedStyle(el).position !== 'fixed') return { hidden: true };
      const r = el.getBoundingClientRect(), i = el.querySelector('.cx-i');
      return { hidden: getComputedStyle(el).display === 'none', state: el.dataset.state, main: (el.querySelector('.cx-t b') || {}).textContent || '', sub: (el.querySelector('.cx-s') || {}).textContent || '',
        btns: [...el.querySelectorAll('[data-cx]')].map((b) => [b.dataset.cx, b.textContent.trim()]), icon: i ? getComputedStyle(i).backgroundColor : null, iconW: i ? i.getBoundingClientRect().width : 0,
        top: r.top, barBottom: bar.bottom, left: r.left, right: r.right, h: r.height, vw: innerWidth, docOver: document.documentElement.scrollWidth > innerWidth, role: el.getAttribute('role'), text: el.textContent };
    });
    const colorOf = (page, v) => page.evaluate((v) => { const d = document.createElement('i'); d.style.color = 'var(' + v + ')'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
    const lostHead = (page) => page.evaluate((sid) => { const c = document.querySelector('.card[data-sid="x:' + sid + '"]'); return c ? (c.querySelector('.head') || {}).textContent : null; }, FX.sids.gone);
    for (const lang of ['zh', 'en']) {
      const { ctx, page, errs } = await open({ mode: 'wall', lang }); const en = lang === 'en', tag = '横幅 · ' + lang + ' 1520 px';
      await hook(page); posts.length = 0;
      await setCR(page, null); const b0 = await banner(page);
      ok(b0.hidden, tag + '：没有一起退出时不显示', JSON.stringify(b0));
      await setCR(page, C({ state: 'new' })); const b1 = await banner(page), attn = await colorOf(page, '--attn'), acc = await colorOf(page, '--accent');
      ok(!b1.hidden && b1.main === (en ? '20 windows exited together at 11:43' : '11:43 有 20 个窗口一起退出了') && b1.sub === (en ? 'Their conversations are kept and can be resumed one by one' : '对话都还在，可以一个一个接回来'),
        tag + '：一起退出 → 「11:43 有 20 个窗口一起退出了 · 对话都还在」', JSON.stringify(b1));
      ok(JSON.stringify(b1.btns) === JSON.stringify(en ? [['restore', 'Resume all'], ['dismiss', 'Dismiss']] : [['restore', '全部接回'], ['dismiss', '先不管']]) && b1.icon === attn && b1.role === 'status', tag + '：两个按钮「全部接回 / 先不管」，前面是琥珀色的「!」（要你动手），读屏是 status', JSON.stringify({ btns: b1.btns, icon: b1.icon, attn }));
      ok(b1.top >= b1.barBottom && b1.left >= 16 && b1.right <= b1.vw - 16 && b1.h <= 48 && !b1.docOver, tag + '：在顶栏下面、左右都在视口里、一行高（≤ 48 px）、页面不横向溢出', JSON.stringify({ top: b1.top, bar: b1.barBottom, l: b1.left, r: b1.right, h: b1.h }));
      const lh = await lostHead(page);
      ok(lh === (en ? 'Exited together with other windows (most likely tmux or this machine had a problem). The conversation is kept.' : '和别的窗口一起退出了（多半是 tmux 或这台机器出了问题）。对话还在。'), tag + '：一起退出的那张「进程退出」卡不写「做到一半」，写「和别的窗口一起退出了」', String(lh));
      if (!en) await page.screenshot({ path: path.join(OUT, 'crash-01-new-zh.png'), clip: { x: 0, y: 0, width: 1520, height: 320 } });
      await page.click('#crash [data-cx="restore"]', { timeout: 3000 }).catch(() => {}); await sleep(600);
      ok(posts.length === 1 && posts[0].id === 'cTEST' && posts[0].action === 'restore', tag + '：点「全部接回」→ POST /api/crash { id, action: restore }', JSON.stringify(posts));
      await setCR(page, C({ state: 'running', done: 3, load: 6 })); const b2 = await banner(page);
      ok(b2.main === (en ? 'Resuming one at a time' : '正在一个一个接回') && b2.sub === (en ? '3 / 20 resumed' : '已接回 3 / 20') && JSON.stringify(b2.btns) === JSON.stringify([['stop', en ? 'Stop' : '停下']]) && b2.icon === acc && b2.iconW <= 9,
        tag + '：排队中 → 「正在一个一个接回 · 已接回 3 / 20」、只有「停下」、图标换成青点', JSON.stringify(b2));
      if (!en) await page.screenshot({ path: path.join(OUT, 'crash-02-running-zh.png'), clip: { x: 0, y: 0, width: 1520, height: 320 } });
      await setCR(page, C({ state: 'waiting', done: 3, load: 34.2, next: 4 })); const b3 = await banner(page);
      ok(b3.main === (en ? 'Load 34.2 — waiting until it drops below 30' : '负载 34.2，等降到 30 以下再接') && b3.sub === (en ? '3 / 20 resumed' : '已接回 3 / 20'), tag + '：负载高 → 「负载 34.2，等降到 30 以下再接」', JSON.stringify(b3));
      await setCR(page, C({ state: 'stopped', why: 'load', done: 3, next: 4, load: 41 })); const b4 = await banner(page);
      ok(b4.main === (en ? 'Load stayed high — stopped at window 4' : '负载一直没降，停在第 4 个') && JSON.stringify(b4.btns) === JSON.stringify(en ? [['restore', 'Continue'], ['dismiss', 'Dismiss']] : [['restore', '接着接回'], ['dismiss', '先不管']]) && b4.icon === attn,
        tag + '：等不到就停 → 「负载一直没降，停在第 4 个」，按钮「接着接回 / 先不管」', JSON.stringify(b4));
      if (!en) await page.screenshot({ path: path.join(OUT, 'crash-03-stopped-zh.png'), clip: { x: 0, y: 0, width: 1520, height: 320 } });
      await setCR(page, C({ state: 'done', done: 18, fail: 2 })); const b5 = await banner(page);
      await setCR(page, C({ state: 'done', done: 20 })); const b6 = await banner(page);
      ok(b5.main === (en ? 'Resumed 18, 2 failed' : '接回了 18 个，2 个没接成') && b6.main === (en ? 'All 20 resumed' : '20 个都接回了') && JSON.stringify(b6.btns) === JSON.stringify([['dismiss', en ? 'Got it' : '知道了']]),
        tag + '：接完 → 「20 个都接回了」/「接回了 18 个，2 个没接成」，只有「知道了」', JSON.stringify([b5.main, b6.main, b6.btns]));
      await page.click('#crash [data-cx="dismiss"]', { timeout: 3000 }).catch(() => {}); await sleep(500);
      ok(posts.length === 2 && posts[1].action === 'dismiss', tag + '：点「知道了」→ POST dismiss', JSON.stringify(posts));
      if (en) ok([b1, b2, b3, b4, b5, b6].every((b) => !/[一-鿿]/.test(b.text)), tag + '：英文横幅里没有漏翻的中文', JSON.stringify([b1, b2, b3, b4, b5, b6].map((b) => b.text)));
      if (en) { await setCR(page, C({ state: 'new' })); await page.screenshot({ path: path.join(OUT, 'crash-04-new-en.png'), clip: { x: 0, y: 0, width: 1520, height: 320 } }); }
      ok(errs.length === 0, tag + '：页面没报错', errs.join(' | '));
      await ctx.close();
    }
    {
      // 顶栏在 420 px 的墙上本来就放不下（线上也是：筛选那一排伸出右边，「新任务」在视口外，跟横幅无关），所以这里比的是「横幅出来前后顶栏一样」
      const barNow = (page) => page.evaluate(() => { const x = document.querySelector('header.bar'), nb = document.querySelector('#newBtn'), r = nb.getBoundingClientRect(); return { sw: x.scrollWidth, cw: x.clientWidth, h: x.clientHeight, nbL: Math.round(r.left), nbT: Math.round(r.top) }; });
      const { ctx, page, errs } = await open({ mode: 'wall', lang: 'zh', w: 420 }); await hook(page); await setCR(page, null); const bar0 = await barNow(page);
      await setCR(page, C({ state: 'new' })); const b = await banner(page), bar = await barNow(page);
      ok(!b.hidden && b.left >= 15.5 && b.right <= b.vw - 15.5 && !b.docOver && b.btns.length === 2 && JSON.stringify(bar) === JSON.stringify(bar0), '横幅 · 420 px：左右各留 16 px、按钮换行不切掉、页面不横向溢出、顶栏和没横幅时一样', JSON.stringify({ b, bar0, bar }));
      await page.screenshot({ path: path.join(OUT, 'crash-05-phone-zh.png'), clip: { x: 0, y: 0, width: 420, height: 360 } });
      ok(errs.length === 0, '横幅 · 420 px：页面没报错', errs.join(' | ')); await ctx.close();
    }
    {
      const { ctx, page, errs } = await open({ mode: 'flow', lang: 'zh', scheme: 'light' }); await hook(page); await setCR(page, C({ state: 'new' })); const b = await banner(page), attn = await colorOf(page, '--attn');
      ok(!b.hidden && b.icon === attn && b.top >= b.barBottom, '横幅 · 浅色、封面：一样显示，琥珀色跟着浅色主题走', JSON.stringify({ icon: b.icon, attn }));
      await page.screenshot({ path: path.join(OUT, 'crash-06-light-flow-zh.png'), clip: { x: 0, y: 0, width: 1520, height: 420 } });
      ok(errs.length === 0, '横幅 · 浅色：页面没报错', errs.join(' | ')); await ctx.close();
    }
  }
  await snoozeCheck();     // 先放着带时间（会在服务里记推迟，段末清掉）
  await deltaCheck();      // 只回变过的（拉数据瘦身）：会真的归档一个夹具会话，所以放在最后
} catch (e) { if (e !== ONLY_DONE) throw e; } finally { await browser.close(); }
console.log(`\n界面结果：${pass} 过，${fail} 没过；截图在 ${OUT}`);
process.exit(fail ? 1 : 0);
