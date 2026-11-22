import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runMidPipeline } from './midRunner';
import { complete } from './llm';
import { registry } from '../squads/registry';
import { midRegistry } from '../squads/mid';
import type { Run } from '../storage';

vi.mock('./llm', () => ({ complete: vi.fn() }));
const mid = midRegistry['mid-bank'];
const codes = [
  ['601398', '601939', '601288', '601988'],
  ['600036', '601166', '000001', '601998', '600000', '600016', '601818', '600015'],
  ['002142', '600919', '601169', '601229', '601009', '600926'],
];
const titles = ['四大行', '股份制银行', '城商银行'];
const settings = {
  key: 'test-key',
  model: 'mock',
  pool: '601398 工商银行 持仓 分红TTM=2.5元\n601939 建设银行 观察池\n00883 中海油 观察池 分红TTM=1.49港元',
};
const drafts = titles.map(
  (title, index) =>
    `⚠️ 模拟盘记录。${title}观察池记录，现价${(index + 1) * 100 + 1}元。\n持仓披露：以快照分类为准。\n非投资建议。数据来源：腾讯行情。`,
);
const responses = drafts.flatMap((draft) => ['数据简报', draft, '[]']).concat('[]');
beforeEach(() => {
  let call = 0;
  let quote = 0;
  vi.mocked(complete).mockImplementation(async () => responses[call++]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('gtimg')) {
        quote++;
        const rows = url
          .split('q=')[1]
          .split(',')
          .map((ticker, index) => {
            const fields = Array(65).fill('');
            fields[1] = ticker;
            fields[2] = ticker.slice(2);
            fields[3] = String(quote * 100 + index + 1);
            return `v_${ticker}="${fields.join('~')}";`;
          });
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode(rows.join('\n')).buffer,
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: { data: url.includes('RPT_SHAREBONUS_DET') ? [] : [{}] },
        }),
      };
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(complete).mockReset();
});

it('银行中团十步顺序执行、三段合并、独立取数并使用全部快照复核', async () => {
  const progress: Run[] = [];
  const run = await runMidPipeline(mid, '银行记录', settings, (value) => progress.push(value));
  const ids = [
    ...mid.squads.flatMap((id) => ['data', 'draft', 'check'].map((role) => `${id}:${role}`)),
    'merge:check',
  ];
  expect(run.steps.map((step) => step.roleId)).toEqual(ids);
  expect(run.steps).toHaveLength(10);
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  expect(
    progress
      .filter((value) => value.steps.some((step) => step.status === 'running'))
      .map((value) => value.steps.find((step) => step.status === 'running')!.roleId),
  ).toEqual(ids);
  const quoteUrls = vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes('gtimg'));
  expect(
    quoteUrls.map((url) =>
      url
        .split('q=')[1]
        .split(',')
        .map((ticker) => ticker.slice(2)),
    ),
  ).toEqual(codes);
  for (const [index, group] of codes.entries()) {
    const snapshot = JSON.parse(run.steps[index * 3 + 1].input!).snapshot;
    expect(snapshot.map((stock: { code: string }) => stock.code)).toEqual(group);
    for (const offset of [1, 2]) {
      expect(JSON.parse(run.steps[index * 3 + offset].input!).snapshot).toEqual(snapshot);
    }
    for (const offset of [0, 1, 2]) {
      expect(JSON.parse(vi.mocked(complete).mock.calls[index * 3 + offset][2]).snapshot).toEqual(
        snapshot,
      );
    }
  }
  expect(run.snapshot).toHaveLength(codes.flat().length);
  expect(run.snapshot[0]).toMatchObject({ code: '601398', category: '持仓' });
  expect(run.snapshot[1]).toMatchObject({ code: '601939', category: '观察池' });
  expect(run.snapshot.slice(2).every((stock) => stock.category === '未持有')).toBe(true);
  expect(run.snapshot[0].fields.find((field) => field.source === '主人手动提供')).toMatchObject({
    value: 2.5,
    unit: '元',
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url]) => String(url).includes('RPT_SHAREBONUS_DET') && String(url).includes('601398'),
      ),
  ).toBe(false);
  const body = `──────── 四大行 ────────\n\n${drafts[0]}\n\n──────── 股份制银行 ────────\n\n${drafts[1]}\n\n──────── 城商银行 ────────\n\n${drafts[2]}`;
  const review = '【规则核对】\n[]\n\n【模型事实核对】\n[]';
  expect(run.finalText).toBe(
    `${body}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n${titles.map((title) => `【${title}段】\n${review}`).join('\n\n')}\n\n【合并全文数字复核】\n${review}`,
  );
  expect(body.match(/──────── .* ────────/g)).toHaveLength(3);
  expect(run.steps.at(-1)!.output).toBe(review);
  expect(JSON.parse(vi.mocked(complete).mock.calls.at(-1)![2])).toEqual({
    draft: body,
    snapshot: run.snapshot,
  });
  expect(JSON.parse(run.steps.at(-1)!.input!).snapshot).toEqual(run.snapshot);
});

it.each([0, 3, 4, 6, 9])('银行步骤失败后不抓取后续银行，不生成正文：%s', async (failure) => {
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => {
    const index = call++;
    if (index === failure) throw new Error('模型不可用');
    return responses[index];
  });
  const run = await runMidPipeline(mid, '记录', settings, () => {});
  expect(run.steps[failure]).toMatchObject({ status: 'failed', error: '模型不可用' });
  expect(run.steps.slice(failure + 1).every((step) => step.status === 'pending')).toBe(true);
  expect(run.finalText).toBe('');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('gtimg'))).toHaveLength(
    Math.min(3, Math.floor(failure / 3) + 1),
  );
});

it('N团合并快照按代码去重，保留第一份事实', async () => {
  const outputs = drafts.flatMap((draft) => [draft, '[]']).concat('[]');
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => outputs[call++]);
  for (const [index, id] of mid.squads.entries()) {
    vi.spyOn(registry[id].roles[0], 'run').mockImplementation(async (ctx) => {
      ctx.snapshot = [
        {
          code: '601398',
          name: '工商银行',
          fields: [
            { label: '现价', value: 101 + index, unit: '元', source: 'mock', fetchedAt: '' },
          ],
        },
        {
          code: codes[index][1],
          name: titles[index],
          fields: [
            {
              label: '现价',
              value: (index + 1) * 100 + 1,
              unit: '元',
              source: 'mock',
              fetchedAt: '',
            },
          ],
        },
      ];
      return '简报';
    });
  }
  const run = await runMidPipeline(mid, '记录', settings, () => {});
  expect(run.snapshot.map((stock) => stock.code)).toEqual(['601398', '601939', '601166', '600919']);
  expect(run.snapshot[0].fields[0].value).toBe(101);
  expect(run.steps.at(-1)!.output).toBe('【规则核对】\n[]\n\n【模型事实核对】\n[]');
  expect(JSON.parse(vi.mocked(complete).mock.calls.at(-1)![2]).snapshot).toEqual(run.snapshot);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(mid.squads)('银行提示词约束段范围、快照事实和持仓分类：%s', async (id) => {
  await runMidPipeline(mid, '记录', settings, () => {});
  const index = mid.squads.indexOf(id) * 3;
  expect(vi.mocked(complete).mock.calls[index][1]).toContain('明确报告期、分红口径和来源');
  const prompt = vi.mocked(complete).mock.calls[index + 1][1];
  for (const rule of [
    registry[id].name,
    '第一人称',
    '模拟盘记录',
    '建议/应该/补/买',
    '观察池记录',
    '情景演算、不是买入计划、更不推荐跟风',
    '⚠️',
    '持仓披露：',
    '非投资建议。数据来源：',
    '只能用快照数字，不得虚构未提供的实测步骤',
    '港元与人民币不得混用或换算',
    '缺失字段不是零',
    '观察池不当作持仓',
    '未持有股票既不是持仓，也不是主人的观察池，不得称作观察池记录',
  ])
    expect(prompt).toContain(rule);
});

it.each(
  [
    ['bank-big4'],
    ['bank-big4', 'bank-big4'],
    ['bank-big4', 'missing'],
    ['bank-big4', 'constructor'],
  ].map((squads) => ({ squads })),
)('银行中团拒绝无效配置：%j', async ({ squads }) => {
  await expect(runMidPipeline({ ...mid, squads }, '记录', settings, () => {})).rejects.toThrow(
    '中团流水线配置无效。',
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('缺少匹配核对角色的银行流水线在取数前拒绝', async () => {
  const squad = registry['bank-city'];
  const roles = squad.roles;
  squad.roles = roles.filter((role) => role.id !== 'check');
  try {
    await expect(runMidPipeline(mid, '记录', settings, () => {})).rejects.toThrow(
      '中团流水线配置无效。',
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    squad.roles = roles;
  }
});
