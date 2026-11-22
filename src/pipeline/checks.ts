import type { Snapshot } from '../data/market';
export type Flag = { 原文: string; 问题: string; 数据源值: string };
const numberPattern =
  /(?<!\d)((?:(?<![\d元%％亿万千百倍股]\s*)[+-])?\d[\d,]*(?:\.\d+)?)(?:\s*(万亿|亿|万))?(?:\s*(人民币元|人民币|RMB|港元|港币|HKD|元))?/gi;
function stripTimestamps(text: string): string {
  return text
    .replace(
      /(?<!\d)\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?(?!\d)/g,
      ' ',
    )
    .replace(
      /(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?!\d)/g,
      ' ',
    );
}
function* numberMatches(text: string, snapshot: Snapshot) {
  text = stripTimestamps(text);
  for (const match of text.matchAll(numberPattern)) {
    if (
      /^\d{5,6}$/.test(match[1]) &&
      snapshot.some(
        (stock) =>
          stock.code === match[1] &&
          stock.name &&
          text
            .slice(match.index + match[1].length)
            .trimStart()
            .startsWith(stock.name),
      )
    ) {
      match[2] = '';
      match[3] = '';
    }
    yield match;
  }
}
function currencyOf(unit = '') {
  return /港元|港币|HKD/i.test(unit)
    ? 'HKD'
    : /人民币|RMB|元/i.test(unit)
      ? 'CNY'
      : unit
        ? 'non-monetary'
        : undefined;
}
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
  for (const m of safe.matchAll(/建议|应该|补|买|推荐|你可以|您可以|加仓|抄底|跟风/g)) {
    if (m[0] === '补') {
      const rest = safe.slice(m.index);
      const clause = safe
        .slice(0, m.index)
        .split(/[，。！？；、,.!?;\n]/)
        .at(-1)!;
      if (
        /^补(?:全|充|贴|助)/.test(rest) ||
        /(?:未|不|没(?:有)?|无)\s*(?:(?:做|进行)\s*)?(?:任何\s*)?$/.test(clause) ||
        !(/^补(?:仓|买|一点)/.test(rest) || /(?:可以|该)\s*$/.test(clause))
      )
        continue;
    }
    add(m[0], '发现可能指向读者的用词，请人工复核');
  }
  if (!/^\s*⚠️/.test(draft) || !draft.slice(0, 100).includes('模拟盘记录'))
    add(draft.slice(0, 100), '开篇需有 ⚠️ 前置声明及模拟盘记录');
  const closing = draft.slice(-400);
  if (!/持仓披露[：:]/.test(closing)) add('', '结尾缺少持仓披露');
  if (!/非投资建议/.test(closing) || !/数据来源[：:]/.test(closing))
    add('', '结尾缺少非投资建议及数据来源披露');
  return [...flags, ...checkNumbers(draft, snapshot)];
}

export function checkNumbers(draft: string, snapshot: Snapshot): Flag[] {
  const flags: Flag[] = [];
  const add = (原文: string, 问题: string, 数据源值: string) =>
    flags.push({ 原文, 问题, 数据源值 });
  const values: { value: number; currency?: string }[] = [];
  for (const stock of snapshot) {
    values.push({ value: Number(stock.code), currency: 'non-monetary' });
    for (const field of stock.fields) {
      if (!stripTimestamps(String(field.value)).trim()) continue;
      if (typeof field.value === 'number')
        values.push({
          value: field.value * unitScale(field.unit),
          currency: currencyOf(field.unit),
        });
      else
        for (const m of numberMatches(field.value, snapshot))
          values.push({
            value: Number(m[1].replaceAll(',', '')) * unitScale(m[2] || field.unit),
            currency: currencyOf(m[3] || field.unit),
          });
    }
  }
  for (const m of numberMatches(draft, snapshot)) {
    const raw = Number(m[1].replaceAll(',', ''));
    const scale = unitScale(m[2]);
    const digits = Math.min(m[1].split('.')[1]?.length || 0, 2);
    const precision = 10 ** digits;
    const currency = currencyOf(m[3]);
    if (
      !values.some(
        (v) => {
          const value = v.value / scale;
          const epsilon = 1e-9 * Math.max(1, Math.abs(value), Math.abs(raw));
          return (
            (!currency || !v.currency || currency === v.currency) &&
            Math.abs(value - raw) <= 0.5 / precision + epsilon
          );
        },
      )
    )
      add(
        m[1] + (m[2] ?? ''),
        '数字未在快照中找到（已容许四舍五入及万/亿单位，币种须一致）',
        '请对照数据快照',
      );
  }
  return flags;
}
