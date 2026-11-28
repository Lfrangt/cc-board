/**
 * [INPUT]: 依赖 ../transcribe.mjs（纯规则 + 单线排队的转写器 + 杀整组进程的 runGroup + 启动清场）、./fake-vidscribe.sh（假转写工具）和 ../server.mjs（或命令行给的另一份：红阶段把旧版 server.mjs 给进来，旁边放旧版 transcribe.mjs）；依赖 /bin/bash、/bin/ps。
 *          不碰真 vidscribe（模型 2 GB，机器忙时不该叠）：试验服务经 CCBOARD_VIDSCRIBE 换成假脚本。想用真引擎核一遍，加 --real <音频文件> <应有的文字>（见 [E]）。
 * [OUTPUT]: 逐项打印 ok / FAIL；退出码 0 = 全过。每份试验服务的 stdout 在 test/tmp/vox-*（带 --keep 才留）
 * [POS]: test/ 的「手机录音转文字」专测（11/26 起，11/27 FIX-1 返修）。作者：「手机上加一个录音按钮，我说话，你在 Claude Code 上把音频转成文本」，不用手机输入法（要弹窗、要充钱）。
 *        手机只录音、传上来（POST /api/transcribe，和 B6 上传同一条远程通道），转写在这台 Mac 上本地做，文字回给手机放进输入框当草稿，不自动发。
 *          [A] transcribe.mjs 的规则：parseAudio（data: 网址 / 裸 base64 / 坏字符 / 空 / 超上限 / 不是音频的扩展名）、cleanText（控制字符、零宽、方向控制和隔离、软连字符、tag 字符、压空白、限长且不劈开 emoji；正常中英混写一字不改）、
 *              runGroup（超时杀整组、带头的先走时补最后一枪 KILL、TERM 不管用时 KILL、cap 输出、env、取消）、单线排队（一次一段、排队最多 2 段、再多回忙；排队时断开让出名额）、
 *              voiceEnv / voiceSetup / parseVoiceHotwords / hotwordArg（纯函数）、findOrphans / sweepVoice（启动清场的判断）、失败分「缺程序」和「格式读不了」。
 *          [B] 本机 /api/transcribe 端到端（假 vidscribe）：已知答案、参数、落盘 0600、转不出来音频还在、注入字符被洗掉、日志里的引擎报错洗过且 ≤200 字、超过 6000 字不劈 emoji 并带 truncated、超时后进程都没了（按记下的进程号查）、并发只转一段；
 *              [B2] 服务只带 PATH=/usr/bin:/bin 起来也能转（必改 M1）；[B3] 热词：默认只有公开名、config.json 的 voiceHotwords 追加、写错只关这一项（必改 M2）；
 *              [B4] 服务被 SIGKILL 后重启：孤儿转写进程组和 voice-tmp/v-* 被清，别的服务的同名进程不动（S1）；[B5] 手机断开：排队的不起进程且让出名额、在转的整组杀掉（S2）；[B6] 忙时先回忙、不收正文不落盘（S3）；[B8] S3 的晚路径：几个请求同时通过了先查、收完正文才发现满了，仍回忙且音频落盘（1b 的改坏版 srv-busy-dropped 守这条）；[B7] 体上限和大小上限（S4）。
 *          [C] 手机远程端口：配对拿凭证 → 带凭证的 POST 通；不带凭证 / GET / 结尾斜杠 / 大小写不对一律拒；日志只记大小和扩展名；超上限的挡掉、别的接口的上限没放宽。
 *          [D] 没装 vidscribe（线上路径在假主目录里不存在）：回「没装转写工具」，音频仍落盘，不崩。
 *          [E] --real：真引擎端到端（可选，要 2 GB 内存）：服务只带最小 PATH 起来；HF_HUB_OFFLINE 用「数 HF_ENDPOINT 被连了几次」证明。
 * [PROTOCOL]: 改了 /api/transcribe 的接线（server.mjs 的 transcriber 实例 / 处理段 / readBody 上限 / 远程日志 / 启动清场）或 transcribe.mjs 要同步改这里；加断言前先在旧代码上跑出红。
 *             不可见字符一律用 String.fromCodePoint 造，不在源码里写字面的或 \u 转义的：工具链会把它们变成真字符，U+2028 落进正则字面量会让整份模块读不进来（11/26 transcribe.mjs 坏过一次，11/27 FIX-1 重写时又混进一次）。
 *             不按名字找进程、不按名字杀进程：假脚本把自己和孙进程的进程号写进 $T_OUT.pids，测试只查、只杀这些（杀之前还核一遍命令行）。
 */
// 用法：node test/transcribe.test.mjs [server.mjs 的路径] [--keep] [--real <音频> <文字>]
// 端口用 T_PORT 改（默认 3341）：第 k 份试验服务用 T_PORT + 20k，远程端口 +10，预览端口 +1000，--real 的计数监听 T_PORT + 900；最多 14 份（3341–3621、3351–3631、4341–4621、4241）。
// 别的测试的默认端口：state 4761 起、gemini 4881、gemini-balance 4931、tabclose 4991（不要和它们重叠；旧默认 4941 被 gemini-balance 的第二份服务占过）。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http'; import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import * as TM from '../transcribe.mjs';

const { parseAudio, cleanText, createTranscriber, runGroup, MAX_AUDIO, MAX_TEXT, HOTWORDS } = TM;
// 下面这些是 FIX-1 新增的：旧版模块里没有，用到时在 ok(() => …) 里抛错、记成一条红，不让整份测试在 import 时崩掉（红阶段要数得出来）
const { parseVoiceHotwords, hotwordArg, voiceEnv, voiceSetup, cleanTextInfo, lastErrLine, missingTool, findOrphans, sweepVoice, DEFAULT_HOTWORDS, MAX_BODY, MAX_MINUTES, TOO_LONG, BUSY } = TM;

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARGS = process.argv.slice(2);
const REAL_I = ARGS.indexOf('--real');
const POS = ARGS.filter((a, i) => !a.startsWith('--') && !(REAL_I >= 0 && i > REAL_I));
const SERVER = path.resolve(POS[0] || path.join(HERE, '../server.mjs'));
const KEEP = ARGS.includes('--keep');
const PORT = Number(process.env.T_PORT || 3341);
const NODE = process.execPath; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(HERE, 'tmp'), { recursive: true });
const ROOT = fs.mkdtempSync(path.join(HERE, 'tmp', 'vox-'));
const BIN = path.join(ROOT, 'bin'); fs.mkdirSync(BIN, { recursive: true });
fs.copyFileSync(path.join(HERE, 'fake-vidscribe.sh'), path.join(BIN, 'vidscribe')); fs.chmodSync(path.join(BIN, 'vidscribe'), 0o755);

let pass = 0, fail = 0;
// cond 可以是函数：抛错就记成红（旧版没有的函数、读不到的结构都会走到这里），extra 里带错误信息
const ok = (cond, name, extra = '') => {
  if (typeof cond === 'function') { try { cond = cond(); } catch (e) { extra = (extra ? extra + ' | ' : '') + '抛错：' + String((e && e.message) || e).slice(0, 160); cond = false; } }
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};
const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };
const b64 = (s) => Buffer.from(s).toString('base64');
const U = (...cps) => String.fromCodePoint(...cps);                       // 不可见字符只经这里造
// 进程只按「自己记下的进程号」查和杀（全局规矩 7 / 30）：假脚本和下面的测试都把进程号写进文件
const PIDS = (f) => (rd(f) || '').split('\n').map(Number).filter((n) => Number.isInteger(n) && n > 1);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const gone = async (pids, ms = 4000) => !!(await until(async () => pids.every((p) => !alive(p)), ms)) || pids.every((p) => !alive(p));
const cmdOf = (pid) => spawnSync('/bin/ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
// 收尾：记下的进程号里还活着的，命令行核过还是我们起的那几种（sleep / 假 vidscribe）才杀（进程号可能被别的进程复用，不凭号杀）
const reap = (pids) => { for (const p of pids) if (alive(p) && /\/bin\/sleep|vidscribe/.test(cmdOf(p))) { try { process.kill(p, 'SIGKILL'); } catch {} } };
const kids = [], servers = [], extraPidFiles = [], extraGroups = [];
let pfN = 0; const pidFile = () => { const f = path.join(ROOT, 'p' + (pfN++) + '.pids'); extraPidFiles.push(f); return f; };

// ═══ [A] transcribe.mjs 的规则（不起服务）═══
console.log('\n[A] transcribe.mjs：解析、清洗、杀整组、排队、纯函数');
{
  const good = parseAudio({ data: b64('hello-audio'), name: 'voice-1.m4a' });
  ok(good.ok && good.buf.toString() === 'hello-audio' && good.ext === '.m4a', 'parseAudio：裸 base64 + .m4a → 字节原样、扩展名 .m4a', JSON.stringify(good));
  const durl = parseAudio({ data: 'data:audio/mp4;base64,' + b64('xyz'), name: 'a.WAV' });
  ok(durl.ok && durl.buf.toString() === 'xyz' && durl.ext === '.wav', 'parseAudio：data: 网址 + 大写扩展名 → 认出，扩展名小写', JSON.stringify(durl));
  ok(parseAudio({ data: b64('x') }).ext === '.m4a', 'parseAudio：没给名字 → 默认 .m4a（iPhone 的 AAC）');
  for (const [why, body] of [['没有 data', {}], ['data 不是字符串', { data: 5 }], ['坏字符', { data: 'abc$%^' }], ['空串', { data: '' }], ['只有 data: 头', { data: 'data:audio/mp4;base64,' }], ['body 不是对象', null], ['body 是数组', ['x']]]) {
    const r = parseAudio(body); ok(r.ok === false && typeof r.error === 'string' && r.error.length > 0, 'parseAudio 拒：' + why, JSON.stringify(r).slice(0, 120));
  }
  for (const n of ['x.png', 'x.pdf', 'x.exe', 'x.sh', 'x.html', 'x.m4a.exe', 'x.']) { const r = parseAudio({ data: b64('x'), name: n }); ok(r.ok === false && /音频/.test(r.error), 'parseAudio 拒不是音频的扩展名：' + n, JSON.stringify(r)); }
  for (const n of ['a.m4a', 'a.aac', 'a.caf', 'a.wav', 'a.mp3', 'a.mp4', 'a.webm', 'a.ogg', 'a.opus', 'a.flac']) ok(parseAudio({ data: b64('x'), name: n }).ok, 'parseAudio 认：' + n);
  const big = parseAudio({ data: Buffer.alloc(MAX_AUDIO + 1, 65).toString('base64'), name: 'a.m4a' });
  ok(big.ok === false && /太长/.test(big.error) && big.error.includes(String(MAX_MINUTES)), 'parseAudio 拒：超过上限一个字节 → 「太长，最多约 N 分钟」（S4：按时长说，不说「太大」）', JSON.stringify(big).slice(0, 120));
  ok(parseAudio({ data: Buffer.alloc(MAX_AUDIO, 65).toString('base64'), name: 'a.m4a' }).ok, 'parseAudio 认：正好上限（上限那一字节不误拒）');
  ok(() => MAX_BODY >= Math.ceil(MAX_AUDIO * 4 / 3) && MAX_BODY <= Math.ceil(MAX_AUDIO * 4 / 3) + 64 * 1024, 'S4 体上限 = 上限音频的 base64 长度 + 外壳余量（不再是 48 MiB）', 'MAX_BODY=' + MAX_BODY + ' MAX_AUDIO=' + MAX_AUDIO);
  ok(() => MAX_AUDIO <= 8 * 1024 * 1024 && MAX_MINUTES >= 3, 'S4 上限按「90 秒转得完」定：不再是 25 MiB，且至少够手机自己最长的 3 分钟录音', 'MAX_AUDIO=' + MAX_AUDIO + ' 约 ' + MAX_MINUTES + ' 分钟');

  // cleanText：转写模型吐的字不可信。每一类不可见字符各一条，全部用 U() 造
  ok(cleanText('你好，我想给总控台加一个录音按钮。') === '你好，我想给总控台加一个录音按钮。', 'cleanText：正常中文一字不改');
  ok(cleanText('把 FretFlow 的 Claude Code 窗口发到 TestFlight') === '把 FretFlow 的 Claude Code 窗口发到 TestFlight', 'cleanText：中英混写、产品名一字不改');
  ok(cleanText('「还行」，价格：￥3.5（含税）！') === '「还行」，价格：￥3.5（含税）！', 'cleanText：全角标点、引号、括号一字不改');
  ok(cleanText('a' + U(0x01) + 'b' + U(0x00) + 'c' + U(0x7f) + 'd' + U(0x85) + 'e') === 'abcde', 'cleanText：控制字符去掉（含 NUL、DEL、NEL）');
  ok(cleanText('a' + U(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + 'b') === 'ab', 'cleanText：零宽字符去掉（含 BOM）');
  ok(cleanText('a' + U(0x202a, 0x202b, 0x202c, 0x202d, 0x202e) + 'b') === 'ab', 'cleanText：方向嵌入和覆盖（U+202A–202E，能让一行字倒着显示）去掉');
  ok(cleanText('a' + U(0x2066, 0x2067, 0x2068, 0x2069) + 'b') === 'ab', 'cleanText：方向隔离（U+2066–2069）去掉，11/26 第一版的正则漏了这一类', JSON.stringify(cleanText('a' + U(0x2066, 0x2069) + 'b')));
  ok(cleanText('a' + U(0xad) + 'b' + U(0x61c) + 'c' + U(0x200e, 0x200f) + 'd') === 'abcd', 'cleanText：软连字符、阿拉伯字母标记、LRM / RLM 去掉');
  ok(cleanText('a' + U(0xe0041, 0xe0042) + 'b' + U(0xe007f) + 'c') === 'abc', 'cleanText：tag 字符（U+E0000–E007F，能给模型藏指令）去掉');
  ok(cleanText('x' + U(0x2028) + 'y' + U(0x2029) + 'z') === 'x\ny\nz', 'cleanText：行 / 段分隔符当换行（不留字面的 U+2028 在输入框里）', JSON.stringify(cleanText('x' + U(0x2028) + 'y')));
  ok(cleanText('a  \t b\r\n\n\n\n c \n d') === 'a b\n\nc\nd', 'cleanText：压空白、最多留一个空行、去 \\r', JSON.stringify(cleanText('a  \t b\r\n\n\n\n c \n d')));
  ok(Array.from(cleanText('x'.repeat(MAX_TEXT + 500))).length === MAX_TEXT, 'cleanText：限长 6000 个字');
  ok(cleanText(null) === '' && cleanText(undefined) === '' && cleanText(42) === '42', 'cleanText：null / undefined 回空串，不抛');
  ok(cleanText('第一行\n第二行') === '第一行\n第二行', 'cleanText：换行保留（口述分段）');
  // 小修：按「字」切，不劈开一个 emoji 的两半（UTF-16 的 slice 会）；被切了要说
  const emo = U(0x1f600), cut = cleanTextInfo === undefined ? null : cleanTextInfo('x'.repeat(MAX_TEXT - 1) + emo + emo);
  ok(() => Buffer.from(cut.text, 'utf8').toString('utf8') === cut.text && Array.from(cut.text).length === MAX_TEXT && cut.text.endsWith(emo) && cut.truncated === true, 'cleanTextInfo：第 6000 个字是 emoji 时整个留下、不留半个（半个 emoji 在手机上是乱码），truncated=true', cut && JSON.stringify([Array.from(cut.text).length, cut.truncated]));
  ok(() => { const s = cleanTextInfo('x'.repeat(MAX_TEXT)); return s.truncated === false && Array.from(s.text).length === MAX_TEXT; }, 'cleanTextInfo：正好 6000 个字 → 不算被切（truncated=false）');
  ok(() => cleanTextInfo('你好').truncated === false && cleanTextInfo('').text === '', 'cleanTextInfo：普通文字 truncated=false，空串不抛');

  // 小修：日志里那一行引擎报错：洗掉色码和控制字符，最多 200 字；缺程序和格式读不了分开
  ok(() => lastErrLine('x\nboom ' + U(0x1b) + '[31mred' + U(0x1b) + '[0m' + U(0x07) + ' end\n') === 'boom red end', 'lastErrLine：色码、响铃洗掉，取最后一行非空的');
  ok(() => Array.from(lastErrLine('e'.repeat(600))).length === 200 && lastErrLine('') === '' && lastErrLine(null) === '', 'lastErrLine：最多 200 字，空 / null 不抛');
  ok(() => missingTool({ code: 127, err: '' }) && missingTool({ code: 1, err: 'sed: : No such file or directory' }) && missingTool({ code: 1, err: 'x: command not found' }) && missingTool({ code: 1, err: "ModuleNotFoundError: No module named 'mlx_audio'" }), 'missingTool：127、command not found、No module named、sed: : No such file 都算缺程序');
  ok(() => !missingTool({ code: 1, err: 'ffmpeg: Invalid data found' }) && !missingTool({ code: 127, timedOut: true, err: '' }) && !missingTool(null), 'missingTool：格式读不了、超时、null 不算缺程序');

  // 必改 M2：热词——代码里只有公开名；私人的词来自 config.json 的 voiceHotwords
  ok(() => Array.isArray(DEFAULT_HOTWORDS) && DEFAULT_HOTWORDS.includes('Claude Code') && DEFAULT_HOTWORDS.includes('cc-board') && !/FretFlow|Acme|Lakeview|Ridgeline/i.test(DEFAULT_HOTWORDS.join(',')) && !/FretFlow|Acme|Lakeview|Ridgeline/i.test(HOTWORDS), '热词：默认词表里没有私人词，只有公开的产品名', HOTWORDS);
  ok(() => hotwordArg() === HOTWORDS && hotwordArg([]) === HOTWORDS, '热词：不追加 → 就是默认表');
  ok(() => { const s = hotwordArg(['FretFlow', 'Acme']); return s === HOTWORDS + ', FretFlow, Acme'; }, '热词：config 的词追加在默认词后面', hotwordArg === undefined ? '' : hotwordArg(['FretFlow', 'Acme']));
  ok(() => hotwordArg(['claude code', 'FretFlow', 'fretflow']) === HOTWORDS + ', FretFlow', '热词：重复的（不分大小写）只留先出现的');
  for (const [why, v, expectErr] of [['没写', undefined, false], ['null', null, false], ['空数组', [], false]]) ok(() => { const r = parseVoiceHotwords(v); return r.list.length === 0 && (!!r.error) === expectErr; }, 'parseVoiceHotwords：' + why + ' → 空表、不报错');
  ok(() => { const r = parseVoiceHotwords(['  FretFlow ', 'Acme', '', '  ', 'Lake' + U(0x200b) + 'view']); return !r.error && r.list.join('|') === 'FretFlow|Acme|Lakeview'; }, 'parseVoiceHotwords：去首尾空白、丢空项、洗掉不可见字符', JSON.stringify(parseVoiceHotwords === undefined ? null : parseVoiceHotwords(['  FretFlow ', '', 'Lake' + U(0x200b) + 'view'])));
  for (const [why, v] of [['不是数组（字符串）', 'FretFlow'], ['不是数组（对象）', { a: 1 }], ['有非字符串的项', ['ok', 5]], ['有一项太长（41 个字）', ['x'.repeat(41)]], ['词里带逗号（会被转写当成两个词）', ['a,b']], ['太多项（51 个）', Array.from({ length: 51 }, (_, i) => 'w' + i)], ['加起来太长', Array.from({ length: 20 }, (_, i) => 'w'.repeat(30) + String(i).padStart(2, '0'))]]) {
    ok(() => { const r = parseVoiceHotwords(v); return typeof r.error === 'string' && r.error.length > 0 && r.list.length === 0; }, 'parseVoiceHotwords 写错整项不用：' + why + '（不是「用一半」）');
  }

  // 必改 M1 的纯函数部分：起转写进程的环境
  ok(() => { const e = voiceEnv('/Users/Shared/x', { PATH: '/usr/bin:/bin', FOO: 'bar' }); return e.PATH === '/Users/Shared/x/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' && e.HF_HUB_OFFLINE === '1' && e.FOO === 'bar'; }, 'voiceEnv：PATH 前面补 ~/.local/bin、/opt/homebrew/bin、/usr/local/bin，原来的跟在后面；HF_HUB_OFFLINE=1；别的变量原样', voiceEnv === undefined ? '' : JSON.stringify(voiceEnv('/Users/Shared/x', { PATH: '/usr/bin:/bin' })));
  ok(() => { const e = voiceEnv('/Users/Shared/x', { PATH: '/opt/homebrew/bin:/usr/bin::/usr/bin' }); return e.PATH === '/Users/Shared/x/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin'; }, 'voiceEnv：重复的、空的路径段去掉');
  ok(() => voiceEnv('/Users/Shared/x', {}).PATH.startsWith('/Users/Shared/x/.local/bin:/opt/homebrew/bin') && voiceEnv('/Users/Shared/x', {}).PATH.includes('/usr/bin'), 'voiceEnv：基础环境里没有 PATH 时也有一条能用的');

  // S5：选哪个转写工具、超时多久——线上不认环境变量
  ok(() => { const r = voiceSetup({ sandbox: true, env: { CCBOARD_VIDSCRIBE: '/t/fake', CCBOARD_VOICE_TIMEOUT_MS: '2500' }, home: '/h' }); return r.bin === '/t/fake' && r.timeoutMs === 2500; }, 'voiceSetup：试验服务认 CCBOARD_VIDSCRIBE 和 CCBOARD_VOICE_TIMEOUT_MS', voiceSetup === undefined ? '' : JSON.stringify(voiceSetup({ sandbox: true, env: { CCBOARD_VIDSCRIBE: '/t/fake', CCBOARD_VOICE_TIMEOUT_MS: '2500' }, home: '/h' })));
  ok(() => { const r = voiceSetup({ sandbox: false, env: { CCBOARD_VIDSCRIBE: '/t/fake', CCBOARD_VOICE_TIMEOUT_MS: '2500' }, home: '/h' }); return r.bin === '/h/.local/bin/vidscribe' && r.timeoutMs === 90000; }, 'voiceSetup：线上（非试验场）两个环境变量都不认 → ~/.local/bin/vidscribe 和 90 秒（谁都能设环境变量，线上不该被它改道）', voiceSetup === undefined ? '' : JSON.stringify(voiceSetup({ sandbox: false, env: { CCBOARD_VIDSCRIBE: '/t/fake', CCBOARD_VOICE_TIMEOUT_MS: '2500' }, home: '/h' })));
  ok(() => { const r = voiceSetup({ sandbox: true, env: {}, home: '/h' }); return r.bin === '/h/.local/bin/vidscribe' && r.timeoutMs === 90000; }, 'voiceSetup：试验服务没给环境变量 → 也是默认路径和 90 秒');
  for (const t of ['0', '-5', 'abc', '']) ok(() => voiceSetup({ sandbox: true, env: { CCBOARD_VOICE_TIMEOUT_MS: t }, home: '/h' }).timeoutMs === 90000, 'voiceSetup：超时写成 ' + JSON.stringify(t) + ' → 回 90 秒，不是 0 / 负数 / NaN');

  // runGroup：杀整组。造「bash 起了一个孙进程」的情形，和 vidscribe（bash → ffmpeg / python）同一个形状。孙进程的进程号写进文件，只查这些（M3）
  const g1 = await runGroup('/bin/bash', ['-c', 'echo out-1; echo err-1 >&2'], { timeout: 5000 });
  ok(g1.ok === true && g1.out === 'out-1' && g1.err === 'err-1' && g1.timedOut === false && g1.code === 0, 'runGroup：正常退出 → ok、stdout / stderr 分开拿到、timedOut false、code 0', JSON.stringify(g1));
  const g2 = await runGroup('/bin/bash', ['-c', 'echo boom >&2; exit 3'], { timeout: 5000 });
  ok(g2.ok === false && g2.timedOut === false && g2.err === 'boom' && g2.code === 3, 'runGroup：非零退出 → ok false、timedOut false（失败不冒充超时）、stderr 原样、code 3', JSON.stringify(g2));
  const pf3 = pidFile(), t3 = Date.now();
  const g3 = await runGroup('/bin/bash', ['-c', '/bin/sleep 41 & echo $! > "$0"; wait', pf3], { timeout: 600, grace: 800 });
  ok(g3.ok === false && g3.timedOut === true && Date.now() - t3 < 4000, 'runGroup：超时 → ok false、timedOut true、几秒内回来', JSON.stringify(g3) + ' ' + (Date.now() - t3) + 'ms');
  ok(PIDS(pf3).length === 1 && await gone(PIDS(pf3)), 'runGroup：超时后孙进程（bash 起的 sleep，按记下的进程号查）也没了——execFile 的 timeout 做不到这一点（11/26 实测会留孤儿）', 'pids=' + PIDS(pf3).join(',') + ' alive=' + PIDS(pf3).filter(alive).join(','));
  const pf4 = pidFile(), t4 = Date.now();
  const g4 = await runGroup('/bin/bash', ['-c', 'trap "" TERM; /bin/sleep 43 & echo $! > "$0"; wait', pf4], { timeout: 400, grace: 600 });
  ok(g4.timedOut === true && Date.now() - t4 >= 900 && Date.now() - t4 < 4000, 'runGroup：TERM 被忽略时等 grace 之后升级成 KILL（用时 ≥ 超时 + 宽限）', JSON.stringify(g4) + ' ' + (Date.now() - t4) + 'ms');
  ok(PIDS(pf4).length === 1 && await gone(PIDS(pf4)), 'runGroup：忽略 TERM 的孙进程也被 KILL 掉了', 'alive=' + PIDS(pf4).filter(alive).join(','));
  // 小修：带头的一个 TERM 就走了、孙进程忽略 TERM 又不攥着管道时，close 在宽限之前就来，原来的升级计时器被它取消 → 孙进程留着。现在 finish 里对整组补一枪 KILL
  const pf7 = pidFile();
  const g7 = await runGroup('/bin/bash', ['-c', '( trap "" TERM; exec /bin/sleep 47 ) >/dev/null 2>&1 & echo $! > "$0"; wait', pf7], { timeout: 400, grace: 5000 });
  ok(g7.timedOut === true && PIDS(pf7).length === 1, 'runGroup：带头的先走、孙进程忽略 TERM 且不占管道 → 仍判超时、记下了孙进程号', JSON.stringify(g7));
  ok(await gone(PIDS(pf7), 2500), 'runGroup：这种情形下孙进程也被最后补的 KILL 杀掉（不等宽限、不被 close 取消）', 'alive=' + PIDS(pf7).filter(alive).join(','));
  // FIX-2 c：组里已经没人了，就不补最后一枪（别对一个可能已被别的进程复用的组号开枪）。盯着 process.kill 的调用，数「负的组号 + SIGKILL」；正对照就是上面的 g7（组里还有人 → 补了、孙进程死了）
  {
    const calls = [], realKill = process.kill; process.kill = function (pid, sig) { calls.push([pid, sig]); return realKill.apply(process, arguments); };
    let gk; try { gk = await runGroup('/bin/bash', ['-c', '/bin/sleep 45'], { timeout: 300, grace: 3000 }); } finally { process.kill = realKill; }
    const groupCalls = calls.filter(([p]) => p < -1), kills = groupCalls.filter(([, s]) => s === 'SIGKILL');
    ok(gk.timedOut === true && groupCalls.some(([, s]) => s === 'SIGTERM') && kills.length === 0, 'runGroup（FIX-2 c）：TERM 一发整组就没了 → 不再补最后一枪 KILL（先 kill(-组号, 0) 探一下组还在不在；旧版不管组在不在都开一枪）', JSON.stringify(gk) + ' 对组的调用=' + JSON.stringify(groupCalls));
  }
  reap([...PIDS(pf3), ...PIDS(pf4), ...PIDS(pf7)]);                          // 断言失败时别留着：只杀上面记下的、命令行核过的
  const g5 = await runGroup('/nonexistent/vidscribe', ['x'], { timeout: 2000 });
  ok(g5.ok === false && g5.timedOut === false && /ENOENT/.test(g5.err), 'runGroup：命令不存在 → ok false、不抛、不当成超时', JSON.stringify(g5));
  const g6 = await runGroup('/bin/bash', ['-c', '/usr/bin/head -c 300000 /dev/zero | /usr/bin/tr "\\0" x'], { timeout: 10000, cap: 65536 });
  ok(g6.ok === true && g6.out.length === 65536, 'runGroup：输出只留最后 cap 个字符（话痨子进程撑不爆内存）', String(g6.out.length));
  // M1：env 真的交给子进程
  const ge = await runGroup('/bin/bash', ['-c', 'printf "%s|%s" "$VOX_T" "$PATH"'], { timeout: 5000, env: { VOX_T: 'v1', PATH: '/usr/bin:/bin' } });
  ok(ge.ok && ge.out === 'v1|/usr/bin:/bin', 'runGroup：env 选项交给子进程（M1 靠它把 PATH 带过去）', JSON.stringify(ge));
  // S2：取消
  const pf8 = pidFile(), ac8 = new AbortController();
  const p8 = runGroup('/bin/bash', ['-c', '/bin/sleep 44 & echo $! > "$0"; wait', pf8], { timeout: 30000, signal: ac8.signal });
  await until(() => PIDS(pf8).length > 0, 5000); const t8 = Date.now(); ac8.abort(); const g8 = await p8;
  ok(g8.aborted === true && g8.ok === false && g8.timedOut === false && Date.now() - t8 < 4000, 'runGroup：取消信号 → aborted true、不冒充超时、几秒内回来', JSON.stringify(g8) + ' ' + (Date.now() - t8) + 'ms');
  ok(PIDS(pf8).length === 1 && await gone(PIDS(pf8)), 'runGroup：取消后孙进程整组都没了（手机断开了，2 GB 的模型别白占着）', 'alive=' + PIDS(pf8).filter(alive).join(','));
  reap(PIDS(pf8));
  const pf9 = path.join(ROOT, 'never-started'), ac9 = new AbortController(); ac9.abort();
  const g9 = await runGroup('/bin/bash', ['-c', 'echo started > "$0"', pf9], { timeout: 5000, signal: ac9.signal });
  ok(g9.aborted === true && g9.ok === false && !fs.existsSync(pf9), 'runGroup：信号一开始就已取消 → 根本不起进程（排队的断开后轮到它时不占模型）', JSON.stringify(g9) + ' file=' + fs.existsSync(pf9));

  // 排队：假 exec 记并发数、可控时长
  const mk = (execImpl, extra = {}) => {
    const work = fs.mkdtempSync(path.join(ROOT, 'q-')); let running = 0, maxRun = 0, calls = 0; const seen = [];
    const exec = async (bin, args, o) => { calls++; seen.push(args[0]); running++; maxRun = Math.max(maxRun, running); try { return await execImpl(args, o, work); } finally { running--; } };
    const t = createTranscriber({ bin: process.execPath, exec, workDir: path.join(work, 'w'), ...extra });
    return { t, work, stat: () => ({ maxRun, calls, running, seen }) };
  };
  const writeTxt = (args, text) => { const out = args[args.indexOf('-o') + 1]; fs.writeFileSync(path.join(out, 'x.txt'), text); return { ok: true, out: '', err: '' }; };
  const Q1 = mk(async (args) => { await sleep(150); return writeTxt(args, '好'); });
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => Q1.t.transcribe('/tmp/x.m4a')));
  ok(Q1.stat().maxRun === 1, '排队：5 个并发请求，同一时刻最多 1 个在转', JSON.stringify(Q1.stat()));
  ok(rs.filter((r) => r.ok).length === 3 && rs.filter((r) => r.busy).length === 2, '排队：1 个在转 + 2 个等，其余 2 个回「忙」（不让手机干等）', JSON.stringify(rs.map((r) => r.ok ? 'ok' : r.busy ? 'busy' : r.error)));
  ok(rs.filter((r) => r.busy).every((r) => r.ok === false && /别的录音/.test(r.error)), '排队：忙的那句是人话', JSON.stringify(rs.find((r) => r.busy)));
  const after = await Q1.t.transcribe('/tmp/x.m4a');
  ok(after.ok && Q1.t.pending === 0, '排队：忙过之后再来能转（pending 回 0，没卡死）', JSON.stringify(after));
  ok(!fs.existsSync(path.join(Q1.work, 'w')) || fs.readdirSync(path.join(Q1.work, 'w')).length === 0, '临时目录：每次转完都删，w/ 里不留 v-*', JSON.stringify(fs.existsSync(path.join(Q1.work, 'w')) && fs.readdirSync(path.join(Q1.work, 'w'))));

  const Q2 = mk(async (args, o) => { const r = args; ok(r[0] === '/tmp/y.m4a' && r.slice(1, 4).join(' ') === '-a -f txt' && r[r.indexOf('-c') + 1] === HOTWORDS && o.timeout === 90000, '参数：文件在最前、-a -f txt、-c 热词、超时 90 秒', JSON.stringify([r, o])); return writeTxt(args, '好'); });
  await Q2.t.transcribe('/tmp/y.m4a');
  const Q2b = mk(async (args) => { ok(args[args.indexOf('-c') + 1] === 'AA, BB', '热词可以是函数：每次转写时现取（config 重读后用新的）', JSON.stringify(args)); return writeTxt(args, '好'); }, { hotwords: () => 'AA, BB' });
  await Q2b.t.transcribe('/tmp/y.m4a');

  const logs = [];
  const Q3 = mk(async () => ({ ok: false, out: '', err: 'boom', timedOut: false, code: 1 }), { log: (m) => logs.push(m) });
  const f3 = await Q3.t.transcribe('/tmp/z.m4a');
  ok(f3.ok === false && /转不出来/.test(f3.error) && !f3.busy, '失败：exec 失败 → 「这段录音转不出来」', JSON.stringify(f3));
  ok(() => /^fail \d+ms exit boom$/.test(logs[0]), '失败的日志行：fail <毫秒> exit <引擎最后一行报错>', JSON.stringify(logs));
  const logsM = [];
  const Q3m = mk(async () => ({ ok: false, out: '', err: 'sed: : No such file or directory', timedOut: false, code: 1 }), { log: (m) => logsM.push(m) });
  const f3m = await Q3m.t.transcribe('/tmp/z.m4a');
  ok(() => f3m.ok === false && /缺/.test(f3m.error) && /ffmpeg|mlx_audio/.test(f3m.error) && !/格式/.test(f3m.error) && /missing/.test(logsM[0]), 'M1：缺程序 → 单独一句「这台 Mac 上缺转写要的程序…不是这段录音的问题」（重录没用，要有人去装），日志里标 missing', JSON.stringify([f3m, logsM]));
  const Q3a = mk(async () => ({ ok: false, out: '', err: 'x\nboom ' + U(0x1b) + '[31mred' + U(0x1b) + '[0m' + U(0x07) + ' end\n', timedOut: false, code: 1 }), { log: (m) => logsM.push(m) });
  await Q3a.t.transcribe('/tmp/z.m4a');
  ok(() => /^fail \d+ms exit boom red end$/.test(logsM[1]) && ![...logsM[1]].some((c) => c.charCodeAt(0) < 32), '失败的日志行：色码和响铃洗掉', JSON.stringify(logsM[1]));
  const Q4 = mk(async (args) => writeTxt(args, ' \n  '));
  const f4 = await Q4.t.transcribe('/tmp/z.m4a');
  ok(f4.ok === false && /没听出/.test(f4.error), '空结果：只有空白 → 「没听出说了什么」', JSON.stringify(f4));
  const Q5 = mk(async () => { await sleep(100); return { ok: false, out: '', err: 'killed', timedOut: true }; }, { timeoutMs: 700 });
  const f5 = await Q5.t.transcribe('/tmp/z.m4a');
  ok(f5.ok === false && /超时/.test(f5.error), '超时：exec 说 timedOut → 「转写超时，录短一点再试」（不看用时，用时只有 100 ms）', JSON.stringify(f5));
  const Q5b = mk(async () => { await sleep(700); return { ok: false, out: '', err: 'ffmpeg: Invalid data', timedOut: false }; }, { timeoutMs: 700 });
  const f5b = await Q5b.t.transcribe('/tmp/z.m4a');
  ok(f5b.ok === false && /转不出来/.test(f5b.error) && !/超时/.test(f5b.error), '失败不冒充超时：恰好在上限那一刻失败、exec 没说超时 → 仍是「转不出来」（11/26 第一版靠「用时 ≥ 上限 − 0.5 秒」猜，会猜错）', JSON.stringify(f5b));
  const Q6 = mk(async () => { throw new Error('exec 自己炸了'); });
  const f6 = await Q6.t.transcribe('/tmp/z.m4a'); const f6b = await Q6.t.transcribe('/tmp/z.m4a');
  ok(f6.ok === false && /转写出错/.test(f6.error) && f6b.ok === false && Q6.t.pending === 0, 'exec 抛错：回人话、队列不卡（再来一次照样回、pending 回 0）', JSON.stringify([f6, f6b, Q6.t.pending]));
  const Q7 = createTranscriber({ bin: path.join(ROOT, 'nope-vidscribe'), exec: async () => ({ ok: true, out: '' }), workDir: path.join(ROOT, 'w7') });
  const f7 = await Q7.transcribe('/tmp/z.m4a');
  ok(f7.ok === false && /没装/.test(f7.error), '没装 vidscribe：回「没装转写工具」', JSON.stringify(f7));
  const Q8 = mk(async (args) => writeTxt(args, 'x'.repeat(MAX_TEXT - 1) + U(0x1f600, 0x1f600)));
  const f8 = await Q8.t.transcribe('/tmp/z.m4a');
  ok(() => f8.ok === true && f8.truncated === true && Array.from(f8.text).length === MAX_TEXT && Buffer.from(f8.text, 'utf8').toString('utf8') === f8.text, '转写结果超过 6000 字：不劈 emoji，结果带 truncated:true', JSON.stringify([f8.ok, f8.truncated, Array.from(f8.text || '').length]));
  const f8b = await mk(async (args) => writeTxt(args, '短')).t.transcribe('/tmp/z.m4a');
  ok(f8b.ok === true && f8b.truncated === undefined, '没超长：结果里没有 truncated 这个键', JSON.stringify(f8b));

  // S2：取消（排队时断开 / 在转时断开 / 一开始就已断开）
  const Q9 = mk(async (args, o) => {
    if (args[0] === '/tmp/first.m4a') { await sleep(400); return writeTxt(args, '一'); }
    return writeTxt(args, '别的');
  });
  const ac9a = new AbortController(), ac9b = new AbortController();
  const r9a = Q9.t.transcribe('/tmp/first.m4a'), r9b = Q9.t.transcribe('/tmp/second.m4a', { signal: ac9a.signal }), r9c = Q9.t.transcribe('/tmp/third.m4a', { signal: ac9b.signal });
  ok(Q9.t.pending === 3, 'S2：1 个在转 + 2 个排着 → pending 3');
  ac9a.abort(); ac9b.abort();
  ok(() => Q9.t.pending === 1, 'S2：排队的两个断开 → 马上让出名额（pending 回 1，不等前面那段转完）', 'pending=' + Q9.t.pending);
  const nw = await Promise.all([r9a, r9b, r9c]);
  ok(() => nw[0].ok === true && nw[1].cancelled === true && nw[2].cancelled === true && nw[1].ok === false, 'S2：被取消的回 {cancelled:true, ok:false}，在转的那个不受影响', JSON.stringify(nw.map((x) => x.ok ? 'ok' : x.cancelled ? 'cancelled' : x.error)));
  ok(() => JSON.stringify(Q9.stat().seen) === JSON.stringify(['/tmp/first.m4a']) && Q9.t.pending === 0, 'S2：排队时断开的两个，exec 一次都没被调（不起进程、不占模型）', JSON.stringify(Q9.stat().seen));
  const Q10 = mk(async (args, o) => new Promise((res) => o.signal.addEventListener('abort', () => res({ ok: false, out: '', err: 'cancelled', timedOut: false, aborted: true }), { once: true })));
  const ac10 = new AbortController(); const r10 = Q10.t.transcribe('/tmp/run.m4a', { signal: ac10.signal });
  await sleep(100); ac10.abort(); const f10 = await r10;
  ok(() => f10.cancelled === true && f10.ok === false && Q10.t.pending === 0, 'S2：在转时断开 → exec 收到信号、回 cancelled、pending 回 0', JSON.stringify([f10, Q10.t.pending]));
  const Q11 = mk(async (args) => writeTxt(args, 'x')); const ac11 = new AbortController(); ac11.abort();
  const f11 = await Q11.t.transcribe('/tmp/pre.m4a', { signal: ac11.signal });
  ok(() => f11.cancelled === true && Q11.stat().calls === 0 && Q11.t.pending === 0, 'S2：一开始就已断开 → 不调 exec', JSON.stringify([f11, Q11.stat()]));
  ok(() => Q1.t.full === false, 'full：空闲时 false');

  // S1 判断部分：谁算「这台服务留下的转写进程」
  const WD = '/x/voice-tmp', BINP = '/h/.local/bin/vidscribe';
  // 每行 pid ppid pgid command（FIX-2：多了 ppid；只有「组长 + 父进程是 1」才算孤儿）
  const PS = [
    '    1     0     1 /sbin/launchd',
    '  200     1   200 node /x/server.mjs',
    `  301     1   301 /bin/bash ${BINP} /x/uploads/a.m4a -a -f txt -o ${WD}/v-abc -c Claude Code`,
    '  302   301   301 /opt/homebrew/bin/ffmpeg -i /x/uploads/a.m4a -ar 16000 /tmp/z.wav',
    '  303   301   301 python3 -m mlx_audio.stt.generate --model q',
    `  304   301   301 /bin/bash ${BINP} /x/uploads/a.m4a -a -f txt -o ${WD}/v-abc -c Claude Code`,
    `  401     1   401 /bin/bash ${BINP} /y/b.m4a -a -f txt -o /other/voice-tmp/v-zzz`,
    `  501     1   501 vim ${BINP}`,
    `  601     1   601 rsync -o ${WD}/v-q src dst`,
    `  701   200   200 /bin/bash ${BINP} /x/uploads/c.m4a -a -f txt -o ${WD}/v-self`,
    `  801     1   801 /bin/bash ${BINP} /x/uploads/d.m4a -a -f txt -o ${WD}/v-def`,
    `  901   777   901 /bin/bash ${BINP} /x/uploads/e.m4a -a -f txt -o ${WD}/v-live`,
    `  902     1   555 /bin/bash ${BINP} /x/uploads/f.m4a -a -f txt -o ${WD}/v-notleader`,
    'garbage line without numbers',
  ].join('\n');
  ok(() => JSON.stringify(findOrphans(PS, { bin: BINP, workDir: WD, selfPid: 200 }).sort()) === '[301,801]', 'findOrphans：只认命令行里同时有「这台的转写工具路径」和「-o 本服务的 voice-tmp/v-」的；同组去重；别的服务的、只有一半匹配的、自己这个进程组的、乱行都不算；FIX-2：父进程还是活进程的组（901，父 777：活着的服务正在转的）、匹配到的行不是组长的（902，pgid 555 ≠ pid）也不算', findOrphans === undefined ? '' : JSON.stringify(findOrphans(PS, { bin: BINP, workDir: WD, selfPid: 200 })));
  ok(() => findOrphans('', { bin: BINP, workDir: WD }).length === 0 && findOrphans(null, { bin: BINP, workDir: WD }).length === 0, 'findOrphans：空的进程表不抛、没有要杀的');
  const killed = [], removed = [], sl = [];
  const sw = sweepVoice === undefined ? null : sweepVoice({ bin: BINP, workDir: WD, psText: PS, selfPid: 200, kill: (p, s) => { killed.push([p, s]); if (p === -801) throw Object.assign(new Error('x'), { code: 'ESRCH' }); }, rm: (p) => removed.push(p), list: () => ['v-1', 'v-2', 'keep.txt', 'v'], log: (m) => sl.push(m) });
  ok(() => JSON.stringify(killed) === '[[-301,"SIGKILL"],[-801,"SIGKILL"]]' && JSON.stringify(removed) === JSON.stringify([WD + '/v-1', WD + '/v-2']) && sw.killed.length === 1 && sw.removed === 2, 'sweepVoice：对每个孤儿进程组发 SIGKILL（负的进程组号）、只删 v-* 开头的临时夹（keep.txt、v 不动）；某组已经没了（ESRCH）不抛、不算杀到', JSON.stringify([killed, removed, sw]));
  ok(() => sl.length === 1 && /killed 1/.test(sl[0]) && /removed 2/.test(sl[0]), 'sweepVoice：杀了或清了东西才打一行日志', JSON.stringify(sl));
  const sw0 = sweepVoice === undefined ? null : sweepVoice({ bin: BINP, workDir: '/nonexistent-dir-x', psText: '', list: () => { throw new Error('ENOENT'); }, log: (m) => sl.push(m) });
  ok(() => sw0.killed.length === 0 && sw0.removed === 0 && sl.length === 1, 'sweepVoice：没有 voice-tmp 夹、没有进程 → 什么都不做、不抛、不打日志');
}

// ═══ 起试验服务 ═══
const TS = 'mini.tail1a2b.ts.net', LG = 'khalil@example.com', ORI = 'https://' + TS;
const rq = (port, method, p, headers = {}, body) => new Promise((resolve) => {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (rs) => {
    let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} resolve({ code: rs.statusCode, body: j, raw: t }); });
  });
  r.on('error', (e) => resolve({ code: 0, body: { error: String(e) }, raw: '' })); r.setTimeout(60000, () => r.destroy(new Error('timeout')));
  if (data) r.end(data); else r.end();
});
async function startServer(tag, { cfg = {}, env = {} } = {}) {
  const idx = servers.length, port = PORT + 20 * idx, dir = path.join(ROOT, tag);
  const FH = path.join(dir, 'home'), DATA = path.join(FH, 'Library/Application Support/cc-board');
  for (const d of [DATA, path.join(FH, '.claude/sessions'), path.join(FH, '.claude/projects'), path.join(FH, 'work')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cfg));
  const out = path.join(dir, 'out'), logFile = path.join(dir, 'server-' + idx + '.log'), tm = fs.mkdtempSync('/tmp/ccb-vox-tmux-');
  const E = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCBOARD_|ANTHROPIC_|GEMINI_|TMUX)/.test(k))),
    HOME: FH, CCBOARD_PORT: String(port), CCBOARD_PREVIEW_PORT: String(port + 1000), CCBOARD_REMOTE_PORT: String(port + 10), CCBOARD_DATA: DATA, CCBOARD_TMUX_SOCKET: path.join(tm, 'ccboard.sock'), TMUX_TMPDIR: tm,
    PATH: BIN + ':/usr/bin:/bin:/usr/sbin:/sbin', T_OUT: out, CCBOARD_CLAUDE_TMP: path.join(dir, 'claude-tmp'), ...env };
  const fd = fs.openSync(logFile, 'a');
  const proc = spawn(NODE, [SERVER], { env: E, stdio: ['ignore', fd, fd] }); kids.push(proc.pid);
  const S = { tag, port, rport: port + 10, FH, DATA, dir, out, tm, proc, env: E, tok: '', log: () => rd(logFile) || '', uploads: () => { const u = path.join(DATA, 'uploads'); const r = []; try { for (const d of fs.readdirSync(u)) for (const f of fs.readdirSync(path.join(u, d))) r.push(path.join(u, d, f)); } catch {} return r; } };
  servers.push(S);
  const up = await until(async () => { try { S.tok = (rd(path.join(DATA, '.token')) || '').trim(); const h = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); return !!(h.ok && S.tok); } catch { return false; } }, 20000);
  if (!up) { console.error('ABORT：' + tag + ' 起不来\n' + S.log().slice(-1500)); await cleanup(); process.exit(2); }
  S.post = (p, body) => rq(port, 'POST', p, { 'x-ccboard': S.tok, origin: 'http://127.0.0.1:' + port }, body);
  S.get = (p) => rq(port, 'GET', p, { 'x-ccboard': S.tok });
  S.vox = (mark, name = 'voice.m4a', pad = '') => S.post('/api/transcribe', { name, data: b64(mark.padEnd(8, '_') + pad) });
  // 可以半路断开的请求：返回 { done, abort }（abort = 把这条连接直接掐掉，模拟手机锁屏 / 网断）
  S.voxAbortable = (mark, tag = '', name = 'voice.m4a') => { const body = Buffer.from(JSON.stringify({ name, data: b64(mark.padEnd(8, '_') + tag) })); let req; const done = new Promise((resolve) => { req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/transcribe', headers: { 'x-ccboard': S.tok, origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'content-length': body.length } }, (rs) => { let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} resolve({ code: rs.statusCode, body: j }); }); }); req.on('error', () => resolve({ code: 0, body: {} })); req.end(body); }); return { done, abort: () => req.destroy() }; };
  S.clear = () => { for (const f of fs.readdirSync(dir)) if (f.startsWith('out.')) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); };
  S.calls = () => (rd(out + '.calls') || '').split('\n').filter(Boolean);
  S.callTags = () => S.calls().map((l) => (rd(l.slice(l.indexOf(' ') + 1)) || '').slice(8));      // 每次调用对应的录音「标签」（落盘名固定叫 voice，不带手机给的名字；靠内容里记号后面的几个字认是哪个请求）
  S.uploadTags = () => S.uploads().map((f) => (rd(f) || '').slice(8));
  S.voiceTmp = () => { try { return fs.readdirSync(path.join(DATA, 'voice-tmp')); } catch { return []; } };
  S.pids = () => PIDS(out + '.pids');
  return S;
}
async function cleanup() {
  for (const pid of kids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await sleep(300);
  for (const S of servers) reap(S.pids ? S.pids() : []);
  reap(extraPidFiles.flatMap((f) => PIDS(f)));
  for (const g of extraGroups) { try { process.kill(-g, 'SIGKILL'); } catch {} }                 // 自己 detached 起的旁观进程：它的进程号是自己 spawn 记下的
  for (const S of servers) { const s = path.join(S.tm, 'ccboard.sock'); if (s.startsWith('/tmp/ccb-vox-tmux-') && fs.existsSync(s)) spawnSync(['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((x) => fs.existsSync(x)) || 'tmux', ['-S', s, 'kill-server'], { stdio: 'ignore' }); }
  if (!KEEP) { fs.rmSync(ROOT, { recursive: true, force: true }); for (const S of servers) fs.rmSync(S.tm, { recursive: true, force: true }); }
}
for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) process.on(sig, async () => { await cleanup(); process.exit(code); });
const argvOf = (S) => (rd(S.out + '.argv') || '').split('\0').slice(0, -1);
const hwOf = (S) => { const a = argvOf(S); return a[a.indexOf('-c') + 1]; };
const serverSrc = rd(SERVER) || '';

console.log('\nserver:', SERVER, ' load:', os.loadavg().map((x) => x.toFixed(1)).join(' '));
try {
  // ═══ [B] 本机端到端 ═══
  console.log('\n[B] 本机 /api/transcribe（假 vidscribe）');
  const A = await startServer('a', { cfg: { remote: { on: true, hosts: [TS] } }, env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '2500' } });
  let r = await A.vox('ZH1');
  ok(r.code === 200 && r.body.ok === true && r.body.text === '你好，我想给总控台加一个录音按钮。', '已知答案（中文）：音频记号 ZH1 → 假引擎的固定文字，原样回给手机', JSON.stringify(r.body).slice(0, 200));
  ok(typeof r.body.ms === 'number' && r.body.ms >= 0 && typeof r.body.path === 'string' && r.body.path.includes('/uploads/') && /-voice\.m4a$/.test(r.body.path), '应答带 ms 和落盘路径（uploads 下、文件名是 …-voice.m4a）', JSON.stringify(r.body));
  ok(r.body.truncated === undefined, '没超长的应答里没有 truncated', JSON.stringify(r.body).slice(0, 200));
  const saved = r.body.path && fs.existsSync(r.body.path) ? fs.readFileSync(r.body.path, 'utf8') : null;
  ok(saved === 'ZH1_____', '音频字节原样落在 uploads（转完不删：转不出来时能重试、也能拿去听）', JSON.stringify(saved));
  ok(r.body.path && (fs.statSync(r.body.path).mode & 0o777) === 0o600, '落盘权限 0600（别的用户读不到录音）', r.body.path && (fs.statSync(r.body.path).mode & 0o777).toString(8));
  const argv = argvOf(A);
  ok(argv[0] === r.body.path && argv.slice(1, 4).join(' ') === '-a -f txt' && argv[argv.indexOf('-c') + 1] === HOTWORDS, '假引擎真收到的参数：文件在最前、-a -f txt、-c 热词（读假脚本写的文件，不读服务自己的说法）', JSON.stringify(argv));
  ok(argv.indexOf('-o') > 0 && argv[argv.indexOf('-o') + 1].includes('voice-tmp'), '输出文件夹在数据目录的 voice-tmp 下', JSON.stringify(argv));
  ok(A.voiceTmp().length === 0, '转完 voice-tmp 里不留临时文件夹', JSON.stringify(A.voiceTmp()));
  r = await A.vox('MIX');
  ok(r.body.ok && r.body.text === '把 FretFlow 的 Claude Code 窗口发到 TestFlight', '已知答案（中英混写）：产品名原样', JSON.stringify(r.body).slice(0, 200));
  r = await A.vox('INJ');
  ok(r.body.ok && r.body.text === 'abcde f\n\ng', '注入字符：控制字符、零宽、方向控制、tag 字符洗掉，两个空格压成一个、四个换行压成一个空行', JSON.stringify(r.body.text));
  r = await A.vox('INJ2');
  ok(r.body.ok && r.body.text === 'abcde', '注入字符（第二类）：方向隔离、软连字符、阿拉伯字母标记洗掉', JSON.stringify(r.body.text));
  const before = A.uploads().length;
  r = await A.vox('EMPTY');
  ok(r.code === 200 && r.body.ok === false && /没听出/.test(r.body.error) && A.uploads().length === before + 1, '空结果：回「没听出说了什么」，音频仍在 uploads', JSON.stringify(r.body).slice(0, 200));
  r = await A.vox('FAIL');
  ok(r.code === 200 && r.body.ok === false && /转不出来/.test(r.body.error) && !/ffmpeg|Invalid data/.test(JSON.stringify(r.body)) && typeof r.body.path === 'string' && fs.existsSync(r.body.path), '引擎失败：回人话，不把引擎的报错原文（stderr）交给手机；音频仍在（能重试）', JSON.stringify(r.body).slice(0, 240));
  ok(/voice \S+ fail \d+ms exit ffmpeg: Invalid data found/.test(A.log()), '服务日志里留了引擎的报错原文（给查问题的人看）', A.log().split('\n').filter((l) => /voice/.test(l)).slice(-3).join(' | '));
  r = await A.vox('ANSI');
  const ansiLine = A.log().split('\n').filter((l) => / fail \d+ms /.test(l)).slice(-1)[0] || '';
  ok(() => /fail \d+ms exit boom red end$/.test(ansiLine) && ![...ansiLine].some((c) => c.charCodeAt(0) < 32), '小修：日志里的引擎报错洗掉色码和响铃（不让引擎往日志里塞控制字符）', JSON.stringify(ansiLine));
  r = await A.vox('LONGERR');
  const longLine = A.log().split('\n').filter((l) => / fail \d+ms /.test(l)).slice(-1)[0] || '';
  ok(() => /exit e+$/.test(longLine) && longLine.split(' exit ')[1].length === 200, '小修：日志里的引擎报错最多 200 字（引擎报 600 字也只记 200）', String(longLine.split(' exit ')[1] || '').length);
  r = await A.vox('BIG');
  ok(() => r.body.ok === true && r.body.truncated === true && Array.from(r.body.text).length === MAX_TEXT && Buffer.from(r.body.text, 'utf8').toString('utf8') === r.body.text && r.body.text.endsWith(U(0x1f600)), '小修：转出 6001 个字（第 6000 个是 emoji）→ 整个 emoji 留下、不劈开，应答带 truncated:true（手机能提示「后面被截了」）', JSON.stringify([r.body.ok, r.body.truncated, Array.from(r.body.text || '').length]));
  const n0 = A.uploads().length;
  for (const [why, body] of [['不是音频的扩展名', { name: 'x.png', data: b64('PNG_____') }], ['坏 base64', { name: 'a.m4a', data: 'abc$%^' }], ['没有 data', { name: 'a.m4a' }], ['空', { name: 'a.m4a', data: '' }]]) {
    r = await A.post('/api/transcribe', body); ok(r.code === 200 && r.body.ok === false && typeof r.body.error === 'string', '坏输入：' + why + ' → ok:false + 一句话', JSON.stringify(r.body).slice(0, 160));
  }
  ok(A.uploads().length === n0, '坏输入不落盘（uploads 个数没变）', n0 + ' → ' + A.uploads().length);
  r = await A.post('/api/transcribe', { name: '../../etc/evil.m4a', data: b64('ZH1_____') });
  ok(r.body.ok && r.body.path.startsWith(path.join(A.DATA, 'uploads') + '/') && !r.body.path.includes('..') && !/evil/.test(r.body.path), '路径穿越的名字：只取扩展名，落盘名不带手机给的原名（不跑出 uploads、也不把名字写进文件系统）', JSON.stringify(r.body.path));
  const hp0 = A.pids().length;
  r = await A.vox('HANG');
  ok(r.code === 200 && r.body.ok === false && /超时/.test(r.body.error), '超时：假引擎卡住 → 2.5 秒后回「转写超时」，不一直挂着手机', JSON.stringify(r.body).slice(0, 200));
  const hangPids = A.pids().slice(hp0);
  ok(hangPids.length === 2 && await gone(hangPids), '超时后假引擎和它起的孙进程（sleep 37）都被杀掉——按假脚本自己记下的进程号查，不按名字找（不留 2 GB 的孤儿；真 vidscribe 是 bash → ffmpeg / python，只杀直接子进程会留下模型进程）', 'pids=' + hangPids.join(',') + ' alive=' + hangPids.filter(alive).join(','));
  reap(hangPids);
  r = await A.vox('ZH1');
  ok(r.body.ok, '超时之后下一个请求照常转（队列没被卡住）', JSON.stringify(r.body).slice(0, 160));

  // 并发 4 个慢的：1 转 + 2 等 + 1 忙；不重叠
  A.clear();    // 超时那次留下的计数文件和锁目录一并清掉，下面只数这一批
  const t0 = Date.now();
  const four = await Promise.all([0, 1, 2, 3].map((i) => A.vox('SLOW', 'v' + i + '.m4a')));
  const took = Date.now() - t0;
  ok(four.filter((x) => x.body.ok).length === 3 && four.filter((x) => x.body.busy === true).length === 1, '并发 4 个：3 个转出来、1 个回「忙」', JSON.stringify(four.map((x) => x.body.ok ? 'ok' : x.body.busy ? 'busy' : x.body.error)));
  ok(!fs.existsSync(A.out + '.overlap'), '并发时假引擎一次都没有重叠运行（模型 2 GB，不叠）');
  ok(took >= 2800, '三段各 1 秒是排着转的（总共 ≥ 2.8 秒，不是同时转）', took + 'ms');
  ok(four.filter((x) => x.body.busy).every((x) => x.body.ok === false && /别的录音/.test(x.body.error)), '忙的那个：一句人话，不是错误码', JSON.stringify(four.find((x) => x.body.busy)?.body));
  const calls = A.calls().filter((l) => /^SLOW/.test(l)).length;
  ok(calls === 3, '假引擎只被调了 3 次（忙的那个没起进程）', String(calls));

  // ── [B8] S3 的晚路径：几个请求同时通过了「先查忙」，到 transcribe() 才发现满了 ──
  // 先查忙只管「到的时候已经满了」的；几个请求几乎同时到、都还没收完正文时队里是空的，全部通过先查。
  // 做法：4 个请求先发头和一半正文并挂着（队里空，都过了先查），再按顺序补完正文：前 3 个进队，第 4 个收完时队里已满 → 由 transcribe() 回 busy:true（1b 的改坏版 srv-busy-dropped / srv-fail-no-path 守的就是这条应答）。
  console.log('\n[B8] S3 晚路径：都通过了先查、收完正文才发现满了 → 仍回忙，音频还在');
  A.clear();
  const heldVox = (S, mark, tag) => {
    const body = Buffer.from(JSON.stringify({ name: 'voice.m4a', data: b64(mark.padEnd(8, '_') + tag) })), cut = Math.floor(body.length / 2); let req;
    const done = new Promise((resolve) => { req = http.request({ host: '127.0.0.1', port: S.port, method: 'POST', path: '/api/transcribe', headers: { 'x-ccboard': S.tok, origin: 'http://127.0.0.1:' + S.port, 'content-type': 'application/json', 'content-length': body.length } }, (rs) => { let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} resolve({ code: rs.statusCode, body: j }); }); }); req.on('error', () => resolve({ code: 0, body: {} })); req.write(body.subarray(0, cut)); });
    return { done, finish: () => req.end(body.subarray(cut)) };
  };
  const hv = [0, 1, 2, 3].map((i) => heldVox(A, 'SLOW', 'late' + i));
  await sleep(500);                                  // 4 个都已收到头、在等正文（队里空）
  hv[0].finish(); await until(() => A.callTags().includes('late0'), 5000);
  hv[1].finish(); hv[2].finish(); await until(() => A.uploadTags().filter((t) => /^late[012]$/.test(t)).length === 3, 5000);
  hv[3].finish();
  const hr = await Promise.all(hv.map((h) => h.done));
  ok(hr[0].body.ok === true && hr[1].body.ok === true && hr[2].body.ok === true, 'S3 晚路径：前 3 个（1 在转 + 2 排着）都转出来', JSON.stringify(hr.map((x) => x.body.ok ? 'ok' : x.body.busy ? 'busy' : x.body.error)));
  ok(hr[3].code === 200 && hr[3].body.ok === false && hr[3].body.busy === true && /别的录音/.test(hr[3].body.error), 'S3 晚路径：第 4 个（先查时队里还是空的）收完正文才发现满了 → 仍回 busy:true + 一句人话，不是错误码', JSON.stringify(hr[3].body).slice(0, 200));
  ok(typeof hr[3].body.path === 'string' && fs.existsSync(hr[3].body.path), 'S3 晚路径：忙的那个音频已经落盘，应答带路径（能重试）', JSON.stringify(hr[3].body.path));
  ok(!A.callTags().includes('late3'), 'S3 晚路径：忙的那个没起假引擎', A.callTags().join(','));

  // ── [B5] S2：手机断开 ──
  console.log('\n[B5] S2 手机断开：排队的不起进程且让出名额；在转的整组杀掉');
  A.clear();
  const q1 = A.voxAbortable('SLOW2', 'q1'); await until(() => A.calls().length >= 1, 5000);
  const q2 = A.voxAbortable('SLOW2', 'q2'), q3 = A.voxAbortable('SLOW2', 'q3');
  const queued = await until(() => A.uploadTags().filter((t) => /^q[123]$/.test(t)).length === 3, 5000);
  ok(queued, 'S2 前提：三段都到了服务端（q1 在转、q2 / q3 排着）', A.uploadTags().join(','));
  q2.abort(); q3.abort(); await sleep(300);
  const [q4, q5] = await Promise.all([A.vox('SLOW2', 'voice.m4a', 'q4'), A.vox('SLOW2', 'voice.m4a', 'q5')]);
  ok(q4.body.busy !== true && q5.body.busy !== true && q4.body.ok === true && q5.body.ok === true, 'S2：q2 / q3 断开后名额马上让出来 → 新来的 q4 / q5 没被回「忙」，照常转出来', JSON.stringify([q4.body, q5.body]).slice(0, 200));
  const q1r = await q1.done;
  ok(q1r.body.ok === true, 'S2：在转的 q1 不受影响', JSON.stringify(q1r.body).slice(0, 120));
  const callFiles = A.callTags();
  ok(JSON.stringify([...callFiles].sort()) === JSON.stringify(['q1', 'q4', 'q5']), 'S2：假引擎只被调了 q1 / q4 / q5 三次；断开了的 q2 / q3 一次都没起进程（不占 2 GB 的模型）', JSON.stringify(callFiles));
  ok(!fs.existsSync(A.out + '.overlap'), 'S2：全程没有重叠');

  const X = await startServer('cx', { env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '20000' } });
  const hx = X.voxAbortable('HANG', 'hang');
  const two = await until(() => X.pids().length >= 2, 8000);
  const hxp = X.pids();
  ok(two && hxp.length === 2 && hxp.every(alive), 'S2 前提：假引擎在转，它和孙进程（sleep 37）都活着', JSON.stringify(hxp));
  const tAb = Date.now(); hx.abort();
  ok(await gone(hxp, 6000), 'S2：在转的时候手机断开 → 整个进程组被杀（6 秒内；不等 20 秒的转写超时）', 'alive=' + hxp.filter(alive).join(',') + ' ' + (Date.now() - tAb) + 'ms');
  reap(hxp);
  ok(/voice \S+ cancel \d+ms running/.test(X.log()), 'S2：服务日志里记了「cancel … running」', X.log().split('\n').filter((l) => /voice/.test(l)).slice(-3).join(' | '));
  X.clear();
  const xr = await X.vox('ZH1');
  ok(xr.body.ok === true && X.voiceTmp().length === 0, 'S2：取消之后服务照常转下一个、临时夹也清了', JSON.stringify(xr.body).slice(0, 120) + ' tmp=' + JSON.stringify(X.voiceTmp()));

  // ── [B6] S3：忙时先回忙，不收正文、不落盘 ──
  console.log('\n[B6] S3 忙时先回忙：不收正文、不落盘');
  A.clear();
  const s1 = A.voxAbortable('SLOW2', 's1'); await until(() => A.calls().length >= 1, 5000);
  const s2 = A.voxAbortable('SLOW2', 's2'), s3 = A.voxAbortable('SLOW2', 's3');
  const occupied = await until(() => A.uploadTags().filter((t) => /^s[123]$/.test(t)).length === 3, 5000);
  ok(occupied, 'S3 前提：三个名额都被占着（s1 在转、s2 / s3 排着）', A.uploadTags().join(','));
  const upBefore = A.uploads().length, tBusy = Date.now();
  const bigBusy = await A.post('/api/transcribe', { name: 'busy.m4a', data: Buffer.alloc(Math.min(MAX_AUDIO, 1500000), 65).toString('base64') });
  ok(bigBusy.code === 200 && bigBusy.body.busy === true && bigBusy.body.ok === false && /别的录音/.test(bigBusy.body.error), 'S3：三个名额都占着时，第四个回「忙」', JSON.stringify(bigBusy.body).slice(0, 160));
  ok(A.uploads().length === upBefore, 'S3：忙的那个没落盘（原来先收下 48 MiB 以内的正文、解码、存盘，再说「忙」）', upBefore + ' → ' + A.uploads().length);
  ok(bigBusy.body.path === undefined, 'S3：忙的应答里没有落盘路径（没存东西）', JSON.stringify(bigBusy.body).slice(0, 160));
  await Promise.all([s1.done, s2.done, s3.done]);
  ok(!fs.existsSync(A.out + '.overlap') && A.calls().length === 3, 'S3：前三个照常转完（假引擎 3 次、没重叠）', String(A.calls().length));

  // ── [B7] S4：体上限和大小上限 ──
  console.log('\n[B7] S4 体上限和大小上限');
  A.clear(); const upN = A.uploads().length;
  const exact = await A.post('/api/transcribe', { name: 'exact.m4a', data: Buffer.alloc(MAX_AUDIO, 65).toString('base64') });
  ok(exact.code === 200 && exact.body.ok === true && exact.body.text === '未知记号', 'S4：正好上限大小的录音 → 收下、转写照跑（体上限没把合法的最大录音挡掉）', JSON.stringify(exact.body).slice(0, 160));
  const over1 = await A.post('/api/transcribe', { name: 'over1.m4a', data: Buffer.alloc(MAX_AUDIO + 1, 65).toString('base64') });
  ok(over1.code === 200 && over1.body.ok === false && /太长/.test(over1.body.error) && over1.body.path === undefined, 'S4：超上限一个字节 → 「太长，最多约 N 分钟」，不落盘、不起假引擎', JSON.stringify(over1.body).slice(0, 160));
  const callsOver = A.calls().length;
  const hugeAudio = Buffer.alloc(Math.min(3 * MAX_AUDIO, 60 * 1024 * 1024), 65).toString('base64');
  const over3 = await A.post('/api/transcribe', { name: 'over3.m4a', data: hugeAudio });
  ok(over3.code === 200 && over3.body.ok === false && /太长/.test(over3.body.error), 'S4：体积比上限大得多（超过体上限）→ 一样回「太长」，没被掐断连接（根据声明的长度先拒，不把几十 MB 收下来）', over3.code + ' ' + JSON.stringify(over3.body).slice(0, 160));
  ok(A.uploads().length === upN + 1 && A.calls().length === callsOver, 'S4：超限的两个都没落盘、没起假引擎（uploads 只多了那个合法的 1 个）', upN + ' → ' + A.uploads().length + ' calls ' + callsOver + ' → ' + A.calls().length);

  // ── [B2] M1：服务从 Dock / 登录项 / 重启起来时 PATH 里没有 ~/.local/bin ──
  console.log('\n[B2] M1 服务只带 PATH=/usr/bin:/bin 起来也要能转写');
  const M = await startServer('m1', { env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
  fs.mkdirSync(path.join(M.FH, '.local/bin'), { recursive: true });
  fs.writeFileSync(path.join(M.FH, '.local/bin/vox-helper'), '#!/bin/bash\nprintf \'%s\' "来自 .local/bin 的助手"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(ROOT, 'needp.m4a'), 'NEEDP___');
  const prem2 = spawnSync('/bin/bash', [path.join(BIN, 'vidscribe'), path.join(ROOT, 'needp.m4a'), '-a', '-f', 'txt', '-o', ROOT], { env: { PATH: '/usr/bin:/bin', T_OUT: path.join(ROOT, 'prem'), HOME: M.FH }, encoding: 'utf8' });
  ok(prem2.status === 127 && /command not found/.test(prem2.stderr), 'M1 前提（负对照）：只带 PATH=/usr/bin:/bin 直接跑假引擎 → 找不到 vox-helper、exit 127（和线上「没有 ~/.local/bin」同一个形状）', prem2.status + ' ' + prem2.stderr.slice(0, 80));
  r = await M.vox('NEEDP');
  ok(r.code === 200 && r.body.ok === true && r.body.text === '来自 .local/bin 的助手', 'M1：服务自己只带 PATH=/usr/bin:/bin，转写照样成功——服务起转写进程时把 ~/.local/bin、/opt/homebrew/bin 补进了 PATH（不靠谁起的服务）', JSON.stringify(r.body).slice(0, 200) + ' | ' + M.log().split('\n').filter((l) => /voice/.test(l)).slice(-2).join(' | '));
  const envSeen = rd(M.out + '.env') || '';
  ok(() => envSeen.startsWith('1|' + M.FH + '/.local/bin:/opt/homebrew/bin:/usr/local/bin:') && envSeen.includes(':/usr/bin:/bin'), 'M1：假引擎真收到的环境（读它自己写的文件）：HF_HUB_OFFLINE=1，PATH 前面是 ~/.local/bin、/opt/homebrew/bin、/usr/local/bin，原来的 PATH 在后面', JSON.stringify(envSeen));
  r = await M.vox('NOTOOL');
  ok(() => r.code === 200 && r.body.ok === false && /缺/.test(r.body.error) && /不是这段录音/.test(r.body.error) && !/格式/.test(r.body.error), 'M1：缺程序（exit 127）和「格式读不了」分开说：回「这台 Mac 上缺转写要的程序…不是这段录音的问题」，不叫他重录', JSON.stringify(r.body).slice(0, 200));
  ok(/voice \S+ fail \d+ms missing ffmpeg: command not found/.test(M.log()), 'M1：服务日志里标 missing', M.log().split('\n').filter((l) => /voice/.test(l)).slice(-2).join(' | '));
  r = await M.vox('FAIL');
  ok(r.body.ok === false && /转不出来/.test(r.body.error) && !/缺/.test(r.body.error), 'M1 对照：格式读不了（ffmpeg Invalid data，exit 1）仍是「这段录音转不出来」，不冒充缺程序', JSON.stringify(r.body).slice(0, 200));

  // ── [B3] M2：热词 ──
  console.log('\n[B3] M2 热词：默认只有公开名；私人词来自 config.json 的 voiceHotwords；写错只关这一项');
  ok(() => hwOf(A) !== undefined && !/FretFlow|Acme|Lakeview|Ridgeline/i.test(hwOf(A)) && /Claude Code/.test(hwOf(A)), 'M2：没写 voiceHotwords → 传给假引擎的 -c 只含默认词，不含私人词（读假引擎收到的 -c）', hwOf(A));
  const H = await startServer('h-good', { cfg: { voiceHotwords: ['FretFlow', ' Acme ', 'Lakeview', 'Ridgeline'], autoTrust: true }, env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe') } });
  await H.vox('ZH1');
  ok(() => hwOf(H) === hotwordArg() + ', FretFlow, Acme, Lakeview, Ridgeline', 'M2：config.json 写了 voiceHotwords → 追加在默认词后面（去首尾空白），真的传到了假引擎的 -c', hwOf(H));
  ok(() => /config .*：.*voiceHotwords=4/.test(H.log()) && !/voiceHotwords 不用/.test(H.log()), 'M2：启动日志的 config 行里说了 voiceHotwords=4、没报错', H.log().split('\n').filter((l) => /config/.test(l)).join(' | ').slice(0, 300));
  for (const [bi, [why, v]] of [['不是数组', 'FretFlow'], ['有非字符串的项', ['ok', 5]], ['有一项太长', ['x'.repeat(41)]]].entries()) {
    const B = await startServer('h-bad' + bi, { cfg: { voiceHotwords: v, autoTrust: true }, env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe') } });
    await B.vox('ZH1');
    const logLines = B.log().split('\n');
    ok(() => logLines.filter((l) => /voiceHotwords 不用/.test(l)).length === 1, 'M2 写错（' + why + '）：启动时恰好一行「voiceHotwords 不用（原因）」', logLines.filter((l) => /config/.test(l)).join(' | ').slice(0, 300));
    ok(() => hwOf(B) === hotwordArg() && !/FretFlow/.test(hwOf(B)), 'M2 写错（' + why + '）：只用默认热词（这一项整个不用）', hwOf(B));
    ok(() => /config .*：\d+ 个项目，autoTrust=true/.test(B.log()) && !/读不了/.test(B.log()), 'M2 写错（' + why + '）：别的键不受影响（autoTrust 照常读到、config 没整份作废）', logLines.filter((l) => /config/.test(l)).join(' | ').slice(0, 300));
  }

  // ── [B4] S1：服务被 SIGKILL，重启后清孤儿 ──
  console.log('\n[B4] S1 服务被杀后重启：清孤儿转写进程组和 voice-tmp/v-*，别的服务的同名进程不动');
  const S1 = await startServer('s1', { env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '60000' } });
  const s1req = S1.voxAbortable('HANG', 'orphan');
  await until(() => S1.pids().length >= 2, 8000);
  const orphanPids = S1.pids();
  // 旁观者：另一份服务（别的 voice-tmp）起的、命令行同样带 vidscribe 路径和 -o …/v-…，但目录不是 S1 的——不该被动
  const byFile = path.join(ROOT, 'bystander.m4a'); fs.writeFileSync(byFile, 'HANG____');
  const by = spawn('/bin/bash', [path.join(BIN, 'vidscribe'), byFile, '-a', '-f', 'txt', '-o', path.join(ROOT, 'other-voice-tmp', 'v-zzz'), '-c', 'x'], { detached: true, stdio: 'ignore', env: { ...process.env, PATH: '/usr/bin:/bin', T_OUT: path.join(ROOT, 'bystander-out') } });
  extraGroups.push(by.pid); by.unref(); extraPidFiles.push(path.join(ROOT, 'bystander-out.pids'));
  await until(() => PIDS(path.join(ROOT, 'bystander-out.pids')).length >= 2, 8000);
  const byPids = PIDS(path.join(ROOT, 'bystander-out.pids'));
  ok(() => orphanPids.length === 2 && S1.voiceTmp().filter((n) => /^v-/.test(n)).length === 1 && byPids.length === 2 && [...orphanPids, ...byPids].every(alive), 'S1 前提：S1 的假引擎在转（它和孙进程活着、voice-tmp 里有 1 个 v-*）；旁观进程也在转', JSON.stringify({ orphanPids, tmp: S1.voiceTmp(), byPids }));
  process.kill(S1.proc.pid, 'SIGKILL'); await sleep(400);
  ok(orphanPids.every(alive) && S1.voiceTmp().filter((n) => /^v-/.test(n)).length === 1, 'S1 前提（负对照）：服务被 SIGKILL 以后，转写进程组还活着、临时夹还在——这就是要清的孤儿（没有任何收尾能跑）', 'alive=' + orphanPids.filter(alive).join(',') + ' tmp=' + JSON.stringify(S1.voiceTmp()));
  const S1b = await startServer('s1', { env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '60000' } });    // 同一个数据目录再起一份 = 重启
  S1b.tok = (rd(path.join(S1b.DATA, '.token')) || '').trim();        // 同一个数据目录：口令文件可能在新服务起来后才重写，再读一次
  ok(await gone(orphanPids, 5000), 'S1：重启后孤儿进程组（假引擎 + 它的孙进程 sleep 37）被杀', 'alive=' + orphanPids.filter(alive).join(','));
  ok(S1b.voiceTmp().filter((n) => /^v-/.test(n)).length === 0, 'S1：voice-tmp 里上次留下的 v-* 被清掉', JSON.stringify(S1b.voiceTmp()));
  ok(byPids.every(alive), 'S1 对照：别的服务的同名进程（命令行带同一个 vidscribe 路径、-o 指向别的 voice-tmp）一个都没被动', 'alive=' + byPids.filter(alive).join(',') + ' of ' + byPids.join(','));
  ok(/voice \S+ sweep killed 1 组 removed 1 个临时夹/.test(S1b.log()), 'S1：重启日志里有一行「sweep killed 1 组 removed 1 个临时夹」', S1b.log().split('\n').filter((l) => /voice/.test(l)).join(' | ').slice(0, 300));
  S1b.clear();
  const s1r = await S1b.vox('ZH1');
  ok(s1r.body.ok === true, 'S1：重启之后照常转', JSON.stringify(s1r.body).slice(0, 120));
  reap(byPids); try { process.kill(-by.pid, 'SIGKILL'); } catch {}
  ok(await gone(byPids, 3000), 'S1 收尾：旁观进程是自己起的，按自己记下的进程号收掉了');

  // ═══ [B9] FIX-2（11/27 复审）═══
  console.log('\n[B9] FIX-2：同端口再起一份服务不动第一份正在转的录音（N1）；没有 Content-Length 的超长录音也回「太长」（d）');
  {
    // N1：外壳 0.8 秒 /health 没答上就会再起一份服务（同端口、同数据目录）。第二份 EADDRINUSE 退出之前，不能把第一份正在转的那组杀掉、不能清空 voice-tmp
    const DU = await startServer('dup', { env: { CCBOARD_VIDSCRIBE: path.join(BIN, 'vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '60000' } });
    const first = DU.vox('SLOW5', 'voice.m4a', 'dup1');                         // 假引擎慢 5 秒，不 await：第二份起来、退出的时候它还在转
    const started = await until(() => DU.calls().length >= 1 && DU.voiceTmp().some((n) => /^v-/.test(n)), 8000);
    ok(!!started, 'N1 前提：第一份服务在转录音（假引擎起了、voice-tmp 里有 v-*）', JSON.stringify([DU.calls(), DU.voiceTmp()]));
    const bLogFile = path.join(DU.dir, 'dup-b.log'), bfd = fs.openSync(bLogFile, 'a');
    const B2 = spawn(NODE, [SERVER], { env: DU.env, stdio: ['ignore', bfd, bfd] }); kids.push(B2.pid);
    const bExit = await new Promise((resolve) => { const t = setTimeout(() => resolve('timeout'), 20000); B2.on('exit', (c, sg) => { clearTimeout(t); resolve(c === null ? 'sig:' + sg : c); }); });
    const bLog = rd(bLogFile) || '';
    ok(bExit !== 'timeout' && /EADDRINUSE/.test(bLog), 'N1 前提：第二份（同端口、同数据目录）起不来、自己退出', 'exit=' + bExit + ' ' + bLog.slice(-300));
    ok(DU.proc.exitCode === null && DU.voiceTmp().some((n) => /^v-/.test(n)), 'N1：第二份退出以后，第一份还活着、它正在转的录音的 voice-tmp/v-* 还在（旧版第二份在 listen 之前就清扫，临时夹被删）', 'alive=' + (DU.proc.exitCode === null) + ' tmp=' + JSON.stringify(DU.voiceTmp()));
    ok(!/sweep/.test(bLog), 'N1：第二份的日志里没有 sweep 那一行（它没清任何东西；旧版会打「sweep killed 1 组 …」）', bLog.split('\n').filter((l) => /voice|sweep/.test(l)).join(' | ').slice(0, 300));
    const fr = await first;
    ok(fr.body.ok === true && fr.body.text === '慢的那一段', 'N1：第一份那段录音照样转完、回文字（旧版被第二份整组杀掉，手机收到「格式读不了」）', JSON.stringify(fr.body).slice(0, 200));
    ok(/voice \S+ ok /.test(DU.log()) && !/sweep/.test(DU.log()), 'N1：第一份自己的日志里有这一段的 ok 行、没有 sweep（它起来时没有孤儿可清）', DU.log().split('\n').filter((l) => /^voice /.test(l)).join(' | ').slice(0, 300));

    // d：没有 Content-Length 的（chunked）请求事先看不出多长，读到超过体上限才知道；也要回「录音太长了」，不能掐断连接
    const chunked = (S, buf) => new Promise((resolve) => {
      const rq2 = http.request({ host: '127.0.0.1', port: S.port, method: 'POST', path: '/api/transcribe', headers: { 'x-ccboard': S.tok, origin: 'http://127.0.0.1:' + S.port, 'content-type': 'application/json' } }, (rs) => {
        let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} resolve({ code: rs.statusCode, body: j, raw: t, chunked: !rs.req.getHeader('content-length') }); });
      });
      rq2.on('error', (e) => resolve({ code: 0, body: { error: String(e) }, raw: '', chunked: true })); rq2.setTimeout(30000, () => rq2.destroy(new Error('timeout')));
      let off = 0; const pump = () => { while (off < buf.length) { const end = Math.min(off + 65536, buf.length); const w = rq2.write(buf.subarray(off, end)); off = end; if (!w) { rq2.once('drain', pump); return; } } rq2.end(); };
      pump();
    });
    const up0 = A.uploads().length, calls0 = A.calls().length;
    const cOk = await chunked(A, Buffer.from(JSON.stringify({ name: 'voice.m4a', data: b64('ZH1_____') })));
    ok(cOk.code === 200 && cOk.body.ok === true && cOk.body.text === '你好，我想给总控台加一个录音按钮。', 'd 对照：没有 Content-Length（chunked 发）的小录音照常转——慢的不是 chunked 本身，是大小', JSON.stringify(cOk.body).slice(0, 160));
    const up1 = A.uploads().length, calls1 = A.calls().length;
    const cBig = await chunked(A, Buffer.alloc(MAX_BODY + 300000, 120));
    ok(cBig.code === 200 && cBig.body.ok === false && /太长/.test(cBig.body.error), 'd：没有 Content-Length 的超长录音（体上限 + 300 KB）→ 回「录音太长了」，不是掐断连接（旧版 readBody 超了就 destroy，手机只看到网络错误）', cBig.code + ' ' + JSON.stringify(cBig.body).slice(0, 160));
    ok(A.uploads().length === up1 && A.calls().length === calls1 && up1 === up0 + 1 && calls1 === calls0 + 1, 'd：超长的那个没落盘、没起转写（uploads 和引擎调用次数都只多了对照那 1 个）', JSON.stringify({ up0, up1, upNow: A.uploads().length, calls0, calls1, callsNow: A.calls().length }));

    // S4 先看声明的长度：只声明一个超大的 Content-Length、正文只发几百字节且不收尾。有这道门，服务不等正文就回「太长」；没有这道门（只剩 d 的软读取），服务要一直等正文，客户端等不到回答。
    // （FIX-2 加了 d 以后，只看「超大的请求回了太长」已经分不出有没有这道门——两条路回的字一样——所以改成测「正文没发完就回了」。）
    const early = await new Promise((resolve) => {
      const t0 = Date.now(); let done = false;
      const fin = (v) => { if (done) return; done = true; try { rq3.destroy(); } catch {} resolve({ ...v, ms: Date.now() - t0 }); };
      const rq3 = http.request({ host: '127.0.0.1', port: A.port, method: 'POST', path: '/api/transcribe', headers: { 'x-ccboard': A.tok, origin: 'http://127.0.0.1:' + A.port, 'content-type': 'application/json', 'content-length': String(MAX_BODY * 10) } }, (rs) => {
        let t = ''; rs.setEncoding('utf8'); rs.on('data', (c) => (t += c)); rs.on('end', () => { let j = {}; try { j = JSON.parse(t) || {}; } catch {} fin({ code: rs.statusCode, body: j }); });
      });
      rq3.on('error', (e) => fin({ code: 0, body: { error: String(e) } })); rq3.setTimeout(8000, () => fin({ code: 0, body: { error: 'timeout：服务在等正文' } }));
      rq3.write(Buffer.alloc(500, 120));   // 不 end()：正文声明了 MAX_BODY × 10，实际只发这 500 字节
    });
    ok(early.code === 200 && early.body.ok === false && /太长/.test(early.body.error || ''), 'S4：声明的 Content-Length 就超上限、正文只发了 500 字节且没发完 → 不等正文，马上回「太长」（先看声明的长度再决定要不要收）', early.code + ' ' + early.ms + ' ms ' + JSON.stringify(early.body).slice(0, 160));
    ok(A.uploads().length === up1 && A.calls().length === calls1, 'S4：这个声明超长的请求没落盘、没起转写', JSON.stringify({ up1, upNow: A.uploads().length, calls1, callsNow: A.calls().length }));
  }

  // ═══ [C] 手机远程端口 ═══
  console.log('\n[C] 手机远程端口（Tailscale 头 + 设备凭证）');
  const RP = A.rport, RH = (x = {}) => ({ host: TS, 'tailscale-user-login': LG, ...x });
  const pr = await A.post('/api/remote/pair', {}); const code = String((pr.body.url || '').split('#')[1] || '');
  const cl = await rq(RP, 'POST', '/api/remote/claim', RH({ origin: ORI }), { code, name: 'iPhone' });
  const CRED = String(cl.body.device || '');      // 字段名照 state.test.mjs [10]：claim 的应答里 device 就是凭证（16 位设备号 . 43 位随机串）
  ok(/^[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(CRED), '配对：拿到设备凭证', JSON.stringify(cl.body).slice(0, 120));
  const audio = 'ZH1_____', audioB64 = b64(audio);
  const MARK = [audioB64, audioB64.slice(0, 8), 'secretvoice', '你好', audio];
  let x = await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': CRED, origin: ORI }), { name: 'secretvoice.m4a', data: audioB64 });
  ok(x.code === 200 && x.body.ok === true && x.body.text === '你好，我想给总控台加一个录音按钮。', '手机端：凭证对、头齐的 POST /api/transcribe → 转出来的文字', JSON.stringify(x.body).slice(0, 200));
  const acts = A.log().split('\n').filter((l) => /act \S+ \S+ POST \/api\/transcribe/.test(l));
  ok(acts.length === 1 && /POST \/api\/transcribe bytes=8 ext=\.m4a$/.test(acts[0]) && !MARK.some((m) => acts[0].includes(m)), '远程日志只记大小和扩展名（bytes=8 ext=.m4a），不记原名、不记文字、不记 base64', acts[0]);
  for (const [why, y] of [
    ['不带设备凭证', await rq(RP, 'POST', '/api/transcribe', RH({ origin: ORI }), { name: 'a.m4a', data: audioB64 })],
    ['凭证不对', await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': '0123456789abcdef.' + 'A'.repeat(43), origin: ORI }), { name: 'a.m4a', data: audioB64 })],
    ['GET（方法不对）', await rq(RP, 'GET', '/api/transcribe', RH({ 'x-ccboard-device': CRED }))],
    ['结尾斜杠', await rq(RP, 'POST', '/api/transcribe/', RH({ 'x-ccboard-device': CRED, origin: ORI }), { name: 'a.m4a', data: audioB64 })],
    ['大小写不对', await rq(RP, 'POST', '/api/Transcribe', RH({ 'x-ccboard-device': CRED, origin: ORI }), { name: 'a.m4a', data: audioB64 })],
    ['不带 Origin', await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': CRED }), { name: 'a.m4a', data: audioB64 })],
    ['Origin 是别的网站', await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': CRED, origin: 'https://evil.example.com' }), { name: 'a.m4a', data: audioB64 })],
  ]) ok(y.code >= 400 && y.body.ok !== true && !y.body.text, '远程拦：' + why, y.code + ' ' + JSON.stringify(y.body).slice(0, 100));
  ok(A.log().split('\n').filter((l) => /act \S+ \S+ POST \/api\/transcribe/.test(l)).length === 1, '被拦的 7 次都没走到转写（act 行仍只有那 1 条）');
  const full = await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': CRED, origin: ORI }), { name: 'full.m4a', data: Buffer.alloc(MAX_AUDIO, 65).toString('base64') });
  ok(full.code === 200 && full.body.ok === true && full.body.text === '未知记号', '手机远程：正好上限大小的录音 → 通、转写照跑', full.code + ' ' + JSON.stringify(full.body).slice(0, 160));
  const big = await rq(RP, 'POST', '/api/transcribe', RH({ 'x-ccboard-device': CRED, origin: ORI }), { name: 'big.m4a', data: Buffer.alloc(20 * 1024 * 1024, 65).toString('base64') });
  ok(big.code === 200 && big.body.ok === false && /太长/.test(big.body.error), '手机远程：传 20 MB（远超上限）→ 回「太长」（S4：不再放到 48 MiB 收下来转；原来 20 MB 能一路转到 90 秒超时）', big.code + ' ' + JSON.stringify(big.body).slice(0, 160));
  ok(A.log().split('\n').filter((l) => /act \S+ \S+ POST \/api\/transcribe/.test(l)).length === 2, '手机远程：20 MB 的那个没被收下来（act 行仍是 2 条：前面那条 + 上限大小那条；act 行是读完正文才写的，写了就说明几十 MB 被收进来了）');
  // 对照：别的接口的 400 KB 上限没被放宽。小请求得到的是业务应答，500 KB 的得到的是上限的拒绝（readBody 超了就 reject + destroy：连接被掐断或回 500 too big）
  const smallSend = await rq(RP, 'POST', '/api/send', RH({ 'x-ccboard-device': CRED, origin: ORI }), { sid: 'nope', text: 'x' });
  const bigSend = await rq(RP, 'POST', '/api/send', RH({ 'x-ccboard-device': CRED, origin: ORI }), { sid: 'nope', text: 'x'.repeat(500000) });
  ok(smallSend.code !== 0 && !/too big/.test(smallSend.raw), '对照（小请求）：/api/send 传一句话 → 走到了业务逻辑（回的不是「too big」）', smallSend.code + ' ' + smallSend.raw.slice(0, 100));
  ok(bigSend.code === 0 || /too big/.test(bigSend.raw), '对照（大请求）：/api/send 传 500 KB → 被 400 KB 的上限拒（连接断了或回 too big），没被这次改动放宽', bigSend.code + ' ' + bigSend.raw.slice(0, 100));

  // ═══ [D] 没装 vidscribe ═══
  console.log('\n[D] 没装 vidscribe（不给 CCBOARD_VIDSCRIBE，线上那条路径在假主目录里不存在）');
  const D = await startServer('d', {});
  r = await D.vox('ZH1');
  ok(r.code === 200 && r.body.ok === false && /没装转写工具/.test(r.body.error), '回「这台 Mac 上没装转写工具」，不崩', JSON.stringify(r.body).slice(0, 200));
  ok(typeof r.body.path === 'string' && fs.existsSync(r.body.path), '音频仍落盘（装好以后能重转）', JSON.stringify(r.body.path));
  const h = await (await fetch('http://127.0.0.1:' + D.port + '/health')).json();
  ok(h.ok === true, '之后服务照常');
  ok(/voiceSetup\(\{\s*sandbox:\s*SANDBOX\b/.test(serverSrc), 'S5：server.mjs 把 SANDBOX 交给 voiceSetup（文本检查：试验服务全是 SANDBOX，行为测不出线上那一支，所以另有 [A] 的纯函数测试守「非试验场不认环境变量」）');

  // ═══ [E] 真引擎（可选）═══
  if (REAL_I >= 0) {
    console.log('\n[E] 真 vidscribe 端到端（--real）');
    const file = path.resolve(ARGS[REAL_I + 1] || ''), want = ARGS[REAL_I + 2] || '';
    ok(fs.existsSync(file) && want, '--real 要给音频文件和应有的文字', file + ' | ' + want);
    // M1 的真引擎证明：服务自己只带最小的 PATH（没有 ~/.local/bin、没有 /opt/homebrew/bin），靠 voiceEnv 补。
    // 试验服务的 HOME 是假的，所以把假主目录的 .local/bin 链到真的（voiceEnv 补的是 $HOME/.local/bin）；模型缓存仍用真主目录（HF_HOME），否则会在假主目录里重下约 2.3 GB。别把 HOME 指到临时夹。
    // HF_HUB_OFFLINE 的证明：HF_ENDPOINT 指向一个只数连接的本地监听。离线 → 0 次；对照：同样的 vidscribe 不带 HF_HUB_OFFLINE → 应 ≥ 1 次。
    const realHome = process.env.HOME;
    let hits = 0; const lis = net.createServer((s) => { hits++; s.destroy(); }); await new Promise((res) => lis.listen(PORT + 900, '127.0.0.1', res));
    const R = await startServer('real', { env: {
      CCBOARD_VIDSCRIBE: path.join(realHome, '.local/bin/vidscribe'), CCBOARD_VOICE_TIMEOUT_MS: '120000',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HF_HOME: path.join(realHome, '.cache/huggingface'), HF_ENDPOINT: 'http://127.0.0.1:' + (PORT + 900),
    } });
    fs.mkdirSync(path.join(R.FH, '.local'), { recursive: true }); fs.symlinkSync(path.join(realHome, '.local/bin'), path.join(R.FH, '.local/bin'));
    const t1 = Date.now();
    r = await R.post('/api/transcribe', { name: path.basename(file), data: fs.readFileSync(file).toString('base64') });
    const norm = (s) => String(s).replace(/[\s，。,.！!？?、]/g, '');
    ok(r.body.ok === true && norm(r.body.text) === norm(want), '真引擎已知答案（服务只带 PATH=/usr/bin:/bin 起来）：「' + want + '」', JSON.stringify(r.body).slice(0, 200) + ' ' + (Date.now() - t1) + 'ms');
    ok(hits === 0, 'M1：HF_HUB_OFFLINE=1 → 转写期间 HF_ENDPOINT 的监听被连了 0 次（模型已在本机，不去问 huggingface.co）', 'hits=' + hits);
    const h0 = hits;
    // 正对照必须用异步起子进程：spawnSync 会把本进程的事件循环堵住，监听根本来不及接连接（11/27 第一次就是这样 0 次、status=null）。
    // 连上一次就够证明「没开离线开关就会去问 HF_ENDPOINT」，不用等转写做完：连上就整组收掉。
    const ac = new AbortController(); const poll = setInterval(() => { if (hits > h0) ac.abort(); }, 50);
    const ctl = await runGroup('/bin/bash', [path.join(realHome, '.local/bin/vidscribe'), file, '-a', '-f', 'txt', '-o', fs.mkdtempSync(path.join(ROOT, 'ctl-')), '-c', 'x'], { env: { ...process.env, PATH: [path.join(realHome, '.local/bin'), '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'), HF_HOME: path.join(realHome, '.cache/huggingface'), HF_ENDPOINT: 'http://127.0.0.1:' + (PORT + 900), HF_HUB_OFFLINE: '' }, timeout: 90000, signal: ac.signal });
    clearInterval(poll);
    ok(hits > h0, 'M1 对照（正对照）：同一个 vidscribe 不带 HF_HUB_OFFLINE → 监听被连了 ' + (hits - h0) + ' 次（证明上面的 0 次是离线开关的效果，不是监听没挂对）', 'hits ' + h0 + ' → ' + hits + ' ' + JSON.stringify({ code: ctl.code, aborted: ctl.aborted, timedOut: ctl.timedOut }));
    lis.close();
  }
} finally {
  await cleanup();
}
console.log(`\n${pass} 过 ${fail} 红`);
process.exit(fail ? 1 : 0);
