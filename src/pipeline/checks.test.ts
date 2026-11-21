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
