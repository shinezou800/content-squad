import type { Snapshot } from '../data/market';
export type Flag = { 原文: string; 问题: string; 数据源值: string };
const numberPattern =
  /(?<!\d)((?:(?<![\d元%％亿万千百倍股]\s*)[+-])?\d+(?:,\d{3}(?!\d))*(?:\.\d+)?)(?:\s*(万亿|亿|万))?(?:\s*(人民币元|人民币|RMB|港元|港币|HKD|元))?/gi;
function stripTimestamps(text: string): string {
  return text
    .replace(
      /(?<!\d)\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:~\d{2})?(?:Z|[+-]\d{2}:?\d{2}|\s*UTC)?(?!\d)/g,
      ' ',
    )
    .replace(/(?<!\d)\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?(?!\d)/g, ' ')
    .replace(/(?<!\d)(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/(?<!\d)\d{4}\s*年(?!\s*\d+\s*季报)|(?<!\d)\d{1,2}\s*[月日]|(?<!\d)\d{1,2}\s*[时点]\s*(?:\d{1,2}\s*分)?(?:\d{1,2}\s*秒)?/g, ' ')
    .replace(
      /(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:[~～-](?:\d{6}|\d{4}|\d{2}))?(?!\d)/g,
      ' ',
    )
    .replace(/(?<!\d)\d{4}([/-])\d{2}\1\d{2}(?!\d)/g, ' ')
    .replace(/(?<![\d:])(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])/g, ' ');
}
export function* numberMatches(text: string, snapshot: Snapshot, skipDerived = false) {
  text = stripTimestamps(text);
  let derivedRangeEnd = 0;
  for (const match of text.matchAll(numberPattern)) {
    if (
      skipDerived &&
      (match.index < derivedRangeEnd ||
        /(?:中位数|平均|均值|区间|最高|最低)[^\d，。！？；、,.!?;\n]{0,6}$/.test(
          text.slice(Math.max(0, match.index - 9), match.index),
        ))
    ) {
      const end = match.index + match[0].length;
      const range =
        /^(?:\s*(?:倍|[%％]|股))?\s*[–—~～至到-]\s*[+-]?\d+(?:,\d{3}(?!\d))*(?:\.\d+)?/.exec(
          text.slice(end),
        );
      if (range) derivedRangeEnd = end + range[0].length;
      continue;
    }
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
    const prefix = text.slice(0, match.index);
    if (!/^[+-]/.test(match[1]) && /^\s*[%％]/.test(text.slice(match.index + match[0].length))) {
      if (/(?:下跌|微跌|跌|下滑|回落)\s*$/.test(prefix)) match[1] = '-' + match[1];
    }
    yield match;
  }
}
export function currencyOf(unit = '') {
  return /港元|港币|HKD/i.test(unit)
    ? 'HKD'
    : /人民币|RMB|元/i.test(unit)
      ? 'CNY'
      : unit
        ? 'non-monetary'
        : undefined;
}
export function unitScale(unit = ''): number {
  return unit.startsWith('万亿')
    ? 1e12
    : unit.startsWith('亿')
      ? 1e8
      : unit.startsWith('万')
        ? 1e4
        : 1;
}

export function withinNumberTolerance(raw: number, source: number, digits: number, scale = 1): boolean {
  const value = source / scale;
  const epsilon = 4 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(raw));
  return Number.isFinite(raw) && Number.isFinite(value) &&
    Math.abs(value - raw) <= 0.5 / 10 ** Math.min(digits, 2) + epsilon;
}

function singleModelNumber(text: string) {
  if (stripTimestamps(text) !== text) return;
  const matches = [...numberMatches(text, [])];
  if (matches.length !== 1) return;
  const m = matches[0];
  const suffix = text.slice(m.index + m[0].length).trim();
  const unit = suffix.match(/^[%％倍股]/)?.[0] || '';
  if (suffix && !unit) return;
  if (unit && suffix !== unit) return;
  return {
    context: text.slice(0, m.index).trim(),
    raw: Number(m[1].replaceAll(',', '')),
    digits: m[1].split('.')[1]?.length || 0,
    scale: unitScale(m[2]),
    kind: unit === '％' ? '%' : unit || (m[2] || m[3] ? 'money' : 'bare'),
    currency: currencyOf(m[3]),
  };
}

export function filterModelCheck(result: string): string {
  const fenced = /^(\s*```(?:json)?\s*\n)([\s\S]*?)(\n```\s*)$/.exec(result);
  try {
    const items: unknown = JSON.parse(fenced ? fenced[2] : result);
    if (!Array.isArray(items)) return result;
    const kept = items.filter((item) => {
      if (!item || typeof item.原文 !== 'string' || typeof item.数据源值 !== 'string' || typeof item.问题 !== 'string') return true;
      if (/来源|口径|出处|手动|接口|单位|币种/.test(item.问题)) return true;
      const draft = singleModelNumber(item.原文);
      const source = singleModelNumber(item.数据源值);
      if (!draft || !source || draft.kind !== source.kind || draft.currency !== source.currency) return true;
      if (source.context && source.context !== draft.context) return true;
      return !withinNumberTolerance(draft.raw, source.raw * source.scale, draft.digits, draft.scale);
    });
    if (kept.length === items.length) return result;
    const json = JSON.stringify(kept, null, 2);
    return fenced ? fenced[1] + json + fenced[3] : json;
  } catch {
    return result;
  }
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
        /(?:未曾|未|不再|不需|不用|不必|不|没再|没(?:有)?|无需|无|从未)\s*(?:(?:做|进行)\s*)?(?:任何\s*)?$/.test(clause) ||
        !(/^补(?:仓|买|一点)/.test(rest) || /(?:可以|该)\s*$/.test(clause))
      )
        continue;
    }
    add(m[0], '发现可能指向读者的用词，请人工复核');
  }
  if (!/⚠\uFE0F?[\s\S]*?模拟盘记录/.test(draft))
    add(draft.slice(0, 100), '开篇需有 ⚠️ 前置声明及模拟盘记录');
  const closing = draft;
  if (!/持仓披露\s*[：:]/.test(closing)) add('', '结尾缺少持仓披露');
  if (!/非投资建议/.test(closing) || !/数据来源\s*[：:]/.test(closing))
    add('', '结尾缺少非投资建议及数据来源披露');
  return [...flags, ...checkNumbers(draft, snapshot)];
}

function derivedNumbers(context: string, snapshot: Snapshot) {
  const payout = /派息覆盖|分红覆盖|派息率|支付率/.test(context);
  const operation = /派息覆盖|分红覆盖|覆盖率|派息率|支付率|比率|比值|比例|股息率|收益率|[÷/]/.test(context)
    ? 'ratio'
    : /合计|总计|之和|相加|加总|[+＋]/.test(context)
      ? 'sum'
      : /差额|之差|相减|差值|减去|[−－]/.test(context)
        ? 'difference'
        : /乘以|乘积|相乘|[×*]/.test(context)
          ? 'product'
          : undefined;
  if (!operation) return [];
  const results: { value: number; currency?: string; ratio?: boolean }[] = [];
  for (const stock of snapshot) {
    const fields = stock.fields.flatMap((field) => {
      const parsed = typeof field.value === 'number' ? undefined : singleModelNumber(field.value);
      const value = typeof field.value === 'number' ? field.value : parsed && !parsed.context ? parsed.raw : undefined;
      if (value === undefined || !Number.isFinite(value) || /日期|时间|报告期|代码|年份/.test(field.label)) return [];
      return [{ label: field.label, value: value * (parsed && parsed.kind !== 'bare' ? parsed.scale : unitScale(field.unit)), currency: parsed?.currency ?? currencyOf(field.unit) }];
    });
    for (let i = 0; i < fields.length; i++) {
      for (let j = 0; j < fields.length; j++) {
        if (i === j) continue;
        const a = fields[i], b = fields[j];
        if (a.currency && b.currency && a.currency !== b.currency) continue;
        if (operation === 'ratio') {
          if (payout && !/分红|派息|股息/.test(a.label)) continue;
          if (b.value !== 0) results.push({ value: a.value / b.value, currency: 'non-monetary', ratio: true });
        } else {
          const value = operation === 'sum' ? a.value + b.value : operation === 'difference' ? a.value - b.value : a.value * b.value;
          results.push({ value, currency: a.currency ?? b.currency });
        }
      }
    }
  }
  return results;
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
  const quotedDraft = draft
    .split(/([。！？\n])/)
    .map(
      (sentence) =>
        /若|如果|假设|对应价格|仅作数字推演|推演|情景演算|不是买入计划|测算|回升至|修复至/.test(
          sentence,
        ) ? '' : sentence,
    )
    .join('');
  for (const m of numberMatches(quotedDraft, snapshot, true)) {
    const raw = Number(m[1].replaceAll(',', ''));
    const scale = unitScale(m[2]);
    const digits = Math.min(m[1].split('.')[1]?.length || 0, 2);
    const currency = currencyOf(m[3]);
    const context = m.input.slice(0, m.index).split(/[，。！？；\n]/).at(-1)!.slice(-40);
    const percent = /^\s*[%％]/.test(m.input.slice(m.index + m[0].length));
    const derived = derivedNumbers(context, snapshot).some((v) =>
      (!currency || !v.currency || currency === v.currency) &&
      withinNumberTolerance(raw, v.value * (percent && v.ratio ? 100 : 1), digits, scale),
    );
    if (
      !derived &&
      !values.some(
        (v) => {
          return (
            (!currency || !v.currency || currency === v.currency) &&
            withinNumberTolerance(raw, v.value, digits, scale)
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
