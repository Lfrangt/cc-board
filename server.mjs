#!/usr/bin/env node
/**
 * [INPUT]: 依赖 ~/.claude/sessions 的会话登记（进程号、状态）、~/.claude/projects 和 ~/.codex/sessions 的对话记录（jsonl，只读）；
 *          依赖 tmux -L ccboard 和 Ghostty 的 AppleScript 接口往会话里送字；依赖 osascript 发系统通知；依赖 ./projects.mjs 认会话属于哪个项目；依赖 ./suggest.mjs 读输入框上的预判；依赖 /usr/bin/open 打开正文里的路径（/api/open）
 * [OUTPUT]: 对外提供 127.0.0.1:4747 上的页面 /、/health 和 /api/*（state、turns、send、new、archive、unarchive、delete、ack、answer…）
 * [POS]: 总控台唯一的服务进程，由 app/main.swift 启动和重启，ui.html 只通过 /api 和它说话。
 *        它把每个会话压成四样：你问了什么 / 它在干嘛 / 它交付了什么 / 它为什么停了（alertOf 是「要不要你跟进」的唯一判断处）。
 *        读记录时把每次工具调用交给 noteTool 记证据，每轮用 classify 给会话、启动中、进程退出的卡片都标上 project。
 *        在某一列列头开的新任务，tmux 名 → 那一列记在 pins.json，classify 拿它当提示分；开工前的「信任这个文件夹」由 autoTrust 替他点（config 打开、开在主目录时）。
 *        digest() 从每次交付里取一句结论和要你做的事，分「待跟进 / 待审阅」；它自己写了【待跟进】/【待审阅】/【在跑】那一行就以它为准。
 *        换了端口、数据目录或主目录就自认是试验场：不碰 Ghostty、不发系统通知。
 *        suggestLoop 每 2.5 秒读一遍空闲 tmux 会话的屏幕（capture-pane -e，只读），交给 suggest.mjs 取灰字建议和「下一步 1/2/3」，挂在 /api/state 的 suggest 字段上；它们不进对话记录。
 *        启动时读一次数据目录里的 config.json（CONFIG）：项目表交给 useRules；autoTrust、codex 两个开关默认关。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 只读 ~/.claude/sessions（会话登记）和 ~/.claude/projects（对话记录），不读终端画面（弹着选择框的会话除外）。
// 只监听 127.0.0.1；所有接口要带口令（.token），别的网页调不了。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSuggest } from './suggest.mjs';                                   // 输入框上的灰字建议和「下一步 1/2/3」（只从屏幕读）
import { noteTool, classify, pinnable, useRules } from './projects.mjs';     // 认会话属于哪个项目（按它动过的文件夹 + 标题 + 在哪一列开的）

const HOME = os.homedir();
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CCBOARD_PORT || 4747);
const SESS_DIR = path.join(HOME, '.claude/sessions');
const PROJ_DIR = path.join(HOME, '.claude/projects');
const DATA = process.env.CCBOARD_DATA || path.join(HOME, 'Library/Application Support/cc-board');
fs.mkdirSync(DATA, { recursive: true });
const TOKEN_FILE = path.join(DATA, '.token');
const ARCHIVE_FILE = path.join(DATA, 'archive.json');
const DELETED_DIR = path.join(DATA, 'deleted');
const UPLOAD_DIR = path.join(DATA, 'uploads');          // 粘贴 / 拖进来的附件存这里，30 天后清
const GRACE = 8000;                      // 归档后这么久才真的停进程，期间可以撤销
const KEEP_DELETED_DAYS = 30;
const TMUX = ['-L', 'ccboard'];          // 自己单独一个 tmux 服务，不碰用户原有的 tmux 会话
const TAIL_FIRST = 4 << 20, TAIL_MAX = 48 << 20;
const STALL_MS = Number(process.env.CCBOARD_STALL_MS) || 20 * 60000;   // 显示在运行、却这么久没有任何新记录 = 可能卡住了（实测正常干活最长安静约 11 分钟）
// 不是「你平时用的那一份」（换了端口、换了数据目录或换了主目录）就当成试验场：不碰 Ghostty、不发系统通知。
// 这是它自己的默认行为，不靠调用的人记得带开关。
const REAL_HOME = (() => { try { return os.userInfo().homedir; } catch { return HOME; } })();
const SANDBOX = HOME !== REAL_HOME || PORT !== 4747 || path.resolve(DATA) !== path.join(REAL_HOME, 'Library/Application Support/cc-board');
const READONLY = process.env.CCBOARD_READONLY === '1';                 // 只读：所有会改东西的接口一律拒绝（拿真实会话预览时用）

// ───────────── config.json：项目表、自动点信任、Codex ─────────────
// 数据目录里一个文件，启动时读一次（./build.sh update 会重启服务）。没有或读不了就用默认值，记一行日志，不崩。
// 键：projects [{key, name, dir, word}]、neutral、roots（交给 projects.mjs 的 useRules）；autoTrust、codex（true / false，默认都是 false）
const CONFIG_FILE = path.join(DATA, 'config.json');
const CONFIG = (() => {
  const def = { autoTrust: false, codex: false };
  let raw; try { raw = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch { console.log(`config ${CONFIG_FILE}：没有这个文件，用默认值`); return def; }
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('不是一个 JSON 对象');
    for (const k of ['autoTrust', 'codex']) if (k in c && typeof c[k] !== 'boolean') throw new Error(k + ' 要是 true 或 false');
    const r = useRules({ projects: c.projects, neutral: c.neutral, roots: c.roots });
    console.log(`config ${CONFIG_FILE}：${r.list.length} 个项目，autoTrust=${c.autoTrust === true}，codex=${c.codex === true}`);
    return { autoTrust: c.autoTrust === true, codex: c.codex === true };
  } catch (e) { useRules(); console.log(`config ${CONFIG_FILE}：读不了（${e.message}），用默认值`); return def; }
})();

function loadToken() {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

function run(cmd, args, { input, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').replace(/\n$/, ''), err: String(stderr || (err && err.message) || '').trim() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const osa = (script, args = [], timeout) => run('/usr/bin/osascript', ['-', ...args], { input: script, timeout });
let TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => fs.existsSync(p)) || 'tmux';
const tmux = (args, opt) => run(TMUX_BIN, [...TMUX, ...args], opt);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screenLines = (text, n) => String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''))
  .filter((l) => l.trim() && !/^[\s─━═│┃╭╮╰╯┌┐└┘▔▁]+$/.test(l)).slice(-n).join('\n');

// ───────────── 对话记录 → 状态 ─────────────

function cleanPrompt(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim();
}

function toolLine(b) {
  const i = b.input || {};
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (b.name) {
    case 'Bash': return i.description || String(i.command || '').slice(0, 70);
    case 'Read': return '读 ' + base(i.file_path);
    case 'Edit': case 'Write': case 'NotebookEdit': return '改 ' + base(i.file_path || i.notebook_path);
    case 'Agent': case 'Task': return '派子任务：' + (i.description || '');
    case 'Workflow': return '跑多 agent 流程';
    case 'WebSearch': return '搜索：' + (i.query || '');
    case 'WebFetch': return '读网页';
    case 'Skill': return '用技能 ' + (i.skill || '');
    case 'SendMessage': return '给 ' + (i.to || '别的会话') + ' 发消息';
    case 'AskUserQuestion': return '在问你问题';
    case 'Grep': case 'Glob': return '找文件';
    default: return String(b.name || '').replace(/^mcp__/, '').replace(/__/g, ' · ').slice(0, 50);
  }
}

function userText(d) {
  const c = d.message && d.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
  return '';
}
function isToolResult(d) {
  const c = d.message && d.message.content;
  return Array.isArray(c) && c.some((x) => x && x.type === 'tool_result');
}
// 是不是用户本人打的字（不是别的 agent 发来的、不是斜杠命令、不是任务通知）
function isHuman(d, text) {
  if (d.origin) return d.origin.kind === 'human';
  if (d.turnOrigin) return d.turnOrigin === 'human';
  return !/^\s*</.test(text);
}

function newState() {
  return { files: new Map(), nHuman: 0, nTools: 0, nEdits: 0, title: null, custom: null, prompt: null, promptAt: null, result: null, resultAt: null, finalId: null,
    note: null, noteAt: null, tool: null, steps: 0, turnAt: null, ask: null, queued: null, lastAt: null, done: false,
    open: false, halt: null };          // open = 这一轮还没收尾；halt = 这一轮为什么停了 {kind, text, at}
}
// 按了 Esc 之后，记录里会多一条 user 消息，内容就是这句标记。它不是你说的话。
const isInterrupt = (text) => /^\s*\[Request interrupted by user/.test(text);
// API 报错在记录里是一条 model 为 <synthetic> 的 assistant 消息，error 字段说是哪一类
function haltOf(d, m) {
  const text = m.content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
  // 安全检查拦下这条消息（11/13 Khalil 定单独标出来）：error 是 invalid_request、stop_reason 是 refusal，正文是「<模型>'s safeguards flagged this message」。
  // 11/12 12:00 起本机 22 条 API 报错里 18 条是它。上下文过长也是 invalid_request，但 stop_reason 是 stop_sequence，不能认成它
  const flagged = m.stop_reason === 'refusal' || /safeguards flagged/i.test(text);
  const kind = flagged ? 'flagged' : d.error === 'rate_limit' ? 'limit' : d.error === 'authentication_failed' ? 'auth' : 'error';
  return { kind, text: text.slice(0, 600), at: d.timestamp };
}

function apply(st, d) {
  switch (d.type) {
    case 'ai-title': if (d.aiTitle) st.title = d.aiTitle; return;
    case 'custom-title': st.custom = d.customTitle || d.title || st.custom; return;
    case 'queue-operation':
      if (d.operation === 'enqueue' && d.content) st.queued = { text: String(d.content), at: d.timestamp };
      return;
    case 'user': {
      if (d.isSidechain) return;
      if (isToolResult(d)) {
        if (st.ask && d.message.content.some((x) => x && x.tool_use_id === st.ask.id)) st.ask = null;
        st.lastAt = d.timestamp; return;
      }
      if (d.origin && d.origin.kind === 'peer') { if (!st.open) st.turnBy = 'peer'; return; }   // 别的窗口发来的话开了这一轮：这一轮交付的是给它的，不是给你的
      if (d.isMeta || d.isCompactSummary) return;            // 压缩对话时自动写的摘要，不是你说的话
      const text = userText(d);
      if (isInterrupt(text)) {                               // 一轮做到一半被打断：记下来；没在做事时按的 Esc 不算
        if (st.open) { st.halt = { kind: 'interrupt', text: '', at: d.timestamp }; st.open = false; st.ask = null; }
        st.lastAt = d.timestamp; return;
      }
      if (!isHuman(d, text)) {
        if (!/^\s*<(command-|local-command)/.test(text)) { st.turnAt = d.timestamp; st.steps = 0; st.open = true; }   // halt 不清：被后台通知叫醒不等于它真的往下走了
        return;
      }
      st.prompt = cleanPrompt(text); st.promptAt = d.timestamp; st.turnAt = d.timestamp; st.nHuman++;
      st.turnBy = 'human';
      st.steps = 0; st.note = null; st.tool = null; st.done = false; st.ask = null; st.lastAt = d.timestamp;
      st.open = true; st.halt = null;
      return;
    }
    case 'assistant': {
      if (d.isSidechain) return;
      const m = d.message;
      if (!m || !Array.isArray(m.content)) return;
      if (m.model === '<synthetic>') {                       // 额度用完、登录过期、请求被拒：这一轮到此为止
        if (d.isApiErrorMessage) {
          const h = haltOf(d, m);                            // 同一种错连着报（额度没恢复时每次被叫醒都会再报一遍）算同一次停住，时间记第一次的
          if (st.halt && st.halt.kind === h.kind) st.halt.text = h.text; else st.halt = h;
          st.open = false; st.ask = null; st.lastAt = d.timestamp;
        }
        return;
      }
      const final = m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence';
      st.halt = null; st.open = !final;                      // 它又开口了 = 这一轮在往下走
      for (const b of m.content) {
        if (b.type === 'text' && b.text && b.text.trim()) {
          if (final) {
            st.result = (st.finalId === m.id && st.result) ? st.result + '\n\n' + b.text : b.text;
            st.finalId = m.id; st.resultAt = d.timestamp; st.note = null; st.tool = null; st.done = true;
            st.resultBy = st.turnBy || 'human';             // 这次交付是给谁的：你本人开的头，还是别的窗口
          } else { st.note = b.text; st.noteAt = d.timestamp; st.done = false; }
        } else if (b.type === 'tool_use') {
          st.steps++; st.tool = toolLine(b); st.done = false; noteTool(st.files, b.input);
          st.nTools++; if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) st.nEdits++;
          if (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode') st.ask = { id: b.id, name: b.name, input: b.input || {} };
        }
      }
      st.lastAt = d.timestamp;
    }
  }
}

// ── Codex CLI 的会话记录（~/.codex/sessions/年/月/日/rollout-*.jsonl）──
function codexText(content) {
  return Array.isArray(content) ? content.filter((x) => x && typeof x.text === 'string').map((x) => x.text).join('\n') : '';
}
// Codex 会把 AGENTS.md、环境信息也记成「用户消息」，这些不是你说的话
const codexInjected = (t) => /^\s*</.test(t) || /^\s*# AGENTS\.md instructions/.test(t) || /<INSTRUCTIONS>/.test(t.slice(0, 300));
function newCodexState() {
  return { files: new Map(), nHuman: 0, nTools: 0, nEdits: 0, title: null, prompt: null, promptAt: null, firstPrompt: null, result: null, resultAt: null, note: null, noteAt: null,
    tool: null, steps: 0, turnAt: null, busy: false, done: false, lastText: null, lastAt: null, queued: null, halt: null };
}
function applyCodex(st, d) {
  const p = d.payload || {};
  if (d.type === 'event_msg') {
    if (p.type === 'task_started') { st.busy = true; st.turnAt = d.timestamp; st.steps = 0; st.note = null; st.tool = null; st.done = false; st.lastText = null; st.halt = null; }
    else if (p.type === 'task_complete') {
      st.busy = false; const text = (p.last_agent_message && String(p.last_agent_message)) || st.lastText;
      if (text) { st.result = text; st.resultAt = d.timestamp; st.done = true; st.halt = null; }
      st.note = null; st.tool = null;
    } else if (p.type === 'turn_aborted') { st.busy = false; st.halt = { kind: 'interrupt', text: '', at: d.timestamp }; }
    else if (p.type === 'error' && p.message) { st.halt = { kind: 'error', text: String(p.message).slice(0, 600), at: d.timestamp }; }
    else if (p.type === 'agent_message' && p.message) { st.note = String(p.message); st.noteAt = d.timestamp; st.lastText = st.note; }
  } else if (d.type === 'response_item') {
    if (p.type === 'message' && p.role === 'user') {
      const text = codexText(p.content);
      if (text.trim() && !codexInjected(text)) { st.prompt = cleanPrompt(text); st.promptAt = d.timestamp; st.nHuman++; if (!st.firstPrompt) st.firstPrompt = st.prompt; }
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = codexText(p.content);
      if (text.trim()) { st.lastText = text; if (st.busy) { st.note = text; st.noteAt = d.timestamp; } }
    } else if (/_call$/.test(p.type || '')) {
      st.steps++; st.tool = String(p.name || p.type || '').replace(/_/g, ' ').slice(0, 40); noteTool(st.files, p.arguments || p.input || ''); st.nTools++; if (/apply_patch/.test(p.name || '')) st.nEdits++;
    }
  }
  st.lastAt = d.timestamp || st.lastAt;
}
function readCodexTurns(file, want) {
  const size = fs.statSync(file).size; let span = Math.min(size, 8 << 20), turns = [];
  for (;;) {
    turns = []; let cur = null, lastText = null;
    scanRange(file, size - span, size, span < size, null, (d) => {
      const p = d.payload || {};
      if (d.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        const text = codexText(p.content);
        if (text.trim() && !codexInjected(text)) { cur = { prompt: cleanPrompt(text), at: d.timestamp, results: [], steps: 0 }; turns.push(cur); lastText = null; }
      } else if (!cur) { return; }
      else if (d.type === 'response_item' && p.type === 'message' && p.role === 'assistant') { const t = codexText(p.content); if (t.trim()) lastText = t; }
      else if (d.type === 'response_item' && /_call$/.test(p.type || '')) cur.steps++;
      else if (d.type === 'event_msg' && p.type === 'task_complete') { const t = (p.last_agent_message && String(p.last_agent_message)) || lastText; if (t) cur.results.push({ text: t, at: d.timestamp }); }
    });
    if (turns.length >= want || span >= size || span >= (64 << 20)) break;
    span = Math.min(size, span * 4);
  }
  return turns.slice(-want);
}

// 逐行读文件的一段，把每行 JSON 交给 onObj；体积大的记账行不解析
function scanRange(file, from, to, dropFirst, carry, onObj) {
  const fd = fs.openSync(file, 'r');
  let rest = carry || Buffer.alloc(0);
  try {
    const CH = 1 << 20;
    let off = from, first = dropFirst;
    while (off < to) {
      const n = Math.min(CH, to - off);
      const b = Buffer.allocUnsafe(n);
      const r = fs.readSync(fd, b, 0, n, off);
      if (r <= 0) break;
      off += r;
      let chunk = r < n ? b.subarray(0, r) : b;
      if (first) {                       // 从文件中间开始读：丢掉开头那半行
        const nl = chunk.indexOf(10);
        if (nl < 0) continue;
        chunk = chunk.subarray(nl + 1); first = false;
      }
      let data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let start = 0;
      for (;;) {
        const nl = data.indexOf(10, start);
        if (nl < 0) break;
        const line = data.subarray(start, nl); start = nl + 1;
        if (line.length < 12) continue;
        const head = line.subarray(0, 24).toString('latin1');
        if (head.startsWith('{"type":"api-request') || head.startsWith('{"type":"file-history')) continue;
        let d; try { d = JSON.parse(line.toString('utf8')); } catch { continue; }
        if (d && typeof d === 'object') onObj(d);
      }
      rest = Buffer.from(data.subarray(start));
    }
  } finally { fs.closeSync(fd); }
  return rest;
}

function locate(sid, cwd) {
  const cand = path.join(PROJ_DIR, String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'), sid + '.jsonl');
  if (fs.existsSync(cand)) return cand;
  try {
    for (const d of fs.readdirSync(PROJ_DIR)) {
      const p = path.join(PROJ_DIR, d, sid + '.jsonl');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

class Track {
  constructor(sid, cwd, codexFile) { this.sid = sid; this.cwd = cwd; this.file = codexFile || null; this.pos = 0; this.rest = null;
    this.codex = !!codexFile; this.mk = this.codex ? newCodexState : newState; this.ap = this.codex ? applyCodex : apply; this.st = this.mk(); this.loaded = false;
    this.quiet = 0; this.mark = ''; this.sideM = 0; this.sideAt = 0; }
  // 「显示在运行、却没有新记录」累计了多久。只在服务自己醒着的时候累计（电脑睡一觉不算），有新记录就清零。
  // 派出去的子任务写在旁边的 subagents 文件夹里，那里有动静也算。
  tick(busy, dt) {
    const mark = this.pos + ':' + this.sideM;
    if (!busy || mark !== this.mark) { this.mark = mark; this.quiet = 0; return 0; }
    this.quiet += dt;
    if (this.quiet > 60000 && !this.codex && this.file && Date.now() - this.sideAt > 30000) {
      this.sideAt = Date.now(); let m = 0;
      try { const dir = this.file.replace(/\.jsonl$/, '') + '/subagents'; for (const f of fs.readdirSync(dir)) { const t = fs.statSync(path.join(dir, f)).mtimeMs; if (t > m) m = t; } } catch {}
      if (m > this.sideM) { this.sideM = m; this.mark = this.pos + ':' + m; this.quiet = 0; }
    }
    return this.quiet;
  }
  refresh() {
    if (!this.file) { this.file = locate(this.sid, this.cwd); if (!this.file) return; }
    let size; try { size = fs.statSync(this.file).size; } catch { this.file = null; return; }
    if (this.loaded && size < this.pos) this.loaded = false;
    if (!this.loaded) {
      let span = Math.min(size, TAIL_FIRST);
      for (;;) {                          // 先读尾巴；没读到用户的话就再往前多读
        this.st = this.mk();
        this.rest = scanRange(this.file, size - span, size, span < size, null, (d) => this.ap(this.st, d));
        if (this.st.prompt || span >= size || span >= TAIL_MAX) break;
        span = Math.min(size, span * 4);
      }
      this.pos = size; this.loaded = true; return;
    }
    if (size > this.pos) {
      this.rest = scanRange(this.file, this.pos, size, false, this.rest, (d) => this.ap(this.st, d));
      this.pos = size;
    }
  }
}

// 干净的对话：每轮只留「你说的」和「它交付的」
function readTurns(file, want) {
  const size = fs.statSync(file).size;
  let span = Math.min(size, 8 << 20), turns = [];
  for (;;) {
    turns = []; let cur = null, finalId = null;
    scanRange(file, size - span, size, span < size, null, (d) => {
      if (d.isSidechain) return;
      if (d.type === 'user' && !isToolResult(d) && !d.isMeta && !d.isCompactSummary) {
        const text = userText(d);
        if (isHuman(d, text) && !isInterrupt(text)) { cur = { prompt: cleanPrompt(text), at: d.timestamp, results: [], steps: 0 }; turns.push(cur); finalId = null; }
      } else if (d.type === 'assistant' && cur && d.message && Array.isArray(d.message.content) && d.message.model !== '<synthetic>') {
        const m = d.message, final = m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence';
        for (const b of m.content) {
          if (b.type === 'tool_use') cur.steps++;
          else if (b.type === 'text' && b.text && b.text.trim() && final) {
            if (finalId === m.id && cur.results.length) cur.results[cur.results.length - 1].text += '\n\n' + b.text;
            else cur.results.push({ text: b.text, at: d.timestamp });
            finalId = m.id;
          }
        }
      }
    });
    if (turns.length >= want || span >= size || span >= (64 << 20)) break;
    span = Math.min(size, span * 4);
  }
  return turns.slice(-want);
}

// ───────────── 会话登记 ─────────────

const tracks = new Map();
let sessions = [];       // 给界面的列表（不含已归档）
let allSessions = [];    // 所有活着的会话
let otherCount = 0;
let notices = [];        // 给界面弹一次的提示

let archive = { items: {} };
try { const a = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); if (a && a.items) archive = a; } catch {}
function saveArchive() { const tmp = ARCHIVE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(archive, null, 1)); fs.renameSync(tmp, ARCHIVE_FILE); }
const stopTimers = new Map();

const CODEX_HOME = path.join(HOME, '.codex');
const AGENTS_FILE = path.join(DATA, 'agents.json');   // 总控台起的 Codex 会话：tmux 名 → {cwd, at, prompt, sid, rollout}
let agents = {};
try { agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) || {}; } catch {}
function saveAgents() { const tmp = AGENTS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(agents, null, 1)); fs.renameSync(tmp, AGENTS_FILE); }
const codexTracks = new Map();
const p2 = (n) => String(n).padStart(2, '0');
function findRollout(a) {                                  // 启动之后新出现的、文件夹对得上的那份记录
  const claimed = new Set(Object.values(agents).map((x) => x.rollout).filter(Boolean));
  for (const off of [0, 86400000]) {
    const dt = new Date(a.at + off);
    const dir = path.join(CODEX_HOME, 'sessions', String(dt.getFullYear()), p2(dt.getMonth() + 1), p2(dt.getDate()));
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f); if (claimed.has(fp)) continue;
      let head = '';
      try { if (fs.statSync(fp).birthtimeMs < a.at - 4000) continue; const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd); head = b.subarray(0, n).toString('utf8'); } catch { continue; }
      const cwd = (head.match(/"cwd":"((?:[^"\\]|\\.)*)"/) || [])[1];
      const id = (head.match(/"session_id":"([^"]+)"/) || head.match(/"id":"([0-9a-f-]{30,})"/) || [])[1];
      if (!id || !cwd) continue;
      let real = cwd; try { real = JSON.parse('"' + cwd + '"'); } catch {}
      const same = (x, y) => { try { return fs.realpathSync(x) === fs.realpathSync(y); } catch { return x === y; } };
      if (same(real, a.cwd)) return { rollout: fp, sid: id };
    }
  }
  return null;
}
function codexSessions(seen) {
  const out = []; let dirty = false;
  for (const [name, a] of Object.entries(agents)) {
    const pane = panes.find((x) => x.name === name);
    if (!pane) { if (panesAt > a.at + 6000) { delete agents[name]; if (a.sid) codexTracks.delete(a.sid); dirty = true; } continue; }
    if (!a.rollout) { const f = findRollout(a); if (!f) continue; a.rollout = f.rollout; a.sid = f.sid; dirty = true; }
    let tr = codexTracks.get(a.sid);
    if (!tr) { tr = new Track(a.sid, a.cwd, a.rollout); codexTracks.set(a.sid, tr); }
    try { tr.refresh(); } catch {}
    const st = tr.st; seen.add(a.sid);
    const first = a.prompt || st.firstPrompt || 'Codex 会话';
    const ws = waitScreens.get(name);
    const o = { sid: a.sid, provider: 'codex', pid: pane.pid, cwd: a.cwd, startedAt: a.at, status: ws && ws.dialog ? 'waiting' : st.busy ? 'busy' : 'idle', statusAt: null,
      screen: ws ? ws.screen : null, dialog: ws ? ws.dialog : null,
      regName: name, userNamed: false, title: first.replace(/\s+/g, ' ').slice(0, 28), aiTitle: null, custom: null,
      prompt: st.prompt || a.prompt || null, promptAt: st.promptAt, ...deliver(st.result), resultAt: st.resultAt, done: st.done,
      note: st.note, noteAt: st.noteAt, tool: st.tool, steps: st.steps, turnAt: st.turnAt, lastAt: st.lastAt, ask: null,
      channel: 'tmux', tmux: name, order: 5e5, model: a.model || null, effort: a.effort || null, halt: st.halt, file: tr.file };
    o.quiet = tr.tick(o.status === 'busy', scanDt); o.alert = alertOf(o);
    o.project = classify(st.files, { title: o.title, prompt: o.prompt, cwd: o.cwd, home: HOME, pin: pinOf(name) });
    out.push(o);
  }
  if (dirty) saveAgents();
  return out;
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// ───────────── 停住了要让人知道 ─────────────
// 一个会话现在要不要你去跟进。key 相同 = 同一件事：界面上点过「先不管」、系统通知发过一次，就不再重复。
// ── 交付摘要：它这一轮最后那段话里，扫一眼就要知道的事 ──
// head = 一句结论；ask = 要你做的那一件事；need = reply（待跟进：要你本人做决定或动手）| review（待审阅：给你的结果）| fyi（无需处理：回给别的窗口的、过程汇报）| bg（它说还在后台跑）。
// Khalil 11/12 16:05 定的：「待跟进的意思就是 Agent 做完，需要我做决定」「有时候是交付给其他 Agent 的，并不是交给我的，要分清楚」。
// 它自己在最后写了一行【待跟进】/【待审阅】/【进展】（旧写法【在跑】）就以它为准（tag = true），那一行从正文里拿掉；没写就按正文猜：
// 问你、请你定 / 选 / 回一句 → 待跟进；写明「不需要你…」或这一轮是别的窗口开的头（by = 'peer'）→ 无需处理；其余 → 待审阅。
// skip = 正文开头那一段已经整段当成 head 显示了，界面从这里往后显示，同一句话不出现两遍。
const DG_TAG = /^\s*(?:\*\*)?【(待跟进|待审阅|在跑|进展)】(?:\*\*)?\s*[:：]?\s*(.+?)\s*$/;
const DG_TRIO = /^\s*(?:[-*]\s*)?(?:\*\*)?(做了什么|怎么做的|一个新词)(?:\*\*)?\s*[:：]/;
const DG_LEAD = /^(结论|一句话|总结|TL;?DR|简单说|先说结论)\s*[:：]\s*/i;
const DG_COND = /的话|如果|要是|假如|万一|不满意|有问题|不对劲|随时|想要|想停|想换|不急|有空|\bif\b|(错|不对|不行|不是|没有|没出现|看不到|卡住|失败|打不开)了?[，,]?\s*(就|再)?(告诉我|跟我说|说一声|叫我)/i;
const DG_LATER = /(出来|跑完|做完|合完|验完|好了|出图)(以?后|之后|，|我)|到时|点头后|点头了再/;
const DG_NONE = /不用你|不需要你|无需你|你不用|不用管|不需要做什么|不用做什么|不用回|no action needed|nothing for you/i;
const DG_STRONG = /请你|麻烦你|需要你|要你(定|选|确认|回|做|点|看|拍板|决定|处理)|你(来)?定[。！？，]|你选(?![的了过中])|你决定(?![的了过])|你拍板|你点头|等你(回|定|选|点头|确认|拍板|说|决定|的)|回(我)?一句|回我|你自己来|你自己点|交给你|留给你|\bplease (confirm|choose|pick|decide|reply)|\bwaiting (for|on) you\b|\byour call\b/i;
const DG_QWORD = /你|要不要|行不行|好不好|可不可以|可以吗|对吗|吗[？?]|呢[？?]|哪个|哪种|哪一|还是|\byou\b|\bshould I\b/i;
const dgPlain = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
  .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim();
const dgSentences = (p) => (p.match(/[^。！？!?]+[。！？!?]?/g) || []).map((x) => x.trim()).filter(Boolean);
const dgClip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function digest(src, by) {
  const all = String(src || '').replace(/\r/g, '').split('\n');
  let tag = null, ti = -1;
  for (let i = all.length - 1; i >= 0; i--) { const m = all[i].match(DG_TAG); if (m) { tag = { k: m[1], t: dgPlain(m[2]) }; ti = i; break; } }
  const lines = ti < 0 ? all : all.filter((_, i) => i !== ti); const text = lines.join('\n').trimEnd();
  const blocks = []; let buf = null, fence = false;
  const push = () => { if (buf) { blocks.push(buf); buf = null; } };
  const add = (i) => { if (!buf) buf = { a: i, b: i, t: [] }; buf.b = i; buf.t.push(lines[i]); };
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; push(); return; }
    if (fence || DG_TRIO.test(l)) { push(); return; }
    if (!l.trim() || /^\s*\|/.test(l) || /^\s*>/.test(l) || /^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(l)) { push(); return; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*#{1,6}\s/.test(l)) { push(); add(i); push(); return; }
    add(i);
  });
  push();
  const paras = blocks.map((b) => ({ ...b, p: dgPlain(b.t.join(' ')) })).filter((b) => b.p);
  let head = null, skip = 0;
  if (paras.length) {
    const p0 = paras[0], full = p0.p.replace(DG_LEAD, '').replace(/[：:]$/, ''), ss = dgSentences(full);
    head = ss[0] || full; if (head.length < 14 && ss[1]) head += ss[1];
    if (head.length < 14 && !ss[1] && paras[1]) { const nx = dgSentences(paras[1].p.replace(DG_LEAD, ''))[0]; if (nx) head += nx; }
    head = head.replace(/[：:]$/, '');
    if (head.length >= full.length && head.length <= 90 && lines.slice(0, p0.a).every((l) => !l.trim())) skip = lines.slice(0, p0.b + 1).join('\n').length;
    head = dgClip(head, 90);
  }
  if (tag) {
    const reply = tag.k === '待跟进';
    return { text, tag: true, need: reply ? 'reply' : tag.k === '在跑' ? 'bg' : tag.k === '进展' ? 'fyi' : 'review', head: reply ? head : dgClip(tag.t, 90), skip: reply ? skip : 0, ask: reply ? dgClip(tag.t, 90) : null };
  }
  const ss = []; paras.forEach((b, pi) => dgSentences(b.p).forEach((x) => ss.push({ x, pi })));
  const none = ss.some((o) => DG_NONE.test(o.x) && !DG_COND.test(o.x));
  let ask = null, score = 0;
  if (!none) for (const o of ss) {
    const u = o.x.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"/g, '「」'); if (DG_COND.test(u) || DG_LATER.test(u) || DG_NONE.test(u)) continue;
    const sc = (/[？?]$/.test(u) && DG_QWORD.test(u)) || DG_STRONG.test(u) ? 2 : 0;     // 「……了告诉我」这类顺口的不算：待跟进只给要你做决定的
    if (sc && sc >= score) { score = sc; let t = o.x; if ((/[：:]$/.test(t) || t.length < 10) && paras[o.pi + 1]) t += ' ' + paras[o.pi + 1].p; ask = dgClip(t.replace(/^[，,、\s]+/, ''), 90); }
  }
  return { text, tag: false, need: ask ? 'reply' : none || by === 'peer' ? 'fyi' : 'review', head, skip, ask };
}
const digestMemo = new Map();
function deliver(src, by) {                     // 交给界面的交付：去掉状态行的正文 + 摘要。同一段话只算一次
  if (!src) return { result: null, digest: null };
  const key = (by || '') + '\u0001' + src; let d = digestMemo.get(key);
  if (!d) { d = digest(src, by); digestMemo.set(key, d); if (digestMemo.size > 300) digestMemo.delete(digestMemo.keys().next().value); }
  return { result: d.text.length > 30000 ? d.text.slice(0, 30000) + '\n\n…（太长，剩下的去终端看）' : d.text || null,
    digest: { head: d.head, ask: d.ask, need: d.need, tag: d.tag, skip: d.skip } };
}

function alertOf(s) {
  if (s.ask || s.status === 'waiting') return null;                    // 「等你选」是另一种状态，卡片上本来就写明
  if (s.status === 'busy') return s.quiet >= STALL_MS ? { kind: 'stall', key: 'stall@' + (s.turnAt || s.promptAt || ''), text: '', at: null } : null;
  if (s.halt) return { kind: s.halt.kind, key: s.halt.kind + '@' + s.halt.at, text: s.halt.text || '', at: s.halt.at };
  if (s.done && s.result) return null;
  if (!(s.note || s.steps)) return null;
  if (s.status === 'shell') return null;                               // 它放到后台的活还在跑，跑完会自己接着做，不算「没做完就停了」
  const since = s.statusAt || Date.parse(s.lastAt || '') || 0;         // 刚停下的头 3 秒先不算：最后一句话可能还没落盘
  if (Date.now() - since < 3000) return null;
  return { kind: 'unfinished', key: 'unfinished@' + (s.noteAt || s.turnAt || s.promptAt || ''), text: '', at: s.lastAt || null };
}

let scanAt = 0, scanDt = 0;
const lastLive = new Map();    // 上一轮还活着的会话：sid → {title, cwd, provider, file, prompt, resultAt, mid}；mid = 当时一轮做到一半
const goneSince = new Map();   // 不见了的：sid → 第一次发现不见的时间
const leaving = new Map();     // 总控台自己停掉的（归档、删除）：sid → 时间。这些不算「意外退出」
// 做到一半、进程没了（终端被关、崩溃、重启）：卡片以前是直接消失。现在记进归档并标成 lost，界面上留一张卡告诉你。
function watchGone(out, seen) {
  const now = Date.now(); let dirty = false;
  for (const [sid, p] of lastLive) {
    if (seen.has(sid)) { goneSince.delete(sid); continue; }
    if (!p.mid || archive.items[sid] || leaving.has(sid)) { lastLive.delete(sid); goneSince.delete(sid); continue; }
    if (!goneSince.has(sid)) goneSince.set(sid, now);
    if (now - goneSince.get(sid) < 6000) continue;                     // 等 6 秒：恢复会话时进程号会换，中间有个空档
    archive.items[sid] = { sid, provider: p.provider, title: p.title, cwd: p.cwd, file: p.file, prompt: p.prompt, resultAt: p.resultAt,
      archivedAt: now, state: 'archived', lost: true, lostAt: goneSince.get(sid), project: p.project };
    dirty = true; lastLive.delete(sid); goneSince.delete(sid);
    queueAlert(p.title, 'gone');
  }
  for (const s of out) {
    const tr = tracks.get(s.sid) || codexTracks.get(s.sid);
    lastLive.set(s.sid, { title: s.title, cwd: s.cwd, provider: s.provider || 'claude', file: (tr && tr.file) || s.file || null, prompt: s.prompt, resultAt: s.resultAt, project: s.project,
      mid: s.status === 'busy' || s.status === 'waiting' });
  }
  for (const [sid, t] of leaving) if (now - t > 120000) leaving.delete(sid);
  if (dirty) saveArchive();
}

// 系统通知：你不在总控台前面时才发；几个窗口一起停（比如额度用完）合成一条；启动后的第一轮只记账不发。
const WHY = { limit: '额度用完了', auth: '登录过期了', flagged: '被安全检查拦了', error: '报错了', interrupt: '被打断了', unfinished: '没做完就停了', stall: '可能卡住了', gone: '进程退出了' };
const alerted = new Map();     // sid → 已经提醒过的 key
const alertHold = new Map();   // sid → {key, since}：站稳 4 秒才算，免得状态闪一下就打扰你
let alertBase = false, alertQueue = [], alertTimer = null, uiFocusAt = 0;
function queueAlert(title, kind) {
  alertQueue.push({ title: String(title || '').replace(/\s+/g, ' ').slice(0, 24), kind });
  if (!alertTimer) alertTimer = setTimeout(flushAlerts, 2500);
}
function watchAlerts() {
  const now = Date.now(); const live = new Set();
  for (const s of sessions) {
    live.add(s.sid); const a = s.alert;
    if (!a) { alertHold.delete(s.sid); continue; }
    if (alerted.get(s.sid) === a.key) continue;
    if (!alertBase) { alerted.set(s.sid, a.key); continue; }
    const h = alertHold.get(s.sid);
    if (!h || h.key !== a.key) { alertHold.set(s.sid, { key: a.key, since: now }); continue; }
    if (now - h.since < (a.kind === 'unfinished' ? 15000 : 4000)) continue;   // 原因不明的多等一会儿
    alerted.set(s.sid, a.key); alertHold.delete(s.sid);
    if (a.kind !== 'interrupt') queueAlert(s.title, a.kind);                  // 被打断是你自己按的 Esc，界面上标出来就够了
  }
  for (const k of [...alerted.keys()]) if (!live.has(k)) alerted.delete(k);
  for (const k of [...alertHold.keys()]) if (!live.has(k)) alertHold.delete(k);
  alertBase = true;
}
async function flushAlerts() {
  alertTimer = null; const q = alertQueue; alertQueue = []; if (!q.length) return;
  const title = q.length === 1 ? '「' + q[0].title + '」' + WHY[q[0].kind] : q.length + ' 个窗口停住了';
  const body = q.length === 1 ? '打开总控台跟进一下' : q.slice(0, 3).map((x) => '「' + x.title + '」' + WHY[x.kind]).join('；') + (q.length > 3 ? ' 等' : '');
  const would = Date.now() - uiFocusAt < 6000 ? 'ui' : 'sent';                    // ui = 你正看着总控台，界面自己会提示
  const how = SANDBOX ? 'dry:' + would : would;                                  // 试验场里只写日志，不真发
  console.log(`alert ${new Date().toISOString()} ${how} n=${q.length} ${q.map((x) => x.kind).join(',')}`);
  if (how !== 'sent') return;
  await new Promise((resolve) => execFile('/usr/bin/osascript', ['-e', 'display notification (system attribute "CCB_BODY") with title (system attribute "CCB_TITLE")'],
    { timeout: 8000, env: { ...process.env, CCB_TITLE: '总控台 · ' + title, CCB_BODY: body } }, () => resolve()));
}

function scanSessions() {
  const t0 = Date.now(); scanDt = scanAt ? Math.min(5000, t0 - scanAt) : 0; scanAt = t0;
  let files = [];
  try { files = fs.readdirSync(SESS_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  const out = []; let others = 0; const seen = new Set();
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8')); } catch { continue; }
    if (!d || !d.sessionId || !d.pid || !alive(d.pid)) continue;
    if (!(d.kind === 'interactive' && d.entrypoint === 'cli')) { others++; continue; }   // 别的程序起的 agent 不上墙
    seen.add(d.sessionId);
    let tr = tracks.get(d.sessionId);
    if (!tr) { tr = new Track(d.sessionId, d.cwd); tracks.set(d.sessionId, tr); }
    try { tr.refresh(); } catch (e) { /* 读不到就先显示登记信息 */ }
    const st = tr.st;
    const o = {
      sid: d.sessionId, provider: 'claude', pid: d.pid, cwd: d.cwd, startedAt: d.startedAt, status: d.status || 'idle',
      statusAt: d.statusUpdatedAt || d.updatedAt || null,
      regName: d.name || '', userNamed: d.nameSource && d.nameSource !== 'derived',
      title: st.custom || (d.nameSource && d.nameSource !== 'derived' ? d.name : null) || st.title || d.name || d.sessionId.slice(0, 8),
      aiTitle: st.title, custom: st.custom,
      prompt: st.prompt, promptAt: st.promptAt,
      ...deliver(st.result, st.resultBy),
      resultAt: st.resultAt, done: st.done,
      note: st.note, noteAt: st.noteAt, tool: st.tool, steps: st.steps, turnAt: st.turnAt, lastAt: st.lastAt,
      ask: st.ask ? askView(st.ask) : null, halt: st.halt,
    };
    o.quiet = tr.tick(o.status === 'busy', scanDt); o.alert = alertOf(o);
    o.project = classify(st.files, { title: o.title, prompt: o.prompt, cwd: o.cwd, home: HOME, pin: pinOf(panePid.get(d.pid)) });
    out.push(o);
  }
  attachChannels(out);
  if (CONFIG.codex) for (const c of codexSessions(seen)) out.push(c);   // codex 没打开：总控台起过的 Codex 会话和它们的记录都不读
  watchGone(out, seen);                                    // 要在清掉 tracks 之前：记「它当时的对话记录在哪」
  for (const k of [...tracks.keys()]) if (!seen.has(k)) tracks.delete(k);
  out.sort((a, b) => (a.order - b.order) || (a.startedAt - b.startedAt));
  let dirty = false;
  for (const [sid, it] of Object.entries(archive.items)) {
    if ((it.state === 'archived' || it.state === 'restoring') && seen.has(sid)) { delete archive.items[sid]; dirty = true; }   // 又活过来了（恢复成功，或他自己在终端里接上了）
    else if (it.state === 'restoring' && Date.now() - (it.restoreAt || 0) > 12000 && !panes.some((p) => p.name === it.tmux)) { it.state = 'archived'; dirty = true; }
  }
  if (dirty) saveArchive();
  allSessions = out; otherCount = others;
  sessions = out.filter((x) => !archive.items[x.sid]);
  watchAlerts();
}

function askView(ask) {
  if (ask.name === 'ExitPlanMode') return { kind: 'plan', questions: [{ q: '它写好了计划，等你批准', options: [] }] };
  const qs = Array.isArray(ask.input.questions) ? ask.input.questions : [];
  return { kind: 'ask', questions: qs.map((q) => ({ q: q.question || '', options: (q.options || []).map((o) => o.label || '') })) };
}

// ───────────── 往会话里发话的两条通道 ─────────────
// 1) 你原来开在 Ghostty 标签里的会话：用 Ghostty 自带的脚本接口往那个标签里「粘贴 + 回车」
// 2) 从总控台新开的会话：跑在没有窗口的 tmux 里，用 tmux 往里送字

const ENUM = `
set sep to (character id 9)
set out to ""
tell application "Ghostty"
  set wids to id of every window
  repeat with widRef in wids
    set wid to widRef as text
    set w to a reference to (first window whose id is wid)
    set n to count of tabs of w
    repeat with i from 1 to n
      set t to a reference to (tab i of w)
      set tids to id of every terminal of t
      set tnames to name of every terminal of t
      repeat with j from 1 to (count of tids)
        set out to out & wid & sep & i & sep & (item j of tids) & sep & (item j of tnames) & linefeed
      end repeat
    end repeat
  end repeat
end tell
return out
`;

let terms = [], ghosttyOk = false, termsAt = 0;
let panes = [], panesAt = 0;          // [{name, pid}]

const stripGlyph = (name) => { const m = String(name).match(/^([^\p{L}\p{N}\s])\s+(.*)$/u); return m ? m[2] : String(name); };

async function refreshTerms() {
  if (SANDBOX) { terms = []; ghosttyOk = false; return; }
  const running = await run('/usr/bin/pgrep', ['-x', 'ghostty']);
  if (!running.ok) { terms = []; ghosttyOk = false; return; }
  const r = await osa(ENUM, [], 8000);
  if (!r.ok) { ghosttyOk = false; return; }       // 读到一半窗口变了：保留上一次的结果
  const list = []; let k = 0;
  for (const line of r.out.split('\n')) {
    const f = line.split('\t');
    if (f.length < 4) continue;
    list.push({ win: f[0], tab: Number(f[1]), id: f[2], name: f[3], title: stripGlyph(f[3]), order: k++ });
  }
  terms = list; ghosttyOk = true; termsAt = Date.now();
}

async function refreshPanes() {
  const r = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_pid}\t#{session_created}\t#{pane_current_path}']);
  panes = r.ok ? r.out.split('\n').filter(Boolean).map((l) => { const [name, pid, created, cwd] = l.split('\t'); return { name, pid: Number(pid), created: Number(created) * 1000, cwd: cwd || '' }; }) : [];
  panesAt = Date.now();
  if (r.ok || /no server running/i.test(r.err || '')) prunePins();   // tmux 一时没应答不算会话没了
}

const ppidCache = new Map();
async function ppidOf(pid) {
  if (ppidCache.has(pid)) return ppidCache.get(pid);
  const r = await run('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]);
  const v = r.ok ? Number(r.out.trim()) : 0;
  ppidCache.set(pid, v); return v;
}
const panePid = new Map();   // 会话 pid → tmux 会话名
async function resolvePanes() {
  panePid.clear();
  for (const s of allSessions) {
    let hit = panes.find((p) => p.pid === s.pid);
    if (!hit && panes.length) { const pp = await ppidOf(s.pid); hit = panes.find((p) => p.pid === pp); }
    if (hit) panePid.set(s.pid, hit.name);
  }
}

// 标题对得上、而且一对一，才认这个标签是这个会话的
function attachChannels(list) {
  const byTitle = new Map();
  for (const t of terms) { if (!byTitle.has(t.title)) byTitle.set(t.title, []); byTitle.get(t.title).push(t); }
  const claim = new Map();
  for (const s of list) {
    s.channel = null; s.term = null; s.order = 1e6;
    const tm = panePid.get(s.pid);
    if (tm) { s.channel = 'tmux'; s.tmux = tm; s.order = 5e5; const ws = waitScreens.get(tm); s.screen = ws ? ws.screen : null; s.dialog = ws ? ws.dialog : null; continue; }
    const cands = [...new Set([s.custom, s.userNamed ? s.regName : null, s.aiTitle].filter(Boolean))];
    for (const c of cands) {
      const arr = byTitle.get(c);
      if (arr && arr.length === 1) { s.term = arr[0].id; s.termTitle = arr[0].title; s.order = arr[0].order; break; }
    }
    if (s.term) { if (!claim.has(s.term)) claim.set(s.term, []); claim.get(s.term).push(s); }
  }
  for (const arr of claim.values()) {
    if (arr.length > 1) for (const s of arr) { s.term = null; s.order = 1e6; }
    else arr[0].channel = 'ghostty';
  }
}

const SEND_GHOSTTY = `
on run argv
  set tid to item 1 of argv
  tell application "Ghostty"
    set t to (first terminal whose id is tid)
    set nm to name of t
    repeat with i from 2 to (count of argv)
      input text (item i of argv) to t
      delay 0.45
    end repeat
    delay 0.15
    send key "enter" to t
    return nm
  end tell
end run
`;
const FOCUS_GHOSTTY = `
on run argv
  tell application "Ghostty"
    activate
    focus (first terminal whose id is (item 1 of argv))
  end tell
end run
`;
const OPEN_TMUX = `
on run argv
  tell application "Ghostty"
    activate
    set cfg to new surface configuration
    set command of cfg to (item 1 of argv)
    if (count of windows) > 0 then
      new tab in front window with configuration cfg
    else
      new window with configuration cfg
    end if
  end tell
end run
`;

// 正文里的路径点了做什么。路径是模型写的，所以只有「看的东西」直接打开：普通文件夹（访达里打开），网页、图、音视频、PDF、文档、文本（默认程序打开）。
// 能执行的（.app、.command、.sh、.py…）、看着像文件夹的程序包（.app、.pkg）、认不出的，一律只在访达里选中。按符号链接指向的真身判断。
const OPEN_EXT = new Set(['html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg', 'bmp', 'tif', 'tiff', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg',
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'srt', 'vtt']);
function openAction(p) {
  let real, st; try { real = fs.realpathSync(p); st = fs.statSync(real); } catch { return null; }
  const ext = path.extname(real).slice(1).toLowerCase();
  if (st.isDirectory()) return ext ? 'reveal' : 'open';
  return OPEN_EXT.has(ext) ? 'open' : 'reveal';
}
function findSession(sid) { return sessions.find((s) => s.sid === sid); }

async function waitDelivered(sid, text, since, files = []) {
  const key = text.replace(/\s+/g, ' ').trim().slice(0, 24);
  const names = files.map((f) => path.basename(f));
  const hit = (v) => { if (!v) return false; const t = String(v).replace(/\s+/g, ' ');
    return key ? t.includes(key) : (/\[Image #\d+\]/.test(t) || names.some((n) => t.includes(n))); };
  for (let i = 0; i < 24; i++) {
    await sleep(400);
    const tr = tracks.get(sid) || codexTracks.get(sid); if (!tr) break;
    try { tr.refresh(); } catch {}
    const st = tr.st;
    if (st.promptAt && Date.parse(st.promptAt) >= since - 2000 && hit(st.prompt)) return true;
    if (st.queued && Date.parse(st.queued.at) >= since - 2000 && hit(st.queued.text)) return true;
  }
  return false;
}

async function sendTo(sid, text, rawFiles) {
  const files = await cleanFiles(rawFiles);
  if (!text && !files.length) return { ok: false, error: '没有内容' };
  const s0 = findSession(sid);
  if (!s0) return { ok: false, error: '这个会话已经不在了' };
  if (s0.ask || s0.status === 'waiting') return { ok: false, error: '它弹了一个选择框在等你选，直接打字会替你乱选，请点「终端」去回答' };
  const since = Date.now();
  if (s0.channel === 'tmux') {
    scanSessions();
    const s1 = findSession(sid);
    if (!s1 || s1.ask || s1.status === 'waiting') return { ok: false, error: '它弹了一个选择框在等你选，请点「终端」去回答' };
    const scr = await tmux(['capture-pane', '-p', '-t', s0.tmux]);     // 屏幕上真有选择框就不发（登记的状态可能慢半拍）
    if (!scr.ok) return { ok: false, error: '这个会话已经不在了' };
    if (parseDialog(scr.out)) return { ok: false, error: '它弹了一个选择框在等你选，先在卡片上选完再发' };
    for (const piece of pieces(s0, text, files)) {
      const a = await tmux(['load-buffer', '-b', 'ccb-in', '-'], { input: piece });
      if (!a.ok) return { ok: false, error: 'tmux：' + a.err };
      const b = await tmux(['paste-buffer', '-p', '-d', '-b', 'ccb-in', '-t', s0.tmux]);
      if (!b.ok) return { ok: false, error: 'tmux：' + b.err };
      await sleep(files.length ? 450 : 0);                      // 图片要等它读进来变成 [Image #n]
    }
    await sleep(500);
    await tmux(['send-keys', '-t', s0.tmux, 'Enter']);
  } else {
    await refreshTerms(); scanSessions();            // 发之前重新对一次，标题变了就不发
    const s = findSession(sid);
    if (s && (s.ask || s.status === 'waiting')) return { ok: false, error: '它弹了一个选择框在等你选，请点「终端」去回答' };
    if (!s || s.channel !== 'ghostty' || !s.term) return { ok: false, error: '没对上它在 Ghostty 里的标签（标题重名或还没生成），请去终端里回' };
    const r = await osa(SEND_GHOSTTY, [s.term, ...pieces(s, text, files)], 30000);
    if (!r.ok) return { ok: false, error: 'Ghostty：' + r.err };
  }
  const delivered = await waitDelivered(sid, text, since, files);
  return { ok: true, delivered };
}

async function focusSession(sid) {
  const s = findSession(sid);
  if (!s) return { ok: false, error: '这个会话已经不在了' };
  if (s.channel === 'tmux') {
    const r = await osa(OPEN_TMUX, [`${TMUX_BIN} -L ccboard attach -t ${s.tmux}`]);
    return r.ok ? { ok: true } : { ok: false, error: r.err };
  }
  if (!s.term) return { ok: false, error: '没对上它在 Ghostty 里的标签' };
  const r = await osa(FOCUS_GHOSTTY, [s.term]);
  return r.ok ? { ok: true } : { ok: false, error: r.err };
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const isImage = (p) => IMAGE_EXT.has(path.extname(p).toLowerCase());
const SIPS = '/usr/bin/sips';
function uploadPath(name) {
  const d = new Date(); const dir = path.join(UPLOAD_DIR, d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '').slice(-60) || 'file';
  return path.join(dir, p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '-' + crypto.randomBytes(2).toString('hex') + '-' + base);
}
// 手机照片常是 HEIC，Claude Code 不认；太大的图也先缩一下。原文件不动，转出来的放进 uploads。
async function normalizeFile(p) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const ext = path.extname(p).toLowerCase();
  if (ext === '.heic' || ext === '.heif' || ext === '.tiff' || ext === '.tif' || ext === '.bmp') {
    const out = uploadPath(path.basename(p, path.extname(p)) + '.jpg');
    const r = await run(SIPS, ['-s', 'format', 'jpeg', '-Z', '2400', p, '--out', out], { timeout: 60000 });
    if (r.ok && fs.existsSync(out)) return out;
    return p;
  }
  if (isImage(p) && ext !== '.gif' && st.size > 5 * 1024 * 1024) {
    const out = uploadPath(path.basename(p, path.extname(p)) + '.jpg');
    const r = await run(SIPS, ['-s', 'format', 'jpeg', '-Z', '2400', p, '--out', out], { timeout: 60000 });
    if (r.ok && fs.existsSync(out)) return out;
  }
  return p;
}
function fileInfo(p) { let size = 0; try { size = fs.statSync(p).size; } catch {} return { path: p, name: path.basename(p), size, image: isImage(p) }; }
async function cleanFiles(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list.slice(0, 12) : []) {
    const p = String(f || ''); if (!path.isAbsolute(p)) continue;
    const n = await normalizeFile(p); if (n) out.push(n);
  }
  return out;
}
// 图片单独贴一段原始路径，Claude Code 会把它变成 [Image #n]；别的文件带引号当文字；最后才是你的话
function pieces(s, text, files) {
  const q = (f) => (isImage(f) ? f : '"' + f + '"');
  if (s.provider === 'codex') return [[...files.map((f) => '"' + f + '"'), text].filter(Boolean).join(' ')];
  const out = [];
  files.forEach((f, i) => { if (i) out.push(' '); out.push(q(f)); });
  if (text) out.push((files.length ? ' ' : '') + text);
  return out;
}
const PICK_FILES = `
on run argv
  tell me to activate
  set fs to choose file with prompt (item 1 of argv) with multiple selections allowed
  set out to ""
  repeat with f in fs
    set out to out & (POSIX path of f) & linefeed
  end repeat
  return out
end run
`;
function purgeUploads() {
  try {
    for (const d of fs.readdirSync(UPLOAD_DIR)) {
      const full = path.join(UPLOAD_DIR, d); const st = fs.statSync(full);
      if (Date.now() - st.mtimeMs > KEEP_DELETED_DAYS * 86400000) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
}

const CLOSE_TERM = `
on run argv
  tell application "Ghostty" to close (first terminal whose id is (item 1 of argv))
end run
`;

// 停掉一个会话的进程。只认「登记里这个进程号现在还是这个会话」；不强杀。
async function stopSession(s) {
  leaving.set(s.sid, Date.now());                   // 是我们自己停的，别当成「意外退出」来提醒
  if (s.provider === 'codex') {                     // Codex 会话都是总控台自己起在 tmux 里的
    if (!/^ccb-[\w-]+$/.test(s.tmux || '')) return { ok: false, error: '不是总控台开的会话' };
    await tmux(['kill-session', '-t', s.tmux]);
    for (let i = 0; i < 25 && alive(s.pid); i++) await sleep(200);
    delete agents[s.tmux]; saveAgents(); codexTracks.delete(s.sid);
    return alive(s.pid) ? { ok: false, error: '它没停下来' } : { ok: true };
  }
  let reg = null;
  try { reg = JSON.parse(fs.readFileSync(path.join(SESS_DIR, s.pid + '.json'), 'utf8')); } catch {}
  if (!reg || reg.sessionId !== s.sid) return alive(s.pid) ? { ok: false, error: '进程号和会话对不上，没动它' } : { ok: true };
  if (s.channel === 'tmux' && /^ccb-[\w-]+$/.test(s.tmux || '')) {
    await tmux(['kill-session', '-t', s.tmux]);
  } else {
    const cmd = await run('/bin/ps', ['-o', 'command=', '-p', String(s.pid)]);
    if (!/claude/.test(cmd.out)) return { ok: false, error: '这个进程不是 Claude Code，没动它' };
    try { process.kill(s.pid, 'SIGTERM'); } catch {}
  }
  for (let i = 0; i < 40 && alive(s.pid); i++) await sleep(200);
  if (alive(s.pid)) return { ok: false, error: '它没停下来（我不强杀），请去终端里输入 /exit' };
  let tabClosed = false;
  if (s.channel === 'ghostty' && s.term) {          // 标签的标题确实变了（不再是这个会话）才关标签
    await sleep(700); await refreshTerms();
    const t = terms.find((x) => x.id === s.term);
    if (t && t.title !== s.termTitle) { const r = await osa(CLOSE_TERM, [s.term]); tabClosed = r.ok; }
  }
  return { ok: true, tabClosed };
}

function scheduleStop(sid) {
  const it = archive.items[sid]; if (!it) return;
  clearTimeout(stopTimers.get(sid));
  stopTimers.set(sid, setTimeout(async () => {
    stopTimers.delete(sid);
    const cur = archive.items[sid];
    if (!cur || cur.state !== 'archiving') return;
    const s = allSessions.find((x) => x.sid === sid);
    const r = s ? await stopSession(s) : { ok: true };
    if (r.ok && cur.drop) { dropArchived(sid, cur); return; }
    if (r.ok) { cur.state = 'archived'; delete cur.stopAt; }
    else { delete archive.items[sid]; notices.push({ id: crypto.randomBytes(4).toString('hex'), text: '「' + cur.title + '」没归档成：' + r.error }); }
    saveArchive(); scanSessions();
  }, Math.max(0, it.stopAt - Date.now())));
}

// 「归档」一个按钮（11/13 Khalil：「我就直接点一个归档，你就自己觉得该删的删，该记下来的记下来」）。
// 删：没留下东西的——一句话没说过；或者没改过文件、工具用了不到 4 次、你只说过一两句。其余留着（能接回来）。
// 在等你决定的（待跟进）一律留着。只看对话记录读进来的那一段（最近的 4 MB 起），长会话照样算「做了很多事」。
function tidyVerdict(s, st) {
  if (s.digest && s.digest.need === 'reply') return { keep: true, why: '它在等你决定' };
  if (!st.nHuman && !st.result) return { keep: false, why: '一句话都没说过' };
  if (!st.nEdits && st.nTools <= 3 && st.nHuman <= 2) return { keep: false, why: '只聊了几句，没改过文件' };
  return { keep: true, why: st.nEdits ? '改过 ' + st.nEdits + ' 次文件' : '用了 ' + st.nTools + ' 次工具' };
}
// 归档时记一笔：属于哪个项目、最后交付的那句结论、要你做的事、动过哪几个文件夹。归档列表里直接看得到
function tidyNote(s, st) {
  const roots = [...(st.files || new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r.replace(/^Projects\//, ''));
  const dg = s.digest || {};
  return { project: s.project ? s.project.name : null, head: dg.head || null, ask: dg.need === 'reply' ? dg.ask || null : null, roots, human: st.nHuman, tools: st.nTools, edits: st.nEdits };
}
function archiveSession(sid, force) {
  const s = allSessions.find((x) => x.sid === sid);
  if (!s) return { ok: false, error: '这个会话已经不在了' };
  if (archive.items[sid]) return { ok: true, grace: GRACE };
  if (s.status === 'busy' && !force) return { ok: false, needConfirm: true, error: '它还在做事，归档会打断它。' };
  const tr = tracks.get(sid) || codexTracks.get(sid), st = tr ? tr.st : newState(), v = tidyVerdict(s, st);
  archive.items[sid] = { sid, provider: s.provider || 'claude', title: s.title, cwd: s.cwd, file: tr ? tr.file : null, prompt: s.prompt, resultAt: s.resultAt,
    archivedAt: Date.now(), state: 'archiving', stopAt: Date.now() + GRACE, note: tidyNote(s, st), why: v.why, ...(v.keep ? {} : { drop: true }) };
  saveArchive(); scheduleStop(sid); scanSessions();
  return { ok: true, grace: GRACE, keep: v.keep, why: v.why };
}

async function unarchive(sid) {
  const it = archive.items[sid];
  if (!it) return { ok: false, error: '归档里没有它' };
  if (it.state === 'archiving') {                   // 还没真停：直接放回墙上
    clearTimeout(stopTimers.get(sid)); stopTimers.delete(sid);
    delete archive.items[sid]; saveArchive(); scanSessions();
    return { ok: true, resumed: false };
  }
  if (it.state === 'restoring') return { ok: true, resumed: true, name: it.tmux };
  const dir = it.cwd && fs.existsSync(it.cwd) ? it.cwd : HOME;   // 已经停了：在后台把这段对话重新接上
  const name = 'ccb-' + crypto.randomBytes(3).toString('hex');
  if (it.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };
  const cmd = it.provider === 'codex' ? [codexBin || 'codex', 'resume', sid] : [await findClaude(), '--resume', sid];
  const r = await tmux(['new-session', '-d', '-s', name, '-x', '160', '-y', '48', '-c', dir, ...cmd]);
  if (!r.ok) return { ok: false, error: 'tmux：' + r.err };
  if (it.provider === 'codex') { agents[name] = { cwd: dir, at: Date.now(), prompt: it.prompt || '', sid, rollout: it.file }; saveAgents(); }
  launches.set(name, { at: Date.now(), prompt: '恢复「' + it.title + '」', cwd: dir });
  it.state = 'restoring'; it.tmux = name; it.restoreAt = Date.now(); saveArchive();
  await refreshPanes();
  return { ok: true, resumed: true, name };
}

async function deleteSession(sid) {
  const s = allSessions.find((x) => x.sid === sid);
  const it = archive.items[sid];
  if (!s && !it) return { ok: false, error: '找不到这个会话' };
  clearTimeout(stopTimers.get(sid)); stopTimers.delete(sid);
  const anyTr = tracks.get(sid) || codexTracks.get(sid);
  const file = (it && it.file) || (anyTr && anyTr.file) || (s && s.provider !== 'codex' && locate(sid, s.cwd));
  if (s) { const r = await stopSession(s); if (!r.ok) return r; }
  let moved = false;
  if (file && fs.existsSync(file)) {                // 对话记录不直接删：挪到暂存处，30 天后清
    fs.mkdirSync(DELETED_DIR, { recursive: true });
    const base = path.join(DELETED_DIR, Date.now() + '-' + sid);
    fs.renameSync(file, base + '.jsonl'); moved = true;
    const side = file.replace(/\.jsonl$/, '');
    try { if (fs.statSync(side).isDirectory()) fs.renameSync(side, base + '.d'); } catch {}
  }
  delete archive.items[sid]; saveArchive(); tracks.delete(sid); scanSessions();
  return { ok: true, moved };
}

function moveToDeleted(file) {                   // 对话记录不直接删：挪到暂存处，30 天后清
  if (!file || !fs.existsSync(file)) return false;
  fs.mkdirSync(DELETED_DIR, { recursive: true });
  const base = path.join(DELETED_DIR, Date.now() + '-' + path.basename(file, '.jsonl'));
  fs.renameSync(file, base + '.jsonl');
  const side = file.replace(/\.jsonl$/, '');
  try { if (fs.statSync(side).isDirectory()) fs.renameSync(side, base + '.d'); } catch {}
  return true;
}
function dropArchived(sid, it) {
  const moved = moveToDeleted(it.file);
  delete archive.items[sid];
  archive.dropped = (archive.dropped || []).filter((x) => Date.now() - x.at < KEEP_DELETED_DAYS * 86400000);
  archive.dropped.unshift({ sid, title: it.title, prompt: it.prompt, why: it.why, note: it.note, at: Date.now(), moved });
  archive.dropped = archive.dropped.slice(0, 200);
  saveArchive(); tracks.delete(sid); codexTracks.delete(sid); scanSessions();
}
function purgeDeleted() {
  try {
    for (const f of fs.readdirSync(DELETED_DIR)) {
      const ts = Number(f.split('-')[0]);
      if (ts && Date.now() - ts > KEEP_DELETED_DAYS * 86400000) fs.rmSync(path.join(DELETED_DIR, f), { recursive: true, force: true });
    }
  } catch {}
}

let claudeBin = null;
async function findClaude() {
  if (claudeBin) return claudeBin;
  const r = await run('/bin/zsh', ['-lc', 'command -v claude']);
  const p = r.out.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')).pop();
  claudeBin = p || 'claude';
  return claudeBin;
}

const BORDER = /^[\s─━═│┃╭╮╰╯┌┐└┘▔▁]+$/;
function parseDialog(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  let hint = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/enter\s+(to\s+)?(confirm|select)/i.test(lines[i])) { hint = i; break; }
  if (hint < 0) return null;
  let ci = -1;
  for (let i = hint - 1; i >= Math.max(0, hint - 14); i--) if (/[❯›]/.test(lines[i])) { ci = i; break; }   // ❯ 是 Claude Code 的光标，› 是 Codex 的
  if (ci < 0) return null;
  const strip = (l) => l.replace(/[❯›]/, ' ');
  const col = (l) => { const t = strip(l); return t.length - t.trimStart().length; };
  const c = col(lines[ci]);
  let a = ci, b = ci;
  while (a > 0 && lines[a - 1].trim() && col(lines[a - 1]) === c) a--;
  while (b + 1 < hint && lines[b + 1].trim() && col(lines[b + 1]) === c) b++;
  const options = [];
  for (let i = a; i <= b; i++) options.push(strip(lines[i]).trim());
  if (options.length < 2 || options.length > 8) return null;
  const question = lines.slice(Math.max(0, a - 10), a).filter((l) => l.trim() && !BORDER.test(l)).map((l) => l.trim()).join('\n');
  return { question, options, cursor: ci - a };
}
async function answerDialog(name, idx, text) {
  for (let i = 0; i < 12; i++) {
    const cap = await tmux(['capture-pane', '-p', '-t', name]);
    if (!cap.ok) return { ok: false, error: '这个会话已经不在了' };
    const d = parseDialog(cap.out);
    if (!d || d.options[idx] !== text) return { ok: false, error: '选择框的内容变了，再看一眼再选' };
    if (d.cursor === idx) { const r = await tmux(['send-keys', '-t', name, 'Enter']); return { ok: r.ok, error: r.err }; }
    await tmux(['send-keys', '-t', name, d.cursor < idx ? 'Down' : 'Up']);
    await sleep(250);
  }
  return { ok: false, error: '光标没挪到那一项，请点「终端」手动选' };
}
const waitScreens = new Map();   // tmux 会话名 → 弹框时屏幕上的字
async function refreshWaitScreens() {
  const names = new Set();
  for (const s of sessions) {
    if (s.channel !== 'tmux' || (s.status !== 'waiting' && s.provider !== 'codex')) continue;   // Codex 没有状态登记，只能看屏幕
    const cap = await tmux(['capture-pane', '-p', '-t', s.tmux]);
    if (!cap.ok) continue;
    const dialog = parseDialog(cap.out);
    if (s.provider === 'codex' && !dialog) continue;
    names.add(s.tmux);
    waitScreens.set(s.tmux, { screen: screenLines(cap.out, 14), dialog });
  }
  for (const k of [...waitScreens.keys()]) if (!names.has(k)) waitScreens.delete(k);
}
// ───────────── 输入框上的「预判」：灰字建议 + 下一步 1/2/3 ─────────────
// Khalil 11/13 16:10：原生 Claude Code 的输入框里有灰字（Tab 收下），next-steps 插件在输入框上方给「1 / 2 / 3」，总控台卡片的输入框也要有。
// 两样都只画在终端屏幕上、不写进对话记录（拿真实记录 grep 过），所以只能读屏幕，由 suggest.mjs 解析。读屏只读，不碰会话的输入框，不调模型。
// 只看 tmux 里的 Claude 会话、状态是 idle 或 shell、已经交付过一轮的：忙着的没有预判；没交付过的新会话输入框里的 Try "…" 也是暗色字。
const SUGGEST_MS = Number(process.env.CCBOARD_SUGGEST_MS || 2500);
const SUGGEST_STATUS = new Set(['idle', 'shell']);    // shell = 放到后台的命令还在跑，终端里照样能回话、照样显示建议
const suggests = new Map();   // tmux 会话名 → { ghost, options: [{ n, label }] }
async function refreshSuggest() {
  const names = new Set();
  for (const s of sessions) {
    if (s.channel !== 'tmux' || s.provider !== 'claude' || !SUGGEST_STATUS.has(s.status) || s.ask || !s.resultAt) continue;
    const cap = await tmux(['capture-pane', '-p', '-e', '-t', s.tmux]);
    const g = cap.ok ? parseSuggest(cap.out) : null;
    if (g) { suggests.set(s.tmux, g); names.add(s.tmux); }
  }
  for (const k of [...suggests.keys()]) if (!names.has(k)) suggests.delete(k);
}
const withSuggest = (s) => (SUGGEST_STATUS.has(s.status) && s.tmux && suggests.has(s.tmux) ? { ...s, suggest: suggests.get(s.tmux) } : s);   // 刚转忙的那一两秒不再带

const launches = new Map();   // tmux 会话名 → {at, prompt, cwd}
let codexBin = null;
async function findCodex() {
  const r = await run('/bin/zsh', ['-lc', 'command -v codex']);
  const p = r.out.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')).pop();
  codexBin = p && fs.existsSync(p) ? p : null;
}
function providers() {
  let cm = null, ce = null, xm = null, xe = null;
  try { const j = JSON.parse(fs.readFileSync(path.join(HOME, '.claude/settings.json'), 'utf8')); cm = j.model || null; ce = j.effortLevel || null; } catch {}
  try { const t = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8');
    xm = (t.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || null; xe = (t.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || null; } catch {}
  return {
    claude: { label: 'Claude Code', ok: true, models: ['fable', 'opus', 'sonnet', 'haiku'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultModel: cm, defaultEffort: ce },
    ...(CONFIG.codex ? { codex: { label: 'Codex', ok: !!codexBin, models: xm ? [xm] : [], efforts: ['low', 'medium', 'high', 'xhigh'], defaultModel: xm, defaultEffort: xe } } : {}),
  };
}
// ───────────── 在某一列列头开的新任务：记住它属于哪一列 ─────────────
// Khalil 11/13：「在每一个主题下面再放一个新任务」。tmux 名 → {key, name, at}。存文件是因为 ./build.sh update 会重启服务，
// 刚开的会话还没动过文件，提示一丢就跳回「其他」。tmux 里没了这个会话就删掉（开出来 1 分钟以内的先留着，它可能还没出现在列表里）。
const PINS_FILE = path.join(DATA, 'pins.json');
let pins = {}; try { pins = JSON.parse(fs.readFileSync(PINS_FILE, 'utf8')) || {}; } catch {}
function savePins() { const tmp = PINS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(pins, null, 1)); fs.renameSync(tmp, PINS_FILE); }
const pinOf = (name) => (name && pins[name] ? { key: pins[name].key, name: pins[name].name } : null);
function prunePins() {
  let dirty = false;
  for (const [k, v] of Object.entries(pins)) if (!panes.some((p) => p.name === k) && Date.now() - (v.at || 0) > 60000) { delete pins[k]; dirty = true; }
  if (dirty) savePins();
}
function pinNote(p) {          // 换掉 FOLDER_NOTE：项目他已经指了，不用它再猜
  const where = p.key.startsWith('dir:') ? '项目文件夹是 ~/Projects 下以「' + p.name + '」开头的那个' : '先查记忆和 ~/Projects 下的文件夹，找到这个项目的文件夹';
  return '\n\n<system-reminder>这条任务是在总控台「' + p.name + '」那一列里新建的，属于「' + p.name + '」这个项目。工作目录是主目录。' + where + '，在那里做，不要问放在哪。不要把工程文件直接放在主目录。</system-reminder>';
}

// ───────────── 开工前的「信任这个文件夹」：替他点 ─────────────
// Khalil 11/13：「新建的时候还要点一下那个 Trust……我感觉这个多余，直接帮我点了呀」。
// 主目录的信任 Claude Code 不存（~/.claude.json 里主目录一直是 false），所以每开一个都问，默认光标还停在「No, exit」。
// 只替总控台自己刚开的会话点，只认「Yes, I trust this folder」这一项；屏幕上是别的选择框就停手，照旧交给他在卡片上选。
const TRUST_OPT = /^yes,? i trust this folder$/i;
const TRUST_WAIT = Number(process.env.CCBOARD_TRUST_MS || 60000);    // 机器忙时 Claude Code 起得慢，多等一会儿
async function autoTrust(name) {
  const end = Date.now() + TRUST_WAIT;
  while (Date.now() < end) {
    await sleep(400);
    const cap = await tmux(['capture-pane', '-p', '-t', name]);
    if (!cap.ok) return { ok: false, why: 'gone' };
    if (/bypass permissions on|\? for shortcuts/i.test(cap.out)) return { ok: true, why: 'no-dialog' };   // 已经到输入框了：这次没问
    const d = parseDialog(cap.out);
    if (!d) continue;
    const i = d.options.findIndex((o) => TRUST_OPT.test(o));
    if (i < 0) return { ok: false, why: 'other-dialog' };
    const r = await answerDialog(name, i, d.options[i]);
    console.log(`trust ${new Date().toISOString()} ${name} ${r.ok ? 'yes' : 'fail ' + r.error}`);
    return { ...r, why: 'answered' };
  }
  return { ok: false, why: 'timeout' };
}

const SAFE_ARG = /^[\w.\-:\[\]\/]{1,64}$/;
// 新任务不问「放哪个文件夹」（Khalil 11/12：「我也懒得去管……你就应该自己很聪明的去找应该在哪个项目文件夹，甚至新开一个文件夹」）。
// 会话一律开在主目录：共用的记忆和规矩只有在这里才读得到，它靠这些才找得对项目。再附下面这一段让它自己定文件夹；
// 包在 system-reminder 里，cleanPrompt 会把它滤掉，卡片上「你」那一行只显示他说的话。
const FOLDER_NOTE = '\n\n<system-reminder>这条任务是从总控台新建的，工作目录是主目录。用户没有指定文件夹，也不想被问放在哪里。请自己判断它属于哪个现有项目（先查记忆和 ~/Projects 下的文件夹），在那个项目的文件夹里做；是全新的东西就在 ~/Projects 下新建一个文件夹。不要把工程文件直接放在主目录。</system-reminder>';
const sameDir = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; } };
async function newSession(prompt, cwd, opt = {}) {
  let dir = String(cwd || '~').trim().replace(/^~(?=$|\/)/, HOME);
  if (!path.isAbsolute(dir)) dir = path.join(HOME, dir);
  try { if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch { return { ok: false, error: '没有这个文件夹：' + dir }; }
  if (opt.provider === 'codex' && !CONFIG.codex) return { ok: false, error: 'Codex 没有打开（config.json 的 codex）' };
  const provider = opt.provider === 'codex' ? 'codex' : 'claude';
  const model = String(opt.model || '').trim(), effort = String(opt.effort || '').trim();
  if ((model && !SAFE_ARG.test(model)) || (effort && !SAFE_ARG.test(effort))) return { ok: false, error: '模型或强度的写法不对' };
  const files = await cleanFiles(opt.files);
  let text = (prompt || '').trim();
  if (files.length) text = (text ? text + '\n\n' : '') + '附件（先看这些文件再开始）：\n' + files.join('\n');
  const shown = text;                                 // 卡片上显示的那一份，不带下面附的那段
  const pin = opt.project ? pinnable(opt.project.key, opt.project.name) : null;   // 在哪一列的列头开的；核不过就当右上角开的
  if (text && sameDir(dir, HOME)) text += pin ? pinNote(pin) : FOLDER_NOTE;   // 明确指定了别的文件夹（界面上已经没有这一格，接口还认）就不附
  const name = 'ccb-' + crypto.randomBytes(3).toString('hex');
  const args = ['new-session', '-d', '-s', name, '-x', '160', '-y', '48', '-c', dir];
  if (provider === 'codex') {
    if (!codexBin) return { ok: false, error: '这台机器上没找到 codex 命令' };
    args.push(codexBin); if (model) args.push('-m', model); if (effort) args.push('-c', 'model_reasoning_effort="' + effort + '"');
  } else {
    args.push(await findClaude()); if (model) args.push('--model', model); if (effort) args.push('--effort', effort);
  }
  if (text) args.push(text);
  const r = await tmux(args);
  if (!r.ok) return { ok: false, error: 'tmux：' + r.err };
  launches.set(name, { at: Date.now(), prompt: shown, cwd: dir, provider });
  if (pin) { pins[name] = { ...pin, at: Date.now() }; savePins(); }
  if (provider === 'codex') { agents[name] = { cwd: dir, at: Date.now(), prompt: shown, sid: null, rollout: null, model, effort }; saveAgents(); }
  else if (CONFIG.autoTrust && sameDir(dir, HOME)) autoTrust(name).catch(() => {});   // config 里打开、而且开在主目录才替他点；不等它，卡片先出来
  return { ok: true, name, project: pin };
}

// 新开的会话如果卡在「是否信任这个文件夹」，界面上给一个确认按钮
async function pendingLaunches() {
  // 待处理 = 我们这个 tmux 里有、但还没作为会话出现在墙上的（多半卡在开工前的选择框）
  const out = [];
  const onWall = new Set(allSessions.filter((x) => x.tmux).map((x) => x.tmux));
  for (const k of [...launches.keys()]) if (!panes.some((p) => p.name === k)) launches.delete(k);
  for (const pane of panes) {
    if (onWall.has(pane.name)) { launches.delete(pane.name); continue; }
    if (agents[pane.name] && !CONFIG.codex) continue;           // codex 没打开：以前起的 Codex 窗格不当成「启动中」
    const L = launches.get(pane.name) || { at: pane.created, prompt: '', cwd: pane.cwd };
    const cap = await tmux(['capture-pane', '-p', '-t', pane.name]);
    const screen = cap.ok ? cap.out : '';
    out.push({ name: pane.name, prompt: L.prompt, cwd: L.cwd, at: L.at, provider: L.provider || (agents[pane.name] ? 'codex' : 'claude'), dialog: parseDialog(screen),
      screen: Date.now() - L.at > 20000 ? screenLines(screen, 12) : '' });
  }
  return out;
}

// ───────────── 循环 ─────────────

let pending = [];
async function slowLoop() {
  try { await refreshTerms(); } catch {}
  try { await refreshPanes(); await resolvePanes(); pending = await pendingLaunches(); await refreshWaitScreens(); } catch {}
  setTimeout(slowLoop, 4000);
}
async function suggestLoop() {
  try { await refreshSuggest(); } catch {}
  setTimeout(suggestLoop, SUGGEST_MS);
}
function fastLoop() {
  try { scanSessions(); } catch (e) { console.error('scan', e); }
  setTimeout(fastLoop, 1200);
}

// ───────────── HTTP ─────────────

function reply(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(data);
}
function readBody(req, max = 400000) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return reply(res, 403, { error: 'bad host' });
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/health') return reply(res, 200, { ok: true, pid: process.pid, data: DATA, app: 'cc-board', sandbox: SANDBOX, readonly: READONLY });
    if (u.pathname === '/') {
      if (u.searchParams.get('k') !== TOKEN) return reply(res, 403, '用 ccboard 命令打开这个页面。', 'text/plain; charset=utf-8');
      const html = fs.readFileSync(path.join(DIR, 'ui.html'), 'utf8').replace('__TOKEN__', TOKEN);
      return reply(res, 200, html, 'text/html; charset=utf-8');
    }
    if (!u.pathname.startsWith('/api/')) return reply(res, 404, { error: 'not found' });
    if (req.headers['x-ccboard'] !== TOKEN) return reply(res, 403, { error: 'no token' });

    if (req.method === 'GET' && u.pathname === '/api/state') {
      if (u.searchParams.get('f') === '1') uiFocusAt = Date.now();                    // 你正看着总控台：停住了由界面提示，不另发系统通知
      const live = new Set(allSessions.filter((x) => x.tmux).map((x) => x.tmux));     // 已经上墙的就不再算「启动中」
      const lost = Object.values(archive.items).filter((x) => x.lost && x.state === 'archived')
        .map((x) => ({ sid: x.sid, provider: x.provider, title: x.title, cwd: x.cwd, prompt: x.prompt, lostAt: x.lostAt, project: x.project || classify(null, { title: x.title, prompt: x.prompt, cwd: x.cwd, home: HOME }) }));
      const out = { now: Date.now(), sessions: sessions.map(withSuggest), others: otherCount, ghostty: ghosttyOk, pending: pending.filter((x) => !live.has(x.name)).map((x) => ({ ...x, project: classify(null, { prompt: x.prompt, cwd: x.cwd, home: HOME, pin: pinOf(x.name) }) })), home: HOME, notices, providers: providers(),
        archived: Object.values(archive.items).filter((x) => x.state !== 'restoring').length, lost, stallMs: STALL_MS, sandbox: SANDBOX };
      notices = [];
      return reply(res, 200, out);
    }
    if (req.method === 'GET' && u.pathname === '/api/archive') {
      const items = Object.values(archive.items).sort((a, b) => b.archivedAt - a.archivedAt)
        .map((x) => ({ sid: x.sid, title: x.title, cwd: x.cwd, prompt: x.prompt, resultAt: x.resultAt, archivedAt: x.archivedAt, state: x.state, note: x.note || null, why: x.why || null }));
      const dropped = (archive.dropped || []).filter((x) => Date.now() - x.at < KEEP_DELETED_DAYS * 86400000);
      return reply(res, 200, { items, dropped, keepDays: KEEP_DELETED_DAYS });
    }
    if (req.method === 'GET' && u.pathname === '/api/turns') {
      const sid = u.searchParams.get('sid') || '';
      const tr = tracks.get(sid) || codexTracks.get(sid);
      const file = (tr && tr.file) || (archive.items[sid] && archive.items[sid].file);
      if (!file || !fs.existsSync(file) || (file.includes('/.codex/') && !CONFIG.codex)) return reply(res, 404, { error: '没有这段对话记录' });
      const n = Math.min(40, Number(u.searchParams.get('n')) || 12);
      return reply(res, 200, { turns: file.includes('/.codex/') ? readCodexTurns(file, n) : readTurns(file, n) });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'method' });
    if (READONLY) return reply(res, 403, { ok: false, error: '只读模式，不能改东西' });
    const body = await readBody(req, u.pathname === '/api/upload' ? 48 * 1024 * 1024 : 400000);
    if (u.pathname === '/api/ack') {                // 「知道了」：意外退出的那张卡收起来，对话留在归档里
      const it = archive.items[String(body.sid || '')];
      if (it && it.lost) { delete it.lost; saveArchive(); }
      return reply(res, 200, { ok: true });
    }
    if (u.pathname === '/api/send') {
      return reply(res, 200, await sendTo(String(body.sid || ''), String(body.text || '').trim(), body.files));
    }
    if (u.pathname === '/api/upload') {             // 粘贴 / 拖进来的文件：存到 uploads，回它的路径
      const m = String(body.data || '').match(/^(?:data:[^;,]*;base64,)?([A-Za-z0-9+/=\s]+)$/);
      if (!m) return reply(res, 200, { ok: false, error: '文件内容读不出来' });
      const buf = Buffer.from(m[1], 'base64');
      if (!buf.length || buf.length > 30 * 1024 * 1024) return reply(res, 200, { ok: false, error: '单个文件最大 30 MB' });
      const dest = uploadPath(body.name || 'file');
      fs.writeFileSync(dest, buf, { mode: 0o600 });
      return reply(res, 200, { ok: true, ...fileInfo((await normalizeFile(dest)) || dest) });
    }
    if (u.pathname === '/api/pick') {               // 弹系统的选文件框；选的是磁盘上已有的文件，不用再传一遍
      const r = await osa(PICK_FILES, [String(body.prompt || '选要发给它的文件')], 600000);
      if (!r.ok) return reply(res, 200, { ok: true, files: [] });            // 取消也走这里
      const out = [];
      for (const line of r.out.split('\n').map((x) => x.trim()).filter(Boolean)) { const n = await normalizeFile(line); if (n) out.push(fileInfo(n)); }
      return reply(res, 200, { ok: true, files: out });
    }
    if (u.pathname === '/api/focus') return reply(res, 200, await focusSession(String(body.sid || '')));
    if (u.pathname === '/api/archive') return reply(res, 200, archiveSession(String(body.sid || ''), body.force === true));
    if (u.pathname === '/api/unarchive') return reply(res, 200, await unarchive(String(body.sid || '')));
    if (u.pathname === '/api/delete') return reply(res, 200, await deleteSession(String(body.sid || '')));
    if (u.pathname === '/api/new') {
      const r = await newSession(String(body.prompt || ''), String(body.cwd || '~'), { provider: body.provider, model: body.model, effort: body.effort, files: body.files, project: body.project && typeof body.project === 'object' ? body.project : null });
      if (r.ok) { await refreshPanes(); }
      return reply(res, 200, r);
    }
    if (u.pathname === '/api/open') {               // 正文里的本机路径被点了（11/12 Khalil：「把资料直接把链接给我，我可以直接点进去」）
      const og = req.headers.origin; if (og && og !== 'http://127.0.0.1:' + PORT && og !== 'http://localhost:' + PORT) return reply(res, 403, { ok: false, error: '只接受总控台自己的页面' });
      let p = String(body.path || '').trim();
      if (/^file:\/\//i.test(p)) { try { p = decodeURIComponent(p.replace(/^file:\/\/(localhost)?/i, '')); } catch { return reply(res, 200, { ok: false, error: '路径的编码不对' }); } }
      p = p.replace(/^~(?=$|\/)/, HOME);
      if (!path.isAbsolute(p)) return reply(res, 200, { ok: false, error: '不是完整路径' });
      const action = openAction(p);
      if (!action) return reply(res, 200, { ok: false, error: '这个文件不在了：' + p });
      if (SANDBOX) { console.log(`open ${new Date().toISOString()} dry:${action} ${p}`); return reply(res, 200, { ok: true, action, dry: true }); }   // 试验场里只写日志，不真打开
      const r = await run('/usr/bin/open', action === 'open' ? [p] : ['-R', p]);
      return reply(res, 200, { ok: r.ok, action, error: r.err });
    }
    if (u.pathname === '/api/reveal') {             // 只在访达里选中，不直接打开（路径是模型写的，不能当命令跑）
      let p = String(body.path || '').trim().replace(/^~(?=$|\/)/, HOME);
      if (!path.isAbsolute(p)) return reply(res, 200, { ok: false, error: '不是完整路径' });
      if (!fs.existsSync(p)) return reply(res, 200, { ok: false, error: '这个文件不在了：' + p });
      const r = await run('/usr/bin/open', ['-R', p]);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    if (u.pathname === '/api/answer') {             // 用户在卡片上点了选择框里的某一项（只对总控台自己开的后台会话）
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name)) return reply(res, 400, { ok: false, error: '不是总控台开的会话' });
      return reply(res, 200, await answerDialog(name, Number(body.option), String(body.text || '')));
    }
    if (u.pathname === '/api/attach') {             // 把后台会话接到一个终端标签里看
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name)) return reply(res, 400, { ok: false, error: '不是总控台开的会话' });
      const r = await osa(OPEN_TMUX, [`${TMUX_BIN} -L ccboard attach -t ${name}`]);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    if (u.pathname === '/api/cancel') {             // 取消一个还没跑起来的新会话（只关自己开的）
      const name = String(body.name || '');
      if (!/^ccb-[\w-]+$/.test(name) || !pending.some((p) => p.name === name)) return reply(res, 404, { ok: false, error: '没有这个待处理的新任务' });
      const r = await tmux(['kill-session', '-t', name]);
      launches.delete(name);
      return reply(res, 200, { ok: r.ok, error: r.err });
    }
    return reply(res, 404, { error: 'not found' });
  } catch (e) {
    reply(res, 500, { error: String((e && e.message) || e) });
  }
});

server.on('error', (e) => { console.error('listen', e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc-board ${new Date().toISOString()} http://127.0.0.1:${PORT}/?k=${TOKEN} pid=${process.pid}`);
  for (const [sid, it] of Object.entries(archive.items)) if (it.state === 'archiving') scheduleStop(sid);   // 上次没来得及停的，接着办
  purgeDeleted(); purgeUploads(); setInterval(() => { purgeDeleted(); purgeUploads(); }, 12 * 3600 * 1000);
  if (CONFIG.codex) findCodex();
  fastLoop(); slowLoop(); suggestLoop();
});
