import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runMidPipeline } from './midRunner';
import { runPipeline } from './runner';
import { complete } from './llm';
import { checkDraft, checkNumbers } from './checks';
import { registry } from '../squads/registry';
import { midRegistry } from '../squads/mid';
import type { Context, MidSquad } from '../squads/types';
import type { Run } from '../storage';

vi.mock('./llm', () => ({ complete: vi.fn() }));
const settings = {
  useProxy: false,
  baseUrl: 'https://example.com/v1',
  key: 'private-key',
  model: 'test-model',
  pool: '00883 中海油 观察池 分红TTM=1.49港元',
};
const mid = midRegistry['mid-zangu-ai'];
const wrap = (text: string) =>
  `⚠️ 模拟盘记录。${text}\n持仓披露：观察池记录。\n非投资建议。数据来源：腾讯行情、主人手动提供。`;
const draftA = wrap('攒股记录，现价21.7港元。');
const draftB = wrap('AI 实测手记，每股分红1.49港元。');
const responses = ['数据简报甲', draftA, '[]', '数据简报乙', draftB, '[]', '[]', '[]', '[]'];
const crossEmpty = '【规则核对】\n[]\n\n【模型互审】\n[]\n\n【已改进】\n[]\n\n【未改 · 双方保留】\n[]';
it('golden: mid-zangu-ai finalText and step IDs stay byte-identical', async () => {
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  expect(run.steps.map((step) => step.roleId)).toEqual([
    'zangu-shouxi:data',
    'zangu-shouxi:draft',
    'zangu-shouxi:check',
    'ai-shouji:data',
    'ai-shouji:draft',
    'ai-shouji:check',
    'cross:ai-shouji→zangu-shouxi',
    'cross:zangu-shouxi→ai-shouji',
    'merge:check',
  ]);
  const review = '【规则核对】\n[]\n\n【模型事实核对】\n[]';
  expect(run.finalText).toBe(
    `──────── 攒股收息 ────────\n\n${draftA}\n\n──────── AI手记 ────────\n\n${draftB}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n【攒股收息段】\n${review}\n\n【AI手记段】\n${review}\n\n【互审】\n〔AI手记 审 攒股收息〕\n${crossEmpty}\n\n〔攒股收息 审 AI手记〕\n${crossEmpty}\n\n【合并全文数字复核】\n${review}`,
  );
});
beforeEach(() => {
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => responses[call++]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('gtimg')) {
        const fields = Array(65).fill('');
        fields[1] = 'CNOOC';
        fields[2] = '00883';
        fields[3] = '21.7';
        return {
          ok: true,
          arrayBuffer: async () =>
            new TextEncoder().encode(`v_hk00883="${fields.join('~')}";`).buffer,
        };
      }
      return { ok: true, json: async () => ({ success: false }) };
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(complete).mockReset();
});

it('中团配置按顺序注册，角色生命周期完整，快照仅抓取一次，设置及快照按引用共享，outputs 分隔', async () => {
  expect(mid).toEqual({
    id: 'mid-zangu-ai',
    name: '攒股收息 × AI手记',
    squads: ['zangu-shouxi', 'ai-shouji'],
  });
  const contexts: Context[] = [];
  const observedSnapshots: Context['snapshot'][] = [];
  for (const id of mid.squads)
    for (const role of registry[id].roles) {
      const original = role.run;
      vi.spyOn(role, 'run').mockImplementation(async (ctx) => {
        contexts.push(ctx);
        const result = await original(ctx);
        observedSnapshots.push(ctx.snapshot);
        return result;
      });
    }
  const progress: Run[] = [];
  const run = await runMidPipeline(mid, '选题', settings, (value) => progress.push(value));
  const ids = [
    'zangu-shouxi:data',
    'zangu-shouxi:draft',
    'zangu-shouxi:check',
    'ai-shouji:data',
    'ai-shouji:draft',
    'ai-shouji:check',
    'cross:ai-shouji→zangu-shouxi',
    'cross:zangu-shouxi→ai-shouji',
    'merge:check',
  ];
  expect(run.squadId).toBe(mid.id);
  expect(run.steps.map((step) => step.roleId)).toEqual(ids);
  expect(
    progress
      .filter((value) => value.steps.some((step) => step.status === 'running'))
      .map((value) => value.steps.find((step) => step.status === 'running')!.roleId),
  ).toEqual(ids);
  expect(progress).toHaveLength(20);
  expect(progress[0].steps.every((step) => step.status === 'pending')).toBe(true);
  expect(progress[0].snapshot).toEqual([]);
  expect(progress[0].finalText).toBe('');
  expect(
    run.steps.every(
      (step) =>
        step.status === 'done' && step.input && step.output && step.startedAt && step.finishedAt,
    ),
  ).toBe(true);
  expect(contexts).toHaveLength(6);
  expect(contexts.every((ctx) => ctx.settings === settings)).toBe(true);
  expect(observedSnapshots.every((snapshot) => snapshot === run.snapshot)).toBe(true);
  expect(contexts[0]).toBe(contexts[2]);
  expect(contexts[3]).toBe(contexts[5]);
  expect(contexts[0].outputs).not.toBe(contexts[3].outputs);
  expect(contexts[0].outputs.data).toBe('数据简报甲');
  expect(contexts[3].outputs.data).toBe('数据简报乙');
  expect(JSON.parse(run.steps[3].input!).outputs).toEqual({});
  expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('gtimg'))).toHaveLength(
    1,
  );
  expect(run.snapshot[0]).toMatchObject({ code: '00883', category: '观察池' });
  expect(run.snapshot[0].fields.find((field) => field.source === '主人手动提供')).toMatchObject({
    value: 1.49,
    unit: '港元',
  });
  expect(complete).toHaveBeenCalledTimes(9);
  expect(vi.mocked(complete).mock.calls.every((call) => call[0] === settings)).toBe(true);
  expect(JSON.stringify(run)).not.toContain('private-key');
});

it('任意中团标识均在新小团首步继承前团快照，AI手记复用而非重新抓取', async () => {
  const run = await runMidPipeline({ ...mid, id: 'another-mid' }, '选题', settings, () => {});
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  expect(JSON.parse(run.steps[3].input!).snapshot).toEqual(run.snapshot);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('gtimg'))).toHaveLength(
    1,
  );
});

it('正文不改写且依次排列，独立核对及合并核对统一置于正文之后', async () => {
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  const body = `──────── 攒股收息 ────────\n\n${draftA}\n\n──────── AI手记 ────────\n\n${draftB}`;
  expect(run.finalText).toBe(
    `${body}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n【攒股收息段】\n${run.steps[2].output}\n\n【AI手记段】\n${run.steps[5].output}\n\n【互审】\n〔AI手记 审 攒股收息〕\n${run.steps[6].output}\n\n〔攒股收息 审 AI手记〕\n${run.steps[7].output}\n\n【合并全文数字复核】\n${run.steps[8].output}`,
  );
  expect(vi.mocked(complete).mock.calls[8][1]).toContain('小核 · 合并复核');
  expect(vi.mocked(complete).mock.calls[8][1]).toContain('不改写正文');
  expect(JSON.parse(vi.mocked(complete).mock.calls[8][2])).toEqual({
    draft: body,
    snapshot: run.snapshot,
  });
});

it.each([0, 4, 6, 7, 8])('步骤失败立即停止，后续不执行，不产生成稿：%s', async (failure) => {
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => {
    const index = call++;
    if (index === failure) throw new Error('模拟模型失败');
    return responses[index];
  });
  const progress: Run[] = [];
  const run = await runMidPipeline(mid, '选题', settings, (value) => progress.push(value));
  expect(complete).toHaveBeenCalledTimes(failure + 1);
  expect(run.steps.slice(0, failure).every((step) => step.status === 'done')).toBe(true);
  expect(run.steps[failure]).toMatchObject({ status: 'failed', error: '模拟模型失败' });
  expect(run.steps[failure].finishedAt).toBeTruthy();
  expect(run.steps.slice(failure + 1).every((step) => step.status === 'pending')).toBe(true);
  expect(run.finalText).toBe('');
  expect(progress.at(-1)).toEqual(run);
  expect(run.snapshot).toHaveLength(1);
});

it('数据请求失败停在第一步，不调用任何模型', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('网络断开'));
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  expect(run.steps[0]).toMatchObject({ status: 'failed', error: '网络断开' });
  expect(run.steps.slice(1).every((step) => step.status === 'pending')).toBe(true);
  expect(run.snapshot).toEqual([]);
  expect(complete).not.toHaveBeenCalled();
});

it.each(
  [[], ['zangu-shouxi'], ['missing', 'ai-shouji'], ['zangu-shouxi', 'zangu-shouxi']].map(
    (squads) => ({ squads }),
  ),
)('无效中团配置在运行前拒绝：%s', async ({ squads }) => {
  const emit = vi.fn();
  await expect(
    runMidPipeline({ ...mid, squads } as MidSquad, '选题', settings, emit),
  ).rejects.toThrow('配置无效');
  expect(emit).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(
  [['data', 'data', 'check'], ['data', 'missing', 'check'], []].map((pipeline) => ({ pipeline })),
)('无效小团流水线拒绝：%s', async ({ pipeline }) => {
  const squad = registry['ai-shouji'];
  const original = squad.pipeline;
  squad.pipeline = pipeline;
  try {
    await expect(runMidPipeline(mid, '选题', settings, () => {})).rejects.toThrow('配置无效');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    squad.pipeline = original;
  }
});

it('合并复核只检查数字，不检查两段披露位置或禁词', async () => {
  const longBody = 'AI 手记正文。'.repeat(100);
  vi.mocked(complete).mockImplementation(async (_settings, _system, user) => {
    const payload = JSON.parse(user);
    if ('draft' in payload) return '[]';
    return 'brief' in payload ? `${longBody}999999港元。` : '数据简报';
  });
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  const flags = JSON.parse(
    run.steps[8].output!.split('【规则核对】\n')[1].split('\n\n【模型事实核对】')[0],
  );
  expect(flags).toHaveLength(2);
  expect(flags.every((flag: { 问题: string }) => flag.问题.startsWith('数字未在快照'))).toBe(true);
  expect(checkNumbers('建议，不含声明或披露。', run.snapshot)).toEqual([]);
  expect(checkNumbers('', [])).toEqual([]);
  expect(checkDraft('', [])).toHaveLength(3);
  expect(checkNumbers('1.49元', run.snapshot)).toHaveLength(1);
  expect(checkNumbers('1.49港元', run.snapshot)).toEqual([]);
});

it('单团的步骤、模板与正文输出格式保持原样', async () => {
  const run = await runPipeline(registry['zangu-shouxi'], '选题', settings, () => {});
  expect(run.steps.map((step) => step.roleId)).toEqual(['data', 'draft', 'check']);
  expect(run.finalText).toBe(
    `${draftA}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n【规则核对】\n[]\n\n【模型事实核对】\n[]`,
  );
  expect(complete).toHaveBeenCalledTimes(3);
});

it('AI手记可独立取数运行，提示词保留实测、不荐股及发布勾选规则', async () => {
  const run = await runPipeline(registry['ai-shouji'], '选题', settings, () => {});
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  expect(run.snapshot).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  const prompt = vi.mocked(complete).mock.calls[1][1];
  for (const rule of [
    '第一人称实测记录口吻',
    '不编造未跑过的步骤',
    '不荐股',
    '建议/应该/补/买',
    '正文里不要写「含AI合成内容」',
    '用户在发布页勾选',
    '模拟盘记录',
    '持仓披露：',
    '非投资建议。数据来源：',
  ])
    expect(prompt).toContain(rule);
});

it('互审抓到两份草稿同一股票数字不同，审出的真实错误改进草稿并记入核对记录', async () => {
  const wrong = wrap('CNOOC现价22.5港元。');
  const right = wrap('CNOOC现价21.7港元。');
  const outputs = [
    '数据简报甲',
    right,
    '[]',
    '数据简报乙',
    wrong,
    '[]',
    '[]',
    JSON.stringify([
      { 原文: '现价22.5港元', 问题: '与快照及攒股收息段不符', 依据: '快照现价21.7港元', 改为: '现价21.7港元' },
    ]),
    '[]',
  ];
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => outputs[call++]);
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  expect(run.steps.every((step) => step.status === 'done')).toBe(true);
  const [aReviewsZangu, zanguReviewsAi] = [run.steps[6], run.steps[7]];
  expect(aReviewsZangu.roleId).toBe('cross:ai-shouji→zangu-shouxi');
  expect(aReviewsZangu.output).toContain('与「AI手记」段矛盾：同一股票（CNOOC）现价数字不同');
  expect(zanguReviewsAi.output).toContain('与「攒股收息」段矛盾：同一股票（CNOOC）现价数字不同');
  const crossCall = vi.mocked(complete).mock.calls[7];
  expect(crossCall[1]).toContain('「攒股收息」团的互审员');
  expect(JSON.parse(crossCall[2])).toEqual({
    审阅团: '攒股收息',
    被审团: 'AI手记',
    被审草稿: wrong,
    审阅团草稿: right,
    snapshot: run.snapshot,
  });
  expect(crossCall[0]).toBe(settings);
  const body = `──────── 攒股收息 ────────\n\n${right}\n\n──────── AI手记 ────────\n\n${right}`;
  expect(JSON.parse(vi.mocked(complete).mock.calls[8][2]).draft).toBe(body);
  expect(run.finalText.startsWith(`${body}\n\n──────── 核对记录`)).toBe(true);
  const record = run.finalText.split('【互审】\n')[1];
  expect(record).toContain('〔攒股收息 审 AI手记〕');
  expect(record).toContain('"段落": "AI手记"');
  expect(record).toContain('"审出": "攒股收息"');
  expect(record).toContain('"改为": "现价21.7港元"');
  expect(run.finalText.indexOf('【互审】')).toBeLessThan(run.finalText.indexOf('【合并全文数字复核】'));
});

it('互审无法判定的冲突双方保留，正文两段都不删', async () => {
  const outputs = ['简报', wrap('CNOOC现价22.5港元。'), '[]', '简报', wrap('CNOOC现价21.7港元。'), '[]', '[]', '[]', '[]'];
  let call = 0;
  vi.mocked(complete).mockImplementation(async () => outputs[call++]);
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  expect(run.finalText).toContain('CNOOC现价22.5港元');
  expect(run.finalText).toContain('CNOOC现价21.7港元');
  for (const step of run.steps.slice(6, 8))
    expect(step.output!.split('【未改 · 双方保留】\n')[1]).toContain('"标记": "冲突"');
});
