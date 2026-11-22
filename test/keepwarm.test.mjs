/**
 * [INPUT]: 依赖 ../autopilot.mjs 的保温部分和 ../suggest.mjs 的 promptEmpty（或命令行给的另一份目录，比如改坏版）。不起服务、不调模型。
 * [OUTPUT]: 逐项打印 ok / FAIL，退出码 0 = 全过。带 --mutants 时改跑反向对照：造若干个改坏的副本，每个都必须让本测试变红
 * [POS]: test/ 的「总管保温」纯函数测试（11/20 win-99；11/21 1b 审查后加 M1 M2 M5）。测：哪句话算保温（只认开头）；config 的 keepWarm 怎么认、写错就抛
 *        （"on": false 是关；不认识的键、on 不是布尔都抛）；kwPaneGate（只有一个窗格、不在 copy-mode、没有客户端刚按过键才打，认不出不打）；
 *        keepWarmDue 每一条（不是点名的不打、不在 tmux 不打、忙着 / 有选择框不打、卡片挂着提醒（停住了）不打、保温那一轮还没完不打、上次报错不打、上下文小不打、
 *        连着打满不打、刚用过缓存不打、离上次用缓存已过 idleMax 不打（打了也是整段重写）、输入框有字或认不出不打，其余才打）；
 *        promptEmpty：灰字算空、正常颜色的字算不空、选择框和没有输入框认不出（null）。
 *        服务接上它之后的断言在 state.test.mjs 的 [7s]（保温那一轮整轮不算、插在一轮中间不认）和 [7s-2]（真打字：只读、试验服务两道闸，copy-mode、分屏不打，打完的记账）。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/keepwarm.test.mjs [含 autopilot.mjs、suggest.mjs、limits.mjs 的目录]      node test/keepwarm.test.mjs --mutants
import path from 'node:path'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, '..'));

if (process.argv.includes('--mutants')) {
  const M = {
    'kw-anywhere':       ['autopilot.mjs', "export const isKeepWarm = (t) => String(t || '').trimStart().startsWith(KW_MARK);", "export const isKeepWarm = (t) => String(t || '').includes(KW_MARK);"],
    'no-target-check':   ['autopilot.mjs', "  if (!((cf.chief && ctx.chief && s.sid === ctx.chief) || (cf.sids || []).includes(s.sid))) return 'not-target';\n", ''],
    'shell-ok':          ['autopilot.mjs', "if (s.status !== 'idle' || s.ask) return 'not-idle';", "if (s.status === 'busy' || s.status === 'waiting') return 'not-idle';"],
    'no-ask-check':      ['autopilot.mjs', "if (s.status !== 'idle' || s.ask) return 'not-idle';", "if (s.status !== 'idle') return 'not-idle';"],
    'no-inkw':           ['autopilot.mjs', "  if (k.inKw) return 'in-kw';\n", ''],
    'no-kwerr':          ['autopilot.mjs', "  if (k.kwErr) return 'kw-error';\n", ''],
    'no-minctx':         ['autopilot.mjs', "  if (!(Number(s.ctx) >= cf.minCtx)) return 'small';\n", ''],
    'no-maxrun':         ['autopilot.mjs', "  if ((k.kwN || 0) >= cf.maxRun) return 'max-run';\n", ''],
    'no-expired':        ['autopilot.mjs', "  if (idle >= cf.idleMax) return 'expired';\n", ''],
    'lastAt-only':       ['autopilot.mjs', "const last = Math.max(Date.parse(k.lastAt) || 0, Date.parse(k.kwAt) || 0);", "const last = Date.parse(k.lastAt) || 0;"],
    'box-null-ok':       ['autopilot.mjs', "if (ctx.box !== true) return", "if (ctx.box === false) return"],
    'cfg-bad-ok':        ['autopilot.mjs', "  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('keepWarm 要是 true、false 或一个对象');\n", "  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...KW_DEF, sids: [] };\n"],
    'cfg-order-ok':      ['autopilot.mjs', "  if (out.idleMin >= out.idleMax) throw new Error('keepWarm.idleMin 要小于 idleMax');\n", ''],
    // 11/21 1b 审查 M1 M2 M5
    'cfg-on-ignored':    ['autopilot.mjs', "const out = { ...KW_DEF, on: v.on !== false, sids: [] };", "const out = { ...KW_DEF, on: true, sids: [] };"],
    'cfg-odd-ok':        ['autopilot.mjs', "  if (odd.length) throw new Error('keepWarm 里有不认识的键：' + odd.join('、'));\n", ''],
    'cfg-on-any':        ['autopilot.mjs', "  if ('on' in v && typeof v.on !== 'boolean') throw new Error('keepWarm.on 要是 true 或 false');\n", ''],
    'no-halted':         ['autopilot.mjs', "  if (s.alert || s.halt) return 'halted';", ''],
    'pane-mode-ok':      ['autopilot.mjs', "  if (panes[0] !== 0) return 'pane-mode';\n", ''],
    'split-ok':          ['autopilot.mjs', "  if (panes.length > 1) return 'split';\n", ''],
    'client-ignored':    ['autopilot.mjs', "  if (acts.some((a) => nowSec - a < quietSec)) return 'client-active';", ''],
    'client-future-ok':  ['autopilot.mjs', "acts.some((a) => nowSec - a < quietSec)", "acts.some((a) => a <= nowSec && nowSec - a < quietSec)"],
    'pane-unknown-ok':   ['autopilot.mjs', "    if (!m) return 'tmux-unknown';\n", "    if (!m) continue;\n"],
    'pane-none-ok':      ['autopilot.mjs', "  if (!panes.length || !Number.isFinite(nowSec)) return 'tmux-unknown';", "  if (!Number.isFinite(nowSec)) return 'tmux-unknown';"],
    'empty-ignores-dim': ['suggest.mjs', "    if (segs.some((s) => !s.dim && s.text.replace(BLANK, '').replace(UNSEEN, ''))) return false;\n  }\n  return true;", "    if (segs.some((s) => s.text.replace(BLANK, '').replace(UNSEEN, ''))) return false;\n  }\n  return true;"],
    'empty-no-confirm':  ['suggest.mjs', "  if (pl.some((l) => CONFIRM.test(l))) return null;\n  let bot = -1, top = -1;\n  for (let i = pl.length - 1; i >= 0 && top < 0; i--) if (BORDER.test(pl[i].trim())) { if (bot < 0) bot = i; else top = i; }\n  if (top < 0 || bot - top < 2 || !pl[top + 1].startsWith(PROMPT)) return null;\n  for", "  let bot = -1, top = -1;\n  for (let i = pl.length - 1; i >= 0 && top < 0; i--) if (BORDER.test(pl[i].trim())) { if (bot < 0) bot = i; else top = i; }\n  if (top < 0 || bot - top < 2 || !pl[top + 1].startsWith(PROMPT)) return null;\n  for"],
  };
  let red = 0, bad = [];
  for (const [name, [file, from, to]] of Object.entries(M)) {
    const dir = path.join(HERE, '.tmp', 'keepwarm-mutants', name); fs.mkdirSync(dir, { recursive: true });
    for (const f of ['autopilot.mjs', 'suggest.mjs', 'limits.mjs']) fs.copyFileSync(path.join(DIR, f), path.join(dir, f));
    const src = fs.readFileSync(path.join(dir, file), 'utf8'), n = src.split(from).length - 1;
    if (n !== 1) { bad.push(name + '（原文出现 ' + n + ' 次）'); continue; }
    fs.writeFileSync(path.join(dir, file), src.replace(from, to));
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, dir], { encoding: 'utf8' });
    if (r.status !== 0) red++; else bad.push(name + '（没变红）');
  }
  fs.rmSync(path.join(HERE, '.tmp', 'keepwarm-mutants'), { recursive: true, force: true });
  console.log(`改坏版 ${Object.keys(M).length} 个：变红 ${red} 个${bad.length ? '；有问题：' + bad.join('、') : ''}`);
  process.exit(bad.length ? 1 : 0);
}

const A = await import(path.join(DIR, 'autopilot.mjs')), G = await import(path.join(DIR, 'suggest.mjs'));
let pass = 0, fail = 0;
const ok = (c, name, got) => { if (c) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  → ' + got : '')); } };
const throws = (f) => { try { f(); return false; } catch { return true; } };

// ── 哪句话算保温 ──
ok(A.KW_TEXT.startsWith(A.KW_MARK) && A.isKeepWarm(A.KW_TEXT) && A.isKeepWarm('  \n' + A.KW_TEXT), '保温那句以 KW_MARK 开头，前面有空白也认');
ok(!A.isKeepWarm('他说「' + A.KW_MARK + '」是什么') && !A.isKeepWarm('') && !A.isKeepWarm(null), '只认开头：话里提到这个词（讲规矩、转述）不算');
ok(/不是 Khalil 本人/.test(A.KW_TEXT), 'KW_TEXT 带「不是 Khalil 本人」：wake-gate 的 DISPATCH 认得出，不会刷新「他在不在」');
ok(!A.isAutoPrompt(A.KW_TEXT) && !A.isKeepWarm(A.AUTO_TEXT), '保温和自动续跑是两种记号，互相不认');

// ── config 的 keepWarm ──
ok(A.parseKeepWarm().on === false && A.parseKeepWarm(false).on === false, '不写 / false = 关');
const on = A.parseKeepWarm(true);
ok(on.on && on.idleMin === 50 && on.idleMax === 57 && on.minCtx === 100000 && on.maxRun === 4 && on.chief === true && on.sids.length === 0, 'true = 默认值打开（空闲 50–57 分、上下文 ≥10 万、连续 ≤4 次、只给总管）', JSON.stringify(on));
const SID = 'ca2aa2c7-9623-4a23-9791-e51359de6f9f';
const cus = A.parseKeepWarm({ idleMin: 1, idleMax: 6, minCtx: 1000, maxRun: 2, chief: false, sids: [SID] });
ok(cus.on && cus.idleMin === 1 && cus.idleMax === 6 && cus.minCtx === 1000 && cus.maxRun === 2 && cus.chief === false && cus.sids[0] === SID, '对象 = 打开并改其中几项（测试窗口那份）', JSON.stringify(cus));
ok(['yes', 1, [], null].every((v) => throws(() => A.parseKeepWarm(v))), '不是 true / false / 对象 → 抛（服务按关处理）');
ok(throws(() => A.parseKeepWarm({ idleMin: 0 })) && throws(() => A.parseKeepWarm({ idleMax: 60 })) && throws(() => A.parseKeepWarm({ maxRun: 2.5 })) && throws(() => A.parseKeepWarm({ minCtx: -1 })), '数写错（idleMin 0、idleMax 60 超过缓存寿命、maxRun 不是整数、minCtx 负数）→ 抛');
ok(throws(() => A.parseKeepWarm({ idleMin: 57, idleMax: 50 })) && throws(() => A.parseKeepWarm({ idleMin: 50, idleMax: 50 })), 'idleMin 不小于 idleMax → 抛（不然一次都打不出去，看起来开着其实没用）');
ok(throws(() => A.parseKeepWarm({ chief: 'yes' })) && throws(() => A.parseKeepWarm({ sids: ['win-4c'] })) && throws(() => A.parseKeepWarm({ sids: SID })), 'chief 不是布尔、sids 不是会话号的列表 → 抛');
// 11/21 1b 审查 M2：原来对象一律当开、不认识的键一声不响地吞掉，{"on": false} 反而把保温打开了
ok(A.parseKeepWarm({ on: false }).on === false && A.parseKeepWarm({ on: false, maxRun: 2, sids: [SID] }).on === false && A.parseKeepWarm({ on: true }).on === true && A.parseKeepWarm({}).on === true, '"on": false 是关（带着别的项也是关）；"on": true 和不写 on 是开');
ok(throws(() => A.parseKeepWarm({ enabled: false })) && throws(() => A.parseKeepWarm({ idlemin: 5 })) && throws(() => A.parseKeepWarm({ on: false, bogus: 1 })), '不认识的键（别处抄来的 enabled、拼错的 idlemin、关着也一样）→ 抛，不悄悄吞掉');
ok(throws(() => A.parseKeepWarm({ on: 'no' })) && throws(() => A.parseKeepWarm({ on: 0 })) && throws(() => A.parseKeepWarm({ on: null })), 'on 不是 true / false（"no"、0、null）→ 抛');

// ── keepWarmDue：每一条 ──
const NOW = Date.parse('2026-11-21T07:00:00Z'), CHIEF = '88021609-1264-4b5c-9f9d-0bdd3e2ec6f5';
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const sess = (o = {}) => ({ sid: CHIEF, channel: 'tmux', provider: 'claude', status: 'idle', ask: null, ctx: 145249, ...o });
const kst = (o = {}) => ({ lastAt: ago(52), kwAt: null, kwN: 0, kwErr: false, inKw: false, ...o });
const due = (s, k, cf = on, box = true, now = NOW) => A.keepWarmDue(s, k, cf, { now, chief: CHIEF, box });
ok(due(sess(), kst()) === null, '总管、tmux、空闲 52 分、上下文 14.5 万、输入框空 → 打');
ok(due(sess(), kst(), A.parseKeepWarm()) === 'off', 'keepWarm 关着 → 不打');
ok(due(sess({ sid: SID }), kst()) === 'not-target' && due(sess({ sid: SID }), kst({ lastAt: ago(3) }), cus) === null && due(sess(), kst({ lastAt: ago(3) }), cus) === 'not-target', '只打点名的：总管（chief: true）或 sids 里的；chief: false 时总管也不打');
ok(A.keepWarmDue(sess(), kst(), on, { now: NOW, chief: null, box: true }) === 'not-target', '认不出总管是谁（state.json 读不到）→ 不打');
ok(due(sess({ channel: 'ghostty' }), kst()) === 'not-tmux' && due(sess({ provider: 'codex' }), kst()) === 'not-tmux', '不在总控台的 tmux 里、或不是 Claude → 不打');
ok(['busy', 'shell', 'waiting'].every((st) => due(sess({ status: st }), kst()) === 'not-idle'), '忙着、后台命令还在跑、等你选 → 不打');
ok(due(sess({ ask: { id: 'x', name: 'AskUserQuestion' } }), kst()) === 'not-idle', '弹着选择框 → 不打（打字会替他乱选）');
ok(due(sess({ halt: { kind: 'limit', text: '额度用完', at: ago(52) } }), kst()) === 'halted' && due(sess({ alert: { kind: 'flagged', key: 'flagged@x' } }), kst()) === 'halted' && due(sess({ halt: null, alert: null }), kst()) === null,
  '卡片挂着提醒（额度用完、被安全检查拦住）→ 不打：被拦住的窗口该按两下 Esc 改上一条，不在后面再插一轮（11/21 1b 审查 M5）');
ok(due(sess(), kst({ inKw: true })) === 'in-kw', '上一次保温那一轮还没完 → 不打');
ok(due(sess(), kst({ kwErr: true })) === 'kw-error', '上一次保温报错了（额度用完、登录过期）→ 不打，等有人说话');
ok(due(sess({ ctx: 86000 }), kst()) === 'small' && due(sess({ ctx: null }), kst()) === 'small' && due(sess({ ctx: 100000 }), kst()) === null, '上下文小于 10 万（刚压缩完 8.6 万）或读不到 → 不打；正好 10 万 → 打');
ok(due(sess(), kst({ kwN: 4, kwAt: ago(52), lastAt: ago(300) })) === 'max-run' && due(sess(), kst({ kwN: 3, kwAt: ago(52), lastAt: ago(250) })) === null, '连着打满 4 次（约 4.5 小时没人说话，多半是过夜）→ 不打，让它过期；第 4 次照打');
ok(due(sess(), kst({ lastAt: ago(30) })) === 'fresh' && due(sess(), kst({ lastAt: ago(49.9) })) === 'fresh' && due(sess(), kst({ lastAt: ago(50) })) === null, '离上次用缓存不到 50 分 → 不打（还新）；正好 50 分 → 打');
ok(due(sess(), kst({ lastAt: ago(57) })) === 'expired' && due(sess(), kst({ lastAt: ago(130) })) === 'expired', '已过 57 分（缓存 1 小时过期，打了也是整段重写）→ 不打');
ok(due(sess(), kst({ lastAt: ago(110), kwAt: ago(52), kwN: 1 })) === null && due(sess(), kst({ lastAt: ago(110), kwAt: ago(20), kwN: 1 })) === 'fresh', '上一次保温也算用过缓存：从保温那一刻起重新计时');
ok(due(sess(), kst({ lastAt: null, kwAt: null })) === 'no-time' && due(sess(), kst({ lastAt: 'garbage' })) === 'no-time', '读不出时间 → 不打');
ok(due(sess(), kst(), on, false) === 'typed' && due(sess(), kst(), on, null) === 'no-box', '输入框里有字（他在打）→ 不打；认不出输入框 → 不打');

// ── kwPaneGate：他是不是正对着这个窗口（11/21 1b 审查 M1）──
const T0 = 1795000000, gate = (out) => A.kwPaneGate(out, T0);
ok(A.KW_QUIET_S >= 120, '客户端安静多久才算没在用：不少于 120 秒（1b 的建议）', A.KW_QUIET_S);
ok(gate('P 0') === null && gate('P 0\n') === null, '一个窗格、不在模式里、没有客户端连着 → 可以打');
ok(gate('P 1') === 'pane-mode', '窗格在 copy-mode（他在 tmux 里往上翻着看）→ 不打：粘贴进了输入框、Enter 被吃掉，那句会留在他的输入框里');
ok(gate('P 0\nP 0') === 'split' && gate('P 1\nP 0') === 'split', '会话里不止一个窗格（分了屏或开了第二个窗口）→ 不打，不去猜哪个是 claude');
ok(gate('P 0\nC ' + (T0 - 300)) === null && gate('P 0\nC ' + (T0 - 120)) === null, '连着的客户端 5 分钟、正好 120 秒没按键 → 可以打（窗口一直开在 Ghostty 里也照样保温）');
ok(gate('P 0\nC ' + (T0 - 10)) === 'client-active' && gate('P 0\nC ' + (T0 - 300) + '\nC ' + (T0 - 119)) === 'client-active', '有一个客户端 120 秒内按过键 → 不打（另一个客户端闲着也不行）');
ok(gate('P 0\nC ' + (T0 + 30)) === 'client-active', '客户端的时刻比这里的钟还晚（钟对不上）→ 当成刚按过，不打');
ok(gate('') === 'tmux-unknown' && gate('C ' + (T0 - 300)) === 'tmux-unknown' && gate('P 0\nno server running') === 'tmux-unknown' && gate('P x') === 'tmux-unknown' && A.kwPaneGate('P 0', NaN) === 'tmux-unknown', '一行认不出、没有窗格那一行、钟读不出 → 不打');

// ── promptEmpty：输入框是不是空的（照真屏幕的样子造，不带真内容）──
const W = '─'.repeat(40), DIM = '\x1b[2m', RST = '\x1b[0m', FG = '\x1b[39m';
const screen = (line, { above = '某段回复', confirm = false } = {}) => [above, '', W, line, W, '  friend · 7d 32%', confirm ? '  Enter to confirm · Esc to cancel' : '  ⏵⏵ bypass permissions on'].join('\n');
ok(G.promptEmpty(screen(FG + '❯ ' + DIM + '这里是一句灰字建议' + RST)) === true, '只有灰字（Claude Code 的建议）→ 空（照总管窗口真屏幕的排版造的）');
ok(G.promptEmpty(screen('❯ ')) === true && G.promptEmpty(screen('❯')) === true, '什么都没有 → 空');
ok(G.promptEmpty(screen('❯ abc 测试草稿')) === false, '正常颜色的字 → 不空（输入框里打了字的样子）');
ok(G.promptEmpty(screen(FG + '❯ ' + DIM + '灰字' + RST + ' 他接着打的')) === false, '灰字后面又有正常颜色的字 → 不空');
ok(G.promptEmpty(['x', W, '❯ ' + DIM + '第一行灰字' + RST, '  第二行他打的', W, ''].join('\n')) === false, '折到第二行的正常颜色的字 → 不空');
ok(G.promptEmpty(screen('❯ ', { confirm: true })) === null, '屏幕上有选择框的提示行 → 认不出（不打）');
ok(G.promptEmpty('没有输入框的一屏\n只是日志') === null && G.promptEmpty('') === null && G.promptEmpty(null) === null, '没有两条边框夹住的 ❯ 行 → 认不出');

console.log('\n' + pass + ' 项过，' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
