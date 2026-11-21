import type { Snapshot } from '../data/market';
export type Flag = { 原文: string; 问题: string; 数据源值: string };
export function checkDraft(draft: string, snapshot: Snapshot): Flag[] {
  const flags: Flag[] = [];
  const add = (原文: string, 问题: string, 数据源值 = '无') => flags.push({ 原文, 问题, 数据源值 });
  const safe = draft.replace(/不是买入计划|非投资建议|不构成投资建议|不推荐跟风/g, '');
  for (const m of safe.matchAll(/建议|应该|补|买|推荐|你可以|您可以|加仓|抄底|跟风/g))
    add(m[0], '发现可能指向读者的用词，请人工复核');
  if (!/^\s*⚠️/.test(draft) || !draft.slice(0, 100).includes('模拟盘记录'))
    add(draft.slice(0, 100), '开篇需有 ⚠️ 前置声明及模拟盘记录');
  const closing = draft.slice(-400);
  if (!/持仓披露[：:]/.test(closing)) add('', '结尾缺少持仓披露');
  if (!/非投资建议/.test(closing) || !/数据来源[：:]/.test(closing))
    add('', '结尾缺少非投资建议及数据来源披露');
  const values: number[] = [];
  for (const stock of snapshot) {
    values.push(Number(stock.code));
    for (const field of stock.fields) {
      if (typeof field.value === 'number') values.push(field.value);
      else for (const m of field.value.matchAll(/\d+(?:\.\d+)?/g)) values.push(Number(m[0]));
    }
  }
  for (const m of draft.matchAll(/(?<!\d)(\d[\d,]*(?:\.\d+)?)(万亿|亿|万)?/g)) {
    const raw = Number(m[1].replaceAll(',', ''));
    const scale = m[2] === '万亿' ? 1e12 : m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1;
    const n = raw * scale;
    const digits = m[1].split('.')[1]?.length || 0;
    const tolerance = 0.5 * 10 ** -digits * scale + 1e-8;
    if (!values.some((v) => Math.abs(v - n) <= tolerance))
      add(m[0], '数字未在快照中找到（已容许四舍五入及万/亿单位）', '请对照数据快照');
  }
  return flags;
}
