/**
 * [INPUT]: 依赖 ../server.mjs、../preview.mjs、../autopilot.mjs、../remote.mjs 的原文（按字符串精确替换造改坏版）和 ./state.test.mjs。分组规则本身（projects.mjs）的改坏对照不在这里，跑 projects.test.mjs --mutants
 * [OUTPUT]: 每个改坏版（含 APNs 接线与空闲门）变红了几条；有一个没变红就退出码 1
 * [POS]: test/ 的「测试自己靠不靠得住」检查：每次只改坏服务的一处规则，state.test.mjs 必须变红。
 *        diff-* 验证逐笔补丁的轮首、扫描终点、工具筛选、安全门和应答上限。
 *        改坏版仍带着试验场保护（不碰 Ghostty、不发通知）。要替换的原文在 server.mjs 里找不到或不唯一时直接报错，免得悄悄没改成。
 *        架构历任那一批的 9 个改坏版（历任、裁剪、启动恢复），完整套件逐个运行。
 *        rp-* 15 个守远程预览（C1）：证据只认交付和改过的文件、真身比真身、链接 / 点开头 / 别的会话 / 钥匙核对 / CSP / 过期。
 *        rp-dir-* 5 个守远程文件夹图集（C1.1）：主目录和上层、/private 与 /Volumes 的顶层、不列链接、证据不认上一级、留痕。
 *        11/22 修一（rp-fix）加 7 个：rp-dir-home-parent（只拿掉「主目录的上层」）、rp-canon-case / rp-canon-firm（真身不收大小写 / firmlink 别名）、
 *        rp-link-target-evidence（链接指去的地方也算写到）、rp-no-normalize（不先规整）、rp-log-key（日志不遮钥匙）、rp-pdf-inline（PDF 不按附件发）。
 *        11/23 PR #8 收紧加 3 个：digest-en-anyline（英文标签哪一行都认）、digest-en-fence（不跳过代码块）、digest-en-link（[Review](网址) 也当标签）。
 *        11/24 ng 车：name-*（[7n] 新窗口的名字）、rp-gal-*（[10] 图集的固定竞态）、name-help-*（S2 --help 探 --name）、rp-gal-no-cwd（S1）、limits-pin-*（limits.pin 没接进 /api/state、不看 limitsPin、不看 defaultAccount、limitsPin 写错连累整份 config）。
 *        11/24 brief-v2 加 6 个 brief-*（/api/new 的派活单接线，[7g-2] 抓）：该拒的两个（不核 brief、拒了还开窗口）、该过的两个（不给 briefNew 档位、原 prompt 拼到前面）、不带的两个（brief: null 当成带了、应答一律带 brief）。
 *        FIX-1（11/24 返修）再加 2 个：brief-prompt-not-passed（不把 prompt 递给 briefNew：第二张派活单、超长都漏过去）、brief-truthy（brief 是 "" / false / 0 当成没带、照开窗口）。
 *        11/24 canvas 车加 14 个 canvas-*（内置预览的画布，[画布] 那一块抓）：上限 12、至少 2 个、数字排序、有 package.json / .git、指到外面的链接、点开头的、只读 64 KiB、
 *        ccb:frame、文件夹先问图集、主目录不摊开、paths 去重和点开头的、vN.html 的 versions、server 不认 canvas: true。
 *        11/25 画布第二轮再加 11 个 canvas-*：一批网页不分文件夹（拿到别的文件夹的钥匙）、分开时的说明、版本文件夹的比例例外、过半改成一半、/tmp 不去 /private、
 *        主目录钥匙往下钻、versions 留最早的、只读 32 KiB、实体查到原型、按 UTF-16 截、ios 不认整词。
 *        11/25 待审阅推送（手表）加 11 个 review-*（[4q] 抓）：没有 review 槽、走 Mac 横幅、合批不看 config、不跟待跟进那批带上、看着总控台也推、待跟进发过还补发、
 *        老设备也收到、重启不记已知道、登记不认 kinds、只改 kinds 不落盘、推迟中不记已知道；push-ignores-ui、push-token-in-log 两个跟着新写法换了原文。
 *        11/25 真身和顶层挪进 preview.mjs 共用（canon、isTop、homeIds）：rp-canon-case、rp-canon-firm、rp-dir-private-top 跟着挪到 preview.mjs（本机和远程一起红），
 *        preview-deep-home、canvas-tmp-private 换了原文；再加 7 个 canvas-*：外接盘根不算顶层、register 绕过 canon、版本不看是不是网页、版本不去重、取第一组、
 *        分母数子文件夹、分母数点开头的。
 *        同时跑的几路各用自己的端口段（M_PORT + 第几路 × 2000）和自己的临时目录（test/.tmp/mutants-XXXXXX），互不撞、互不删。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
// 用法：node test/mutants.mjs        （全部改坏版，一次跑 M_JOBS 个、默认 4 个，每个是一整份 state.test）；node test/mutants.mjs 名字,名字 只跑这几个；端口占 M_PORT 到 M_PORT + M_JOBS × 2000
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = Object.fromEntries(['server.mjs', 'preview.mjs', 'autopilot.mjs', 'remote.mjs'].map((f) => [f, fs.readFileSync(path.join(HERE, '..', f), 'utf8')]));
const src = SRC['server.mjs'];
const MUTANTS = {
  "unarchive-account-not-wrapped": [": wrapLaunch(acct, cm ? withCodeMode(cl) : cl);", ": cm ? withCodeMode(cl) : cl;"],
  "unarchive-ignores-original": ["[[it.account, 'archive'], [readTap(sid)?.account, 'tap']]", "[]"],
  "unarchive-account-no-ready": ["    if (acct && !acct.ready) return { ok: false, error: '钥匙串里还没有「' + acct.name + '」的 token' };", ""],
  // 逐笔改动：每个改坏版由 [1f] 的边界、内容或安全门断言抓到。
  "diff-no-wrote-gate": ["if (!tr.st.wrote || ![...tr.st.wrote.keys()].some(p => wrotePath(p, cwd) === wanted))", "if (false)"],
  "diff-from-zero": ["scanRange(tr.file, tr.st.turnOff, tr.pos, tr.st.turnOff > 0, null,", "scanRange(tr.file, 0, tr.pos, tr.st.turnOff > 0, null,"],
  "diff-to-eof": ["scanRange(tr.file, tr.st.turnOff, tr.pos, tr.st.turnOff > 0, null,", "scanRange(tr.file, tr.st.turnOff, fs.statSync(tr.file).size, tr.st.turnOff > 0, null,"],
  "diff-sidechain": ["    if (d.isSidechain) return;\n    const content = d.message && d.message.content;", "    const content = d.message && d.message.content;"],
  "diff-any-tool": ["b.type === 'tool_use' && WRITE_TOOLS.test(b.name) && b.input", "b.type === 'tool_use' && b.input"],
  "diff-no-create": ["else if (call.tool === 'Write' && result.type === 'create'", "else if (false && result.type === 'create'"],
  "diff-no-cap": ["return capDiff({ ok: true, path: wanted, items, truncated: false });", "return { ok: true, path: wanted, items, truncated: false };"],
  "diff-codex-whole": ["for (const block of filePatches(patch, wanted, cwd))", "for (const block of [patch])"],
  "diff-off-carry": ["const lineOff = dataOff + start;", "const lineOff = from;"],
  "diff-reload-no-off": ["this.st = this.mk(); this.st.turnOff = size - span;", "this.st = this.mk(); this.st.turnOff = 0;"],
  "diff-peer-midturn-clears": ["if (!st.open) newTurnWrites(st, off);", "newTurnWrites(st, off);"],
  // 架构历任那一批：历任存盘与时代核验、跨拍裁剪、单台活窗格、启动日志恢复。
  'org-past-not-passed': ["seats, past, chiefWords:", "seats, chiefWords:"],
  'org-past-not-saved': ["if (historyDirty) { try { saveSeatHistory(); }", "if (false) { try { saveSeatHistory(); }"],
  'org-past-pid-ignored': ["if (last >= started) ids.add(GONE + pid);", "ids.add(GONE + pid);"],
  'prune-immediate': ["return m.n >= 3 && now - m.first >= PRUNE_MS ? m : null;", "return m;"],
  'dead-no-carry': ["if (fs.existsSync(sock)) for (const q of prev.get(sock) || []) if (alive(q.pid))", "if (false) for (const q of prev.get(sock) || []) if (alive(q.pid))"],
  'prune-no-log': ["console.log(`spawn-drop ${new Date(now).toISOString()}", "void (`spawn-drop ${new Date(now).toISOString()}"],
  'restore-off': ["  if (spawnsRestored || !sessionsScanned) return;", "  return;\n  if (spawnsRestored || !sessionsScanned) return;"],
  'restore-any-sid': ["    if (hits.length !== 1) continue;", "    if (!hits.length) continue;"],
  'restore-no-created': ["if (!row || Math.abs(p.created - row.at) > 120000) continue;", "if (!row) continue;"],
  // 架构历任那一批评审时的必改第 2 条：名单里的前任进程不走名字兜底。
  'org-past-name-fallback': ["  if (hs) return live.some((x) => x.sid === hs) ? hs : null;\n", ""],

  // APNs 接线：每个单独走轻道，不能用整批并行入口。
  'push-idle-ignored': ["else if (pushReady()) {", "else if (false) {"],
  'push-idle-unknown-away': ["return null; // 空闲未知时不额外放行", "return 180000; // 改坏：空闲未知也放行"],
  'push-idle-threshold-flipped': ["idleMs >= PUSH_AWAY_MS", "idleMs < PUSH_AWAY_MS", 'remote.mjs'],
  'push-bad-path': ["':path': '/3/device/' + token,", "':path': '/wrong/device/' + token,"],
  "push-ignores-ui": ["if (pushed) void sendPush(items);\n  else if (pushReady()) {\n    const idleMs = await readHidIdleMs();\n    if (pushWould(Date.now() - uiFocusAt, idleMs) === 'sent') { pushed = true; void sendPush(items); }\n  }", "pushed = true; void sendPush(items);"],   // 11/25 待审阅：推送的那份改叫 items（带上排着的 review），原文跟着改
  "push-without-config": ["const APNS = CONFIG.apns;", "const APNS = CONFIG.apns.on ? CONFIG.apns : { on: true, keyId: 'ABCDE12345', teamId: 'ZXCVB12345', topic: 'dev.example.remote' };"],
  "push-revoke-keeps-token": ["devices.delete(id); devSeen.delete(id);", "if (!d.push) devices.delete(id); devSeen.delete(id);"],
  "push-410-kept": ["delete d.push; saveDevices();", "saveDevices();"],
  "push-network-retries": ["const r = await apnsRequest(host, token, jwt, payload);", "let r = await apnsRequest(host, token, jwt, payload); if (r.verdict === 'err') r = await apnsRequest(host, token, jwt, payload);"],
  "push-token-in-log": ["${token.slice(0, 8)}${d.push.review ? ' +review' : ''}`);\n      } else", "${token}${d.push.review ? ' +review' : ''}`);\n      } else"],   // 11/25 token 行后面多了 +review，原文跟着改
  "push-token-duplicate": ["if (other !== d && other.push?.token === token) { delete other.push; changed = true; }", "if (false) { delete other.push; changed = true; }"],
  "push-local-registers": ["if (rem && u.pathname === '/api/remote/push') {\n      const d = rem.dev;", "if (u.pathname === '/api/remote/push') {\n      const d = rem ? rem.dev : devices.values().next().value;"],
  "push-readonly-off": ["const READONLY = process.env.CCBOARD_READONLY === '1';", "const READONLY = process.env.CCBOARD_READONLY === '1' && !(() => { try { return parseApns(JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).apns).on; } catch { return false; } })();"],
  // 11/25 待审阅推送（手表）接线，[4q] 抓：没有 review 槽、走 Mac 横幅那一路、合批不看 config、不跟待跟进那批带上、看着总控台也推、
  // 待跟进发过还补发「做好了」、老设备也收到、重启不记已知道、登记不认 kinds、只改 kinds 不落盘、推迟中不记已知道
  'review-not-notified':  ["  if (!asking(s) && !s.alert && s.digest && s.digest.need === 'review'", "  if (false && s.digest.need === 'review'"],
  'review-to-mac':        ["      if (slot === 'review') { queueReview(s.sid); continue; }", ""],
  'review-batch-fixed':   ["setTimeout(flushReviews, CONFIG.reviewBatchSec * 1000)", "setTimeout(flushReviews, 2500)"],
  'review-not-carried':   ["  const rv = takeReviews();", "  const rv = [];"],
  'review-ignores-ui':    ["  if (how === 'push') void sendPush(r);", "  void sendPush(r);"],
  'review-after-reply':   ["      if (slot === 'review' && done.reply === 'reply@' + s.resultAt) { done.review = n.key; alertHold.delete(hk); continue; }", ""],
  'review-all-devices':   ["const mine = pushItems(items, d.push);", "const mine = items;"],
  'review-no-baseline':   ["  b.review = s.resultAt ? 'review@' + s.resultAt : null;", ""],
  'review-kinds-ignored': ["const review = pushKinds(body.kinds).includes('review');", "const review = false;"],
  'review-kinds-unsaved': ["if (!same || (d.push.review === true) !== review)", "if (!same)"],
  'review-snooze-sends':  ["const v = ns.find((n) => n.slot === 'review'); if (v) done.review = v.key;", ";"],
  // 每个窗口一台 tmux / 一起退出 / 全部接回（P0-0，win-bf）。tmux 那几个不许写回 -L：perwindow-shared 是退回到老的 -S tmux.sock
  "perwindow-shared": ["  const sv = await startServer(name);\n", "  const sv = { sock: TMUX_SOCKET, watched: false };\n"],
  "enum-legacy-only": ["  const socks = [TMUX_SOCKET, ...winSocks()];", "  const socks = [TMUX_SOCKET];"],
  "enum-no-legacy": ["  const socks = [TMUX_SOCKET, ...winSocks()];", "  const socks = [...winSocks()];"],
  "attach-legacy-sock": ["  const sock = sockFor(name);\n  const cl = await tmuxAt(sock, ['list-clients'", "  const sock = TMUX_SOCKET;\n  const cl = await tmuxAt(sock, ['list-clients'"],
  "attach-always-new": ["  const ttys = cl.ok ? [", "  const ttys = cl.ok && false ? ["],
  "watch-off": ["  const sock = sockPath(name);\n  try {", "  const sock = sockPath(name);\n  return { sock, watched: false };\n  try {"],
  "env-not-stripped": ["const TMUX_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_)/.test(k) && k !== 'TMUX' && k !== 'TMUX_PANE'));", "const TMUX_ENV = { ...process.env };"],
  "no-exit-empty": ["  const e = await tmuxAt(sv.sock, ['set', '-g', 'exit-empty', 'on']);", "  const e = { ok: true };"],
  "env-keeps-ccboard": ["!/^(CLAUDE|CCBOARD_)/.test(k) && k !== 'TMUX' && k !== 'TMUX_PANE'));   // CCBOARD_*", "!/^CLAUDE/.test(k) && k !== 'TMUX' && k !== 'TMUX_PANE'));   // CCBOARD_*"],
  "crash-n-shrinks": ["      goneCrash.delete(sid); for (let i = goneLog.length - 1; i >= 0; i--) if (goneLog[i].sid === sid) goneLog.splice(i, 1);\n", ""],
  "restore-stop-ignored": ["    if (c.stop) { if (c.state !== 'dismissed') { c.state = 'stopped'; c.why = 'user'; c.next = c.done + c.failed.length + 1; } return; }", "    if (false) { return; }"],
  "crash-only-mid": ["    if (!p.mid && !cid) {", "    if (!p.mid) {"],
  "crash-threshold-1": ["const CRASH_N = 3, CRASH_WIN = 10000;", "const CRASH_N = 1, CRASH_WIN = 10000;"],
  "crash-counts-leaving": ["    if (archive.items[sid] || leaving.has(sid)) { lastLive.delete(sid);", "    if (false) { lastLive.delete(sid);"],
  "crash-no-snapshot": ["  if (c.dir) snapCrash(c, win).catch(", "  if (false) snapCrash(c, win).catch("],
  "restore-ignore-load": ["    const t0 = Date.now(); let load = loadNow();", "    const t0 = Date.now(); let load = 0;"],
  "restore-never-stops": ["      if (Date.now() - t0 >= LOAD_WAIT) {", "      if (false) {"],
  "restore-no-gap": ["    const gapLeft = (c.restoredAt || 0) + RESTORE_GAP - Date.now();", "    const gapLeft = 0;"],
  "tmux-shim-legacy": ["  if (t && !/^[%$@]/.test(t)) return tmuxFor(t, args, opt);", "  if (false) return tmuxFor(t, args, opt);"],   // 旧写法 tmux() 不按名字找套接字：自动续跑发不出去（[7e-2]）
  "restore-order-no-role": ["return ((ROLE_RANK[x.role] ?? 2) - (ROLE_RANK[y.role] ?? 2)) || ((y.lastAt || 0) - (x.lastAt || 0));", "return (y.lastAt || 0) - (x.lastAt || 0);"],
  // 11/16 datalock：另一份能写的服务照样在同一个数据目录起来 / 只读的服务照样写 pins.json / tmux 全局环境里的 CCBOARD_* 不清
  'datadir-no-guard': ["      process.exit(3);\n    }\n  }\n}\n", "    }\n  }\n}\n"],
  'readonly-writes-pins': ["function savePins() { if (READONLY) return; ", "function savePins() { "],
  'tmux-env-keeps-ccboard': ["/^(CLAUDE[A-Z0-9_]*|CCBOARD_[A-Z0-9_]+)$/.test(k)", "/^CLAUDE[A-Z0-9_]*$/.test(k)"],
  // 11/16 子会话标记：服务不清 tmux 全局环境里继承来的 CLAUDE* 变量
  'tmux-env-not-scrubbed': ["  fastLoop(); slowLoop(); suggestLoop(); limitsLoop(); scrubTmuxEnv();", "  fastLoop(); slowLoop(); suggestLoop(); limitsLoop();"],
  // 被测服务不认 CCBOARD_TMUX_SOCKET（11/16 两次全体崩溃的修复）。故意指向一个不存在的 -S 套接字，不写回 -L ccboard：改坏版本身不能把隐患带回来
  'tmux-socket-ignored': ["const TMUX_SOCKET = (SANDBOX && process.env.CCBOARD_TMUX_SOCKET) || path.join(HOME, '.cc-board', 'tmux.sock');", "const TMUX_SOCKET = '/dev/null/ccb-mutant.sock';"],
  'kw-turn-counts': ["      if (isKeepWarm(text)) { if (st.open) return; st.inKw = true; st.kwAt = d.timestamp;", "      if (false && isKeepWarm(text)) { if (st.open) return; st.inKw = true; st.kwAt = d.timestamp;"],   // 11/20 总管保温（win-99）
  'kw-reply-delivers': ["      if (st.inKw) {                                         // 保温那一轮的回复", "      if (false) {                                         // 保温那一轮的回复"],   // 11/20 总管保温（win-99）
  'kw-startup-logs-off': ["let kwCfg = { at: 0, v: parseKeepWarm(), desc: 'off' }", "let kwCfg = { at: 0, v: parseKeepWarm(), desc: '' }"],   // 11/20 总管保温（win-99）
  // 11/21 1b 审查后（win-99）：只读闸、试验服务闸、他正对着窗口（copy-mode / 分屏）、config 的 on:false 和拼错的键、收尾清 in-kw、插在一轮中间不认。都由 [7s] / [7s-2] 抓
  'kw-readonly-fires':   ["const KW_RO = READONLY ? '只读' : '';", "const KW_RO = '';"],
  'kw-sandbox-fires':    ["const KW_SB = SANDBOX && !(", "const KW_SB = false && !("],
  'kw-pane-gate-off':    ["    if (near !== null) { skip(s.sid, near); continue; }", "    void near;"],
  'kw-on-false-ignored': ["const out = { ...KW_DEF, on: v.on !== false, sids: [] };", "const out = { ...KW_DEF, on: true, sids: [] };", 'autopilot.mjs'],
  'kw-odd-key-ok':       ["  if (odd.length) throw new Error('keepWarm 里有不认识的键：' + odd.join('、'));\n", "", 'autopilot.mjs'],
  'kw-endturn-stays':    ["        if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') st.inKw = false;", "        if (false) st.inKw = false;"],
  'kw-midturn-taken':    ["{ if (st.open) return; st.inKw = true;", "{ st.inKw = true;"],
  'kw-turns-midturn':    ["if (isKeepWarm(text)) { if (!open) kw = true; return; }", "if (isKeepWarm(text)) { kw = true; return; }"],
  'peek-clears':         ["      if (peek) out.peek = true; else notices = [];", "      if (peek) out.peek = true; notices = [];"],
  'tidy-keeps-all':      ["return { keep: false, why: '只聊了几句，没改过文件' };", "return { keep: true, why: '只聊了几句，没改过文件' };"],
  'tidy-drop-not-moved': ["    if (r.ok && cur.drop) { dropArchived(sid, cur); return; }", "    if (false) { dropArchived(sid, cur); return; }"],
  'open-scripts':        ["  return OPEN_EXT.has(ext) ? 'open' : 'reveal';", "  return 'open';"],
  'open-any-origin':     ["const og = req.headers.origin; return !og ||", "const og = req.headers.origin; return true ||"],
  'no-project-evidence': ["st.steps++; if (b.name !== 'Poll') st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);", "st.steps++; if (b.name !== 'Poll') st.tool = toolLine(b); st.done = false;"],   // 11/17 Code Mode：这一行多了「Poll 不顶掉上一条」，原文跟着改
  'lost-no-project':     ["lostAt: x.lostAt, crash: x.crash || null, idle: x.idle === true, project: x.project || classify(null, { title: x.title, prompt: x.prompt, cwd: x.cwd, home: HOME }) }));", "lostAt: x.lostAt, crash: x.crash || null, idle: x.idle === true }));"],
  'api-error-ignored':   ["        if (d.isApiErrorMessage) {\n          const h = haltOf(d, m);", "        if (false) {\n          const h = haltOf(d, m);"],
  'compact-as-prompt':   ["if (d.isMeta || d.isCompactSummary) return;", "if (d.isMeta) return;"],
  'interrupt-ignored':   ["      if (isInterrupt(text)) {                               // 一轮做到一半被打断", "      if (false) {                               // 一轮做到一半被打断"],
  'idle-esc-halts':      ["        if (st.open) { st.halt = { kind: 'interrupt'", "        if (true) { st.halt = { kind: 'interrupt'"],
  'no-stall':            ["return s.quiet >= STALL_MS ? {", "return false ? {"],
  'no-gone':             ["    if (now - since < 6000) continue;", "    continue;"],
  'gone-when-idle':      ["    if (!p.mid && !cid) {", "    if (false) {"],      // 单个闲着的退出也记
  'no-baseline':         ["    if (!done) { alerted.set(s.sid, baseOf(s)); continue; }", "    if (!done) { alerted.set(s.sid, {}); continue; }"],
  'notify-while-watched': ["const would = Date.now() - uiFocusAt < 6000 ? 'ui' : 'sent';", "const would = 'sent';"],
  'rehalt-new-key':      ["          if (st.halt && st.halt.kind === h.kind) st.halt.text = h.text; else st.halt = h;", "          st.halt = h;"],
  'interrupt-notifies':  ["      if (n.kind !== 'interrupt') queueAlert(s.title, n.kind, s.sid, n.text);", "      queueAlert(s.title, n.kind, s.sid, n.text);"],
  'shell-counts-as-stopped': ["  if (s.status === 'shell') return null;                               // 它放到后台的活还在跑", "  // 它放到后台的活还在跑"],
  'no-folder-note':      ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", ""],
  'note-when-folder-given': ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", "  if (text) text += pin ? pinNote(pin) : FOLDER_NOTE;"],
  'digest-no-cond':      ["if (DG_COND.test(u) || DG_LATER.test(u) || DG_NONE.test(u)) continue;", "if (DG_NONE.test(u)) continue;"],
  'tag-line-kept':       ["const lines = ti < 0 ? all : all.filter((_, i) => i !== ti);", "const lines = all;"],
  // 英文标签只认代码块外的最后一个非空行（11/23 PR #8 收紧）：拿掉「只看最后一行」、拿掉「跳过代码块」、链接也当标签
  'digest-en-anyline':   ["if (m && (m[1] || i === last)) {", "if (m) {"],
  'digest-en-fence':     ["else if (!fenced && l.trim()) last = i;", "else if (l.trim()) last = i;"],
  'digest-en-link':      ["\\[(needs you|review|fyi)\\](?!\\()", "\\[(needs you|review|fyi)\\]"],
  'peer-turn-ignored':   ["        if (!st.open) { st.turnBy = 'peer'; st.turnPeer =", "        if (false) { st.turnBy = 'peer'; st.turnPeer ="],
  'pin-ignored-in-note': ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", "  if (text && sameDir(dir, HOME)) text += FOLDER_NOTE;"],
  'pin-trusts-client':   ["  const pin = opt.project ? pinnable(opt.project.key, opt.project.name) : null;", "  const pin = opt.project && opt.project.key ? { key: String(opt.project.key), name: String(opt.project.name) } : null;"],
  'pins-not-saved':      ["  if (pin) { pins[name] = { ...pin, at: Date.now() }; savePins(); }", "  if (pin) { pins[name] = { ...pin, at: Date.now() }; }"],
  'pending-no-pin':      ["project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME, pin: pinOf(x.name) }) }))", "project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME }) }))"],
  'no-auto-trust':       ["  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // config 里打开", "  else if (false) autoTrust(name).catch(() => {});   // config 里打开"],
  'trust-ignores-config': ["  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // config 里打开", "  else if (true) autoTrust(name).catch(() => {});   // config 里打开"],
  'trust-home-only':     ["  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // config 里打开", "  else if (CONFIG.autoTrust && sameDir(dir, HOME)) autoTrust(name).catch(() => {});   // config 里打开"],
  'codex-sessions-off':  ["  if (CONFIG.codex) for (const c of codexSessions(seen)) out.push(c);", "  for (const c of codexSessions(seen)) out.push(c);"],
  'codex-new-off':       ["  if (opt.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };\n  const provider", "  const provider"],
  'codex-listed-off':    ["...(CONFIG.codex ? { codex:", "...(true ? { codex:"],
  'codex-pane-pending':  ["    if (agents[pane.name] && !CONFIG.codex) continue;", ""],
  'config-ignored':      ["    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: c.autoTidy === true, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, judgeAccount, accountFallback: fbr.fb, org, auto, update, remote: parseRemote(c.remote), apns: parseApns(c.apns) };   // remote / apns 写错各自关闭，不抛", "    return def;"],
  'limits-codex-ungated': ['codex: CONFIG.codex ? codexLimits(CODEX_HOME, now) : null', 'codex: codexLimits(CODEX_HOME, now)'],
  'limits-not-in-state': ['sandbox: SANDBOX, limits: LIMITS };', 'sandbox: SANDBOX };'],
  'account-not-wrapped': ['    args.push(...wrapLaunch(acct, opt.codeMode === true ? withCodeMode(cl) : cl));', '    args.push(...(opt.codeMode === true ? withCodeMode(cl) : cl));'],   // 11/17 Code Mode：这一行多了套 /usr/bin/env 那一层，原文跟着改
  'account-skip-ready':  ["    if (!acct.ready) return { ok: false, error: '钥匙串里还没有「' + acct.name + '」的 token' };\n", ''],
  'account-any-id':      ["    if (!acct) return { ok: false, error: '没有这个账号：' + String(want).slice(0, 40) };", "    if (!acct) acct = { id: String(want), name: String(want), ready: true };"],
  // config 的 defaultAccount（11/17 car3）：没选账号时不按它包；写了没登记的号也照用
  'default-account-ignored':   ["  let want = opt.account || (provider === 'claude' ? CONFIG.defaultAccount : '');", "  let want = opt.account;"],   // 11/22 accountFallback：const 改成 let（退回时要换掉 want）
  // 11/22 accountFallback（作者：「我之后新建的任务开到主号」）：默认号到顶才退回；明说的照明说的；退回的号没 token 不退；note 只写一次；写错只关这一项
  'acct-fb-ignored':        ["    if (to && to.ready) { want = d.id; fell = d; }", "    if (false) { want = d.id; fell = d; }"],
  'acct-fb-explicit-too':   ["  if (want && !opt.account && opt.fromUi === true && provider === 'claude'", "  if (want && opt.fromUi === true && provider === 'claude'"],
  'acct-fb-api-too':        ["  if (want && !opt.account && opt.fromUi === true && provider === 'claude'", "  if (want && !opt.account && provider === 'claude'"],
  'acct-fb-note-sandbox':   ["  if (SANDBOX && !path.resolve(fb.note).startsWith(path.resolve(DATA) + path.sep)) {", "  if (false) {"],
  'acct-fb-unready-ok':     ["    if (to && to.ready) { want = d.id; fell = d; }", "    if (to) { want = d.id; fell = d; }"],
  'acct-fb-note-every':     ["READONLY || fellNoted.has(k)) return;", "READONLY) return;"],
  'acct-fb-bad-drops-all':  ["    if (fbr.error) console.log(", "    if (fbr.error) throw new Error('accountFallback ' + fbr.error); if (fbr.error) console.log("],
  'default-account-unchecked': ["    if ('defaultAccount' in c && !accounts.some((a) => a.id === c.defaultAccount)) throw new Error('defaultAccount 要是 accounts 里登记过的 id');\n", ""],
  'bad-config-crashes':  ["  } catch (e) { useRules(); console.log(`config ${CONFIG_FILE}：读不了（${e.message}），用默认值`); return def; }", "  } catch (e) { throw e; }"],
  'trust-any-dialog':    ["    const i = d.options.findIndex((o) => TRUST_OPT.test(o));", "    const i = d.options.length - 1;"],
  // 首次启动向导（11/15 23:19）：认不出向导 / 终端设置回车 / 选登录方式也回车 / 恢复归档不点
  'onboard-ignored':     ["    const ob = ONBOARD.find((s) => s.all.every((re) => re.test(cap.out)));", "    const ob = null;"],
  'onboard-term-enter':  ["{ id: 'terminal-setup', key: 'Escape',", "{ id: 'terminal-setup', key: 'Enter',"],
  'onboard-login-enter': ["  { id: 'terminal-setup', key: 'Escape', all: [/Use Claude Code's terminal setup\\?/, /No, maybe later/] },\n];", "  { id: 'terminal-setup', key: 'Escape', all: [/Use Claude Code's terminal setup\\?/, /No, maybe later/] },\n  { id: 'login', key: 'Enter', all: [/Select login method:/] },\n];"],
  'unarchive-no-trust':  ["  else if (CONFIG.autoTrust) autoTrust(name).catch(() => {});   // 11/15：恢复出来的窗口也要过信任框（主目录的信任不存）和可能有的首次向导，以前只有 newSession 点\n", ""],
  'no-flagged':          ["  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);", "  const flagged = false;"],
  'flag-all-invalid':    ["  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);", "  const flagged = d.error === 'invalid_request';"],
  'note-on-card':        ["  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });", "  launches.set(name, { at: Date.now(), prompt: text, cwd: dir, provider });"],
  'suggest-not-attached': ["sessions: sessions.map((x) => withAuto(withSuggest(x))), others: otherCount,", "sessions: sessions.map((x) => withAuto(x)), others: otherCount,"],
  'suggest-loop-off':    ["  fastLoop(); slowLoop(); suggestLoop();", "  fastLoop(); slowLoop();"],
  'suggest-plain-screen': ["['capture-pane', '-p', '-e', '-t', s.tmux]", "['capture-pane', '-p', '-t', s.tmux]"],
  'suggest-stale-kept':  ["  for (const k of [...suggests.keys()]) if (!names.has(k)) suggests.delete(k);", ""],
  // 自动收工（autoTidy）：每一道守卫、每一条线、两个开关，各有一个改坏版
  'auto-default-on':     ["  const def = { autoTrust: false, codex: false, autoTidy: false, tidyJudge: false, accounts: [], defaultAccount: '', judgeAccount: '', accountFallback: null, org: { ...ORG_DEF }, auto: parseAutoConfig(), remote: parseRemote(), apns: parseApns(), update: parseUpdateConf() };", "  const def = { autoTrust: false, codex: false, autoTidy: true, tidyJudge: false, accounts: [], defaultAccount: '', judgeAccount: '', accountFallback: null, org: { ...ORG_DEF }, auto: parseAutoConfig(), remote: parseRemote(), apns: parseApns(), update: parseUpdateConf() };"],
  'auto-config-ignored': ["    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: c.autoTidy === true, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, judgeAccount, accountFallback: fbr.fb, org, auto, update, remote: parseRemote(c.remote), apns: parseApns(c.apns) };   // remote / apns 写错各自关闭，不抛", "    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: false, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, judgeAccount, accountFallback: fbr.fb, org, auto, update, remote: parseRemote(c.remote), apns: parseApns(c.apns) };   // remote / apns 写错各自关闭，不抛"],
  // 'auto-ignores-focus' 11/17 car5 换成 tidy-archives-watching（他看着时小模型照问，只把「收」推后）
  'auto-acts-in-readonly': ["      if (READONLY) { const k = s.sid + '@' + s.resultAt;", "      if (false) { const k = s.sid + '@' + s.resultAt;"],
  'auto-stale-mark':     ["if (need === 'review' && p && p.at === String(s.resultAt) &&", "if (need === 'review' && p && true &&"],
  'auto-fyi-no-wait':    ["if (need === 'fyi' && quiet >= TIDY_FYI_MS)", "if (need === 'fyi' && quiet >= 0)"],
  'auto-review-short':   ["if (need === 'review' && quiet >= TIDY_REVIEW_MS)", "if (need === 'review' && quiet >= TIDY_FYI_MS)"],
  'auto-takes-reply':    ["if (need === 'review' && quiet >= TIDY_REVIEW_MS)", "if (quiet >= TIDY_REVIEW_MS)"],
  'auto-ignores-alert':  ["if (s.status !== 'idle' || s.ask || s.alert || !s.done", "if (s.status !== 'idle' || s.ask || !s.done"],
  'auto-takes-shell':    ["if (s.status !== 'idle' || s.ask || s.alert || !s.done", "if (s.ask || s.alert || !s.done"],
  'auto-reentrant':      ["  if (!CONFIG.autoTidy || tidyBusy) return;", "  if (!CONFIG.autoTidy) return;"],
  'auto-processed-replaces': ["      const okSid = (x) => typeof x === 'string'", "      processed.clear();\n      const okSid = (x) => typeof x === 'string'"],
  'auto-clear-ignored':  ["if (okSid(sid) && processed.delete(sid)) ch = true;", "if (okSid(sid) && false) ch = true;"],
  'auto-no-prune':       ["  if (Date.now() - PROC_T0 > 10000) { let pg = 0; for (const k of processed.keys()) if (!live.has(k)) { processed.delete(k); pg++; } if (pg) saveProcessed(); }", ""],
  // 新窗口的档位（route.mjs 接进 /api/new）：档位表本身的改坏对照在 route.test.mjs --mutants，这里只改坏服务的接线
  'route-not-wired':     ["{ provider: body.provider, model: rt.model, effort: rt.effort, account: body.account, fromUi: !!req.headers.origin, files: body.files,", "{ provider: body.provider, model: body.model, effort: body.effort, account: body.account, fromUi: !!req.headers.origin, files: body.files,"],
  'bad-tier-opens-window': ["      if (!rt.ok) return reply(res, 200, rt);\n", ""],
  'route-not-in-reply':  ["return reply(res, 200, r.ok && rt.tier ? { ...r, route: { tier: rt.tier, model: rt.model, effort: rt.effort, why: rt.why } } : r);", "return reply(res, 200, r);"],
  'route-not-logged':    ["if (rt.tier) console.log(`route ${new Date().toISOString()}", "if (false) console.log(`route ${new Date().toISOString()}"],
  // 派活单 brief 接进 /api/new（11/24 brief-v2）：七栏本身的改坏对照在 route.test.mjs --mutants，这里只改坏接线；[7g-2] 三种各两个
  'brief-not-checked':   ["      if (withBrief) {\n        const bf = briefNew(body.brief, rt, prompt);", "      if (false) {\n        const bf = briefNew(body.brief, rt, prompt);"],
  'brief-reject-opens':  ["problems=${bf.problems.length}`); return reply(res, 200, bf); }", "problems=${bf.problems.length}`); }"],
  'brief-no-rt':         ["const bf = briefNew(body.brief, rt, prompt);", "const bf = briefNew(body.brief, undefined, prompt);"],
  'brief-prompt-not-passed': ["const bf = briefNew(body.brief, rt, prompt);", "const bf = briefNew(body.brief, rt);"],   // FIX-1：不递 prompt，第二张派活单和超长都漏过去
  'brief-prompt-first':  ["prompt = bf.text + (prompt.trim() ? '\\n\\n' + prompt.trim() : '');", "prompt = (prompt.trim() ? prompt.trim() + '\\n\\n' : '') + bf.text;"],
  'brief-null-is-brief': ["const withBrief = body.brief != null;", "const withBrief = body.brief !== undefined;"],
  'brief-truthy':        ["const withBrief = body.brief != null;", "const withBrief = !!body.brief;"],   // FIX-1：brief 是 "" / false / 0 就当没带、照开空窗口
  'brief-flag-always':   ["if (r.ok && withBrief) r.brief = true;", "if (r.ok) r.brief = true;"],
  // 内置预览：第三项是要改坏的文件（不写就是 server.mjs）
  'preview-dotdirs':     ["if (parts.some((s) => !s || s.startsWith('.') ||", "if (parts.some((s) => !s || s === '..' ||", 'preview.mjs'],
  'preview-symlink-out': ["    if (!inside(it.root, real)) return null;", "", 'preview.mjs'],
  'preview-any-type':    ["const type = MIME[path.extname(real).slice(1).toLowerCase()];", "const type = MIME[path.extname(real).slice(1).toLowerCase()] || 'application/octet-stream';", 'preview.mjs'],
  'preview-deep-home':   ["const isShallow = (root) => homeIds(home).includes(idOf(root)) ||", "const isShallow = (root) => false ||", 'preview.mjs'],   // 11/25 起主目录和上层按 dev+ino 比（homeIds），拿掉这一半
  // 图集：文件夹里列哪些文件、什么样的文件夹才算图集、一批文件怎么合
  'gallery-symlink-out': [": inside(dir, real))) media.push", ": true)) media.push", 'preview.mjs'],
  'gallery-dotfiles':    ["    if (name.startsWith('.')) continue;\n", "", 'preview.mjs'],
  'gallery-no-min':      ["const GALLERY_MIN = 2, GALLERY_SHARE = 0.6;", "const GALLERY_MIN = 1, GALLERY_SHARE = 0.6;", 'preview.mjs'],
  'gallery-no-share':    ["const GALLERY_MIN = 2, GALLERY_SHARE = 0.6;", "const GALLERY_MIN = 2, GALLERY_SHARE = 0;", 'preview.mjs'],
  'gallery-no-cap':      ["const GALLERY_MAX = 200;", "const GALLERY_MAX = 100000;", 'preview.mjs'],
  'gallery-alpha-sort':  ["{ numeric: true, sensitivity: 'base' }", "{ sensitivity: 'base' }", 'preview.mjs'],
  'gallery-home':        ["    if (isShallow(dir)) return { ok: false, error: 'no-preview' };\n", "", 'preview.mjs'],
  'gallery-many-dup':    ["if (seen.has(real)) continue; seen.add(real);", "seen.add(real);", 'preview.mjs'],
  'gallery-many-hidden': ["if (!st.isFile() || !isMedia(kind) || name.startsWith('.')) {", "if (!st.isFile() || !isMedia(kind)) {", 'preview.mjs'],
  'gallery-many-nokey':  ["items.push({ name, kind, url: mediaUrl(claimDir(path.dirname(real)), name), dir: path.dirname(real) });", "items.push({ name, kind, url: mediaUrl(crypto.randomBytes(16).toString('hex'), name), dir: path.dirname(real) });", 'preview.mjs'],
  // 画布（11/24 canvas 车）：listCanvas 的规则（SPEC「服务端」五条）、文件夹先问图集、paths + canvas、vN.html 的 versions。[画布] 那一块抓
  'canvas-no-cap':       ['const CANVAS_MIN = 2, CANVAS_MAX = 12;', 'const CANVAS_MIN = 2, CANVAS_MAX = 100000;', 'preview.mjs'],
  'canvas-min-one':      ['const CANVAS_MIN = 2, CANVAS_MAX = 12;', 'const CANVAS_MIN = 1, CANVAS_MAX = 12;', 'preview.mjs'],
  'canvas-alpha-sort':   ["{ sensitivity: 'base', numeric: true }", "{ sensitivity: 'base' }", 'preview.mjs'],
  'canvas-repo':         ["  if (names.includes('package.json') || names.includes('.git')) return { error: 'no-preview' };\n", '', 'preview.mjs'],
  'canvas-symlink-out':  ['&& inside(dir, real)) pages.push', '&& true) pages.push', 'preview.mjs'],
  'canvas-dotfiles':     ["    if (name[0] === '.') continue;", '    if (false) continue;', 'preview.mjs'],
  'canvas-head-all':     ['const CANVAS_HEAD = 64 * 1024;', 'const CANVAS_HEAD = 1024 * 1024;', 'preview.mjs'],
  'canvas-frame-ignored': ["frame: fr === 'phone' || fr === 'browser' ? fr : PHONE_NAME.test(name)", 'frame: false ? fr : PHONE_NAME.test(name)', 'preview.mjs'],
  'canvas-before-gallery': ["const folder = (dir) => { const g = gallery(dir); return g.ok || g.error !== 'no-preview' ? g : canvas(dir); };", "const folder = (dir) => { const c = canvas(dir); return c.ok || c.error !== 'no-preview' ? c : gallery(dir); };", 'preview.mjs'],
  'canvas-home':         ["    if (isShallow(dir)) return { ok: false, error: 'no-preview' };   // 主目录、/tmp 不摊开\n", '', 'preview.mjs'],
  'canvas-many-dup':     ['      if (seen.has(real)) continue;                                  // 同一个文件只放一次\n', '', 'preview.mjs'],
  'canvas-many-hidden':  ["|| !isPage(kindOf(path.extname(real).slice(1))) || name.startsWith('.')) { skipped++; continue; }", '|| !isPage(kindOf(path.extname(real).slice(1)))) { skipped++; continue; }', 'preview.mjs'],
  'canvas-no-versions':  ['const vs = versionsOf(it.root, it.entry); if (vs) r.versions = vs;', 'const vs = null; if (vs) r.versions = vs;', 'preview.mjs'],
  'canvas-flag-ignored': ['const cv = body.canvas === true;', 'const cv = false;'],
  'canvas-one-dir':        ['let g = groups.get(dir); if (!g) groups.set(dir, (g = []));', 'let g = groups.get(\'\'); if (!g) groups.set(\'\', (g = []));', 'preview.mjs'],
  'canvas-split-msg':      ['(many.split ? \'这些网页不在同一个文件夹', '(false ? \'这些网页不在同一个文件夹'],
  'canvas-no-ver-exempt':  [' || versions >= CANVAS_MIN)) return', ')) return', 'preview.mjs'],
  'canvas-half-eq':        ['pages.length * 2 > files ||', 'pages.length * 2 >= files ||', 'preview.mjs'],
  'canvas-tmp-private':    ['(private|Volumes)', '(Volumes)', 'preview.mjs'],   // 11/25 起顶层是共用的 isTop：/private 下面不按 3 段算，/tmp 就不是顶层
  'canvas-home-key-deep':  ['byId.set(id, { root, entry: \'\', shallow: isShallow(root) });', 'byId.set(id, { root, entry: \'\', shallow: false });', 'preview.mjs'],
  'canvas-ver-oldest':     ['vs.slice(-CANVAS_MAX)', 'vs.slice(0, CANVAS_MAX)', 'preview.mjs'],
  'canvas-head-small':     ['const CANVAS_HEAD = 64 * 1024;', 'const CANVAS_HEAD = 32 * 1024;', 'preview.mjs'],
  'canvas-named-proto':    ['Object.hasOwn(NAMED, w.toLowerCase())', 'w.toLowerCase() in NAMED', 'preview.mjs'],
  'canvas-cut-units':      ['Array.from(unent(String(t || \'\')).replace(/\\s+/g, \' \').trim()).slice(0, n).join(\'\')', 'unent(String(t || \'\')).replace(/\\s+/g, \' \').trim().slice(0, n)', 'preview.mjs'],
  'canvas-ios-substr':     ['(?<![a-z])ios(?![a-z])', 'ios', 'preview.mjs'],
  'canvas-top-volumes':    ['(private|Volumes)', '(private)', 'preview.mjs'],
  'canvas-reg-js-realpath': ['    try { real = canon(file); st = fs.statSync(real); }', '    try { real = fs.realpathSync(file); st = fs.statSync(real); }', 'preview.mjs'],
  'canvas-ver-any-kind':   ['inside(root, r) && isPage(kindOf(path.extname(r).slice(1))) &&', 'inside(root, r) &&', 'preview.mjs'],
  'canvas-ver-no-dedupe':  ['&& !seen.has(r)) { seen.add(r); out.push(n); }', ') { seen.add(r); out.push(n); }', 'preview.mjs'],
  'canvas-first-group':    ['for (const g of groups.values()) if (g.length > pick.length) pick = g;', 'for (const g of groups.values()) { pick = g; break; }', 'preview.mjs'],
  'canvas-den-dirs':       ['    if (!st.isFile()) continue;\n    files++;\n    if (isPage(', '    files++;\n    if (!st.isFile()) continue;\n    if (isPage(', 'preview.mjs'],
  'canvas-den-dots':       ['    if (name[0] === \'.\') continue;', '    if (name[0] === \'.\') { files++; continue; }', 'preview.mjs'],
  'preview-any-host':    ["if (req.headers.host !== '127.0.0.1:' + bound && req.headers.host !== 'localhost:' + bound) return nope(403);", "", 'preview.mjs'],
  'preview-no-range':    ["if (m && (m[1] || m[2])) {", "if (false) {", 'preview.mjs'],
  'preview-any-entry':   ["export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || null;", "export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || 'text';", 'preview.mjs'],
  'preview-dir-entry':   ["const kind = st.isFile() ? kindOf(", "const kind = true ? kindOf(", 'preview.mjs'],
  'preview-case-ext':    ["KIND_OF[String(ext).toLowerCase()]", "KIND_OF[String(ext)]", 'preview.mjs'],
  'preview-text-uncut':  ["truncated: size > TEXT_MAX };", "truncated: false };", "preview.mjs"],
  'preview-new-url':     ["let id = byFile.get(real);", "let id = null;", 'preview.mjs'],
  'preview-referrer':    ["'referrer-policy': 'no-referrer',", "", 'preview.mjs'],
  'preview-no-esc-hook': ["  return i < 0 ? html + ESC_HOOK : html.slice(0, i) + ESC_HOOK + html.slice(i);", "  return html;", 'preview.mjs'],
  'preview-hook-first-body': ["html.toLowerCase().lastIndexOf('</body')", "html.toLowerCase().indexOf('</body')", 'preview.mjs'],
  // 每个会话的模型和强度（卡片右上角的胶囊）：只认主线上最近一条真回复，强度只认一个小写单词
  'model-from-synthetic': ["    if (m.model === '<synthetic>') {                       // 额度用完", "    if (m.model === '<synthetic>') { st.model = m.model;                       // 额度用完"],
  'model-from-sidechain': ["    case 'assistant': {\n      if (d.isSidechain) return;", "    case 'assistant': {\n      if (false) return;"],
  'effort-unchecked':    ["st.effort = typeof d.effort === 'string' && /^[a-z]{2,10}$/.test(d.effort) ? d.effort : null;", "st.effort = d.effort || null;"],
  'model-not-exported':  ["ask: st.ask ? askView(st.ask) : null, halt: st.halt, model: st.model, effort: st.effort,", "ask: st.ask ? askView(st.ask) : null, halt: st.halt,"],
  // 会话的临时目录：删掉的当场清、留着的满线才清、还在跑的不碰（服务刚起时 allSessions 还是空的，靠读会话登记）
  'tmp-drop-kept':       ["  saveArchive(); tracks.delete(sid); codexTracks.delete(sid); scanSessions();\n  purgeSessionTmp(sid);", "  saveArchive(); tracks.delete(sid); codexTracks.delete(sid); scanSessions();"],
  'tmp-keep-now':        ["Date.now() - (it.archivedAt || 0) > KEEP_TMP_MS", "Date.now() - (it.archivedAt || 0) > 0"],
  'tmp-no-sweep':        ["if (it.state === 'archived' && Date.now()", "if (false && it.state === 'archived' && Date.now()"],
  'tmp-live-guard':      ["if (!SID_RE.test(sid || '') || sidAlive(sid)) return 0;", "if (!SID_RE.test(sid || '')) return 0;"],
  'tmp-registry-guard':  ["  for (const f of regs) {", "  for (const f of []) {"],
  // 收之前看一眼（tidyJudge，11/15 win-2b）：[4d] 必须抓到
  'judge-review':        ["  else if (need === 'fyi' && quiet >= TIDY_SMART_MS && judgeOn()) d =", "  else if ((need === 'fyi' || need === 'review') && quiet >= TIDY_SMART_MS && judgeOn()) d ="],   // 11/17 car5 起这一行改成先定线再统一问
  'judge-reask': ["  if (!j || j.at !== String(s.resultAt)) return { line: 'judge', from: d.line };", "  if (!j || j.at !== String(s.resultAt) || !j.v) return { line: 'judge', from: d.line };"],
  'judge-fail-as-done': ["  judged.set(s.sid, { at, v, failAt: v ? 0 : Date.now(), quota: !v && quota, failWhy: !v && quota ? failWhy : '', owed: next, seen: Date.now() });", "  judged.set(s.sid, { at, v: v || { verdict: 'done', ask: null, why: '' }, failAt: 0, quota: false, failWhy: '', owed: next, seen: Date.now() });"],
  // 'judge-waiting-closes' 11/17 car5 拿掉：waiting 先被 hold 挡住，smart 线那一句只剩防竞态（判 yours 的回答到了、卡片还没改成待跟进的那一拍），改了也测不出来
  'judge-yours-hidden':  ["  for (const o of out) { applyJudged(o); applyAuto(o); }\n", "  for (const o of out) { applyAuto(o); }\n"],
  // 自动续跑的接线（11/16 win-60）：纯函数（autopilot.mjs）的改坏对照在 autopilot.test.mjs --mutants，这里只改坏服务接它的地方；[7e-2] 必须抓到
  'autocont-not-in-state':   ["sessions: sessions.map((x) => withAuto(withSuggest(x))), others: otherCount,", "sessions: sessions.map((x) => withSuggest(x)), others: otherCount,"],
  'autocont-config-ignored': ["    const auto = parseAutoConfig(c.autoContinue);\n", "    const auto = parseAutoConfig();\n"],
  'autocont-quota-ignored':  ["const q = b ? null : quotaHold(readTap(s.sid), LIMITS.claude, now, cf);", "const q = null;"],
  'autocont-hard-skipped':   ["      const h = hardStop(ghost);\n", "      const h = null;\n"],
  'autocont-yours-hidden':   ["  for (const o of out) { applyJudged(o); applyAuto(o); }\n", "  for (const o of out) { applyJudged(o); }\n"],
  'autocont-cancel-ignored': ["autoArmed.delete(sid); autoCanceled.set(sid, at); autoLog(s, 'cancel 你取消了');", "autoLog(s, 'cancel 你取消了');"],
  'autocont-runs-uncounted': ["const p = autoRuns.get(s.sid); autoRuns.set(s.sid, { n: (p ? p.n : 0) + 1, at: Date.now(), said: String(s.promptAt) });", ""],
  'autocont-runs-no-reset':  ["if (run0 && s.prompt && !isAutoPrompt(s.prompt) && String(s.promptAt) !== run0.said) autoRuns.delete(s.sid);", ""],
  'autocont-runs-by-clock':  ["String(s.promptAt) !== run0.said) autoRuns.delete(s.sid);", "(Date.parse(s.promptAt || '') || 0) > run0.at) autoRuns.delete(s.sid);"],
  'autocont-skip-ignored':   ["canceled: autoCanceled.get(s.sid), skip, chief });", "canceled: autoCanceled.get(s.sid), skip: null, chief });"],
  'autocont-no-mark':        ["const r = await sendTo(s.sid, autoMessage());", "const r = await sendTo(s.sid, '接着做你上一轮自己提的下一步');"],
  'autocont-now-ignored':    ["        fireAuto(withSuggest(s), a, true);\n", ""],
  // 11/17 修法（11/16 夜里 9f、b8 两条之后，cc-board-9e 转来）：[7e-2] 第 12–16 步必须抓到
  'autocont-review-allowed': ["if (s.digest.need !== 'fyi') return", "if (s.digest.need !== 'fyi' && s.digest.need !== 'review') return", 'autopilot.mjs'],   // 待审阅也自动发（9f 那条就是这样进来的）
  'autocont-self-allowed':   ["  if (SELF.test(t)) return { kind: 'never', why: SELF_WHY };", '', 'autopilot.mjs'],                                          // 灰字替他说「我听完了」也放行
  'autocont-self-yours':     ["if (SELF.test(t)) return { kind: 'never', why: SELF_WHY };", "if (SELF.test(t)) return { kind: 'yours', why: '建议里要你本人的结论或点头', ask: '你本人的结论或点头：' + t };", 'autopilot.mjs'],   // 重开前 ① 之前的样子：灰字替他下结论，卡片又被改成待跟进
  'autocont-config-not-reloaded': ["  if (Date.now() - autoCfg.at < AUTO_CFG_MS) return autoCfg.v;\n", "  return autoCfg.v;\n"],                                    // 只在启动时读一次 autoContinue
  'autocont-sends-ghost':    ["const r = await sendTo(s.sid, autoMessage());", "const r = await sendTo(s.sid, autoMessage() + '：' + a.ghost);"],              // 发出去的又带上灰字原文
  'autocont-counts-as-him':  ["      if (isAutoPrompt(text)) { st.turnBy = 'auto'; st.turnPeer = null; }", "      if (false) { st.turnBy = 'auto'; st.turnPeer = null; }"],
  'judge-ungated':       ["const judgeOn = () => CONFIG.tidyJudge && (", "const judgeOn = () => ("],
  // 架构视图的接线（11/15 org-chart）：规则本身（org.mjs）的改坏对照在 org.test.mjs --mutants，这里只改坏服务备料的地方；[1c]、[7h]、[8] 必须抓到
  'org-not-in-state':    ["      out.org = orgSafe();", ""],
  'org-head-words-dropped': [", leadWords: CONFIG.org.leadWords, headWords: CONFIG.org.headWords });", ", leadWords: CONFIG.org.leadWords });"],   // 11/17 分支负责人：服务没把 headWords 交给 org.mjs
  // 11/17 win-49：点名的负责人（org.seats）、「…分支」的默认字样
  'org-seats-not-passed':   ["seats, past, chiefWords:", "past, chiefWords:"],
  'org-seats-strict':       ["out.seats[k] = f; else out.seatsBad++;", "out.seats[k] = f; else throw new Error('org.seats 写错');"],
  'org-seats-uuid-ignored': ["if (p.ids.length && p.name) hit = byId.find((x) => nameIs(x, p.name)) || null;", "if (p.ids.length && p.name) hit = live.find((x) => nameIs(x, p.name)) || null;"],
  'org-seats-hex-only':     ["const UUID_RE = /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/gi;", "const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;"],   // 只认十六进制：夹具的会话号认不出，名字和会话号对不上时退不回去
  'tidy-seats-collected':   ["    if (role) { const k = 'seat:' + s.sid", "    if (false) { const k = 'seat:' + s.sid"],   // 自动收工照收坐在岗位上的窗口（分支负责人被当成做完了收掉的那种）
  // 11/17 car5（win-f7）：自动收工不收还有后续的窗口（作者 22:4x「不能在归档的时候，就把该做的直接自动收工了」）；[4c]、[4c2] 必须抓到
  'tidy-judge-smart-only':  ["  if (!d || !judgeOn()) return d;", "  if (!d || !judgeOn() || d.line !== 'smart') return d;"],   // 退回 car4：只有 smart 线问小模型，fast / fyi / review 只看时间
  'tidy-wait-passes':       ["  if (v !== 'done') return { line: 'hold'", "  if (v !== 'done' && v !== 'waiting') return { line: 'hold'"],   // 判成「它自己还有后续」照收
  'tidy-yours-passes':      ["  if (v !== 'done') return { line: 'hold'", "  if (v !== 'done' && v !== 'yours') return { line: 'hold'"],     // 判成「还有要你定的事」照收（fast 线上总管那条 5 次里有 1 次是 yours）
  'tidy-judge-fail-passes': ["  if (v !== 'done') return { line: 'hold'", "  if (v !== 'done' && v !== null) return { line: 'hold'"],        // 判不出来落在「放行」
  'tidy-spawn-ignored':     ["const nk = spawned(s.sid); if (nk)", "const nk = 0; if (nk)"],                                          // 它开的窗口还在墙上也收
  'tidy-hold-every-scan': ["const k = 'hold:' + s.sid + '@' + s.resultAt + ':' + why.slice(0, 6); if (!tidyLogged.has(k)) { tidyLogged.add(k);", "const k = ''; { "],   // hold 每次扫描都记一行
  'tidy-archives-watching': ["  if (!due.length || watching) return;", "  if (!due.length) return;"],                                    // 他正看着也收
  'judged-not-loaded':      ["  const j = JSON.parse(fs.readFileSync(JUDGED_FILE, 'utf8'));", "  const j = {};"],                                   // 重启后不读 judged.json：hold 跟着丢，重问一次等于重掷一次（复审 #2）
  'judged-no-owed':         ["earlier: owed ? owed.tail : '' }", "earlier: '' }"],                                                                 // 不带之前欠着的后续：后面一句「收到」把它冲掉（复审 #1）
  'judge-no-retry':         ["  if (!j.v && now - (j.failAt || 0) >= JUDGE_RETRY_MS) return { line: 'judge', from: d.line };", ""],                  // 判不出来的永远不再问（复审 #5）
  'judged-ro-writes':       ["function saveJudged() {\n  if (READONLY) return;", "function saveJudged() {\n  if (false) return;"],               // 只读服务也往 judged.json 写
  'tidy-no-judge-watching': ["const now = Date.now(), watching = now - uiFocusAt < 6000;", "const now = Date.now(), watching = now - uiFocusAt < 6000; if (watching) return;"],   // 他看着时小模型也不问：离开后一个个等回答，同一拍到点的分开收
  'org-seats-no-reload':    ["if (Date.now() - seatMemo.at < CHIEF_MS) return seatMemo.map;", "if (seatMemo.at) return seatMemo.map;"],
  'org-branch-tail-dropped': ["|head of|' + BRANCH_TAIL };", "|head of' };"],
  'org-branch-git-ok':      ["(?<!合并|合进|合入|并入|清理|删除|删掉|切换|切到|新建|新开|拉取|拉出|推送|远程|本地|临时|功能|特性|发布|开发|修复|热修|上线|回滚|[主旧切删拉推建合])分支", "分支"],
  'org-no-startedAt':    ["x.pid === p.pid && Number(x.startedAt) <= at", "x.pid === p.pid"],
  'org-name-not-unique': ["if (c.length === 1) return c[0].sid;", "if (c.length >= 1) return c[0].sid;"],
  'org-peer-turn-only':  ["        const p = notePeer(st, d);", "        const p = st.open ? null : notePeer(st, d);"],
  'org-human-ignored':   ["      st.human = { n: st.nHuman, last: Date.parse(d.timestamp) || 0 };", "      st.human = null;"],
  'org-for-lost':        ["st.turnPeer = p ? { pid: p.pid, name: p.name, at: Date.parse(d.timestamp) || 0 } : null; }", "st.turnPeer = null; }"],
  'org-chief-file-ignored': ["  const ch = chiefNow(), seats =", "  const ch = { sid: null, gen: null }, seats ="],
  'org-spawn-not-used':  ["by: spawnedBy(s.tmux) });", "by: null });"],
  'ctx-first-only':      ["        if (c > 0) st.ctx = c;", "        if (c > 0 && !st.ctx) st.ctx = c;"],
  'sub-idle-counted':    ["    if (!live) this.sub = 0;\n    else if (!this.codex", "    if (!this.codex"],
  'sub-any-file':        ["if (f.endsWith('.jsonl') && now - t < SUB_RECENT) n++;", "if (now - t < SUB_RECENT) n++;"],
  'spawn-origin-recorded': ["const who = req.headers.origin ? null : fromOk", "const who = false ? null : fromOk"],
  'spawn-from-unchecked': ["const fromOk = typeof body.from === 'string' && allSessions.some((x) => x.sid === body.from);", "const fromOk = typeof body.from === 'string';"],
  'spawn-no-lsof':       [": findCaller(req.socket.remotePort).then(", ": Promise.resolve(null).then("],
  'caller-no-deadline':  ["const findCaller = (port) => Promise.race([callerOf(port).catch(() => null), sleep(CALLER_MS).then(() => null)]);", "const findCaller = (port) => callerOf(port).catch(() => null);"],
  // 已经不在的发信人（gone 项，11/15 第二步）：[1c] 的 orgOld 必须抓到
  'org-gone-not-passed': ["  for (const g of ghostItems(ghosts)) list.push(g);", ""],
  'org-handed-dropped':  ["handed: !!n.handed,", "handed: false,"],
  'org-from-not-summed': ["const f = m.get(sid); if (f) { f.n += p.n;", "const f = m.get(sid); if (f) { f.n = p.n;"],
  'org-gone-in-ui-from': ["extra.set(s.sid, { from: [...known.values()]", "extra.set(s.sid, { from: [...known.values(), ...gone.values()]"],
  'org-gone-dept-lost':  ["out.push({ sid: GONE + pid, name: names.join(' '), title: '', dept,", "out.push({ sid: GONE + pid, name: names.join(' '), title: '', dept: '',"],
  // 不改脑子（P0-2，[9]）：起会话时往说明里塞东西、恢复时限工具、往主目录写 CLAUDE.md，都要变红
  'harness-append-prompt': ["    if (text) cl.push(text);", "    cl.push('--append-system-prompt', '你是 worker'); if (text) cl.push(text);"],
  'harness-resume-tools':  ["[await findClaude(), ...tail]", "[await findClaude(), '--disallowedTools', 'Agent', ...tail]"],
  'harness-writes-claude-md': ["  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });", "  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider }); try { fs.appendFileSync(path.join(HOME, 'CLAUDE.md'), '\\n- 每轮写状态行\\n'); } catch {}"],
  // 这一轮改了哪些文件 / 撞车提示（[1d]）：他本人开新的一轮不清单子、一轮做到一半别的窗口发来消息也清、撞车不看时间、只认 .git 是文件夹的仓库（worktree 认不出）
  'wrote-human-no-clear': ["      newTurnWrites(st, off);                                     // 他本人开了新的一轮", "      // 他本人开了新的一轮"],
  'wrote-peer-midturn':  ["        if (!st.open) newTurnWrites(st, off);", "        newTurnWrites(st, off);"],
  'collide-no-window':   ["      if (now - at > COLLIDE_MS) continue;", ""],
  'collide-gitdir-only': ["    if (fs.existsSync(path.join(d, '.git'))) { repo = d; break; }", "    if (fs.existsSync(path.join(d, '.git')) && fs.statSync(path.join(d, '.git')).isDirectory()) { repo = d; break; }"],
  // Codex 的补丁头（[1d] 里 Codex 那两条）：applyCodex 不记写；补丁头的路径不在反斜杠处断（真实 rollout 里补丁包在 exec 的 JS 源码里，换行是 \\n 两个字符）
  'codex-patch-ignored': ["      for (const f of patchFiles(p.input, p.arguments)) noteWrite(st, f, d.timestamp);", ""],
  'patch-escaped-nl':    ["([^\\n\\r\\\\\"]+)/g", "([^\\n\\r\\\"]+)/g"],
  // 评审之后补的（[1d] 的 Bash 和 Codex 新一轮）：Bash 里的写不认、heredoc 正文当成命令、Codex 他说了新的一句不清单子
  'bash-write-ignored':  ["for (const dir of bashWriteDirs(b.input.command, d.cwd)) noteWriteDir(st, dir, d.timestamp);   // Bash 里的 git", ";   // Bash 里的 git"],   // 11/17 Code Mode：noteVirtual 里有同样一句，原文带上后面的注释才只指 apply() 那一处
  'bash-heredoc-body':   ["if (m) end = m[2];", "if (m) end = null;"],
  'codex-turn-no-clear': ["if (text.trim() && !codexInjected(text)) newTurnWrites(st, off);", ";"],
  // 只回变过的（拉数据瘦身，[2v]）：不认 v（每次整份）、不带 v 的老读法也走新格式、quiet 也算变了、不给 gone、不给 ids、全局字段每次都给、不认启动号
  'delta-ignored':        ["      if (u.searchParams.has('v')) return reply(res, 200, stateSince(out, u.searchParams.get('v')));", ""],
  'delta-legacy-changed': ["      if (u.searchParams.has('v')) return reply(res, 200, stateSince(out, u.searchParams.get('v')));", "      return reply(res, 200, stateSince(out, u.searchParams.get('v')));"],
  'delta-quiet-counts':   ["const j = JSON.stringify({ ...s, quiet: undefined }), c = stSess.get(s.sid);", "const j = JSON.stringify(s), c = stSess.get(s.sid);"],
  'delta-no-gone':        ["  for (const [sid, a] of stGone) if (a > base) d.gone.push(sid);\n", ""],
  'delta-no-ids':         ["  const glob = { ids: out.sessions.map((s) => s.sid) };", "  const glob = {};"],
  'delta-globals-always': ["  for (const [k, c] of stGlob) if (c.at > base) d[k]", "  for (const [k, c] of stGlob) if (c.at > -1) d[k]"],
  'delta-no-boot':        ["base = m && m[1] === ST_BOOT ? Number(m[2]) : -1;", "base = m ? Number(m[2]) : -1;"],
  // 审查后加（fable 11/17 15:1x）：全局字段变了也不给（只给 ids）、不认「比忘掉的还早」（stFloor）
  'delta-globals-never':  ["  for (const [k, c] of stGlob) if (c.at > base) d[k] = glob[k] ?? null;", "  for (const [k, c] of stGlob) if (c.at > base && k === 'ids') d[k] = glob[k] ?? null;"],
  'delta-no-floor':       ["if (base < stFloor || base > stSeq) return", "if (base > stSeq) return"],
  // 先放着带时间（[3s]）：不存文件（重启丢推迟）、什么交付都叫醒、新的待跟进不叫醒、等你选不叫醒、到点不醒、刚发了话也让推迟、/api/state 不带 snooze
  'snooze-not-saved':     ["snoozes[sid] = { until: Math.round(until), at: String(s.resultAt), setAt: now, ask }; saveSnoozes();", "snoozes[sid] = { until: Math.round(until), at: String(s.resultAt), setAt: now, ask };"],
  'snooze-wakes-any':     ["if (s.done && s.resultAt && String(s.resultAt) !== z.at && s.digest && s.digest.need === 'reply') return 'reply';", "if (s.done && s.resultAt && String(s.resultAt) !== z.at) return 'reply';"],
  'snooze-no-wake-reply': ["if (s.done && s.resultAt && String(s.resultAt) !== z.at && s.digest && s.digest.need === 'reply') return 'reply';", ";"],
  'snooze-no-wake-ask':   ["  if (s.status === 'waiting' || s.ask) return 'ask';\n", ""],
  'snooze-no-due':        ["const s = by.get(sid), why = !(now < z.until) ? 'due' : s ? snoozeWake(s, z, now) : null;", "const s = by.get(sid), why = s && now < z.until ? snoozeWake(s, z, now) : null;"],
  'snooze-allows-sent':   ["if (s.status === 'busy' || !(s.done && s.result && s.resultAt) || (s.promptAt && Date.parse(s.promptAt) > Date.parse(s.resultAt))) return", "if (false) return"],
  'snooze-not-in-state':  ["      out.sessions = out.sessions.map(withSnooze);", "      ;"],
  // 审查后加（fable 11/17 16:0x）：他回了话不醒、到点不把被盖住的那件事翻回来、不核界面看到的那一次交付
  'snooze-no-wake-you':   ["  if (s.promptAt && Date.parse(s.promptAt) > Date.parse(z.at) && !isAutoPrompt(s.prompt || '')) return 'you';", "  ;"],
  'snooze-no-raise':      ["  for (const o of out) applyRaised(o);", "  ;"],
  'snooze-ignores-at':    ["if (body.at !== undefined && String(body.at) !== String(s.resultAt)) return", "if (false) return"],
  // 通知的门（[4n]）：重复发、待跟进不等站稳 / 又动了照发、推迟中照发、不发待跟进 / 等你选、登记读坏一轮就忘、翻回来的那件又发（no-baseline、interrupt-notifies 跟着新写法改了原文）
  'notify-repeat':        ["      if (done[slot] === n.key) continue;", "      ;"],
  'reply-busy-counts':    [" && s.status !== 'busy') out.push({ slot: 'reply'", ") out.push({ slot: 'reply'"],
  'reply-no-wait':        ["? REPLY_SHELL_MS : 5000,", "? REPLY_SHELL_MS : 0,"],
  'snooze-notifies':      ["    if (z && !snoozeWake(s, z, now)) {", "    if (false) {"],
  'reply-not-notified':   ["  else if (!s.alert && s.done && s.resultAt && s.digest", "  else if (false && s.digest"],
  'ask-not-notified':     ["  if (asking(s)) out.push({ slot: 'ask'", "  if (false) out.push({ slot: 'ask'"],
  'alert-forget-at-once': ["{ const g = alertGone.get(k); if (!g) alertGone.set(k, now); else if (now - g > ALERT_FORGET_MS) {", "{ {"],
  'notify-raised':        [" && !s.digest.raised &&", " &&"],
  // 审查后加（fable 11/17 16:5x）：后台在跑不多等、推迟中连停住了也记成已知道、推迟的那件到点又发、等你选登记一重写就算新的、发过以后 busy 一下回来又发、重启不认 notified.json
  'reply-shell-no-wait':  ["wait: s.status === 'shell' ? REPLY_SHELL_MS", "wait: s.status === 'shell' ? 5000"],
  'snooze-consumes-alert': ["const r = ns.find((n) => n.slot === 'reply'); if (r) done.reply = r.key;", "for (const n of ns) done[n.slot] = n.key;"],
  'snooze-no-consume':    ["const r = ns.find((n) => n.slot === 'reply'); if (r) done.reply = r.key;", ";"],
  'ask-no-episode':       ["  let k = askEp.get(s.sid);", "  let k = null;"],
  'notify-forget-on-busy': ["      if (!n) { alertHold.delete(hk); continue; }", "      if (!n) { alertHold.delete(hk); done[slot] = null; continue; }"],
  'notified-not-saved':   ["  if (replyDisk.has(s.sid) && !stale) b.reply = replyDisk.get(s.sid);", "  ;"],
  // 复审后加（fable 11/17 17:1x）：盘上那份当成都没发过（重启全部重发）、太旧的交付也看盘、后台跑完 idle 一拍不从头站稳
  'notified-reply-null':  ["  if (replyDisk.has(s.sid) && !stale) b.reply = replyDisk.get(s.sid);", "  if (replyDisk.has(s.sid) && !stale) b.reply = null;"],
  'stale-disk-trusted':   [" && !stale) b.reply = replyDisk.get(s.sid);", ") b.reply = replyDisk.get(s.sid);"],
  'shell-hold-no-reset':  ["|| h.key !== n.key || h.wait !== n.wait) {", "|| h.key !== n.key) {"],
  // Code Mode（11/17）：开窗口和接回的环境变量、codeMode 字段、记录里的虚拟调用（state.test.mjs 的 [1e]、[7m]、[9] 核环境那一项）
  "codemode-new-no-env": ["args.push(...wrapLaunch(acct, opt.codeMode === true ? withCodeMode(cl) : cl));", "args.push(...wrapLaunch(acct, cl));"],
  "codemode-new-always": ["args.push(...wrapLaunch(acct, opt.codeMode === true ? withCodeMode(cl) : cl));", "args.push(...wrapLaunch(acct, withCodeMode(cl)));"],
  "codemode-codex-ignored": ["  if (opt.codeMode === true && provider !== 'claude') return { ok: false, error: 'Code Mode 只有 Claude Code 有' };", ""],
  "codemode-type-unchecked": ["if (body.codeMode != null && typeof body.codeMode !== 'boolean') return reply(res, 200, { ok: false, error: 'codeMode 只能是 true 或 false' });", ""],
  "codemode-resume-ignored": ["  const cm = it.provider !== 'codex' && await lastReplMode(it.file || locate(sid, it.cwd), sid);", "  const cm = false;"],
  "codemode-resume-any-true": ["if (d && d.type === 'repl-mode') return d.replMode === true;", "if (d && d.type === 'repl-mode' && d.replMode === true) return true;"],
  "codemode-read-fail-on": ["接回不带 Code Mode`); return false; };", "接回不带 Code Mode`); return true; };"],
  "codemode-quote-counts": ["if (d && d.type === 'repl-mode') return d.replMode === true;", "if (d) return /\"replMode\":true/.test(line);"],
  "codemode-repl-sticky": ["case 'repl-mode': st.codeMode = d.replMode === true; return;", "case 'repl-mode': st.codeMode = st.codeMode || d.replMode === true; return;"],
  "codemode-state-missing": ["      codeMode: st.codeMode === true,", ""],
  "codemode-virtual-ignored": ["        } else if (d.isVirtual === true) noteVirtual(st, d, m);", "        }"],
  "codemode-virtual-as-real": ["if (m.model === '<synthetic>') {", "if (m.model === '<synthetic>' && !d.isVirtual) {"],
  "codemode-virtual-touches-turn": ["    st.steps++; noteTool(st.files, b.input);\n", "    st.steps++; st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);\n"],
  "codemode-virtual-no-edits": ["noteTool(st.files, b.input);\n    st.nTools++; if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) st.nEdits++;", "noteTool(st.files, b.input);\n    st.nTools++;"],
  "codemode-virtual-no-wrote": ["\n    if (WRITE_TOOLS.test(b.name) && b.input) noteWrite(st, b.input.file_path || b.input.notebook_path, d.timestamp);\n", "\n"],
  "codemode-poll-replaces": ["if (b.name !== 'Poll') st.tool = toolLine(b);", "st.tool = toolLine(b);"],
  "codemode-repl-no-desc": ["    case 'REPL': return i.description || '跑脚本';", "    case 'REPL': return '跑脚本';"],
  "codemode-turns-virtual-ignored": ["for (const b of d.message.content) if (b && b.type === 'tool_use') cur.steps++;   // Code Mode", "for (const b of []) cur.steps++;   // Code Mode"],
  // 评审（11/17 23:5x）补的三个守卫：跨块时丢掉后一块开头那半行 / 碰到嵌着 repl-mode 对象的记录就当成 false / 脚本里跑的 Bash 的写不进撞车
  "codemode-carry-dropped": ["carry = start > 0 ? all.subarray(0, cut) : Buffer.alloc(0); end = start;", "carry = Buffer.alloc(0); end = start;"],
  "codemode-nested-false": ["if (d && d.type === 'repl-mode') return d.replMode === true;", "if (d) return d.type === 'repl-mode' && d.replMode === true;"],
  "codemode-virtual-bash-ignored": ["    if (b.name === 'Bash' && b.input) for (const dir of bashWriteDirs(b.input.command, d.cwd)) noteWriteDir(st, dir, d.timestamp);\n  }\n}\n", "  }\n}\n"],
  // 手机远程（11/17，[10]）：每个都拿掉一道拦。接线的改 server.mjs；remote.mjs 里的规则另有 remote.test.mjs --mutants 19 个，这里挑 6 个核端到端也抓得到
  'remote-allow-all':      ["        if (!allowed(req.method, u.pathname)) {", "        if (false) {"],
  'remote-no-device':      ["        const c = checkDevice(devices, req.headers['x-ccboard-device'], rem.login);", "        const c = { dev: devices.values().next().value || { id: 'x' } };"],
  'remote-page-token':     ["utf8').replace('__TOKEN__', '');   // 先读再写头", "utf8').replace('__TOKEN__', TOKEN);   // 先读再写头"],
  'remote-code-reusable':  ["      pairing = null;                                // 用一次就作废\n", ""],
  'remote-revoke-noop':    ["      devices.delete(id); devSeen.delete(id);", "      devSeen.delete(id);"],
  'remote-pair-any-origin': ["      if (!fromBoard(req)) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });\n      if (body.cancel === true)", "      if (body.cancel === true)"],
  'remote-log-code':       ["      remoteLog(`pair 出了一个配对码（", "      remoteLog(url + `pair 出了一个配对码（"],
  'remote-list-hash':      [".map((d) => ({ id: d.id, name: d.name, login: d.login, at: d.at,", ".map((d) => ({ hash: d.hash, id: d.id, name: d.name, login: d.login, at: d.at,"],
  'remote-not-peek':       ["      const peek = u.searchParams.get('peek') === '1' || !!rem;", "      const peek = u.searchParams.get('peek') === '1';"],
  'remote-stores-secret':  ["dev: { id, name: devName(name), login, hash: hashOf(secret), at: now }", "dev: { id, name: devName(name), login, hash: hashOf(secret), secret, at: now }", 'remote.mjs'],
  'remote-proxied-local':  ["LOCAL_HOST.test(host) && !proxied(h) ?", "LOCAL_HOST.test(host) ?", 'remote.mjs'],
  'remote-no-login':       ["  if (typeof login !== 'string' || !LOGIN.test(login)) return { deny: 'no tailscale login' };", "", 'remote.mjs'],
  'remote-host-any-tsnet': ["  if (!R.hosts.includes(hn)) return { deny: 'bad host' };", "  if (!hn.endsWith('.ts.net')) return { deny: 'bad host' };", 'remote.mjs'],
  'remote-no-expiry':      ["  if (!(now < slot.exp)) return { deny: 'expired', burn: true };", "", 'remote.mjs'],
  'remote-secret-unchecked': ["  if (!sameHash(hashOf(m[2]), d.hash)) return { deny: 'bad device' };", "", 'remote.mjs'],
  // 11/17 晚（win-75，审查 M1 M2 M3 L5 L6 之后）：远程端口当本机、在途请求不再核、写盘失败不报、不重试、远程动作不留痕、页面能被嵌
  'remote-port-is-local':  ["http.createServer((req, res) => handle(req, res, 'remote'));", "http.createServer((req, res) => handle(req, res, 'local'));"],
  'remote-inflight-ok':    ["      if (devices.get(rem.dev.id) !== rem.dev) {", "      if (false) {"],
  'remote-revoke-save-silent': ["        return reply(res, 200, { ok: false, error: '已经不认这台了", "        return reply(res, 200, { ok: true, error: '已经不认这台了"],
  'remote-no-retry':       ["if (REMOTE.on && !READONLY) setInterval(() => { if (devDirty) saveDevices(); }, DEV_RETRY_MS).unref();", ""],
  'remote-act-unlogged':   ["      remoteLog(`act ${rem.dev.id}", "      void (`act ${rem.dev.id}"],
  'remote-local-port-tsnet': ["  if (via === 'local') return LOCAL_HOST.test(host)", "  if (via === 'local' && R && R.on && R.hosts.includes(host.toLowerCase())) via = 'remote';\n  if (via === 'local') return LOCAL_HOST.test(host)", 'remote.mjs'],   // 4747 上 remote 开着时也认名单里的名字：守「发到 4747 → bad host」那几条（它们在旧代码上也是绿的）
  // 23:2x 复审 N1 N2 N3 S3：端口被占还出码、占着的走了不再听、端口写错照样去听、写盘失败不挪旧表、sid 原样进日志
  'remote-pair-when-down': ["      if (remoteDown) return reply(res, 200, { ok: false, error: '远程端口没听上", "      if (false) return reply(res, 200, { ok: false, error: '远程端口没听上"],
  'remote-no-relisten':    ["      setTimeout(tryListen, REMOTE_RETRY_MS).unref();", ""],
  'remote-bad-port-listens': ["  if (REMOTE.on && REMOTE_PORT_BAD) {", "  if (false) {"],
  'remote-no-stale':       ["        try { fs.renameSync(DEV_FILE, DEV_FILE + '.stale'); } catch {}\n", ""],
  'remote-sid-raw':        ["const sid8 = (/^[\\w-]{1,8}/.exec(typeof body.sid === 'string' ? body.sid : '') || [''])[0];", "const sid8 = String(body.sid || '').slice(0, 8);"],
  'remote-page-framable':  [", 'content-security-policy': \"frame-ancestors 'none'\" });", " });"],
  // 11/18「审完了」跨设备（[3p]、[10] 末尾）：/api/state 不带 processed、不比这一次交付的时间、不在墙上的也给、只给本机端口（手机读不到）
  'processed-not-sent':    ["      out.processed = processedView(out.sessions);", "      void processedView;"],
  'processed-any-at':      ["if (p && x.resultAt && p.at === String(x.resultAt)) o[x.sid] = p.at;", "if (p) o[x.sid] = p.at;"],
  'processed-off-wall':    ["  for (const x of [...list].sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0))) { const p = processed.get(x.sid); if (p && x.resultAt && p.at === String(x.resultAt)) o[x.sid] = p.at; }",
                            "  for (const [sid, p] of processed) { const x = list.find((y) => y.sid === sid); if (!x || (x.resultAt && p.at === String(x.resultAt))) o[sid] = p.at; }"],
  'processed-local-only':  ["      out.processed = processedView(out.sessions);", "      if (!rem) out.processed = processedView(out.sessions);"],
  'processed-not-saved':   ["  if (READONLY) return;\n  const out = {}; for (const [k, p] of processed)", "  return;\n  const out = {}; for (const [k, p] of processed)"],
  'processed-not-loaded':  ["typeof at === 'string') processed.set(k, { at, seenAt: PROC_T0 });", "typeof at === 'string') void 0;"],
  // 预计交付（11/18）：每个都由 [1g] 抓到
  "eta-ignored": ["const eta = etaIn(b.text); if (eta) st.eta = { at: d.timestamp, mins: eta };", ";"],
  "eta-not-cleared": ["st.turnOff = off; st.eta = null; }", "st.turnOff = off; }"],
  "eta-first-wins": ["if (n > 0 && n <= 1440) out = Math.round(n * 10) / 10;", "if (n > 0 && n <= 1440 && out === null) out = Math.round(n * 10) / 10;"],
  "eta-anywhere": ["const ETA_RE = /^[ \\t]*[`*]{0,2}【预计】", "const ETA_RE = /[`*]{0,2}【预计】"],
  "eta-range-low": ["Number(m[2] || m[1])", "Number(m[1])"],
  "eta-no-hours": [" * (/^(小时|h)/.test(m[3]) ? 60 : 1)", ""],
  "eta-no-cap": ["if (n > 0 && n <= 1440) out", "if (n > 0) out"],
  "eta-wake-clears": ["st.turnAt = d.timestamp; st.steps = 0; st.open = true; }   // halt 不清", "st.turnAt = d.timestamp; st.steps = 0; st.open = true; st.eta = null; }   // halt 不清"],
  "eta-codex-event-ignored": ["st.lastText = st.note; const eta = etaIn(st.note); if (eta) st.eta = { at: d.timestamp, mins: eta }; }", "st.lastText = st.note; }"],
  "eta-codex-message-ignored": ["if (st.busy) { st.note = text; st.noteAt = d.timestamp; } const eta = etaIn(text); if (eta) st.eta = { at: d.timestamp, mins: eta }; }", "if (st.busy) { st.note = text; st.noteAt = d.timestamp; } }"],
  "eta-not-exported": ["      eta: st.eta || null,                                // 它自己报的预计", "      eta: null,                                // 它自己报的预计"],
  "eta-codex-not-exported": ["codeMode: false, eta: st.eta || null };", "codeMode: false, eta: null };"],
  // 11/18 新开的会话一开就退了（[7r]）：开完不再多看那一会儿（晚一点退的那种 has-session 早过了的看不出来）、新任务不重开、两次都退还问套接字、重开前不重新找 claude
  'launch-no-settle':      ["  const settle = Date.now() + SETTLE_MS;", "  const settle = 0;"],
  'launch-no-respawn':     ["  if (r.gone && cl) { args[args.length - cl.length]", "  if (false) { args[args.length - cl.length]"],
  'launch-gone-says-socket': ["const GONE_MSG = '会话一开就退了（claude 可能正在更新），重开一次也没起来，过一会儿再试';", "const GONE_MSG = 'tmux 没开出会话（套接字目录 ' + TMUX_DIR + ' 还在吗？）';"],
  'launch-cached-claude':  ["  await sleep(RESPAWN_MS); claudeBin = null;", "  await sleep(RESPAWN_MS);"],
  // 远程预览（C1，11/21）：每道闸一个。原文都在 server.mjs 里正好一处（11/22 修一 rp-fix 换了写法的跟着换原文，见 test/CLAUDE.md）
  'rp-user-text-counted':  ["readTurns(file, 40)) for (const r of t.results || []) raws.push(...pathsIn(r.text));", "readTurns(file, 40)) { raws.push(...pathsIn(t.prompt)); for (const r of t.results || []) raws.push(...pathsIn(r.text)); }"],
  'rp-no-evidence':        ["  if (!ev.real.has(x.real)) return { why: 'not-in-conversation' };\n", "\n"],
  'rp-lexical-evidence':   ["  if (!ev.real.has(x.real)) return { why: 'not-in-conversation' };\n", "  if (!ev.abs.has(x.n) && !ev.real.has(x.n)) return { why: 'not-in-conversation' };\n"],
  'rp-link-allowed':       ["  if (x.link) return { why: ev.real.has(x.real) || ev.linked.has(x.real) ? 'link' : 'not-in-conversation' };", ""],
  'rp-hidden-skipped':     ["  if (hiddenPath(real, HOME_REAL)) return { why: 'hidden' };", ""],
  'rp-probe-order':        ["if (!x.real) return { why: ev.abs.has(x.n) ? 'missing' : 'not-in-conversation' };", "if (!x.real) return { why: 'missing' };"],
  'rp-any-session':        ["      const ev = sid ? rpEvidence(sid) : null;", "      const ev = sid ? [...tracks.keys()].map(rpEvidence).filter(Boolean).reduce((a, b) => ({ abs: new Set([...a.abs, ...b.abs]), real: new Set([...a.real, ...b.real]), linked: new Set([...a.linked, ...b.linked]) }), { abs: new Set(), real: new Set(), linked: new Set() }) : null;"],
  'rp-wrote-ignored':      ["  if (tr && tr.st && tr.st.wrote && cur) {", "  if (false) {"],
  'rp-gallery-unchecked':  ["          const f = rpFile(raw, ev);", "          const f = (() => { try { const real = fs.realpathSync(String(raw)); return { real, kind: kindOf(path.extname(real).slice(1)), name: path.basename(real), dir: path.dirname(real) }; } catch { return { why: 'missing' }; } })();"],
  'rp-key-unchecked':      ["  if (!rpKeyOk(it, devices, rem.login, Date.now())) {", "  if (!it) {"],
  'rp-name-unchecked':     ["  if (name !== it.name || !type) return nope();", "  if (!type) return nope();"],
  'rp-real-unchecked':     ["if (!st || !st.isFile() || st.dev + ':' + st.ino !== fid)", "if (!st || !st.isFile())"],
  'rp-csp-same-origin':    ["\"sandbox allow-scripts allow-popups allow-forms; frame-ancestors 'self'\"", "\"sandbox allow-scripts allow-same-origin allow-popups allow-forms; frame-ancestors 'self'\""],
  'rp-csp-no-sandbox':     ["\"sandbox allow-scripts allow-popups allow-forms; frame-ancestors 'self'\"", "\"frame-ancestors 'self'\""],
  'rp-ttl-ignored':        ["const RP_MS = (SANDBOX && Number(process.env.CCBOARD_RP_TTL_MS)) || RP_TTL;", "const RP_MS = RP_TTL;"],
  // C1.1 文件夹图集（11/21）
  'rp-dir-home':           ["  if (id === home[0]) return { why: 'shallow' };", "", 'server.mjs'],
  'rp-dir-private-top':    ["(/^\\/(private|Volumes)\\//.test(top) ? 3 : 2)", "2", 'preview.mjs'],   // 11/25 这一行挪进 preview.mjs 的 isTop（本机和远程共用）
  'rp-dir-links':          ["listGallery(dir, { direct: true })", "listGallery(dir)", 'server.mjs'],
  'rp-dir-parent-evidence':["if (x.real) (x.link ? linked : real).add(x.real); }", "if (x.real) { (x.link ? linked : real).add(x.real); real.add(path.dirname(x.real)); } }", 'server.mjs'],
  'rp-dir-no-log':         ["remoteLog(`rpreview ${rem.dev.id} ${sid8} ok folder ${items.length}`);", "", 'server.mjs'],
  // 11/22 修一（rp-fix，1b 验收的五处）：每道新的闸一个，各由 state.test [10] 里守它的那条抓
  'rp-dir-home-parent':    ["  if (home.slice(1).includes(id)) return { why: 'shallow' };", "", 'server.mjs'],                              // 只拿掉「主目录的上层」那一句（rp-dir-home 只拿掉主目录本身）
  'rp-canon-case':         ["  const r = fs.realpathSync.native(p);", "  const r = fs.realpathSync(p);", 'preview.mjs'],                                // 真身不收大小写：写到的图换大小写要就对不上
  'rp-canon-firm':         ["  if (!r.startsWith(FIRM + '/')) return r;", "  return r;", 'preview.mjs'],                                             // firmlink 别名不收成短写法
  'rp-link-target-evidence': ["if (x.real) (x.link ? linked : real).add(x.real); }", "if (x.real) real.add(x.real); }", 'server.mjs'],         // 写到的链接，把它指去的地方也算写到（修之前的样子）
  'rp-no-normalize':       ["  const n = path.resolve(p); let ls, real, st;", "  const n = p; let ls, real, st;", 'server.mjs'],                   // 不先按字面规整：结尾 /. 绕过「本身是链接」
  'rp-log-key':            [".replace(/(?:[0-9a-f]|%(?:3[0-9]|[46][1-6])){16,}/gi, '<key>')", "", 'server.mjs'],                                // 日志路径不遮钥匙
  'rp-pdf-inline':         ["...(type === 'application/pdf' ? { 'content-disposition': rpAttach(it.name) } : {})", "...{}", 'server.mjs'],         // PDF 不按附件发
  'launch-gone-midexit':   ["|server exited unexpectedly|no current target/;", "/;"],   // [7r] 关到一半（11/19）：has-session 回这两句也算一开就退
  // 11/22 检查新版本的接线（[8u]）：不看 config 的 updateCheck（update.mjs 的 tick 自己也看 conf.check，所以 [8u] 另核日志和 /api/update/check）；不看有没有 .bundle-version
  'update-check-gate-dropped': ["const updater = UPDATE_CUR && CONFIG.update.check && !READONLY", "const updater = UPDATE_CUR && !READONLY"],
  'update-stamp-gate-dropped': ["const updater = UPDATE_CUR && CONFIG.update.check", "const updater = CONFIG.update.check"],
  // 11/24 新窗口的名字（[7n]）：不看 nameHold（两个同时进来的 /api/new 都拿到同一个空名字）；死掉的登记也算有人在用（256 个里空的那个被占，退到 4 位）
  'name-no-hold':        ["  const used = liveNames(); for (const k of nameHold.keys()) used.add(k);", "  const used = liveNames();"],
  'name-dead-counts':    ["Number.isInteger(d.pid) && alive(d.pid)) out.add(normName(d.name));", "Number.isInteger(d.pid)) out.add(normName(d.name));"],
  // 11/24 远程图集列完再绑钥匙（[10] 的固定竞态 A / B）：绑钥匙按完整路径打开（chdir 了却不按相对路径，路径一换就绑到别处）；不核钉住的「.」是不是核过的那个文件夹；
  // 只调顺序（还按路径逐张 lstat，把核文件夹挪到后面：test/known-red 留下的那句「只调顺序不算修好」）
  'rp-gal-bind-path':    ["fd = fs.openSync(m.name, fs.constants.O_RDONLY", "fd = fs.openSync(path.join(dir, m.name), fs.constants.O_RDONLY", 'server.mjs'],
  'rp-gal-no-pin':       ["    if (idOf('.') !== id) return null;\n", "", 'server.mjs'],
  // 11/24 返修：不看 chdir 以后内核给的 cwd（[10] 的 P：rpResolve 查的几次之间换上一层）。rp-gal-no-pin 有了 cwd 这一道以后 A 也拦得住，靠 R（同一路径换成另一个真文件夹）抓
  'rp-gal-no-cwd':       ["    if (here !== dir) return null;", "", 'server.mjs'],
  // 11/24 返修 S2（[7n] 末尾）：--help 里有没有 --name 不看（不认也照传）；从来不传；不缓存（每次开窗口都问）；不认 --name 时接回丢了 --resume
  'name-help-ignored':   [String.raw`const has = r.ok && /(^|[\s,])--name\b/m.test(r.out);`, 'const has = r.ok;', 'server.mjs'],
  'name-help-never':     [String.raw`const has = r.ok && /(^|[\s,])--name\b/m.test(r.out);`, 'const has = false;', 'server.mjs'],
  'name-help-no-cache':  ['  if (nameFlag.bin === bin) return nameFlag.has;\n', '', 'server.mjs'],
  'name-resume-no-fallback': [": ['--resume', sid];   // --name 在 --resume 前面", ": [sid];   // --name 在 --resume 前面", 'server.mjs'],
  // 11/24 收起时钉住哪几条（[7f] 末尾、[8c] 的 server8c3 / server8c4）：limits.pin 不进 /api/state；不看 config 的 limitsPin；默认不算 defaultAccount 那条；limitsPin 写错整份 config 不用
  'limits-pin-unwired':  [', pin: limitPins(claude, { pin: CONFIG.limitsPin, defaultAccount: CONFIG.defaultAccount }) };', ' };'],
  'limits-pin-config-dropped': ['pin: CONFIG.limitsPin, defaultAccount', 'pin: null, defaultAccount'],
  'limits-pin-default-dropped': [', defaultAccount: CONFIG.defaultAccount }) }', ' }) }'],
  'limits-pin-bad-kills-config': ['if (lp.error) console.log(', "if (lp.error) throw new Error('limitsPin'); if (lp.error) console.log("],
  'rp-gal-order-only':   ["  if (idOf(dir) !== id) return { why: 'missing' };                    // 列的时候文件夹被换掉了：不给\n  const media = rpBind(dir, id, g.media);", "  const media = []; for (const m of g.media) { let s; try { s = fs.lstatSync(m.real, { bigint: true }); } catch { continue; } if (s.isFile()) media.push({ ...m, id: s.dev + ':' + s.ino }); }\n  if (idOf(dir) !== id) return { why: 'missing' };", 'server.mjs'],
};
for (const [name, [a, , f = 'server.mjs']] of Object.entries(MUTANTS)) { const n = SRC[f].split(a).length - 1; if (n !== 1) throw new Error(`${name}: 要替换的原文在 ${f} 里出现 ${n} 次（应当正好 1 次）`); }
// 这一次运行自己的临时目录（11/22 修：原来几份同时跑共用 test/.tmp/mutants，先跑完的一份把别人的改坏版删了）。原文核对过了才建，核不过不留空目录
fs.mkdirSync(path.join(HERE, '.tmp'), { recursive: true }); const TMP = fs.mkdtempSync(path.join(HERE, '.tmp', 'mutants-'));
fs.copyFileSync(path.join(HERE, '../projects.mjs'), path.join(TMP, 'projects.mjs'));   // 改坏版 import './projects.mjs'，要放在它旁边
fs.copyFileSync(path.join(HERE, '../suggest.mjs'), path.join(TMP, 'suggest.mjs'));     // 同理 import './suggest.mjs'
fs.copyFileSync(path.join(HERE, '../limits.mjs'), path.join(TMP, 'limits.mjs'));       // 同理 import './limits.mjs'
fs.copyFileSync(path.join(HERE, '../accounts.mjs'), path.join(TMP, 'accounts.mjs'));   // 同理 import './accounts.mjs'
fs.copyFileSync(path.join(HERE, '../route.mjs'), path.join(TMP, 'route.mjs'));         // 同理 import './route.mjs'
fs.copyFileSync(path.join(HERE, '../preview.mjs'), path.join(TMP, 'preview.mjs'));     // 同理 import './preview.mjs'
fs.copyFileSync(path.join(HERE, '../judge.mjs'), path.join(TMP, 'judge.mjs'));         // 同理 import './judge.mjs'
fs.copyFileSync(path.join(HERE, '../org.mjs'), path.join(TMP, 'org.mjs'));             // 同理 import './org.mjs'
fs.copyFileSync(path.join(HERE, '../autopilot.mjs'), path.join(TMP, 'autopilot.mjs')); // 同理 import './autopilot.mjs'
fs.copyFileSync(path.join(HERE, '../remote.mjs'), path.join(TMP, 'remote.mjs'));       // 同理 import './remote.mjs'（手机远程）
fs.copyFileSync(path.join(HERE, '../qr.mjs'), path.join(TMP, 'qr.mjs'));
fs.copyFileSync(path.join(HERE, '../update.mjs'), path.join(TMP, 'update.mjs'));     // import './update.mjs'
fs.copyFileSync(path.join(HERE, '../ui.html'), path.join(TMP, 'ui.html'));           // 远程打开 / 要读它（没有它时远程首页 500，[10] 后面整段跟着红，改坏版就分不出是被哪一条抓到的）               // 同理 import './qr.mjs'
// 端口按「第几路」（slot）分，不按改坏版的序号分（11/22 修）：state.test 一份用 T_PORT 到 T_PORT+1900（[10] 第 6 份服务 +900 的预览端口），
// 原来 T_PORT = M_PORT + 序号，相邻两份只差 1，[4d] 的 +100…+102、[10] 的 +400…+950 会撞上隔壁那份。现在第 k 路固定用 M_PORT + k × SLOT，同时最多 4 路，
// 占的范围是 M_PORT 到 M_PORT + 4 × 2000（不随改坏版个数涨）
const SLOT = 2000;
const run = ([name, [a, b, f = 'server.mjs']], slot) => new Promise((resolve) => {
  let file = path.join(TMP, name + '.mjs');
  if (f === 'server.mjs') fs.writeFileSync(file, src.replace(a, b));
  else {                                             // 改坏的是 server.mjs 引用的文件：单独一个文件夹，原样的 server.mjs 旁边放改坏的那份
    const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); file = path.join(d, 'server.mjs'); fs.writeFileSync(file, src);
    for (const g of ['projects.mjs', 'suggest.mjs', 'limits.mjs', 'accounts.mjs', 'route.mjs', 'preview.mjs', 'judge.mjs', 'org.mjs', 'autopilot.mjs', 'remote.mjs', 'qr.mjs', 'update.mjs', 'ui.html']) fs.copyFileSync(path.join(TMP, g), path.join(d, g));
    fs.writeFileSync(path.join(d, f), SRC[f].replace(a, b));
  }
  let out = ''; const p = spawn(process.execPath, [path.join(HERE, 'state.test.mjs'), file], { env: { ...process.env, T_PORT: String(Number(process.env.M_PORT || 4770) + slot * SLOT) } });
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => resolve({ name, code, red: out.split('\n').filter((l) => l.startsWith('  FAIL')), hung: /UND_ERR_HEADERS_TIMEOUT/.test(out), ran: /结果：\d+ 过/.test(out), tail: out.trim().split('\n').slice(-2).join(' / ') }));
});
// 一次只跑 4 个：测试里有按秒数等的步骤，机器太忙时会等不到（11/12 十一个一起跑，有一个改坏版因此漏网）。
// 机器上还跑着线上服务、别的窗口也在用时，M_JOBS=1 一个一个跑（每个是一整份 state.test.mjs）
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;     // node test/mutants.mjs a,b 只跑这几个
const todo = Object.entries(MUTANTS).map((e, i) => [e, i]).filter(([[n]]) => !only || only.has(n)); const res = [];
const JOBS = Math.min(4, Math.max(1, Math.floor(Number(process.env.M_JOBS)) || 4));
await Promise.all(Array.from({ length: JOBS }, (_, k) => k).map(async (slot) => { while (todo.length) { const [e] = todo.shift(); res.push(await run(e, slot)); } }));   // 第 slot 路一直用同一段端口
let bad = 0;
for (const r of res) { if (!r.red.length && !r.hung) bad++;
  // 服务不再应答（测试等回应超时崩掉，没有「结果」行）：改坏版把服务卡死了，算变红，和 org.test 的「死循环超时也算变红」一样。
  // 只认 undici 的等回应超时：服务起不来是 ECONNREFUSED、少文件是 ERR_MODULE_NOT_FOUND，照旧报「没跑起来」（11/17 restore-stop-ignored 就是这样被报成没跑起来的）
  if (!r.red.length && r.hung) { console.log(`  ok   ${r.name.padEnd(22)} 服务卡死、不再应答（测试等回应超时，按变红算）`); continue; }
  if (!r.red.length && !r.ran) { console.log(`  FAIL ${r.name.padEnd(22)} 没跑起来（不是没抓到，先修环境）：${r.tail.slice(0, 160)}`); continue; }   // 11/12：改坏版找不到 projects.mjs，20 个全报「没抓到」
  console.log(`${r.red.length ? '  ok  ' : '  FAIL'} ${r.name.padEnd(22)} 变红 ${r.red.length} 条${r.red.length ? '：' + r.red[0].replace('  FAIL ', '').slice(0, 60) : '（测试没发现它被改坏了）'}`);
  if (process.env.M_ALL_RED) for (const l of r.red) console.log('         · ' + l.replace('  FAIL ', '').slice(0, 110)); }   // M_ALL_RED=1：列出每一条变红的断言（核对改坏版红在它该守的那几条上，不是别处的偶发）
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${res.length} 个改坏版，${res.length - bad} 个被测试抓到`); process.exit(bad ? 1 : 0);
