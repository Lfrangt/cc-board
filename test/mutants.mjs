/**
 * [INPUT]: 依赖 ../server.mjs 的原文（按字符串精确替换造改坏版）和 ./state.test.mjs。分组规则本身（projects.mjs）的改坏对照不在这里，跑 projects.test.mjs --mutants
 * [OUTPUT]: 每个改坏版变红了几条；有一个没变红就退出码 1
 * [POS]: test/ 的「测试自己靠不靠得住」检查：每次只改坏服务的一处规则，state.test.mjs 必须变红。
 *        改坏版仍带着试验场保护（不碰 Ghostty、不发通知）。要替换的原文在 server.mjs 里找不到或不唯一时直接报错，免得悄悄没改成。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/mutants.mjs        （全部改坏版，一次跑 4 个，约 7 分钟）；node test/mutants.mjs 名字,名字 只跑这几个
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname); const TMP = path.join(HERE, '.tmp', 'mutants'); fs.mkdirSync(TMP, { recursive: true });
const src = fs.readFileSync(path.join(HERE, '../server.mjs'), 'utf8');
const MUTANTS = {
  'tidy-keeps-all':      ["return { keep: false, why: '只聊了几句，没改过文件' };", "return { keep: true, why: '只聊了几句，没改过文件' };"],
  'tidy-drop-not-moved': ["    if (r.ok && cur.drop) { dropArchived(sid, cur); return; }", "    if (false) { dropArchived(sid, cur); return; }"],
  'open-scripts':        ["  return OPEN_EXT.has(ext) ? 'open' : 'reveal';", "  return 'open';"],
  'open-any-origin':     ["const og = req.headers.origin; if (og && og !== 'http://127.0.0.1:' + PORT", "const og = ''; if (og && og !== 'http://127.0.0.1:' + PORT"],
  'no-project-evidence': ["st.steps++; st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);", "st.steps++; st.tool = toolLine(b); st.done = false;"],
  'lost-no-project':     ["lostAt: x.lostAt, project: x.project || classify(null, { title: x.title, prompt: x.prompt, cwd: x.cwd, home: HOME }) }));", "lostAt: x.lostAt }));"],
  'api-error-ignored':   ["        if (d.isApiErrorMessage) {\n          const h = haltOf(d, m);", "        if (false) {\n          const h = haltOf(d, m);"],
  'compact-as-prompt':   ["if (d.isMeta || d.isCompactSummary) return;", "if (d.isMeta) return;"],
  'interrupt-ignored':   ["      if (isInterrupt(text)) {                               // 一轮做到一半被打断", "      if (false) {                               // 一轮做到一半被打断"],
  'idle-esc-halts':      ["        if (st.open) { st.halt = { kind: 'interrupt'", "        if (true) { st.halt = { kind: 'interrupt'"],
  'no-stall':            ["return s.quiet >= STALL_MS ? {", "return false ? {"],
  'no-gone':             ["    if (now - goneSince.get(sid) < 6000) continue;", "    continue;"],
  'gone-when-idle':      ["    if (!p.mid || archive.items[sid] || leaving.has(sid)) {", "    if (archive.items[sid] || leaving.has(sid)) {"],
  'no-baseline':         ["    if (!alertBase) { alerted.set(s.sid, a.key); continue; }", ""],
  'notify-while-watched': ["const would = Date.now() - uiFocusAt < 6000 ? 'ui' : 'sent';", "const would = 'sent';"],
  'rehalt-new-key':      ["          if (st.halt && st.halt.kind === h.kind) st.halt.text = h.text; else st.halt = h;", "          st.halt = h;"],
  'interrupt-notifies':  ["    if (a.kind !== 'interrupt') queueAlert(s.title, a.kind);", "    queueAlert(s.title, a.kind);"],
  'shell-counts-as-stopped': ["  if (s.status === 'shell') return null;                               // 它放到后台的活还在跑", "  // 它放到后台的活还在跑"],
  'no-folder-note':      ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", ""],
  'note-when-folder-given': ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", "  if (text) text += pin ? pinNote(pin) : FOLDER_NOTE;"],
  'digest-no-cond':      ["if (DG_COND.test(u) || DG_LATER.test(u) || DG_NONE.test(u)) continue;", "if (DG_NONE.test(u)) continue;"],
  'tag-line-kept':       ["const lines = ti < 0 ? all : all.filter((_, i) => i !== ti);", "const lines = all;"],
  'peer-turn-ignored':   ["      if (d.origin && d.origin.kind === 'peer') { if (!st.open) st.turnBy = 'peer'; return; }", "      if (d.origin && d.origin.kind === 'peer') { return; }"],
  'pin-ignored-in-note': ["  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;", "  if (text && sameDir(dir, HOME)) text += FOLDER_NOTE;"],
  'pin-trusts-client':   ["  const pin = opt.project ? pinnable(opt.project.key, opt.project.name) : null;", "  const pin = opt.project && opt.project.key ? { key: String(opt.project.key), name: String(opt.project.name) } : null;"],
  'pins-not-saved':      ["  if (pin) { pins[name] = { ...pin, at: Date.now() }; savePins(); }", "  if (pin) { pins[name] = { ...pin, at: Date.now() }; }"],
  'pending-no-pin':      ["project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME, pin: pinOf(x.name) }) }))", "project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME }) }))"],
  'no-auto-trust':       ["  else if (CONFIG.autoTrust && sameDir(dir, HOME)) autoTrust(name)", "  else if (false) autoTrust(name)"],
  'trust-ignores-config': ["  else if (CONFIG.autoTrust && sameDir(dir, HOME)) autoTrust(name)", "  else if (sameDir(dir, HOME)) autoTrust(name)"],
  'trust-any-folder':    ["  else if (CONFIG.autoTrust && sameDir(dir, HOME)) autoTrust(name)", "  else if (CONFIG.autoTrust) autoTrust(name)"],
  'codex-sessions-off':  ["  if (CONFIG.codex) for (const c of codexSessions(seen)) out.push(c);", "  for (const c of codexSessions(seen)) out.push(c);"],
  'codex-new-off':       ["  if (opt.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };\n  const provider", "  const provider"],
  'codex-listed-off':    ["...(CONFIG.codex ? { codex:", "...(true ? { codex:"],
  'codex-pane-pending':  ["    if (agents[pane.name] && !CONFIG.codex) continue;", ""],
  'config-ignored':      ["    return { autoTrust: c.autoTrust === true, codex: c.codex === true };", "    return def;"],
  'bad-config-crashes':  ["  } catch (e) { useRules(); console.log(`config ${CONFIG_FILE}：读不了（${e.message}），用默认值`); return def; }", "  } catch (e) { throw e; }"],
  'trust-any-dialog':    ["    const i = d.options.findIndex((o) => TRUST_OPT.test(o));", "    const i = d.options.length - 1;"],
  'no-flagged':          ["  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);", "  const flagged = false;"],
  'flag-all-invalid':    ["  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);", "  const flagged = d.error === 'invalid_request';"],
  'note-on-card':        ["  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });", "  launches.set(name, { at: Date.now(), prompt: text, cwd: dir, provider });"],
  'suggest-not-attached': ["sessions: sessions.map(withSuggest), others: otherCount,", "sessions, others: otherCount,"],
  'suggest-loop-off':    ["  fastLoop(); slowLoop(); suggestLoop();", "  fastLoop(); slowLoop();"],
  'suggest-plain-screen': ["['capture-pane', '-p', '-e', '-t', s.tmux]", "['capture-pane', '-p', '-t', s.tmux]"],
  'suggest-stale-kept':  ["  for (const k of [...suggests.keys()]) if (!names.has(k)) suggests.delete(k);", ""],
};
for (const [name, [a]] of Object.entries(MUTANTS)) { const n = src.split(a).length - 1; if (n !== 1) throw new Error(`${name}: 要替换的原文在 server.mjs 里出现 ${n} 次（应当正好 1 次）`); }
fs.copyFileSync(path.join(HERE, '../projects.mjs'), path.join(TMP, 'projects.mjs'));   // 改坏版 import './projects.mjs'，要放在它旁边
fs.copyFileSync(path.join(HERE, '../suggest.mjs'), path.join(TMP, 'suggest.mjs'));     // 同理 import './suggest.mjs'
const run = ([name, [a, b]], i) => new Promise((resolve) => {
  const file = path.join(TMP, name + '.mjs'); fs.writeFileSync(file, src.replace(a, b));
  let out = ''; const p = spawn(process.execPath, [path.join(HERE, 'state.test.mjs'), file], { env: { ...process.env, T_PORT: String(4770 + i) } });
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => resolve({ name, code, red: out.split('\n').filter((l) => l.startsWith('  FAIL')), ran: /结果：\d+ 过/.test(out), tail: out.trim().split('\n').slice(-2).join(' / ') }));
});
// 一次只跑 4 个：测试里有按秒数等的步骤，机器太忙时会等不到（11/12 十一个一起跑，有一个改坏版因此漏网）
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;     // node test/mutants.mjs a,b 只跑这几个
const todo = Object.entries(MUTANTS).map((e, i) => [e, i]).filter(([[n]]) => !only || only.has(n)); const res = [];
await Promise.all([0, 1, 2, 3].map(async () => { while (todo.length) { const [e, i] = todo.shift(); res.push(await run(e, i)); } }));
let bad = 0;
for (const r of res) { if (!r.red.length) bad++;
  if (!r.red.length && !r.ran) { console.log(`  FAIL ${r.name.padEnd(22)} 没跑起来（不是没抓到，先修环境）：${r.tail.slice(0, 160)}`); continue; }   // 11/12：改坏版找不到 projects.mjs，20 个全报「没抓到」
  console.log(`${r.red.length ? '  ok  ' : '  FAIL'} ${r.name.padEnd(22)} 变红 ${r.red.length} 条${r.red.length ? '：' + r.red[0].replace('  FAIL ', '').slice(0, 60) : '（测试没发现它被改坏了）'}`); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${res.length} 个改坏版，${res.length - bad} 个被测试抓到`); process.exit(bad ? 1 : 0);
