/**
 * [INPUT]: 依赖 ../agy.mjs（Antigravity 接入的纯规则 + 状态栏取数命令 node agy.mjs tap <文件>）；依赖 /bin/sh。不碰真的 agy，不起服务。
 * [OUTPUT]: 逐项打印 ok / FAIL；退出码 0 = 全过。
 * [POS]: test/ 的 Antigravity 规则专测（11/27 起）。服务端到端（假 agy 开窗口、忙闲、交付、接回、只认他本人）在 state.test.mjs 的 [7d-3] 和 [8]。
 *        每条规则都有「该拦的」和「该过的」两种已知答案；tap 命令真用 sh -c 跑，路径里带空格（线上数据目录是 Application Support）。
 * [PROTOCOL]: 改了 agy.mjs 的规则要同步改这里；加断言前先在旧代码上跑出红。
 */
// 用法：node test/agy.test.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as A from '../agy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (cond, name, info) => { let v; try { v = typeof cond === 'function' ? cond() : cond; } catch (e) { v = false; info = 'threw: ' + e.message; }
  if (v) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ← ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); } };

// 照 11/27 本机 agy 1.5.18 状态栏真给的那份 JSON 的栏位（值换成假的；email 是假的）
const RAW = { agent_state: 'working', conversation_id: '7f1c2a9e-1111-4222-8333-944455556666', session_id: 'sess-1', transcript_path: '/Users/Shared/x/.gemini/antigravity/brain/7f1c2a9e-1111-4222-8333-944455556666/.system_generated/logs/transcript.jsonl',
  cwd: '/Users/Shared/x/Projects/demo', workspace: '/Users/Shared/x/Projects/demo', model: { id: 'Gemini 4 Neon (High)', display_name: 'Gemini 4 Neon (High)', effort: 'high' }, context_window: { used_percentage: 12.6 },
  quota: { 'gemini-5h': { remaining_fraction: 0.83, reset_time: '2026-11-27T23:00:00Z', reset_in_seconds: 3600 }, 'gemini-weekly': { remaining_fraction: 0.5 }, 'bad key!': { remaining_fraction: 1 } },
  plan_tier: 'Google AI Pro', cycle_mode: 'auto', task_count: 2, pending_input_count: 1, tool_confirmation_pending: false, email: 'someone@example.com', version: '1.5.18', product: 'agy', sandbox: false, terminal_width: 160 };

console.log('\n[A] slimTap：只留要的栏，邮箱不要');
const T = A.slimTap(RAW, 1000);
ok(T && T.state === 'working' && T.cid === RAW.conversation_id && T.transcript === RAW.transcript_path && T.modelName === 'Gemini 4 Neon (High)' && T.ctx === 12.6 && T.queued === 1 && T.tasks === 2 && T.at === 1000, '认得的栏都在', T);
ok(!JSON.stringify(T).includes('someone@example.com') && !('email' in T), '邮箱不进 tap 文件', T);
ok(T.quota['gemini-5h'].left === 0.83 && T.quota['gemini-weekly'].left === 0.5 && !('bad key!' in T.quota), '额度：名字写法不对的那一栏丢掉', T.quota);
ok(A.slimTap({ ...RAW, conversation_id: '' }, 1).cid === null, '会话号为空（还没说第一句）= null', A.slimTap({ ...RAW, conversation_id: '' }, 1).cid);
ok(A.slimTap(null) === null && A.slimTap([1]) === null && A.slimTap('x') === null, '不是对象 = null');

console.log('\n[B] agyStatus：tap → 卡片状态');
const S = (o) => A.agyStatus({ at: 1, ...o });
ok(A.agyStatus(null) === null && A.agyStatus({}) === null, '没有 tap / 没有状态 = null（不上墙）');
ok(S({ state: 'working' }).status === 'busy' && S({ state: 'tool_use' }).status === 'busy' && S({ state: 'reviewing' }).status === 'busy', 'working / tool_use / reviewing = 在忙');
ok(S({ state: 'idle' }).status === 'idle' && S({ state: 'idle' }).busy === false && S({ state: 'initializing' }).status === 'idle' && S({ state: 'authenticating' }).status === 'idle', 'idle / initializing / authenticating = 闲着');
ok(S({ state: 'error' }).status === 'idle' && S({ state: 'error' }).halt && S({ state: 'error' }).halt.kind === 'error', 'error = 闲着带报错');
ok(S({ state: 'working', confirm: true }).status === 'waiting' && S({ state: 'idle', confirm: true }).status === 'waiting', '工具在等他点允许 = waiting（不管 agent_state）');
ok(S({ state: 'something-new' }).status === 'idle' && S({ state: 'something-new' }).halt === null, '没见过的状态名：当闲着、不报错');

console.log('\n[C] agyReject：只认他本人；不接的参数报错');
ok(/只能由他本人/.test(A.agyReject({}, false)), '不是他本人（没 Origin、不是手机）：拒');
ok(A.agyReject({}, true) === '', '他本人、什么都没带：过');
ok(A.agyReject({ model: '', effort: '', account: '', codeMode: false }, true) === '', '界面带的空值（""、false）不算带了');
for (const [k, v, re] of [['tier', 'light', /档位/], ['effort', 'high', /强度/], ['account', 'good', /账号/], ['brief', {}, /派活单/], ['auto', 'low', /auto/], ['codeMode', true, /Code Mode/]])
  ok(new RegExp(re).test(A.agyReject({ [k]: v }, true)), k + ' 给了就报错', A.agyReject({ [k]: v }, true));
ok(/写法不对/.test(A.agyReject({ model: 'a b' }, true)) && /写法不对/.test(A.agyReject({ model: 5 }, true)), '模型名写法不对：拒');
ok(/写法不对/.test(A.agyReject({ model: '-x' }, true)) && /写法不对/.test(A.agyReject({ model: '--settings' }, true)) && A.agyReject({ model: 'gemini-4.1-pro_x' }, true) === '', '模型名 - 开头（会被 agy 当成旗子）：拒；字母数字开头、带 . - _ 的过');
ok(/没有这个模型/.test(A.agyReject({ model: 'gpt-9' }, true, ['gemini-4-neon-high'])) && A.agyReject({ model: 'gemini-4-neon-high' }, true, ['gemini-4-neon-high']) === '', '有模型表：表里的过，表外的拒');
ok(A.agyReject({ model: 'gemini-4-neon-high' }, true, null) === '', '还没取到模型表：写法对就过（交给 agy 自己认）');
ok(/只能由他本人/.test(A.agyReject({ tier: 'light' }, false)), '不是他本人又带了档位：先报「只认他本人」');

console.log('\n[D] agyArgs / agySettings / shq');
ok(JSON.stringify(A.agyArgs({ bin: '/b/agy', settings: '/d/s.json' })) === JSON.stringify(['/b/agy', '--settings', '/d/s.json']), '空会话：只有 --settings');
ok(JSON.stringify(A.agyArgs({ bin: 'agy', model: 'm1', settings: 's', text: '做个事' })) === JSON.stringify(['agy', '--model', 'm1', '--settings', 's', '-i', '做个事']), '新任务：--model、--settings、-i <任务>');
ok(JSON.stringify(A.agyArgs({ bin: 'agy', settings: 's', cid: 'c-12345678' })) === JSON.stringify(['agy', '--conversation', 'c-12345678', '--settings', 's']), '接回：--conversation <会话号>');
const tricky = "/x/Application Support/it's $HOME `id`.json";
const echo = spawnSync('/bin/sh', ['-c', 'printf %s ' + A.shq(tricky)], { encoding: 'utf8' });
ok(echo.stdout === tricky, 'shq：空格、单引号、$、反引号经 sh -c 原样回来', echo.stdout);
const set = A.agySettings('/n/node', '/p/agy.mjs', '/d d/ccb-1.tap.json');
ok(set.statusLine && set.statusLine.type === 'command' && set.statusLine.command === "'/n/node' '/p/agy.mjs' 'tap' '/d d/ccb-1.tap.json'", '设置文件：只挂一个 statusLine 命令', set);

console.log('\n[E] parseAgyModels');
const M = A.parseAgyModels('gemini-4-neon-high\tGemini 4 Neon (High)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n\nnot a model line\ngemini-4-neon-high\tdup\n');
ok(M && JSON.stringify(M.ids) === JSON.stringify(['gemini-4-neon-high', 'claude-opus-5-5-high']) && M.labels['gemini-4-neon-high'] === 'Gemini 4 Neon (High)', '一行一个 id<Tab>名字；重复的、认不出的跳过', M);
ok(A.parseAgyModels('') === null && A.parseAgyModels('Error: not logged in') === null && A.parseAgyModels(null) === null, '一行都没认出 = null（当没取到）');
const M2 = A.parseAgyModels('--help\tHelp\n-x\tX\ngemini-4-neon-high\tGemini 4 Neon (High)\n');
ok(M2 && JSON.stringify(M2.ids) === '["gemini-4-neon-high"]', 'agy models 里 - 开头的行不当模型', M2);

console.log('\n[F] agyUserText / agyText / agyTs');
ok(A.agyUserText('<USER_REQUEST>\n帮我看看\n</USER_REQUEST>\n<ADDITIONAL_METADATA>cursor…</ADDITIONAL_METADATA>') === '帮我看看', '只取 <USER_REQUEST> 里面');
ok(A.agyUserText('  直接的话  ') === '直接的话' && A.agyUserText([{ text: 'a' }, 'b']) === 'a\nb' && A.agyUserText(null) === '', '没有标签原样；数组拼起来；别的 = 空');
ok(A.agyTs('2026-11-27T10:00:00Z') === '2026-11-27T10:00:00Z' && A.agyTs(1795553457508) === new Date(1795553457508).toISOString() && A.agyTs(1795553457) === new Date(1795553457000).toISOString(), '时间：ISO 原样、毫秒、秒');
ok(A.agyTs('不是时间') === null && A.agyTs(-1) === null && A.agyTs(undefined) === null, '认不出的时间 = null');
ok(A.agyTs(1795553457508000) === new Date(1795553457508).toISOString() && A.agyTs(1795553457508000000) === new Date(1795553457508).toISOString(), '时间：微秒、纳秒按量级换成毫秒');
let tsErr = null, tsOdd = null; try { tsOdd = [A.agyTs(1e300), A.agyTs(NaN), A.agyTs(Infinity), A.agyTs(0)]; } catch (e) { tsErr = e.message; }
ok(!tsErr && tsOdd.every((x) => x === null), '超出 Date 范围的数字、NaN、Infinity、0 = null，不抛 RangeError', tsErr || tsOdd);

console.log('\n[G] transcriptCandidates');
const CID = RAW.conversation_id;
const C = A.transcriptCandidates('/Users/Shared/x', CID, RAW.transcript_path);   // tap 给的路径在 /Users/Shared/x/.gemini 下：主目录要对上（FIX-1 #7）
ok(C[0] === RAW.transcript_path && C.includes('/Users/Shared/x/.gemini/antigravity-cli/brain/' + CID + '/.system_generated/logs/transcript.jsonl') && C.includes('/Users/Shared/x/.gemini/antigravity/brain/' + CID + '/.system_generated/logs/transcript.jsonl'), 'tap 给的路径优先，再拼两种目录写法', C);
ok(A.transcriptCandidates('/h', '', '/h/.gemini/antigravity/brain/.system_generated/logs/transcript.jsonl').length === 0, '没有会话号：一个都不认（tap 那时给的是拼漏了的路径）');
ok(!A.transcriptCandidates('/h', CID, '/h/.gemini/antigravity/brain/OTHER/x.jsonl').includes('/h/.gemini/antigravity/brain/OTHER/x.jsonl'), 'tap 的路径里没有这个会话号：不认');
ok(!A.transcriptCandidates('/h', CID, '/h/' + CID + '/../../etc/x.jsonl').some((x) => x.includes('..')) && A.transcriptCandidates('/h', '../x', null).length === 0, '带 .. 的路径、写法不对的会话号：不认');
ok(!A.transcriptCandidates('/h', CID, '/tmp/' + CID + '/transcript.jsonl').includes('/tmp/' + CID + '/transcript.jsonl') && !A.transcriptCandidates('/h', CID, '/h/.geminix/' + CID + '/t.jsonl').some((x) => x.startsWith('/h/.geminix')), 'tap 给的路径不在 ~/.gemini/ 下（带着会话号也不行）：不认，只用自己拼的');

console.log('\n[H] tap 命令（sh -c 真跑，路径带空格）');
const TD = fs.mkdtempSync(path.join(os.tmpdir(), 'agy tap '));
const tf = path.join(TD, 'sub dir', 'ccb-abc.tap.json');
const cmd = A.agySettings(process.execPath, path.join(HERE, '..', 'agy.mjs'), tf).statusLine.command;
const r1 = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(RAW), encoding: 'utf8' });
let got = null; try { got = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch {}
ok(r1.status === 0 && got && got.state === 'working' && got.cid === CID, '写出 tap 文件（目录不在就建）', { rc: r1.status, err: r1.stderr, got });
ok(got && !fs.readFileSync(tf, 'utf8').includes('someone@example.com'), 'tap 文件里没有邮箱');
ok(/Gemini 4 Neon \(High\)/.test(r1.stdout) && /5h 剩 83%/.test(r1.stdout) && /周剩 50%/.test(r1.stdout), '打印一行状态给 agy 显示', r1.stdout);
ok(fs.readdirSync(path.dirname(tf)).every((f) => !f.endsWith('.tmp')), '没留下临时文件', fs.readdirSync(path.dirname(tf)));
const before = fs.readFileSync(tf, 'utf8');
const r2 = spawnSync('/bin/sh', ['-c', cmd], { input: 'not json', encoding: 'utf8' });
ok(r2.status === 0 && r2.stdout === '' && fs.readFileSync(tf, 'utf8') === before, '坏输入：退出 0、什么都不打印、上一份 tap 不动', { rc: r2.status, out: r2.stdout });
const r3 = spawnSync(process.execPath, [path.join(HERE, '..', 'agy.mjs'), 'tap', path.join(TD, 'x.json')], { input: JSON.stringify(RAW), encoding: 'utf8' });
ok(r3.status === 0 && fs.existsSync(path.join(TD, 'x.json')), '直接用 node 跑也一样', r3.stderr);
const r4 = spawnSync(process.execPath, ['-e', "import('" + path.join(HERE, '..', 'agy.mjs') + "').then(() => console.log('imported'))", 'tap', path.join(TD, 'y.json')], { input: JSON.stringify(RAW), encoding: 'utf8' });
ok(r4.stdout.trim() === 'imported' && !fs.existsSync(path.join(TD, 'y.json')), '被别的模块 import 时不当成 tap 命令跑（server.mjs import 它）', r4.stdout + r4.stderr);
fs.rmSync(TD, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
