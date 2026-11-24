/**
 * [INPUT]: 依赖 .tmp/ui-fixture.json（state.test.mjs --ui 写的试验实例地址）；依赖 ./browser.mjs 的静音无头 Chromium；依赖 ./clips.mjs 的三段无声 WebM（图集 · 视频）
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过；截图放 .tmp/shots（墙 / 封面、深色 / 浅色、英文）
 * [POS]: test/ 的界面测试：逐张卡片核对右上角的状态标志、顶栏计数、排位、「先不管」、筛选、模糊卡片上那枚不模糊的标志、英文界面、按项目分组（墙一个项目一列、每列都在第一屏、筛选后回到平铺、换位置的动画、收起 / 展开一列、封面的组名、手机宽度）、列宽（拖分隔条跟手、松手吸附整格并记住、窄窗口里记了格数的列先拿、放不下的挤成窄条、点窄条先让一格、拖到底收起或挤开、双击 / Enter 恢复、方向键挪一格、宽卡大字）、正文里的本机路径能点、图集里的视频（格子里就地播、一次一个、⤢ 才放大、同时播放且只有指着的那格出声、对时间、进度条、全部放完复位）、放大看（⌘O / 双击；打开时从最新交付的第一行看起，不滚到最底）、右上角「归档」、列头的「＋ 新任务」、codex 关着时不显示「交给谁」、输入框上的预判（灰字 Tab 收下、1/2/3 填进输入框、数字键、封面视图）、点「审完了」/ 撤销 / 页面载入时把记录告诉服务（自动收工靠它）、架构视图（谁归谁管：入口、你 / 总管 / 每个项目一列、负责人的树和前任、你直接带的个数、三行字、悬停加重和依据、点开放大看、消息飞过去、没有数据、英文、窄窗口）、架构 · 放射（顶栏「层级 | 放射」：你和总管在圆心、每个项目一个扇区；放回窗口里、不重叠、先后不跟状态、输入没变不重排、线、悬停原地展开、滚轮挪 / Ctrl 或 ⌘ + 滚轮缩放 / 拖空白处 / 三个按钮 / 双击空白处、纯函数 orgMapLayout 和 orgMapRound）、审完了 · 跨设备（两个浏览器上下文共用夹具服务：A 点了 B 不刷新也变处理过、计数跟着变、后开的 C 一打开就是、A 撤销马上回来 B 跟着回来、服务换台后重发）。
 *        diffSeg() 验逐笔补丁、文件入口、画布与加删行主题颜色、来源底栏、转义、错误和应答先后；DF_HTML 换页。
 *        undoSeg() 验 ⌘Z 单次 / 时限 / 输入焦点 / 提示覆盖、真实推迟清除、ccb_last 的成功发送 / 按卡取回 / 过期；UN_HTML 换完整页面做改坏对照。
 *        topbarLimitsSeg() 保留原有额度和顶栏尺寸断言，UI_ONLY=limits 可定点复核，LP_HTML 可回放旧顶栏。
 *        geminiChipSeg() 验顶栏最后一格 Gemini 余额估算（11/23）：≈ 金额、花掉的比例、琥珀线、锚点 7 天以上变灰、提示的中英文、窄屏、没有 / null 不画、轮询换上新数；截图放 <OUT>/gemini-balance/；UI_ONLY=gbal 单跑，GB_HTML 换整页做红阶段与改坏对照。
 *        etaSeg() 验卡片牌子上的「预计 HH:MM 交 / 比预计晚 N 分钟」、跨到明天、悬停、不显示的三种、英文、窄条；UI_ONLY=eta / ET_HTML 支持红阶段与改坏对照。
 *        remotePreviewCheck() 验远程预览（C1 / C1.1）：远程模式点卡片上的路径带 sid 问 /api/remote/preview（浏览器里按服务的应答形状回、/rp/ 从预览端口取真文件并加 CSP 沙盒头），
 *        网页 / 图 / Markdown / 文件夹图集 / 「图集」按钮、拒绝只提示、不在卡片上的路径不发请求；UI_ONLY=rpreview 单跑，RP_HTML 换整页做红阶段与改坏对照。
 *        11/22 修一：PDF 不画、写明显示不了并给下载链接（点了真开始下载）；「指到别处的链接」「点开头的文件夹」两句拒绝的英文。
 *        wallStripSeg() 独立核窄条、要你筛选、展开与回话、自动续跑、2 秒宽限（含两拍相隔 1.3 秒）和重复绘制；UI_ONLY=strip / ST_HTML 支持红阶段与改坏对照。老的段默认 ccb_strip='off'，保留整格断言。
 *        只读页面 + 点「先不管」和筛选，不往任何会话里发话；新段的发送与自动续跑请求拦在浏览器里。真应用是 Safari 内核，这里测的是 Chrome 内核。
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
// 「审完了」11/18 起跨页面共享（服务的 processed）：一段里点过「审完了」、或回过话又重载（页面载入时把本机 ccb_done 整份重发），后面新开的页面也会看到它处理过。
// 要从「待审阅」开始的段，开头先清掉服务里那几笔；只清 processed，不碰本机 localStorage（新的浏览器上下文本来就是空的）
const srvClear = (ids) => { const u = new URL(FX.url); return fetch(u.origin + '/api/processed', { method: 'POST', headers: { 'x-ccboard': u.searchParams.get('k'), 'content-type': 'application/json' }, body: JSON.stringify({ clear: ids }) }).catch(() => {}); };

const browser = await launch();
// 老断言继续核原来的整格；只有 wallStripSeg 创建 context 时开启窄条。
let STRIPS_ON = false;
const newContext = browser.newContext.bind(browser);
browser.newContext = async (...args) => {
  const ctx = await newContext(...args);
  if (!STRIPS_ON) await ctx.addInitScript(() => { try { localStorage.setItem('ccb_strip', 'off'); } catch (e) {} });
  return ctx;
};
// 架构：服务 11/17 起把没有窗口在管的窗口按项目挂到负责人 / 总管下面（org 的 via: 'dept'）。测「你直接带」那套画法的块在浏览器里把它们还原成
// boss: null（没有负责人、也没有总管时服务就是这样出的，比如刚装的总控台）；按项目挂上的画法另有一块，用服务的真实输出
const unplace = (j) => { const N = j && j.org && j.org.nodes; if (N) for (const x of Object.values(N)) if (x && (x.via === 'dept' || x.via === 'contact')) Object.assign(x, { boss: null, via: null, n: 0, last: 0, handed: false }); return j; };   // contact（11/17 win-49）也是第 5 步挂上的，一起还原
const unplaceRoute = async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: unplace(j) }); };
async function open({ mode, scheme = 'dark', lang = 'zh', w = 1520, h = 900, unplaced = false }) {      // 无头浏览器的系统语言是英文，中文界面要明说
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
  await ctx.addInitScript((m) => { try { localStorage.setItem('ccb_mode', JSON.stringify(m)); } catch (e) {} }, mode);
  const page = await ctx.newPage(); const errs = [];
  if (process.env.UI_ONLY === 'limits' && process.env.LP_HTML) {
    const html = fs.readFileSync(process.env.LP_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
    await page.route((u) => u.pathname === '/', async (r) => r.fulfill({ response: await r.fetch(), body: html, contentType: 'text/html; charset=utf-8' }));
  }
  if (process.env.UI_ONLY === 'gbal' && process.env.GB_HTML) {       // Gemini 余额那一段的红阶段、改坏对照：换一份 ui.html
    const html = fs.readFileSync(process.env.GB_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
    await page.route((u) => u.pathname === '/', async (r) => r.fulfill({ response: await r.fetch(), body: html, contentType: 'text/html; charset=utf-8' }));
  }
  if (process.env.UI_ONLY === 'update' && process.env.UP_HTML) {     // 检查新版本那一段的红阶段、改坏对照：换一份 ui.html
    const html = fs.readFileSync(process.env.UP_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
    await page.route((u) => u.pathname === '/', async (r) => r.fulfill({ response: await r.fetch(), body: html, contentType: 'text/html; charset=utf-8' }));
  }
  if (unplaced) await page.route('**/api/state*', unplaceRoute);
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

// 检查新版本（11/22）：UI_ONLY=update 只跑这一段，UP_HTML=<另一份 ui.html> 换页面（红阶段、改坏对照）。--ui 夹具不是公开包装的（没有 .bundle-version）→ 服务不给 update 键、按钮藏着；
// 有新版的样子在浏览器里改 /api/state 的应答（加 update）造，/api/update/* 拦在浏览器里（不真的 open dmg），window.open 换成记下网址
async function updateSeg() {
  console.log('\n[检查新版本]');
  const U = (ready) => ({ current: '0.3.8', latest: '0.3.9', ready, page: 'https://github.com/Lfrangt/cc-board/releases/tag/v0.3.9', dmg: 'https://github.com/Lfrangt/cc-board/releases/download/v0.3.9/cc-board.dmg' });
  for (const [lang, scheme] of [['zh', 'dark'], ['en', 'dark'], ['zh', 'light'], ['en', 'light']]) {
    const { ctx, page, errs } = await open({ mode: 'wall', lang, scheme }); const tag = lang + ' · ' + (scheme === 'dark' ? '深色' : '浅色'), en = lang === 'en';
    if (lang === 'zh' && scheme === 'dark') ok(await page.$eval('#updBtn', (b) => b.hidden && getComputedStyle(b).display === 'none').catch(() => false), '检查新版本：服务不给 update（不是公开包装的、没有新版）时顶栏没有这个按钮');
    let upd = U(true), openRes = { ok: true }; const sent = [];
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.route('**/api/state**', async (route) => { const r = await fullState(route); const j = await r.json(); j.update = upd; await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/update/**', async (route) => { const q = route.request(); sent.push([q.method(), new URL(q.url()).pathname, q.headers()['x-ccboard'] ? 'tok' : '']); return route.fulfill({ json: openRes }); });
    const want = (w) => (en ? (w ? 'Install ' : 'Download ') : (w ? '安装 ' : '下载 ')) + '0.3.9';
    await page.waitForFunction((t) => { const b = document.querySelector('#updBtn'); return !!b && !b.hidden && b.textContent === t; }, want(true), { timeout: 6000 }).catch(() => {});
    const m = await page.evaluate(() => { const b = document.querySelector('#updBtn'); if (!b) return { missing: true }; const r = b.getBoundingClientRect(), bar = document.querySelector('.bar'), br = bar.getBoundingClientRect(), nb = document.querySelector('#newBtn').getBoundingClientRect(), arch = document.querySelector('#archBtn').getBoundingClientRect();
      const over = () => bar.scrollWidth - bar.clientWidth, o1 = over(); b.hidden = true; const o0 = over(); b.hidden = false;
      const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.append(probe); const acc = getComputedStyle(probe).color; probe.remove();
      return { vis: !b.hidden && r.width > 0, text: b.textContent, title: b.title, aria: b.getAttribute('aria-label'), color: getComputedStyle(b).color, acc, inBar: r.top >= br.top - 1 && r.bottom <= br.bottom + 1, leftOfArch: r.right <= arch.left + 1, newIn: nb.right <= innerWidth && nb.left >= 0, o1, o0, w: Math.round(r.width) }; });
    ok(m.vis && m.text === want(true) && m.color === m.acc && m.inBar && m.leftOfArch && m.aria === m.title, '检查新版本（' + tag + '）：下好了（ready）→ 顶栏「归档」左边青色「' + want(true) + '」，提示和读屏一样', JSON.stringify(m));
    ok(m.title === (en ? 'Version 0.3.9 is downloaded and its sha256 checked (you have 0.3.8). Click to open the installer' : '新版 0.3.9 已经下好、核过 sha256（本机 0.3.8），点了打开安装包'), '检查新版本（' + tag + '）：ready 的提示写清下好了、核过、本机是几', m.title);
    ok(m.o1 <= m.o0 + (en ? m.w + 8 : 0) && (en || (m.newIn && m.o1 <= 0)), '检查新版本（' + tag + '）：按钮出来以后' + (en ? '顶栏溢出不超过按钮宽（英文顶栏在 1520 宽原来就溢出）' : '「新任务」还在视口内、顶栏不溢出'), JSON.stringify({ o1: m.o1, o0: m.o0, newIn: m.newIn, w: m.w }));
    await page.locator('.bar').screenshot({ path: path.join(OUT, 'update-ready-' + lang + '-' + scheme + '.png') });
    await page.click('#updBtn', { timeout: 2000 }).catch(() => {}); await sleep(500);
    const t1 = await page.evaluate(() => ({ toast: document.querySelector('#toast span').textContent, on: document.querySelector('#toast').classList.contains('on'), opened: window.__opened.slice() }));
    ok(sent.some(([mm, p, k]) => mm === 'POST' && p === '/api/update/open' && k === 'tok') && t1.on && t1.toast === (en ? 'Installer opened: drag cc-board into Applications to replace the old one, then reopen it' : '打开了安装包：把 cc-board 拖进「应用程序」替换旧的，再重开') && t1.opened.length === 0, '检查新版本（' + tag + '）：点「' + want(true) + '」= 带口令 POST /api/update/open，提示怎么拖，不开浏览器', JSON.stringify({ sent, t1 }));
    if (scheme === 'dark') {                               // 服务没打开（文件被删了之类）→ 报它的原因，退回浏览器开 Release 页
      openRes = { ok: false, error: '新版还没下好' }; await page.click('#updBtn', { timeout: 2000 }).catch(() => {}); await sleep(500);
      const t2 = await page.evaluate(() => ({ toast: document.querySelector('#toast span').textContent, opened: window.__opened.slice() }));
      ok(t2.toast === (en ? 'The new version is not downloaded yet' : '新版还没下好') && t2.opened.length === 1 && t2.opened[0] === U(true).page, '检查新版本（' + tag + '）：服务没打开 dmg → 提示它的原因，并在浏览器开 Release 页', JSON.stringify(t2));
      openRes = { ok: true };
    }
    upd = U(false);                                        // 自动下载关着 / 还没下好
    await page.waitForFunction((t) => (document.querySelector('#updBtn') || {}).textContent === t, want(false), { timeout: 6000 }).catch(() => {});
    const n0 = sent.length, d = await page.evaluate(() => { const b = document.querySelector('#updBtn'); if (!b) return { missing: true, text: '', title: '' }; return { text: b.textContent, title: b.title }; });
    ok(d.text === want(false) && d.title === (en ? 'Version 0.3.9 is out (you have 0.3.8). Click to download the installer in your browser' : '有新版 0.3.9（本机 0.3.8），点了用浏览器下载安装包'), '检查新版本（' + tag + '）：没下好 → 写「' + want(false) + '」，提示说用浏览器下', JSON.stringify(d));
    await page.evaluate(() => { window.__opened = []; }); await page.click('#updBtn', { timeout: 2000 }).catch(() => {}); await sleep(400);
    const op = await page.evaluate(() => window.__opened.slice());
    ok(op.length === 1 && op[0] === U(false).dmg && sent.length === n0, '检查新版本（' + tag + '）：点「' + want(false) + '」= 浏览器开 Release 的 dmg 链接，不碰服务', JSON.stringify({ op, extra: sent.slice(n0) }));
    if (scheme === 'light') await page.locator('.bar').screenshot({ path: path.join(OUT, 'update-download-' + lang + '-' + scheme + '.png') });
    if (en) ok(!m.missing && !/[一-鿿]/.test(d.title + d.text + m.title + m.text), '检查新版本（' + tag + '）：按钮和提示里没有漏翻的中文', d.title);
    upd = null;
    await page.waitForFunction(() => (document.querySelector('#updBtn') || {}).hidden, null, { timeout: 6000 }).catch(() => {});
    ok(await page.$eval('#updBtn', (b) => b.hidden).catch(() => false), '检查新版本（' + tag + '）：update 回到 null（装上新版了）→ 按钮藏起来');
    ok(errs.length === 0, '检查新版本（' + tag + '）：页面没报错', errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
}

// 手机远程（11/17）：UI_ONLY=remote 只跑这一段。--ui 夹具的 config 没有 remote → 按钮藏着；开着的样子在浏览器里改 /api/state 的应答（加 remote）造，
// /api/remote/* 拦在浏览器里（不真的出码）。远程模式：把页面里的口令换成空串（服务经 ts.net 给的就是这样）、localStorage 放一个假凭证，核 api() 带的头、401 回配对页
async function remoteCheck() {
  console.log('\n[手机远程]');
  const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/><path d="M4 4h7v7h-7zM18 4h7v7h-7zM4 18h7v7h-7z" fill="#000"/></svg>';
  const LINK = 'https://mini.tail1a2b.ts.net/pair#' + 'A'.repeat(43);
  for (const [lang, scheme] of [['zh', 'dark'], ['en', 'dark'], ['zh', 'light'], ['en', 'light']]) {
    const { ctx, page, errs } = await open({ mode: 'wall', lang, scheme }); const tag = lang + ' · ' + (scheme === 'dark' ? '深色' : '浅色');
    if (lang === 'zh' && scheme === 'dark') ok(await page.$eval('#pairBtn', (b) => b.hidden && getComputedStyle(b).display === 'none' && (document.querySelector('.brand .bname') ? getComputedStyle(document.querySelector('.brand .bname')).display !== 'none' : false)), '手机远程：config 里没有 remote（服务不给 st.remote）时，没有手机按钮，左上角照旧是「总控台」');
    const sent = []; let slow = 0, paired = false;      // slow：出码的应答晚这么多毫秒回；paired：设备表里多一台刚配上的、码没了
    await page.route('**/api/state**', async (route) => { const r = await fullState(route); const j = await r.json(); j.remote = { hosts: ['mini.tail1a2b.ts.net'], devices: 1, port: 4748 }; await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/remote/**', async (route) => {
      const q = route.request(), u = new URL(q.url()); let b = null; try { b = q.postDataJSON(); } catch {} sent.push([q.method(), u.pathname, b, q.headers()['x-ccboard'] ? 'tok' : '']);
      if (u.pathname === '/api/remote/pair' && slow && !(b && b.cancel)) await sleep(slow);
      if (u.pathname === '/api/remote/pair') return route.fulfill({ json: b && b.cancel ? { ok: true } : { ok: true, url: LINK, exp: Date.now() + 600000, ttl: 600000, qr: QR } });
      if (u.pathname === '/api/remote/devices') return route.fulfill({ json: { ok: true, hosts: ['mini.tail1a2b.ts.net'], dirty: scheme === 'dark', pairing: paired ? null : { exp: Date.now() + 600000 }, devices: [...(paired ? [{ id: 'b'.repeat(16), name: 'iPad', login: 'khalil@example.com', at: Date.now() }] : []), { id: 'a'.repeat(16), name: 'iPhone', login: 'khalil@example.com', at: Date.now() - 3600e3, seenAt: Date.now() - 60e3 }] } });
      if (u.pathname === '/api/remote/revoke') return route.fulfill({ json: { ok: true } });
      return route.fulfill({ status: 404, json: { error: 'not found' } });
    });
    await page.waitForFunction(() => !document.querySelector('#pairBtn').hidden, null, { timeout: 6000 }).catch(() => {});
    const bt = await page.evaluate(() => { const b = document.querySelector('#pairBtn'), r = b.getBoundingClientRect(), bar = document.querySelector('.bar'), br = bar.getBoundingClientRect(), nb = document.querySelector('#newBtn'), over = () => bar.scrollWidth - bar.clientWidth;
      const o1 = over(), nIn = nb.getBoundingClientRect().right <= innerWidth && nb.getBoundingClientRect().left >= 0, bn = document.querySelector('.brand .bname'), name = bn ? getComputedStyle(bn).display : 'missing';
      document.body.classList.remove('remote-on'); b.hidden = true; const o0 = over(); document.body.classList.add('remote-on'); b.hidden = false;   // 对照：remote 关着时同一屏的溢出
      return { vis: !b.hidden && r.width > 0, aria: b.getAttribute('aria-label'), inBrand: !!b.closest('.brand'), inBar: r.top >= br.top - 1 && r.bottom <= br.bottom + 1, newIn: nIn, o1, o0, name }; });
    ok(bt.vis && bt.aria === (lang === 'en' ? 'Phone' : '手机') && bt.inBrand && bt.inBar && bt.name === 'none' && bt.o1 <= bt.o0 && (lang === 'en' || (bt.newIn && bt.o1 <= 0)),
      '手机远程（' + tag + '）：remote 开着时左上角「总控台」字换成手机按钮（' + (lang === 'en' ? 'Phone' : '手机') + '）；顶栏不比关着时更挤' + (lang === 'en' ? '（英文顶栏在 1520 宽原来就溢出，只比不变差）' : '，「新任务」在视口内、顶栏不溢出'), JSON.stringify(bt));
    await page.click('#pairBtn');
    await page.waitForFunction(() => document.querySelector('#rQr svg') && document.querySelector('#rDevs .arow'), null, { timeout: 6000 }).catch(() => {}); await sleep(500);
    const d = await page.evaluate(() => { const dlg = document.querySelector('#pairDlg'), q = document.querySelector('#rQr').getBoundingClientRect(), b = dlg.getBoundingClientRect();
      return { open: dlg.open, qrW: Math.round(q.width), qrH: Math.round(q.height), inDlg: q.left >= b.left && q.right <= b.right, link: document.querySelector('#rLink').textContent, copy: !document.querySelector('#rCopy').hidden, note: document.querySelector('#rNote').textContent,
        dev: (document.querySelector('#rDevs .arow b') || {}).textContent, login: (document.querySelector('#rDevs .arow .t span') || {}).textContent, revoke: ((document.querySelector('#rDevs [data-r=revoke]') || {}).textContent || '').trim(), foot: document.querySelector('#rFoot').textContent, text: dlg.innerText, xo: dlg.scrollWidth > dlg.clientWidth + 1,
        qrBg: getComputedStyle(document.querySelector('#rQr svg rect')).fill || document.querySelector('#rQr svg rect').getAttribute('fill') }; });
    ok(d.open && d.qrW === 220 && d.qrH === 220 && d.inDlg && d.link === 'https://mini.tail1a2b.ts.net/pair#' + 'A'.repeat(43) && d.copy && d.dev === 'iPhone' && d.login === 'khalil@example.com' && d.revoke === (lang === 'en' ? 'Revoke' : '撤销这台') && !d.xo && d.foot === (lang === 'en' ? 'The phone must be on the same Tailscale network, with tailscale serve pointing at 127.0.0.1:4748. A revoked phone is refused from its next request.' : '手机要和这台 Mac 登同一个 Tailscale，tailscale serve 指向 127.0.0.1:4748。撤销以后那台手机下一次请求就被拒。'),
      '手机远程（' + tag + '）：弹层里 220 px 二维码、配对链接和「复制链接」、已配对的设备（名字、登录名）和「撤销这台」（英文是 Revoke，不是 Undo）、底下写 serve 要指向的远程端口，不横向溢出', JSON.stringify({ ...d, text: undefined }));
    if (scheme === 'dark') { const dt = await page.$eval('#rDirty', (n) => n.textContent).catch(() => '');
      ok(dt === (lang === 'en' ? 'The device list is not saved yet; retrying. If cc-board restarts before it succeeds, every phone has to pair again.' : '设备表没写进盘，正在重试。写好之前重启，所有手机都要重新配对。'), '手机远程（' + tag + '）：设备表没写进盘时（devices 应答 dirty）弹层里常驻一行红字（复审 N2）', dt); }
    ok(lang === 'en' ? /^Scan this with your phone camera\. Valid for 10 min, single use$/.test(d.note) : /^用手机相机扫这个码，10 分钟内有效，用一次就作废$/.test(d.note), '手机远程（' + tag + '）：倒计时一句', d.note);
    if (lang === 'en') ok(!/[一-鿿]/.test(d.text) && !/[一-鿿]/.test(await page.$eval('#pairBtn', (b) => b.title)), '手机远程（' + tag + '）：弹层和按钮提示里没有漏翻的中文', d.text.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: path.join(OUT, 'remote-pair-' + lang + '-' + scheme + '.png') });
    if (scheme === 'light') {                         // 码被用掉、设备表多一台刚配上的 → 写出是哪台
      paired = true;
      await page.waitForFunction(() => /^(配好了|Paired)/.test(document.querySelector('#rNote').textContent), null, { timeout: 6000 }).catch(() => {});
      const pn = await page.$eval('#rNote', (n) => n.textContent), pq = await page.$eval('#rQr', (n) => n.innerHTML);
      ok(pq === '' && pn === (lang === 'en' ? 'Paired: iPad (khalil@example.com). To pair another device, close this and click “Phone” again.' : '配好了：iPad（khalil@example.com）。要再配一台，关掉再点「手机」。'), '手机远程（' + tag + '）：码被用掉以后写出新配上的是哪台（名字、登录名），二维码收起', pn);
      await page.screenshot({ path: path.join(OUT, 'remote-paired-' + lang + '-' + scheme + '.png') });
    }
    if (lang === 'zh' && scheme === 'dark') {
      ok(sent.some(([m, p, b, t]) => m === 'POST' && p === '/api/remote/pair' && b && !b.cancel && t === 'tok') && sent.some(([m, p, , t]) => m === 'GET' && p === '/api/remote/devices' && t === 'tok'), '手机远程：打开弹层 = 带口令出一个码、读设备表', JSON.stringify(sent.map((x) => x.slice(0, 2))));
      await page.click('#rDevs [data-r=revoke]'); await sleep(600);
      ok(sent.some(([m, p, b]) => m === 'POST' && p === '/api/remote/revoke' && b && b.id === 'a'.repeat(16)), '手机远程：点「撤销」发 /api/remote/revoke 带那台的设备号', JSON.stringify(sent.filter((x) => x[1] === '/api/remote/revoke')));
      await page.keyboard.press('Escape'); await sleep(500);
      const closed = await page.evaluate(() => ({ open: document.querySelector('#pairDlg').open, qr: document.querySelector('#rQr').innerHTML, link: document.querySelector('#rLink').textContent }));
      ok(!closed.open && closed.qr === '' && closed.link === '' && sent.some(([m, p, b]) => m === 'POST' && p === '/api/remote/pair' && b && b.cancel === true), '手机远程：Esc 关掉弹层 → 发 cancel 让码作废，二维码和链接从页面上清掉', JSON.stringify({ closed, n: sent.filter((x) => x[2] && x[2].cancel).length }));
      const nc = () => sent.filter((x) => x[1] === '/api/remote/pair' && x[2] && x[2].cancel).length, c0 = nc();
      slow = 900; await page.click('#pairBtn'); await sleep(150); await page.keyboard.press('Escape'); await sleep(1800); slow = 0;   // 码还没回来就关掉弹层（审查 L3）
      const c1 = nc(), still = await page.evaluate(() => ({ open: document.querySelector('#pairDlg').open, qr: document.querySelector('#rQr').innerHTML }));
      ok(c1 === c0 + 1 && !still.open && still.qr === '', '手机远程：出码的应答还没回来就关掉弹层 → 码回来后马上发 cancel 作废，弹层不再填二维码', JSON.stringify({ c0, c1, still }));
    }
    ok(errs.length === 0, '手机远程（' + tag + '）：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  const TOK = new URL(FX.url).searchParams.get('k');
  const remotePage = async (cred, after401 = 3) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
    if (cred) await ctx.addInitScript((c) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ccb_device', JSON.stringify(c)); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, cred);
    const page = await ctx.newPage(), hdrs = [], errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.route((u) => u.pathname === '/', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace(/const K = '[^']*';/, "const K = '';") }); });
    await page.route('**/api/**', async (route) => { const h = route.request().headers(); hdrs.push([new URL(route.request().url()).pathname, h['x-ccboard'] || '', h['x-ccboard-device'] || '']);
      if (hdrs.length > after401) return route.fulfill({ status: 401, json: { error: 'device', why: 'unknown device' } });
      return route.continue({ headers: { ...h, 'x-ccboard': TOK } }); });     // 夹具服务是本机 Host，要口令；页面自己带的是设备凭证（上面记下来核）
    await page.goto(new URL(FX.url).origin + '/?k=' + TOK).catch(() => {});   // 夹具是本机服务，首页要口令；上面那条 route 把页面里的口令换成空串，页面按远程打开处理
    return { ctx, page, hdrs, errs };
  };
  {
    const CRED = '0123456789abcdef.' + 'B'.repeat(43);
    const { ctx, page, hdrs, errs } = await remotePage(CRED, 6);
    await page.waitForSelector('.card', { timeout: 8000 }).catch(() => {}); await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'remote-phone-390-zh-dark-未修宽度.png') });
    const first = hdrs.slice(0, 3);
    ok(first.length >= 2 && first.every(([, t, dv]) => t === '' && dv === CRED) && !(await page.evaluate(() => !document.querySelector('#pairBtn').hidden)), '远程打开（页面里口令是空的）：每个接口带 x-ccboard-device = 存在手机上的凭证、不带 x-ccboard；没有「手机」按钮', JSON.stringify(first.map((x) => [x[0], x[1] ? 'tok' : '', x[2] ? x[2].slice(0, 20) : ''])));
    await page.waitForURL(/\/pair\?gone=1$/, { timeout: 8000 }).catch(() => {});
    const gone = await page.evaluate(() => { try { return localStorage.getItem('ccb_device'); } catch (e) { return 'err'; } });
    ok(/\/pair\?gone=1$/.test(page.url()) && gone === null, '服务回 401（凭证被撤销）：删掉手机上存的凭证，回配对页（?gone=1）', page.url() + ' ' + gone);
    ok(errs.length === 0, '远程打开：页面没有报错', errs.join(' | ')); await ctx.close();
  }
  {
    const { ctx, page, hdrs } = await remotePage(null);
    await page.waitForURL(/\/pair$/, { timeout: 8000 }).catch(() => {});
    ok(/\/pair$/.test(page.url()) && hdrs.length === 0, '远程打开但这台手机没存凭证：直接去配对页，一个接口都不调', page.url() + ' ' + hdrs.length); await ctx.close();
  }
}

// ── 远程预览（C1 / C1.1，11/21 win-86 的补丁；11/22 换底到保温线 v2 时补这一段）：UI_ONLY=rpreview 只跑这一段 ──
// 远程模式照 remoteCheck：首页里的口令换成空串、localStorage 放一个假设备凭证，/api/** 在浏览器里补上口令转给夹具服务。
// 夹具服务是本机端口，/api/remote/preview 在这里只回 403（只给远程端口），所以它拦在浏览器里、按 server.mjs 的应答形状回：能给的文件交给夹具服务
// 真的 /api/preview 去登记，再把预览端口的网址换成 /rp/<32 位钥匙>/<文件名>；/rp/ 也拦下来，从预览端口取真文件（serveFile 发的字节和头，HTML 带 ESC_HOOK），
// 加上 rpServe() 的 CSP 头。服务那一侧的闸（证据、真身、链接、点开头、钥匙）在 state.test.mjs 的 [10]，这里只核界面：点卡片上的路径 → 带这张卡的 sid
// 问 /api/remote/preview（不问 /api/preview、不去 /api/open）；图、网页（沙盒里照样显示、读不到设备凭证、焦点在页面里 Esc 照样关）、Markdown、
// 文件夹图集、正文「图集」按钮；服务说不给 → 只弹服务那句话；不在卡片上的路径 → 不发请求；「在浏览器打开 / 在访达中显示」收起；英文。
async function remotePreviewCheck() {
  console.log('\n[远程预览]');
  const TOK = new URL(FX.url).searchParams.get('k'), ORIGIN = new URL(FX.url).origin, CRED = 'fedcba9876543210.' + 'C'.repeat(43), RP = /^\/rp\/[0-9a-f]{32}\/[^/]+$/;
  const CSP = "sandbox allow-scripts allow-popups allow-forms; frame-ancestors 'self'";     // 照 server.mjs 的 rpServe()：一律套沙盒（11/22 起 PDF 也套），不给 allow-same-origin；PDF 另加 content-disposition: attachment
  const RPD = path.join(FX.home, 'Desktop', 'rp-ui'), GAL = path.join(RPD, '总控台_封面新版');
  const png = (w, h, rgb) => {                       // 真的 w × h 纯色 PNG（naturalWidth 能量出来）
    const ck = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w * 3 }, (_, i) => rgb[i % 3]))]);
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ck('IHDR', ih), ck('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), ck('IEND', Buffer.alloc(0))]);
  };
  fs.mkdirSync(GAL, { recursive: true });
  fs.writeFileSync(path.join(RPD, 'page.html'), '<!doctype html><meta charset="utf-8"><h1 style="font:600 28px system-ui;margin:32px">remote ok</h1><p id="o" style="font:16px system-ui;margin:0 32px"></p>' +
    '<script>let ls, par; try { localStorage.getItem("ccb_device"); ls = "read"; } catch (e) { ls = "blocked"; } try { void parent.document.title; par = "read"; } catch (e) { par = "blocked"; }' +
    ' document.getElementById("o").textContent = self.origin + " | " + ls + " | " + par;</script>');
  fs.writeFileSync(path.join(RPD, 'shot.png'), png(300, 200, [60, 140, 200])); fs.writeFileSync(path.join(RPD, 'shot-b.png'), png(160, 240, [200, 120, 60]));
  fs.writeFileSync(path.join(RPD, '说明.md'), '# 远程说明\n\n- 第一条\n- 第二条\n');
  fs.writeFileSync(path.join(RPD, 'doc.pdf'), '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');   // 远程不画 PDF（11/22），只要它是 PDF 类型
  fs.writeFileSync(path.join(GAL, 'shot1.png'), png(120, 260, [200, 70, 60])); fs.writeFileSync(path.join(GAL, 'shot2.png'), png(300, 200, [60, 140, 200])); fs.writeFileSync(path.join(GAL, 'shot10.png'), png(160, 160, [90, 180, 110]));
  const MAP = { '/Users/khalil/Desktop/x y.html': path.join(RPD, 'page.html'), '~/Desktop/示例_封面/': GAL + '/' };   // links 卡正文里的两条路径换成假主目录里的真文件
  const SAYS = {                                     // 服务不给的两种：状态码和原话照 server.mjs 的 /api/remote/preview
    '~/Library/Application Support/cc-board': [200, { ok: false, reason: 'no-preview', error: '这个文件夹里不是一组图或视频，远程看不了' }],
    '~/Desktop/rp-ui/没写到.png': [404, { ok: false, reason: 'not-in-conversation', error: '这个文件不在这段对话里，远程不给看' }],
    '~/Desktop/rp-ui/链接.png': [404, { ok: false, reason: 'not-in-conversation', error: '这是指到别处的链接，远程不给看' }],         // 11/22 补英文的两句
    '~/Desktop/rp-ui/.ssh/id.txt': [404, { ok: false, reason: 'not-in-conversation', error: '点开头的文件夹（.ssh、.git 这类）远程不给看' }] };
  const WANT = { zh: { loose: '这里点的路径远程看不了，点卡片或对话里的', notGal: '这个文件夹里不是一组图或视频，远程看不了', notIn: '这个文件不在这段对话里，远程不给看',
      link: '这是指到别处的链接，远程不给看', dot: '点开头的文件夹（.ssh、.git 这类）远程不给看', pdf: 'PDF 还不能在远程预览里显示。', dl: '下载这个 PDF' },
    en: { loose: 'Paths here cannot be previewed remotely; use the ones on a card or in a conversation', notGal: 'This folder is not a set of images or videos, so it cannot be opened remotely', notIn: 'This file is not in this conversation, so remote preview will not open it',
      link: 'This is a link pointing somewhere else, so remote preview will not open it', dot: 'Files in dot-folders (like .ssh or .git) are not shown remotely', pdf: 'PDFs cannot be shown in remote preview yet.', dl: 'Download this PDF' } };
  const shot = (page, name) => page.waitForFunction(() => getComputedStyle(document.querySelector('#preview')).opacity === '1' || !document.querySelector('#preview').open, null, { timeout: 3000 }).catch(() => {})
    .then(() => page.screenshot({ path: path.join(OUT, name) }));
  for (const [lang, scheme] of [['zh', 'dark'], ['en', 'light']]) {
    const zh = lang === 'zh', W = WANT[lang], tag = '远程预览（' + lang + ' · ' + (scheme === 'dark' ? '深色' : '浅色') + '）：', sfx = lang + '-' + scheme + '.png';
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript((c) => { try { localStorage.setItem('ccb_device', JSON.stringify(c)); localStorage.setItem('ccb_mode', JSON.stringify('wall')); } catch (e) {} }, CRED);
    const page = await ctx.newPage(), perrs = [], cerrs = [], calls = [], asked = [], rpGot = [], keys = new Map(); let n404 = 0;
    page.on('pageerror', (e) => perrs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') cerrs.push(m.text()); });
    await page.route((u) => u.pathname === '/', async (route) => { const r = await route.fetch(), src = process.env.RP_HTML ? fs.readFileSync(process.env.RP_HTML, 'utf8') : await r.text();   // RP_HTML：换整页做红阶段 / 改坏对照
      await route.fulfill({ response: r, body: src.replace(/const K = '[^']*';/, "const K = '';") }); });
    await page.route('**/api/**', async (route) => { const q = route.request(), h = q.headers(); calls.push([q.method(), new URL(q.url()).pathname, h['x-ccboard'] ? 'tok' : '', h['x-ccboard-device'] || '']);
      return route.continue({ headers: { ...h, 'x-ccboard': TOK } }); });     // 夹具是本机端口、要口令；页面自己带的是设备凭证（上面记下来核）
    await page.route('**/api/remote/preview', async (route) => {           // 后注册的先匹配：这个接口不经上面那条
      const q = route.request(), h = q.headers(); let b = {}; try { b = q.postDataJSON() || {}; } catch {}
      asked.push({ b, tok: !!h['x-ccboard'], dev: h['x-ccboard-device'] || '' });
      const said = typeof b.path === 'string' && SAYS[b.path];
      if (said) { if (said[0] === 404) n404++; return route.fulfill({ status: said[0], json: said[1] }); }
      const real = (p) => MAP[p] || p;
      const r = await (await fetch(ORIGIN + '/api/preview', { method: 'POST', headers: { 'x-ccboard': TOK, 'content-type': 'application/json' }, body: JSON.stringify(Array.isArray(b.paths) ? { paths: b.paths.map(real) } : { path: real(b.path) }) })).json();
      if (!r.ok) { n404++; return route.fulfill({ status: 404, json: { ok: false, reason: 'missing', error: '这个文件不在了' } }); }   // 夹具写错了才会走到这里，下面的断言会红
      const key = (u, name) => { const k = crypto.randomUUID().replace(/-/g, ''); keys.set(k, u); return '/rp/' + k + '/' + encodeURIComponent(name); };
      if (Array.isArray(r.items)) r.items = r.items.map((it) => ({ ...it, dir: it.dir || r.dir, url: key(it.url, it.name) }));
      else if (r.kind === 'text' || r.kind === 'markdown') delete r.url; else r.url = key(r.url, r.name);
      return route.fulfill({ json: r });
    });
    await page.route('**/rp/**', async (route) => {
      const m = /^\/rp\/([0-9a-f]{32})\/([^/]+)$/.exec(new URL(route.request().url()).pathname), u = m && keys.get(m[1]); rpGot.push(m ? decodeURIComponent(m[2]) : route.request().url());
      if (!u) { n404++; return route.fulfill({ status: 404, json: { error: 'not found' } }); }
      const r = await route.fetch({ url: u }), pdf = /\.pdf$/i.test(m[2]);
      return route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': CSP, ...(pdf ? { 'content-disposition': 'attachment; filename="' + decodeURIComponent(m[2]) + '"' } : {}) } });
    });
    await page.goto(ORIGIN + '/?k=' + TOK + '&lang=' + lang).catch(() => {});
    const linkSel = (p) => `.card[data-sid="${FX.sids.links}"] .body [data-path="${p}"]`;
    await page.waitForSelector(linkSel('/Users/khalil/Desktop/x y.html'), { timeout: 10000 }).catch(() => {}); await sleep(1200);
    const clickCard = (p) => page.evaluate((sel) => { const a = document.querySelector(sel); if (a) a.click(); return !!a; }, linkSel(p));
    const clickIn = (p, where) => page.evaluate(([sid, p, where]) => {     // 往卡片正文（card）或页面空白处（loose）临时放一条路径、点它、拿掉，同一拍里做完，不怕轮询重画
      const host = where === 'card' ? document.querySelector('.card[data-sid="' + sid + '"] .body') : document.body; if (!host) return false;
      const a = document.createElement('a'); a.className = 'file'; a.dataset.path = p; a.textContent = p; host.appendChild(a); a.click(); a.remove(); return true; }, [FX.sids.links, p, where]);
    const close = async () => { if (await page.evaluate(() => document.querySelector('#preview').open)) await page.click('#preview [data-close]'); await sleep(300); };
    const pv = () => page.evaluate(() => { const q = (s) => document.querySelector(s), v = (s) => !q(s).hidden, im = q('#pImg');
      return { open: q('#preview').open, kind: q('#pBody').dataset.kind, title: q('#pTitle').textContent, dir: q('#pDir').textContent, openHidden: q('#pOpen').hidden, reloadHidden: q('#pReload').hidden,
        frame: v('#pFrame'), img: v('#pImg'), text: v('#pText'), frameSrc: q('#pFrame').getAttribute('src') || '', imgSrc: im.getAttribute('src') || '', imgW: im.naturalWidth,
        h1: (q('#pText h1, #pText h2, #pText h3') || {}).textContent || '', li: document.querySelectorAll('#pText li').length,      // md() 把 # 排成哪一级标题都算
        tiles: [...document.querySelectorAll('#pGal .gi')].map((x) => { const i = x.querySelector('img'); return { name: (x.querySelector('.gn') || {}).textContent || '', src: i ? i.getAttribute('src') : '', w: i ? i.naturalWidth : 0 }; }),
        head: [...document.querySelectorAll('#preview .dhead button')].filter((b) => !b.hidden).map((b) => [b.textContent.trim(), b.getAttribute('aria-label') || '', b.title || ''].join('|')).join(' ') }; });
    const rpOk = (u) => { try { return RP.test(new URL(u, ORIGIN).pathname); } catch { return false; } };
    const toastAfter = async (fn, want) => {               // 先清掉提示条上的字，免得认成上一次的
      await page.evaluate(() => { document.querySelector('#toast span').textContent = ''; }); const n0 = asked.length; await fn();
      await page.waitForFunction((w) => document.querySelector('#toast span').textContent === w, want, { timeout: 5000 }).catch(() => {});
      return { text: await page.$eval('#toast span', (s) => s.textContent), on: await page.$eval('#toast', (t) => t.classList.contains('on')), open: await page.evaluate(() => document.querySelector('#preview').open), asked: asked.slice(n0) }; };
    const last = () => asked[asked.length - 1] || {};
    // ① 不在卡片上的路径：不知道是哪段对话，不发请求
    const L0 = await toastAfter(() => clickIn('~/Desktop/rp-ui/shot.png', 'loose'), W.loose);
    ok(L0.text === W.loose && L0.on && !L0.open && L0.asked.length === 0, tag + '不在卡片上的路径（不知道是哪段对话）→ 不发请求，提示点卡片上的', JSON.stringify(L0));
    // ② 卡片正文里的 .html：网页进 iframe，套着 CSP 沙盒
    await clickCard('/Users/khalil/Desktop/x y.html');
    let fr = null; for (let i = 0; i < 60 && !fr; i++) { await sleep(100); fr = page.frames().find((f) => /\/rp\/[0-9a-f]{32}\/page\.html$/.test(f.url())) || null; }
    const inner = fr ? await fr.waitForFunction(() => (document.querySelector('#o') || {}).textContent, null, { timeout: 5000 })
      .then(() => fr.evaluate(() => ({ h1: document.querySelector('h1').textContent, o: document.querySelector('#o').textContent }))).catch((e) => ({ err: String(e).slice(0, 160) })) : null;
    const P = await pv(), a1 = last();
    ok(a1.b && a1.b.sid === FX.sids.links && a1.b.path === '/Users/khalil/Desktop/x y.html' && Object.keys(a1.b).length === 2 && !a1.tok && a1.dev === CRED, tag + '点卡片正文里的 .html → POST /api/remote/preview { sid: 这张卡, path }，带设备凭证、不带口令', JSON.stringify(a1));
    ok(P.open && P.kind === 'page' && P.frame && rpOk(P.frameSrc) && /\/page\.html$/.test(P.frameSrc) && P.title === 'page.html' && P.openHidden && !P.reloadHidden, tag + '网页进 iframe，网址是 /rp/<32 位钥匙>/page.html；「在浏览器打开」收起、重新载入还在', JSON.stringify({ ...P, tiles: undefined }));
    ok(inner && inner.h1 === 'remote ok' && inner.o === 'null | blocked | blocked', tag + '网页在沙盒里照样显示；它的脚本是空源，读不到 localStorage（手机存的设备凭证），也读不到总控台页面', JSON.stringify(inner));
    if (zh) {
      await shot(page, 'rpreview-01-page-' + sfx);
      let focused = false; if (fr) { await fr.click('h1').catch(() => {}); focused = await fr.evaluate(() => document.hasFocus()).catch(() => false); }
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#preview').open, null, { timeout: 3000 }).catch(() => {});
      const shut = await page.evaluate(() => ({ open: document.querySelector('#preview').open, src: document.querySelector('#pFrame').getAttribute('src') }));
      ok(focused && !shut.open && shut.src === 'about:blank', tag + '焦点在沙盒网页里按 Esc 照样关预览（预览端口加的 Esc 脚本在沙盒里也跑），页面跟着卸载', JSON.stringify({ focused, shut }));
    } else {
      ok(P.head !== '' && !/[㐀-鿿]/.test(P.head), tag + '预览顶栏的按钮和提示没有漏翻的中文', P.head);
      await close();
    }
    if (zh) {
      // ③ 图：总控台自己的 <img>，从 /rp/ 取
      await clickIn('~/Desktop/rp-ui/shot.png', 'card');
      await page.waitForFunction(() => { const i = document.querySelector('#pImg'); return !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
      const I = await pv(), a2 = last();
      ok(a2.b && a2.b.sid === FX.sids.links && a2.b.path === '~/Desktop/rp-ui/shot.png' && I.open && I.kind === 'image' && I.img && !I.frame && I.imgW === 300 && rpOk(I.imgSrc) && I.openHidden,
        tag + '图：带这张卡的 sid 问，<img> 从 /rp/ 取到真图（naturalWidth 300），「在浏览器打开」收起', JSON.stringify({ b: a2.b, kind: I.kind, img: I.img, imgW: I.imgW, imgSrc: I.imgSrc, openHidden: I.openHidden }));
      await shot(page, 'rpreview-02-image-' + sfx); await close();
      // ④ Markdown：内容随应答来，不另取 /rp/
      const nRp = rpGot.length; await clickIn('~/Desktop/rp-ui/说明.md', 'card');
      await page.waitForFunction(() => (document.querySelector('#pText h1, #pText h2, #pText h3') || {}).textContent === '远程说明', null, { timeout: 5000 }).catch(() => {});
      const M = await pv();
      ok(M.open && M.kind === 'markdown' && M.text && M.h1 === '远程说明' && M.li === 2 && rpGot.length === nRp && M.openHidden, tag + 'Markdown：内容随应答来、照本机排版（标题、两条列表），不另取 /rp/', JSON.stringify({ kind: M.kind, h1: M.h1, li: M.li, rp: rpGot.length - nRp }));
      await close();
    }
    // ⑤ 卡片上的文件夹：同一个接口，回图集
    await clickCard('~/Desktop/示例_封面/');
    await page.waitForFunction(() => { const im = [...document.querySelectorAll('#pGal .gi img')]; return document.querySelector('#pBody').dataset.kind === 'gallery' && im.length === 3 && im.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 6000 }).catch(() => {});
    const G = await pv(), a3 = last();
    ok(a3.b && a3.b.sid === FX.sids.links && a3.b.path === '~/Desktop/示例_封面/' && Object.keys(a3.b).length === 2, tag + '点卡片上的文件夹 → 同一个接口带 { sid, path: 文件夹 }', JSON.stringify(a3.b));
    ok(G.open && G.kind === 'gallery' && JSON.stringify(G.tiles.map((t) => t.name)) === '["shot1.png","shot2.png","shot10.png"]' && G.tiles.every((t) => t.w > 0 && rpOk(t.src)) && G.title === '总控台_封面新版' &&
      G.dir.startsWith('~/Desktop/rp-ui/') && G.dir.endsWith(zh ? '共 3 个' : '3 items'), tag + '文件夹排成图集：3 张按数字排、每张都从 /rp/ 取到真图，顶栏写文件夹名、~ 开头的位置和共几个', JSON.stringify({ ...G, head: undefined }));
    ok(G.openHidden && !G.reloadHidden, tag + '文件夹图集也不给「在访达中显示」（远程没有 /api/open），重新载入还在', JSON.stringify([G.openHidden, G.reloadHidden]));
    await shot(page, (zh ? 'rpreview-03-folder-' : 'rpreview-05-folder-') + sfx);
    if (zh) {
      await page.click('#pGal [data-gi="1"]').catch(() => {});
      await page.waitForFunction(() => { const i = document.querySelector('#pGal .lb .lstage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 4000 }).catch(() => {});
      const LB = await page.evaluate(() => { const i = document.querySelector('#pGal .lb .lstage img'); return i ? { src: i.getAttribute('src'), w: i.naturalWidth, cap: document.querySelector('#pGal .lb .lcap').textContent } : null; });
      ok(LB && rpOk(LB.src) && /\/shot2\.png$/.test(LB.src) && LB.w === 300 && /2 \/ 3/.test(LB.cap), tag + '图集里点第 2 张放大：大图也是 /rp/ 的网址、取到了', JSON.stringify(LB));
      await page.keyboard.press('Escape'); await sleep(200);
    }
    await close();
    if (zh) {
      // ⑥ 正文里的「图集」按钮：paths
      const chipped = await page.evaluate(([sid, paths]) => { const host = document.querySelector('.card[data-sid="' + sid + '"] .body'); if (!host) return false;
        const d = document.createElement('div'); d.innerHTML = L(md(paths.join(' '))); host.appendChild(d); const c = d.querySelector('[data-gallery]'); if (c) c.click(); d.remove(); return !!c; }, [FX.sids.links, ['~/Desktop/rp-ui/shot.png', '~/Desktop/rp-ui/shot-b.png']]);
      await page.waitForFunction(() => { const im = [...document.querySelectorAll('#pGal .gi img')]; return document.querySelector('#pBody').dataset.kind === 'gallery' && im.length === 2 && im.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 6000 }).catch(() => {});
      const C = await pv(), a4 = last();
      ok(chipped && a4.b && a4.b.sid === FX.sids.links && JSON.stringify(a4.b.paths) === '["~/Desktop/rp-ui/shot.png","~/Desktop/rp-ui/shot-b.png"]' && !('path' in a4.b), tag + '卡片正文的「图集」按钮 → 同一个接口带 { sid, paths }', JSON.stringify({ chipped, b: a4.b }));
      ok(C.open && C.kind === 'gallery' && C.tiles.length === 2 && C.tiles.every((t) => t.w > 0 && rpOk(t.src)) && C.title === '图集' && C.openHidden && C.reloadHidden, tag + '一批图拼成图集，每张从 /rp/ 取到；顶栏两个按钮都收起', JSON.stringify({ ...C, head: undefined }));
      await close();
    }
    // ⑦ 服务说不给：只弹服务那句话（英文界面翻成英文），不开预览、不退回 /api/open
    const D1 = await toastAfter(() => clickCard('~/Library/Application Support/cc-board'), W.notGal);
    ok(D1.text === W.notGal && D1.on && !D1.open && D1.asked.length === 1 && D1.asked[0].b.path === '~/Library/Application Support/cc-board', tag + '服务说这个文件夹不是一组图（200 no-preview）→ 只弹服务那句话，不开预览', JSON.stringify(D1));
    const D2 = await toastAfter(() => clickIn('~/Desktop/rp-ui/没写到.png', 'card'), W.notIn);
    ok(D2.text === W.notIn && D2.on && !D2.open && D2.asked.length === 1, tag + '服务说不在这段对话里（404）→ 只弹服务那句话，不开预览', JSON.stringify(D2));
    await shot(page, (zh ? 'rpreview-04-deny-' : 'rpreview-06-deny-') + sfx);
    // ⑦b 11/22：「指到别处的链接」「点开头的文件夹」两句拒绝英文界面也翻成英文（原来漏翻，英文界面弹中文）
    const D3 = await toastAfter(() => clickIn('~/Desktop/rp-ui/链接.png', 'card'), W.link), D4 = await toastAfter(() => clickIn('~/Desktop/rp-ui/.ssh/id.txt', 'card'), W.dot);
    ok(D3.text === W.link && D3.on && !D3.open && D4.text === W.dot && D4.on && !D4.open, tag + '服务说是指到别处的链接 / 点开头的文件夹 → 只弹服务那句话' + (zh ? '' : '（翻成英文）') + '，不开预览', JSON.stringify([D3.text, D4.text]));
    // ⑨ 11/22 作者 定：PDF 远程不画（沙盒 iframe 里哪个浏览器都显示不出来）。预览里写明显示不了，给一个下载链接（同一把 /rp/ 钥匙，服务按附件发），iframe 不载
    await clickIn('~/Desktop/rp-ui/doc.pdf', 'card');
    await page.waitForFunction(() => !!document.querySelector('#pText .rpdf a'), null, { timeout: 5000 }).catch(() => {});
    const F = await page.evaluate(() => { const q = (s) => document.querySelector(s), a = q('#pText .rpdf a'), fr = q('#pFrame');
      return { open: q('#preview').open, kind: q('#pBody').dataset.kind, title: q('#pTitle').textContent, text: !q('#pText').hidden, frame: !fr.hidden, frameSrc: fr.getAttribute('src') || '', wait: !q('#pWait').hidden,
        msg: (q('#pText .rpdf p') || {}).textContent || '', href: a ? a.getAttribute('href') : '', dl: a ? a.getAttribute('download') : null, link: a ? a.textContent : '', openHidden: q('#pOpen').hidden }; }), a5 = last();
    ok(a5.b && a5.b.sid === FX.sids.links && a5.b.path === '~/Desktop/rp-ui/doc.pdf' && F.open && F.kind === 'pdf' && F.title === 'doc.pdf' && F.text && !F.frame && !/\/rp\//.test(F.frameSrc) && !F.wait && F.openHidden,
      tag + 'PDF：带这张卡的 sid 问；预览打开但 iframe 不载 /rp/（不硬画）、没有「读取中」、「在浏览器打开」收起', JSON.stringify({ b: a5.b, ...F }));
    ok(F.msg === W.pdf && F.link === W.dl && rpOk(F.href) && /\/doc\.pdf$/.test(F.href) && F.dl === 'doc.pdf', tag + 'PDF：写明「' + W.pdf + '」，下面一个「' + W.dl + '」链接，指着 /rp/<钥匙>/doc.pdf、带 download', JSON.stringify({ msg: F.msg, link: F.link, href: F.href, dl: F.dl }));
    // 看得清：说明和链接的字色对它们实际落在的底色（往上找第一个不透明的底色，半透明的字色先混进底色）的对比度。11/22 第一版深色下底是 .pbody 给 iframe 的白、字是主题的浅色，链接几乎看不见，看截图才发现
    const CR = await page.evaluate(() => {
      const rgb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number), bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length >= 4 && c[3] > 0)) return c.slice(0, 3); } return [255, 255, 255]; };
      const mix = (fg, bg) => (fg.length >= 4 ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg), lum = (c) => c.reduce((a, v, i) => { v /= 255; v = v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
      const ratio = (el) => { if (!el) return 0; const bg = bgOf(el), fg = mix(rgb(getComputedStyle(el).color), bg), x = lum(fg), y = lum(bg); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
      return { msg: ratio(document.querySelector('#pText .rpdf p')), link: ratio(document.querySelector('#pText .rpdf a')) }; });
    ok(CR.link >= 4.5 && CR.msg >= 3, tag + 'PDF：说明和下载链接看得清（字色对实际底色的对比度：链接 ≥ 4.5、说明 ≥ 3）', JSON.stringify(CR));
    const [dlEv] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#pText .rpdf a').catch(() => {})]);
    const dlName = dlEv ? dlEv.suggestedFilename() : '', dlUrl = dlEv ? new URL(dlEv.url()).pathname : '';
    if (dlEv) await dlEv.cancel().catch(() => {});
    ok(dlName === 'doc.pdf' && RP.test(dlUrl), tag + 'PDF：点「' + W.dl + '」真的开始下载 doc.pdf（取的是那把 /rp/ 钥匙）', JSON.stringify({ dlName, dlUrl }));
    await shot(page, (zh ? 'rpreview-07-pdf-' : 'rpreview-08-pdf-') + sfx); await close();
    // ⑧ 整段：页面没调过 /api/preview、/api/open；页面发的每个接口都带设备凭证、不带口令
    const bad = calls.filter(([, p]) => p === '/api/preview' || p === '/api/open' || p === '/api/reveal'), noDev = calls.filter(([, , t, d]) => t || d !== CRED);
    ok(calls.length > 0 && bad.length === 0 && noDev.length === 0, tag + '整段没调 /api/preview、/api/open；页面发的每个接口都带设备凭证、不带口令', JSON.stringify({ n: calls.length, bad, noDev: noDev.slice(0, 3) }));
    const is404 = (m) => /status of 404/.test(m), other = cerrs.filter((m) => !is404(m));
    ok(perrs.length === 0 && other.length === 0 && cerrs.filter(is404).length <= n404, tag + '页面没有报错（服务故意回的 404 最多各一行）', JSON.stringify({ perrs, other, n404, got404: cerrs.filter(is404).length }));
    await ctx.close();
  }
  fs.rmSync(RPD, { recursive: true, force: true });
}

// ── 「先放着」带时间：待跟进的卡点「先放着」出三档（20 点以后没有「今晚」）+ 原来的「等它下次交付」；选 1 小时 → 服务记着（/api/state 里有 snooze），
//    卡片样子同处理过、药丸写到几点，不再算待跟进；提示条「撤销」→ 服务清掉、回到待跟进。待审阅的「审完了」照旧一点就处理、不出菜单。
//    中文浅色、英文深色各一遍，截图。服务端的醒 / 不醒在 state.test.mjs 的 [3s]。单独跑：UI_ONLY=snooze
// ── 「审完了」跨设备（作者反馈：手机和电脑上的待跟进、待审阅个数对不上）。
// 两个浏览器上下文 = 两台设备（各有各的 localStorage），共用一份夹具服务。A 点「审完了」→ B 不刷新、一两拍内那张卡变「处理过」，
// 顶栏的「待审阅」、窗口标题、Dock 角标（外壳收到的 badge）都少一个；之后才打开的 C（新配的手机）一打开就是处理过；A 撤销 → A 马上回来、B 和 C 一两拍内回来。
// 服务换了一台（重启后 processed 是空的）：页面要把本机记的重发一遍。在 A 的应答里把启动号改掉来模拟。UI_ONLY=procsync 只跑这一段
async function procSyncCheck() {
  console.log('\n[审完了 · 跨设备]');
  const X = FX.sids.done, sel = '.card[data-sid="' + X + '"]';
  const dev = async (settle = 2600) => {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark' });
    await ctx.addInitScript(() => { try { localStorage.setItem('ccb_mode', '"wall"'); } catch (e) {} window.__tell = []; window.webkit = { messageHandlers: { ccb: { postMessage: (m) => window.__tell.push(m) } } }; });   // 假外壳：记下 Dock 角标
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(FX.url + '&lang=zh'); await page.waitForSelector(sel); if (settle) await sleep(settle);
    return { ctx, page, errs };
  };
  const look = (page) => page.evaluate(({ sel, X }) => {
    const c = document.querySelector(sel), t = (window.__tell || []).filter((m) => m && m.type === 'badge'); let local = null;
    try { local = JSON.parse(localStorage.getItem('ccb_done') || '{}')[X] || null; } catch (e) {}
    return { cls: c ? c.className : '', meta: c ? c.querySelector('.meta').textContent : '', review: ([...document.querySelectorAll('#filters button')].find((b) => /^待审阅/.test(b.textContent)) || {}).textContent || '',
      title: document.title, badge: t.length ? t[t.length - 1].n : null, local };
  }, { sel, X });
  const num = (s) => Number((String(s).match(/\d+/) || [NaN])[0]);
  const waitFor = async (page, fn, ms = 4500) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await look(page); if (fn(v)) return { v, ms: Date.now() - t0 }; await sleep(150); } return { v, ms: -1 }; };
  const isRev = (v) => /^待审阅 · /.test(v.meta) && /s-review/.test(v.cls), isDone = (v) => /^处理过 · /.test(v.meta) && /s-handled/.test(v.cls);
  await srvClear([X]);      // 前面的段可能留下了服务里的一笔
  const A = await dev(), B = await dev();
  const a0 = await look(A.page), b0 = await look(B.page), nR = num(b0.review), nT = num(b0.title);
  ok(isRev(a0) && isRev(b0) && nR > 0 && b0.badge === nT, '两台都开着：done 在两边都是「待审阅」；B 的顶栏待审阅 ' + nR + '、标题和 Dock 角标都是 ' + nT, JSON.stringify({ a0, b0 }));
  await A.page.click(sel + ' [data-act="done"]'); await sleep(300);
  const a1 = await look(A.page);
  const b1 = await waitFor(B.page, isDone);
  ok(isDone(a1) && b1.ms >= 0 && !b1.v.local, 'A 点「审完了」→ B 不刷新、' + (b1.ms >= 0 ? b1.ms + ' ms' : '4.5 秒还没') + ' 内也变「处理过」（B 本机的 ccb_done 里没有它：是服务给的）', JSON.stringify({ a1, b1 }));
  ok(num(b1.v.review) === nR - 1 && num(b1.v.title) === nT - 1 && b1.v.badge === nT - 1, 'B 的计数跟着少一个：顶栏「待审阅」' + nR + ' → ' + (nR - 1) + '、窗口标题、Dock 角标 ' + nT + ' → ' + (nT - 1), JSON.stringify(b1.v));
  // 撤销：提示条只给 6 秒，所以先撤销、后开 C。先等 A 自己也拉到了服务那一笔（旧界面没有 srvDone 就不等）：撤销时服务要下一拍才清，这几秒 A 不能再认它（undone）
  const hasSrv = await A.page.evaluate(() => typeof srvDone === 'object');
  const aSaw = hasSrv && await A.page.waitForFunction((X) => !!srvDone[X], X, { timeout: 3000 }).then(() => true, () => false);
  await A.page.click('#toast button', { timeout: 1500 }).catch(() => {}); await sleep(50);
  const a2 = await look(A.page);
  ok(isRev(a2) && !a2.local, 'A 在提示条上点「撤销」→ A 马上回到「待审阅」（A 手上服务给的那一份还记着它，' + (aSaw ? '已核' : '没等到') + '；不等服务下一拍）', JSON.stringify(a2));
  const b2 = await waitFor(B.page, isRev);
  ok(b2.ms >= 0 && num(b2.v.review) === nR && num(b2.v.title) === nT && b2.v.badge === nT, 'A 撤销 → B 一两拍内回到「待审阅」，B 的顶栏、标题、Dock 角标回到 ' + nT, JSON.stringify(b2));
  // 新配的手机：A 再点一次，之后才打开的 C 一打开就是处理过
  await A.page.click(sel + ' [data-act="done"]', { timeout: 1500 }).catch(() => {}); await waitFor(B.page, isDone);
  const C = await dev(0), c1 = await look(C.page);
  ok(isDone(c1) && !c1.local, '之后才打开的 C（新配的手机，一次都没点过）：第一次画出来就是「处理过」', JSON.stringify(c1));
  // 服务重启：processed 读回盘上的；万一丢了（旧服务、写盘失败），页面看到启动号变了要把本机 ccb_done 再发一遍，另一台才又看得到
  await B.page.evaluate((X) => api('/api/processed', { clear: [X] }), X);       // 当成重启丢了这一笔
  const b3 = await waitFor(B.page, isRev);
  const resend = []; A.page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/processed')) { try { resend.push(JSON.parse(r.postData() || '{}')); } catch (e) {} } });
  await A.page.route('**/api/state*', async (route) => { const r = await route.fetch(); const j = await r.json(); if (typeof j.v === 'string') j.v = 'deadbeef' + j.v.slice(8); await route.fulfill({ response: r, json: j }); });
  const b4 = await waitFor(B.page, isDone, 6000);
  ok(b3.ms >= 0 && resend.length >= 1 && resend[0].map && typeof resend[0].map[X] === 'string' && b4.ms >= 0, '服务换了一台（A 看到的启动号变了）：A 把本机记的「审完了」重发一遍（POST /api/processed 带 done），B 又跟着变「处理过」', JSON.stringify({ lost: b3.ms, resend: resend.slice(0, 2), b4: b4.ms }));
  const errs = [...A.errs, ...B.errs, ...C.errs];
  await A.ctx.close(); await C.ctx.close();           // 先关 A：它本机还记着，开着的话下一次「换台」又会把这一笔发回服务
  await B.page.evaluate((X) => api('/api/processed', { clear: [X] }), X); await sleep(200); await B.ctx.close();
  ok(errs.length === 0, '审完了 · 跨设备：三个页面都没报错', errs.join(' | '));
}

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

// ── 架构 · 放射（11/17 win-e7）：作者 11/17 22:38「任务多的话……我在最上面金字塔级的这个可能显示的就不是很那个了……做成一个像类似 Canvas 一样的，就是我在中间，然后呢可以放射状出去」。
//    顶栏「层级 | 放射」（#oshape，记在 ccb_orgshape，默认层级）；放射是同一份 org、同一批方块换个摆法：你和总管在圆心，每个项目一个扇区，窗口按上下级一圈圈往外。
//    中文深色（服务的真实输出）走完整流程：默认层级 → 切过去 → 放回窗口里、不重叠、左边的往左伸、先后不跟状态、输入没变不重排、某个窗口空闲 → 在跑时位置不动、
//    线（一个方块一条、两头接在方块边上、不从「你」和总管底下穿过）、悬停 / 聚焦原地展开和依据、缩小着看时放回原大、悬停总管时图不跳、滚轮挪、Ctrl / ⌘ + 滚轮以指针为中心缩放、
//    拖空白处、他动过以后轮询和窗口变大小都不替他摆正、右下角三个按钮、窗口变大小（他没动过）重新放回、双击空白处、点方块放大看、main 不滚、墙和封面里没有开关、重开还在、切回层级和原来一样；
//    纯函数 orgMapLayout 在页面的 Worker 里喂 8 组数据（含 kids 有环，每组限时 8 秒）、orgMapRound；4 个项目（在浏览器里改 /api/state）看扇区的方位、左边倒着排、去总管的线停在「你」的边上；
//    英文浅色核文字和不报错。期望值从 /api/state 原始数据和方块的屏幕位置另算，不读界面的布局结果。单独跑：UI_ONLY=orgmap node test/ui-check.mjs
async function orgMapCheck() {
  console.log('\n[架构 · 放射]');
  const S2N = Object.fromEntries(Object.entries(FX.sids).map(([k, v]) => [v, k]));
  const tap = (page, sel) => page.click(sel, { timeout: 3000 }).then(() => true).catch(() => false);
  const ctxOf = async ({ lang = 'zh', scheme = 'dark', w = 1520, h = 900, shape = null, route = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { try { localStorage.setItem('ccb_mode', '"org"'); if (s) localStorage.setItem('ccb_orgshape', JSON.stringify(s)); } catch (e) {} }, shape);
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    if (route) await page.route('**/api/state*', route);
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector('#org .onode .ot', { timeout: 10000 }).catch(() => {}); await sleep(2600);
    return { ctx, page, errs };
  };
  // 一张图的样子：每个方块的屏幕位置、展开没有、依据、线、你 / 总管 / 圆心那一块、画布、开关、按钮（底上没有这些元素时读成空的，断言照常变红）
  const mapOf = (page) => ev(page, (sids) => {
    const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k])), q = (s) => document.querySelector(s);
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const nodes = {};
    for (const li of document.querySelectorAll('#org .omnodes > .oli')) {
      const b = li.querySelector('.onode'); if (!b) continue;
      nodes[name[li.dataset.sid] || li.dataset.sid] = { sid: li.dataset.sid, ar: li.classList.contains('ar'), hot1: li.classList.contains('hot1'), hot: b.classList.contains('hot'), box: b.className, tr: li.style.transform, r: R(b), o2: vis(b.querySelector('.o2')), o3: vis(b.querySelector('.o3')), why: b.dataset.why || '' };
    }
    const sv = q('#org .omlines'), tip = q('#otip'), m = q('main'), sh = q('#oshape'), ctl = q('#org .omctl');
    let V = null; try { V = { k: orgV.k, x: orgV.x, y: orgV.y, user: orgV.user }; } catch (e) {}
    return { map: !!q('#org.map'), cols: document.querySelectorAll('#org .ocol').length, n: Object.keys(nodes).length, nodes,
      order: [...document.querySelectorAll('#org .omnodes > .oli')].map((li) => name[li.dataset.sid] || li.dataset.sid),
      chief: R(q('#org .ochief .onode')), chiefX: q('#org .ochief .oli') ? { hot1: q('#org .ochief .oli').classList.contains('hot1'), o3: vis(q('#org .ochief .onode .o3')) } : null, you: R(q('#org .oyou')), top: R(q('#org .otop')), omv: R(q('#org .omv')), main: R(m),
      labs: [...document.querySelectorAll('#org .omlabs > .ghead')].map((x) => ({ text: x.textContent, r: R(x) })),
      tip: tip && !tip.hidden ? { text: tip.textContent, r: R(tip) } : null,
      hotD: sv ? sv.querySelector('path.hot').getAttribute('d') || '' : null, youHot: !!q('#org .oyou.hot'), chiefHot: !!q('#org .ochief .onode.hot'),
      shape: { shown: vis(sh), label: sh ? sh.getAttribute('aria-label') : null, btns: sh ? [...sh.querySelectorAll('button')].map((x) => [x.dataset.oshape, x.textContent.trim(), x.getAttribute('aria-pressed')]) : [] },
      ctl: ctl ? { r: R(ctl), label: ctl.getAttribute('aria-label'), btns: [...ctl.querySelectorAll('button')].map((x) => ({ k: x.dataset.omz, text: x.textContent.trim(), label: x.getAttribute('aria-label') || '', title: x.title || '' })) } : null,
      store: localStorage.getItem('ccb_orgshape'), V };
  }, FX.sids);
  // 层级图的结构：有哪几列、每个方块画在谁下面（或哪一组）
  const treeOf = (page) => ev(page, (sids) => {
    const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k]));
    return { cols: [...document.querySelectorAll('#org .ocol')].map((c) => c.dataset.key), up: Object.fromEntries([...document.querySelectorAll('#org .onode')].map((b) => {
      const li = b.closest('.oli'), p = li && li.parentElement && li.parentElement.closest('.oli'), g = b.closest('.ogrp');
      return [name[b.dataset.sid] || b.dataset.sid, p ? name[p.dataset.sid] || p.dataset.sid : b.closest('.ochief') ? 'top' : g ? (b.closest('.ocol') || {}).dataset.key + '/' + g.dataset.g : null]; })) };
  }, FX.sids);
  // 线：把 path 的每一段换算到屏幕上（世界那一层 .omw 的 transform + 画布的位置），看两头各落在哪个方块的边上、中间有没有穿过「你」或总管的方块（另写的取样，不用界面算线的办法）
  const linesOf = (page) => ev(page, () => {
    const sv = document.querySelector('#org .omlines'), w = document.querySelector('#org .omw'), v = document.querySelector('#org .omv'); if (!sv || !w || !v) return null;
    const m = new DOMMatrix(getComputedStyle(w).transform), o = v.getBoundingClientRect(), P = (x, y) => ({ x: o.left + m.a * x + m.c * y + m.e, y: o.top + m.b * x + m.d * y + m.f });
    const boxes = [...document.querySelectorAll('#org .omnodes .onode')].map((b) => ({ sid: b.dataset.sid, r: b.getBoundingClientRect() }));
    const you = document.querySelector('#org .oyou').getBoundingClientRect(), ce = document.querySelector('#org .ochief .onode'), chief = ce ? ce.getBoundingClientRect() : null;
    const onEdge = (p, r, t = 2) => p.x >= r.left - t && p.x <= r.right + t && p.y >= r.top - t && p.y <= r.bottom + t && (Math.abs(p.x - r.left) <= t || Math.abs(p.x - r.right) <= t || Math.abs(p.y - r.top) <= t || Math.abs(p.y - r.bottom) <= t);
    const inside = (p, r) => p.x > r.left + 1.5 && p.x < r.right - 1.5 && p.y > r.top + 1.5 && p.y < r.bottom - 1.5;
    // 一条线是直线（M…L…）或绕开圆心的弧（M…Q 控制点 终点，二次贝塞尔；11/18 win-eb）。.omw 的 transform 是仿射的，控制点照样换算，曲线上的点取样也照样对
    const segs = [...(sv.querySelector('path.base').getAttribute('d') || '').matchAll(/M(-?[\d.]+) (-?[\d.]+)(?:L(-?[\d.]+) (-?[\d.]+)|Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+))/g)]
      .map((x) => (x[3] !== undefined ? { a: P(+x[1], +x[2]), b: P(+x[3], +x[4]) } : { a: P(+x[1], +x[2]), c: P(+x[5], +x[6]), b: P(+x[7], +x[8]) }));
    const at = (s, t) => (s.c ? { x: (1 - t) ** 2 * s.a.x + 2 * (1 - t) * t * s.c.x + t * t * s.b.x, y: (1 - t) ** 2 * s.a.y + 2 * (1 - t) * t * s.c.y + t * t * s.b.y } : { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
    const out = { n: segs.length, q: segs.filter((s) => s.c).length, li: document.querySelectorAll('#org .omnodes > .oli').length, endNot: 0, startNot: 0, toYou: 0, toChief: 0, cross: [], crossKid: [] };
    for (const s of segs) {
      const { a, b } = s, child = boxes.find((x) => onEdge(b, x.r)); if (!child) out.endNot++;
      const from = onEdge(a, you) ? 'you' : chief && onEdge(a, chief) ? 'chief' : boxes.some((x) => x !== child && onEdge(a, x.r)) ? 'box' : null;
      if (!from) out.startNot++; else if (from === 'you') out.toYou++; else if (from === 'chief') out.toChief++;
      for (let i = 1; i < 60; i++) { const p = at(s, i / 60); if (inside(p, you) || (chief && inside(p, chief))) { out[from === 'box' ? 'crossKid' : 'cross'].push([a, b].map((z) => [Math.round(z.x), Math.round(z.y)])); break; } }
    }
    return out;
  });
  const rects = (page, names) => ev(page, (l) => Object.fromEntries(l.map(([n, sid]) => { const b = document.querySelector('#org .omnodes .onode[data-sid="' + sid + '"]'); if (!b) return [n, null]; const r = b.getBoundingClientRect(); return [n, { l: r.left, t: r.top, w: r.width, h: r.height }]; })), names.map((n) => [n, FX.sids[n]]));
  // 画布里一块空白（离每个方块、圆心、项目名、按钮都 ≥ 24 px），离 (fx, fy) 那一点最近的
  const emptyAt = (page, fx = 0.5, fy = 0.5) => ev(page, ([fx, fy]) => {
    const v = document.querySelector('#org .omv'); if (!v) return null; const q = v.getBoundingClientRect();
    const rs = [...document.querySelectorAll('#org .onode, #org .otop, #org .omlabs > .ghead, #org .omctl, #crash')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const far = (x, y) => rs.every((r) => x < r.left - 24 || x > r.right + 24 || y < r.top - 24 || y > r.bottom + 24);
    let best = null, bd = Infinity; const cx = q.left + q.width * fx, cy = q.top + q.height * fy;
    for (let y = q.top + 30; y < q.bottom - 30; y += 11) for (let x = q.left + 30; x < q.right - 30; x += 13) {
      if (!far(x, y)) continue; const el = document.elementFromPoint(x, y); if (!el || !v.contains(el) || el.closest('.onode, .oyou, .omctl')) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = { x, y }; } }
    return best; }, [fx, fy]);
  const inBox = (r, o, t = 1) => !!r && !!o && r.l >= o.l - t && r.r <= o.r + t && r.t >= o.t - t && r.b <= o.b + t;
  const allIn = (g) => !!g && !!g.omv && g.n > 0 && Object.values(g.nodes).every((x) => inBox(x.r, g.omv)) && inBox(g.you, g.omv) && (!g.chief || inBox(g.chief, g.omv)) && g.labs.every((l) => inBox(l.r, g.omv));
  const outOf = (g) => (g && g.omv ? Object.entries(g.nodes).filter(([, x]) => !inBox(x.r, g.omv)).map(([n]) => n).concat(g.labs.filter((l) => !inBox(l.r, g.omv)).map((l) => 'lab:' + l.text)) : ['没有画布']);
  const overlap = (a, b, s = 0.5) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > s && Math.min(a.b, b.b) - Math.max(a.t, b.t) > s;
  const geo = (g) => { const L = Object.entries(g.nodes || {}), bad = [], hub = [], cx = g.top ? (g.top.l + g.top.r) / 2 : 0;
    for (let i = 0; i < L.length; i++) { if (g.top && overlap(L[i][1].r, g.top)) hub.push(L[i][0]); for (let j = i + 1; j < L.length; j++) if (overlap(L[i][1].r, L[j][1].r)) bad.push(L[i][0] + '/' + L[j][0]); }
    const side = L.filter(([, x]) => { const c = (x.r.l + x.r.r) / 2; return c < cx - 5 ? !x.ar : c > cx + 5 ? x.ar : false; }).map(([n]) => n);
    return { n: L.length, bad, hub, side, left: L.filter(([, x]) => x.ar).length }; };
  const moved = (a, b, tol = 1.5) => Object.keys(a).filter((n) => !a[n] || !b[n] || Math.abs(a[n].l - b[n].l) > tol || Math.abs(a[n].t - b[n].t) > tol);
  const shift = (a, b, n) => (a[n] && b[n] ? [Math.round((b[n].l - a[n].l) * 10) / 10, Math.round((b[n].t - a[n].t) * 10) / 10] : null);
  const near = (x, y, t = 1.5) => Math.abs(x - y) <= t;
  // 同一个上级下面（和每个扇区的根）的先后：期望值照 /api/state 的职级和开的时间另排——分支在前（几个分支之间名字或标题里带「负责人」/ head of 的在前）、前任在后、其余按开的先后；根按负责人 → 总管带 → 你直接带
  const orderBad = (g, raw) => {
    const N = (raw && raw.org && raw.org.nodes) || {}, ch = raw && raw.org && raw.org.chief, S = new Map(((raw && raw.sessions) || []).map((s) => [s.sid, s]));
    const named = (sid) => { const s = S.get(sid) || {}, t = (String(s.regName || '') + ' ' + String(s.title || '')).toLowerCase(); return t.includes('负责人') || t.includes('head of'); };
    const key = (sid) => { const r = N[sid] && N[sid].role; return [r === 'head' ? 0 : r === 'former' ? 2 : 1, r === 'head' && !named(sid) ? 1 : 0, (S.get(sid) || {}).startedAt || 0]; };
    const cmp = (a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a < b ? -1 : 1); };
    const grp = (sid) => (N[sid] && N[sid].role === 'lead' ? 0 : N[sid] && N[sid].boss === ch ? 1 : 2), by = new Map(), bad = [];
    for (const n of g.order || []) { const sid = FX.sids[n] || n, b = N[sid] && N[sid].boss, p = b && b !== ch && S.has(b) ? b : 'root:' + (((S.get(sid) || {}).project || {}).key || 'other'); if (!by.has(p)) by.set(p, []); by.get(p).push(sid); }
    for (const [p, l] of by) { const want = l.slice().sort((a, b) => (p.startsWith('root:') ? grp(a) - grp(b) : 0) || cmp(a, b)); if (JSON.stringify(want) !== JSON.stringify(l)) bad.push([S2N[p] || p, l.map((x) => S2N[x] || x), want.map((x) => S2N[x] || x)]); }
    return { groups: by.size, kids: (by.get(FX.sids.peerDone) || []).length, bad };
  };
  let flip = null;      // 这个会话的状态在浏览器里从 idle 改成 busy（改 /api/state 的应答），看它在图上挪不挪
  // 夹具里总管 projC 没有模型和上下文，第三行是空的、悬停时不会多出一行；这里给它补上（和真实的总管一样），悬停总管那一条才测得到「圆心那一块展开」
  const flipRoute = async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
    for (const s of j.sessions || []) { if (flip && s.sid === flip) s.status = 'busy'; if (j.org && s.sid === j.org.chief) Object.assign(s, { model: s.model || 'claude-fable-5-2', ctx: s.ctx || 52000 }); }
    await route.fulfill({ response: r, json: j }); };

  // ── 一、中文深色 1520 × 900：默认层级 → 切到放射
  let { ctx, page, errs } = await ctxOf({ route: flipRoute });
  let g = await mapOf(page); const tree0 = await treeOf(page);
  ok(!g.map && g.cols >= 1 && g.shape.shown && JSON.stringify(g.shape.btns) === '[["tree","层级","true"],["map","放射","false"]]' && g.shape.label === '架构图怎么排' && g.store === null,
    '放射：没存过时架构图照旧是层级（从上往下那张）；顶栏多一个「层级 | 放射」，层级亮着', JSON.stringify({ map: g.map, cols: g.cols, shape: g.shape, store: g.store }));
  const sc0 = await ev(page, () => { const m = document.querySelector('main'); m.scrollTop = 300; return m.scrollTop; });
  await tap(page, '#oshape [data-oshape="map"]'); await sleep(1600); g = await mapOf(page);
  const raw = await ev(page, () => api('/api/state?peek=1')), sids = ((raw && raw.sessions) || []).map((s) => s.sid), chief = raw && raw.org && raw.org.chief;
  ok(g.map && g.cols === 0 && sids.length === 30 && g.n === 29 && !!g.chief && sids.every((s) => (s === chief ? true : !!g.nodes[S2N[s] || s])) && g.store === '"map"' && JSON.stringify(g.shape.btns.map((b) => b[2])) === '["false","true"]',
    '放射：点「放射」切过去：墙上 30 个会话还是一个会话一个方块（总管在圆心，其余 29 个绕着它），没有列了；选择记在本机（ccb_orgshape）', JSON.stringify({ map: g.map, cols: g.cols, n: g.n, chief: !!g.chief, store: g.store, btns: g.shape.btns }));
  ok(sc0 > 0 && g.main && g.omv && (await ev(page, () => document.querySelector('main').scrollTop)) === 0 && near(g.omv.t, g.main.t) && near(g.omv.b, g.main.b) && near(g.omv.l, g.main.l) && near(g.omv.r, g.main.r),
    '放射：层级图里往下滚过 ' + sc0 + ' px 再切过来，页面回到顶，画布正好铺满顶栏下面这一块', JSON.stringify({ sc0, omv: g.omv, main: g.main }));
  ok(allIn(g) && !!g.V && !g.V.user && g.V.k >= 0.2 && g.V.k <= 1.1, '放射：第一次画把整张图放回窗口里（29 个方块、你和总管、项目名都在画布里），缩放 ' + (g.V && Math.round(g.V.k * 100) / 100) + ' 倍', JSON.stringify({ V: g.V, out: outOf(g) }));
  const g0 = geo(g);
  ok(g0.n === 29 && g0.bad.length === 0 && g0.hub.length === 0, '放射：29 个方块两两不重叠，没有一个压着圆心（你 + 总管那一块）', JSON.stringify(g0));
  ok(g0.n === 29 && g0.side.length === 0 && g0.left >= 1 && g0.left < g0.n, '放射：在圆心左边的 ' + g0.left + ' 个方块往左伸（右边缘对着圆心），右边的往右伸', JSON.stringify(g0));
  const ob = orderBad(g, raw);
  ok(ob.kids >= 20 && ob.bad.length === 0, '放射：先后不跟着状态走：同一个上级下面分支在前、前任在后、其余按开的先后（负责人 peerDone 下面 ' + ob.kids + ' 个、各扇区的根也一样；期望照 /api/state 的职级和开的时间另排）', JSON.stringify(ob));
  await page.screenshot({ path: path.join(OUT, 'orgmap-zh-dark.png') });
  // 输入没变不重排：包一层数 orgMapLayout 被调了几次，隔三次轮询
  const lay0 = await ev(page, () => { try { window.__lay = 0; const f = orgMapLayout; window.orgMapLayout = function () { window.__lay++; return f.apply(this, arguments); }; window.__L0 = orgMapL; return !!orgMapL; } catch (e) { return String(e); } });
  const p0 = await rects(page, Object.keys(g.nodes)); await sleep(3800);
  const nl = await ev(page, () => { try { return { n: window.__lay, same: orgMapL === window.__L0 }; } catch (e) { return null; } }), p1 = await rects(page, Object.keys(g.nodes));
  ok(lay0 === true && !!nl && nl.n === 0 && nl.same && moved(p0, p1).length === 0, '放射：输入没变就不重排：隔三次轮询，布局一次都没重算（orgMapLayout 调了 ' + (nl && nl.n) + ' 次），每个方块都在原处', JSON.stringify({ lay0, nl, moved: moved(p0, p1) }));
  // 某个窗口空闲 → 在跑：挑负责人下面开得最晚、不是要你动手也不在跑的那个（层级图会把它挪到前面去）
  const bk = await ev(page, (sids) => { const name = Object.fromEntries(Object.entries(sids).map(([k, v]) => [v, k])), o = {};
    for (const c of document.querySelectorAll('#stage .card')) { if (/^[xp]:/.test(c.dataset.sid)) continue; const k = c.className; o[name[c.dataset.sid] || c.dataset.sid] = /(^| )alert( |$)|s-reply|s-ask/.test(k) ? 0 : /s-busy|(^| )bg( |$)/.test(k) ? 1 : /s-review/.test(k) ? 2 : 3; }
    return o; }, FX.sids);
  const N0 = (raw && raw.org && raw.org.nodes) || {};
  const cand = ((raw && raw.sessions) || []).filter((s) => s.status === 'idle' && N0[s.sid] && N0[s.sid].role === 'member' && N0[s.sid].boss === FX.sids.peerDone && bk[S2N[s.sid]] >= 2).sort((a, b) => b.startedAt - a.startedAt)[0];
  const fn = cand ? S2N[cand.sid] : null, top0 = (await mapOf(page)).top, f0 = await rects(page, Object.keys(g.nodes));
  flip = cand ? cand.sid : null; await sleep(3800);
  const gf = await mapOf(page), f1 = await rects(page, Object.keys(g.nodes));
  ok(!!fn && /s-busy/.test((gf.nodes[fn] || {}).box || '') && !/s-busy/.test((g.nodes[fn] || {}).box || '') && moved(f0, f1).length === 0,
    '放射：' + fn + ' 从空闲变成在跑（在浏览器里改 /api/state）：它的样子变成在跑，图上 29 个方块一个都没挪（层级图里它会排到前面）', JSON.stringify({ fn, moved: moved(f0, f1), hub: [top0, gf.top], box: (gf.nodes[fn] || {}).box }));
  flip = null; await sleep(2000);
  // 线
  const ln = await linesOf(page);
  ok(!!ln && ln.n === 29 && ln.li === 29 && ln.endNot === 0 && ln.startNot === 0 && ln.cross.length === 0 && ln.toChief + ln.toYou >= 1,
    '放射：一个方块一条线（29 条）：一头在它自己方块的边上，另一头在上级（负责人 / 总管 / 你）方块的边上；去总管、去「你」的线没有一条从「你」或总管的方块底下穿过去', JSON.stringify(ln));
  // 上级到下级的线（11/18 win-eb 加）：负责人在圈 1 正右、它带的 28 个绕满一圈，去左半边的那些直着连会横穿圆心（底上 6 条以上）；要绕开圆心走弧线
  ok(!!ln && ln.n === 29 && ln.crossKid.length === 0 && ln.q >= 1,
    '放射：上级到下级的线也不从「你」和总管的方块底下穿过：直着连会穿过的改成绕开圆心的弧（' + (ln && ln.q) + ' 条弧，其余是直线）', JSON.stringify(ln && { n: ln.n, q: ln.q, crossKid: ln.crossKid }));
  // 悬停：右半边上方一个没有框的普通窗口、左半边一个（往左伸的），原地展开成三行的方块；依据贴在它下面、不盖住它；往上到「你」的那一串加重
  const pickR = Object.entries(g.nodes).filter(([, x]) => !x.ar && !x.o2 && (N0[x.sid] || {}).role === 'member' && g.top && g.omv && x.r.l > g.top.r + 20 && x.r.b < g.omv.b - 260).sort((a, b) => a[1].r.t - b[1].r.t).map(([n]) => n)[0];
  const pickL = Object.entries(g.nodes).filter(([, x]) => x.ar && !x.o2 && (N0[x.sid] || {}).role === 'member' && g.omv && x.r.b < g.omv.b - 200).map(([n]) => n)[0];
  const hv = async (n) => { const a = ((await mapOf(page)).nodes || {})[n]; if (!a) return null; await page.mouse.move(a.r.l + a.r.w / 2, a.r.t + a.r.h / 2); await sleep(400); const G = await mapOf(page), b = (G.nodes || {})[n]; if (!b) return null;
    return { n, ar: a.ar, hot1: b.hot1, o2: b.o2, o3: b.o3, h0: Math.round(a.r.h), h1: Math.round(b.r.h), w1: Math.round(b.r.w), anchor: a.ar ? [b.r.r - a.r.r, b.r.t - a.r.t].map(Math.round) : [b.r.l - a.r.l, b.r.t - a.r.t].map(Math.round),
      tip: G.tip && G.tip.text, why: b.why, gap: G.tip ? [Math.round(G.tip.r.t - b.r.b), Math.round(b.r.t - G.tip.r.b)] : null, over: G.tip ? overlap(G.tip.r, b.r) : null, k: G.V && G.V.k, youHot: G.youHot, chiefHot: G.chiefHot, hot: G.hotD || '' }; };
  const expanded = (h) => !!h && h.hot1 && h.o2 && h.o3 && h.h1 >= 2 * h.h0 && Math.abs(h.anchor[0]) <= 1 && Math.abs(h.anchor[1]) <= 1 && h.w1 >= 279 * Math.max(1, h.k || 1);
  const tipOk = (h) => !!h && !!h.tip && h.tip === h.why && h.over === false && ((h.gap[0] >= 0 && h.gap[0] <= 12) || (h.gap[1] >= 0 && h.gap[1] <= 12));
  const hR = pickR ? await hv(pickR) : null;
  await page.screenshot({ path: path.join(OUT, 'orgmap-hover-zh-dark.png') });
  const hL = pickL ? await hv(pickL) : null;
  ok(expanded(hR) && !hR.ar, '放射：悬停右半边的 ' + pickR + '（平时只有点和标题）：原地展开成三行的方块（状态那一行、模型那一行都出来），左上角不动', JSON.stringify(hR));
  ok(expanded(hL) && hL.ar, '放射：悬停左半边往左伸的 ' + pickL + '：展开时右上角不动（往左长）', JSON.stringify(hL));
  ok(tipOk(hR) && hR.gap[0] >= 0 && tipOk(hL), '放射：依据（#otip）贴在展开的方块下面（间隙 0–12 px，下面放不下才贴上面），不盖住它', JSON.stringify({ r: hR && [hR.tip, hR.gap, hR.over], l: hL && [hL.tip, hL.gap, hL.over] }));
  const hI = await hv('intr');
  ok(!!hI && hI.hot1 && (hI.hot.match(/M/g) || []).length === 3 && hI.youHot && hI.chiefHot, '放射：悬停 intr → 它、unfin、负责人 peerDone 三段线另描一条加重，总管和「你」也加重', JSON.stringify(hI && { hot: hI.hot.length, m: (hI.hot.match(/M/g) || []).length, you: hI.youHot, chief: hI.chiefHot }));
  // 要你动手的（琥珀）普通窗口：平时多一行要你做的事，收在 206 px；悬停原地展开以后这一行要跟着方块放宽（11/18 win-ed 报、win-33 核：
  // 收起时那条 #org.map .oli.r-member>.onode:is(.s-reply,.s-ask,.alert) .o2 是 1 id + 6 类，压过悬停那条 #org.map .oli.hot1 .o2 的 1 id + 4 类，悬停了还截在 206 px）。
  // 量的是 offsetWidth（布局宽度，不受画布缩放和 --omi 影响），所以能直接和 206 比
  const o2Of = (sid) => ev(page, (s) => { const b = document.querySelector('#org .omnodes .onode[data-sid="' + s + '"]'), e = b && b.querySelector('.o2'); if (!e) return null; const cs = getComputedStyle(e);
    return { hot1: b.closest('.oli').classList.contains('hot1'), shown: cs.display !== 'none' && e.getClientRects().length > 0, w: e.offsetWidth, sw: e.scrollWidth, max: cs.maxWidth, node: b.offsetWidth, text: e.textContent.slice(0, 80) }; }, sid);
  const ga = await mapOf(page), amb = Object.entries(ga.nodes).filter(([, x]) => /(^| )alert( |$)|s-reply|s-ask/.test(x.box) && (N0[x.sid] || {}).role === 'member' && ga.omv && x.r.t > ga.omv.t + 40 && x.r.b < ga.omv.b - 200 && x.r.l > ga.omv.l + 20 && x.r.r < ga.omv.r - 20).map(([n]) => n);
  const pickA = amb[0] || null; let a0 = null, a1 = null;
  if (pickA) {
    const pe = await emptyAt(page, 0.5, 0.5); if (pe) await page.mouse.move(pe.x, pe.y); await sleep(350);
    a0 = await o2Of(ga.nodes[pickA].sid);
    const ar = ga.nodes[pickA].r; await page.mouse.move(ar.l + ar.w / 2, ar.t + ar.h / 2); await sleep(400);
    a1 = await o2Of(ga.nodes[pickA].sid);
    const hb = ((await mapOf(page)).nodes[pickA] || {}).r, vp = page.viewportSize();
    if (hb) { const x = Math.max(0, Math.min(hb.l - 140, vp.width - 640)), y = Math.max(0, Math.min(hb.t - 90, vp.height - 300)); await page.screenshot({ path: path.join(OUT, 'orgmap-hover-amber-zh-dark.png'), clip: { x, y, width: 640, height: 300 } }); }
    const pz = await emptyAt(page, 0.5, 0.5); if (pz) await page.mouse.move(pz.x, pz.y); await sleep(350);   // 收起再往下：左半边的展开时往左长，留着悬停下一段「别的方块一个都不挪」会量到它
  }
  ok(!!a0 && !a0.hot1 && a0.shown && a0.w > 0 && a0.w <= 206, '放射：要你动手的普通窗口（' + pickA + '）平时多出的那一行要你做的事照旧收在 206 px 以内（' + (a0 && a0.w) + ' px）', JSON.stringify({ amb, a0 }));
  ok(!!a1 && a1.hot1 && a1.shown && a1.w > 206, '放射：悬停要你动手的 ' + pickA + '：原地展开以后要你做的事那一行跟着方块放宽（' + (a1 && a1.w) + ' px，不再截在 206 px）', JSON.stringify({ a1 }));
  // 悬停总管：圆心那一块原地展开，别的方块不能跟着挪（量的是轮询两次以后）
  const gc0 = await mapOf(page), pc0 = await rects(page, Object.keys(g.nodes)), lc0 = await ev(page, () => window.__lay), cr = gc0.chief;
  if (cr) await page.mouse.move(cr.l + cr.w / 2, cr.t + 12); await sleep(3800);
  const pc1 = await rects(page, Object.keys(g.nodes)), lc1 = await ev(page, () => window.__lay), gc = await mapOf(page);
  ok(!!cr && gc.chiefHot && !!gc.chiefX && gc.chiefX.hot1 && gc.chiefX.o3 && !(gc0.chiefX || {}).o3 && moved(pc0, pc1).length === 0 && !!gc.you && near(gc.you.t, gc0.you.t, 1) && near(gc.chief.t, cr.t, 1),
    '放射：悬停圆心的总管：它原地展开（多出模型那一行）、写依据；「你」不往上跳，别的方块一个都不挪（隔两次轮询）', JSON.stringify({ moved: moved(pc0, pc1).slice(0, 6), lay: [lc0, lc1], you: [gc0.you && gc0.you.t, gc.you && gc.you.t], chief: [cr && cr.t, gc.chief && gc.chief.t, cr && cr.h, gc.chief && gc.chief.h], x: [gc0.chiefX, gc.chiefX], tip: gc.tip && gc.tip.text }));
  // 缩小着看：缩到 0.5 倍再悬停，展开的方块按倍数放回原大
  let p = await emptyAt(page, 0.5, 0.5); if (p) await page.mouse.move(p.x, p.y); await sleep(300);
  await ev(page, () => orgMapZoom(0.5 / orgV.k)); await sleep(200);
  const hz = pickR ? await hv(pickR) : null;
  ok(!!hz && hz.k <= 0.51 && hz.hot1 && hz.w1 >= 279 && hz.h1 >= 2 * hz.h0, '放射：缩到 0.5 倍再悬停：展开的方块按倍数放回原大（屏幕上 ' + (hz && hz.w1) + ' px 宽，不跟着缩小），字照样读得清', JSON.stringify(hz));
  await page.screenshot({ path: path.join(OUT, 'orgmap-zoomout-hover-zh-dark.png') });
  await tap(page, '#org .omctl [data-omz="fit"]'); await sleep(600);
  p = await emptyAt(page, 0.5, 0.5); if (p) await page.mouse.move(p.x, p.y); await sleep(350);
  const gn = await mapOf(page);
  ok(!Object.values(gn.nodes).some((x) => x.hot1 || x.hot) && !gn.tip && gn.hotD === '' && !gn.youHot, '放射：鼠标移到空白处，展开、加重、依据都收起', JSON.stringify({ hot1: Object.entries(gn.nodes).filter(([, x]) => x.hot1).map(([n]) => n), tip: gn.tip, hot: gn.hotD }));
  const fc = await ev(page, (sid) => { const b = document.querySelector('#org .omnodes .onode[data-sid="' + sid + '"]'); if (!b) return null; b.focus(); const li = b.closest('.oli'), t = document.querySelector('#otip');
    const r = { hot1: li.classList.contains('hot1'), tip: t && !t.hidden ? t.textContent : '', why: b.dataset.why }; b.blur(); return r; }, FX.sids.unfin);
  ok(!!fc && fc.hot1 && !!fc.why && fc.tip === fc.why, '放射：键盘聚焦到一个窗口（unfin），和悬停一样原地展开、写依据', JSON.stringify(fc));
  // 画布：滚轮挪；Ctrl / ⌘ + 滚轮以指针为中心缩放（拿两个方块的屏幕位置验：每个方块到指针的距离正好乘缩放的倍数）
  const A = ['peerDone', 'projF'];
  await ev(page, () => { window.__wh = []; addEventListener('wheel', (e) => window.__wh.push([e.deltaX, e.deltaY, e.ctrlKey, e.metaKey, e.deltaMode]), { capture: true, passive: true }); });
  const lastWheel = () => ev(page, () => (window.__wh || []).slice(-1)[0] || null);       // 页面实际收到的那一下：deviceScaleFactor 2 时 Playwright 给的 60 / 40 到页面是 30 / 20
  p = await emptyAt(page, 0.35, 0.4); if (p) await page.mouse.move(p.x, p.y); await sleep(200);
  let b0 = await rects(page, A); await page.mouse.wheel(60, 40); await sleep(250); let b1 = await rects(page, A); const w1 = await lastWheel();
  ok(!!p && !!w1 && w1[0] > 0 && w1[1] > 0 && w1[4] === 0 && A.every((n) => b0[n] && b1[n] && near(b1[n].l - b0[n].l, -w1[0]) && near(b1[n].t - b0[n].t, -w1[1]) && near(b1[n].w, b0[n].w, 0.5)),
    '放射：滚轮 / 两指滑 = 挪画布（页面收到往右下滚 ' + (w1 && w1[0]) + ' / ' + (w1 && w1[1]) + ' px，图正好往左上挪这么多，不缩放）', JSON.stringify({ p, wheel: w1, d: A.map((n) => shift(b0, b1, n)) }));
  const zoomAt = async (key, dy) => { const q = await emptyAt(page, 0.3, 0.3); if (!q) return null; await page.mouse.move(q.x, q.y); await sleep(150); const c0 = await rects(page, A);
    await page.keyboard.down(key); await page.mouse.wheel(0, dy); await page.keyboard.up(key); await sleep(250); const c1 = await rects(page, A), w = await lastWheel();
    if (!A.every((n) => c0[n] && c1[n])) return null; const f = c1[A[0]].w / c0[A[0]].w;
    return { f: Math.round(f * 1000) / 1000, wheel: w, err: A.map((n) => Math.round(Math.max(Math.abs((c1[n].l - q.x) - f * (c0[n].l - q.x)), Math.abs((c1[n].t - q.y) - f * (c0[n].t - q.y))) * 10) / 10) }; };
  const zc = await zoomAt('Control', -60);
  ok(!!zc && !!zc.wheel && zc.wheel[2] && zc.f > 1.2 && zc.err.every((e) => e <= 2), '放射：Ctrl + 滚轮 = 以指针为中心放大（' + (zc && zc.f) + ' 倍；指针下那一点不动：两个方块到指针的距离都正好乘这个倍数）', JSON.stringify(zc));
  const zm = await zoomAt('Meta', 60);
  ok(!!zm && !!zm.wheel && zm.wheel[3] && zm.f < 0.85 && zm.err.every((e) => e <= 2), '放射：⌘ + 滚轮 = 以指针为中心缩小（' + (zm && zm.f) + ' 倍，同样指针下那一点不动）', JSON.stringify(zm));
  // 按住空白处拖 = 挪
  p = await emptyAt(page, 0.55, 0.6); b0 = await rects(page, A);
  let dragging = null;
  if (p) { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 80, p.y + 30, { steps: 5 }); dragging = await ev(page, () => document.querySelector('#org .omv').classList.contains('drag')); await page.mouse.up(); }
  await sleep(200); b1 = await rects(page, A); const dragAfter = await ev(page, () => document.querySelector('#org .omv').classList.contains('drag'));
  ok(dragging === true && dragAfter === false && A.every((n) => b0[n] && b1[n] && near(b1[n].l - b0[n].l, 80) && near(b1[n].t - b0[n].t, 30)), '放射：按住空白处拖 = 挪画布（拖 80 / 30 px，图跟着挪 80 / 30 px）；松手就不再跟着', JSON.stringify({ dragging, dragAfter, d: A.map((n) => shift(b0, b1, n)) }));
  // 他动过以后：轮询不替他摆正；窗口变大小，布局重算了，画布也不替他放回窗口里
  const v0 = (await mapOf(page)).V; await sleep(3800); const v1 = (await mapOf(page)).V;
  ok(!!v0 && !!v1 && v0.user && JSON.stringify(v0) === JSON.stringify(v1), '放射：他拖过 / 缩放过以后，隔三次轮询图不被摆回去', JSON.stringify({ v0, v1 }));
  const lr0 = await ev(page, () => window.__lay);
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(1000); const v2 = (await mapOf(page)).V, lr1 = await ev(page, () => window.__lay);
  ok(!!v2 && !!v1 && v2.user && v2.k === v1.k && v2.x === v1.x && v2.y === v1.y && lr1 > lr0, '放射：他动过以后窗口变小（1520 → 1280 宽）：布局按新窗口重算了（orgMapLayout 又调了 ' + (lr1 - lr0) + ' 次），画布不替他放回窗口里', JSON.stringify({ v1, v2, lay: [lr0, lr1] }));
  await page.setViewportSize({ width: 1520, height: 900 }); await sleep(1000);
  // 右下角三个按钮
  g = await mapOf(page);
  ok(!!g.ctl && JSON.stringify(g.ctl.btns.map((b) => [b.k, b.text])) === '[["out","−"],["fit","适应窗口"],["in","+"]]' && g.ctl.label === '画布' && g.ctl.btns[0].label === '画布缩小' && g.ctl.btns[2].label === '画布放大' && /双击空白处/.test(g.ctl.btns[1].title)
    && g.ctl.r.r <= g.omv.r - 12 && g.ctl.r.r >= g.omv.r - 24 && g.ctl.r.b <= g.omv.b - 12 && g.ctl.r.b >= g.omv.b - 24,
    '放射：画布右下角三个按钮「− 适应窗口 +」（离右边、下边 16 px；读屏名 画布缩小 / 画布放大，「适应窗口」提示可以双击空白处）', JSON.stringify(g.ctl && { btns: g.ctl.btns, r: g.ctl.r, omv: g.omv }));
  const mid = g.omv ? { x: (g.omv.l + g.omv.r) / 2, y: (g.omv.t + g.omv.b) / 2 } : { x: 0, y: 0 };
  const btnZoom = async (k) => { const c0 = await rects(page, A); await tap(page, '#org .omctl [data-omz="' + k + '"]'); await sleep(600); const c1 = await rects(page, A); if (!A.every((n) => c0[n] && c1[n])) return null;
    const f = c1[A[0]].w / c0[A[0]].w; return { f: Math.round(f * 1000) / 1000, err: A.map((n) => Math.round(Math.max(Math.abs((c1[n].l - mid.x) - f * (c0[n].l - mid.x)), Math.abs((c1[n].t - mid.y) - f * (c0[n].t - mid.y))) * 10) / 10) }; };
  const zo = await btnZoom('out'), zi = await btnZoom('in');
  ok(!!zo && !!zi && near(zo.f, 0.8, 0.01) && near(zi.f, 1.25, 0.01) && zo.err.concat(zi.err).every((e) => e <= 2), '放射：点「−」以画布正中为中心缩到 0.8 倍，点「+」放大 1.25 倍', JSON.stringify({ zo, zi }));
  await tap(page, '#org .omctl [data-omz="fit"]'); await sleep(700); g = await mapOf(page); const kFit = g.V && g.V.k;
  ok(allIn(g) && !!g.V && !g.V.user, '放射：点「适应窗口」→ 整张图放回窗口里，之后又按「他没动过」处理', JSON.stringify({ V: g.V, out: outOf(g) }));
  // 他没动过时窗口变大小：重新放回窗口里
  await page.setViewportSize({ width: 1180, height: 760 }); await sleep(1100); const gs = await mapOf(page);
  await page.setViewportSize({ width: 1520, height: 900 }); await sleep(1100); const gb = await mapOf(page);
  ok(allIn(gs) && allIn(gb) && !!gs.V && !gs.V.user && gs.V.k < kFit, '放射：他没动过时窗口变小（1180 × 760）再变回来：每次都把整张图重新放回窗口里', JSON.stringify({ small: gs.V, back: gb.V, kFit, out: [outOf(gs), outOf(gb)] }));
  // 双击空白处 = 放回窗口里
  p = await emptyAt(page, 0.4, 0.5); if (p) { await page.mouse.move(p.x, p.y); await page.mouse.wheel(220, 140); } await sleep(250); const gw = await mapOf(page);
  p = await emptyAt(page, 0.5, 0.5); if (p) await page.mouse.dblclick(p.x, p.y); await sleep(700); g = await mapOf(page);
  ok(!!gw.V && gw.V.user && !allIn(gw) && allIn(g) && !!g.V && !g.V.user && near(g.V.k, gb.V ? gb.V.k : -1, 0.002), '放射：挪开以后双击空白处 → 整张图放回窗口里（和「适应窗口」一样）', JSON.stringify({ moved: gw.V, after: g.V, out: outOf(g) }));
  // 点一个方块 = 放大看
  const dn = g.nodes.done; if (dn) { await page.mouse.move(dn.r.l + dn.r.w / 2, dn.r.t + dn.r.h / 2); await sleep(300); await page.mouse.click(dn.r.l + dn.r.w / 2, dn.r.t + dn.r.h / 2); } await sleep(700);
  const zd = await ev(page, () => ({ open: document.querySelector('#detail').open, title: document.querySelector('#dTitle').textContent })); await page.keyboard.press('Escape'); await sleep(400);
  ok(!!dn && zd.open && zd.title === 'w-done', '放射：点一个方块照旧放大看它（和墙上 ⌘O、层级图里点方块同一个大窗口）', JSON.stringify(zd));
  // main 不滚：画布自己挪
  const ms = await ev(page, () => { const m = document.querySelector('main'); m.scrollTop = 400; m.scrollLeft = 200; return { top: m.scrollTop, left: m.scrollLeft, sh: m.scrollHeight - m.clientHeight, sw: m.scrollWidth - m.clientWidth, ov: getComputedStyle(m).overflow }; });
  ok(!!ms && ms.top === 0 && ms.left === 0 && ms.sh <= 0 && ms.sw <= 0, '放射：页面（main）不滚：没有可滚的内容，硬设 scrollTop / scrollLeft 也还是 0（挪图靠画布自己）', JSON.stringify(ms));
  // 别的视图里没有这个开关；切回架构还是放射、重新放回窗口里
  const shapeShown = () => ev(page, () => { const s = document.querySelector('#oshape'); return !!s && getComputedStyle(s).display !== 'none' && s.getClientRects().length > 0; });
  await tap(page, '#modes [data-mode="wall"]'); await sleep(1000); const onWall = await shapeShown();
  await tap(page, '#modes [data-mode="flow"]'); await sleep(1000); const onFlow = await shapeShown();
  ok(onWall === false && onFlow === false, '放射：墙和封面里不显示「层级 | 放射」（只在架构视图里）', JSON.stringify({ onWall, onFlow }));
  await tap(page, '#modes [data-mode="org"]'); await sleep(1800); g = await mapOf(page);
  ok(g.map && g.shape.shown && allIn(g) && !!g.V && !g.V.user, '放射：从封面切回架构还是放射，整张图重新放回窗口里', JSON.stringify({ map: g.map, shown: g.shape.shown, V: g.V, out: outOf(g) }));
  await page.reload(); await page.waitForSelector('#org .onode .ot', { timeout: 10000 }).catch(() => {}); await sleep(2600); g = await mapOf(page);
  ok(g.map && g.store === '"map"' && allIn(g), '放射：重开总控台还是放射（记在本机的 ccb_orgshape）', JSON.stringify({ map: g.map, store: g.store }));
  // 纯函数：orgMapRound（扇区绕圈的先后）。临时清掉页面自己记的那份，算完还原
  const rd = await ev(page, () => { const keep = orgMapKeys; try { const c = (o) => Object.entries(o).map(([key, n]) => ({ key, n })), k = (l) => orgMapRound(l).map((x) => x.key);
    orgMapKeys = null; const a = k(c({ a: 10, b: 8, c: 5, d: 2 })), b = k(c({ a: 1, b: 3, c: 9, d: 20 })), d = k(c({ a: 10, b: 8, c: 5, d: 2, e: 1 }));
    orgMapKeys = null; const e = k(c({ a: 10, b: 8, f: 7, c: 5, d: 2, e: 1 })); return { a, b, d, e }; } finally { orgMapKeys = keep; } });
  same(rd, { a: ['a', 'c', 'b', 'd'], b: ['a', 'c', 'b', 'd'], d: ['a', 'c', 'e', 'b', 'd'], e: ['a', 'f', 'd', 'b', 'e', 'c'] },
    '放射：扇区绕圈的先后（orgMapRound）：最大的排第一（正右）、第二大的在它对面（左），其余一下一上往两边填；项目没增没减时各项目的窗口数变了也不换位，项目增减了才重排');
  // 纯函数：orgMapLayout。把页面里这个函数的原文放进一个 Worker 跑（有环时要是死循环，8 秒后整个 Worker 扔掉，算变红），结果拿回来在这边核
  const HUB = { w: 276, h: 118 };
  const gen = (sizes, seed) => {      // 每个扇区：一个负责人（宽方块），其余六成挂进树里（最深 4 层），四成是没人带的根；方块宽 90–230、两成高 40（要你动手的多一行）
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const sectors = [], kids = {}, size = {};
    sizes.forEach((n, si) => {
      const key = 'p' + si, roots = [], all = [], add = (id, par, d) => { all.push({ id, d }); if (par) (kids[par] = kids[par] || []).push(id); else roots.push(id); };
      add(key + 'L', null, 1); size[key + 'L'] = [276, 44];
      for (let i = 1; i < n; i++) { const id = key + '-' + i, cs = all.filter((x) => x.d < 4);
        if (rnd() < 0.6) { const par = cs[Math.floor(rnd() * cs.length)]; add(id, par.id, par.d + 1); } else add(id, null, 1);
        size[id] = [Math.round(90 + rnd() * 140), rnd() < 0.2 ? 40 : 22]; }
      sectors.push({ key, roots });
    });
    return { hub: HUB, sectors, kids: Object.entries(kids), size };
  };
  const leafs = (ids, w = 150) => Object.fromEntries(ids.map((id, i) => [id, [w + (i % 3) * 20, 22]]));
  const CASES = {
    '1 个扇区 1 个窗口': { hub: HUB, sectors: [{ key: 'a', roots: ['a1'] }], kids: [], size: { a1: [180, 22] } },
    '2 个扇区各 3 个': { hub: HUB, sectors: [{ key: 'a', roots: ['aL'] }, { key: 'b', roots: ['b1', 'b2', 'b3'] }], kids: [['aL', ['a1', 'a2']]], size: { aL: [276, 44], ...leafs(['a1', 'a2', 'b1', 'b2', 'b3']) } },
    '4 个扇区各 3 个（右下左上）': { hub: HUB, sectors: ['r', 'd', 'l', 'u'].map((k) => ({ key: k, roots: [k + '1', k + '2', k + '3'] })), kids: [], size: leafs(['r', 'd', 'l', 'u'].flatMap((k) => [k + '1', k + '2', k + '3'])) },
    '4 个扇区 60 个混合深度': gen([28, 16, 10, 6], 7),
    '8 个扇区 200 个': gen([60, 40, 30, 22, 18, 14, 10, 6], 11),
    '一条深度 5 的链': { hub: HUB, sectors: [{ key: 'c', roots: ['c1'] }], kids: [['c1', ['c2']], ['c2', ['c3']], ['c3', ['c4']], ['c4', ['c5']]], size: { c1: [276, 44], ...leafs(['c2', 'c3', 'c4', 'c5']) } },
    '只带 1 个下级的上级': { hub: HUB, sectors: [{ key: 'p', roots: ['pL'] }, { key: 'q', roots: ['q1', 'q2', 'q3', 'q4'] }], kids: [['pL', ['p1']]], size: { pL: [276, 44], p1: [130, 22], ...leafs(['q1', 'q2', 'q3', 'q4']) } },
    'kids 里有环': { hub: HUB, sectors: [{ key: 'r', roots: ['r0'] }, { key: 's', roots: ['s1', 's2'] }], kids: [['r0', ['r1']], ['r1', ['r2']], ['r2', ['r1', 'r0']]], size: { r0: [276, 44], ...leafs(['r1', 'r2', 's1', 's2']) }, back: [['r2', 'r1'], ['r2', 'r0']] },
  };
  const TAIL = '\nself.onmessage = (e) => { const c = e.data, t0 = Date.now(); const sp = () => ({ hub: c.hub, sectors: c.sectors, kids: new Map(c.kids), size: (id) => ({ w: c.size[id][0], h: c.size[id][1] }) });' +
    ' try { const a = orgMapLayout(sp()), b = orgMapLayout(sp()), pk = (L) => JSON.stringify({ pos: [...L.pos], secs: L.secs, box: L.box, s: L.s });' +
    ' self.postMessage({ ms: Date.now() - t0, same: pk(a) === pk(b), pos: [...a.pos], box: a.box, s: a.s }); } catch (err) { self.postMessage({ err: String(err) }); } };';
  const PURE = await ev(page, async ([cases, tail]) => {
    let src; try { src = orgMapLayout.toString(); } catch (e) { return { err: String(e) }; }
    const url = URL.createObjectURL(new Blob([src + tail], { type: 'text/javascript' })), out = {};
    for (const [name, c] of Object.entries(cases)) {
      const w = new Worker(url);
      out[name] = await new Promise((res) => { const t = setTimeout(() => res({ timeout: true }), 8000); w.onmessage = (e) => { clearTimeout(t); res(e.data); }; w.onerror = (e) => { clearTimeout(t); res({ err: e.message || 'error' }); }; w.postMessage(c); });
      w.terminate();
    }
    return out; }, [CASES, TAIL]);
  const F = { run: [], overlap: [], hub: [], ring: [], leaf: [], same: [], first: [], al: [], order: [] }, seen = { left: 0, right: 0, bottom: 0, top: 0 }, ms0 = [];
  for (const [name, c] of Object.entries(CASES)) {
    const res = PURE && PURE[name];
    if (!res || res.timeout || res.err || !res.pos) { F.run.push(name + '：' + (res ? (res.timeout ? '8 秒没排完' : res.err) : (PURE && PURE.err) || '没有结果')); continue; }
    ms0.push(res.ms); const pos = new Map(res.pos), ids = Object.keys(c.size), K = new Map(c.kids), back = (p, k) => (c.back || []).some(([a, b]) => a === p && b === k);
    if (pos.size !== ids.length || ids.some((id) => !pos.has(id))) F.run.push(name + '：排上了 ' + pos.size + ' / ' + ids.length + ' 个');
    const R = ids.filter((id) => pos.has(id)).map((id) => { const q = pos.get(id); return [id, { l: q.l, r: q.l + q.w, t: q.t, b: q.t + q.h }]; });
    const hubR = { l: -c.hub.w / 2, r: c.hub.w / 2, t: -c.hub.h / 2, b: c.hub.h / 2 };
    for (let i = 0; i < R.length; i++) { if (overlap(R[i][1], hubR, 0)) F.hub.push(name + '：' + R[i][0]); for (let j = i + 1; j < R.length; j++) if (overlap(R[i][1], R[j][1], 0)) F.overlap.push(name + '：' + R[i][0] + '/' + R[j][0]); }
    for (const [par, ks] of K) for (const k of ks) if (!back(par, k) && pos.has(par) && pos.has(k) && !(pos.get(k).d > pos.get(par).d)) F.ring.push(name + '：' + par + '(' + pos.get(par).d + ')→' + k + '(' + pos.get(k).d + ')');
    for (const id of ids) if (!K.has(id) && pos.has(id) && pos.get(id).d < 2) F.leaf.push(name + '：' + id);
    if (!res.same) F.same.push(name);
    const sub = new Set(), walk = (id) => { if (sub.has(id)) return; sub.add(id); for (const k of K.get(id) || []) if (!back(id, k)) walk(k); }; c.sectors[0].roots.forEach(walk);
    const xs = [...sub].filter((id) => pos.has(id)).map((id) => pos.get(id).x); if (!(xs.length && xs.reduce((a, b) => a + b, 0) / xs.length > 0)) F.first.push(name);
    for (const [id, q] of pos) if ((q.x < -0.5 && !(q.al < 0)) || (q.x > 0.5 && !(q.al > 0))) F.al.push(name + '：' + id + ' x=' + Math.round(q.x) + ' al=' + q.al);
    // 排第一的在上面（左右两边的扇区）或左边（上下两边的）：同一圈上的根，按给的先后比第一个和最后一个的屏幕位置。扇区朝哪边看这些根在圈上的角度（th）的平均，
    // 只核离界面那条分界线（|cos| = 0.38）够远的：左右 |cos| ≥ 0.6、上下 |cos| ≤ 0.3，夹在中间的不核
    for (const S of c.sectors) {
      const byD = new Map(); for (const r of S.roots) if (pos.has(r)) { const d = pos.get(r).d; if (!byD.has(d)) byD.set(d, []); byD.get(d).push(pos.get(r)); }
      for (const [, l] of byD) { if (l.length < 2) continue;
        const th = l.reduce((a, q) => a + q.th, 0) / l.length, cs = Math.cos(th), sn = Math.sin(th);
        const kind = cs <= -0.6 ? 'left' : cs >= 0.6 ? 'right' : Math.abs(cs) <= 0.3 ? (sn > 0 ? 'bottom' : 'top') : null; if (!kind) continue;
        seen[kind]++; const a = l[0], b = l[l.length - 1], okd = kind === 'left' || kind === 'right' ? b.y > a.y : b.x > a.x;
        if (!okd) F.order.push(name + ' / ' + S.key + '（' + kind + '）：' + l.map((q) => '(' + Math.round(q.x) + ',' + Math.round(q.y) + ')').join(' → ')); }
    }
  }
  const nC = Object.keys(CASES).length, ran = Object.values(PURE || {}).filter((r) => r && r.pos).length;      // 下面几条只看排完了的那几组；一组都没排完（底上没有这个函数）算红
  ok(F.run.length === 0, '放射 · orgMapLayout：' + nC + ' 组输入（1 个扇区 1 个窗口、2 × 3、4 × 3、4 个扇区 60 个混合深度、8 个扇区 200 个、深度 5 的链、只带 1 个下级、kids 里有环）都在 8 秒内排完，每个窗口都排上了（最慢一组 ' + (ms0.length ? Math.max(...ms0) : '-') + ' ms，两遍）', JSON.stringify(F.run));
  ok(ran > 0 && F.overlap.length === 0, '放射 · orgMapLayout：任意两个方块不相交', JSON.stringify(F.overlap.slice(0, 8)));
  ok(ran > 0 && F.hub.length === 0, '放射 · orgMapLayout：没有方块压着圆心那一块（你 + 总管）', JSON.stringify(F.hub.slice(0, 8)));
  ok(ran > 0 && F.ring.length === 0, '放射 · orgMapLayout：下级的圈号比上级大（环里往回指的那两条不算）', JSON.stringify(F.ring.slice(0, 8)));
  ok(ran > 0 && F.leaf.length === 0, '放射 · orgMapLayout：没带人的不在圈 1（圈 1 只放带着人的）', JSON.stringify(F.leaf.slice(0, 8)));
  ok(ran > 0 && F.same.length === 0, '放射 · orgMapLayout：同样的输入排两遍，结果逐字相同', JSON.stringify(F.same));
  ok(ran > 0 && F.first.length === 0, '放射 · orgMapLayout：第一个扇区在右边（它的方块 x 均值 > 0）', JSON.stringify(F.first));
  ok(ran > 0 && F.al.length === 0, '放射 · orgMapLayout：圆心左边的方块往左伸（al < 0）、右边的往右伸（al > 0）', JSON.stringify(F.al.slice(0, 8)));
  ok(ran > 0 && F.order.length === 0 && seen.left >= 1 && seen.bottom >= 1 && seen.right >= 1, '放射 · orgMapLayout：左边、下边的扇区倒着排：排第一的总在上面（左右两边）或左边（上下两边）（核了左 ' + seen.left + '、右 ' + seen.right + '、下 ' + seen.bottom + '、上 ' + seen.top + ' 组）', JSON.stringify(F.order.slice(0, 8)));
  // 切回层级：和切过去之前一样
  await tap(page, '#oshape [data-oshape="tree"]'); await sleep(1600); const tree1 = await treeOf(page); g = await mapOf(page);
  ok(!g.map && g.store === '"tree"' && !!tree0 && !!tree1 && tree0.cols.length >= 1 && JSON.stringify(tree1) === JSON.stringify(tree0) && JSON.stringify(g.shape.btns.map((b) => b[2])) === '["true","false"]',
    '放射：点「层级」切回来：和切过去之前那张一样（列、每个方块画在谁下面），记成层级', JSON.stringify({ map: g.map, store: g.store, cols: [tree0 && tree0.cols, tree1 && tree1.cols] }));
  ok(errs.length === 0, '放射（中文深色）：页面没有报错', errs.join(' | ')); await ctx.close();

  // ── 二、4 个项目（在浏览器里改 /api/state：负责人下面最早开的 9 个按项目挂到总管下面，5 个改成 Acme、4 个改成 Docs）：其他 19、Acme 5、Docs 4、FretFlow 1
  {
    const N = (raw && raw.org && raw.org.nodes) || {};
    const mv = ((raw && raw.sessions) || []).filter((s) => N[s.sid] && N[s.sid].via === 'dept' && N[s.sid].boss === FX.sids.peerDone).sort((a, b) => a.startedAt - b.startedAt).slice(0, 9).map((s) => s.sid);
    const PJ = [{ key: 'acme', name: 'Acme App' }, { key: 'docs', name: 'Docs Site' }], to = new Map(mv.map((sid, i) => [sid, PJ[i < 5 ? 0 : 1]]));
    const route4 = async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
      const M = (j.org && j.org.nodes) || {}, ch = j.org && j.org.chief;
      for (const s of j.sessions || []) { const pj = to.get(s.sid); if (!pj) continue; s.project = pj; if (M[s.sid]) Object.assign(M[s.sid], { boss: ch, via: 'dept', n: 0, last: 0 }); }
      await route.fulfill({ response: r, json: j }); };
    const c4 = await ctxOf({ shape: 'map', route: route4 }), pg = c4.page, G = await mapOf(pg), L4 = await linesOf(pg);
    const proj = (n) => { const sid = FX.sids[n] || n; return to.has(sid) ? to.get(sid).key : ((((raw.sessions || []).find((s) => s.sid === sid) || {}).project || {}).key || 'other'); };
    const cx = G.top ? (G.top.l + G.top.r) / 2 : 0, cy = G.top ? (G.top.t + G.top.b) / 2 : 0, E = Object.entries(G.nodes || {});
    const mX = Math.max(1, ...E.map(([, x]) => Math.abs((x.r.l + x.r.r) / 2 - cx))), mY = Math.max(1, ...E.map(([, x]) => Math.abs((x.r.t + x.r.b) / 2 - cy))), dir = {};
    for (const [n, x] of E) { const k = proj(n), d = dir[k] = dir[k] || { n: 0, x: 0, y: 0 }; d.n++; d.x += ((x.r.l + x.r.r) / 2 - cx) / mX; d.y += ((x.r.t + x.r.b) / 2 - cy) / mY; }
    for (const d of Object.values(dir)) { d.x = Math.round(d.x / d.n * 100) / 100; d.y = Math.round(d.y / d.n * 100) / 100; }
    const D = (k) => dir[k] || { n: 0, x: 0, y: 0 };
    ok(mv.length === 9 && D('other').n === 19 && D('acme').n === 5 && D('docs').n === 4 && D('fretflow').n === 1 && D('other').x > 0 && D('acme').x < 0 && D('acme').x === Math.min(...Object.values(dir).map((d) => d.x)) && D('docs').y > 0 && D('fretflow').y < 0,
      '放射 · 4 个项目：最大的（其他 19）在右半边、第二大的（Acme 5）在最左边，其余两个（Docs 4、FretFlow 1）一个在下半边一个在上半边', JSON.stringify(dir));
    const ac = (G.order || []).filter((n) => proj(n) === 'acme').map((n) => G.nodes[n] && Math.round((G.nodes[n].r.t + G.nodes[n].r.b) / 2));
    ok(ac.length === 5 && ac.every((y, i) => i === 0 || y > ac[i - 1]), '放射 · 4 个项目：左边的 Acme 倒着排：排第一（开得最早）的在最上面，往下一个比一个低', JSON.stringify(ac));
    const g4 = geo(G);
    ok(allIn(G) && g4.n === 29 && g4.bad.length === 0 && g4.hub.length === 0 && g4.side.length === 0, '放射 · 4 个项目：整张图在窗口里，方块不重叠、不压圆心，左边的往左伸', JSON.stringify({ g4, out: outOf(G) }));
    ok(!!L4 && L4.n === 29 && L4.li === 29 && L4.endNot === 0 && L4.startNot === 0 && L4.toYou >= 1 && L4.cross.length === 0,
      '放射 · 4 个项目：去总管的线要是先碰到「你」就停在「你」的边上（' + (L4 && L4.toYou) + ' 条），去总管、去「你」的线没有一条从「你」或总管的方块底下穿过去；29 条线两头都在方块边上', JSON.stringify(L4));
    ok(!!L4 && L4.n === 29 && L4.crossKid.length === 0, '放射 · 4 个项目：上级到下级的线也不从「你」和总管的方块底下穿过（' + (L4 && L4.q) + ' 条弧）', JSON.stringify(L4 && { q: L4.q, crossKid: L4.crossKid }));
    // 项目名（11/18 win-eb 加）：没有单独一个负责人的扇区（Acme、Docs、FretFlow）项目名写在圈 1 上；之前一律居中，左边的「Acme App 5」有半截压着「你」
    const labHit = G.labs.filter((l) => l.r && ((G.you && overlap(l.r, G.you)) || (G.chief && overlap(l.r, G.chief)) || E.some(([, x]) => overlap(l.r, x.r)))).map((l) => l.text);
    ok(G.labs.length === 4 && labHit.length === 0, '放射 · 4 个项目：4 个项目名都不压着「你」、总管和任何方块（左右两侧的往外伸）', JSON.stringify({ labHit, labs: G.labs, you: G.you, chief: G.chief }));
    await pg.screenshot({ path: path.join(OUT, 'orgmap-4proj-zh-dark.png') });
    ok(c4.errs.length === 0, '放射 · 4 个项目：页面没有报错', c4.errs.join(' | ')); await c4.ctx.close();
  }
  {   // 没有总管、没有负责人（刚装的总控台、开源用户默认就是这样；11/18 win-eb 加）：在浏览器里把 org 清成每个窗口都没有上级、都是普通窗口。
      // 圈 1 上一个方块都没有，三个项目名都写在圈 1 上：左右两侧的往外伸，圈 1 留出项目名的宽度，项目名既不压「你」也碰不到圈 2 的方块
    const route0 = async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
      if (j.org) { j.org.chief = null; j.org.gen = null; for (const x of Object.values(j.org.nodes || {})) Object.assign(x, { role: 'member', boss: null, via: null, n: 0, last: 0, handed: false }); }
      await route.fulfill({ response: r, json: j }); };
    const c0 = await ctxOf({ shape: 'map', route: route0 }), G0 = await mapOf(c0.page), E0 = Object.entries(G0.nodes || {}), g0 = geo(G0);
    const hit0 = G0.labs.filter((l) => l.r && ((G0.you && overlap(l.r, G0.you)) || E0.some(([, x]) => overlap(l.r, x.r)))).map((l) => l.text);
    ok(G0.map && !G0.chief && E0.length === 30 && G0.labs.length >= 2 && hit0.length === 0 && g0.bad.length === 0 && g0.hub.length === 0 && allIn(G0),
      '放射 · 没有总管和负责人（每个窗口都你直接带）：30 个方块不重叠、不压圆心、在窗口里，' + G0.labs.length + ' 个项目名都不压着「你」和任何方块', JSON.stringify({ hit0, labs: G0.labs, g0, out: outOf(G0) }));
    await c0.page.screenshot({ path: path.join(OUT, 'orgmap-nolead-zh-dark.png') });
    ok(c0.errs.length === 0, '放射 · 没有总管和负责人：页面没有报错', c0.errs.join(' | ')); await c0.ctx.close();
  }
  {   // 分支负责人之间的先后和层级图一样（11/17 win-49 的 M.hp；11/18 win-eb 叠到 car4 上时给放射接上）：「X负责人」排在「…分支」前面，不跟着状态挪。
      // 和「架构」一段「分支先后」那块同样改 /api/state（标题是编的，不抄本机真实会话标题：公开包的个人信息闸会拦）：hint「示例导入线分支」（在跑）、unfin「示例音轨分支交接」（要你动手，下面带着 intr）、links「FretFlow 示例运营负责人」（歇着）。
      // 夹具里三个开的先后是 unfin < hint < links，只按「分支在前 + 开的先后」排（叠 car4 之前那版）links 落到第三。期望照标题另判，不调界面的 hp
    const hpRoute = async (route) => { let r, j; try { r = await fullState(route); j = unplace(await r.json()); } catch { return route.abort().catch(() => {}); }
      const N = j.org && j.org.nodes;
      for (const [n, t] of [['hint', '示例导入线分支'], ['unfin', '示例音轨分支交接'], ['links', 'FretFlow 示例运营负责人']]) {
        if (N && N[FX.sids[n]]) Object.assign(N[FX.sids[n]], { role: 'head', boss: FX.sids.peerDone, via: 'seat', n: 0, last: 0, handed: false });
        const x = (j.sessions || []).find((y) => y.sid === FX.sids[n]); if (x) x.title = t; }
      await route.fulfill({ response: r, json: j }); };
    const { ctx: hc, page: hpg, errs: hee } = await ctxOf({ shape: 'map', route: hpRoute });
    const kidsOf = async () => { const g = await mapOf(hpg), st = await ev(hpg, () => api('/api/state?peek=1')), N = (st && st.org && st.org.nodes) || {};
      return { map: g.map, kids: g.order.filter((n) => { const x = N[FX.sids[n] || n]; return x && x.boss === FX.sids.peerDone; }) }; };
    const h1 = await kidsOf(); await sleep(2600); const h2 = await kidsOf();
    ok(h1.map && h1.kids[0] === 'links' && h1.kids.indexOf('unfin') > 0 && h1.kids.indexOf('unfin') < 3 && h1.kids.indexOf('hint') > 0 && h1.kids.indexOf('hint') < 3 && JSON.stringify(h1.kids) === JSON.stringify(h2.kids),
      '放射：几个分支负责人里，「FretFlow 示例运营负责人」（X负责人，开得最晚）排在两个「…分支」前面，三个分支都在普通窗口前面，和层级图同一个先后，隔两次轮询不变', JSON.stringify({ h1, k2: h2.kids }));
    ok(hee.length === 0, '放射：分支先后这一块页面没有报错', hee.join(' | ')); await hc.close();
  }

  // ── 三、英文浅色：开关、按钮、图上的字都是英文，依据是英文，没报错
  {
    const c5 = await ctxOf({ lang: 'en', scheme: 'light', shape: 'map' }), pg = c5.page; const G = await mapOf(pg);
    const zh = await ev(pg, () => { const bad = []; for (const el of document.querySelectorAll('#oshape, #oshape button, #org .omctl, #org .omctl button, #org .oyou, #org .orole, #org .obr, #org .ow, #org .o3, #org .omlabs > .ghead'))
      for (const s of [el.textContent, el.getAttribute('aria-label') || '', el.getAttribute('title') || '']) if (/[一-鿿]/.test(s)) bad.push(s.trim().slice(0, 40)); return bad; });
    ok(G.map && JSON.stringify(G.shape.btns.map((b) => b[1])) === '["Tree","Radial"]' && G.shape.label === 'Org chart layout' && !!G.ctl && JSON.stringify(G.ctl.btns.map((b) => [b.k, b.text])) === '[["out","−"],["fit","Fit"],["in","+"]]'
      && G.ctl.btns[0].label === 'Zoom out' && G.ctl.btns[2].label === 'Zoom in' && G.ctl.btns[1].title === 'Fit the whole chart in the window (or double-click empty space)' && G.ctl.label === 'Canvas',
      'en 放射：开关写 Tree / Radial（读屏名 Org chart layout），右下角 − / Fit / +（Zoom out、Zoom in、Fit 的提示、Canvas）', JSON.stringify({ shape: G.shape, ctl: G.ctl && G.ctl.btns, label: G.ctl && G.ctl.label }));
    ok(Array.isArray(zh) && zh.length === 0 && G.labs.some((l) => /^Other\s*\d+$/.test(l.text)) && G.labs.some((l) => /^FretFlow\s*\d+$/.test(l.text)), 'en 放射：开关、按钮、你那一行、职级、带几个、状态词、第三行、项目名里没有漏翻的中文', JSON.stringify({ zh, labs: G.labs.map((l) => l.text) }));
    const h = G.nodes.hint; if (h) await pg.mouse.move(h.r.l + h.r.w / 2, h.r.t + h.r.h / 2); await sleep(400); const Gh = await mapOf(pg);
    ok(!!Gh.tip && Gh.tip.text === 'Opened by win-p2' && !!Gh.nodes.hint && Gh.nodes.hint.hot1, 'en 放射：悬停 hint 原地展开，依据是英文（Opened by win-p2）', JSON.stringify(Gh.tip));
    await pg.screenshot({ path: path.join(OUT, 'orgmap-hover-en-light.png') });
    if (h) await pg.mouse.move(5, 300); await sleep(300); await pg.screenshot({ path: path.join(OUT, 'orgmap-en-light.png') });
    ok(allIn(G) && !!G.V && !G.V.user, 'en 放射（浅色）：整张图放回窗口里', JSON.stringify({ V: G.V, out: outOf(G) }));
    ok(c5.errs.length === 0, 'en 放射（浅色）：页面没有报错', c5.errs.join(' | ')); await c5.ctx.close();
  }
}

// ── Code Mode（11/17 作者 本人要的）：新任务弹窗里一个开关（默认关、每次打开回到关、不记上一次；选了 Codex 收起并关掉；勾了才发 codeMode: true，Codex 不发这个键），
//    下面一句只写事实的说明；卡片的模型胶囊最前面一段「Code」（夹具里是 recover：记录里有 repl-mode true），一根墨线隔开、字和颜色和模型同一套。
//    中英文 × 深浅色各一遍，截图按序号放进 OUT/codemode/；再在浏览器里把每个 Claude 会话都改成 codeMode，量每种墙宽和封面下胶囊不截字、标题让出位置。
//    颜色只核 token：开 = --thumb、关 = --fill、分隔线 = --ink（和这个主题算出来的颜色比）。服务端的断言在 state.test.mjs 的 [1e]、[7m]。单独跑：UI_ONLY=codemode
async function cmCheck() {
  console.log('\n[Code Mode]');
  // 弹窗用页面自己的 openNew() 打开（「新任务」按钮也是调它）：英文界面 1520 px 时顶栏本来就放不下，右上角的按钮在视口外点不到（以前这样红过，和 Code Mode 无关）
  const openDlg = (pg) => pg.evaluate(() => openNew()).catch(() => {});
  const fillP = (pg, t) => pg.fill('#nPrompt', t, { timeout: 3000 }).catch(() => {});
  const tap = (pg, sel) => pg.click(sel, { timeout: 3000 }).then(() => true, () => false);   // 找不到就算了、接着往下（红阶段在没有开关的旧界面上跑，要列出每一条红，不能卡 30 秒后整段崩掉）
  const SH = path.join(OUT, 'codemode'); fs.rmSync(SH, { recursive: true, force: true }); fs.mkdirSync(SH, { recursive: true });
  const R = '.card[data-sid="' + FX.sids.recover + '"]';
  const NOTE = { zh: 'Claude 写脚本一次跑多个工具，适合大范围搜索、同一种改动改很多文件；这个窗口不能用 Remote Control。', en: 'Claude writes a script that runs several tools in one go. Suits wide searches and the same change across many files. This window can’t use Remote Control.' };
  const tok = (page, v) => page.evaluate((v) => { const p = document.createElement('span'); p.style.color = 'var(' + v + ')'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }, v);
  const sw = (page) => ev(page, () => { const f = document.querySelector('#nCmField'), b = document.querySelector('#nCm'); if (!f || !b) return null;
    return { shown: !f.hidden && getComputedStyle(f).display !== 'none', role: b.getAttribute('role'), on: b.getAttribute('aria-checked'), label: (b.querySelector('.swl') || {}).textContent || '', note: (document.querySelector('#nCmNote') || {}).textContent || '',
      desc: b.getAttribute('aria-describedby'), track: getComputedStyle(b.querySelector('.swt')).backgroundColor }; });
  let n = 0;
  for (const [lang, scheme] of [['zh', 'dark'], ['zh', 'light'], ['en', 'dark'], ['en', 'light']]) {
    const zh = lang === 'zh', tag = 'Code Mode（' + lang + ' ' + scheme + '）：', L1 = zh ? '中文' : '英文', S1 = scheme === 'dark' ? '深色' : '浅色';
    const { ctx, page, errs } = await open({ mode: 'wall', lang, scheme });
    let sent = null; await page.route('**/api/new', async (route) => { sent = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'ccb-test-cm' }) }); });   // 拦在浏览器里，不真的开会话
    // 卡片：recover 的胶囊
    const cap = await ev(page, (R) => { const c = document.querySelector(R), m = c && c.querySelector('.mdl'); if (!m) return null; const cm = m.querySelector('.cm'), t = c.querySelector('.title'), mn = m.querySelector('.mn');
      return { shown: !m.hidden && m.offsetWidth > 0, first: !!cm && m.firstElementChild === cm, cmText: cm ? cm.textContent : null, seen: [...m.querySelectorAll('span')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent).join(''),
        title: m.title, trunc: m.scrollWidth > m.clientWidth, clear: parseFloat(getComputedStyle(t).paddingRight) >= m.offsetWidth + 4, below: m.offsetTop >= c.querySelector('.chead').offsetHeight, inside: m.offsetLeft >= 0,
        line: cm ? getComputedStyle(cm).boxShadow : '', same: !!cm && !!mn && getComputedStyle(cm).fontFamily === getComputedStyle(mn).fontFamily && getComputedStyle(cm).color === getComputedStyle(mn).color && getComputedStyle(cm).fontSize === getComputedStyle(mn).fontSize,
        marks: document.querySelectorAll('.card .mdl .cm').length }; }, R);
    const want = await page.evaluate(() => api('/api/state?peek=1').then((s) => s.sessions.filter((x) => x.codeMode === true).map((x) => x.sid)));
    const ink = await tok(page, '--ink');
    ok(!!cap && cap.shown && cap.first && cap.cmText === 'Code' && cap.seen === 'CodeOpus · xhigh' && cap.same, tag + 'Code Mode 的卡（recover）：模型胶囊最前面一段「Code」，后面照旧是 Opus · xhigh，字体、字号、颜色和模型名同一套', JSON.stringify(cap));
    ok(!!cap && cap.line.includes(ink) && /inset/.test(cap.line), tag + '「Code」和模型之间是一根墨线（--ink 算出来的颜色，不是新颜色）', JSON.stringify({ line: cap && cap.line, ink }));
    ok(!!cap && !cap.trunc && cap.clear && cap.below && cap.inside, tag + '胶囊没被截成省略号、挂在卡头下面、在卡内，标题让出了它的宽度', JSON.stringify(cap));
    ok(!!cap && want.length === 1 && want[0] === FX.sids.recover && cap.marks === 1, tag + '只有服务说 codeMode 的会话有「Code」（夹具里只有 recover 一个），别的卡的胶囊不变', JSON.stringify({ want, marks: cap && cap.marks }));
    ok(!!cap && /Code Mode/.test(cap.title) && (zh || !/[一-鿿]/.test(cap.title)), tag + '鼠标停在胶囊上：提示里写着 Code Mode' + (zh ? '' : '，英文没有漏翻的中文'), JSON.stringify(cap && cap.title));
    // 新任务弹窗（这之前不滚页面：英文那一遍先把 recover 滚进来，右上角的「新任务」就被挤出视口、点不到了，以前这样崩过。卡片的截图放在这一遍最后，locator 自己会滚）
    await openDlg(page); await sleep(450);
    const s0 = await sw(page), fill = await tok(page, '--fill'), thumb = await tok(page, '--thumb');
    ok(!!s0 && s0.shown && s0.role === 'switch' && s0.on === 'false' && s0.label === (zh ? 'Code Mode（实验）' : 'Code Mode (experimental)') && s0.note === NOTE[lang] && s0.desc === 'nCmNote' && s0.track === fill,
      tag + '新任务弹窗：一个「' + (s0 && s0.label) + '」开关（role=switch），默认关（轨道是 --fill），下面那句说明只写事实、读屏会读到', JSON.stringify({ s0, fill }));
    ok(!!s0 && !/省额度|省 token|save|cheaper|quota/i.test(s0.note) && (zh || !/[一-鿿]/.test(s0.label + s0.note)), tag + '说明里不写「省额度」' + (zh ? '' : '，英文没有漏翻的中文'), JSON.stringify(s0 && s0.note));
    await tap(page, '#nCm'); await sleep(450);
    const s1 = await sw(page);
    ok(!!s1 && s1.on === 'true' && s1.track === thumb, tag + '点一下：打开（轨道是 --thumb，和「你选中的那一项」同一个颜色）', JSON.stringify({ s1, thumb }));
    await fillP(page, zh ? '把所有 fetch 调用都加上 10 秒超时' : 'Add a 10 s timeout to every fetch call');
    n++; await page.locator('#newDlg').screenshot({ path: path.join(SH, String(n).padStart(2, '0') + '-' + L1 + '-' + S1 + '-新任务弹窗-Code Mode 打开.png') });
    sent = null; await tap(page, '#nGo'); await sleep(700);
    ok(!!sent && sent.codeMode === true && sent.provider === 'claude', tag + '打开再开工：发给服务的带 codeMode: true', JSON.stringify(sent));
    await openDlg(page); await sleep(450);
    const s2 = await sw(page), kept = await page.evaluate(() => localStorage.getItem('ccb_new') || '');
    ok(!!s2 && s2.on === 'false' && !/codeMode|cm/i.test(kept), tag + '再打开弹窗：开关回到关，不记上一次（ccb_new 里没有它）', JSON.stringify({ s2, kept }));
    sent = null; await fillP(page, '不勾'); await tap(page, '#nGo'); await sleep(700);
    ok(!!sent && sent.codeMode === false, tag + '不勾就开工：发的是 codeMode: false', JSON.stringify(sent));
    if (zh && scheme === 'dark') {        // 选了 Codex：收起开关并关掉；发出去的不带 codeMode 这个键（服务那边 Codex + codeMode 会报错）
      await openDlg(page); await sleep(450); await tap(page, '#nCm'); await sleep(200);
      await tap(page, '#nProv [data-prov="codex"]'); await sleep(300);
      const s3 = await sw(page);
      sent = null; await fillP(page, '交给 Codex'); await tap(page, '#nGo'); await sleep(700);
      ok(!!s3 && !s3.shown && s3.on === 'false' && !!sent && sent.provider === 'codex' && !('codeMode' in sent), tag + '选了 Codex：开关收起、关掉，发给服务的没有 codeMode', JSON.stringify({ s3, sent }));
      await openDlg(page); await sleep(450); await tap(page, '#nProv [data-prov="claude"]'); await sleep(300);
      const s4 = await sw(page);
      ok(!!s4 && s4.shown && s4.on === 'false', tag + '换回 Claude Code：开关又出来，还是关着', JSON.stringify(s4));
      await page.keyboard.press('Escape'); await sleep(300);
      await page.evaluate(() => { try { const p = JSON.parse(localStorage.getItem('ccb_new')); p.provider = 'claude'; localStorage.setItem('ccb_new', JSON.stringify(p)); } catch (e) {} });
    }
    n++; await page.locator(R).screenshot({ path: path.join(SH, String(n).padStart(2, '0') + '-' + L1 + '-' + S1 + '-卡片上的Code标记.png') });
    ok(errs.length === 0, tag + '页面没报错', errs.join(' | ')); await ctx.close();
  }
  // 每个 Claude 会话都改成 codeMode（浏览器里改 /api/state 的应答）：墙的几种宽度（700 / 1080 / 1500 换格数，刚过线时卡最窄）和封面（宽卡写版本号）下，每个胶囊都不截字、标题让出位置
  for (const lang of ['zh', 'en']) for (const [mode, w] of [['wall', 701], ['wall', 1081], ['wall', 1440], ['wall', 1520], ['wall', 1728], ['flow', 1520]]) {
    const c4 = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark' });
    await c4.addInitScript((m) => { try { localStorage.setItem('ccb_mode', JSON.stringify(m)); } catch (e) {} }, mode);
    const pg = await c4.newPage(); const e4 = [];
    pg.on('pageerror', (e) => e4.push(String(e)));
    await pg.route('**/api/state*', async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
      for (const s of j.sessions || []) if (s.provider !== 'codex') s.codeMode = true; await route.fulfill({ response: r, json: j }); });
    await pg.goto(FX.url + '&lang=' + lang); await pg.waitForSelector('.card'); await sleep(2400);
    const g = await ev(pg, () => { const out = { n: 0, bad: [] };
      for (const el of document.querySelectorAll('.card')) { const m = el.querySelector('.mdl'); if (!m || m.hidden || !m.querySelector('.cm')) continue; out.n++;
        const t = el.querySelector('.title'), h = el.querySelector('.chead');
        if (m.scrollWidth > m.clientWidth || parseFloat(getComputedStyle(t).paddingRight) < m.offsetWidth + 4 || m.offsetTop < h.offsetHeight || m.offsetLeft < 0) out.bad.push(m.textContent + ' w' + m.offsetWidth + '/' + m.scrollWidth + ' pad' + getComputedStyle(t).paddingRight + ' card' + el.offsetWidth); }
      return out; });
    ok(g.n >= 20 && g.bad.length === 0 && !e4.length, `Code Mode（${lang} ${mode} ${w} px）：每个 Claude 会话都开着时，${g.n} 个胶囊（含最长的 Code · Sonnet · medium）都不截字、在卡头下面、标题让出了位置`, JSON.stringify({ g, e4 }));
    await c4.close();
  }
}


// ── 草稿不丢（ccb_draft）、⌘K 跳到窗口（#jumpDlg）（11/17 win-1a）。UI_ONLY=jump 只跑这一段 ──
// 夹具里 done 卡没有终端通道（输入框是灰的），所以和「弹层里回话」那段一样，在浏览器里拦 /api/state 给它补上 channel；/api/send、/api/new、/api/auto 也拦在浏览器里，不碰夹具服务。
async function draftJumpSeg() {
  const D = FX.sids.done, P2 = FX.sids.peerDone, TA = `.card[data-sid="${D}"] textarea`;
  const openDJ = async ({ lang = 'zh', scheme = 'dark', w = 1520, h = 900, init = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('wall')); } catch (e) {} });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage(); const errs = [], hit = { send: [], newT: [], auto: 0, sendOk: true };
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.route('**/api/state*', async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }   // 要整份（v=0）：只回变过的应答里没有 done 卡，补不上 channel
      for (const x of j.sessions || []) if (x.sid === D) { x.channel = 'tmux'; x.tmux = 'ccb-fake'; x.auto = { state: 'armed', text: '【总控台自动续跑】（不是 Khalil 本人）接着做你上一轮自己提的下一步', basis: '', fireIn: 60000 }; }   // 倒数中：他在框里打字会发一次取消，放回草稿不该发
      await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/send', async (route) => { hit.send.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(hit.sendOk ? { ok: true, delivered: true } : { ok: false, error: '没发出去' }) }); });
    await page.route('**/api/new', async (route) => { hit.newT.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'ccb-jumpfake' }) }); });
    await page.route('**/api/auto', async (route) => { hit.auto++; await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    if (process.env.DJ_HTML) {     // 红阶段 / 改坏对照：页面换成另一份 ui.html（服务只在发页面时把 __TOKEN__ 换成口令，这里照做），夹具服务只起一份
      const html = fs.readFileSync(process.env.DJ_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
      await page.route((u) => u.pathname === '/', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: html, contentType: 'text/html; charset=utf-8' }); });
    }
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector('.card'); await sleep(2600);
    return { ctx, page, errs, hit };
  };
  const draftIn = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ccb_draft') || 'null'); } catch (e) { return 'bad'; } });
  const valOf = (page, sel) => page.evaluate((q) => { const t = document.querySelector(q); return t ? { v: t.value, dis: t.disabled, has: !!(t.closest('.reply') && t.closest('.reply').classList.contains('has')) } : null; }, sel);
  const reload = async (page) => { await page.reload(); await page.waitForSelector('.card'); await sleep(2600); };
  const tapT = (page, q) => page.click(q, { timeout: 3000 }).catch(() => {});

  // ① 卡片草稿：打字 → 停手 300 ms 后存进 ccb_draft → 整页重新载入后放回框里
  let { ctx, page, errs, hit } = await openDJ();
  const v0 = await valOf(page, TA);
  ok(v0 && !v0.dis, '草稿：夹具里 done 卡的输入框能打字（拦 /api/state 补了 channel）', JSON.stringify(v0));
  await tapT(page, TA); await page.keyboard.type('草稿一句 abc'); await sleep(450);
  let dr = await draftIn(page);
  ok(hit.auto >= 1, '草稿：（对照）这张卡在倒数自动续跑，他亲手打字会发一次取消', String(hit.auto));
  const a0 = hit.auto;
  ok(dr && dr[D] && dr[D].t === '草稿一句 abc' && dr[D].at > Date.now() - 60000, '草稿：停手以后存进 ccb_draft（会话号 → 字和时间）', JSON.stringify(dr));
  await reload(page); let v1 = await valOf(page, TA);
  ok(v1 && v1.v === '草稿一句 abc' && v1.has, '草稿：整页重新载入后字回到同一张卡的框里，发送键是亮的', JSON.stringify(v1));
  ok(hit.auto === a0, '草稿：重新载入后放回草稿不发 /api/auto（不当成他刚打字去取消自动续跑）', a0 + ' → ' + hit.auto);
  // ② 打完马上重新载入（没等 300 ms）：pagehide 时立刻存
  await page.fill(TA, ''); await sleep(450); await tapT(page, TA); await page.keyboard.type('马上刷新'); await reload(page); v1 = await valOf(page, TA);
  ok(v1 && v1.v === '马上刷新', '草稿：打完不等 300 ms 就重新载入，字也在（离开页面时立刻存）', JSON.stringify(v1));
  // ③ 删光 → 草稿记录也删
  await page.fill(TA, ''); await sleep(450); dr = await draftIn(page);
  ok(!dr || !dr[D], '草稿：框删空以后 ccb_draft 里没有这张卡', JSON.stringify(dr));
  // ④ 发出去 → 清；没发出去 → 字回到框里、草稿也存回来，重新载入还在
  await tapT(page, TA); await page.keyboard.type('发出去的一句'); await sleep(450); await page.keyboard.press('Enter'); await sleep(900); dr = await draftIn(page);
  ok(hit.send.length === 1 && hit.send[0].text === '发出去的一句' && (!dr || !dr[D]), '草稿：发出去以后草稿清掉', JSON.stringify({ sent: hit.send, dr }));
  hit.sendOk = false;
  await tapT(page, TA); await page.keyboard.type('没发出去的一句'); await sleep(450); await page.keyboard.press('Enter'); await sleep(900);
  v1 = await valOf(page, TA); dr = await draftIn(page);
  ok(v1 && v1.v === '没发出去的一句' && dr && dr[D] && dr[D].t === '没发出去的一句', '草稿：没发出去 → 字回到框里，草稿也存回来', JSON.stringify({ v1, dr }));
  await sleep(400); await reload(page); v1 = await valOf(page, TA);
  ok(v1 && v1.v === '没发出去的一句', '草稿：没发出去的那句，重新载入后还在', JSON.stringify(v1));
  await page.fill(TA, ''); await sleep(450);
  // ⑤ 新任务的草稿：打一半关掉弹窗 → 重新载入 → 再开还在；开工成功后清
  await page.click('#newBtn'); await sleep(300); await page.fill('#nPrompt', '新任务写了一半'); await sleep(450);
  await page.keyboard.press('Escape'); await reload(page); await page.click('#newBtn'); await sleep(300);
  const n1 = await page.evaluate(() => document.querySelector('#nPrompt').value);
  ok(n1 === '新任务写了一半', '草稿：新任务写了一半，重新载入后再开还在', n1);
  await page.click('#nGo'); await sleep(900); dr = await draftIn(page);
  ok(hit.newT.length === 1 && hit.newT[0].prompt === '新任务写了一半' && (!dr || !dr.__new), '草稿：新任务开工以后草稿清掉', JSON.stringify({ newT: hit.newT, dr }));
  ok(errs.length === 0, '草稿：页面没有报错', errs.join(' | ')); await ctx.close(); await srvClear([D]);     // 上面回过话又重载：本机记的「回过话 = 处理过」随载入发给了服务，别留给后面的段
  // ⑥ 7 天前的草稿不放回；存坏了的 ccb_draft 不报错
  ({ ctx, page, errs } = await openDJ({ init: `try { localStorage.setItem('ccb_draft', JSON.stringify({ ${JSON.stringify(D)}: { t: '八天前的', at: Date.now() - 8 * 86400000 }, other: { t: 5 } })) } catch (e) {}` }));
  v1 = await valOf(page, TA);
  ok(v1 && v1.v === '', '草稿：8 天前的草稿不放回', JSON.stringify(v1));
  ok(errs.length === 0, '草稿：ccb_draft 里有坏条目也不报错', errs.join(' | ')); await ctx.close();
  ({ ctx, page, errs } = await openDJ({ init: `try { localStorage.setItem('ccb_draft', '"garbage"') } catch (e) {}` }));
  v1 = await valOf(page, TA);
  ok(v1 && v1.v === '' && errs.length === 0, '草稿：ccb_draft 整个存坏了（不是对象）也照常载入', JSON.stringify(v1) + ' ' + errs.join(' | ')); await ctx.close();

  // ⑦ ⌘K 跳到窗口
  ({ ctx, page, errs } = await openDJ());
  const jump = (pg) => pg.evaluate(() => { const d = document.querySelector('#jumpDlg'), q = document.querySelector('#jQ');
    if (!d || !q) return { missing: true, open: false, rows: [], n: -1 };
    return { open: d.open, focus: document.activeElement === q, q: q.value, rows: [...document.querySelectorAll('#jList li')].map((li) => ({ k: (li.querySelector('.jm') || {}).className || '', m: ((li.querySelector('.jm') || {}).textContent || ''), t: (() => { const jt = li.querySelector('.jt'); return jt && jt.childNodes[0] ? jt.childNodes[0].textContent : ''; })(), small: ((li.querySelector('.jt small') || {}).textContent || ''), sel: li.getAttribute('aria-selected'), none: li.classList.contains('jnone'), text: li.textContent })),
      n: [...cards.values()].filter((c) => c.s || c.x).length, detail: document.querySelector('#detail').open, dsid: typeof detailSid === 'undefined' ? null : detailSid }; });
  const RANK = { act: 0, review: 1, busy: 2, calm: 3 }, rk = (r) => RANK[(r.k.match(/\b(act|review|busy|calm)\b/) || [])[1]];
  await page.mouse.click(5, 5); await page.keyboard.press('Meta+KeyK'); await sleep(300); let j = await jump(page);
  ok(j.open && j.focus && j.q === '', '⌘K：打开「跳到窗口」，光标在搜索框里', JSON.stringify({ open: j.open, focus: j.focus, missing: j.missing }));
  ok(j.rows.length === j.n && j.n >= 20, '⌘K：不打字时列出墙上每个有对话的窗口（' + j.n + ' 个）', j.rows.length + ' / ' + j.n);
  ok(j.rows.length > 1 && j.rows.every((r, i) => i === 0 || rk(j.rows[i - 1]) <= rk(r)) && rk(j.rows[0]) === 0, '⌘K：不打字时要你处理的排最前，然后待审阅、运行中、无需处理', j.rows.map((r) => rk(r)).join(''));
  ok(j.rows.length > 1 && j.rows.every((r) => ['要你处理', '待审阅', '运行中', '无需处理'].includes(r.m)), '⌘K：每行左边写状态（和按状态分列同一套词）', [...new Set(j.rows.map((r) => r.m))].join('/'));
  if (!j.missing) { await page.keyboard.type('win-p2'); await sleep(200); }
  j = await jump(page);
  const p2title = await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .title').textContent, P2);
  ok(j.rows.length >= 1 && j.rows[0].t === p2title && j.rows[0].small.includes('win-p2') && j.rows[0].sel === 'true', '⌘K：打短名 win-p2 → 第一行是那个窗口、已选中、标题后面写着短名', JSON.stringify(j.rows.slice(0, 2)));
  const fillQ = async (v) => { if (!j.missing) { await page.fill('#jQ', v, { timeout: 3000 }).catch(() => {}); await sleep(200); } return jump(page); };
  j = await fillQ('P2');
  ok(j.rows.length >= 1 && j.rows[0].t === p2title, '⌘K：只打短名中间的 P2（大写）也找得到', JSON.stringify(j.rows.slice(0, 2)));
  j = await fillQ('fretflow 总指挥');
  ok(j.rows.length >= 1 && j.rows.some((r) => r.t === p2title) && !j.rows.some((r) => r.none), '⌘K：空格隔开的两个词（fretflow 总指挥）都对得上的窗口列出来', JSON.stringify(j.rows.map((r) => r.t)));
  j = await fillQ('fretflow zzqq');
  ok(j.rows.length === 1 && j.rows[0].none, '⌘K：两个词里有一个哪里都对不上 → 不列', JSON.stringify(j.rows.map((r) => r.t)));
  j = await fillQ('总结写好了');
  const dTitle = await page.evaluate((sid) => document.querySelector('.card[data-sid="' + sid + '"] .title').textContent, D);
  ok(j.rows.length >= 1 && j.rows.some((r) => r.t === dTitle), '⌘K：卡上那句结论也能搜（总结写好了 → done）', JSON.stringify(j.rows.map((r) => r.t)));
  j = await fillQ('zzqq不存在的词');
  ok(j.rows.length === 1 && j.rows[0].none && j.rows[0].text === '没有对得上的窗口', '⌘K：一个都对不上时写「没有对得上的窗口」', JSON.stringify(j.rows));
  await page.keyboard.press('Enter'); await sleep(300); j = await jump(page);
  ok(j.open && !j.detail, '⌘K：对不上时按回车什么都不做、框还开着', JSON.stringify({ open: j.open, detail: j.detail }));
  // 方向键：↓ 选第二行，↑ 从第一行绕到最后一行；回车放大看选中的那一张
  j = await fillQ(''); await page.keyboard.press('ArrowDown'); await sleep(100); j = await jump(page);
  ok(j.rows.length > 2 && j.rows[1].sel === 'true' && j.rows[0].sel === 'false', '⌘K：↓ 选中第二行', j.rows.slice(0, 3).map((r) => r.sel).join(','));
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await sleep(100); j = await jump(page);
  ok(j.rows.length > 2 && j.rows[j.rows.length - 1].sel === 'true', '⌘K：在第一行按 ↑ 绕到最后一行', j.rows.slice(-2).map((r) => r.sel).join(','));
  j = await fillQ('win-p2'); await page.keyboard.press('Enter'); await sleep(700); j = await jump(page);
  ok(!j.open && j.detail && j.dsid === P2, '⌘K：回车 → 框关掉，放大看那个窗口（和 ⌘O 同一个大窗口）', JSON.stringify({ open: j.open, detail: j.detail, dsid: j.dsid, want: P2 }));
  await page.keyboard.press('Escape'); await sleep(300);
  // 点一行也一样；开着时再按 ⌘K 关掉；Esc 关掉
  await page.keyboard.press('Meta+KeyK'); await sleep(300); j = await fillQ('总结写好了');
  await page.click('#jList li[data-j="0"]', { timeout: 3000 }).catch(() => {}); await sleep(700); j = await jump(page);
  ok(!j.open && j.detail && j.dsid === D, '⌘K：点一行 → 放大看那一张', JSON.stringify({ open: j.open, dsid: j.dsid, want: D }));
  await page.keyboard.press('Escape'); await sleep(300);
  await page.keyboard.press('Meta+KeyK'); await sleep(250); const jOpen = (await jump(page)).open; await page.keyboard.press('Meta+KeyK'); await sleep(250); j = await jump(page);
  ok(jOpen && !j.open, '⌘K：开着时再按一次 ⌘K 关掉', JSON.stringify({ jOpen, after: j.open }));
  await page.keyboard.press('Meta+KeyK'); await sleep(250); const jOpen2 = (await jump(page)).open; await page.keyboard.press('Escape'); await sleep(250); j = await jump(page);
  ok(jOpen2 && !j.open, '⌘K：Esc 关掉', JSON.stringify({ jOpen2, after: j.open }));
  // 守卫：别的弹窗开着时不开；卡片输入框里按 Ctrl+K（macOS 自带「删到行尾」）不开
  await page.click('#newBtn'); await sleep(300); await page.keyboard.press('Meta+KeyK'); await sleep(250); j = await jump(page);
  const newOpen = await page.evaluate(() => document.querySelector('#newDlg').open);
  ok(newOpen && !j.open, '⌘K：新任务弹窗开着时不开「跳到窗口」', JSON.stringify({ newOpen, jump: j.open })); await page.keyboard.press('Escape'); await sleep(250);
  await tapT(page, TA); await page.keyboard.type('abcdef'); await page.keyboard.press('Control+KeyK'); await sleep(250); j = await jump(page);
  const vk = await valOf(page, TA);
  ok(vk && vk.v.startsWith('abc') && !j.open, '⌘K：输入框里按 Ctrl+K 不开「跳到窗口」', JSON.stringify({ open: j.open, v: vk && vk.v }));
  await page.fill(TA, ''); await sleep(450);
  await page.keyboard.press('Meta+KeyK'); await sleep(300); j = await fillQ('');
  await page.screenshot({ path: path.join(OUT, 'jump-dark.png') });
  j = await fillQ('khalil'); await page.screenshot({ path: path.join(OUT, 'jump-search.png') });
  const box = await page.evaluate(() => { const d = document.querySelector('#jumpDlg'); if (!d || !d.open) return { inView: false }; const r = d.getBoundingClientRect(); const rows = [...document.querySelectorAll('#jList li')];
    return { inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clip: rows.some((li) => li.scrollWidth > li.clientWidth + 1) }; });
  ok(box.inView && !box.clip, '⌘K：框整个在窗口里，每行不横向溢出（长标题截省略号）', JSON.stringify(box));
  ok(errs.length === 0, '⌘K：页面没有报错', errs.join(' | ')); await ctx.close();
  // 浅色、窄窗口、英文
  ({ ctx, page, errs } = await openDJ({ scheme: 'light' }));
  await page.mouse.click(5, 5); await page.keyboard.press('Meta+KeyK'); await sleep(300); await page.screenshot({ path: path.join(OUT, 'jump-light.png') });
  ok(errs.length === 0, '⌘K 浅色：页面没有报错', errs.join(' | ')); await ctx.close();
  ({ ctx, page, errs } = await openDJ({ w: 700, h: 700 }));
  await page.mouse.click(5, 5); await page.keyboard.press('Meta+KeyK'); await sleep(300);
  const nb = await page.evaluate(() => { const d = document.querySelector('#jumpDlg'); if (!d || !d.open) return false; const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth; });
  await page.screenshot({ path: path.join(OUT, 'jump-700.png') });
  ok(nb, '⌘K 700 px：框在窗口里、页面不横向溢出', String(nb)); ok(errs.length === 0, '⌘K 700 px：页面没有报错', errs.join(' | ')); await ctx.close();
  ({ ctx, page, errs } = await openDJ({ lang: 'en' }));
  await page.mouse.click(5, 5); await page.keyboard.press('Meta+KeyK'); await sleep(300); await page.fill('#jQ', 'zzqq', { timeout: 3000 }).catch(() => {}); await sleep(150);
  const en = await page.evaluate(() => { const q = document.querySelector('#jQ'); if (!q) return {}; return { ph: q.placeholder, foot: document.querySelector('.jfoot').textContent, none: document.querySelector('#jList').textContent, lbl: document.querySelector('#jumpDlg').getAttribute('aria-label'), tip: document.querySelector('#newBtn').title }; });
  await page.fill('#jQ', '', { timeout: 3000 }).catch(() => {}); await sleep(150);
  const enRows = await page.evaluate(() => [...new Set([...document.querySelectorAll('#jList .jm')].map((x) => x.textContent))]);
  await page.screenshot({ path: path.join(OUT, 'jump-en.png') });
  ok(en.ph === 'Jump to a window: search name, title, project or latest result' && en.foot === '↑↓ select · Return to enlarge · Esc to close' && en.none === 'No window matches' && en.lbl === 'Jump to a window' && String(en.tip).endsWith('⌘K jump to a window'),
    '⌘K 英文：搜索框提示、底下一行、对不上、读屏标签、新任务按钮的提示都是英文', JSON.stringify(en));
  ok(enRows.length >= 2 && enRows.every((x) => !/[一-鿿]/.test(x)), '⌘K 英文：每行的状态字是英文', enRows.join('/'));
  ok(errs.length === 0, '⌘K 英文：页面没有报错', errs.join(' | ')); await ctx.close();
}

// ── 顶栏额度：原有断言的独立入口，不改断言；UI_ONLY=limits ──
async function topbarLimitsSeg() {
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
}

// ── 顶栏 · Gemini API 余额（11/23）：UI_ONLY=gbal 单跑；GB_HTML 换整页做红阶段 / 改坏对照 ──
// 服务给 limits.gemini（锚点余额减掉账本里的花费，估算、上限）。期望值是照服务端测试那组手算的：起点 CA$8、花 US$0.571、1 CAD = 0.71 USD → 花 CA$0.804225、剩 CA$7.195775。
// 夹具服务没有锚点（gemini 是 null），所以先在浏览器里直接喂 paintLimits 造的数据；最后拦一次真的 /api/state 往里塞 gemini，核轮询那条路也画得出来。
async function geminiChipSeg() {
  console.log('\n[顶栏 · Gemini API 余额]');
  const shots = path.join(OUT, 'gemini-balance'); fs.mkdirSync(shots, { recursive: true });
  const paintG = (page, g, rest = true) => page.evaluate(({ g, rest }) => {
    const now = Date.now(), H = 3600000, D = 86400000, wk = (u) => [{ key: 'week', used: u, resetsAt: now + D }];
    const base = { id: 'gemini', provider: 'gemini', account: null, plan: null, windows: [] };
    const bal = (o) => Object.assign({ currency: 'CAD', start: 8, remaining: 7.195775, spent: 0.804225, spentUsd: 0.571, usdPerUnit: 0.71, anchorAt: now - 2 * H, estimate: true, rows: 3, bad: 0 }, o);
    const gem = g === 'missing' ? undefined : g === 'null' ? null : g === 'nobal' ? Object.assign({}, base, { at: now }) : Object.assign({}, base, { at: now - 2 * H, balance: bal(g) });
    if (gem && gem.balance) gem.at = gem.balance.anchorAt;
    const lm = rest ? { claude: [{ id: 'amy', provider: 'claude', account: 'amy', name: 'amy', at: now, windows: wk(91) }, { id: 'ben', provider: 'claude', account: 'ben', name: 'ben', at: now, windows: wk(1) }], codex: { id: 'codex', provider: 'codex', plan: 'prolite', at: now, windows: wk(34) } } : { claude: [], codex: null };
    if (g !== 'missing') lm.gemini = gem;
    window.__gSt = { now, limits: lm }; paintLimits(window.__gSt);
    const bar = document.querySelector('header.bar'), nb = document.querySelector('#newBtn'), lim = document.querySelector('#limits');
    const chips = [...lim.querySelectorAll('.lq')].map((c) => {
      const m = c.querySelector('.mtr'), i = m && m.querySelector('i'), a = c.querySelector('.ago'), r = c.getBoundingClientRect(), br = bar.getBoundingClientRect();
      return { id: c.dataset.lq, text: c.textContent, warn: c.classList.contains('warn'), stale: c.classList.contains('stale'), tip: c.title, aria: c.getAttribute('aria-label') || '',
        meter: !!m && m.offsetWidth > 0, fill: i ? parseFloat(i.style.width) : null, ago: a && a.offsetWidth > 0 ? a.textContent : null, w: Math.round(r.width), inBar: r.right <= br.right + 0.5 && r.left >= br.left - 0.5,
        pcColor: getComputedStyle(c.querySelector('.pc')).color, op: +getComputedStyle(c).opacity };
    });
    return { shown: lim.offsetWidth > 0, chips, over: bar.scrollWidth > bar.clientWidth, newIn: nb.getBoundingClientRect().right <= innerWidth, attn: getComputedStyle(document.documentElement).getPropertyValue('--attn').trim() };
  }, { g, rest });
  const gOf = (r) => r.chips.find((c) => c.id === 'gemini') || null;
  const cn = /[一-鿿]/;
  for (const lang of ['zh', 'en']) {
    const en = lang === 'en', tag = lang + ' 1520 px';
    const { ctx, page, errs } = await open({ mode: 'flow', lang, w: 1520 });
    // 1. 平常：两个 Claude 号 + Codex + Gemini
    let r = await paintG(page, {}), g = gOf(r);
    same(r.chips.map((c) => c.id), ['amy', 'ben', 'codex', 'gemini'], tag + '：Gemini 那格排在 Claude、Codex 后面，原来三格不动', JSON.stringify(r.chips.map((c) => c.id)));
    ok(g && g.text === 'Gemini≈CA$7.20', tag + '：芯片写「Gemini ≈CA$7.20」（剩 CA$7.195775 取两位，带 ≈ 表示估算）', JSON.stringify(g && g.text));
    ok(g && !g.warn && !g.stale && g.meter && Math.abs(g.fill - 10.05) < 0.1, tag + '：没到线不亮琥珀、不变灰；进度条是花掉的比例 0.804225 / 8 = 10.05%', JSON.stringify(g && [g.warn, g.stale, g.meter, g.fill]));
    ok(g && (en ? /estimate/.test(g.tip) && /About CA\$7\.20 left of CA\$8\.00 \(read in AI Studio on \d+\/\d+ \d\d:\d\d\)/.test(g.tip) && /3 charges logged since then, \$0\.57 total \(CA\$0\.80 at 1 CAD = 0\.71 USD\)/.test(g.tip) && /upper bound/.test(g.tip)
                : /估算/.test(g.tip) && /约剩 CA\$7\.20，起点 CA\$8\.00（\d+\/\d+ \d\d:\d\d 在 AI Studio 读的）/.test(g.tip) && /之后账本里记到 3 笔花费，共 US\$0\.57（按 1 CAD = 0\.71 USD 折成 CA\$0\.80）/.test(g.tip) && /这是上限/.test(g.tip)),
       tag + '：提示里写明是估算、剩多少 / 起点 / 什么时候读的、账本里几笔共多少美元和折算、这是上限', JSON.stringify(g && g.tip));
    if (en) ok(g && !cn.test(g.text + g.tip + g.aria), tag + '：Gemini 那格的文字、提示、读屏标签里没有中文', JSON.stringify(g && g.tip));
    ok(g && g.inBar && !r.over && r.newIn, tag + '：四格时顶栏不溢出、「新任务」在视口里（Gemini 那格 ' + (g ? g.w : '?') + ' px）', JSON.stringify({ over: r.over, newIn: r.newIn, w: g && g.w }));
    if (!en) await page.screenshot({ path: path.join(shots, '01-中文-平常.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } });
    else await page.screenshot({ path: path.join(shots, '05-英文-平常.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } });
    // 2. 到线：花掉 87.5%；按账本用完
    r = await paintG(page, { remaining: 1, spent: 7, spentUsd: 4.97 }); g = gOf(r);
    ok(g && g.warn && !g.stale && g.text === 'Gemini≈CA$1.00' && Math.abs(g.fill - 87.5) < 0.1, tag + '：花掉 87.5%（≥ 85%）亮琥珀，进度条 87.5%', JSON.stringify(g && [g.warn, g.text, g.fill]));
    if (!en) await page.screenshot({ path: path.join(shots, '02-中文-快用完-琥珀.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } });
    r = await paintG(page, { remaining: 0, spent: 8.3, spentUsd: 5.893 }); g = gOf(r);
    ok(g && g.warn && g.text === 'Gemini≈CA$0.00' && g.fill === 100 && (en ? /used up/.test(g.tip) : /已经用完/.test(g.tip)), tag + '：按账本已经用完：≈CA$0.00、琥珀、进度条满、提示里说用完了', JSON.stringify(g && [g.warn, g.text, g.fill, g.tip]));
    // 3. 锚点旧了：9 天前读的
    r = await paintG(page, { anchorAt: Date.now() - 9 * 86400000 }); g = gOf(r);
    ok(g && g.stale && !g.warn && g.ago === (en ? '9d ago' : '9 天前') && g.op > 0.5 && g.op < 0.9 && (en ? /Read it again in AI Studio/.test(g.tip) : /去 AI Studio 再读一次/.test(g.tip)), tag + '：锚点 9 天前读的：整格变灰、写「9 天前」、提示里请他再读一次', JSON.stringify(g && [g.stale, g.ago, g.op, g.tip]));
    if (!en) await page.screenshot({ path: path.join(shots, '03-中文-锚点9天前-变灰.png'), clip: { x: 0, y: 0, width: 1520, height: 60 } });
    r = await paintG(page, { anchorAt: Date.now() - 9 * 86400000, remaining: 0.5, spent: 7.5, spentUsd: 5.325 }); g = gOf(r);
    ok(g && g.warn && !g.stale && g.ago === null && g.pcColor !== 'rgba(0, 0, 0, 0)', tag + '：锚点旧了但按上限也快用完：照旧亮琥珀、不变灰（上限都低了，真实的只会更低）', JSON.stringify(g && [g.warn, g.stale, g.ago]));
    r = await paintG(page, { anchorAt: Date.now() - 6 * 86400000 }); g = gOf(r);
    ok(g && !g.stale && g.ago === null, tag + '：6 天前读的不算旧（线是 7 天）', JSON.stringify(g && [g.stale, g.ago]));
    // 4. 别的写法：账本坏行、还没有花费、美元
    r = await paintG(page, { bad: 2 }); g = gOf(r);
    ok(g && (en ? /2 ledger lines couldn't be read and were skipped/.test(g.tip) : /账本里有 2 行读不懂，没算进去/.test(g.tip)), tag + '：账本里有坏行：提示里写几行没算', JSON.stringify(g && g.tip));
    r = await paintG(page, { rows: 0, spent: 0, spentUsd: 0, remaining: 8 }); g = gOf(r);
    ok(g && g.text === 'Gemini≈CA$8.00' && g.fill === 0 && (en ? /No charges logged since then/.test(g.tip) : /之后账本里还没有记到花费/.test(g.tip)), tag + '：还没花：≈CA$8.00、进度条空、提示写还没有记到花费', JSON.stringify(g && [g.text, g.fill, g.tip]));
    r = await paintG(page, { currency: 'USD', usdPerUnit: 1, start: 10, remaining: 9.429, spent: 0.571 }); g = gOf(r);
    ok(g && g.text === (en ? 'Gemini≈$9.43' : 'Gemini≈US$9.43') && !/折成|CAD = /.test(g.tip), tag + '：锚点是美元：直接写美元，提示里没有折算那一段', JSON.stringify(g && [g.text, g.tip]));
    // 5. 不画：老服务没有这个键、没锚点、缺 balance
    for (const k of ['missing', 'null', 'nobal']) {
      r = await paintG(page, k);
      same(r.chips.map((c) => c.id), ['amy', 'ben', 'codex'], tag + '：gemini ' + ({ missing: '这个键没有（老服务）', null: '是 null（没锚点）', nobal: '没有 balance' })[k] + '：不画，原来三格照旧', JSON.stringify(r.chips.map((c) => c.id)));
    }
    r = await paintG(page, {}, false); g = gOf(r);
    same(r.chips.map((c) => c.id), ['claude:none', 'gemini'], tag + '：还没有 Claude 数据也没开 Codex：灰的「Claude —」后面照样有 Gemini', JSON.stringify(r.chips.map((c) => c.id)));
    ok(errs.length === 0, tag + '（Gemini 余额）：页面没报错', JSON.stringify(errs));
    await ctx.close();
  }
  for (const w of [1100, 960]) {
    const { ctx, page, errs } = await open({ mode: 'flow', lang: 'zh', w }); const tag = 'zh ' + w + ' px';
    const r = await paintG(page, { anchorAt: Date.now() - 9 * 86400000 }), g = gOf(r);
    if (w === 1100) {
      ok(r.shown && g && !g.meter && g.ago === null && g.stale && g.text.startsWith('Gemini≈CA$7.20'), tag + '：窄了 Gemini 那格照旧在，进度条和「9 天前」跟别的格一起藏起来，旧的照样是灰的', JSON.stringify(g && [g.meter, g.ago, g.stale, g.text]));
      ok(!r.over && r.newIn, tag + '：四格时顶栏不溢出、「新任务」在视口里', JSON.stringify({ over: r.over, newIn: r.newIn }));
      await page.screenshot({ path: path.join(shots, '04-中文-1100宽-窄屏.png'), clip: { x: 0, y: 0, width: 1100, height: 60 } });
    } else ok(!r.shown, tag + '：再窄（≤ 1000 px）整条让位，Gemini 也不出', JSON.stringify(r.shown));
    ok(errs.length === 0, tag + '（Gemini 余额）：页面没报错', JSON.stringify(errs));
    await ctx.close();
  }
  // 6. 轮询那条路：拦 /api/state，往真的整份里塞 gemini，等界面自己画
  {
    const { ctx, page, errs } = await open({ mode: 'flow', lang: 'zh', w: 1520 });
    await page.route('**/api/state*', async (route) => {
      const res = await fullState(route), j = await res.json(), now = Date.now();
      if (j.limits) j.limits.gemini = { id: 'gemini', provider: 'gemini', account: null, plan: null, at: now - 600000, windows: [], balance: { currency: 'CAD', start: 8, remaining: 6.5, spent: 1.5, spentUsd: 1.065, usdPerUnit: 0.71, anchorAt: now - 600000, estimate: true, rows: 5, bad: 0 } };
      await route.fulfill({ response: res, json: j });
    });
    let t = ''; for (let i = 0; i < 40 && t !== 'Gemini≈CA$6.50'; i++) { await sleep(250); t = await page.evaluate(() => { const c = document.querySelector('#limits .lq[data-lq="gemini"]'); return c ? c.textContent : ''; }); }
    const n = await page.evaluate(() => document.querySelectorAll('#limits .lq').length);
    ok(t === 'Gemini≈CA$6.50' && n === 4, 'zh 1520 px：真的 /api/state 里带上 gemini，轮询以后顶栏自己画出「Gemini ≈CA$6.50」，一共四格', JSON.stringify({ t, n }));
    ok(errs.length === 0, 'zh 1520 px（Gemini 余额 · 轮询）：页面没报错', JSON.stringify(errs));
    await ctx.close();
  }
}

// ── 墙上降噪（11/18 窗口 A）：UI_ONLY=strip；ST_HTML 换整页做红阶段 / 改坏对照 ──
// 期望由原始状态与状态 class 另算，不调用 stripOf / quietCard / workGrace。每个 context 固定同一份夹具；状态变化仍经过 fullState 路由。
async function wallStripSeg() {
  console.log('\n[墙上降噪 · 窄条]');
  const shots = path.join(OUT, 'strip'); fs.mkdirSync(shots, { recursive: true });
  const K = FX.sids.links, D = FX.sids.done, sel = (id) => `.card[data-sid="${id}"]`;
  const openST = async ({ lang = 'zh', scheme = 'dark', w = 1520, off = false, storageFail = false } = {}) => {
    STRIPS_ON = true;
    let ctx; try { ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 }); } finally { STRIPS_ON = false; }
    await ctx.addInitScript(({ off, storageFail }) => {
      localStorage.setItem('ccb_mode', JSON.stringify('wall')); localStorage.setItem('ccb_done', JSON.stringify({ 'st-handled': '1970-01-01T00:33:20.000Z' }));
      if (!sessionStorage.getItem('st-init')) { if (off) localStorage.setItem('ccb_strip', 'off'); else localStorage.removeItem('ccb_strip'); sessionStorage.setItem('st-init', '1'); }
      if (storageFail) { const get = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (k === 'ccb_strip') throw new Error('storage unavailable'); return get.call(this, k); }; }
    }, { off, storageFail });
    const page = await ctx.newPage(), errs = [], ctl = { state: 'fyi', revision: 0, armed: false, allHandled: false, sent: [], auto: [], seq: 1, frozen: null };
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.route('**/api/state*', async (route) => {
      let r; try { r = await fullState(route); if (!ctl.frozen) ctl.frozen = await r.json(); } catch { return route.abort().catch(() => {}); }
      const j = structuredClone(ctl.frozen), seed = j.sessions.find((s) => s.sid === D);
      j.sessions.push({ ...seed, sid: 'st-handled', title: 'strip-handled', resultAt: '1970-01-01T00:16:40.000Z', digest: { need: 'review' }, alert: null, ask: null },
        { ...seed, sid: 'st-idle', title: 'strip-idle', status: 'idle', done: false, result: '', resultAt: null, note: '', steps: 0, digest: {}, alert: null, ask: null });
      const s = j.sessions.find((x) => x.sid === K);
      Object.assign(s, { channel: 'tmux', tmux: 'ccb-fake', status: 'idle', done: true, digest: { ...s.digest, need: ctl.state === 'review' ? 'review' : 'fyi' }, alert: null, ask: null, resultAt: new Date(new Date(s.resultAt).getTime() + ctl.revision).toISOString() });
      if (ctl.state === 'busy') s.status = 'busy';
      if (ctl.state === 'ask') s.status = 'waiting';
      if (ctl.state === 'stop') s.alert = { kind: 'error', key: 'st-error', at: j.now };
      if (ctl.armed) s.auto = { state: 'armed', text: '【总控台自动续跑】（不是 Khalil 本人）接着做你上一轮自己提的下一步', basis: '先跑验证', fireIn: 25000 }; else s.auto = null;
      j.pending = [{ name: 'st-boot', prompt: '', screen: '', at: j.now, cwd: j.home, provider: 'claude' },
        { name: 'st-choice', prompt: '', screen: '', at: j.now, cwd: j.home, dialog: { question: 'Choose a mode', options: ['Allow', 'Deny'] } }];
      if (ctl.allHandled) { for (const x of j.sessions) Object.assign(x, { status: 'idle', ask: null, alert: null, done: true, result: 'Done.', digest: { need: 'review' } }); j.pending = []; j.lost = []; }
      j.notices = []; j.v = ctl.seq++;
      await route.fulfill({ response: r, json: j });
    });
    for (const [url, key] of [['send', 'sent'], ['auto', 'auto']]) await page.route('**/api/' + url, async (r) => { ctl[key].push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ json: { ok: true, delivered: true } }); });
    await page.route('**/api/processed', (r) => r.fulfill({ json: { ok: true } }));
    if (process.env.ST_HTML) {
      const html = fs.readFileSync(process.env.ST_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
      await page.route((u) => u.pathname === '/', async (r) => r.fulfill({ response: await r.fetch(), body: html, contentType: 'text/html; charset=utf-8' }));
    }
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector('.card');
    ctl.firstReviewFull = await page.evaluate((id) => !document.querySelector('.card[data-sid="' + id + '"]').classList.contains('strip'), D);
    await page.evaluate(async () => { clearTimeout(pollT); while (polling) await new Promise((r) => setTimeout(r, 10)); clearTimeout(pollT); });
    await sleep(800);       // 等列的淡入结束，再量尺寸、点击和截图；第一拍的交付样子已单独记下。
    return { ctx, page, errs, ctl };
  };
  const tick = (page) => page.evaluate(async () => { clearTimeout(pollT); while (polling) await new Promise((r) => setTimeout(r, 10)); await poll(); clearTimeout(pollT); });
  const tap = async (page, q) => { const el = page.locator(q); if (!await el.count()) return;
    await el.evaluate((e) => e.closest('.card')?.scrollIntoView({ block: 'center' }));
    await el.click({ timeout: 3000 }).catch((e) => console.log('  点击未完成：' + q + ' · ' + e.message.split('\n')[0])); };
  const card = (page, id = K) => page.evaluate((id) => {
    const e = document.querySelector('.card[data-sid="' + id + '"]'); if (!e) return {};
    const sl = e.querySelector('.sl'); return { strip: e.classList.contains('strip'), h: e.getBoundingClientRect().height, opened: e.classList.contains('opened'), cls: e.className,
      text: sl ? sl.textContent : '', tip: sl ? sl.title : '', shrink: !!e.querySelector('.shrink') && getComputedStyle(e.querySelector('.shrink')).display !== 'none' };
  }, id);
  const layoutST = (page) => page.evaluate(() => {
    const cs = [...document.querySelectorAll('#stage .card:not([hidden])')];
    const rows = cs.map((e) => { const sl = e.querySelector('.sl'); return { id: e.dataset.sid, hot: e.matches('.s-ask,.alert,.s-reply,.s-review') || e.dataset.sid.startsWith('x:'), strip: e.classList.contains('strip'), h: e.getBoundingClientRect().height,
      onlySl: [...e.children].filter((x) => getComputedStyle(x).display !== 'none').every((x) => x === sl), text: sl ? sl.textContent : '', meta: (e.querySelector('.meta') || {}).textContent, title: (e.querySelector('.title') || {}).textContent,
      dot: !!sl && !!sl.querySelector('i') && getComputedStyle(sl.querySelector('i')).width === '7px' }; });
    const cols = [...document.querySelectorAll('.gbody')]; if (!cols.length) cols.push(document.querySelector('#stage'));
    const lanes = cols.map((g) => { const a = [...g.children].filter((e) => e.matches('.card:not([hidden])')), i = a.findIndex((e) => e.classList.contains('strip'));
      return { ordered: i < 0 || a.slice(i).every((e) => e.classList.contains('strip')), s1: i < 0 || a[i].classList.contains('s1') && getComputedStyle(a[i]).gridColumnStart === '1' && a.filter((e) => e.classList.contains('s1')).length === 1 }; });
    return { rows, lanes, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const checkLayout = async (page, tag, en = false) => {
    const l = await layoutST(page), full = l.rows.filter((x) => x.hot), strips = l.rows.filter((x) => !x.hot);
    ok(full.length > 4 && full.every((x) => !x.strip && x.h > 200), tag + '：要你的四类、进程退出是整格', JSON.stringify(full.filter((x) => x.strip || x.h <= 200)));
    ok(strips.length > 5 && strips.every((x) => x.strip && Math.abs(x.h - 34) < 2 && x.onlySl), tag + '：在跑、后台、启动、无需处理、处理过、空闲只有 34 px 窄条', JSON.stringify(strips.filter((x) => !x.strip || Math.abs(x.h - 34) >= 2 || !x.onlySl)));
    // 夹具确有静默状态；先确认窄条存在，旧页面不能因「根本没有窄条」而空过排序和 s1。
    ok(l.rows.some((x) => x.strip) && l.lanes.every((x) => x.ordered), tag + '：每列整卡在前、窄条在后', JSON.stringify(l.lanes));
    ok(l.rows.some((x) => x.strip) && l.lanes.every((x) => x.s1), tag + '：每列第一条窄条 s1 另起一行', JSON.stringify(l.lanes));
    ok(strips.every((x) => x.dot && x.title && x.text.includes(x.title) && (x.id.startsWith('p:') || x.text.includes(x.meta))), tag + '：状态点、标题、状态词与时长同整卡药丸', JSON.stringify(strips));
    if (en) ok(strips.every((x) => !/[一-鿿]/.test(x.text)), tag + '：窄条全是英文', JSON.stringify(strips.map((x) => x.text)));
    ok(!l.overflow, tag + '：页面没有横向溢出');
  };
  let { ctx, page, errs, ctl } = await openST();
  const raw = await page.evaluate(() => api('/api/state?peek=1'));
  ok(raw.sessions.some((x) => x.status === 'busy') && raw.sessions.some((x) => x.status === 'shell') && raw.sessions.some((x) => x.digest?.need === 'reply') && raw.sessions.some((x) => x.digest?.need === 'review') && raw.pending.some((x) => x.dialog) && raw.lost.length > 0,
    '窄条：原始夹具覆盖运行、后台、待跟进、待审阅、等你选、进程退出');
  await checkLayout(page, '窄条 · 中文深色 1520 按项目');
  await page.screenshot({ path: path.join(shots, '01-中文-深色-1520-墙.png') });
  await page.click('#by [data-by="status"]'); await checkLayout(page, '窄条 · 按状态'); await page.click('#by [data-by="project"]');
  const count = async (f) => { const q = page.locator(`#filters [data-f="${f}"] .num`); return await q.count() ? Number(await q.textContent()) : 0; };
  const n = await count('todo'), nr = await count('reply'), nv = await count('review'), na = await count('ask'), ns = await count('stop');
  const independent = await page.evaluate(() => [...document.querySelectorAll('.card')].filter((e) => e.matches('.s-ask,.alert,.s-reply,.s-review') || e.dataset.sid.startsWith('x:')).length);
  ok(n > 0 && ns > 0 && n === nr + nv + na + ns && n === independent, '要你：N 等于四类之和，含停住了，与状态 class 独立计数相同', JSON.stringify({ n, nr, nv, na, ns, independent }));
  await tap(page, '#filters [data-f="todo"]'); let l = await layoutST(page);
  ok(l.rows.length === n && l.rows.every((x) => x.hot && !x.strip), '要你：点后只剩四类整卡，没有窄条', JSON.stringify(l));
  await sleep(800); await page.screenshot({ path: path.join(shots, '02-中文-深色-1520-要你.png') });
  await tap(page, '#filters [data-f="todo"]'); l = await layoutST(page);
  ok(l.rows.length > n && l.rows.some((x) => x.strip), '要你：再点一次回到全部');
  await tap(page, '#filters [data-f="stop"]'); l = await layoutST(page);
  ok(l.rows.length === ns && l.rows.every((x) => x.hot && !x.strip), '停住了：原筛选保留、只显示停住的整卡');
  await tap(page, '#filters [data-f="all"]');
  await tap(page, sel(K) + ' .sl'); let c = await card(page);
  ok(!c.strip && c.opened && c.h > 200 && c.shrink, '窄条：点击展开整卡，卡头有「收成一条」', JSON.stringify(c));
  l = await layoutST(page); ok(l.lanes.every((x) => x.ordered), '窄条：展开的无需处理整卡也排在运行窄条前面', JSON.stringify(l.lanes));
  await sleep(800); await page.locator(sel(K)).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(shots, '03-中文-深色-1520-展开.png') });
  const ta = sel(K) + ' textarea'; await tap(page, ta); await page.keyboard.type('窄条回话测试'); await page.keyboard.press('Enter'); await sleep(150);
  ok(ctl.sent.length === 1 && ctl.sent[0].sid === K && ctl.sent[0].text === '窄条回话测试', '窄条展开：输入框打字、回车发送给来源会话（浏览器拦下）', JSON.stringify(ctl.sent));
  await page.evaluate(() => { for (const k of Object.keys(sentAt)) delete sentAt[k]; }); await tick(page);
  const pathLink = sel(K) + ' .body [data-path$=".html"]';
  const previews = []; await page.route('**/api/preview', async (r) => { previews.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ json: { ok: true, kind: 'text', name: 'fixture.txt', dir: FX.home, text: 'Preview fixture.' } }); });
  await page.evaluate((q) => document.querySelector(q)?.click(), pathLink); await sleep(200);
  const dock = await page.evaluate(() => { const p = document.querySelector('#preview'), d = document.querySelector('#pDock'); return { open: p.open, sid: d.dataset.sid, hidden: d.hidden, input: !!d.querySelector('textarea') }; });
  ok(previews.length === 1 && dock.open && dock.sid === K && !dock.hidden && dock.input, '窄条展开：正文路径打开预览，底部借来这张卡的回话框', JSON.stringify({ previews, dock }));
  if (dock.open) { await tap(page, '#pDock textarea'); await page.keyboard.type('预览草稿'); ctl.revision++; await tick(page); c = await card(page); ok(!c.strip, '窄条：回话框借到预览里打字时保持整卡'); await page.keyboard.press('Escape'); }
  else ok(false, '窄条：回话框借到预览里打字时保持整卡');
  const gallery = await page.locator(sel(K) + ' [data-gallery]').count();
  console.log('  图集夹具：links 正文没有图像 / 视频路径，本段不验证图集按钮；当前按钮数=' + gallery);
  await page.evaluate(() => { document.activeElement?.blur(); }); await tick(page); await tap(page, sel(K) + ' .sl'); await tap(page, sel(K) + ' .shrink');
  ok((await card(page)).strip, '窄条：点「收成一条」回到窄条');
  await page.locator(sel(K) + ' .sl').focus({ timeout: 600 }).catch(() => {}); await page.keyboard.press('Enter');
  ok(!(await card(page)).strip && (await card(page)).opened, '窄条：键盘 Enter 展开');
  ctl.revision++; await tick(page); ok((await card(page)).strip, '窄条：展开后有新一次交付，回到窄条');
  // 打字守卫要排除 opened 的保护：新交付会使展开记录作废，焦点仍应单独保住输入框。
  await tap(page, sel(K) + ' .sl'); await tap(page, ta); await page.keyboard.type('保持输入框'); ctl.revision++; ctl.state = 'busy'; await tick(page);
  const typed = await page.evaluate((q) => { const t = document.querySelector(q); return { value: t?.value, focus: document.activeElement === t }; }, ta);
  ok(!(await card(page)).strip && typed.focus && typed.value.endsWith('保持输入框'), '窄条：状态变成在跑且展开作废，打字期间仍不收、焦点和字不丢', JSON.stringify(typed));
  await ctx.close(); ok(errs.length === 0, '窄条 · 主流程：页面没有报错', errs.join(' | '));

  ({ ctx, page, errs, ctl } = await openST()); ctl.armed = true; await tick(page); c = await card(page);
  ok(c.strip && c.text.includes('自动接着做 · 25 秒后发') && c.text.includes('不发了') && !c.text.includes('接着做你上一轮自己提的下一步'), '窄条：自动续跑只显示倒数和取消，不塞整句', JSON.stringify(c));
  ok(c.tip.includes('会发：') && c.tip.includes('\n依据') && c.tip.includes('先跑验证'), '窄条：提示里有「会发」「依据」两段', c.tip);
  await tap(page, sel(K) + ' .sl [data-ap="cancel"]');
  ok(ctl.auto.some((x) => x.sid === K && x.op === 'cancel'), '窄条：「不发了」发 /api/auto cancel', JSON.stringify(ctl.auto));
  // 「处理过」由客户端的处理记录决定；完成应答继续经 fullState 路由，不改任何真实会话。
  await page.evaluate(() => { for (const s of last.sessions) if (s.resultAt) done[s.sid] = s.resultAt; });
  ctl.armed = false; ctl.allHandled = true; await tick(page);
  const allHandled = await page.evaluate(() => { const a = [...document.querySelectorAll('.card:not([hidden])')]; return a.length > 0 && a.every((e) => e.classList.contains('s-handled')); });
  await tap(page, '#filters [data-f="todo"]');
  const blank = await page.locator('.blank').textContent().catch(() => '');
  ok(allHandled && blank === '没有要你处理的了。再点一下「要你」回到全部。' && (await layoutST(page)).rows.length === 0, '要你：全是处理过时显示专用空态', blank);
  ok(errs.length === 0, '窄条 · 倒数和空态：页面没有报错', errs.join(' | ')); await ctx.close();

  // MutationObserver 保存每一次 class 的新值与时刻；快切回在跑时，不能漏掉一闪而过的整卡。
  ({ ctx, page, errs, ctl } = await openST());
  ok(ctl.firstReviewFull, '宽限：首次载入就是待审阅，第一拍整卡');
  const watch = async () => page.evaluate((sid) => { window.stObs?.disconnect(); const e = document.querySelector('.card[data-sid="' + sid + '"]'); window.stTrace = [{ at: performance.now(), cls: e.className }];
    window.stObs = new MutationObserver((ms) => { ms.forEach((m, i) => window.stTrace.push({ at: performance.now(), cls: ms.slice(i + 1).find((n) => n.target === m.target)?.oldValue ?? e.className })); });
    window.stObs.observe(e, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }); window.stStart = performance.now(); }, K);
  const trace = () => page.evaluate(() => window.stTrace.map((x) => ({ ms: Math.round(x.at - window.stStart), cls: x.cls })));
  ctl.state = 'busy'; await tick(page); await watch(); ctl.state = 'review'; await tick(page); await sleep(1450);
  let tr = await trace(); ok((await card(page)).strip && tr.every((x) => /\bstrip\b/.test(x.cls)), '宽限：在跑变待审阅，前 1.5 秒一直是窄条', JSON.stringify(tr));
  await sleep(850); tr = await trace(); ok(!(await card(page)).strip && tr.some((x) => !/\bstrip\b/.test(x.cls) && x.ms <= 2500), '宽限：停掉轮询，2.5 秒内自动升为整卡', JSON.stringify(tr));
  ctl.state = 'busy'; await tick(page); await watch(); ctl.state = 'review'; await tick(page); await sleep(1000); ctl.state = 'busy'; await tick(page); await sleep(1250); tr = await trace();
  ok((await card(page)).strip && tr.every((x) => /\bstrip\b/.test(x.cls)), '宽限：一秒后又在跑，全程没有一次整格', JSON.stringify(tr));
  // openST() 和 tick() 都等在途 poll 结束并清掉 pollT；两拍间不会有自然轮询刷新在跑时刻。
  ctl.state = 'busy'; await tick(page); await watch(); await sleep(1300);
  ctl.state = 'review'; await tick(page); await sleep(900); ctl.state = 'busy'; await tick(page); await sleep(300); tr = await trace();
  ok((await card(page)).strip && tr.every((x) => /\bstrip\b/.test(x.cls)), '宽限：停下那一拍离上一次在跑隔了 1.3 秒，再接上也不闪整格', JSON.stringify(tr));
  for (const state of ['ask', 'stop']) { ctl.state = 'busy'; await tick(page); ctl.state = state; await tick(page); c = await card(page);
    ok(!c.strip && c.h > 200, '宽限：在跑变' + (state === 'ask' ? '等你选' : '停住了') + '，下一拍立即整格', JSON.stringify(c)); }
  ctl.state = 'busy'; await tick(page); await tap(page, '#filters [data-f="busy"]');
  ok((await layoutST(page)).rows.every((x) => !x.strip), '窄条：筛选不是全部时不收窄条'); await tap(page, '#filters [data-f="all"]'); await sleep(900);
  // 第二次 paint 的属性写 API 和 MutationObserver 双计数，包含 .sl 的 dataset / 文本 / class / aria / title。
  const churn = await page.evaluate(() => {
    clearTimeout(pollT); const st = structuredClone(last); paint(st); const hits = [], undo = [], root = document.querySelector('#stage');
    const inside = (e) => e instanceof Element && root.contains(e), patch = (p, k, wrap) => { const o = Object.getOwnPropertyDescriptor(p, k); Object.defineProperty(p, k, wrap(o)); undo.push(() => Object.defineProperty(p, k, o)); };
    for (const [p, key] of [[Element.prototype, 'className'], [Element.prototype, 'innerHTML'], [Node.prototype, 'textContent'], [HTMLElement.prototype, 'hidden'], [HTMLElement.prototype, 'title']])
      patch(p, key, (o) => ({ ...o, set(v) { if (inside(this)) hits.push(key + ':' + this.nodeName + '.' + this.className); return o.set.call(this, v); } }));
    patch(Element.prototype, 'setAttribute', (o) => ({ ...o, value: function (k, v) { if (inside(this)) hits.push('attr:' + k); return o.value.call(this, k, v); } }));
    patch(HTMLElement.prototype, 'dataset', (o) => ({ ...o, get() { const e = this; return new Proxy(o.get.call(this), { get: (t, k) => t[k], set(t, k, v) { if (inside(e)) hits.push('dataset:' + String(k)); t[k] = v; return true; } }); } }));
    const ob = new MutationObserver(() => {}); ob.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    let mutations; try { paint(structuredClone(st)); mutations = ob.takeRecords().map((x) => x.type + ':' + x.attributeName); } finally { ob.disconnect(); undo.reverse().forEach((f) => f()); }
    return { hits, mutations };
  });
  ok(churn.hits.length === 0 && churn.mutations.length === 0, '窄条性能：同一份状态第二次绘制 0 次 DOM 写入', JSON.stringify(churn));
  ok(errs.length === 0, '窄条 · 宽限和性能：页面没有报错', errs.join(' | ')); await ctx.close();

  ({ ctx, page, errs } = await openST({ off: true }));
  ok((await layoutST(page)).rows.every((x) => !x.strip && x.h > 200), '窄条开关：ccb_strip=off 时没有窄条');
  await page.evaluate(() => localStorage.removeItem('ccb_strip'));
  await page.evaluate(() => paint(last)); ok((await layoutST(page)).rows.every((x) => !x.strip), '窄条开关：载入后删键不会当场改变开关');
  await page.reload(); await page.waitForSelector('.card');
  ok((await layoutST(page)).rows.some((x) => x.strip), '窄条开关：删键再载入后恢复窄条');
  ok(errs.length === 0, '窄条 · 关闭开关：页面没有报错', errs.join(' | ')); await ctx.close();
  ({ ctx, page, errs } = await openST({ storageFail: true }));
  ok((await layoutST(page)).rows.some((x) => x.strip), '窄条开关：存储读取失败时默认开启');
  ok(errs.length === 0, '窄条 · 存储失败：页面没有报错', errs.join(' | ')); await ctx.close();
  for (const [lang, scheme, w, file] of [['zh', 'light', 1728, '04-中文-浅色-1728.png'], ['en', 'dark', 1520, '05-英文-深色-1520.png'], ['zh', 'dark', 700, '06-中文-深色-700.png'], ['en', 'light', 1520, '07-英文-浅色-1520.png']]) {
    ({ ctx, page, errs } = await openST({ lang, scheme, w })); await checkLayout(page, `窄条 · ${lang} ${scheme} ${w}`, lang === 'en');
    await page.screenshot({ path: path.join(shots, file) }); ok(errs.length === 0, `窄条 · ${lang} ${scheme} ${w}：页面没有报错`, errs.join(' | ')); await ctx.close();
  }
}

// ── 预计交付（11/18）：卡片右上角「运行中 · 12 分钟 · 预计 23:50 交」「后台在跑 · 1 小时 · 比预计晚 10 分钟」。UI_ONLY=eta；ET_HTML 换整页做红阶段 / 改坏对照 ──
// 在浏览器里改 /api/state 的应答，给 run（在跑）、bg（后台在跑）、stall（没动静）、done（已交付）挂上 eta；bgOpen（后台在跑）不给。
// eta 的 at 第一次应答时按服务的 now 定死，之后每拍原样给。期望的钟点在页面里用 Date 另算（今天写钟点、别的日子加「明天」），不调界面的函数。
async function etaSeg() {
  console.log('\n[预计交付]');
  const ids = { run: FX.sids.run, bg: FX.sids.bg, stall: FX.sids.stall, done: FX.sids.done, bgOpen: FX.sids.bgOpen };
  const card = (n) => `.card[data-sid="${ids[n]}"]`;
  const open = async ({ lang = 'zh', scheme = 'light', strips = false, plan = { run: [-2, 20], bg: [-40, 30], stall: [-5, 30], done: [-5, 30] } } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript((off) => { localStorage.setItem('ccb_mode', JSON.stringify('wall')); if (off) localStorage.setItem('ccb_strip', 'off'); else localStorage.removeItem('ccb_strip'); }, !strips);
    const page = await ctx.newPage(), errs = [], fixed = {};
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.route('**/api/state*', async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
      for (const x of j.sessions || []) for (const [n, sid] of Object.entries(ids)) if (x.sid === sid && plan[n]) {
        if (!fixed[n]) fixed[n] = { at: new Date(j.now + plan[n][0] * 60000).toISOString(), mins: plan[n][1] };
        x.eta = fixed[n];
      }
      await route.fulfill({ response: r, json: j }); });
    if (process.env.ET_HTML) {
      const html = fs.readFileSync(process.env.ET_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
      await page.route((u) => u.pathname === '/', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: html, contentType: 'text/html; charset=utf-8' }); });
    }
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector('.card'); await sleep(1800);   // 至少一拍带上 eta 的应答画完
    return { ctx, page, errs, fixed };
  };
  // 一张卡的读数：牌子整句、预计那一段、悬停、窄条里的那句；期望值：按 eta 另算的钟点（due）和报的时刻（at）
  const read = (page, n, fx) => page.evaluate(({ sel, e }) => {
    const c = document.querySelector(sel), m = c && c.querySelector('.meta'), me = m && m.querySelector('.me'), sl = c && c.querySelector('.sl span');
    const p2 = (v) => String(v).padStart(2, '0'), hm = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
    const due = e ? Date.parse(e.at) + e.mins * 60000 : 0, day = e && new Date(due).toDateString() !== new Date().toDateString();
    // 卡头排版：显示着的按钮（含平时透明的「放大看」）都和牌子在同一行（顶边高于牌子底边），牌子不截字、不出卡头
    const hd = c && c.querySelector('.chead'), mr = m && m.getBoundingClientRect(), hr = hd && hd.getBoundingClientRect();
    const btns = hd ? [...hd.children].filter((b) => b.tagName === 'BUTTON' && getComputedStyle(b).display !== 'none') : [];
    const row = !!mr && btns.length > 0 && btns.every((b) => b.getBoundingClientRect().top < mr.bottom - 1);
    const fit = !!mr && m.scrollWidth <= m.clientWidth + 1 && mr.right <= hr.right + 0.5;
    return { meta: m ? m.textContent : null, me: me ? me.textContent : null, tip: m ? m.title : null, strip: sl ? sl.textContent : null, cls: c ? c.className : '',
      row, fit, cw: c ? Math.round(c.getBoundingClientRect().width) : 0, mh: mr ? Math.round(mr.height) : 0, nb: btns.length,
      dueHm: e ? (day ? '明天 ' : '') + hm(due) : '', dueHmEn: e ? (day ? 'tomorrow ' : '') + hm(due) : '', atHm: e ? hm(e.at) : '' };
  }, { sel: card(n), e: fx[n] || null });
  // 把几张收成窄条的卡点开（点条上那一句，和手点一样），等画完
  const openStrips = async (page, ns) => { for (const n of ns) { const q = page.locator(card(n) + '.strip .sl'); if (!await q.count()) continue;
    await q.evaluate((e) => e.closest('.card').scrollIntoView({ block: 'center' })); await q.click({ timeout: 3000 }).catch(() => {}); await sleep(500); } await sleep(400); };

  { // 中文浅色、整格
    const { ctx, page, errs, fixed } = await open();
    const run = await read(page, 'run', fixed), bg = await read(page, 'bg', fixed);
    ok(new RegExp('^运行中 · .+ · 预计 ' + run.dueHm + ' 交$').test(run.meta || ''), '在跑：牌子是「运行中 · 时长 · 预计 HH:MM 交」，钟点 = 报的时刻 + N 分钟（期望 ' + run.dueHm + '）', JSON.stringify(run));
    ok(run.me === '预计 ' + run.dueHm + ' 交', '在跑：预计那一段单独一个 .me（和前面的时长分开，样式等宽数字）', JSON.stringify(run.me));
    ok(run.tip === '窗口在 ' + run.atHm + ' 报的：还要 20 分钟', '在跑：悬停写明这是窗口自己报的、几点报的、报了多少', JSON.stringify(run.tip));
    ok(/^后台在跑 · .+ · 比预计晚 10 分钟$/.test(bg.meta || ''), '后台在跑、过了预计 10 分钟：「后台在跑 · 时长 · 比预计晚 10 分钟」', JSON.stringify(bg.meta));
    ok(!/s-reply|s-ask|alert/.test(bg.cls), '晚了不变成要你处理（不加琥珀色的 s-reply / s-ask / alert）', bg.cls);
    ok([run, bg].every((x) => x.row && x.fit), '带上预计也不把卡头的按钮挤到下一行（墙上的窄卡放不下就在牌子里折行），牌子不截字', JSON.stringify([run, bg].map((x) => ({ cw: x.cw, mh: x.mh, nb: x.nb, row: x.row, fit: x.fit, meta: x.meta }))));
    const rest = await Promise.all(['stall', 'done', 'bgOpen'].map(async (n) => [n, await read(page, n, fixed)]));
    ok(rest.every(([, x]) => x.meta && !/预计/.test(x.meta) && !x.me && !x.tip), '没动静的（stall）、已交付的（done）带着 eta 也不显示；没报的（bgOpen）照旧', JSON.stringify(rest.map(([n, x]) => [n, x.meta, x.tip])));
    await shotOf(page, 'run', 'eta-run-zh-light.png'); await shotOf(page, 'bg', 'eta-late-zh-light.png');
    ok(errs.length === 0, '预计（中文）：没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
  { // 报的是 24 小时（跨到明天）
    const { ctx, page, errs, fixed } = await open({ plan: { run: [0, 1440] } });
    const run = await read(page, 'run', fixed);
    ok(/^明天 /.test(run.dueHm) && run.me === '预计 ' + run.dueHm + ' 交', '跨到明天的写「预计 明天 HH:MM 交」', JSON.stringify(run));
    ok(run.row && run.fit, '「预计 明天 HH:MM 交」更长，按钮照样和牌子在一行、不截字', JSON.stringify({ cw: run.cw, mh: run.mh, nb: run.nb, row: run.row, fit: run.fit }));
    ok(errs.length === 0, '预计（明天）：没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
  { // 英文深色
    const { ctx, page, errs, fixed } = await open({ lang: 'en', scheme: 'dark' });
    const run = await read(page, 'run', fixed), bg = await read(page, 'bg', fixed);
    ok(run.me === 'ETA ' + run.dueHmEn && /^Running · .+ · ETA /.test(run.meta || ''), '英文：在跑的是「Running · … · ETA HH:MM」', JSON.stringify(run));
    ok(/^Background task · .+ · 10 min past ETA$/.test(bg.meta || ''), '英文：过了时间的是「… · 10 min past ETA」', JSON.stringify(bg.meta));
    ok(run.tip === 'The window estimated at ' + run.atHm + ': 20 more min', '英文：悬停也翻了', JSON.stringify(run.tip));
    ok(![run, bg].some((x) => /[一-鿿]/.test((x.meta || '') + (x.tip || ''))), '英文：牌子和悬停里没有漏翻的中文', JSON.stringify([run.meta, bg.meta, run.tip]));
    ok([run, bg].every((x) => x.row && x.fit), '英文：按钮照样和牌子在一行、不截字', JSON.stringify([run, bg].map((x) => ({ cw: x.cw, mh: x.mh, row: x.row, fit: x.fit }))));
    await shotOf(page, 'run', 'eta-run-en-dark.png');
    ok(errs.length === 0, '预计（英文）：没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
  { // 窄条：不要你管的卡收成一条，那一条里同样带预计
    const { ctx, page, errs, fixed } = await open({ strips: true });
    const run = await read(page, 'run', fixed);
    ok(/\bstrip\b/.test(run.cls) && run.strip === run.meta && / · 预计 /.test(run.strip || ''), '窄条：在跑的卡收成一条时，条上那句和牌子一样带「预计 HH:MM 交」', JSON.stringify(run));
    await page.screenshot({ path: path.join(OUT, 'eta-wall-strips-zh-light.png') });
    // 点开的窄条（.card.opened）卡头多一个「收成一条」，四个图标：带预计的牌子要多让 30 px，不然 ⤢ 掉到第二行（11/19 线上真卡片：卡头 66 px，正常 36 px）
    await openStrips(page, ['run', 'bg']);
    const oRun = await read(page, 'run', fixed), oBg = await read(page, 'bg', fixed);
    ok([oRun, oBg].every((x) => /\bopened\b/.test(x.cls) && x.nb === 4 && x.row && x.fit && x.me),
      '窄条点开（opened，卡头四个图标）：带预计的牌子和 ⤢「放大看」在同一行，牌子不截字', JSON.stringify([oRun, oBg].map((x) => ({ cls: x.cls, cw: x.cw, mh: x.mh, nb: x.nb, row: x.row, fit: x.fit, meta: x.meta }))));
    await shotOf(page, 'run', 'eta-opened-run-zh-light.png');
    ok(errs.length === 0, '预计（窄条）：没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
  { // 点开的窄条，英文浅色（照线上英文浅色卡的样子）
    const { ctx, page, errs, fixed } = await open({ strips: true, lang: 'en' });
    await openStrips(page, ['run', 'bg']);
    const oRun = await read(page, 'run', fixed), oBg = await read(page, 'bg', fixed);
    ok([oRun, oBg].every((x) => /\bopened\b/.test(x.cls) && x.nb === 4 && x.row && x.fit && x.me),
      '英文：窄条点开（四个图标）也和 ⤢ 在同一行、不截字', JSON.stringify([oRun, oBg].map((x) => ({ cls: x.cls, cw: x.cw, mh: x.mh, nb: x.nb, row: x.row, fit: x.fit, meta: x.meta }))));
    await shotOf(page, 'run', 'eta-opened-run-en-light.png'); await shotOf(page, 'bg', 'eta-opened-late-en-light.png');
    ok(errs.length === 0, '预计（英文、点开的窄条）：没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
}

// ── 撤销、↑ 取回上一句。UI_ONLY=undo；UN_HTML 换页面做红阶段和改坏对照 ──
// 状态一律取整份；发送只在浏览器回假应答；推迟与清除走夹具服务。
async function undoSeg() {
  console.log('\n[撤销、↑ 取回上一句]');
  const D = FX.sids.done, K = FX.sids.links, X = FX.sids.askTag;
  const card = (sid) => `.card[data-sid="${sid}"]`, ta = (sid) => card(sid) + ' textarea';
  const openUN = async ({ lang = 'zh', scheme = 'dark', init = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => localStorage.setItem('ccb_mode', JSON.stringify('wall')));
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage(), errs = [], hit = { sends: [], processed: [], sendOk: true, delivered: true };
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.route('**/api/state*', async (route) => { let r, j; try { r = await fullState(route); j = await r.json(); } catch { return route.abort().catch(() => {}); }
      for (const x of j.sessions || []) if (x.sid === D || x.sid === K) { x.channel = 'tmux'; x.tmux = 'ccb-fake'; }
      await route.fulfill({ response: r, json: j }); });
    await page.route('**/api/send', async (route) => { hit.sends.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ json: hit.sendOk ? { ok: true, delivered: hit.delivered } : { ok: false, error: '没发出去' } }); });
    await page.route('**/api/processed', async (route) => { hit.processed.push(JSON.parse(route.request().postData() || '{}')); await route.continue(); });
    if (process.env.UN_HTML) {
      const html = fs.readFileSync(process.env.UN_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
      await page.route((u) => u.pathname === '/', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: html, contentType: 'text/html; charset=utf-8' }); });
    }
    await srvClear([D, K]);      // 前面的段可能把 done 记成了处理过（「审完了」跨页面共享）：从待审阅开始
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector('.card'); await sleep(500);
    return { ctx, page, errs, hit };
  };
  // 派发会冒泡、可取消的按键，直接读 defaultPrevented，不依赖无头浏览器的原生文字撤销。
  const key = (page, sel = 'body', opt = {}) => page.evaluate(({ sel, opt }) => {
    if (sel === 'body') document.activeElement.blur(); else document.querySelector(sel).focus();
    const e = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true, ...opt });
    (sel === 'body' ? document.body : document.querySelector(sel)).dispatchEvent(e); return e.defaultPrevented;
  }, { sel, opt });
  const up = (page, sid = D, opt = {}) => key(page, ta(sid), { key: 'ArrowUp', code: 'ArrowUp', metaKey: false, ...opt });
  const info = (page, sid = D) => page.evaluate((sid) => {
    const c = cards.get(sid), t = c && c.el._rp.querySelector('textarea');
    return { cls: c.el.className, text: t.value, end: t.selectionStart === t.value.length && t.selectionEnd === t.value.length,
      has: c.el._rp.classList.contains('has'), done: JSON.parse(localStorage.getItem('ccb_done') || '{}')[sid],
      count: document.querySelector('[data-f="review"] b')?.textContent,
      toast: document.querySelector('#toast').classList.contains('on'), msg: document.querySelector('#toast span').textContent,
      draft: JSON.parse(localStorage.getItem('ccb_draft') || '{}')[sid]?.t, last: JSON.parse(localStorage.getItem('ccb_last') || '{}')[sid]?.t };
  }, sid);
  const handled = (x) => /s-handled/.test(x.cls), review = (x) => /s-review/.test(x.cls);
  const mark = async (page) => {
    // 每次先还原待审阅，前一条在旧版上失败也不能让隐藏按钮卡住后面的独立断言。
    await page.evaluate(async (sid) => { delete done[sid]; store('ccb_done', done); await api('/api/processed', { clear: [sid] }); refresh(); }, D);
    await page.waitForFunction((sid) => !(typeof srvDone === 'object' && srvDone[sid]), D, { timeout: 4000 }).catch(() => {});     // 服务给的那一份也要清掉才回到待审阅（旧界面没有 srvDone，直接过）
    await page.evaluate(() => paint(last));
    await page.click(card(D) + ' .done'); await sleep(180);
  };
  const clean = async ({ page, ctx, errs }, label) => {
    await page.evaluate(async ({ X, D }) => { await api('/api/snooze', { sid: X, clear: true }); await api('/api/processed', { clear: [D, ...Object.keys(JSON.parse(localStorage.getItem('ccb_done') || '{}'))] }); }, { X, D });
    ok(errs.length === 0, `撤销 ${label}：页面没有报错`, errs.join(' | ')); await ctx.close();
  };
  for (const [lang, scheme] of [['zh', 'dark'], ['en', 'light']]) {
    const o = await openUN({ lang, scheme }), { page, hit } = o, zh = lang === 'zh';
    const pre = await info(page); await mark(page); const marked = await info(page);
    ok(review(pre) && handled(marked) && +marked.count === +pre.count - 1, `撤销 ${lang}：审完了变处理过，待审阅少一个`, JSON.stringify({ pre, marked }));
    ok(marked.toast && (zh ? /^已处理「/.test(marked.msg) : /^Handled /.test(marked.msg)), `撤销 ${lang}：提示条文字`, marked.msg);
    if (zh) await page.screenshot({ path: path.join(OUT, 'undo-zh-dark-toast.png') });
    await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('Meta+KeyZ'); await sleep(240); let v = await info(page);
    ok(review(v) && v.count === pre.count && !v.done && !v.toast, `撤销 ${lang}：⌘Z 恢复待审阅、计数和本机记录，收起提示条`, JSON.stringify(v));
    const n = hit.processed.length; const twice = await key(page); await sleep(180); v = await info(page);
    ok(!twice && hit.processed.length === n && review(v), `撤销 ${lang}：第二次不拦也不执行`, JSON.stringify({ twice, n, now: hit.processed.length }));
    await page.fill(ta(D), '上一句测试'); await page.press(ta(D), 'Enter'); await sleep(450);
    v = await info(page); ok(hit.sends.at(-1)?.text === '上一句测试' && v.text === '' && v.last === '上一句测试', `上一句 ${lang}：成功发出才存 ccb_last`, JSON.stringify(v));
    const got = await up(page); await sleep(380); v = await info(page);
    ok(got && v.text === '上一句测试' && v.end && v.has && v.draft === '上一句测试', `上一句 ${lang}：空框 ↑ 取回，光标在末尾、发送键亮、草稿存住`, JSON.stringify(v));
    if (!zh) await page.locator(card(D)).screenshot({ path: path.join(OUT, 'undo-en-light-recall.png') });
    if (zh) {
      await page.fill(ta(D), ''); await sleep(380); await page.reload(); await page.waitForSelector(ta(D)); await sleep(400);
      await page.press(ta(D), 'ArrowUp'); v = await info(page); ok(v.text === '上一句测试', '上一句：整页重新载入后仍可取回', JSON.stringify(v));
      await page.fill(ta(D), 'abc'); const nonempty = await up(page); v = await info(page);
      ok(!nonempty && v.text === 'abc', '上一句：框有字时 ↑ 不拦、不替换', JSON.stringify(v));
      for (const opt of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
        await page.fill(ta(D), ''); const prevented = await up(page, D, opt); v = await info(page);
        ok(!prevented && v.text === '', '上一句：修饰键或选字不取回 ' + JSON.stringify(opt), JSON.stringify(v));
      }
      hit.sendOk = false; await page.fill(ta(D), '失败这句'); await page.press(ta(D), 'Enter'); await sleep(450);
      v = await info(page); ok(v.text === '失败这句' && v.last === '上一句测试', '上一句：发送失败保留原来的成功记录', JSON.stringify(v));
      await page.fill(ta(D), ''); await up(page); v = await info(page); ok(v.text === '上一句测试', '上一句：失败后 ↑ 仍取成功的那句', JSON.stringify(v));
      const other = await up(page, K); const kv = await info(page, K); ok(!other && kv.text === '', '上一句：另一张卡不取别人的话，也不用服务 prompt', JSON.stringify(kv));
      await page.fill(ta(D), ''); await page.keyboard.press('Meta+KeyK'); await sleep(150);
      const before = await page.locator('#jQ').getAttribute('aria-activedescendant'); await key(page, '#jQ', { key: 'ArrowUp', code: 'ArrowUp', metaKey: false });
      const jq = await page.locator('#jQ').inputValue(), after = await page.locator('#jQ').getAttribute('aria-activedescendant');
      ok(jq === '' && before !== after, '上一句：⌘K 搜索框 ↑ 仍选列表、不取回', JSON.stringify({ jq, before, after })); await page.keyboard.press('Escape');
      await mark(page); await page.evaluate(() => { toast('别的提示'); document.activeElement.blur(); });
      await page.keyboard.press('Meta+KeyZ'); await sleep(240); v = await info(page);
      ok(handled(v) && !!v.done && v.msg === '别的提示', '撤销：别的提示盖掉撤销提示后 ⌘Z 不撤，处理记录保留', JSON.stringify(v));
    }
    await clean(o, lang);
  }
  // 每条撤销守卫都先创建一个新动作，避免上一条失败造成后续假绿。
  for (const [label, sel, text, opt] of [
    ['卡片有字', ta(D), 'abc', {}], ['搜索框有字', '#jQ', 'abc', {}], ['新任务有字', '#nPrompt', 'abc', {}],
    ['Shift', 'body', '', { shiftKey: true }], ['Ctrl+Z', 'body', '', { metaKey: false, ctrlKey: true }],
    ['Alt', 'body', '', { altKey: true }], ['选字', 'body', '', { isComposing: true }], ['229', 'body', '', { keyCode: 229 }]
  ]) {
    const o = await openUN(), { page } = o; await mark(page);
    if (sel === '#jQ') await page.keyboard.press('Meta+KeyK'); if (sel === '#nPrompt') await page.click('#newBtn');
    if (text) await page.fill(sel, text);
    const p = await key(page, sel, opt), v = await info(page);
    ok(!p && handled(v) && v.toast, `撤销守卫：${label}不抢按键，动作仍待撤销`, JSON.stringify({ p, v }));
    if (text) await page.fill(sel, '');
    const retry = await key(page, sel, {}); await sleep(160); const v2 = await info(page);
    ok(retry && review(v2), `撤销守卫：${label}之后空框或普通 ⌘Z 仍能撤`, JSON.stringify(v2));
    await clean(o, label);
  }
  {
    const o = await openUN(), { page } = o; await mark(page);
    const p = await key(page, 'body', { key: 'Ω', code: 'KeyZ' }); const v = await info(page);
    ok(p && review(v), '撤销：中文输入法 key 不是 z 时认 code KeyZ', JSON.stringify(v));
    await mark(page); await page.click('#toast button'); await sleep(180); const n = o.hit.processed.length, again = await key(page); await sleep(100);
    ok(review(await info(page)) && !again && o.hit.processed.length === n, '撤销：提示条按钮和 ⌘Z 消费同一动作');
    await mark(page); await sleep(6500); const expired = await key(page), ex = await info(page);
    ok(!expired && handled(ex), '撤销：6.5 秒后不拦也不撤', JSON.stringify(ex));
    await clean(o, '时限与按钮');
  }
  {
    const o = await openUN(), { page } = o;
    await page.evaluate((sid) => api('/api/snooze', { sid, clear: true }).then(refresh), X); await sleep(300);
    await page.click(card(X) + ' .done'); await page.click('#menu [data-z]:first-child'); await sleep(600);
    const srv = () => page.evaluate((sid) => api('/api/state?peek=1').then((j) => j.sessions.find((x) => x.sid === sid)?.snooze || null), X);
    const z1 = await srv(); ok(!!z1 && handled(await info(page, X)), '撤销：先放着一小时确实写进服务', JSON.stringify(z1));
    await key(page); await sleep(600); const z2 = await srv(), v = await info(page, X);
    ok(!z2 && /s-reply/.test(v.cls), '撤销：⌘Z 清掉服务的推迟并恢复待跟进', JSON.stringify({ z2, v }));
    await mark(page); await page.click(card(FX.sids.tidyWork) + ' .done'); await key(page); await sleep(180);
    ok(handled(await info(page)) && review(await info(page, FX.sids.tidyWork)), '撤销：新的动作盖掉旧的，只撤最近一次');
    await clean(o, '推迟与覆盖');
  }
  {
    const o = await openUN({ init: `localStorage.setItem('ccb_last', JSON.stringify({ ${JSON.stringify(D)}: { t: '弹层上一句', at: Date.now() } }))` }), { page } = o;
    await mark(page); await page.click(card(D) + ' [data-act="detail"]'); await page.waitForSelector('#dDock textarea');
    const recalled = await key(page, '#dDock textarea', { key: 'ArrowUp', code: 'ArrowUp', metaKey: false });
    const v = await info(page); ok(recalled && v.text === '弹层上一句' && v.end && v.has, '上一句：挪进弹层的同一个回话框照样取回', JSON.stringify(v));
    const typing = await key(page, '#dDock textarea'); ok(!typing && handled(await info(page)), '撤销：弹层回话框有字时不抢打字撤销');
    await page.fill('#dDock textarea', ''); const empty = await key(page, '#dDock textarea');
    ok(empty && review(await info(page)), '撤销：弹层回话框空着时撤最近动作');
    await clean(o, '弹层');
  }
  {
    const o = await openUN(), { page, hit } = o;
    await page.fill(ta(D), '  原样上一句  '); await page.press(ta(D), 'Enter'); await sleep(350); await up(page);
    const v = await info(page); ok(hit.sends.at(-1)?.text === '原样上一句' && v.text === '  原样上一句  ', '上一句：取回原样 typed，保留首尾空格', JSON.stringify(v));
    await page.fill(ta(D), '');
    await page.evaluate((sid) => { const c = cards.get(sid); c.el._att.atts = [{ path: '/tmp/attachment-only.txt', name: 'attachment-only.txt' }]; c.el._mark(); }, D);
    await page.click(card(D) + ' .send'); await sleep(350); await up(page);
    const a = await info(page); ok(hit.sends.at(-1)?.files?.[0] === '/tmp/attachment-only.txt' && a.text === '  原样上一句  ', '上一句：仅发附件不覆盖文字记录', JSON.stringify(a));
    hit.delivered = false; await page.fill(ta(D), '未确认上一句'); await page.press(ta(D), 'Enter'); await sleep(350); await up(page);
    const u = await info(page); ok(u.text === '未确认上一句' && u.last === '未确认上一句', '上一句：r.ok 成功但未确认送达仍记下', JSON.stringify(u));
    await clean(o, '原样文字与附件');
  }
  for (const [label, value] of [
    ['八天前', JSON.stringify({ [D]: { t: '八天前的', at: Date.now() - 8 * 86400000 }, bad: { t: 5 } })],
    ['坏 JSON', '{broken'], ['非对象', '"garbage"']
  ]) {
    const o = await openUN({ init: `localStorage.setItem('ccb_last', ${JSON.stringify(value)})` });
    const p = await up(o.page), v = await info(o.page).catch(() => null);
    ok(!p && (await o.page.locator(ta(D)).inputValue()) === '', `上一句：${label}不放回`, JSON.stringify(v));
    await clean(o, label);
  }
}

// 逐笔补丁：真实夹具读内容；浏览器只替换错误、截断和应答顺序。
async function diffSeg() {
  console.log('\n[看这一轮的改动]');
  const sid = FX.sids.askCond, card = '.card[data-sid="' + sid + '"]';
  const app = '~/code/site/app.js', fresh = '~/code/site/pages/p22.html';
  const shotDir = path.resolve(HERE, '../../t3-item6-shots');
  const shots = async (page, file) => { if (process.env.DF_CAPTURE) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, file) }); } };
  for (const [lang, scheme, listNo, viewNo] of [['zh', 'dark', '02', '03'], ['en', 'light', '05', '06'], ['zh', 'light', null, '07'], ['en', 'dark', null, '08']]) {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => localStorage.setItem('ccb_mode', JSON.stringify('wall')));
    const page = await ctx.newPage(), errs = [], dialogs = [];
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (403|404|500)/.test(m.text())) errs.push(m.text()); });
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    if (process.env.DF_HTML) { const html = fs.readFileSync(process.env.DF_HTML, 'utf8').replace('__TOKEN__', new URL(FX.url).searchParams.get('k'));
      await page.route(u => u.pathname === '/', async route => route.fulfill({ response: await route.fetch(), body: html, contentType: 'text/html; charset=utf-8' })); }
    await page.goto(FX.url + '&lang=' + lang); await page.waitForSelector(card); await sleep(600);
    await page.locator(card + ' .wl').click();
    const tag = '改动 · ' + lang + ' · ' + scheme + '：';
    const exists = await page.locator(card + ' [data-diff]').count();
    const list = await page.locator(card + ' .wrote li').count();
    ok(exists === list && list === 20, tag + '二十行各有一个改动按钮');
    const label = await page.locator(card + ' [data-diff]').evaluateAll(xs => xs.find(x => x.dataset.diff.endsWith('/app.js'))?.getAttribute('aria-label') || '');
    ok(label === (lang === 'en' ? 'Show changes' : '看改动') + ' app.js', tag + '按钮读屏名字带文件名', label);
    ok(await page.locator(card + ' a [data-diff]').count() === 0 && exists > 0, tag + '按钮是文件链接的兄弟，不嵌在链接里');
    if (listNo) { const base = process.env.DF_BASE === '1', no = base ? (lang === 'zh' ? '01' : '04') : listNo;
      await shots(page, no + '-' + (base ? '改前' : '改后') + '-' + (lang === 'zh' ? '中文' : '英文') + '-' + (scheme === 'dark' ? '深色' : '浅色') + '-清单展开.png'); }
    const click = async path => { const btn = page.locator(card + ' [data-diff]').filter({ hasText: '±' });
      await btn.evaluateAll((xs, p) => xs.find(x => x.dataset.diff === p)?.click(), path); await sleep(400); };
    const close = async () => { if (await page.locator('#preview').evaluate(x => x.open)) { await page.keyboard.press('Escape'); await sleep(120); } };
    if (lang === 'zh' && scheme === 'dark') {
      await page.locator(card + ' .file').filter({ hasText: 'app.js' }).click(); await sleep(400);
      ok(await page.locator('#preview').evaluate(x => x.open) && await page.locator('#pBody').getAttribute('data-kind') === 'text' && (await page.locator('#pText').textContent()).includes('// file preview'), tag + '点文件名照旧打开文件预览'); await close();
    }
    await click(app);
    const opened = await page.locator('#preview').evaluate(x => x.open);
    ok(opened && await page.locator('#pTitle').textContent() === 'app.js' && await page.locator('#pDir').textContent() === (lang === 'en' ? 'Changes this turn' : '这一轮的改动'), tag + '弹层标题写文件和这一轮');
    ok(await page.locator('#pText .dfchange').count() === 3, tag + '同一文件三笔各一块');
    const heads = await page.locator('#pText .dfhead').allTextContents();
    ok(heads.length === 3 && heads.every((h, i) => new RegExp('^' + (lang === 'en' ? 'Change ' + (i + 1) : '第 ' + (i + 1) + ' 笔') + ' · Edit · \\d{2}:\\d{2}$').test(h)), tag + '块头的笔数、工具和本地时间正确', heads.join('|'));
    ok(await page.locator('#pText .add').count() === 3 && await page.locator('#pText .del').count() === 3, tag + '三条加行和三条删行');
    const color = await page.evaluate(() => {
      const out = {}, palette = document.createElement('div'); palette.style.background = 'var(--bg)'; palette.style.color = 'var(--text)'; document.body.append(palette);
      const surface = document.querySelector('#pBody'), ink = document.querySelector('#pText .dfline>span:last-child');
      out.surface = surface?.dataset.kind === 'diff' && getComputedStyle(surface).backgroundColor === getComputedStyle(palette).backgroundColor;
      out.ink = !!ink && getComputedStyle(ink).color === getComputedStyle(palette).color; palette.remove();
      for (const k of ['add', 'del']) { const e = document.querySelector('#pText .' + k), probe = document.createElement('div'); probe.style.background = 'var(--diff-' + k + ')'; document.body.append(probe);
        out[k] = !!e && getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'; probe.remove(); } return out;
    });
    ok(color.add && color.del, tag + '加删行的底色来自主题 token', JSON.stringify(color));
    ok(color.surface && color.ink, tag + '正文画布和字色都来自主题，深色不落入网页白底', JSON.stringify(color));
    const body = await page.locator('#pText').textContent();
    ok(body.includes('<img src=x onerror=alert(1)>') && await page.locator('#preview img:not(#pImg)').count() === 0 && dialogs.length === 0, tag + '记录中的标签只显示成字，不生成图片或执行');
    ok(body.includes(lang === 'en' ? 'Writes made from Bash are not shown here' : 'Bash 里的写这里看不到'), tag + '说明命令写入的缺口');
    ok(await page.locator('#pDock').evaluate(x => !x.hidden) && await page.locator('#pDock textarea').count() === 1 && (await page.locator('#pDock .dto').textContent()).includes('w-askCond') && await page.locator('#pDock').getAttribute('data-sid') === sid, tag + '回话框属于来源卡片并进入底栏');
    ok(await page.locator('#pOpen').evaluate(x => x.hidden) && await page.locator('#pReload').evaluate(x => x.hidden), tag + '收起文件专用的顶栏动作');
    if (viewNo && process.env.DF_BASE !== '1') await shots(page, viewNo + '-改后-' + (lang === 'zh' ? '中文' : '英文') + '-' + (scheme === 'dark' ? '深色' : '浅色') + '-看改动.png');
    if (lang === 'zh' && scheme === 'dark') {
      await close();
      ok((await page.locator('#pText').textContent()) === '' && await page.locator('#pText .dfchange').count() === 0, tag + '关闭以后清空改动内容');
      await click(fresh);
      ok(await page.locator('#pText .dfchange').count() === 1 && (await page.locator('#pText .dfhead').textContent() || '').includes('新建') && await page.locator('#pText .add').count() === 2 && await page.locator('#pText .del').count() === 0, tag + '新建文件一块、两条加行并写明新建');
      await close();
      await page.locator(card + ' .file').filter({ hasText: 'app.js' }).click(); await sleep(300);
      ok(await page.locator('#pOpen').evaluate(x => !x.hidden) && await page.locator('#pReload').evaluate(x => !x.hidden) && await page.locator('#pBody').getAttribute('data-kind') === 'text', tag + '再开普通预览时顶栏动作恢复'); await close();
      const routePattern = '**/api/diff**';
      for (const [code, text] of [[404, '这个文件不在这一轮的清单里了（新的一轮已经开始）'], [403, '这台设备上看不了改动'], [500, '没读到改动']]) {
        await page.route(routePattern, route => route.fulfill({ status: code, json: { ok: false } })); await click(app);
        ok((await page.locator('#pText').textContent()).includes(text), tag + '接住状态码 ' + code); await close(); await page.unroute(routePattern);
      }
      await page.route(routePattern, route => route.fulfill({ json: { ok: true, items: [], truncated: true } })); await click(app);
      const empty = await page.locator('#pText').textContent();
      ok(empty.includes('这一轮的记录里没找到这个文件的改动') && empty.includes('太长了，只显示了前面一部分'), tag + '空记录和截断均说明原因'); await close(); await page.unroute(routePattern);
      await page.route(routePattern, async route => { const p = new URL(route.request().url()).searchParams.get('path'); await sleep(p === app ? 1000 : 20);
        await route.fulfill({ json: { ok: true, items: [{ at: new Date().toISOString(), tool: 'Write', create: true, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+' + (p === app ? 'late-old' : 'fresh-new')] }] }], truncated: false } }).catch(() => {}); });
      await click(app); await close(); await click(fresh); await sleep(1200);
      const late = await page.locator('#pText').textContent();
      ok(late.includes('fresh-new') && !late.includes('late-old'), tag + '晚到的旧应答不覆盖新开的文件'); await close(); await page.unroute(routePattern);
      await page.route('**/api/preview', async route => { await sleep(1000); await route.fulfill({ json: { ok: true, kind: 'text', name: 'old-file.txt', dir: '~/', text: 'old-file-response' } }).catch(() => {}); });
      await page.locator(card + ' .file').filter({ hasText: 'app.js' }).click(); await sleep(50); await click(fresh); await sleep(1200);
      ok(await page.locator('#pBody').getAttribute('data-kind') === 'diff' && await page.locator('#pTitle').textContent() === 'p22.html' && await page.locator('#pText .dfchange').count() === 1, tag + '晚到的普通文件预览也不能盖住新改动');
      await close(); await page.unroute('**/api/preview');
    }
    if (lang === 'en') ok(!/[\u3400-\u9fff]/.test(await page.locator('#pDir').textContent()) && !/[\u3400-\u9fff]/.test(body) && body.includes('Change 1'), tag + '新增文案没有漏翻');
    ok(errs.length === 0, tag + '没有控制台错误或页面异常', errs.join('|'));
    await ctx.close();
  }
}

try {
  if (process.env.UI_ONLY === 'diff') { await diffSeg(); console.log('\n（UI_ONLY=diff：只跑逐笔改动，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'eta') { await etaSeg(); console.log('\n（UI_ONLY=eta：只跑了「预计交付」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'undo') { await undoSeg(); console.log('\n（UI_ONLY=undo：只跑了「撤销、↑ 取回上一句」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'gbal') { await geminiChipSeg(); console.log('\n（UI_ONLY=gbal：只跑了「顶栏 · Gemini API 余额」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'limits') { await topbarLimitsSeg(); console.log('\n（UI_ONLY=limits：只跑了原有顶栏额度断言，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'strip') { await wallStripSeg(); console.log('\n（UI_ONLY=strip：只跑了「墙上降噪」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'jump') { await draftJumpSeg(); console.log('\n（UI_ONLY=jump：只跑了「草稿不丢 · ⌘K 跳到窗口」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'codemode') { await cmCheck(); console.log('\n（UI_ONLY=codemode：只跑了「Code Mode」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'update') { await updateSeg(); console.log('\n（UI_ONLY=update：只跑了「检查新版本」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'remote') { await remoteCheck(); console.log('\n（UI_ONLY=remote：只跑了「手机远程」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'rpreview') { await remotePreviewCheck(); console.log('\n（UI_ONLY=rpreview：只跑了「远程预览」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'procsync') { await procSyncCheck(); console.log('\n（UI_ONLY=procsync：只跑了「审完了 · 跨设备」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'snooze') { await snoozeCheck(); console.log('\n（UI_ONLY=snooze：只跑了「先放着带时间」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'delta') { await deltaCheck(); console.log('\n（UI_ONLY=delta：只跑了「只回变过的」这一段，不是整套）'); throw ONLY_DONE; }
  if (process.env.UI_ONLY === 'orgmap') { await orgMapCheck(); console.log('\n（UI_ONLY=orgmap：只跑了「架构 · 放射」这一段，不是整套）'); throw ONLY_DONE; }
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
  await draftJumpSeg();          // 草稿不丢、⌘K 跳到窗口
  await undoSeg();               // 撤销、↑ 取回上一句
  await wallStripSeg();          // 新段单独开窄条；老的段继续沿用 ccb_strip='off'
  await etaSeg();                // 预计交付（11/18）
  await dockCheck();      // 弹层里回话（预览、放大看时也能回话）：见上面 dockCheck()
  // ── 新任务：模型是下拉菜单，已经记着 fable 时也能换成别的（11/12 作者：「怎么只有 Fable？我要 Opus」）──
  for (const saved of ['fable', 'claude-opus-5-5']) {
    const c2 = await browser.newContext({ viewport: { width: 1520, height: 900 }, colorScheme: 'dark' });
    // account: 'good' = 旧版界面记下的号（那时选过一次就一直记着）；新界面载入时要把它清掉
    await c2.addInitScript((m) => { try { localStorage.setItem('ccb_new', JSON.stringify({ provider: 'claude', model: { claude: m }, effort: { claude: 'max' }, account: 'good' })); } catch (e) {} }, saved);
    const pg = await c2.newPage(); let sent = null, fbResp = null;
    await pg.route('**/api/new', async (route) => { sent = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fbResp || { ok: true, name: 'ccb-test00' }) }); });   // 拦在浏览器里，不真的开会话
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
      const ac0 = await pg.evaluate(() => ({ v: document.querySelector('#nAcct').value, kept: JSON.parse(localStorage.getItem('ccb_new') || '{}') }));
      ok(ac0.v === '' && !('account' in ac0.kept) && ac0.kept.model && ac0.kept.model.claude === 'fable', '新任务（11/22）：旧版记着的号（good）不再带上，打开就是「默认」；存的那份把账号清掉、模型照留', JSON.stringify(ac0));
      const acD = await ev(pg, () => { const c = last.providers.claude, keep = c.defaultAccount; c.defaultAccount = 'good'; fillNew(); const t = document.querySelector('#nAcct').options[0].textContent; c.defaultAccount = keep; fillNew(); return t; });
      ok(acD === '默认（旧号）', '新任务：config 设了 defaultAccount，「默认」那一项写那个号的名字，不再写当前登录的号', JSON.stringify(acD));
      await pg.selectOption('#nModel', 'opus'); await pg.selectOption('#nAcct', 'good'); await pg.fill('#nPrompt', '测试'); await pg.click('#nGo'); await sleep(600);
      ok(sent && sent.account === 'good', '新任务：选了「旧号」，发给服务的 account 是 good', JSON.stringify(sent));
      ok(sent && sent.model === 'opus' && sent.provider === 'claude' && sent.effort === 'max' && sent.prompt === '测试', '新任务：选 Opus 再开工，发给服务的就是 opus', JSON.stringify(sent));
      ok(sent && sent.cwd === '~', '新任务：不带你选的文件夹，一律开在主目录', JSON.stringify(sent));
      const keptPick = await pg.evaluate(() => JSON.parse(localStorage.getItem('ccb_new')));
      ok(keptPick.model.claude === 'opus' && !('account' in keptPick), '新任务：下次打开还记着 Opus，不记选的号（旧版选过一次就一直记着）', JSON.stringify(keptPick));
      await pg.click('#newBtn'); await sleep(400);
      const ac2 = await pg.evaluate(() => document.querySelector('#nAcct').value);
      ok(ac2 === '', '新任务：上一次选了「旧号」，再打开弹窗账号回到「默认」', JSON.stringify(ac2));
      fbResp = { ok: true, name: 'ccb-test01', account: 'good', codeMode: false, fallback: { from: 'none', key: 'week', used: 96 } };
      await pg.fill('#nPrompt', '默认号到顶'); await pg.click('#nGo'); await sleep(600);
      const fbT = await pg.evaluate(() => ({ on: document.querySelector('#toast').classList.contains('on'), t: document.querySelector('#toast span').textContent }));
      ok(sent && sent.account === '' && fbT.on && fbT.t === '还没存 token 的号周额度用了 96%，这个任务开在了旧号', '新任务：没选号（默认）；服务说默认号到顶、退回了别的号，提示条写明哪个号用了多少、开在了哪个号', JSON.stringify({ sent: sent && sent.account, fbT }));
      fbResp = null; sent = null; await pg.evaluate(() => window.ccbBlank()); await sleep(500);
      ok(sent && sent.prompt === '' && sent.account === '', '⌘T 开空会话：不带账号，走默认（服务按默认号、到顶才退回）', JSON.stringify(sent));
      const fbEn = await pg.evaluate(() => ['主号周额度用了 96%，这个任务开在了朋友号', '主号 5 小时额度用了 97%，这个任务开在了朋友号'].map((s) => { const r = RULES.find(([re]) => re.test(s)); return r ? s.replace(r[0], r[1]) : null; }));
      ok(fbEn[0] === '主号 is at 96% of its weekly limit, so this task opened on 朋友号' && fbEn[1] === '主号 is at 97% of its 5-hour limit, so this task opened on 朋友号', '退回的提示有英文（周、5 小时两种）', JSON.stringify(fbEn));
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
  await topbarLimitsSeg();        // 原有额度断言原样保留，另可 UI_ONLY=limits 定点复核
  await geminiChipSeg();         // Gemini API 余额那一格；UI_ONLY=gbal 单跑
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
    await page.route('**/api/state*', unplaceRoute);      // 这一块测「你直接带」的画法（见 unplace），按项目挂上的在后面单独一块
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
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = unplace(await r.json());
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
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = unplace(await r.json()); const N = j.org && j.org.nodes;
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
      await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = unplace(await r.json()); const N = j.org && j.org.nodes;
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
  {   // 分支负责人之间的先后（11/17 win-49）：「X负责人」排在「…分支」前面，不跟着状态挪。夹具里三个都改成分支、挂在 peerDone 下面：
      // hint「字体与排版分支」（在跑）、unfin「录音与混音分支交接」（要你动手）、links「FretFlow 推广负责人」（歇着）。按状态排 links 会落到第三
    const c = await browser.newContext({ viewport: { width: 1520, height: 1000 }, colorScheme: 'dark' });
    await c.addInitScript(() => { try { localStorage.setItem('ccb_mode', JSON.stringify('org')); } catch (e) {} });
    const pg = await c.newPage(); const ee = []; pg.on('pageerror', (e) => ee.push(String(e)));
    await pg.route('**/api/state*', async (route) => { const r = await fullState(route); const j = unplace(await r.json()); const N = j.org && j.org.nodes;
      for (const [n, t] of [['hint', '字体与排版分支'], ['unfin', '录音与混音分支交接'], ['links', 'FretFlow 推广负责人']]) {
        if (N && N[FX.sids[n]]) Object.assign(N[FX.sids[n]], { role: 'head', boss: FX.sids.peerDone, via: 'seat', n: 0, last: 0, handed: false });
        const x = (j.sessions || []).find((y) => y.sid === FX.sids[n]); if (x) x.title = t;
      }
      await route.fulfill({ response: r, json: j }); });
    await pg.goto(FX.url + '&lang=zh'); await pg.waitForSelector('#org .onode .ot', { timeout: 8000 }).catch(() => {}); await sleep(2800);
    const g1 = await orgOf(pg); await sleep(2600); const g2 = await orgOf(pg);
    const k1 = ((g1.nodes || {}).peerDone || { kids: [] }).kids, k2 = ((g2.nodes || {}).peerDone || { kids: [] }).kids;
    ok(k1[0] === 'links' && k1.indexOf('unfin') > 0 && k1.indexOf('hint') > 0 && k1.indexOf('unfin') < 3 && k1.indexOf('hint') < 3 && JSON.stringify(k1) === JSON.stringify(k2),
      '架构：几个分支负责人里，「FretFlow 推广负责人」（X负责人，歇着）排在「…分支」（在跑的、要你动手的）前面，三个分支都在普通窗口前面，隔两次轮询顺序不变（11/17 win-49）', JSON.stringify({ k1, k2 }));
    ok(ee.length === 0, '架构：分支先后这一块页面没有报错', ee.join(' | ')); await c.close();
  }
  {   // 按项目挂上（11/17 作者：「如果我自己新建一个任务……不能说是我直接带的，要归类到它在这个架构里面的位置」）。用服务的真实输出，不改 /api/state：
      // 夹具里「其他」列的负责人是 peerDone、FretFlow 列没有负责人，总管 projC 在总控台列；原来 23 个「你直接带」现在其他列的挂到 peerDone 下面、projF 进 FretFlow 列的「总管带」。
      // 期望值从 /api/state 原始数据另数，不读界面自己的模型
    for (const lang of ['zh', 'en']) {
      ({ ctx, page, errs } = await open({ mode: 'org', lang }));
      const g = await orgOf(page);
      const j = await tryEval(page, () => api('/api/state?peek=1')), N = (j.org && j.org.nodes) || {}, ch = j.org && j.org.chief, name = Object.fromEntries(Object.entries(FX.sids).map(([k, v]) => [v, k]));
      const placed = Object.entries(N).filter(([, x]) => x.via === 'dept'), direct = Object.values(N).filter((x) => !x.boss).length, led = Object.values(N).filter((x) => x.boss && x.via !== 'dept').length;
      const toLead = placed.filter(([, x]) => x.boss === FX.sids.peerDone).map(([k]) => name[k] || k), toChief = placed.filter(([, x]) => x.boss === ch).map(([k]) => name[k] || k);
      const pd = g.nodes.peerDone || { kids: [] }, pf = g.nodes.projF || {}, lk = g.nodes.links || {};
      const youLabs = (g.cols || []).flatMap((c) => c.labs.filter((l) => /^(你直接带|Directly under you) · \d+$/.test(l)));
      if (lang === 'zh') {
        ok(placed.length === 22 && direct === 1 && led === 7 && toLead.length === 21 && JSON.stringify(toChief) === '["projF"]' && youLabs.length === 0 && (N[FX.sids.run] || {}).via === 'contact',
          '架构 · 按项目挂上：原来没人管的 23 个都挂上了（run 收过负责人 1 条，挂到 peerDone 走 via contact、算「有窗口在带」；其余 22 个按项目：其他列 21 个到负责人 peerDone、FretFlow 的 projF 到总管），哪一列都不再有「你直接带」', JSON.stringify({ placed: placed.length, direct, led, toLead: toLead.length, toChief, youLabs }));
        const bk = await bucketsOf(page), raw = await rawOrg(page), wantKids = sortWant(pd.kids, bk, raw), nUnder = Object.values(N).filter((x) => x.boss === FX.sids.peerDone).length;
        ok(pd.kids.length === nUnder && nUnder === 26 && pd.br === '带 26 个' && toLead.every((n) => (g.nodes[n] || {}).parent === 'peerDone') && JSON.stringify(pd.kids) === JSON.stringify(wantKids) && pd.kids[pd.kids.length - 1] === 'askQ',
          '架构 · 按项目挂上：它们画在负责人 peerDone 的树里（带 26 个），和原来的下级一起按状态排、前任 askQ 仍在最后', JSON.stringify({ br: pd.br, n: pd.kids.length, kids: pd.kids, wantKids }));
        const fc = (g.cols || []).find((c) => c.key === 'fretflow') || { kids: {}, labs: [] };
        ok(pf.grp === 'chief' && JSON.stringify(fc.kids.chief) === '["projF"]' && fc.labs.includes('总管带 · 1'), '架构 · 按项目挂上：没有负责人的 FretFlow 列，projF 进「总管带 · 1」', JSON.stringify({ grp: pf.grp, labs: fc.labs }));
        ok(g.youLine2 === direct + ' 个你直接带 · ' + led + ' 个有窗口在带 · ' + placed.length + ' 个按项目挂上', '架构 · 按项目挂上：「你」第二行分三个数：你直接带（总管）· 有窗口在带 · 按项目挂上，加起来是窗口数', JSON.stringify({ l2: g.youLine2, direct, led, placed: placed.length }));
      }
      const tips = {}; for (const n of ['links', 'projF', 'run']) { const h = await hoverTip(page, FX.sids[n]); tips[n] = h && h.tip; }
      const hl = await hoverTip(page, FX.sids.links), hot = hl && Object.entries(hl.nodes).filter(([, x]) => x.hot).map(([k]) => k).sort().join();
      await page.mouse.move(5, 300); await sleep(200);
      const want = lang === 'zh' ? ['没有窗口在管它，按项目挂在 win-p2 下面', '没有窗口在管它，按项目挂在总管下面'] : ['No window manages it; placed under win-p2 by project', 'No window manages it; placed under the chief by project'];
      ok(tips.links === want[0] && tips.projF === want[1], lang + ' 架构 · 按项目挂上：悬停依据照实写「没有窗口在管它，按项目挂在 X 下面」（挂到总管的写总管）', JSON.stringify(tips));
      const wantRun = lang === 'zh' ? /^win-p2 给它发过 1 条消息（最近一条 (?:.+前|刚刚)），挂在它下面$/ : /^win-p2 sent it 1 message \(the latest (?:.+ ago|just now)\), so it sits under win-p2$/;
      ok(wantRun.test(tips.run || ''), lang + ' 架构 · 负责人发过消息的（via contact，11/17 win-49）：悬停写「win-p2 给它发过 1 条消息（最近一条 …），挂在它下面」，条数照服务给的 n', JSON.stringify(tips.run));
      ok(lk.parent === 'peerDone' && hot === 'links,peerDone,projC' && hl.youHot && hl.trunkHot.every(Boolean), lang + ' 架构 · 按项目挂上：悬停 links，它、负责人、总管和「你」这一串加重（经过总管那条线，不再是「你直接带」）', JSON.stringify({ parent: lk.parent, hot }));
      if (lang === 'en') ok(g.youLine2 === direct + ' directly under you · ' + led + ' led by a window · ' + placed.length + ' placed by project', 'en 架构 · 按项目挂上：「你」第二行是英文', g.youLine2);
      await page.screenshot({ path: path.join(OUT, 'org-placed-' + lang + '.png') });
      ok(errs.length === 0, lang + ' 架构 · 按项目挂上：页面没有报错', errs.join(' | ')); await ctx.close();
    }
  }
  {   // 英文界面：新加的字都有英文
    ({ ctx, page, errs } = await open({ mode: 'org', lang: 'en', unplaced: true })); const g = await orgOf(page);
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
    ({ ctx, page, errs } = await open({ mode: 'org', w: 420, h: 900, unplaced: true })); const g = await orgOf(page);
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
  await orgMapCheck();      // 架构 · 放射（11/17 win-e7）：同一份 org 换成你在圆心的摆法，见上面 orgMapCheck()

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
  await cmCheck();         // Code Mode：新任务的开关、卡片上的「Code」（只在浏览器里拦 /api/new，不真开会话）
  await snoozeCheck();     // 先放着带时间（会在服务里记推迟，段末清掉）
  await procSyncCheck();  // 审完了 · 跨设备（两个浏览器上下文共用夹具服务；段末清掉服务里那一笔）
  await remoteCheck();
  await remotePreviewCheck();   // 远程预览（C1 / C1.1）：远程模式里点路径、/rp/ 取文件、图集、拒绝只提示
  await updateSeg();
  await diffSeg();
  await deltaCheck();      // 只回变过的（拉数据瘦身）：会真的归档一个夹具会话，所以放在最后
} catch (e) { if (e !== ONLY_DONE) throw e; } finally { await browser.close(); }
console.log(`\n界面结果：${pass} 过，${fail} 没过；截图在 ${OUT}`);
process.exit(fail ? 1 : 0);
