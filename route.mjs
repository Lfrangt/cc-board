/**
 * [INPUT]: 不依赖任何模块。调用方（server.mjs 的 /api/new）给 provider、model、effort、tier 四个值；带了派活单的，再给 brief、routeNew 的结果和请求另带的 prompt。
 * [OUTPUT]: 导出 TIERS（档位表）、TIER_NAMES、routeNew()；BRIEF_FIELDS（派活单七栏）、BRIEF_MARK、BRIEF_MAX、briefNew()、briefClash()。
 *           routeNew 返回 { ok: true, tier, model, effort, why } 或 { ok: false, error }；briefNew 返回 { ok: true, text } 或 { ok: false, error, missing, problems }；briefClash 返回 prompt 里顶格写栏名的那一行（最多 40 个字）或 null。
 * [POS]: 新窗口「用哪个模型、多大强度」的唯一决策点。server.mjs 在 /api/new 里先过它，再把结果交给 newSession。
 *        它不起进程、不读文件、不读 config，所以 test/route.test.mjs 可以直接断言。档位由开窗口的一方声明，这里不从任务文字里猜。
 *        briefNew（11/24 brief-v2 车，FIX-1、FIX-2 返修）：/api/new 带了 brief（ROUTING.md 第五节的七栏派活单）才过它：缺栏、空白、只写「无」、派给和 tier / model 对不上、
 *        太长（BRIEF_MAX）、请求另带的 prompt 里又写了一张（briefClash）都拒开；所有判断对输入长度都是线性的（FIX-1 M1）；
 *        齐了按固定版式拼成 prompt 的开头。派给只拿来核对，不拿来定档位（档位只认请求里的 tier / model）。端到端断言在 state.test.mjs 的 [7g-2]。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// ───────────── 档位表：模型和强度的唯一出处 ─────────────
// 开窗口的一方（比如 Fable 的总指挥窗口）只说「这活属于哪一档」，不再自己拼模型和强度；以后换模型只改这一张表。
// 11/15 定（三个选项里选了「三档都加一档」）：每一档的强度比「够用」高一档。
// 之前（11/15 下午，额度用光之后）是 heavy / standard 用 high、light 用 medium，护栏写的是「档位不给 xhigh / max」；现在护栏收到只剩 max：
// 档位最高给到 xhigh，max 要调用方显式传 effort，档位不替他选最贵的一档。省额度靠的是按难度把活派给便宜一档的模型，不靠压强度。
export const TIERS = {
  heavy:    { claude: { model: 'fable',  effort: 'xhigh' },  codex: { effort: 'high' },   use: '设计判断、算法难点、没有现成答案的调查、审修复本身' },
  standard: { claude: { model: 'opus',   effort: 'xhigh' },  codex: { effort: 'medium' }, use: '写代码、改界面、补测试、合入补丁、验收别人的交付、接手一条线' },
  light:    { claude: { model: 'sonnet', effort: 'high' },   codex: { effort: 'low' },    use: '读文件做汇总、盘点状态、照写死的步骤跑一遍并报结果、改文案' },
};
export const TIER_NAMES = Object.keys(TIERS);

const text = (x) => (typeof x === 'string' ? x.trim() : '');

// ───────────── 决定这个新窗口的模型和强度 ─────────────
// 优先级：调用方显式给的 model / effort > 档位给的 > 都没有（空串，启动时不带参数，沿用 settings.json 的默认）。
// 没声明档位 = 原样放行，界面「新任务」里选「默认」走的就是这条，行为和以前一样。
// 声明了不认识的档位 = 报错，不悄悄退回默认：调用方（一个 LLM）看到错误会改，悄悄退回会让它以为已经省了钱。
export function routeNew({ provider, model, effort, tier } = {}) {
  const pv = provider === 'codex' ? 'codex' : 'claude';
  const m = text(model), e = text(effort);
  if (tier === undefined || tier === null || tier === '') {
    return { ok: true, tier: null, model: m, effort: e, why: '没有声明档位：模型和强度照你传的，没传的沿用默认' };
  }
  const key = text(tier).toLowerCase();
  if (!Object.hasOwn(TIERS, key)) {
    const shown = typeof tier === 'string' ? tier : JSON.stringify(tier);
    return { ok: false, error: '档位只能是 ' + TIER_NAMES.map((k) => k + '（' + TIERS[k].use + '）').join(' / ') + '，收到的是 ' + String(shown).slice(0, 40) };
  }
  const t = TIERS[key][pv];
  const outModel = m || t.model || '';            // Codex 的档位只管强度：模型留给它自己的 config.toml
  const outEffort = e || t.effort;
  const given = [m && '模型', e && '强度'].filter(Boolean);
  return { ok: true, tier: key, model: outModel, effort: outEffort,
    why: key + ' 档（' + TIERS[key].use + '）' + (given.length ? '；' + given.join('和') + '按你传的' : '') };
}

// ───────────── 派活单（brief）：七栏都要有，齐了按固定版式拼进 prompt ─────────────
// 规格是作者自己那份多模型分工说明里「派活单（7 栏）」那一节（11/24 Khalil 11:20 批「/api/new 带 brief、缺栏就拒开」）。
// 栏名英文中文都认（to / 派给 …；英文不分大小写，下划线、横杠、结尾的冒号不算）；一栏只能写一遍。值要是一段文字，多行用换行连。
// 版式照规格的模板：栏名加冒号补到 12 个显示列，值从第 12 列起，续行缩进 12 个空格；最前面一行是 【派活单】+ 目标的第一行（封面上「你说的」只露一行，露出来的应当是它；按 .you 的一行截断推的，没在界面上看过）。
export const BRIEF_FIELDS = [
  { key: 'to', zh: '派给' }, { key: 'role', zh: '角色' }, { key: 'goal', zh: '目标' }, { key: 'context', zh: '背景' },
  { key: 'doneWhen', zh: '做完的标准' }, { key: 'doNot', zh: '不要做' }, { key: 'report', zh: '回报' },
];
export const BRIEF_MARK = '【派活单】';
const BRIEF_COL = 12;
const fieldName = (f) => f.zh + '（' + f.key + '）';
// 先看长度再跑正则（FIX-1 M1）：合法的栏名最长 9 个字（doneWhen:），超过 64 个字的一律不认（截到 64 再认会把「goal + 60 个空格 + xyz」认成 goal），
// 不让 /[：:]+$/ 去吃一长串冒号（那是平方的：4 万个冒号 0.5 秒）。报错里回显的是原来的键
const normKey = (k) => { const s = String(k); return s.length > 64 ? '\0' + s.slice(0, 64) : s.trim().replace(/[：:]+$/, '').replace(/[\s_-]+/g, '').toLowerCase(); };
const BRIEF_BY = new Map(BRIEF_FIELDS.flatMap((f) => [[normKey(f.key), f], [f.zh, f]]));
// 只写了「无」一类的算缺：规格第 1 条「确实没有就写「无」，再加半句为什么」。比的是去掉结尾标点、再剥掉一层括号或引号以后的整栏（FIX-1 S2：照抄规格的人会把「」一起写进来）
const BRIEF_NONE = /^(无|無|没有|暂无|略|空|待定|待补|同上|见上|不适用|不涉及|n[./]?a|none|null|nil|tbd|todo|-+|—+|…+|\?+|？+)$/i;
// 做完的标准整栏只是一句「做好」「测试通过」：规格第 2 条，要写对方自己能复核的
const BRIEF_VAGUE = /^(做好|做完|弄好|完成|搞定|测试通过|测试全过|测试都过|跑通|没问题|ok|done)$/i;
const BRIEF_HOLDER = /^<[^<>]*>$/;              // 还是模板里的 <…> 占位
// 去掉结尾的空白和标点：从尾往前一个字一个字看（FIX-1 M1：原来的 /[…]+$/ 遇到一长串「。」后面跟一个别的字是平方的，4 万个要 3.9 秒）
const SQZ = /[\s。．.，,；;！!]/u;
const squeeze = (t) => { let i = t.length; while (i > 0 && SQZ.test(t[i - 1])) i--; return t.slice(0, i); };
// 剥一层括号或引号（FIX-1 S2）：「无」（无）"无"【无】和 无 一样；剥完再去一次结尾标点（「无。」）
const PAIRS = { '（': '）', '(': ')', '「': '」', '『': '』', '【': '】', '"': '"', "'": "'", '“': '”', '‘': '’' };
const unwrap = (s) => (s.length > 1 && PAIRS[s[0]] === s[s.length - 1] ? squeeze(s.slice(1, -1).trim()) : s);
// 换行（FIX-1 S4）：\r\n、单个 \r、U+2028、U+2029、U+0085、\v、\f 都算一个换行
const BRIEF_NL = /\r\n?|[\u2028\u2029\u0085\v\f]/g;
// 看不见的字（FIX-1 S1）：格式控制字符 \p{Cf}（零宽、方向控制、BOM、tag 字符……）和两个看着是空白的字 U+3164、U+2800。判空、判「无」之前去掉。
// 拼进 prompt 的那份也去掉：判的和发出去的是同一份；方向控制能让一行字倒着显示，tag 字符能藏只给模型看的指令（suggest.mjs 对灰字也是去掉 / 整条不要）。代价：emoji 里的 ZWJ 被拆开（一家人变成三个人）
const BRIEF_INVIS = /[\p{Cf}\u3164\u2800]/gu;
// 派活单加请求另带的 prompt 最多多少字节（FIX-1 S7）。tmux 一条命令最多约 16.3 KB（3.7c 私有套接字实测：一个参数 16300 字节能开、16500 回 command too long），
// 同一条命令里别的固定开销约 1 KB（账号那层 zsh 479 字节、FOLDER_NOTE 400 字节、tmux 参数、Code Mode 的 env），再给附件清单留 1 KB 多。约 4600 个汉字
export const BRIEF_MAX = 14000;
// 派给里认的档位名和模型名（FIX-1 S6、S8）。先做 NFKC（全角字母、全角冒号变半角）再小写。
// 先认规格模板的写法 tier X / model Y：认到了就只核它们，写理由时顺口提到的别的档位、模型（「不要因为保险选 heavy」「审完交给 Sonnet 复核」）不算；两种都没有，再整段找词。
// 模板的分隔符认空白、冒号、等号、下划线、横杠、引号（FIX-2 R2：tier-light、tier="light"）；模型名前面可以带 claude-（model claude-sonnet-5-5）。
// 例外（FIX-2 R1）：紧跟在 tier X 后面的那对括号里的模型名照核。全局规矩的档位表就写成「heavy（fable + xhigh）」，抄过来改了档位、忘了改括号最常见；括号外面的照旧不核。
// 整段找词时档位名前后挨着字母、数字、下划线、横杠的不算（lightweight、highlight、heavy_lane、cc-board-wip-light-fix）；
// 模型名只看前面不挨着字母数字，后面紧跟数字的照认（Opus5.5、fable5、claude-opus-5-5）；Gemini 认带空格、横杠的写法（Gemini 4 Neon）和单写的 gemini、neon、carbon、hydrogen。
const TO_TIER_T = /(?<![a-z])tier[\s:=_"'-]*(heavy|standard|light)(?![a-z])/g;
const TO_MODEL_T = /(?<![a-z])model[\s:=_"'-]*(?:claude[\s_-]*)?(gemini[\s_-]*4[\s_-]*(?:neon|carbon|hydrogen)|gemini|neon|carbon|hydrogen|fable|opus|sonnet|haiku)(?![a-z])/g;
const TO_PAREN = /(?<![a-z])tier[\s:=_"'-]*(?:heavy|standard|light)(?![a-z])["']?\s*\(([^()]*)\)/g;   // 捕获括号里的字；NFKC 以后全角括号已是半角
const TO_TIER = /(?<![a-z0-9_-])(heavy|standard|light)(?![a-z0-9_-])/g;
const TO_MODEL = /(?<![a-z0-9])(gemini[\s_-]*4[\s_-]*(?:neon|carbon|hydrogen)|gemini|neon|carbon|hydrogen|fable|opus|sonnet|haiku)(?![a-z])/g;
const modelId = (w) => { const g = /(neon|carbon|hydrogen)$/.exec(w); return g ? 'gemini-4-' + g[1] : w; };   // Gemini 的几种写法都记成模型 id；档位名原样
const found = (re, s) => [...new Set([...s.matchAll(re)].map((m) => modelId(m[1])))];

// 派给写了档位或模型时，要和这个请求实际开出来的一样（rt 是 routeNew 的结果）。对不上就拒：
// 让 tier 赢，接手的窗口读到的派给是假的；让派给赢，就成了从文字里猜档位。派给一个档位、模型名都没写（比如写的是已有窗口的名字）不核。
// 强度不核（派给写 xhigh、请求另传 effort: low 照放）：档位已经带着强度，显式传的 effort 压过档位是 routeNew 的规矩；账号也不核。
function toMismatch(to, rt) {
  const out = [], tier = (rt && rt.tier) || null, model = String((rt && rt.model) || '').toLowerCase();
  const s = to.normalize('NFKC').toLowerCase();
  let tiers = found(TO_TIER_T, s), models = found(TO_MODEL_T, s), loose = false;
  for (const m of s.matchAll(TO_PAREN)) for (const x of found(TO_MODEL, m[1])) if (!models.includes(x)) models.push(x);   // FIX-2 R1
  if (!tiers.length && !models.length) { loose = true; tiers = found(TO_TIER, s); models = found(TO_MODEL, s); }   // 没有模板的写法：整段找词
  if (tiers.length && !(tiers.length === 1 && tiers[0] === tier)) {
    out.push('派给写的是 ' + tiers.join('、') + '，' + (tier ? '请求里的 tier 是 ' + tier : '请求里没有 tier') + '：两边要写成一样（开窗口只认请求里的 tier，派给是写给对方看的）');
  }
  const bad = models.filter((m) => !model.includes(m));
  if (bad.length) {
    out.push('派给写的是 ' + bad.join('、') + '，' + (model ? '开出来的模型是 ' + model : '请求里没有 model，tier 也带不出模型') + '：两边要写成一样');
  }
  if (loose && out.length) out[out.length - 1] += '，写成 tier X / model Y 就只核这两处';   // FIX-2 nit：整段找词会把「neon 灯那个页面」当成模型名，告诉对方怎么绕开；只加一次
  return out;
}

// 请求另带的 prompt 里又写了一张派活单（FIX-1 S5）：顶格的【派活单】，或顶格的栏名加冒号（中文栏名、英文键都算，英文不分大小写）。
// 第二张里的派给不经过上面的核对，两张写得还可能不一样；迁移期最容易这样（原来的脚本是把七栏手写在 prompt 里的）。只看行首：缩进的、句子中间提到的不算。
// 回认出来的那一行（最多 40 个字），没有回 null。briefNew 拿它拒；server 不另外调。
// 每一行先做 NFKC 再认（FIX-2 R3，和 toMismatch 一致）：全角字母「Ｔｏ：」、小冒号「﹕」、冒号前的全角空格都认；回的是原来那一行，不是 NFKC 以后的，好让对方搜得到。
// 冒号前的空白类里写了全角空格：NFKC 以后它已是半角空格，这里照返修单再写一次，单独去掉测不红。markdown 前缀（- 派给：、**派给**：、> 派给：）不算，见 CLAUDE.md。
const CLASH = /^(?:【派活单】|(?:派给|角色|目标|背景|做完的标准|不要做|回报|to|role|goal|context|done[ _-]?when|do[ _-]?not|report)[ \t\u3000]*[:：])/i;
export function briefClash(prompt) {
  if (typeof prompt !== 'string') return null;
  const line = prompt.replace(BRIEF_NL, '\n').replace(BRIEF_INVIS, '').split('\n').find((l) => CLASH.test(l.normalize('NFKC')));   // 贴进来的 prompt 最前面常带一个 BOM
  return line === undefined ? null : [...line].slice(0, 40).join('');
}

// prompt：请求里另带的 prompt（看它里面有没有又写一张派活单；算进长度上限）。不传当没有
export function briefNew(brief, rt, prompt = '') {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    return { ok: false, error: '派活单不对，没开窗口：brief 要是一个对象，七栏是 ' + BRIEF_FIELDS.map(fieldName).join('、'), missing: BRIEF_FIELDS.map((f) => f.key), problems: ['brief 不是对象'] };
  }
  const got = new Map(), problems = [], unknown = [];
  for (const k of Object.keys(brief)) {
    const f = BRIEF_BY.get(normKey(k));
    if (!f) { unknown.push(k); continue; }
    if (got.has(f.key)) { problems.push(f.zh + '写了两遍（' + got.get(f.key).k + ' 和 ' + k + ' 只留一个）'); continue; }
    got.set(f.key, { k, v: brief[k] });
  }
  if (unknown.length) {
    problems.push('不认识的栏 ' + unknown.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 30))).join('、') + (unknown.length > 5 ? ' 等 ' + unknown.length + ' 个' : '') + '（只认 ' + BRIEF_FIELDS.map(fieldName).join('、') + '）');
  }
  const blank = [], none = [], text = {};
  for (const f of BRIEF_FIELDS) {
    if (!got.has(f.key)) { blank.push(f.key); continue; }
    const v = got.get(f.key).v;
    if (typeof v !== 'string') { problems.push(f.zh + '要是一段文字（几行就用换行连起来），收到的是 ' + (v === null ? 'null' : Array.isArray(v) ? '数组' : typeof v)); continue; }
    // 换行归一、去掉看不见的字，每行去掉行尾空白（trimEnd 是线性的，FIX-1 M1），整栏去掉头尾空白；续行自己的缩进留着
    const t = v.replace(BRIEF_NL, '\n').replace(BRIEF_INVIS, '').split('\n').map((l) => l.trimEnd()).join('\n').trim();
    if (!t) { blank.push(f.key); continue; }
    const core = squeeze(t), bare = unwrap(core);
    if (!bare || BRIEF_NONE.test(bare)) none.push(f.key);
    else if (BRIEF_HOLDER.test(core)) problems.push(f.zh + '还是模板里的占位 ' + core.slice(0, 30) + '，没填');
    else if (f.key === 'doneWhen' && BRIEF_VAGUE.test(bare)) problems.push('做完的标准只写了「' + bare.slice(0, 10) + '」：要写对方自己能复核的，比如一条命令加期望结果，或一张能逐条核对的清单');
    else text[f.key] = t;
  }
  if (text.to) problems.push(...toMismatch(text.to, rt));
  const clash = briefClash(prompt);
  if (clash) problems.push('prompt 里又写了一张派活单，只留 brief（prompt 里顶格的这一行：' + clash + '）');
  const byKey = (k) => BRIEF_FIELDS.find((f) => f.key === k);
  const missing = BRIEF_FIELDS.map((f) => f.key).filter((k) => blank.includes(k) || none.includes(k));
  if (missing.length || problems.length) {
    const parts = [];
    if (blank.length) parts.push('缺 ' + blank.map((k) => fieldName(byKey(k))).join('、'));
    if (none.length) parts.push(none.map((k) => fieldName(byKey(k))).join('、') + '只写了「无」，也算缺：确实没有就写「无」，再加半句为什么');
    return { ok: false, error: (missing.length ? '派活单缺栏' : '派活单不对') + '，没开窗口：' + parts.concat(problems).join('；'), missing, problems };
  }
  const head = [...text.goal.split('\n')[0]];   // 按字符截，不按 UTF-16 单位（FIX-1 N1：不然可能切在 emoji 中间，留下半个代理项）
  const lines = [BRIEF_MARK + (head.length > 80 ? head.slice(0, 79).join('') + '…' : head.join(''))];
  for (const f of BRIEF_FIELDS) {
    const label = f.zh + '：' + ' '.repeat(Math.max(0, BRIEF_COL - 2 * (f.zh.length + 1)));
    const [first, ...rest] = text[f.key].split('\n');
    lines.push(label + first + rest.map((l) => '\n' + (l ? ' '.repeat(BRIEF_COL) + l : '')).join(''));
  }
  const out = lines.join('\n'), extra = typeof prompt === 'string' ? prompt.trim() : '';
  const bytes = Buffer.byteLength(out) + (extra ? 2 + Buffer.byteLength(extra) : 0);   // server 拼的是 派活单 + 空一行 + prompt
  if (bytes > BRIEF_MAX) {   // 点名最长的那一栏（或 prompt），叫它把长内容放进文件
    const [who, n] = BRIEF_FIELDS.map((f) => [f.zh, [...text[f.key]].length]).concat(extra ? [['prompt', [...extra].length]] : []).reduce((a, b) => (b[1] > a[1] ? b : a));
    const sp = who === 'prompt' ? ' ' : '';
    const msg = who + sp + '太长（' + n + ' 字），长内容放进文件，' + who + sp + '里写路径（派活单' + (extra ? '加 prompt ' : '') + '拼出来 ' + bytes + ' 字节，上限 ' + BRIEF_MAX + '：tmux 一条命令最多约 16 KB）';
    return { ok: false, error: '派活单太长，没开窗口：' + msg, missing: [], problems: [msg] };
  }
  return { ok: true, text: out };
}
