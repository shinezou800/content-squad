import type { Squad } from './types';
import { fetchSnapshot, poolEntries } from '../data/market';
import { complete } from '../pipeline/llm';
import { checkDraft } from '../pipeline/checks';
const squad: Squad = {
  id: 'zangu-shouxi',
  name: '攒股收息内容线',
  description: '用数据打底，以记录为先。让每一次表达，都有据可循。',
  pipeline: ['data', 'draft', 'check'],
  roles: [
    {
      id: 'data',
      name: '小数',
      title: '数据研究员',
      async run(ctx) {
        const entries = poolEntries(ctx.settings.pool);
        const snapshot = await fetchSnapshot(entries.map((entry) => entry.code));
        ctx.snapshot = snapshot.map((stock) => ({
          ...stock,
          category: entries.find((entry) => entry.code === stock.code)!.category,
        }));
        return complete(
          ctx.settings,
          '你是小数。根据选题，从快照选择相关事实写简短数据简报。只能使用快照数字，不得猜测、补全或使用记忆数据。明确报告期、分红口径和来源。',
          JSON.stringify({ topic: ctx.topic, snapshot: ctx.snapshot }),
        );
      },
    },
    {
      id: 'draft',
      name: '小稿',
      title: '内容写作员',
      run(ctx) {
        return complete(
          ctx.settings,
          '你是小稿。第一人称记录口吻；开篇注明模拟盘记录；不用建议、应该、补、买等指向读者的词；观察写“观察池记录”；算账写“情景演算、不是买入计划、更不推荐跟风”；开篇⚠️前置声明 + 结尾双披露（持仓披露 + 非投资建议/数据来源披露）。开头100字内有模拟盘记录，最后400字内有“持仓披露：”及“非投资建议。数据来源：”。快照 category 为持仓时才可披露为持仓，为观察池时仅作观察池记录；分类由主理人提供，不得推断股数、成本或仓位。持仓未知时写未提供，不得虚构。只能使用快照中的数字和事实，不用序号或额外数字。缺失字段不得当作零或补全；港元和人民币元必须保留各自币种，不得混用或自行换汇。输出可直接发表的正文。',
          JSON.stringify({ topic: ctx.topic, snapshot: ctx.snapshot, brief: ctx.outputs.data }),
        );
      },
    },
    {
      id: 'check',
      name: '小核',
      title: '事实核对员',
      async run(ctx) {
        const result = await complete(
          ctx.settings,
          '逐项核对正文每个数字和事实与快照是否一致。输出JSON列表，每项字段为原文、问题、数据源值。无问题输出[]。不可把快照没有的数据当作事实。',
          JSON.stringify({ draft: ctx.outputs.draft, snapshot: ctx.snapshot }),
        );
        return `【规则核对】\n${JSON.stringify(checkDraft(ctx.outputs.draft, ctx.snapshot), null, 2)}\n\n【模型事实核对】\n${result}`;
      },
    },
  ],
  template: (ctx) =>
    `${ctx.outputs.draft}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n${ctx.outputs.check}`,
};
export const registry: Record<string, Squad> = { [squad.id]: squad };
