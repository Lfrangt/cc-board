/**
 * [INPUT]: 只用 node:crypto。服务传入 remote / apns 配置、设备表、请求头、通知类别和签名密钥对象。
 * [OUTPUT]: 导出远程准入与配对规则；APNs 配置、锁屏类别与签名规则；parseHidIdle()、pushWould() 和 PUSH_AWAY_MS 定空闲放行规则。
 *           远程预览（C1，11/21）：pathsIn()（照 ui.html inline() 从交付正文里抽本机路径）、hiddenPath()（真身里点开头的段）、rpKeyOk() / RP_TTL / RP_KEEP（/rp/ 钥匙网址认不认）。
 * [POS]: 手机远程（经 tailscale serve 进来，11/17 Khalil 14:13 要的最小版）的三道拦：从哪个端口来、认哪些 Host、远程能碰哪些接口、凭证对不对。
 *        这里只有规则，不起进程、不读写文件（读写设备表、记日志在 server.mjs），所以 test/remote.test.mjs 能直接断言。
 *        总控台的窗口都是 --dangerously-skip-permissions：能发话 = 能在这台机器上跑任意命令。所以每一道都是「认不出就拒」，没有落到放行的分支。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import crypto from 'node:crypto';

export const PAIR_MS = 10 * 60000;                           // 配对码 10 分钟过期（T3 的 connect-device 也是 10 分钟）
const LOCAL_HOST = /^(127\.0\.0\.1|localhost):\d+$/;          // 本机：和 11/17 之前那一行逐字相同
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const TS_HOST = new RegExp(`^(?=.{1,253}(?::|$))${LABEL}(?:\\.${LABEL})*\\.ts\\.net(?::\\d{1,5})?$`);   // 只认 tailscale serve 发证书的 *.ts.net（可带端口，--https=8443 那种）
const LOGIN = /^[^\s,\x00-\x1f\x7f]{1,200}$/;               // Tailscale-User-Login：邮箱或 名字@github；同名头出现两次 node 会用「, 」连起来，带逗号 / 空白的一律不认
const SECRET = /^[A-Za-z0-9_-]{43}$/;                        // 32 字节随机数的 base64url
const HEX64 = /^[0-9a-f]{64}$/;
const APNS_ID = /^[A-Z0-9]{10}$/;
const APNS_TOPIC = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PUSH_TOKEN = /^[0-9a-f]{64,200}$/;
export const PUSH_AWAY_MS = 120000;
export function parseHidIdle(text) {
  const match = typeof text === 'string' ? text.match(/"HIDIdleTime" = (\d+)(?=\s|$)/m) : null;
  const ms = match ? Math.floor(Number(match[1]) / 1e6) : NaN;
  return Number.isSafeInteger(ms) ? ms : null;
}
export function pushWould(focusAgoMs, idleMs) {
  return focusAgoMs >= 6000 || (idleMs != null && idleMs >= PUSH_AWAY_MS) ? 'sent' : 'ui';
}

// ───────────── APNs 规则：配置只给标识，载荷只取类别与会话号 ─────────────
export function parseApns(v) {
  const off = (why) => ({ on: false, why });
  if (v === undefined) return off('');
  if (!v || typeof v !== 'object' || Array.isArray(v)) return off('apns 要是对象');
  for (const k of ['keyId', 'teamId']) if (typeof v[k] !== 'string' || v[k].length !== 10 || !APNS_ID.test(v[k])) return off('apns.' + k + ' 要是 10 位大写字母数字');
  if (typeof v.topic !== 'string' || v.topic.length > 200 || !APNS_TOPIC.test(v.topic)) return off('apns.topic 要是 200 字以内的包标识');
  if (v.topic !== v.topic.trim()) return off('apns.topic 不能带空白');
  return { on: true, keyId: v.keyId, teamId: v.teamId, topic: v.topic, why: '' };
}
export const pushToken = (v) => typeof v === 'string' && PUSH_TOKEN.test(v) && v === v.trim();
export const pushEnv = (v) => v === 'sandbox' || v === 'production';
const validPush = (v) => v && pushToken(v.token) && pushEnv(v.env) && Number.isSafeInteger(v.at) && v.at >= 0;
export function pushPayload(items) {
  const keys = { __proto__: null, reply: 'PUSH_REPLY_ONE', ask: 'PUSH_ASK_ONE', crash: 'PUSH_CRASH' };
  const waits = items.filter((x) => x.kind === 'reply' || x.kind === 'ask').length;
  const key = items.length === 1 ? keys[items[0].kind] || 'PUSH_STOP_ONE' : waits === items.length ? 'PUSH_WAIT_MANY' : waits ? 'PUSH_MIXED_MANY' : 'PUSH_STOP_MANY';
  const alert = { 'loc-key': key, ...(items.length > 1 ? { 'loc-args': [String(items.length)] } : {}) };
  const sid = items.length === 1 && typeof items[0].sid === 'string' && /^[\w-]{8,64}$/.test(items[0].sid) && items[0].sid === items[0].sid.trim() ? items[0].sid : '';
  return { aps: { alert, sound: 'default', 'thread-id': 'cc-board' }, ...(sid ? { sid } : {}) };
}
export function apnsJwt(keyObject, keyId, teamId, nowSec) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = enc({ alg: 'ES256', kid: keyId }) + '.' + enc({ iss: teamId, iat: nowSec });
  return input + '.' + crypto.sign('sha256', Buffer.from(input), { key: keyObject, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
export function apnsVerdict(status, reason) {
  if (status === 200) return 'ok';
  if (status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'))) return 'drop';
  return 'err';
}

// ───────────── config.json 的 remote ─────────────
// { "on": true, "hosts": ["mini.tailXXXX.ts.net"] } 才算开。没有这个键、false、写错（类型不对、on 不是 true、任何一个名字不像 *.ts.net）一律关，
// 而且不抛：写错 remote 不能把整份 config（项目表、autoTrust……）连带作废，关着时别的行为要和没有这个键时逐字一样。
export function parseRemote(v) {
  const off = (why) => ({ on: false, hosts: [], why });
  if (v === undefined) return off('');
  if (v === false) return off('remote 是 false');
  if (!v || typeof v !== 'object' || Array.isArray(v)) return off('remote 要是 { "on": true, "hosts": [...] } 或 false');
  if (v.on !== true) return off('remote.on 不是 true');
  if (!Array.isArray(v.hosts) || v.hosts.length > 8) return off('remote.hosts 要是最多 8 个名字的数组');
  const hosts = [];
  for (const h of v.hosts) {
    const x = typeof h === 'string' ? h.trim().toLowerCase() : '';
    if (!TS_HOST.test(x)) return off('remote.hosts 里有不是 *.ts.net 的名字：' + String(h).slice(0, 80));
    if (!hosts.includes(x)) hosts.push(x);
  }
  return { on: true, hosts, why: hosts.length ? '' : 'remote.hosts 是空的：一个都不多认' };
}

// ───────────── 第一道：这个请求从哪来 ─────────────
// 返回 { kind: 'local' } | { kind: 'remote', host, login } | { deny }。h 是 node 的 req.headers（键已是小写），via 是请求进来的那个端口：'remote' 或别的（本机端口）。
// 两个端口分开认（11/17 晚，审查 M3 定的 B）：本机端口（4747）只认本机；remote 开着时服务另听 127.0.0.1:<端口+1>，tailscale serve 指向那里，
// 从那个端口进来的一律按远程认，不看它把 Host 写成什么。所以 remote 一关，那个端口就没人听：不靠人记得跑 tailscale serve reset。
// 本机端口上带任何代理头的请求一律拒（A）：serve 万一指错到 4747，也不能拿 Host: 127.0.0.1 + 口令当本机用。本机的界面、钩子、脚本都不发这些头。
// Host 是客户端自己写的，所以远程还要 tailscale serve 加的 Tailscale-User-Login（它先删掉客户端带来的同名头再加；Funnel 进来的公网请求、打了 tag 的设备没有这个头）。
export const proxied = (h) => Object.keys(h).some((k) => k.startsWith('tailscale-') || k.startsWith('x-forwarded-') || k === 'forwarded');
export function gate(h, R, method, via) {
  const host = String(h.host || '');
  if (via === 'local') return LOCAL_HOST.test(host) && !proxied(h) ? { kind: 'local' } : { deny: 'bad host' };
  if (via !== 'remote') return { deny: 'bad via' };                   // 调用方写错（没给 / 拼错）：拒，不落到哪一支
  if (!R || !R.on) return { deny: 'remote off' };
  const hn = host.toLowerCase();
  if (!R.hosts.includes(hn)) return { deny: 'bad host' };          // 远程端口上 Host 写成 127.0.0.1 的也在这里拒：这个端口不认本机
  const login = h['tailscale-user-login'];
  if (typeof login !== 'string' || !LOGIN.test(login)) return { deny: 'no tailscale login' };
  if (h.origin !== undefined && h.origin !== 'https://' + hn) return { deny: 'bad origin' };   // 带了 Origin 就必须是这个名字自己（别的网页借手机的浏览器发来的）
  if (method !== 'GET' && h.origin === undefined) return { deny: 'no origin' };                  // 浏览器发 POST 一定带 Origin；不带的不是总控台的页面
  return { kind: 'remote', host: hn, login };
}

// ───────────── 第二道：远程能碰哪些接口 ─────────────
// 只给看和说话：状态、对话、发话、答选择框、开新任务、知道了、审完了、归档。删除、打开 / 选中文件、聚焦、去终端、选文件框、
// 自动续跑、一起退出、上传、预览、接回、取消、配对管理本身……不在表里的一律拒。按「方法 + 路径」整串查，不做前缀匹配。
export const REMOTE_API = new Set(['GET /api/state', 'GET /api/turns', 'GET /api/archive',
  'POST /api/send', 'POST /api/answer', 'POST /api/new', 'POST /api/ack', 'POST /api/processed', 'POST /api/archive', 'POST /api/remote/push', 'POST /api/remote/preview']);
export const allowed = (method, pathname) => REMOTE_API.has(method + ' ' + pathname);

// ───────────── 远程预览（C1，11/21）：只给这个会话对话里出现过的文件 ─────────────
// 从交付正文里认出本机路径，规矩照 ui.html 的 inline()：反引号里整段是路径、[字](路径)、[字](file://…)、直接贴的 file://、直接写的 ~/… 和 /Users/<名>/…。
// 多认几个不要紧（都是交付里真写过的字），少认了手机上点得出来的链接会被拒；所以这里只会比界面宽、不会比它窄。
const PATH_RX = /(^|[\s(（「『【“:：，,*])((?:~|\/Users\/[^\/\s]+)\/[^\s<>"'`）」』】》，。、；！？*]*)/g;
const FILE_URL_RX = /file:\/\/(?:localhost)?\/[^\s<>"'`）」』】》，。、；！？*]+/g;
const CODE_PATH = /^(~\/|\/Users\/|\/private\/|\/tmp\/|\/Volumes\/)/;
const trimP = (p) => p.replace(/[.,;:!?)\]]+$/, '');
const fromUrl = (u) => { try { return decodeURIComponent(u.replace(/^file:\/\/(localhost)?/i, '')); } catch { return u.replace(/^file:\/\/(localhost)?/i, ''); } };
export function pathsIn(text, max = 4000) {
  const out = new Set(), add = (p) => { if (p && out.size < max) out.add(p); };
  let s = String(text || '');
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { if (/^file:\/\/\S+$/.test(c)) add(fromUrl(c)); else if (CODE_PATH.test(c)) add(c.trim()); return ' '; });
  s = s.replace(/\[([^\]\n]+)\]\(<?((?:\/|~\/)[^)>\n]*)>?\)/g, (m, t, p) => { add(p); return ' '; });
  s = s.replace(/\[([^\]\n]+)\]\(<?(file:\/\/[^\s)>]+)>?\)/g, (m, t, u) => { add(fromUrl(u)); return ' '; });
  s = s.replace(FILE_URL_RX, (u) => { add(fromUrl(trimP(u))); return ' '; });
  for (const m of s.matchAll(PATH_RX)) add(trimP(m[2]));
  return [...out];
}
// 远程预览的钥匙：媒体、iframe 带不了设备凭证头，网址里的随机编号就是凭证；绑在领它的那台设备和登录名上，过期就作废
export const RP_TTL = 30 * 60000, RP_KEEP = 512;
export const rpKeyOk = (it, devs, login, now) => !!it && it.exp > now && devs.get(it.dev.id) === it.dev && it.login === login;
// 真身路径里有点开头的段（.ssh、.env、.git、.claude）就不给。主目录在 home 里时只看主目录以下那一段：主目录本身放在哪（测试的假主目录在 .tmp 下）不算
export const hiddenPath = (real, home = '') => { const r = String(real), h = String(home || '').replace(/\/+$/, ''); if (h && r === h) return false; return (h && r.startsWith(h + '/') ? r.slice(h.length + 1) : r).split('/').some((s) => s.startsWith('.')); };   // 主目录自己不算点开头（C1.1：远程要主目录这个文件夹时由「上层不列」那道回话）

// ───────────── 第三道：这台设备的凭证 ─────────────
// 凭证 = <16 位十六进制设备号>.<43 位随机串>，只在配对那一刻交给手机一次。服务只存随机串的 sha256，比对用定长比较。
// 设备还绑着配对时的 Tailscale 登录名：凭证被拷到 tailnet 里别人的设备上也用不了。
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX64.test(a) || !HEX64.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function checkDevice(devs, raw, login) {
  const m = /^([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(typeof raw === 'string' ? raw : '');
  if (!m) return { deny: 'no device' };
  const d = devs.get(m[1]);
  if (!d) return { deny: 'unknown device' };                 // 没有这台，或者已经撤销
  if (!sameHash(hashOf(m[2]), d.hash)) return { deny: 'bad device' };
  if (d.login !== login) return { deny: 'other login' };
  return { dev: d };
}

// ───────────── 配对码 ─────────────
// 一次只有一个有效的码：新出一个，旧的（没用过的）就作废。码只在内存里（服务重启全部作废），存的也是哈希。
// 码放在链接的 # 后面：浏览器不把 # 后面的东西发给服务，不进请求行、不进日志（T3 hostedPairing 的做法）。
export function newCode(now, ms = PAIR_MS) {
  const code = crypto.randomBytes(32).toString('base64url');
  return { code, slot: { hash: hashOf(code), exp: now + ms } };
}
// 返回 { ok: true } 或 { deny, burn }。burn = 调用方要把槽清掉（过期了）。核对和清槽之间不许有 await：两个请求同时拿同一个码只有一个成功。
export function useCode(slot, code, now) {
  if (typeof code !== 'string' || !SECRET.test(code)) return { deny: 'bad code' };
  if (!slot) return { deny: 'no code' };                     // 没出过码，或者已经用掉
  if (!(now < slot.exp)) return { deny: 'expired', burn: true };
  if (!sameHash(hashOf(code), slot.hash)) return { deny: 'bad code' };
  return { ok: true };
}
export function newDevice(name, login, now) {
  const id = crypto.randomBytes(8).toString('hex'), secret = crypto.randomBytes(32).toString('base64url');
  return { cred: id + '.' + secret, dev: { id, name: devName(name), login, hash: hashOf(secret), at: now } };
}
export const devName = (s) => String(s || '').replace(/[\x00-\x1f\x7f<>&"'\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 40) || '设备';   // 控制字符、换行、改方向的字符都去掉

// 设备表文件的内容 → Map。认不出的条目丢掉；整份坏了就是空表（宁可要重新配对，不放行）。
export function loadDevices(text) {
  const out = new Map(); let j = null;
  try { j = JSON.parse(text); } catch { return out; }
  for (const d of (j && Array.isArray(j.devices) ? j.devices : [])) {
    if (!d || typeof d.id !== 'string' || !/^[0-9a-f]{16}$/.test(d.id) || typeof d.hash !== 'string' || !HEX64.test(d.hash) || typeof d.login !== 'string' || !LOGIN.test(d.login)) continue;   // 数组会被正则转成字符串，先核类型
    const dev = { id: d.id, name: devName(d.name), login: d.login, hash: d.hash, at: Number(d.at) || 0 };
    if (validPush(d.push)) dev.push = { token: d.push.token, env: d.push.env, at: d.push.at };
    out.set(d.id, dev);
  }
  return out;
}

// 手机打开配对链接看到的页面：读 # 后面的码、马上从地址栏抹掉、换成这台设备自己的凭证存进 localStorage，再进总控台。页面本身不含任何口令。
export const PAIR_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>cc-board</title>
<style>:root{color-scheme:light dark}body{margin:0;padding:40px 22px;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#fff;color:#1d1d1f}@media(prefers-color-scheme:dark){body{background:#161617;color:#f5f5f7}}h1{font-size:20px;margin:0 0 12px}</style></head>
<body><h1 id="t">总控台</h1><p id="m">正在配对…</p><script>
(function () {
  var en = !/^zh/i.test(navigator.language || ''), m = document.getElementById('m');
  if (en) document.getElementById('t').textContent = 'cc-board';
  function say(zh, e) { m.textContent = en ? e : zh; }
  var code = location.hash.slice(1), gone = location.search.indexOf('gone=1') >= 0;   // 先读再抹：抹掉以后 location.search 就空了
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  var has = null; try { has = localStorage.getItem('ccb_device'); } catch (e) {}
  if (!code) {
    if (has && !gone) { location.replace('/'); return; }
    return say('这台设备还没配对，或者已经被撤销了。在电脑上的总控台点「手机」，用相机扫二维码。', 'This device is not paired, or it was revoked. On the Mac, open cc-board, click “Phone” and scan the QR code.');
  }
  var ua = navigator.userAgent, name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Browser';
  fetch('/api/remote/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code, name: name }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok) return say('配对没成：这个码用过了、过期了（10 分钟），或者不对。在电脑上重新点「手机」出一个新的。', 'Pairing failed: the code was used, expired (10 min) or is wrong. Click “Phone” on the Mac for a new one.');
      try { localStorage.setItem('ccb_device', JSON.stringify(j.device)); } catch (e) { return say('这个浏览器存不了凭证（无痕模式？）。换普通模式再扫一次。', 'This browser cannot store the credential (private mode?). Scan again in a normal tab.'); }
      location.replace('/');
    }, function () { say('连不上总控台。', 'Cannot reach cc-board.'); });
})();
</script></body></html>`;
