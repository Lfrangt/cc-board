/**
 * [INPUT]: 依赖 ../remote.mjs（或命令行给的另一份，比如改坏版）。不起服务、不碰 tmux、不联网。
 * [OUTPUT]: 逐项打印 ok / FAIL，最后一行「结果：N 过，M 没过」，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的 remote.mjs，每个都必须让本测试变红
 * [POS]: test/ 的「手机远程」规则测试（remote.mjs 的三道拦）。测：config 的 remote 什么算开、写错一律关且不抛；Host / 登录头 / Origin 怎么认；
 *        远程能碰的接口恰好那 10 个；设备凭证、配对码、设备表；APNs 配置、令牌、锁屏类别、ES256 验签、失效判定与空闲放行。
 *        接进 server.mjs 之后的端到端断言在 state.test.mjs 的 [10]，接线的改坏版在 mutants.mjs 的 remote-*。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
// 用法：node test/remote.test.mjs [remote.mjs 的路径]      node test/remote.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '../remote.mjs'));

// ── 反向对照：每次只拿掉一道拦，本测试必须变红 ──
if (process.argv.includes('--mutants')) {
  const src = fs.readFileSync(SRC, 'utf8'); const dir = path.join(HERE, '.tmp', 'remote-mutants'); fs.mkdirSync(dir, { recursive: true });
  const M = {
    'idle-threshold-flipped': ["idleMs >= PUSH_AWAY_MS", "idleMs < PUSH_AWAY_MS"],
    'idle-null-away': ["idleMs != null && idleMs >= PUSH_AWAY_MS", "idleMs == null || idleMs >= PUSH_AWAY_MS"],
    'idle-takes-last': ["text.match(/\"HIDIdleTime\" = (\\d+)(?=\\s|$)/m)", "[...text.matchAll(/\"HIDIdleTime\" = (\\d+)(?=\\s|$)/gm)].at(-1)"],
    'local-accepts-ts':     ["  if (via === 'local') return LOCAL_HOST.test(host) && !proxied(h) ?", "  if (via === 'local') return (LOCAL_HOST.test(host) || /\\.ts\\.net$/.test(host)) && !proxied(h) ?"],
    'proxied-local-ok':     ["  if (via === 'local') return LOCAL_HOST.test(host) && !proxied(h) ?", "  if (via === 'local') return LOCAL_HOST.test(host) ?"],
    'via-loose':            ["  if (via === 'local') return LOCAL_HOST.test(host)", "  if (via !== 'remote') return LOCAL_HOST.test(host)"],
    'pair-gone-dead':       ["var code = location.hash.slice(1), gone = location.search.indexOf('gone=1') >= 0;", "var code = location.hash.slice(1), gone = false;"],
    'proxied-narrow':       ["k.startsWith('tailscale-') || k.startsWith('x-forwarded-') || k === 'forwarded'", "['tailscale-user-login', 'tailscale-user-name', 'x-forwarded-for', 'x-forwarded-host'].includes(k)"],
    'remote-port-local':    ["  if (via === 'local') return LOCAL_HOST.test(host)", "  if (via === 'local' || LOCAL_HOST.test(host)) return LOCAL_HOST.test(host)"],
    'remote-when-off':      ["  if (!R || !R.on) return { deny: 'remote off' };", "  if (!R) return { deny: 'remote off' }; if (!R.on) R = { on: true, hosts: [String(h.host || '').toLowerCase()] };"],
    'host-suffix':          ["  if (!R.hosts.includes(hn)) return { deny: 'bad host' };", "  if (!R.hosts.some((x) => hn.endsWith(x.split('.').slice(-3).join('.')))) return { deny: 'bad host' };"],
    'empty-list-allows':    ["  if (!R.hosts.includes(hn)) return { deny: 'bad host' };", "  if (R.hosts.length && !R.hosts.includes(hn)) return { deny: 'bad host' };"],
    'no-login':             ["  if (typeof login !== 'string' || !LOGIN.test(login)) return { deny: 'no tailscale login' };", ""],
    'login-any-chars':      ["const LOGIN = /^[^\\s,\\x00-\\x1f\\x7f]{1,200}$/;", "const LOGIN = /^.{1,200}$/;"],
    'origin-unchecked':     ["  if (h.origin !== undefined && h.origin !== 'https://' + hn) return { deny: 'bad origin' };", ""],
    'post-no-origin-ok':    ["  if (method !== 'GET' && h.origin === undefined) return { deny: 'no origin' };", ""],
    'bad-host-skipped':     ["    if (!TS_HOST.test(x)) return off('remote.hosts 里有不是 *.ts.net 的名字：' + String(h).slice(0, 80));", "    if (!TS_HOST.test(x)) continue;"],
    'any-domain':           ["(?:\\\\.${LABEL})*\\\\.ts\\\\.net(?::\\\\d{1,5})?$`", "(?:\\\\.${LABEL})*(?::\\\\d{1,5})?$`"],
    'on-truthy':            ["  if (v.on !== true) return off('remote.on 不是 true');", "  if (!v.on) return off('remote.on 不是 true');"],
    'allow-prefix':         ["export const allowed = (method, pathname) => REMOTE_API.has(method + ' ' + pathname);", "export const allowed = (method, pathname) => pathname.startsWith('/api/');"],
    'allow-delete':         ["'POST /api/ack',", "'POST /api/ack', 'POST /api/delete',"],
    'secret-unchecked':     ["  if (!sameHash(hashOf(m[2]), d.hash)) return { deny: 'bad device' };", ""],
    'login-not-bound':      ["  if (d.login !== login) return { deny: 'other login' };", ""],
    'code-no-expiry':       ["  if (!(now < slot.exp)) return { deny: 'expired', burn: true };", ""],
    'code-unchecked':       ["  if (!sameHash(hashOf(code), slot.hash)) return { deny: 'bad code' };", ""],
    'load-keeps-bad':       ["    if (!d || typeof d.id !== 'string' || !/^[0-9a-f]{16}$/.test(d.id) || typeof d.hash !== 'string' || !HEX64.test(d.hash) || typeof d.login !== 'string' || !LOGIN.test(d.login)) continue;", "    if (!d) continue;"],
    'load-id-array':        ["    if (!d || typeof d.id !== 'string' || ", "    if (!d || "],
    'name-keeps-bidi':      ["\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]/g", "]/g"],
    'pair-hash-kept':       ["  try { history.replaceState(null, '', location.pathname); } catch (e) {}\n", ""],
    "apns-missing-on": ["if (v === undefined) return off('');\n  if (!v ||", "if (v === undefined) return { on: true, why: '' };\n  if (!v ||"],
    "apns-key-loose": ["const APNS_ID = /^[A-Z0-9]{10}$/;", "const APNS_ID = /^[A-Za-z0-9]{1,20}$/;"],
    "apns-topic-loose": ["if (typeof v.topic !== 'string' || v.topic.length > 200 || !APNS_TOPIC.test(v.topic))", "if (typeof v.topic !== 'string')"],
    "push-token-loose": ["const PUSH_TOKEN = /^[0-9a-f]{64,200}$/;", "const PUSH_TOKEN = /^[A-Fa-f0-9]{1,300}$/;"],
    "push-env-loose": ["v === 'sandbox' || v === 'production'", "typeof v === 'string'"],
    "push-load-dropped": ["if (validPush(d.push)) dev.push = { token: d.push.token, env: d.push.env, at: d.push.at };", ""],
    "push-load-keeps-bad": ["if (validPush(d.push)) dev.push", "if (d.push) dev.push"],
    "push-single-key": ["reply: 'PUSH_REPLY_ONE'", "reply: 'PUSH_STOP_ONE'"],
    "push-ask-key": ["ask: 'PUSH_ASK_ONE'", "ask: 'PUSH_STOP_ONE'"],
    "push-crash-key": ["crash: 'PUSH_CRASH'", "crash: 'PUSH_STOP_ONE'"],
    "push-multi-key": ["waits === items.length ? 'PUSH_WAIT_MANY'", "waits === items.length ? 'PUSH_MIXED_MANY'"],
    "push-mixed-key": ["waits ? 'PUSH_MIXED_MANY' : 'PUSH_STOP_MANY'", "waits ? 'PUSH_STOP_MANY' : 'PUSH_STOP_MANY'"],
    "push-count-off": ["[String(items.length)]", "[String(items.length + 1)]"],
    "push-sid-many": ["items.length === 1 && typeof items[0].sid", "items.length >= 1 && typeof items[0].sid"],
    "push-sid-loose": ["/^[\\w-]{8,64}$/.test(items[0].sid)", "true"],
    "push-title-leak": ["return { aps: { alert, sound:", "return { title: items[0].title, aps: { alert, sound:"],
    "jwt-wrong-issuer": ["iss: teamId, iat: nowSec", "iss: keyId, iat: nowSec"],
    "jwt-wrong-kid": ["alg: 'ES256', kid: keyId", "alg: 'ES256', kid: teamId"],
    "jwt-der": ["dsaEncoding: 'ieee-p1363'", "dsaEncoding: 'der'"],
    "verdict-keeps-410": ["status === 410 || (status === 400", "false || (status === 400"],
    "verdict-drops-all-400": ["(reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')", "true"],
  };
  let bad = 0;
  for (const [name, [a, b]] of Object.entries(M)) {
    if (src.split(a).length !== 2) { console.log('FAIL ' + name + '：要替换的原文不是正好 1 处'); bad++; continue; }
    const f = path.join(dir, name + '.mjs'); fs.writeFileSync(f, src.replace(a, () => b));   // 函数替换：b 里的 $` 不当特殊符号
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, f], { encoding: 'utf8' });
    const rows = r.stdout.trim().split('\n'), failures = rows.filter((l) => /^  FAIL /.test(l));
    const red = r.status !== 0 && failures.length > 0; if (!red) bad++;
    console.log((red ? 'ok   ' : 'FAIL ') + name + '：变红 ' + failures.length + ' 条');
    console.log(rows.find((l) => l.startsWith('结果：')) || '无结果行');
    for (const row of failures) console.log(row);
    if (!red && r.stderr) console.log(r.stderr.trim().split('\n')[0]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${Object.keys(M).length} 个改坏版，${Object.keys(M).length - bad} 个被测试抓到`);
  process.exit(bad ? 1 : 0);
}

const R = await import(SRC);
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const H = 'mini.tail1a2b.ts.net';
const ON = R.parseRemote({ on: true, hosts: [H] });

console.log('\nconfig 的 remote：只有 { on: true, hosts: [*.ts.net…] } 算开；没有、false、写错一律关，而且不抛');
const offs = [[undefined, '没有这个键'], [false, 'false'], [true, 'true（不是对象）'], ['yes', '字符串'], [[], '数组'], [null, 'null'], [{ hosts: [H] }, '没写 on'], [{ on: 'true', hosts: [H] }, "on 是字符串 'true'"], [{ on: 1, hosts: [H] }, 'on 是 1'],
  [{ on: true }, '没写 hosts'], [{ on: true, hosts: H }, 'hosts 是字符串'], [{ on: true, hosts: [H, 'evil.example.com'] }, '名单里混一个不是 ts.net 的（整份关，不是跳过那一个）'], [{ on: true, hosts: ['mini.ts.net.evil.com'] }, 'ts.net 在中间'],
  [{ on: true, hosts: ['ts.net'] }, '光 ts.net'], [{ on: true, hosts: ['-a.ts.net'] }, '横杠开头'], [{ on: true, hosts: ['a..ts.net'] }, '空段'], [{ on: true, hosts: ['mini.tail.ts.net.'] }, '结尾带点'], [{ on: true, hosts: ['https://mini.tail.ts.net'] }, '写成网址'],
  [{ on: true, hosts: [123] }, '名字是数字'], [{ on: true, hosts: Array.from({ length: 9 }, (_, i) => 'm' + i + '.t.ts.net') }, '9 个名字（上限 8）']];
for (const [v, why] of offs) { let r; try { r = R.parseRemote(v); } catch (e) { r = { threw: e.message }; } ok(r.on === false && Array.isArray(r.hosts) && r.hosts.length === 0, '关：' + why, JSON.stringify(r)); }
ok(R.parseRemote(undefined).why === '' && R.parseRemote(false).why !== '', '没有这个键时不说原因（服务不多记一行日志）；写了 false / 写错才说', JSON.stringify([R.parseRemote(undefined).why, R.parseRemote(false).why]));
let r = R.parseRemote({ on: true, hosts: [' Mini.Tail1A2B.TS.NET ', H, 'mini.tail1a2b.ts.net:8443'] });
ok(r.on && JSON.stringify(r.hosts) === JSON.stringify([H, H + ':8443']), '开：名字去空白、转小写、去重；可以带端口（--https=8443）', JSON.stringify(r));
r = R.parseRemote({ on: true, hosts: [] });
ok(r.on === true && r.hosts.length === 0 && /空/.test(r.why), '开但名单是空的：照样是开（日志写明一个都不多认）', JSON.stringify(r));

console.log('\n第一道：这个请求从哪来（Host、Tailscale-User-Login、Origin）');
const OFF = R.parseRemote(undefined);
const g = (h, conf = ON, m = 'GET') => R.gate(h, conf, m, 'remote');     // 远程端口（remote 开着时另听的 127.0.0.1:<端口+1>）
const loc = (h, conf = ON) => R.gate(h, conf, 'GET', 'local');           // 本机端口（4747）
const LOGIN = 'khalil@example.com';
ok(loc({ host: '127.0.0.1:4747' }, OFF).kind === 'local' && loc({ host: 'localhost:5761' }, OFF).kind === 'local' && loc({ host: '127.0.0.1:4747' }).kind === 'local', '本机端口：本机两种写法是本机，remote 开不开都一样');
ok([OFF, ON].every((c) => loc({ host: H }, c).deny === 'bad host' && loc({ host: H, 'tailscale-user-login': LOGIN }, c).deny === 'bad host' && loc({ host: '127.0.0.1' }, c).deny === 'bad host' && loc({}, c).deny === 'bad host'), '本机端口：ts.net（remote 开着也不认）、不带端口的 127.0.0.1、没有 Host → bad host');
const PX = ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-funnel-request', 'tailscale-headers-info', 'tailscale-app-capabilities', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded'];
const pxLeak = PX.filter((k) => [OFF, ON].some((c) => loc({ host: '127.0.0.1:4747', [k]: 'x' }, c).deny !== 'bad host'));
ok(pxLeak.length === 0 && PX.every((k) => R.proxied({ [k]: 'x' })) && !R.proxied({ host: 'x', 'x-ccboard': 't', origin: 'o', 'content-type': 'a' }), '本机端口：Host 写成 127.0.0.1 却带任何代理头（tailscale-*、x-forwarded-*、forwarded 共 ' + PX.length + ' 种）→ 拒，remote 开不开都一样（serve 指错到 4747 也拿不到本机权限）；本机平常的头不算', JSON.stringify(pxLeak));
ok(g({ host: '127.0.0.1:4748' }).deny === 'bad host' && g({ host: 'localhost:4748' }).deny === 'bad host' && g({ host: '127.0.0.1:4748', 'tailscale-user-login': LOGIN }).deny === 'bad host' && g({}).deny === 'bad host', '远程端口：Host 写成本机（带不带登录头）、没有 Host → 拒，这个端口进来的一律不当本机');
ok([undefined, '', 'Remote', 'x'].every((v) => R.gate({ host: '127.0.0.1:4747' }, ON, 'GET', v).deny === 'bad via'), '端口那一支没给或写错（不是 local / remote）→ 拒，不落到本机那一支');
ok(g({ host: H, 'tailscale-user-login': LOGIN }, OFF).deny === 'remote off', '远程端口但 remote 关着 → 拒（正常不会发生：关着就不听这个端口）');
ok(g({ host: 'other.tail1a2b.ts.net', 'tailscale-user-login': LOGIN }).deny === 'bad host', '开着：同一个 tailnet 里不在名单上的名字 → 拒');
ok(g({ host: 'evil-' + H, 'tailscale-user-login': LOGIN }).deny === 'bad host' && g({ host: 'x.' + H, 'tailscale-user-login': LOGIN }).deny === 'bad host', '开着：名单上名字的前后加字（后缀、子域）→ 拒');
ok(g({ host: H + '.', 'tailscale-user-login': LOGIN }).deny === 'bad host' && g({ host: H + ':443', 'tailscale-user-login': LOGIN }).deny === 'bad host', '开着：结尾带点、多写端口 → 拒（整串比，不做规范化）');
ok(g({ host: H, 'tailscale-user-login': LOGIN }, R.parseRemote({ on: true, hosts: [] })).deny === 'bad host', '开着但名单为空：一个都不多认');
ok(g({ host: H }).deny === 'no tailscale login', '名单里的名字、没有 Tailscale-User-Login 头 → 拒（Funnel 进来的公网请求、打了 tag 的设备都没有）');
for (const [v, why] of [['', '空'], ['a@example.com, c@example.com', '两份头被 node 用逗号连起来'], ['a b@example.com', '带空格'], ['a@example.com\u0007', '控制字符'], ['x'.repeat(201), '201 个字']]) ok(g({ host: H, 'tailscale-user-login': v }).deny === 'no tailscale login', '登录头' + why + ' → 拒');
r = g({ host: H.toUpperCase(), 'tailscale-user-login': LOGIN });
ok(r.kind === 'remote' && r.host === H && r.login === LOGIN, 'GET、名单里的名字（大小写不论）、有登录头、不带 Origin → 远程', JSON.stringify(r));
ok(g({ host: H, 'tailscale-user-login': LOGIN, origin: 'https://' + H }, ON, 'POST').kind === 'remote', 'POST 带着自己的 Origin → 远程');
ok(g({ host: H, 'tailscale-user-login': LOGIN }, ON, 'POST').deny === 'no origin', 'POST 不带 Origin → 拒（浏览器发 POST 一定带）');
for (const o of ['http://' + H, 'https://evil.com', 'https://other.tail1a2b.ts.net', 'null', 'https://' + H + ':8443', 'https://' + H + '/']) ok(g({ host: H, 'tailscale-user-login': LOGIN, origin: o }, ON, 'POST').deny === 'bad origin', 'Origin 是 ' + o + ' → 拒');
ok(g({ host: H, 'tailscale-user-login': LOGIN, origin: 'https://evil.com' }).deny === 'bad origin', 'GET 带着别人的 Origin 也拒');

console.log('\n第二道：远程能碰的接口恰好 10 个，按「方法 + 路径」整串查');
const YES = ['GET /api/state', 'GET /api/turns', 'GET /api/archive', 'POST /api/send', 'POST /api/answer', 'POST /api/new', 'POST /api/ack', 'POST /api/processed', 'POST /api/archive', 'POST /api/remote/push'];
ok(YES.every((x) => R.allowed(...x.split(' '))) && R.REMOTE_API.size === 10, '原有九条加设备推送登记：放行，恰好这 10 个', [...R.REMOTE_API].join(','));
const NO = ['POST /api/delete', 'POST /api/open', 'POST /api/reveal', 'POST /api/focus', 'POST /api/attach', 'POST /api/pick', 'POST /api/crash', 'POST /api/auto', 'POST /api/upload', 'POST /api/preview', 'POST /api/unarchive', 'POST /api/cancel',
  'POST /api/remote/pair', 'POST /api/remote/revoke', 'GET /api/remote/devices', 'POST /api/remote/claim', 'GET /health', 'GET /api/send', 'POST /api/state', 'GET /api/state/', 'GET /API/STATE', 'GET /api/state%20', 'GET /api/constructor', 'GET constructor', 'HEAD /api/state', 'OPTIONS /api/send'];
const leak = NO.filter((x) => R.allowed(...x.split(' ')));
ok(leak.length === 0, '删除、打开 / 选中文件、聚焦、去终端、选文件框、一起退出、自动续跑、上传、预览、接回、取消、配对管理（含 claim，它另走一条路）、/health、换了方法、结尾斜杠、大小写、原型上的名字：一律不放', JSON.stringify(leak));

console.log('\n第三道：设备凭证（只存哈希、定长比较、绑配对时的登录名）');
const a = R.newDevice('iPhone', LOGIN, 1000), b = R.newDevice('iPad', LOGIN, 2000);
const [aid, asec] = a.cred.split('.');
ok(/^[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(a.cred) && a.dev.id === aid && a.dev.hash === sha(asec) && !JSON.stringify(a.dev).includes(asec), '凭证 = 16 位设备号 . 43 位随机串；存的是随机串的 sha256，设备记录里没有随机串本身', JSON.stringify(a.dev));
ok(a.dev.id !== b.dev.id && a.cred !== b.cred && a.dev.login === LOGIN && a.dev.at === 1000, '两台设备的号和凭证都不同；记下登录名和配对时间');
const devs = new Map([[a.dev.id, a.dev], [b.dev.id, b.dev]]);
ok(R.checkDevice(devs, a.cred, LOGIN).dev === a.dev && R.checkDevice(devs, b.cred, LOGIN).dev === b.dev, '各自的凭证认出各自的设备');
const deny = (raw, login = LOGIN, d = devs) => R.checkDevice(d, raw, login).deny;
ok(deny(undefined) === 'no device' && deny('') === 'no device' && deny(['x']) === 'no device', '没带凭证 → 拒');
for (const [v, why] of [[aid, '只有设备号'], [asec, '只有随机串'], [aid.toUpperCase() + '.' + asec, '设备号大写'], [a.cred + '.x', '多一段'], [a.cred + ' ', '结尾空格'], [aid + '.' + asec.slice(1), '随机串少一位'], [aid + '.' + asec + 'A', '随机串多一位'], [aid + '.' + asec.replace(/.$/, '+'), '随机串里有 +']]) ok(deny(v) === 'no device', '凭证写法不对（' + why + '）→ 拒');
ok(deny('0123456789abcdef.' + asec) === 'unknown device', '设备号不在表里（没配过、或撤销了）→ 拒');
const flip = asec.slice(0, -1) + (asec.slice(-1) === 'A' ? 'B' : 'A');
ok(deny(aid + '.' + flip) === 'bad device' && deny(aid + '.' + b.cred.split('.')[1]) === 'bad device', '设备号对、随机串错一位或换成另一台的 → 拒');
ok(deny(a.cred, 'someone@example.org') === 'other login', '凭证对、但这一次的 Tailscale 登录名不是配对时那个 → 拒（凭证被拷到 tailnet 里别人的设备上）');
ok(deny(a.cred, LOGIN, new Map([[aid, { ...a.dev, hash: 'not-hex' }]])) === 'bad device', '表里的哈希坏了 → 拒（定长比较前先核写法，不抛）');
const after = new Map(devs); after.delete(aid);
ok(deny(a.cred, LOGIN, after) === 'unknown device' && R.checkDevice(after, b.cred, LOGIN).dev === b.dev, '从表里删掉 = 撤销：这台马上被拒，另一台不受影响');

console.log('\n配对码：一次有效、10 分钟过期、新出一个旧的作废（槽由服务管，这里测规则）');
const n1 = R.newCode(10000), n2 = R.newCode(10000);
ok(/^[A-Za-z0-9_-]{43}$/.test(n1.code) && n1.slot.hash === sha(n1.code) && n1.slot.exp === 10000 + R.PAIR_MS && R.PAIR_MS === 600000 && n1.code !== n2.code, '码是 43 位随机串，槽里只存哈希，默认 10 分钟', JSON.stringify(n1.slot));
ok(R.newCode(0, 3000).slot.exp === 3000, '过期时长可以由服务给（测试调短）');
ok(R.useCode(n1.slot, n1.code, 10000 + R.PAIR_MS - 1).ok === true, '没过期、码对 → 认');
r = R.useCode(n1.slot, n1.code, 10000 + R.PAIR_MS);
ok(r.deny === 'expired' && r.burn === true, '到点那一毫秒就算过期，并让服务清掉槽', JSON.stringify(r));
ok(R.useCode(null, n1.code, 10000).deny === 'no code', '槽是空的（没出过、用掉了、关掉弹层作废了）→ 拒');
r = R.useCode(n2.slot, n1.code, 10000);
ok(r.deny === 'bad code' && !r.burn, '换了新码以后旧码 → 拒；猜错不清槽（不让 tailnet 里的人把他正在配的码打掉）', JSON.stringify(r));
for (const [v, why] of [[undefined, '没带'], ['', '空'], [n1.code.slice(1), '少一位'], [n1.code + 'A', '多一位'], [{ toString: () => n1.code }, '对象'], [[n1.code], '数组']]) ok(R.useCode(n1.slot, v, 10000).deny === 'bad code', '码' + why + ' → 拒');

console.log('\n设备表文件：认不出的条目丢掉，整份坏了是空表（宁可重新配对，不放行）');
const good = { id: 'a'.repeat(16), name: 'iPhone', login: LOGIN, hash: sha('x'), at: 5 };
ok(R.loadDevices('{ 坏了').size === 0 && R.loadDevices('null').size === 0 && R.loadDevices('{"devices":{}}').size === 0, '不是 JSON、null、devices 不是数组 → 空表');
const ld = R.loadDevices(JSON.stringify({ devices: [good, { ...good, id: '__proto__' }, { ...good, id: 'b'.repeat(16), hash: 'zz' }, { ...good, id: 'c'.repeat(16), login: 'a b' }, { ...good, id: 'd'.repeat(16), login: 5 }, null, 'x', { ...good, id: 'e'.repeat(16), name: '<img src=x onerror=alert(1)>' }] }));
ok(ld.size === 2 && ld.get(good.id).hash === good.hash && !ld.has('__proto__') && ld.get('e'.repeat(16)).name === 'img src=x onerror=alert(1)', '好的条目留下；设备号、哈希、登录名不合写法的丢掉；名字里的尖括号引号去掉', JSON.stringify([...ld.keys()]));
ok(R.devName('') === '设备' && R.devName('a\u0000b<c>"d\'e&f') === 'abcdef' && R.devName('x'.repeat(99)).length === 40, '设备名：空的叫「设备」、控制字符和 <>"\'& 去掉、最长 40 字');
ok(R.devName('iPh\u2028one\u202e\u2066x\u200f') === 'iPhonex', '设备名：行分隔符、改方向的字符（U+2028、U+202E、U+2066、U+200F）也去掉', JSON.stringify(R.devName('iPh\u2028one\u202e\u2066x\u200f')));
ok(R.loadDevices(JSON.stringify({ devices: [{ ...good, id: ['e'.repeat(16)] }, { ...good, id: 'f'.repeat(16), hash: [good.hash] }] })).size === 0, '设备表：设备号或哈希是数组（正则会把它转成字符串）→ 丢掉');

console.log('\n手机打开的配对页');
const P = R.PAIR_HTML, iRep = P.indexOf('history.replaceState'), iFetch = P.indexOf("fetch('/api/remote/claim'");
const iGone = P.indexOf("gone = location.search.indexOf('gone=1') >= 0");
ok(iGone > 0 && iGone < iRep && /if \(has && !gone\)/.test(P), '配对页：先读 ?gone=1 再抹地址栏（抹掉以后 location.search 就空了），被撤销回来的不再自动进 /', JSON.stringify({ iGone, iRep }));
ok(iRep > 0 && iFetch > iRep && P.includes('location.hash.slice(1)'), '从 # 后面读码，先从地址栏和历史记录里抹掉，再发给服务');
ok(!P.includes('__TOKEN__') && !/x-ccboard['"]?\s*:/.test(P) && !/\?(?:code|k)=/.test(P), '页面里没有口令占位、不带 x-ccboard、不把码放进查询串');
ok(P.includes("localStorage.setItem('ccb_device'") && P.includes("location.replace('/')"), '换到的凭证存在这台手机上，然后进总控台');


console.log('\nAPNs：配置、设备令牌、锁屏类别、签名和失效判定');
const AP = { keyId: 'ABCDE12345', teamId: 'ZXCVB12345', topic: 'dev.example.remote' };
const call = (name, ...args) => { try { return R[name]?.(...args); } catch { return undefined; } };
ok(R.PUSH_AWAY_MS === 120000, '空闲常量：两分钟');
// 现场 ioreg 的一行格式；数值为夹具编造，含不足一毫秒的尾数。
for (const [text, expected, label] of [
  ['    | |     "HIDIdleTime" = 123456789012', 123456, '现场行格式、纳秒转毫秒取整'],
  ['"HIDIdleTime" = 9000001\n"HIDIdleTime" = 20000000', 9, '两处取第一处'],
  ['"OtherTime" = 9000000', null, '没有这个键'], ['"HIDIdleTime" = nope', null, '非数字'], ['', null, '空串'],
  ['"HIDIdleTime" = 12.5', null, '非整数'], ['"HIDIdleTime" = -1', null, '负数'], ['"HIDIdleTime" = 0', 0, '零'],
]) ok(call('parseHidIdle', text) === expected, 'HID 空闲：' + label);
for (const [focus, idle, expected, label] of [
  [6000, 0, 'sent', 'f 旧边界'], [6001, null, 'sent', 'f 旧不读空闲'],
  [0, 0, 'ui', 'f 新、0'], [5999, 119999, 'ui', 'f 新、119999'],
  [0, 120000, 'sent', 'f 新、120000'], [5999, null, 'ui', 'f 新、null'],
]) ok(call('pushWould', focus, idle) === expected, '推送空闲门：' + label);
const ac = call('parseApns', AP);
ok(ac?.on === true && ac.keyId === AP.keyId && ac.teamId === AP.teamId && ac.topic === AP.topic, 'APNs 配置：三项原样保留');
ok(call('parseApns', undefined)?.on === false && call('parseApns', undefined)?.why === '', 'APNs 配置：没写时关闭且不多说');
for (const [label, v] of [['null', null], ['数组', []], ['字符串', 'on'], ['布尔', true], ['空对象', {}],
  ...['keyId', 'teamId'].flatMap((k) => [9, 11, 'lower', 'type', 'space'].map((x) => [k + '-' + x, { ...AP, [k]: x === 9 ? 'A'.repeat(9) : x === 11 ? 'A'.repeat(11) : x === 'lower' ? 'abcde12345' : x === 'type' ? 1234567890 : ' ABCDE12345' }])),
  ...['single', '.dev.app', 'dev..app', 'dev.app ', 'dev/app', 'a.' + 'b'.repeat(199), [], null, 5].map((v) => ['topic-' + JSON.stringify(v), { ...AP, topic: v }])]) {
  const c = call('parseApns', v); ok(c?.on === false && !!c.why, 'APNs 配置写错只关推送且不抛：' + label);
}
ok(call('parseApns', { ...AP, topic: 'a.' + 'b'.repeat(198) })?.on === true, 'APNs topic：200 字边界可用');
const PT = 'ab'.repeat(32), sid = 'fixture-1234';
for (const [v, yes] of [[PT, true], ['a'.repeat(200), true], ['a'.repeat(63), false], ['a'.repeat(201), false], [PT.toUpperCase(), false], [PT + ' ', false], [null, false], [[], false], [123, false]]) ok(call('pushToken', v) === yes, '推送 token 校验：' + (typeof v === 'string' ? v.length + ' 位/' + (yes ? '合法' : '拒绝') : typeof v));
for (const [v, yes] of [['sandbox', true], ['production', true], ['Sandbox', false], ['sandbox ', false], [undefined, false], [null, false], [[], false]]) ok(call('pushEnv', v) === yes, '推送 env 校验：' + String(v));
const dp = (push) => call('loadDevices', JSON.stringify({ devices: [{ ...good, push }] }))?.get(good.id);
ok(JSON.stringify(dp({ token: PT, env: 'sandbox', at: 123 })?.push) === JSON.stringify({ token: PT, env: 'sandbox', at: 123 }), '设备表：合法 push 留下');
for (const push of [null, [], {}, { token: PT.toUpperCase(), env: 'sandbox', at: 123 }, { token: PT, env: 'dev', at: 123 }, { token: PT, env: 'sandbox', at: '123' }, { token: PT, env: 'sandbox', at: -1 }]) {
  const d = dp(push); ok(d?.id === good.id && !('push' in d), '设备表：push 写错只丢 push、设备留着');
}
const payloadCases = [
  [[{ kind: 'reply', sid }], 'PUSH_REPLY_ONE'], [[{ kind: 'ask', sid }], 'PUSH_ASK_ONE'], [[{ kind: 'crash', sid }], 'PUSH_CRASH'],
  ...['limit', 'auth', 'flagged', 'error', 'unfinished', 'stall', 'interrupt'].map((kind) => [[{ kind, sid }], 'PUSH_STOP_ONE']),
  [[{ kind: 'reply', sid }, { kind: 'ask', sid }], 'PUSH_WAIT_MANY'],
  [[{ kind: 'reply' }, { kind: 'limit' }], 'PUSH_MIXED_MANY'], [[{ kind: 'limit' }, { kind: 'crash' }, { kind: 'auth' }], 'PUSH_STOP_MANY']
];
for (const [items, key] of payloadCases) {
  const v = call('pushPayload', items); let j; try { j = JSON.parse(JSON.stringify(v)); } catch {}
  const expected = { aps: { alert: { 'loc-key': key, ...(items.length > 1 ? { 'loc-args': [String(items.length)] } : {}) }, sound: 'default', 'thread-id': 'cc-board' }, ...(items.length === 1 && items[0].sid ? { sid } : {}) };
  ok(JSON.stringify(j) === JSON.stringify(expected), '锁屏 JSON：' + key + '，' + items.length + ' 件、数量和 sid 精确');
}
for (const bad of ['short', '../fixture', 'x'.repeat(65), ['fixture-1234'], null, 'fixture-1234\n']) ok(!('sid' in (call('pushPayload', [{ kind: 'reply', sid: bad }]) || { sid: true })), '锁屏 sid 格式不合规就不带');
const privateWords = ['PRIVATE_TITLE', 'PRIVATE_BODY', 'PRIVATE_NAME'];
const clean = call('pushPayload', [{ kind: 'reply', sid, title: privateWords[0], text: privateWords[1], name: privateWords[2] }]);
ok(!!clean && privateWords.every((w) => !JSON.stringify(clean).includes(w)), '锁屏只取类别和 sid，输入额外的标题正文登记名均不能漏出');
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwt = call('apnsJwt', keys.privateKey, AP.keyId, AP.teamId, 1700000000);
let head, claims, valid = false, sigLen = 0;
try { const [h, c, signature] = jwt.split('.'); head = JSON.parse(Buffer.from(h, 'base64url')); claims = JSON.parse(Buffer.from(c, 'base64url')); const sig = Buffer.from(signature, 'base64url'); sigLen = sig.length; valid = crypto.verify('sha256', Buffer.from(h + '.' + c), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, sig); } catch {}
ok(JSON.stringify(head) === JSON.stringify({ alg: 'ES256', kid: AP.keyId }), 'JWT 头只有 alg=ES256 和 kid');
ok(JSON.stringify(claims) === JSON.stringify({ iss: AP.teamId, iat: 1700000000 }), 'JWT 载荷只有 iss 和给定秒时间 iat');
ok(valid && sigLen === 64 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt), 'JWT 用独立公钥验签：P-256 / ieee-p1363 / base64url');
for (const [status, reason, verdict] of [[200, '', 'ok'], [410, 'Unregistered', 'drop'], [400, 'BadDeviceToken', 'drop'], [400, 'DeviceTokenNotForTopic', 'drop'], [400, 'BadTopic', 'err'], [403, 'InvalidProviderToken', 'err'], [429, 'TooManyRequests', 'err'], [500, 'InternalServerError', 'err'], [0, '', 'err']]) ok(call('apnsVerdict', status, reason) === verdict, 'APNs 应答：' + status + '/' + reason + ' → ' + verdict);

console.log(`\n结果：${pass} 过，${fail} 没过`);
process.exit(fail || !pass ? 1 : 0);
