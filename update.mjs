// 公开安装包检查新版本、自动下载（11/22 Khalil：「已经装了的用户不会自动更新……有新 release 就在界面上提示，点一下就能下 dmg」
// 「就跟 Codex 一样……我也可以开一个选项，默认就是最新版本自动下载」）。
// 只对公开 dmg 装的生效（数据目录 app/.bundle-version 里有版本号）；build.sh 装的不查。
// 查法：GET <仓库>/releases/latest 不跟跳转，读 Location 里的 tag（不走 GitHub API，没有每小时 60 次的限流），一天一次。
// 只连 github.com（下载时跟跳转到它的文件服务器），不带任何使用数据。config：updateCheck=false 完全不连；autoUpdate=false 只提示不下载。
// 下载：先取同一个 tag 的 cc-board.dmg.sha256，再下 dmg、核 sha256，写进 <数据目录>/updates/cc-board-<版本>.dmg（先写 .part 再改名），旧的删掉。
// 大小：.sha256 最多 1 KB、dmg 最多 MAX_DMG；有 content-length 先看它，没有就边读边数，超了马上中止（不先整份读进内存）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const REPO_URL = 'https://github.com/Lfrangt/cc-board';
const DAY = 86400000, RETRY = 6 * 3600000, TIMEOUT = 15000, DL_TIMEOUT = 10 * 60000, MAX_DMG = 200 * 1024 * 1024, MAX_SHA = 1024;
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

// 一块一块读响应正文，交给 fn，最多 max 字节：content-length 超了直接不读；没有（或说谎）就边读边数，超了中止连接。回读到的字节数
async function eachChunk(res, max, what, fn) {
  const len = res.headers.get('content-length');
  if (len !== null && Number(len) > max) { try { await res.body?.cancel(); } catch {} throw new Error(what + ' 太大（content-length ' + len + '，上限 ' + max + ' 字节）'); }
  if (!res.body) return 0;
  const rd = res.body.getReader();
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await rd.read();
      if (done) return n;
      n += value.length;
      if (n > max) throw new Error(what + ' 太大（读到 ' + n + ' 字节还没完，上限 ' + max + '，已中止）');
      await fn(value);
    }
  } catch (e) { try { await rd.cancel(); } catch {} throw e; }
}

export function createUpdater({ current, dir, conf, base = REPO_URL, fetchImpl = globalThis.fetch, now = Date.now, log = () => {}, maxDmg = MAX_DMG }) {
  const file = path.join(dir, 'update.json'), udir = path.join(dir, 'updates');
  let st = { checkedAt: 0, latest: null, file: null, fileVer: null, triedAt: 0, error: null };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (st.file && !fs.existsSync(st.file)) { st.file = null; st.fileVer = null; }     // 用户自己删了
  if (!(typeof st.latest === 'string' && VER_RE.test(st.latest))) st.latest = null;   // 读回来的先核：它要进网址和 path.join（只有本机能改这个文件，也不信）
  let busy = false;
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st) + '\n'); fs.renameSync(file + '.tmp', file); } catch (e) { log('update 写 update.json 失败：' + e.message); } };

  async function check() {
    st.checkedAt = now(); save();      // 发请求之前就记：断网、超时、对方出错也算这一天问过了（一天最多问一次）；点「检查更新」（force）不看它
    const r = await fetchImpl(base + '/releases/latest', { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    const tag = r.status >= 300 && r.status < 400 ? tagFromLocation(r.headers.get('location')) : null;
    if (tag) { st.latest = tag; st.error = null; } else st.error = 'no-tag ' + r.status;
    save();
    log(`update 查了：最新 ${tag || '（没认出，' + r.status + '）'}，本机 ${current}`);
  }

  async function download() {
    const v = st.latest, u = base + '/releases/download/v' + v + '/cc-board.dmg';
    st.triedAt = now(); save();
    // 两个请求都跟跳转（GitHub 跳到它的文件服务器）；跳到哪个主机不限：靠 TLS 和下面的 sha256 兜底
    const rs = await fetchImpl(u + '.sha256', { signal: AbortSignal.timeout(TIMEOUT) });
    let want = null;
    if (rs.ok) { const parts = []; await eachChunk(rs, MAX_SHA, 'sha256 文件', (c) => { parts.push(c); }); want = shaFromFile(Buffer.concat(parts).toString('utf8')); }
    else try { await rs.body?.cancel(); } catch {}
    if (!want) throw new Error('取不到 sha256（' + rs.status + '）');
    const rd = await fetchImpl(u, { signal: AbortSignal.timeout(DL_TIMEOUT) });
    if (!rd.ok) { try { await rd.body?.cancel(); } catch {} throw new Error('下载 dmg 失败（' + rd.status + '）'); }
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
