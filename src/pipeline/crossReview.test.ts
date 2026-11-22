import { expect, it } from 'vitest';
import type { Snapshot } from '../data/market';
import { applyCrossReview, crossConflicts, crossPairs, parseCrossReview } from './crossReview';

const snapshot: Snapshot = [
  {
    code: '00883',
    name: '中海油',
    fields: [
      { label: '现价', value: 21.7, unit: '港元', source: '腾讯行情', fetchedAt: '' },
      { label: '股息率', value: 6.87, unit: '%', source: '计算', fetchedAt: '' },
    ],
  },
  {
    code: '601398',
    name: '工商银行',
    fields: [{ label: '现价', value: 7.12, unit: '元', source: '腾讯行情', fetchedAt: '' }],
  },
];
const wrap = (text: string) =>
  `⚠️ 模拟盘记录。${text}\n持仓披露：观察池记录。\n非投资建议。数据来源：腾讯行情。`;
const base = { snapshot, reviewerTitle: '甲', targetTitle: '乙' };
const section = (output: string, name: string) =>
  JSON.parse(output.split(`【${name}】\n`)[1].split('\n\n【')[0]);

it('两团时互相审，三团时环形审，每份草稿由另一团审一次', () => {
  expect(crossPairs(['a', 'b'])).toEqual([
    { reviewer: 'b', target: 'a' },
    { reviewer: 'a', target: 'b' },
  ]);
  expect(crossPairs(['a', 'b', 'c'])).toEqual([
    { reviewer: 'b', target: 'a' },
    { reviewer: 'c', target: 'b' },
    { reviewer: 'a', target: 'c' },
  ]);
});

it('规则互审抓到同一股票数字不同，附对方原文与快照值', () => {
  const flags = crossConflicts(
    wrap('中海油现价22.5港元，股息率6.87%。'),
    wrap('我记录的中海油现价为21.7港元，股息率6.87%。'),
    snapshot,
    '甲',
  );
  expect(flags).toEqual([
    {
      原文: '中海油现价22.5港元，股息率6.87%。',
      问题: '与「甲」段矛盾：同一股票（中海油）现价数字不同',
      依据: '「甲」段写作：我记录的中海油现价为21.7港元，股息率6.87%。；快照：现价=21.7港元',
    },
  ]);
});

it('同段重复写对的数字不掩盖另一处写错的数字', () => {
  const flags = crossConflicts(
    wrap('中海油现价21.7港元。复盘时中海油现价22.5港元。'),
    wrap('中海油现价21.7港元。'),
    snapshot,
    '甲',
  );
  expect(flags.map((f) => f.原文)).toEqual(['复盘时中海油现价22.5港元。']);
});

it('万与亿混用时按各自精度比对，不放宽容差', () => {
  const reviewer = wrap('中海油营收15000万元。');
  expect(crossConflicts(wrap('中海油营收1.23亿元。'), reviewer, snapshot, '甲')).toHaveLength(1);
  expect(crossConflicts(wrap('中海油营收1.5亿元。'), reviewer, snapshot, '甲')).toEqual([]);
  expect(crossConflicts(wrap('中海油营收2亿元。'), reviewer, snapshot, '甲')).toEqual([]);
  expect(
    crossConflicts(wrap('中海油现价21.8港元。'), wrap('中海油现价21.7港元。'), snapshot, '甲'),
  ).toHaveLength(1);
});

it('一致、四舍五入、不同股票、不同币种或情景演算不算矛盾', () => {
  const reviewer = wrap('中海油现价21.7港元。工商银行现价7.12元。');
  for (const target of [
    wrap('中海油现价21.70港元。'),
    wrap('中海油现价22港元。'),
    wrap('工商银行现价7.1元。'),
    wrap('工商银行现价7.5港元，中海油的股息率6.87%。'),
    wrap('若中海油现价回升至25港元，情景演算。'),
    wrap('中海油的记录还没有数字。'),
  ])
    expect(crossConflicts(target, reviewer, snapshot, '甲')).toEqual([]);
  for (const target of ['工商银行现价7.5元。', '工商银行现价：7.5元。', '工商银行现价 7.5元。'])
    expect(crossConflicts(wrap(target), reviewer, snapshot, '甲').map((f) => f.问题)).toEqual([
      '与「甲」段矛盾：同一股票（工商银行）现价数字不同',
    ]);
});

it('真实错误按模型改为直接改进被审段，记录段落、改动与审出团', () => {
  const draft = wrap('中海油现价22.5港元。');
  const result = applyCrossReview({
    ...base,
    draft,
    reviewerDraft: wrap('中海油现价21.7港元。'),
    modelResult: JSON.stringify([
      { 原文: '现价22.5港元', 问题: '与快照不符', 依据: '快照现价21.7港元', 改为: '现价21.7港元' },
    ]),
  });
  expect(result.draft).toBe(wrap('中海油现价21.7港元。'));
  expect(section(result.output, '规则核对')).toHaveLength(1);
  expect(section(result.output, '已改进')).toEqual([
    { 段落: '乙', 审出: '甲', 原文: '现价22.5港元', 改为: '现价21.7港元', 问题: '与快照不符' },
  ]);
  expect(section(result.output, '未改 · 双方保留')).toEqual([]);
});

it('结论冲突不给改为时双方保留并标明冲突，草稿不删', () => {
  const draft = wrap('中海油现价22.5港元，我继续观察。');
  const result = applyCrossReview({
    ...base,
    draft,
    reviewerDraft: wrap('中海油现价21.7港元，我暂停观察。'),
    modelResult:
      '```json\n[{"原文":"我继续观察","问题":"与甲段结论相反","依据":"甲段写暂停观察"}]\n```',
  });
  expect(result.draft).toBe(draft);
  expect(section(result.output, '未改 · 双方保留')).toEqual([
    { 标记: '冲突', 原文: '我继续观察', 问题: '与甲段结论相反', 依据: '甲段写暂停观察' },
    expect.objectContaining({ 标记: '冲突', 原文: '中海油现价22.5港元，我继续观察。' }),
  ]);
});

it('改动会破坏披露、引入禁词、引入快照外数字或原文找不到时不改，说明原因', () => {
  const draft = wrap('中海油现价21.7港元。中海油现价21.7港元。');
  const cases = [
    ['持仓披露：观察池记录。', '观察池记录。', '改后会破坏开篇声明、结尾披露或用词规则'],
    [
      '中海油现价21.7港元。中海油',
      '中海油现价21.7港元，建议关注。中海油',
      '改后会破坏开篇声明、结尾披露或用词规则',
    ],
    ['⚠️ 模拟盘记录。', '⚠️ 模拟盘记录，现价99港元。', '改后出现快照外数字'],
    ['中海油现价21.7港元。中海油', '中海油现价21.7港元，市值88港元。中海油', '改后出现快照外数字'],
    ['中海油现价21.7港元。', '中海油现价21.7港元。', undefined],
    ['中海油现价21.7港元', '中海油现价21.7港元整', '原文在被审草稿中未找到或不唯一'],
    ['不存在的原文', '新文字', '原文在被审草稿中未找到或不唯一'],
  ] as const;
  for (const [原文, 改为, reason] of cases) {
    const result = applyCrossReview({
      ...base,
      draft,
      reviewerDraft: draft,
      modelResult: JSON.stringify([{ 原文, 问题: '问题', 依据: '依据', 改为 }]),
    });
    expect(result.draft).toBe(draft);
    expect(section(result.output, '已改进')).toEqual([]);
    expect(section(result.output, '未改 · 双方保留')[0].未改原因).toBe(reason);
  }
});

it('把一个快照外数字换成另一个快照外数字不算改进', () => {
  const draft = wrap('中海油现价22.5港元。');
  const result = applyCrossReview({
    ...base,
    draft,
    reviewerDraft: wrap('中海油现价21.7港元。'),
    modelResult: JSON.stringify([
      { 原文: '现价22.5港元', 问题: '与快照不符', 依据: '快照', 改为: '现价23.4港元' },
    ]),
  });
  expect(result.draft).toBe(draft);
  expect(section(result.output, '已改进')).toEqual([]);
  expect(section(result.output, '未改 · 双方保留')[0].未改原因).toBe('改后出现快照外数字');
});

it('模型结果不是 JSON 列表时原样记录、不改动并提示人工阅读', () => {
  const draft = wrap('中海油现价21.7港元。');
  const result = applyCrossReview({
    ...base,
    draft,
    reviewerDraft: draft,
    modelResult: '看起来没问题',
  });
  expect(result.draft).toBe(draft);
  expect(result.output).toContain('【模型互审】\n看起来没问题');
  expect(section(result.output, '未改 · 双方保留')[0].问题).toContain('不是 JSON 列表');
  expect(parseCrossReview('{"原文":"a"}')).toBeUndefined();
  expect(parseCrossReview('[{"原文":"a","问题":"b","数据源值":"c"},1]')).toEqual([
    { 原文: 'a', 问题: 'b', 依据: 'c' },
  ]);
});
