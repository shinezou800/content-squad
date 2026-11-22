import type { Snapshot } from '../data/market';
import {
  checkDraft,
  checkNumbers,
  currencyOf,
  numberMatches,
  unitScale,
} from './checks';

export type CrossFlag = { 原文: string; 问题: string; 依据: string };
export type CrossItem = CrossFlag & { 改为?: string };
export type Revision = { 段落: string; 审出: string; 原文: string; 改为: string; 问题: string };
export type Unresolved = CrossFlag & { 标记: '冲突' | '待人工确认'; 未改原因?: string };

export const crossReviewPrompt = (reviewer: string, target: string) =>
  `你是「${reviewer}」团的互审员，审阅同一中团里「${target}」团的草稿，并与本团草稿对照。逐项检查：一、被审草稿里的数字与快照是否一致；二、两份草稿之间是否互相矛盾（同一只股票数字不同、结论相反、重复论述）；三、是否有一处写了、另一处漏了的关键事实。只输出JSON列表，每项字段为原文、问题、依据，可选字段改为；无问题输出[]。原文必须是被审草稿中逐字出现的一段。只有被审草稿确实有误（数字与快照不符、重复论述、漏写快照中的关键事实）时才给出改为，改为是替换原文的新文字，只能用快照里的数字和事实，保留港元与人民币元各自币种，沿用原段口吻，不用建议、应该、补、买等指向读者的词，不动开篇⚠️声明与结尾持仓披露、非投资建议及数据来源披露。两团结论确实冲突、无法判定谁对时不给改为，双方观点都保留。不改写本团草稿，不输出全文。`;

export function crossPairs<T>(items: T[]): { reviewer: T; target: T }[] {
  return items.map((target, index) => ({ reviewer: items[(index + 1) % items.length], target }));
}

type Mention = {
  key: string;
  name: string;
  label: string;
  raw: number;
  digits: number;
  scale: number;
  sentence: string;
};
const hypothetical =
  /若|如果|假设|对应价格|仅作数字推演|推演|情景演算|不是买入计划|测算|回升至|修复至/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(draft: string, snapshot: Snapshot): Mention[] {
  const result: Mention[] = [];
  for (const raw of draft.split(/(?<=[。！？；;\n])/)) {
    const sentence = raw.trim();
    if (!sentence || hypothetical.test(sentence)) continue;
    const hits = snapshot
      .flatMap((stock) =>
        [stock.name, stock.code]
          .filter((token) => token && token.length >= 2)
          .flatMap((token) =>
            [...sentence.matchAll(new RegExp(escape(token), 'g'))].map((m) => ({
              stock,
              start: m.index,
              end: m.index + token.length,
            })),
          ),
      )
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .filter((hit, index, all) => !all.slice(0, index).some((other) => hit.start < other.end));
    hits.forEach((hit, index) => {
      const window = sentence.slice(hit.end, hits[index + 1]?.start ?? sentence.length);
      for (const m of numberMatches(window, snapshot)) {
        const label = m.input
          .slice(0, m.index)
          .replace(/[：:\s]+$/, '')
          .split(/[，,。；;：:、（）()\s【】「」“”]|\d/)
          .at(-1)!
          .replace(/^(?:万亿|亿|万)?(?:人民币元|人民币|港元|港币|HKD|元|[%％倍股])?/i, '')
          .replace(/^(?:的|在|其)+/, '')
          .replace(/(?:约为|大约|为|是|约|达|在|了|报|仅|共)+$/, '')
          .slice(-8);
        if (label.length < 2 || !/[\p{Script=Han}A-Za-z]/u.test(label)) continue;
        const suffix = /^\s*([%％倍股])/.exec(m.input.slice(m.index + m[0].length))?.[1];
        const kind = suffix ? suffix.replace('％', '%') : m[2] || m[3] ? 'money' : 'bare';
        result.push({
          key: `${hit.stock.code}|${label}|${kind}|${currencyOf(m[3]) ?? ''}`,
          name: hit.stock.name || hit.stock.code,
          label,
          raw: Number(m[1].replaceAll(',', '')),
          digits: m[1].split('.')[1]?.length || 0,
          scale: unitScale(m[2]),
          sentence,
        });
      }
    });
  }
  return result;
}

const rounding = (m: Mention) => (0.5 / 10 ** Math.min(m.digits, 2)) * m.scale;
const close = (a: Mention, b: Mention) => {
  const x = a.raw * a.scale;
  const y = b.raw * b.scale;
  const epsilon = 4 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(x - y) <= rounding(a) + rounding(b) + epsilon;
};

export function crossConflicts(
  target: string,
  reviewer: string,
  snapshot: Snapshot,
  reviewerTitle: string,
): CrossFlag[] {
  const ours = mentions(target, snapshot);
  const theirs = mentions(reviewer, snapshot);
  const flags: CrossFlag[] = [];
  for (const key of new Set(ours.map((item) => item.key))) {
    const a = ours.filter((item) => item.key === key);
    const b = theirs.filter((item) => item.key === key);
    if (!b.length) continue;
    const stock = snapshot.find((item) => item.code === key.split('|')[0]);
    const field = stock?.fields.find(
      (item) => item.label.includes(a[0].label) || a[0].label.includes(item.label),
    );
    const seen = new Set<string>();
    for (const x of a) {
      if (seen.has(x.sentence) || b.some((y) => close(x, y))) continue;
      seen.add(x.sentence);
      flags.push({
        原文: x.sentence,
        问题: `与「${reviewerTitle}」段矛盾：同一股票（${x.name}）${x.label}数字不同`,
        依据: `「${reviewerTitle}」段写作：${b[0].sentence}${field ? `；快照：${field.label}=${field.value}${typeof field.value === 'number' ? field.unit : ''}` : ''}`,
      });
    }
  }
  return flags;
}

export function parseCrossReview(result: string): CrossItem[] | undefined {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(result);
  try {
    const items: unknown = JSON.parse(fenced ? fenced[1] : result);
    if (!Array.isArray(items)) return;
    return items
      .filter((item) => item && typeof item.原文 === 'string' && typeof item.问题 === 'string')
      .map((item) => ({
        原文: item.原文,
        问题: item.问题,
        依据: typeof item.依据 === 'string' ? item.依据 : String(item.依据 ?? item.数据源值 ?? ''),
        ...(typeof item.改为 === 'string' ? { 改为: item.改为 } : {}),
      }));
  } catch {
    return;
  }
}

function ruleCounts(draft: string) {
  const counts = new Map<string, number>();
  for (const flag of checkDraft(draft, []))
    if (!flag.问题.startsWith('数字未在快照'))
      counts.set(flag.问题, (counts.get(flag.问题) ?? 0) + 1);
  return counts;
}
const mark = (问题: string): Unresolved['标记'] =>
  /矛盾|冲突|相反|不一致|不同/.test(问题) ? '冲突' : '待人工确认';

export function applyCrossReview(options: {
  draft: string;
  reviewerDraft: string;
  snapshot: Snapshot;
  modelResult: string;
  reviewerTitle: string;
  targetTitle: string;
}): { draft: string; output: string } {
  const { reviewerDraft, snapshot, modelResult, reviewerTitle, targetTitle } = options;
  let draft = options.draft;
  const ruleFlags = crossConflicts(draft, reviewerDraft, snapshot, reviewerTitle);
  const items = parseCrossReview(modelResult);
  const revisions: Revision[] = [];
  const unresolved: Unresolved[] = [];
  const keep = (item: CrossFlag, 未改原因?: string) =>
    unresolved.push({
      标记: mark(item.问题),
      原文: item.原文,
      问题: item.问题,
      依据: item.依据,
      ...(未改原因 ? { 未改原因 } : {}),
    });
  if (!items && modelResult.trim())
    unresolved.push({
      标记: '待人工确认',
      原文: '',
      问题: '模型互审结果不是 JSON 列表，未自动改动，请人工阅读上方模型互审原文',
      依据: '',
    });
  for (const item of items ?? []) {
    if (item.改为 === undefined || !item.改为.trim() || item.改为 === item.原文) {
      keep(item);
      continue;
    }
    if (!item.原文 || draft.split(item.原文).length !== 2) {
      keep(item, '原文在被审草稿中未找到或不唯一');
      continue;
    }
    const next = draft.replace(item.原文, () => item.改为!);
    const before = ruleCounts(draft);
    const after = ruleCounts(next);
    if ([...after].some(([key, count]) => count > (before.get(key) ?? 0))) {
      keep(item, '改后会破坏开篇声明、结尾披露或用词规则');
      continue;
    }
    if (checkNumbers(next, snapshot).length > checkNumbers(draft, snapshot).length) {
      keep(item, '改后出现快照外数字');
      continue;
    }
    draft = next;
    revisions.push({
      段落: targetTitle,
      审出: reviewerTitle,
      原文: item.原文,
      改为: item.改为,
      问题: item.问题,
    });
  }
  for (const flag of crossConflicts(draft, reviewerDraft, snapshot, reviewerTitle))
    if (!unresolved.some((item) => item.原文 === flag.原文 && item.问题 === flag.问题)) keep(flag);
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return {
    draft,
    output: `【规则核对】\n${json(ruleFlags)}\n\n【模型互审】\n${modelResult}\n\n【已改进】\n${json(revisions)}\n\n【未改 · 双方保留】\n${json(unresolved)}`,
  };
}
