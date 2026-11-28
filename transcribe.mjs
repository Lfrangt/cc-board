// transcribe.mjs：手机录音转文字（2026-11-26 Khalil 要的：「录音按钮，我说话，你在 Mac 上把音频转成文本」）。
// 手机只录音、传上来；转写在这台 Mac 上本地做（vidscribe = Qwen3-ASR，不联网、不花钱、不弹手机输入法的窗）。
// 这里是纯规则 + 一个单线排队的转写器：读哪个文件、起哪个进程、往哪写，都由 server.mjs 交进来；不碰服务的状态。
// 11/27 FIX-1（1b 返修单，Opus 独立审查）：起进程显式给 PATH / 离线（voiceEnv）、热词不再写死私人词（config.json 的 voiceHotwords）、
// 手机断开就取消排队的、服务重启先清上次留下的进程和临时夹（sweepVoice）、大小上限和 90 秒超时对得上、选 bin / 超时抽成纯函数（voiceSetup）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const AUDIO_EXT = new Set(['.m4a', '.aac', '.caf', '.wav', '.mp3', '.mp4', '.webm', '.ogg', '.opus', '.flac']);
// 上限按「90 秒超时里一定转得完」定，不是按「文件放得下」定。手机录音是 AAC 32 kbps 单声道（iOS Model/Voice.swift），一分钟 240 KB，手机自己最长录 3 分钟（约 0.7 MB）。
// 数字的出处和实测见 notes/37「FIX-1」：真引擎 164 / 304 / 607 秒的录音用时 11.1 / 20.1 / 44.0 秒（11/27 实测），都远低于 90 秒，所以 1.8 MiB 不用放大也不用收紧。
export const PHONE_BYTES_PER_MIN = 32000 / 8 * 60;
export const MAX_AUDIO = Math.floor(1.8 * 1024 * 1024);                                 // 约 7.9 分钟（手机实际 4 KB/s）；已按真引擎 5 / 10 分钟的录音量过（见上），不是估的
export const MAX_MINUTES = Math.floor(MAX_AUDIO / PHONE_BYTES_PER_MIN);                  // 按手机的码率换算成「最多约几分钟」，给人看的
export const MAX_BODY = Math.ceil(MAX_AUDIO * 4 / 3) + 16 * 1024;                        // 请求体上限：解码后 MAX_AUDIO 对应的 base64 长度 + JSON 外壳（name、data: 头）的余量
export const MAX_TEXT = 6000;                          // 转出来的字最多留这么长：它要放进输入框当草稿
export const TOO_LONG = `录音太长了（最多约 ${MAX_MINUTES} 分钟），分段录`;
export const BUSY = '正在转写别的录音，过几秒再试';
// 热词：转写时告诉模型这些词会出现（它们是产品名，直接听常写成「Fred Flow」）。写词表，不写句子。
// 代码里只放公开的产品名；私人的词（学校、公司、自己的产品）放本机 config.json 的 voiceHotwords，追加在后面——私人的表从不进仓库（11/27 导出闸会拦）。
export const DEFAULT_HOTWORDS = ['Claude Code', 'cc-board', 'Codex', 'Fable', 'Opus', 'Sonnet', 'Tailscale', 'TestFlight', 'SwiftUI'];
export const HOTWORDS = DEFAULT_HOTWORDS.join(', ');
const HW_MAX_ITEMS = 50, HW_MAX_ITEM = 40, HW_MAX_TOTAL = 600;

// config.json 的 voiceHotwords：字符串数组，可选。写错整项不用（回 error 一句话，server 打启动日志，默认照跑），别的键不受影响（同 accountFallback / limitsPin）。
export function parseVoiceHotwords(v) {
  if (v === undefined || v === null) return { list: [] };
  const bad = (error) => ({ list: [], error });
  if (!Array.isArray(v)) return bad('要是字符串数组');
  if (v.length > HW_MAX_ITEMS) return bad(`最多 ${HW_MAX_ITEMS} 个词`);
  const list = [];
  for (const w of v) {
    if (typeof w !== 'string') return bad('每一项都要是字符串');
    const s = w.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (Array.from(s).length > HW_MAX_ITEM) return bad(`「${Array.from(s).slice(0, 10).join('')}…」超过 ${HW_MAX_ITEM} 个字`);
    if (/[,，、;；]/.test(s)) return bad('词里不要带逗号（转写按逗号分词）');
    list.push(s);
  }
  if (list.join(', ').length > HW_MAX_TOTAL) return bad(`加起来超过 ${HW_MAX_TOTAL} 个字`);
  return { list };
}
// 默认词 + 本机追加的，去重（不分大小写，先出现的留下），拼成 vidscribe -c 要的一串。
export function hotwordArg(extra = []) {
  const seen = new Set(), out = [];
  for (const w of [...DEFAULT_HOTWORDS, ...extra]) { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(w); } }
  return out.join(', ');
}

// 选哪个转写工具、超时多久（纯函数，server.mjs 交入参）。试验服务才认 CCBOARD_VIDSCRIBE / CCBOARD_VOICE_TIMEOUT_MS（测试里换假脚本、缩短超时）；
// 线上永远是 ~/.local/bin/vidscribe 和 90 秒：环境变量谁都能设，线上不该被它改道。
export function voiceSetup({ sandbox = false, env = {}, home = '' } = {}) {
  const bin = (sandbox && env.CCBOARD_VIDSCRIBE) || path.join(home, '.local/bin/vidscribe');
  const t = Number(sandbox && env.CCBOARD_VOICE_TIMEOUT_MS);
  return { bin, timeoutMs: Number.isFinite(t) && t > 0 ? t : 90000 };
}

// 起转写进程用的环境：服务从 Dock / 登录项 / 重启后起来时，app 用 `zsh -lc`，只读 ~/.zprofile，PATH 里没有 ~/.local/bin（mlx_audio 在那）也没有 /opt/homebrew/bin（ffmpeg 在那）：
// 每段录音都转失败。所以显式补上，不靠谁起的服务。HF_HUB_OFFLINE=1：模型已经在本机，不让 huggingface_hub 每次加载去问 huggingface.co（我们对他说的是「不联网」）。
export function voiceEnv(home, base = {}) {
  const want = [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const have = String(base.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
  return { ...base, PATH: [...new Set([...want, ...have])].join(':'), HF_HUB_OFFLINE: '1' };
}

// 手机传来的 { data: base64 或 data: 网址, name } → { ok, buf, ext } 或 { ok:false, error }。
// 扩展名只认音频的（上传接口不限类型，这个接口会把东西交给转写进程，认窄一点）。
export function parseAudio(body) {
  const b = body && typeof body === 'object' ? body : {};
  const raw = typeof b.data === 'string' ? b.data : '';
  const i = raw.startsWith('data:') ? raw.indexOf(',') : -1;
  const b64 = i >= 0 ? raw.slice(i + 1) : raw;
  if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { ok: false, error: '录音内容读不出来' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { ok: false, error: '录音是空的' };
  if (buf.length > MAX_AUDIO) return { ok: false, error: TOO_LONG };
  const name = typeof b.name === 'string' ? b.name : '';
  const ext = path.extname(name).toLowerCase();
  if (name && !AUDIO_EXT.has(ext)) return { ok: false, error: '这不是音频文件' };
  return { ok: true, buf, ext: ext || '.m4a' };
}

const LINE_SEP = new RegExp('[' + String.fromCodePoint(0x2028) + String.fromCodePoint(0x2029) + ']', 'g');
// 转写模型吐出来的字是不可信的：它要放进手机输入框，所以去掉控制字符、零宽字符、tag 字符（能藏指令的那一类），压空白，限长。
// 只当草稿给他看、他点发送才发；这里不判断内容。限长按「字」（码点）切，不按 UTF-16 单元切：单元切会把一个 emoji 的两半劈开，手机上显示成乱码。
export function cleanTextInfo(raw) {
  let s = String(raw || '').replace(/\r/g, '');
  s = s.replace(LINE_SEP, '\n');                                                          // U+2028 / U+2029 当换行，下面压空白时合并（正则用 String.fromCodePoint 造，源码里不放真字符：它在正则字面量里会被 JS 当换行，整份读不进来）
  s = s.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''));         // 控制字符 + 格式字符（零宽、方向控制 / 隔离、软连字符、BOM…）；换行和制表留给下面处理
  s = s.replace(/[\u{E0000}-\u{E007F}]/gu, '');
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const head = s.length > MAX_TEXT * 2 ? s.slice(0, MAX_TEXT * 2) : s;                  // 一个码点最多 2 个单元，前 2×MAX 个单元一定够 MAX 个码点；超长的不必整串转数组
  const cps = Array.from(head);
  if (cps.length <= MAX_TEXT && head === s) return { text: s, truncated: false };
  return { text: cps.slice(0, MAX_TEXT).join('').trimEnd(), truncated: true };
}
export const cleanText = (raw) => cleanTextInfo(raw).text;

// 引擎报错里「是这台 Mac 缺东西」的那一类（找不到 ffmpeg / mlx_audio / 模块），和「这段录音格式读不了」分开说：前者重录也没用，要有人去装。
export function missingTool(r) {
  if (!r || r.timedOut) return false;
  return r.code === 127 || /command not found|No module named|ModuleNotFoundError|sed: : No such file/i.test(String(r.err || ''));
}
// 日志里带的那一行引擎报错：先洗掉 ANSI 色码（mlx 的进度条带）和控制字符，最多 200 字。
const ANSI = new RegExp(String.fromCodePoint(0x1b) + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
export function lastErrLine(err) {
  const line = String(err || '').replace(ANSI, '').split('\n').map((x) => x.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).filter(Boolean).slice(-1)[0] || '';
  return Array.from(line).slice(0, 200).join('');
}

// 起一个子进程，超时（或调用方说取消）就把「整个进程组」杀掉，不只杀直接子进程。
// 为什么不用 execFile 的 timeout：它只给直接子进程发 SIGTERM。vidscribe 是个 bash 脚本，自己再起 ffmpeg 和 python（Qwen3-ASR，约 2 GB），
// 11/26 实测 `execFile('/bin/bash', ['-c', 'sleep 41 & wait'], { timeout: 500 })` 超时后 sleep 还在：模型进程成了孤儿，接着占内存，下一段转写再起一份就是两份。
// detached: true 让它自己当组长（pgid = pid），process.kill(-pid) 打整个组；先 SIGTERM，宽限 grace 毫秒后 SIGKILL。
// 带头的 TERM 一下就走了、孙进程忽略 TERM 又不攥着管道时，'close' 会在 grace 之前就来：finish 里对整组再补一枪 KILL，不让升级被「带头的走了」取消（FIX-1 审查）。
// 返回 { ok, out, err, timedOut, aborted, code }：out / err 各只留最后 cap 个字符（日志用，不让一个话痨的子进程撑爆内存）。
// signal：AbortSignal，手机断开时 server.mjs 用它取消（还没起的直接不起，在跑的杀整组）。env：给子进程的环境（不给就继承服务自己的）。
export function runGroup(cmd, args, { timeout = 90000, grace = 2000, cap = 65536, env, signal } = {}) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve({ ok: false, out: '', err: 'cancelled', timedOut: false, aborted: true, code: null }); return; }
    let child;
    try { child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }); }
    catch (e) { resolve({ ok: false, out: '', err: String((e && e.message) || e), timedOut: false, aborted: false, code: null }); return; }
    let out = '', err = '', timedOut = false, aborted = false, done = false, tGrace = null, tFinal = null;
    const keep = (s, c) => (s + c).slice(-cap);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out = keep(out, c); });
    child.stderr.on('data', (c) => { err = keep(err, c); });
    const hit = (sig) => { try { process.kill(-child.pid, sig); } catch { /* 组已经没了 */ } };
    const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; } };
    const onAbort = () => { if (done || aborted || timedOut) return; aborted = true; clearTimeout(tKill); stop(); };
    const finish = (ok, why, code) => {
      if (done) return; done = true;
      clearTimeout(tKill); clearTimeout(tGrace); clearTimeout(tFinal);
      if (signal) signal.removeEventListener('abort', onAbort);
      if ((timedOut || aborted) && groupAlive()) hit('SIGKILL');   // 组里还有人才补最后一枪；组已经空了就不发（FIX-2 c：别对一个可能已被别的进程复用的组号开枪）
      resolve({ ok: ok && !timedOut && !aborted, out: out.replace(/\n$/, ''), err: (err || why || '').trim(), timedOut, aborted, code: code === undefined ? null : code });
    };
    const stop = () => { hit('SIGTERM'); tGrace = setTimeout(() => { hit('SIGKILL'); tFinal = setTimeout(() => finish(false, 'killed'), 1000); }, grace); };   // 都杀了还有谁攥着管道不放，1 秒后也不等了
    const tKill = setTimeout(() => { timedOut = true; stop(); }, timeout);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => finish(false, String((e && e.message) || e)));
    child.on('close', (code) => finish(code === 0, code === null ? 'killed' : 'exit ' + code, code));
  });
}

// 单线排队：同一时刻只转一段（模型 2 GB 左右，别叠）；排队的最多 maxWait 段，再多直接回「忙」，不让手机干等。
// exec(cmd, args, { timeout, signal }) → { ok, out, err, timedOut, aborted, code }（server.mjs 交 runGroup 进来；超时与否由 exec 自己说，不靠「用时接近上限」去猜）；workDir 里每次建一个临时文件夹放转写结果，转完删。
// hotwords：一串字或返回一串字的函数（config.json 可能重读，每次转写时再取）。
// transcribe(file, { signal })：signal 一断（手机断开了）：还在排队的马上让出名额、轮到它时不起进程；已经在转的杀整组——结果没人收了，2 GB 的模型别白占着。
export function createTranscriber({ bin, exec, workDir, timeoutMs = 90000, maxWait = 2, hotwords = HOTWORDS, log = () => {} }) {
  let tail = Promise.resolve();
  let pending = 0;
  const cancelled = { ok: false, cancelled: true, error: '手机已断开，取消了这段转写' };
  async function one(file, signal) {
    const t0 = Date.now();
    if (signal && signal.aborted) { log('cancel queued'); return cancelled; }
    if (!fs.existsSync(bin)) return { ok: false, error: '这台 Mac 上没装转写工具（vidscribe）' };
    fs.mkdirSync(workDir, { recursive: true });
    const out = fs.mkdtempSync(path.join(workDir, 'v-'));
    try {
      const hw = typeof hotwords === 'function' ? hotwords() : hotwords;
      const r = await exec(bin, [file, '-a', '-f', 'txt', '-o', out, '-c', hw], { timeout: timeoutMs, signal });
      const ms = Date.now() - t0;
      if (r.aborted) { log(`cancel ${ms}ms running`); return cancelled; }
      if (!r.ok) {
        const timedOut = r.timedOut === true, miss = missingTool(r);
        log(`fail ${ms}ms ${timedOut ? 'timeout' : miss ? 'missing' : 'exit'} ${lastErrLine(r.err)}`.trimEnd());
        return { ok: false, error: timedOut ? '转写超时，录短一点再试' : miss ? '这台 Mac 上缺转写要的程序（找不到 ffmpeg 或 mlx_audio），不是这段录音的问题' : '这段录音转不出来（格式读不了？）' };
      }
      const txt = fs.readdirSync(out).filter((f) => f.endsWith('.txt')).sort()[0];
      const { text, truncated } = cleanTextInfo(txt ? fs.readFileSync(path.join(out, txt), 'utf8') : '');
      if (!text) { log(`empty ${ms}ms`); return { ok: false, error: '没听出说了什么（太安静？）' }; }
      log(`ok ${ms}ms chars=${Array.from(text).length}${truncated ? ' truncated' : ''}`);
      return { ok: true, text, ms, ...(truncated ? { truncated: true } : {}) };
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return {
    transcribe(file, { signal } = {}) {
      if (pending >= 1 + maxWait) return Promise.resolve({ ok: false, busy: true, error: BUSY });
      pending++;
      let started = false, released = false;
      const release = () => { if (!released) { released = true; pending--; } };
      if (signal) signal.addEventListener('abort', () => { if (!started) release(); }, { once: true });      // 排队时断开：马上让出名额，不等前面那段转完
      const p = tail.then(() => { started = true; return one(file, signal); }).catch((e) => ({ ok: false, error: '转写出错：' + String((e && e.message) || e).slice(0, 120) })).finally(release);
      tail = p;
      return p;
    },
    get pending() { return pending; },
    get full() { return pending >= 1 + maxWait; },
  };
}

// 服务启动时清上一次留下的（FIX-1 S1）：转写进程是 detached 的，服务被杀 / 崩溃 / 重启时，它们不会跟着走——模型那段 2 GB 成了孤儿，voice-tmp/v-* 也留着。
// 只认「自己起的」：命令行里同时有这台服务的转写工具路径（bin）和 `-o <本服务的 voice-tmp>/v-`（临时夹名字是 createTranscriber 自己造的）。别的服务的 voice-tmp 不同，用户手敲的 vidscribe 也不带这个 -o。
// ps 输出每行 `pid ppid pgid command`（/bin/ps -axww -o pid=,ppid=,pgid=,command=）；返回要杀的进程组。自己的进程组不动。
// 一个组算孤儿要同时满足（FIX-2 N1 / b）：这一行是组长（pid === pgid，只认自己起的那个 bash，不认组里别的恰好带同样命令行的）、而且它的父进程是 1（launchd 收养）——
// 活着的服务起的转写，组长的父进程是那个 node；只有服务死了，组长才被 launchd 收养。所以另一份服务（同端口 / 同数据目录，起不来要退出的）碰不到第一份正在转的那组。
export function findOrphans(psText, { bin, workDir, selfPid = process.pid }) {
  const mark = ` -o ${path.join(workDir, 'v-')}`;
  const rows = [];
  for (const line of String(psText || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), cmd: m[4] });
  }
  const selfPgid = (rows.find((x) => x.pid === selfPid) || {}).pgid;
  const groups = new Set();
  for (const x of rows) if (x.cmd.includes(bin) && x.cmd.includes(mark) && x.pid === x.pgid && x.ppid === 1 && x.pgid > 1 && x.pgid !== selfPgid && x.pid !== selfPid) groups.add(x.pgid);
  return [...groups];
}
export function sweepVoice({ bin, workDir, psText, kill = process.kill, rm = fs.rmSync, list = fs.readdirSync, selfPid = process.pid, log = () => {} }) {
  const killed = [];
  for (const g of findOrphans(psText, { bin, workDir, selfPid })) { try { kill(-g, 'SIGKILL'); killed.push(g); } catch { /* 已经没了 */ } }
  let removed = 0;
  let names = []; try { names = list(workDir); } catch { /* 没有这个夹 = 没东西可清 */ }
  for (const n of names) if (/^v-/.test(n)) { try { rm(path.join(workDir, n), { recursive: true, force: true }); removed++; } catch { /* 清不掉就留着，下次再清 */ } }
  if (killed.length || removed) log(`sweep killed ${killed.length} 组 removed ${removed} 个临时夹`);
  return { killed, removed };
}
