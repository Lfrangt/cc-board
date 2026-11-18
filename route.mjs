/**
 * [INPUT]: 不依赖任何模块。调用方（server.mjs 的 /api/new）给 provider、model、effort、tier 四个值。
 * [OUTPUT]: 导出 TIERS（档位表）、TIER_NAMES、routeNew()。routeNew 返回 { ok: true, tier, model, effort, why } 或 { ok: false, error }。
 * [POS]: 新窗口「用哪个模型、多大强度」的唯一决策点。server.mjs 在 /api/new 里先过它，再把结果交给 newSession。
 *        它不起进程、不读文件、不读 config，所以 test/route.test.mjs 可以直接断言。档位由开窗口的一方声明，这里不从任务文字里猜。
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
