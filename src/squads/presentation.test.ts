import { expect, it } from 'vitest';
import { isCheckStep, pipelineCards, squadName, stepPresentation } from './presentation';

it('旧单团角色保持名称、顺序及成稿卡片', () => {
  const cards = pipelineCards('zangu-shouxi');
  expect(cards.map((card) => card.id)).toEqual(['data', 'draft', 'check', 'final']);
  expect(cards.map((card) => card.name)).toEqual(['小数', '小稿', '小核', '成稿']);
  expect(cards.map((card) => card.title)).toEqual([
    '数据研究员',
    '内容写作员',
    '事实核对员',
    '由你拍板',
  ]);
  expect(
    pipelineCards(
      'zangu-shouxi',
      ['data', 'draft', 'check'].map((roleId) => ({ roleId })),
    ),
  ).toEqual(cards);
});
it('中团七步名称与顺序正确，历史步骤使用同一标签', () => {
  const cards = pipelineCards('mid-zangu-ai');
  expect(cards.map((card) => card.name)).toEqual([
    '攒股收息 · 小数',
    '攒股收息 · 小稿',
    '攒股收息 · 小核',
    'AI手记 · 小数',
    'AI手记 · 小稿',
    'AI手记 · 小核',
    '小核 · 合并复核',
  ]);
  expect(cards.at(-1)?.id).toBe('merge:check');
  expect(
    pipelineCards(
      'mid-zangu-ai',
      cards.map((card) => ({ roleId: card.id })),
    ),
  ).toEqual(cards);
  expect(squadName('mid-zangu-ai')).toBe('攒股收息 × AI手记');
  expect(squadName('zangu-shouxi')).toBe('攒股收息内容线');
});
it.each(['check', 'zangu-shouxi:check', 'ai-shouji:check', 'merge:check', 'old:check'])(
  '所有核对步骤使用默认展开的复核样式：%s',
  (id) => expect(isCheckStep(id)).toBe(true),
);
it.each(['data', 'draft', 'final', 'ai-shouji:draft', 'checklist', ''])(
  '非核对步骤不默认展开：%s',
  (id) => expect(isCheckStep(id)).toBe(false),
);
it.each(['removed-squad', 'constructor', '__proto__', ''])('未知历史内容线安全回退：%s', (id) => {
  expect(squadName(id)).toBe('未知内容线');
  expect(pipelineCards(id).map((card) => card.id)).toEqual(['data', 'draft', 'check', 'final']);
  expect(pipelineCards(id, [{ roleId: 'retired:step' }])[0].name).toBe('retired:step');
  expect(stepPresentation('retired')).toMatchObject({ name: 'retired', title: '历史步骤' });
  expect(pipelineCards(id, [])).toHaveLength(1);
});
