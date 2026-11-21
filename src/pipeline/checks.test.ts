import { describe, expect, it } from 'vitest';
import { checkDraft } from './checks';
import type { Snapshot } from '../data/market';
const snapshot: Snapshot = [
  {
    code: '601088',
    name: '中国神华',
    fields: [
      { label: '现价', value: 52, source: '腾讯', fetchedAt: '今天' },
      { label: '收入', value: 296031000000, unit: '元', source: '东方财富', fetchedAt: '今天' },
      { label: '股息率', value: 3.8653846, source: '东方财富', fetchedAt: '今天' },
    ],
  },
];
const wrap = (text: string) =>
  `⚠️ 模拟盘记录。${text}\n持仓披露：未提供。\n非投资建议。数据来源：腾讯行情、东方财富。`;
describe('确定性核对', () => {
  it.each(['30元-40元', '30-40', '30%-40%', '30倍-40倍'])('范围连接符不作为负号：%s', (range) => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [30, 40].map((value) => ({
          label: '数值',
          value,
          source: '腾讯',
          fetchedAt: '今天',
        })),
      },
    ];
    expect(checkDraft(wrap(range), data)).toEqual([]);
    const rangeData: Snapshot = [
      { ...data[0], fields: [{ label: '区间', value: range, source: '腾讯', fetchedAt: '今天' }] },
    ];
    expect(checkDraft(wrap('30元、40元'), rangeData)).toEqual([]);
    expect(checkDraft(wrap('-40元'), rangeData).some((f) => f.原文 === '-40')).toBe(true);
  });
  it.each([-1.23, '-1.23%'])('保留快照和正文的负号：%s', (value) => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '涨跌幅', value, unit: '%', source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap('-1.23%'), data)).toEqual([]);
    expect(checkDraft(wrap('1.23%'), data).some((f) => f.原文 === '1.23')).toBe(true);
  });
  it('负数不能匹配快照中的正数', () => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '涨跌幅', value: 1.23, unit: '%', source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap('-1.23%'), data).some((f) => f.原文 === '-1.23')).toBe(true);
  });
  it.each([
    [2000, '亿元', '2000亿', '2000元'],
    ['2000', '亿元', '2000亿', '2000元'],
    [2000, '万元', '2000万', '2000元'],
    [2, '万亿元', '20000亿', '2元'],
    ['2000亿元', undefined, '2000亿', '2000元'],
  ])('按快照单位统一基数：%s %s', (value, unit, matching, wrong) => {
    const data: Snapshot = [
      {
        code: '601088',
        name: '中国神华',
        fields: [{ label: '市值', value, unit, source: '腾讯', fetchedAt: '今天' }],
      },
    ];
    expect(checkDraft(wrap(matching), data)).toEqual([]);
    expect(checkDraft(wrap(wrong), data).some((f) => f.问题.startsWith('数字未在快照'))).toBe(true);
  });
  it('允许必需短语、四舍五入与单位换算', () =>
    expect(
      checkDraft(
        wrap(
          '观察池记录：601088 现价52元，收入2960.31亿元，股息率3.87%。情景演算、不是买入计划、更不推荐跟风。',
        ),
        snapshot,
      ),
    ).toEqual([]));
  it('空正文标记前置声明及双披露缺失', () =>
    expect(checkDraft('', []).map((f) => f.问题)).toHaveLength(3));
  it('标记禁词及快照外数字', () => {
    const flags = checkDraft(wrap('你应该买，建议补仓。现价999元。'), snapshot);
    expect(flags.some((f) => f.原文 === '999')).toBe(true);
    for (const word of ['应该', '买', '建议', '补'])
      expect(flags.some((f) => f.原文 === word)).toBe(true);
  });
  it('不会接受只有免责声明但没有持仓和数据来源的结尾', () =>
    expect(checkDraft('⚠️ 模拟盘记录。非投资建议。', [])).toHaveLength(2));
});
