/**
 * [INPUT]: 依赖 ../server.mjs、../preview.mjs、../autopilot.mjs 的原文（按字符串精确替换造改坏版）和 ./state.test.mjs。分组规则本身（projects.mjs）的改坏对照不在这里，跑 projects.test.mjs --mutants
 * [OUTPUT]: 每个改坏版变红了几条；有一个没变红就退出码 1
 * [POS]: test/ 的「测试自己靠不靠得住」检查：每次只改坏服务的一处规则，state.test.mjs 必须变红。
 *        改坏版仍带着试验场保护（不碰 Ghostty、不发通知）。要替换的原文在 server.mjs 里找不到或不唯一时直接报错，免得悄悄没改成。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/mutants.mjs        （全部改坏版，一次跑 4 个，约 7 分钟）；node test/mutants.mjs 名字,名字 只跑这几个
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname); const TMP = path.join(HERE, '.tmp', 'mutants'); fs.mkdirSync(TMP, { recursive: true });
const SRC = Object.fromEntries(['server.mjs', 'preview.mjs', 'autopilot.mjs'].map((f) => [f, fs.readFileSync(path.join(HERE, '..', f), 'utf8')]));
const src = SRC['server.mjs'];
const MUTANTS = {
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
  'peek-clears':         ["      if (peek) out.peek = true; else notices = [];", "      if (peek) out.peek = true; notices = [];"],
  'tidy-keeps-all':      ["return { keep: false, why: '只聊了几句，没改过文件' };", "return { keep: true, why: '只聊了几句，没改过文件' };"],
  'tidy-drop-not-moved': ["    if (r.ok && cur.drop) { dropArchived(sid, cur); return; }", "    if (false) { dropArchived(sid, cur); return; }"],
  'open-scripts':        ["  return OPEN_EXT.has(ext) ? 'open' : 'reveal';", "  return 'open';"],
  'open-any-origin':     ["const og = req.headers.origin; return !og ||", "const og = req.headers.origin; return true ||"],
  'no-project-evidence': ["st.steps++; st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);", "st.steps++; st.tool = toolLine(b); st.done = false;"],
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
  'config-ignored':      ["    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: c.autoTidy === true, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, org, auto };", "    return def;"],
  'limits-codex-ungated': ['codex: CONFIG.codex ? codexLimits(CODEX_HOME, now) : null', 'codex: codexLimits(CODEX_HOME, now)'],
  'limits-not-in-state': ['sandbox: SANDBOX, limits: LIMITS };', 'sandbox: SANDBOX };'],
  'account-not-wrapped': ['    args.push(...wrapLaunch(acct, cl));', '    args.push(...cl);'],
  'account-skip-ready':  ["    if (!acct.ready) return { ok: false, error: '钥匙串里还没有「' + acct.name + '」的 token' };\n", ''],
  'account-any-id':      ["    if (!acct) return { ok: false, error: '没有这个账号：' + String(want).slice(0, 40) };", "    if (!acct) acct = { id: String(want), name: String(want), ready: true };"],
  // config 的 defaultAccount（11/17 car3）：没选账号时不按它包；写了没登记的号也照用
  'default-account-ignored':   ["  const want = opt.account || (provider === 'claude' ? CONFIG.defaultAccount : '');", "  const want = opt.account;"],
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
  'auto-default-on':     ["  const def = { autoTrust: false, codex: false, autoTidy: false, tidyJudge: false, accounts: [], defaultAccount: '', org: { ...ORG_DEF }, auto: parseAutoConfig() };", "  const def = { autoTrust: false, codex: false, autoTidy: true, tidyJudge: false, accounts: [], defaultAccount: '', org: { ...ORG_DEF }, auto: parseAutoConfig() };"],
  'auto-config-ignored': ["    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: c.autoTidy === true, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, org, auto };", "    return { autoTrust: c.autoTrust === true, codex: c.codex === true, autoTidy: false, tidyJudge: c.tidyJudge === true, accounts, defaultAccount, org, auto };"],
  'auto-ignores-focus':  ["  if (now - uiFocusAt < 6000) return;", ""],
  'auto-acts-in-readonly': ["      if (READONLY) { const k = s.sid + '@' + s.resultAt;", "      if (false) { const k = s.sid + '@' + s.resultAt;"],
  'auto-stale-mark':     ["if (need === 'review' && p && p.at === String(s.resultAt) &&", "if (need === 'review' && p && true &&"],
  'auto-fyi-no-wait':    ["if (need === 'fyi' && quiet >= TIDY_FYI_MS)", "if (need === 'fyi' && quiet >= 0)"],
  'auto-review-short':   ["if (need === 'review' && quiet >= TIDY_REVIEW_MS)", "if (need === 'review' && quiet >= TIDY_FYI_MS)"],
  'auto-takes-reply':    ["if (need === 'review' && quiet >= TIDY_REVIEW_MS)", "if (quiet >= TIDY_REVIEW_MS)"],
  'auto-ignores-alert':  ["if (s.status !== 'idle' || s.ask || s.alert || !s.done", "if (s.status !== 'idle' || s.ask || !s.done"],
  'auto-takes-shell':    ["if (s.status !== 'idle' || s.ask || s.alert || !s.done", "if (s.ask || s.alert || !s.done"],
  'auto-reentrant':      ["  if (!CONFIG.autoTidy || tidyBusy) return;", "  if (!CONFIG.autoTidy) return;"],
  'auto-processed-replaces': ["      const okSid = (x) => typeof x === 'string'", "      processed.clear();\n      const okSid = (x) => typeof x === 'string'"],
  'auto-clear-ignored':  ["if (okSid(sid)) processed.delete(sid);", "if (okSid(sid)) void 0;"],
  'auto-no-prune':       ["  for (const k of processed.keys()) if (!live.has(k)) processed.delete(k);", ""],
  // 新窗口的档位（route.mjs 接进 /api/new）：档位表本身的改坏对照在 route.test.mjs --mutants，这里只改坏服务的接线
  'route-not-wired':     ["{ provider: body.provider, model: rt.model, effort: rt.effort, account: body.account, files: body.files,", "{ provider: body.provider, model: body.model, effort: body.effort, account: body.account, files: body.files,"],
  'bad-tier-opens-window': ["      if (!rt.ok) return reply(res, 200, rt);\n", ""],
  'route-not-in-reply':  ["return reply(res, 200, r.ok && rt.tier ? { ...r, route: { tier: rt.tier, model: rt.model, effort: rt.effort, why: rt.why } } : r);", "return reply(res, 200, r);"],
  'route-not-logged':    ["if (rt.tier) console.log(`route ${new Date().toISOString()}", "if (false) console.log(`route ${new Date().toISOString()}"],
  // 内置预览：第三项是要改坏的文件（不写就是 server.mjs）
  'preview-dotdirs':     ["if (parts.some((s) => !s || s.startsWith('.') ||", "if (parts.some((s) => !s || s === '..' ||", 'preview.mjs'],
  'preview-symlink-out': ["    if (!inside(it.root, real)) return null;", "", 'preview.mjs'],
  'preview-any-type':    ["const type = MIME[path.extname(real).slice(1).toLowerCase()];", "const type = MIME[path.extname(real).slice(1).toLowerCase()] || 'application/octet-stream';", 'preview.mjs'],
  'preview-deep-home':   ["const isShallow = (root) => inside(root, home) ||", "const isShallow = (root) => false ||", 'preview.mjs'],
  // 图集：文件夹里列哪些文件、什么样的文件夹才算图集、一批文件怎么合
  'gallery-symlink-out': ["if (isMedia(kind) && inside(dir, real)) media.push", "if (isMedia(kind)) media.push", 'preview.mjs'],
  'gallery-dotfiles':    ["      if (name.startsWith('.')) continue;\n", "", 'preview.mjs'],
  'gallery-no-min':      ["const GALLERY_MIN = 2, GALLERY_SHARE = 0.6;", "const GALLERY_MIN = 1, GALLERY_SHARE = 0.6;", 'preview.mjs'],
  'gallery-no-share':    ["const GALLERY_MIN = 2, GALLERY_SHARE = 0.6;", "const GALLERY_MIN = 2, GALLERY_SHARE = 0;", 'preview.mjs'],
  'gallery-no-cap':      ["const GALLERY_MAX = 200;", "const GALLERY_MAX = 100000;", 'preview.mjs'],
  'gallery-alpha-sort':  ["{ numeric: true, sensitivity: 'base' }", "{ sensitivity: 'base' }", 'preview.mjs'],
  'gallery-home':        ["    if (isShallow(dir)) return { ok: false, error: 'no-preview' };\n", "", 'preview.mjs'],
  'gallery-many-dup':    ["if (seen.has(real)) continue; seen.add(real);", "seen.add(real);", 'preview.mjs'],
  'gallery-many-hidden': ["if (!st.isFile() || !isMedia(kind) || name.startsWith('.')) {", "if (!st.isFile() || !isMedia(kind)) {", 'preview.mjs'],
  'gallery-many-nokey':  ["items.push({ name, kind, url: mediaUrl(claimDir(path.dirname(real)), name), dir: path.dirname(real) });", "items.push({ name, kind, url: mediaUrl(crypto.randomBytes(16).toString('hex'), name), dir: path.dirname(real) });", 'preview.mjs'],
  'preview-any-host':    ["if (req.headers.host !== '127.0.0.1:' + bound && req.headers.host !== 'localhost:' + bound) return nope(403);", "", 'preview.mjs'],
  'preview-no-range':    ["if (m && (m[1] || m[2])) {", "if (false) {", 'preview.mjs'],
  'preview-any-entry':   ["export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || null;", "export const kindOf = (ext) => KIND_OF[String(ext).toLowerCase()] || 'text';", 'preview.mjs'],
  'preview-dir-entry':   ["const kind = st.isFile() ? kindOf(", "const kind = true ? kindOf(", 'preview.mjs'],
  'preview-case-ext':    ["KIND_OF[String(ext).toLowerCase()]", "KIND_OF[String(ext)]", 'preview.mjs'],
  'preview-text-uncut':  ["r.truncated = st.size > TEXT_MAX;", "r.truncated = false;", 'preview.mjs'],
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
  'judge-review':        ["  if (need === 'fyi' && quiet >= TIDY_SMART_MS && judgeOn()) {", "  if ((need === 'fyi' || need === 'review') && quiet >= TIDY_SMART_MS && judgeOn()) {"],
  'judge-reask':         ["    if (!j || j.at !== String(s.resultAt)) return { line: 'judge' };", "    if (!j || j.at !== String(s.resultAt) || !j.v) return { line: 'judge' };"],
  'judge-fail-as-done':  ["  judged.set(s.sid, { at, v });", "  judged.set(s.sid, { at, v: v || { verdict: 'done', ask: null, why: '' } });"],
  'judge-waiting-closes': ["j.v.verdict === 'done') return { line: 'smart'", "j.v.verdict !== 'yours') return { line: 'smart'"],
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
  'org-seats-not-passed':   ["seats: seatSids(sessions), ", ""],
  'org-seats-strict':       ["out.seats[k] = f; else out.seatsBad++;", "out.seats[k] = f; else throw new Error('org.seats 写错');"],
  'org-seats-uuid-ignored': ["if (p.ids.length && p.name) hit = byId.find((x) => nameIs(x, p.name)) || null;", "if (p.ids.length && p.name) hit = live.find((x) => nameIs(x, p.name)) || null;"],
  'org-seats-hex-only':     ["const UUID_RE = /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/gi;", "const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;"],   // 只认十六进制：夹具的会话号认不出，名字和会话号对不上时退不回去
  'tidy-seats-collected':   ["    if (role) { const k = 'seat:' + s.sid", "    if (false) { const k = 'seat:' + s.sid"],   // 自动收工照收坐在岗位上的窗口（分支负责人被当成做完了收掉的那种）
  'org-seats-no-reload':    ["if (Date.now() - seatMemo.at < CHIEF_MS) return seatMemo.map;", "if (seatMemo.at) return seatMemo.map;"],
  'org-branch-tail-dropped': ["|head of|' + BRANCH_TAIL };", "|head of' };"],
  'org-branch-git-ok':      ["(?<!合并|合进|合入|并入|清理|删除|删掉|切换|切到|新建|新开|拉取|拉出|推送|远程|本地|临时|功能|特性|发布|开发|修复|热修|上线|回滚|[主旧切删拉推建合])分支", "分支"],
  'org-no-startedAt':    ["x.pid === p.pid && Number(x.startedAt) <= at", "x.pid === p.pid"],
  'org-name-not-unique': ["if (c.length === 1) return c[0].sid;", "if (c.length >= 1) return c[0].sid;"],
  'org-peer-turn-only':  ["        const p = notePeer(st, d);", "        const p = st.open ? null : notePeer(st, d);"],
  'org-human-ignored':   ["      st.human = { n: st.nHuman, last: Date.parse(d.timestamp) || 0 };", "      st.human = null;"],
  'org-for-lost':        ["st.turnPeer = p ? { pid: p.pid, name: p.name, at: Date.parse(d.timestamp) || 0 } : null; }", "st.turnPeer = null; }"],
  'org-chief-file-ignored': ["  const ch = chiefNow();", "  const ch = { sid: null, gen: null };"],
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
  'harness-resume-tools':  ["[await findClaude(), '--resume', sid]", "[await findClaude(), '--disallowedTools', 'Agent', '--resume', sid]"],
  'harness-writes-claude-md': ["  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });", "  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider }); try { fs.appendFileSync(path.join(HOME, 'CLAUDE.md'), '\\n- 每轮写状态行\\n'); } catch {}"],
  // 这一轮改了哪些文件 / 撞车提示（[1d]）：他本人开新的一轮不清单子、一轮做到一半别的窗口发来消息也清、撞车不看时间、只认 .git 是文件夹的仓库（worktree 认不出）
  'wrote-human-no-clear': ["      newTurnWrites(st);                                     // 他本人开了新的一轮", "      // 他本人开了新的一轮"],
  'wrote-peer-midturn':  ["        if (!st.open) newTurnWrites(st);", "        newTurnWrites(st);"],
  'collide-no-window':   ["      if (now - at > COLLIDE_MS) continue;", ""],
  'collide-gitdir-only': ["    if (fs.existsSync(path.join(d, '.git'))) { repo = d; break; }", "    if (fs.existsSync(path.join(d, '.git')) && fs.statSync(path.join(d, '.git')).isDirectory()) { repo = d; break; }"],
  // Codex 的补丁头（[1d] 里 Codex 那两条）：applyCodex 不记写；补丁头的路径不在反斜杠处断（真实 rollout 里补丁包在 exec 的 JS 源码里，换行是 \\n 两个字符）
  'codex-patch-ignored': ["      for (const f of patchFiles(p.input, p.arguments)) noteWrite(st, f, d.timestamp);", ""],
  'patch-escaped-nl':    ["([^\\n\\r\\\\\"]+)/g", "([^\\n\\r\\\"]+)/g"],
  // 评审之后补的（[1d] 的 Bash 和 Codex 新一轮）：Bash 里的写不认、heredoc 正文当成命令、Codex 他说了新的一句不清单子
  'bash-write-ignored':  ["for (const dir of bashWriteDirs(b.input.command, d.cwd)) noteWriteDir(st, dir, d.timestamp);", ";"],
  'bash-heredoc-body':   ["if (m) end = m[2];", "if (m) end = null;"],
  'codex-turn-no-clear': ["if (text.trim() && !codexInjected(text)) newTurnWrites(st);", ";"],
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
};
for (const [name, [a, , f = 'server.mjs']] of Object.entries(MUTANTS)) { const n = SRC[f].split(a).length - 1; if (n !== 1) throw new Error(`${name}: 要替换的原文在 ${f} 里出现 ${n} 次（应当正好 1 次）`); }
fs.copyFileSync(path.join(HERE, '../projects.mjs'), path.join(TMP, 'projects.mjs'));   // 改坏版 import './projects.mjs'，要放在它旁边
fs.copyFileSync(path.join(HERE, '../suggest.mjs'), path.join(TMP, 'suggest.mjs'));     // 同理 import './suggest.mjs'
fs.copyFileSync(path.join(HERE, '../limits.mjs'), path.join(TMP, 'limits.mjs'));       // 同理 import './limits.mjs'
fs.copyFileSync(path.join(HERE, '../accounts.mjs'), path.join(TMP, 'accounts.mjs'));   // 同理 import './accounts.mjs'
fs.copyFileSync(path.join(HERE, '../route.mjs'), path.join(TMP, 'route.mjs'));         // 同理 import './route.mjs'
fs.copyFileSync(path.join(HERE, '../preview.mjs'), path.join(TMP, 'preview.mjs'));     // 同理 import './preview.mjs'
fs.copyFileSync(path.join(HERE, '../judge.mjs'), path.join(TMP, 'judge.mjs'));         // 同理 import './judge.mjs'
fs.copyFileSync(path.join(HERE, '../org.mjs'), path.join(TMP, 'org.mjs'));             // 同理 import './org.mjs'
fs.copyFileSync(path.join(HERE, '../autopilot.mjs'), path.join(TMP, 'autopilot.mjs')); // 同理 import './autopilot.mjs'
const run = ([name, [a, b, f = 'server.mjs']], i) => new Promise((resolve) => {
  let file = path.join(TMP, name + '.mjs');
  if (f === 'server.mjs') fs.writeFileSync(file, src.replace(a, b));
  else {                                             // 改坏的是 server.mjs 引用的文件：单独一个文件夹，原样的 server.mjs 旁边放改坏的那份
    const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); file = path.join(d, 'server.mjs'); fs.writeFileSync(file, src);
    for (const g of ['projects.mjs', 'suggest.mjs', 'limits.mjs', 'accounts.mjs', 'route.mjs', 'preview.mjs', 'judge.mjs', 'org.mjs', 'autopilot.mjs']) fs.copyFileSync(path.join(TMP, g), path.join(d, g));
    fs.writeFileSync(path.join(d, f), SRC[f].replace(a, b));
  }
  let out = ''; const p = spawn(process.execPath, [path.join(HERE, 'state.test.mjs'), file], { env: { ...process.env, T_PORT: String(Number(process.env.M_PORT || 4770) + i) } });
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => resolve({ name, code, red: out.split('\n').filter((l) => l.startsWith('  FAIL')), hung: /UND_ERR_HEADERS_TIMEOUT/.test(out), ran: /结果：\d+ 过/.test(out), tail: out.trim().split('\n').slice(-2).join(' / ') }));
});
// 一次只跑 4 个：测试里有按秒数等的步骤，机器太忙时会等不到（11/12 十一个一起跑，有一个改坏版因此漏网）。
// 机器上还跑着线上服务、别的窗口也在用时，M_JOBS=1 一个一个跑（每个是一整份 state.test.mjs）
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;     // node test/mutants.mjs a,b 只跑这几个
const todo = Object.entries(MUTANTS).map((e, i) => [e, i]).filter(([[n]]) => !only || only.has(n)); const res = [];
const JOBS = Math.min(4, Math.max(1, Math.floor(Number(process.env.M_JOBS)) || 4));
await Promise.all(Array.from({ length: JOBS }, (_, k) => k).map(async () => { while (todo.length) { const [e, i] = todo.shift(); res.push(await run(e, i)); } }));
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
