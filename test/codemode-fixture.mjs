/**
 * [INPUT]: 一份真实的 Code Mode 对话记录（Claude Code 2.1.327，win-06 11/17 22:0x 实测的 cm-test：三段脚本 + 一轮后台脚本 + 一轮不带工具）
 * [OUTPUT]: stdout 写 test/codemode.jsonl：去掉内容、留下结构的夹具（state.test.mjs 的 [1e]、[7m] 读它）
 * [POS]: 只在换夹具时手动跑一次：node test/codemode-fixture.mjs <真实记录.jsonl> > test/codemode.jsonl
 * [PROTOCOL]: 变更时更新此头部，然后检查 test/CLAUDE.md
 */
// 为什么要这一步：真实记录里有 api-request-blob（整份请求，带本机的说明文字和记忆）、attachment、本机路径和用户名，仓库是公开的，不能原样拷进来。
// 留下的是服务读的那些：记录的先后、type、isVirtual / isApiErrorMessage / isSidechain、message 的 id / model / stop_reason / usage、tool_use 的 id / name、
// 时间戳（原样，包括虚拟调用比前一条早几毫秒的那几处），repl-mode 那一行。换掉的：路径（工作目录 → @CM@）、文件内容、脚本源码、工具返回的正文、他说的话、会话号。
// 跑完自查：输出里出现用户名、/Users/、/private/、会话号就退出 1，不写。
import fs from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('用法：node test/codemode-fixture.mjs <真实记录.jsonl> > test/codemode.jsonl'); process.exit(2); }
const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cwd = (lines.find((d) => typeof d.cwd === 'string') || {}).cwd;
if (!cwd) { console.error('记录里没有 cwd'); process.exit(2); }
const sids = new Set(lines.map((d) => d.sessionId || d.session_id).filter(Boolean));
const KEEP = new Set(['repl-mode', 'mode', 'permission-mode', 'ai-title', 'user', 'assistant', 'queue-operation']);
const path2 = (s) => String(s).split(cwd).join('@CM@');
let nUser = 0;
const PROMPTS = ['数一下这个文件夹里每个 .md 有几行，写进 summary.txt，再在 c.txt 末尾加一行 done', '跑 wc -c a.md b.md，只回总数', '回一个 ok'];

function input(name, i) {
  i = i || {};
  switch (name) {
    case 'REPL': return { code: '// 脚本原文略（夹具去掉了内容）', ...(i.description ? { description: i.description } : {}) };
    case 'Poll': return {};
    case 'Bash': return { command: path2(i.command || '') };
    case 'Read': return { file_path: path2(i.file_path) };
    case 'Write': return { file_path: path2(i.file_path), content: 'x\n' };
    case 'Edit': return { file_path: path2(i.file_path), old_string: 'x', new_string: 'x\ndone' };
    default: return {};
  }
}
const out = [];
for (const d of lines) {
  if (!KEEP.has(d.type)) continue;
  const base = { type: d.type };
  for (const k of ['uuid', 'parentUuid', 'timestamp', 'isSidechain', 'isVirtual', 'isApiErrorMessage', 'isMeta', 'effort']) if (k in d) base[k] = d[k];
  if (typeof d.cwd === 'string') base.cwd = path2(d.cwd);
  if (d.type === 'repl-mode') { base.replMode = d.replMode; out.push(base); continue; }
  if (d.type === 'mode') { base.mode = d.mode; out.push(base); continue; }
  if (d.type === 'permission-mode') { base.permissionMode = d.permissionMode; out.push(base); continue; }
  if (d.type === 'ai-title') { base.aiTitle = 'Code Mode 小测试'; out.push(base); continue; }
  if (d.type === 'queue-operation') {
    base.operation = d.operation;
    if (d.content) base.content = String(d.content).replace(/<result>[\s\S]*<\/result>/, '<result>（夹具去掉了内容）</result>');
    out.push(base); continue;
  }
  const m = d.message || {};
  if (d.type === 'user') {
    if (d.origin) base.origin = { kind: d.origin.kind };
    if (d.turnOrigin) base.turnOrigin = d.turnOrigin;
    if (typeof m.content === 'string') base.message = { role: 'user', content: PROMPTS[nUser++] || '接着做' };
    else base.message = { role: 'user', content: (m.content || []).map((b) => (b.type === 'tool_result' ? { type: 'tool_result', tool_use_id: b.tool_use_id, content: 'ok', is_error: !!b.is_error } : { type: 'text', text: '（夹具去掉了内容）' })) };
    out.push(base); continue;
  }
  const content = [];
  for (const b of m.content || []) {
    if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: input(b.name, b.input) });
    else if (b.type === 'text') content.push({ type: 'text', text: path2(b.text) });
  }
  if (!content.length) continue;                     // 只有 thinking 的那几条：服务不读，签名也不该进仓库
  base.message = { id: m.id, model: m.model, role: 'assistant', type: 'message', stop_reason: m.stop_reason, content };
  if (m.usage) base.message.usage = { input_tokens: m.usage.input_tokens || 0, cache_read_input_tokens: m.usage.cache_read_input_tokens || 0, cache_creation_input_tokens: m.usage.cache_creation_input_tokens || 0, output_tokens: m.usage.output_tokens || 0 };
  out.push(base);
}
const text = out.map((r) => JSON.stringify(r)).join('\n') + '\n';
const leak = [/khalil/i, /\/Users\//, /\/private\//, /claude-\d{3}/, ...[...sids].map((s) => new RegExp(s))].filter((re) => re.test(text));
if (leak.length) { console.error('输出里还有本机信息：' + leak.join(' ')); process.exit(1); }
process.stdout.write(text);
console.error(`${lines.length} 条 → ${out.length} 条（repl-mode ${out.filter((r) => r.type === 'repl-mode').length}，虚拟调用 ${out.filter((r) => r.type === 'assistant' && r.isVirtual).length}）`);
