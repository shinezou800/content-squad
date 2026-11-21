import type { Snapshot } from '../data/market';
export type Flag = { 原文: string; 问题: string; 数据源值: string };
const numberPattern =
  /(?<!\d)((?:(?<![\d元%％亿万千百倍股]\s*)[+-])?\d[\d,]*(?:\.\d+)?)(万亿|亿|万)?/g;
function unitScale(unit = ''): number {
  return unit.startsWith('万亿')
    ? 1e12
    : unit.startsWith('亿')
      ? 1e8
      : unit.startsWith('万')
        ? 1e4
        : 1;
}

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
      if (typeof field.value === 'number') values.push(field.value * unitScale(field.unit));
      else
        for (const m of field.value.matchAll(numberPattern))
          values.push(Number(m[1].replaceAll(',', '')) * unitScale(m[2] || field.unit));
    }
  }
  for (const m of draft.matchAll(numberPattern)) {
    const raw = Number(m[1].replaceAll(',', ''));
    const scale = unitScale(m[2]);
    const n = raw * scale;
    const digits = m[1].split('.')[1]?.length || 0;
    const tolerance = 0.5 * 10 ** -digits * scale + 1e-8;
    if (!values.some((v) => Math.abs(v - n) <= tolerance))
      add(m[0], '数字未在快照中找到（已容许四舍五入及万/亿单位）', '请对照数据快照');
  }
  return flags;
}
