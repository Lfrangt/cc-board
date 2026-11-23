// 公开安装包检查新版本、自动下载（11/22 Khalil：「已经装了的用户不会自动更新……有新 release 就在界面上提示，点一下就能下 dmg」
// 「就跟 Codex 一样……我也可以开一个选项，默认就是最新版本自动下载」）。
// 只对公开 dmg 装的生效（数据目录 app/.bundle-version 里有版本号）；build.sh 装的不查。
// 查法：GET <仓库>/releases/latest 不跟跳转，读 Location 里的 tag（不走 GitHub API，没有每小时 60 次的限流），一天一次。
// 只连 github.com（下载时跟跳转到它的文件服务器），不带任何使用数据。config：updateCheck=false 完全不连；autoUpdate=false 只提示不下载。
// 下载：先取同一个 tag 的 cc-board.dmg.sha256，再下 dmg、核 sha256，写进 <数据目录>/updates/cc-board-<版本>.dmg（先写 .part 再改名），旧的删掉。
// 大小：.sha256 最多 1 KB、dmg 最多 MAX_DMG；有 content-length 先看它，没有就边读边数，超了马上中止（不先整份读进内存）。
// 连网用 node:http / node:https（httpGet），不用全局 fetch（11/22 dlfix）：0.3.9 真起时假 GitHub（HTTP/1.0 发完就关）配稍慢的写盘，
// fetch 底下的 undici 在 socket 'end' 的回调里 assert(!this.paused) 抛出来，那是事件回调里的异常，外面的 try/catch 接不住，服务整个退出。
// 跳转自己跟：只跟到 https（或和起点同一个 origin：测试的假服务器是 http）、最多 HOPS 次。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const REPO_URL = 'https://github.com/Lfrangt/cc-board';
const DAY = 86400000, RETRY = 6 * 3600000, TIMEOUT = 15000, DL_TIMEOUT = 10 * 60000, MAX_DMG = 200 * 1024 * 1024, MAX_SHA = 1024, HOPS = 5;
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;      // tagFromLocation 给出来的样子；update.json 读回来的 latest 也要是这个样子才用

// 「v0.3.7」「0.3.7 (12)」「0.3.7」→ [0, 3, 7]；认不出 → null
export function parseVer(s) {
  const m = /^\s*v?(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?:\s|$|\s*\()/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function newer(a, b) {             // a 比 b 新？认不出的一律不算新（宁可不提示，也不乱提示）
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
// 跳转地址 …/releases/tag/v0.3.7 → '0.3.7'；别的地址（没有 release 时跳回 /releases）→ null
export function tagFromLocation(loc) {
  const m = /\/releases\/tag\/v?(\d{1,4}\.\d{1,4}\.\d{1,6})\/?$/.exec(String(loc ?? ''));
  return m ? m[1] : null;
}
// .sha256 文件的第一段 64 位十六进制
export function shaFromFile(text) {
  const m = /^\s*([0-9a-f]{64})\b/i.exec(String(text ?? ''));
  return m ? m[1].toLowerCase() : null;
}
// config 的两个键：不写 = 开；写了不是布尔就抛（和 autoTrust 这些键一样：整份 config 不用）
export function parseUpdateConf(c = {}) {
  for (const k of ['updateCheck', 'autoUpdate']) if (k in c && typeof c[k] !== 'boolean') throw new Error(k + ' 要是 true 或 false');
  return { check: c.updateCheck !== false, auto: c.updateCheck !== false && c.autoUpdate !== false };
}
// 给界面的那一份：没有更新的版本就是 null（/api/state 里不出现）
export function updateView(current, st, base = REPO_URL) {
  if (!st || !newer(st.latest, current)) return null;
  const ready = !!(st.file && st.fileVer === st.latest);
  return { current: String(parseVer(current).join('.')), latest: st.latest, ready, page: base + '/releases/tag/v' + st.latest, dmg: base + '/releases/download/v' + st.latest + '/cc-board.dmg' };
}

// 发一个 GET，回最后那个响应（IncomingMessage，正文没读）。follow：最多跟几次跳转（0 = 不跟，给读 Location 的用）。
// timeout：从发出到正文读完的总时限，到点把连接断掉，读正文的一方拿到错误。
// 出错只有两种去处：还没拿到响应 → reject；拿到以后 → 正文流报错（读它的 for await 抛出来）。请求和响应上都常挂着 'error' 的监听，
// 不会有没人接的 'error' 事件（node:http 的请求对象没人听 'error' 时会直接抛成进程级异常）。
// 背压：读的一方慢，node:http 停读 socket（readStop），对面先关了也要等读的一方追上才看到；不会像 undici 那样在暂停中收到结束而 assert。
export function httpGet(url, { follow = 0, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let req = null, res = null, done = false, hops = 0, origin = null;
    const settle = (e) => { if (done) return; done = true; clearTimeout(timer); reject(e); };
    const kill = (e) => { const r = res, q = req; settle(e); if (r) r.destroy(e); if (q) q.destroy(e); };
    const timer = setTimeout(() => kill(new Error('超时（' + Math.round(timeout / 1000) + ' 秒没收完）')), timeout);
    const go = (u) => {
      let U; try { U = new URL(u); } catch { return kill(new Error('网址不对：' + String(u).slice(0, 80))); }
      const lib = U.protocol === 'https:' ? https : U.protocol === 'http:' ? http : null;
      if (!lib) return kill(new Error('不连 ' + U.protocol + ' 的地址'));
      if (origin === null) origin = U.origin;
      const q = lib.get(U, { agent: false, headers: { 'user-agent': 'node' } }, (r) => {
        r.on('error', () => {});                 // 正文的错误由读它的一方（for await）拿到；这里只保证「有人听」
        if (q !== req) return r.destroy();
        const loc = r.headers.location;
        if (follow && r.statusCode >= 300 && r.statusCode < 400 && loc) {
          r.destroy();
          if (++hops > follow) return kill(new Error('跳转太多（超过 ' + follow + ' 次）'));
          let next; try { next = new URL(loc, U); } catch { return kill(new Error('跳转地址不对')); }
          if (next.protocol !== 'https:' && next.origin !== origin) return kill(new Error('跳转去的不是 https（' + next.protocol + '//' + next.host + '）'));
          return go(next.href);
        }
        res = r;
        r.once('close', () => clearTimeout(timer));
        if (!done) { done = true; resolve(r); }
      });
      req = q;
      q.on('error', (e) => { if (q === req) kill(e); });
    };
    go(url);
  });
}

// 一块一块读响应正文，交给 fn，最多 max 字节：content-length 超了直接不读；没有（或说谎）就边读边数，超了中止连接。回读到的字节数
// 对面没发够 content-length 就关了：node:http 把它当成 aborted，for await 抛出来；另外再核一次 complete
async function eachChunk(res, max, what, fn) {
  const len = res.headers['content-length'];
  if (len !== undefined && Number(len) > max) { res.destroy(); throw new Error(what + ' 太大（content-length ' + len + '，上限 ' + max + ' 字节）'); }
  let n = 0;
  try {
    for await (const value of res) {
      n += value.length;
      if (n > max) throw new Error(what + ' 太大（读到 ' + n + ' 字节还没完，上限 ' + max + '，已中止）');
      await fn(value);
    }
  } catch (e) { res.destroy(); throw e && e.message === 'aborted' ? new Error(what + ' 没收完（读到 ' + n + ' 字节对面就断了）') : e; }
  if (!res.complete) throw new Error(what + ' 没收完（读到 ' + n + ' 字节对面就断了）');
  return n;
}
const okStatus = (r) => r.statusCode >= 200 && r.statusCode < 300;

export function createUpdater({ current, dir, conf, base = REPO_URL, getImpl = httpGet, now = Date.now, log = () => {}, maxDmg = MAX_DMG, dlTimeout = DL_TIMEOUT }) {
  const file = path.join(dir, 'update.json'), udir = path.join(dir, 'updates');
  let st = { checkedAt: 0, latest: null, file: null, fileVer: null, triedAt: 0, error: null };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (st.file && !fs.existsSync(st.file)) { st.file = null; st.fileVer = null; }     // 用户自己删了
  if (!(typeof st.latest === 'string' && VER_RE.test(st.latest))) st.latest = null;   // 读回来的先核：它要进网址和 path.join（只有本机能改这个文件，也不信）
  let busy = false;
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st) + '\n'); fs.renameSync(file + '.tmp', file); } catch (e) { log('update 写 update.json 失败：' + e.message); } };

  async function check() {
    st.checkedAt = now(); save();      // 发请求之前就记：断网、超时、对方出错也算这一天问过了（一天最多问一次）；点「检查更新」（force）不看它
    const r = await getImpl(base + '/releases/latest', { follow: 0, timeout: TIMEOUT });
    r.destroy();                       // 只要状态和 Location，正文不读
    const tag = r.statusCode >= 300 && r.statusCode < 400 ? tagFromLocation(r.headers.location) : null;
    if (tag) { st.latest = tag; st.error = null; } else st.error = 'no-tag ' + r.statusCode;
    save();
    log(`update 查了：最新 ${tag || '（没认出，' + r.statusCode + '）'}，本机 ${current}`);
  }

  async function download() {
    const v = st.latest, u = base + '/releases/download/v' + v + '/cc-board.dmg';
    st.triedAt = now(); save();
    // 两个请求都跟跳转（GitHub 跳到它的文件服务器）：只跟到 https、最多 HOPS 次；跳到哪个主机不限：靠 TLS 和下面的 sha256 兜底
    const rs = await getImpl(u + '.sha256', { follow: HOPS, timeout: TIMEOUT });
    let want = null;
    if (okStatus(rs)) { const parts = []; await eachChunk(rs, MAX_SHA, 'sha256 文件', (c) => { parts.push(c); }); want = shaFromFile(Buffer.concat(parts).toString('utf8')); }
    else rs.destroy();
    if (!want) throw new Error('取不到 sha256（' + rs.statusCode + '）');
    const rd = await getImpl(u, { follow: HOPS, timeout: dlTimeout });
    if (!okStatus(rd)) { rd.destroy(); throw new Error('下载 dmg 失败（' + rd.statusCode + '）'); }
    fs.mkdirSync(udir, { recursive: true });
    const out = path.join(udir, 'cc-board-' + v + '.dmg'), part = out + '.part';
    const h = crypto.createHash('sha256'), fh = await fs.promises.open(part, 'w');
    let size;
    try { size = await eachChunk(rd, maxDmg, 'dmg', async (c) => { h.update(c); await fh.write(c); }); }
    catch (e) { await fh.close().catch(() => {}); fs.rmSync(part, { force: true }); throw e; }
    await fh.close();
    const got = h.digest('hex');
    if (got !== want) { fs.rmSync(part, { force: true }); throw new Error('sha256 对不上（' + got.slice(0, 12) + ' ≠ ' + want.slice(0, 12) + '）'); }
    fs.renameSync(part, out);
    for (const f of fs.readdirSync(udir)) if (f !== path.basename(out)) try { fs.unlinkSync(path.join(udir, f)); } catch {}
    st.file = out; st.fileVer = v; st.error = null; save();
    log(`update 下好了 ${v}：${out}（${size} 字节，sha256 核过）`);
  }

  // 每小时叫一次：一天没查过就查；有更新、开着自动下载、还没下好、离上次失败满 6 小时就下
  // force（点了「检查更新」）：马上查，失败过的也马上再下一次
  async function tick(force = false) {
    if (busy || !conf.check) return;
    busy = true;
    try {
      if (force || now() - st.checkedAt >= DAY) await check();
      if (conf.auto && newer(st.latest, current) && st.fileVer !== st.latest && (force || now() - st.triedAt >= RETRY)) await download();
    } catch (e) { st.error = String(e && e.message || e).slice(0, 200); save(); log('update 没成功：' + st.error); }
    finally { busy = false; }
  }
  return { tick, view: () => updateView(current, st, base), state: () => ({ ...st }) };
}
