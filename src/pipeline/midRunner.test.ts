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
  key: 'private-key',
  model: 'test-model',
  pool: '00883 中海油 观察池 分红TTM=1.49港元',
};
const mid = midRegistry['mid-zangu-ai'];
const wrap = (text: string) =>
  `⚠️ 模拟盘记录。${text}\n持仓披露：观察池记录。\n非投资建议。数据来源：腾讯行情、主人手动提供。`;
const draftA = wrap('攒股记录，现价21.7港元。');
const draftB = wrap('AI 实测手记，每股分红1.49港元。');
const responses = ['数据简报甲', draftA, '[]', '数据简报乙', draftB, '[]', '[]'];
it('golden: mid-zangu-ai finalText and step IDs stay byte-identical', async () => {
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  expect(run.steps.map((step) => step.roleId)).toEqual([
    'zangu-shouxi:data',
    'zangu-shouxi:draft',
    'zangu-shouxi:check',
    'ai-shouji:data',
    'ai-shouji:draft',
    'ai-shouji:check',
    'merge:check',
  ]);
  const review = '【规则核对】\n[]\n\n【模型事实核对】\n[]';
  expect(run.finalText).toBe(
    `${draftA}\n\n──────── AI手记 ────────\n\n${draftB}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n【攒股收息段】\n${review}\n\n【AI手记段】\n${review}\n\n【合并全文数字复核】\n${review}`,
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
    'merge:check',
  ];
  expect(run.squadId).toBe(mid.id);
  expect(run.steps.map((step) => step.roleId)).toEqual(ids);
  expect(
    progress
      .filter((value) => value.steps.some((step) => step.status === 'running'))
      .map((value) => value.steps.find((step) => step.status === 'running')!.roleId),
  ).toEqual(ids);
  expect(progress).toHaveLength(16);
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
  expect(complete).toHaveBeenCalledTimes(7);
  expect(vi.mocked(complete).mock.calls.every((call) => call[0] === settings)).toBe(true);
  expect(JSON.stringify(run)).not.toContain('private-key');
});

it('正文不改写且依次排列，独立核对及合并核对统一置于正文之后', async () => {
  const run = await runMidPipeline(mid, '选题', settings, () => {});
  const body = `${draftA}\n\n──────── AI手记 ────────\n\n${draftB}`;
  expect(run.finalText).toBe(
    `${body}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n【攒股收息段】\n${run.steps[2].output}\n\n【AI手记段】\n${run.steps[5].output}\n\n【合并全文数字复核】\n${run.steps[6].output}`,
  );
  expect(vi.mocked(complete).mock.calls[6][1]).toContain('小核 · 合并复核');
  expect(vi.mocked(complete).mock.calls[6][1]).toContain('不改写正文');
  expect(JSON.parse(vi.mocked(complete).mock.calls[6][2])).toEqual({
    draft: body,
    snapshot: run.snapshot,
  });
});

it.each([0, 4, 6])('步骤失败立即停止，后续不执行，不产生成稿：%s', async (failure) => {
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
    run.steps[6].output!.split('【规则核对】\n')[1].split('\n\n【模型事实核对】')[0],
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
