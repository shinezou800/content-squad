import { afterEach, expect, it, vi } from 'vitest';
import { runPipeline } from './runner';
import type { Squad } from '../squads/types';
const settings = { key: 'private-key', model: 'test', pool: '' };
afterEach(() => vi.unstubAllGlobals());

it.each([undefined, {}])('缺少 randomUUID 时仍能生成不同的运行标识：%s', async (crypto) => {
  vi.stubGlobal('crypto', crypto);
  const squad: Squad = {
    id: 'test',
    name: '',
    description: '',
    roles: [],
    pipeline: [],
    template: () => '',
  };
  const first = await runPipeline(squad, '', settings, () => {});
  const second = await runPipeline(squad, '', settings, () => {});
  expect(first.id).not.toBe('');
  expect(second.id).not.toBe(first.id);
});

it('可用时使用原生 randomUUID', async () => {
  const randomUUID = vi.fn(() => 'native-id');
  vi.stubGlobal('crypto', { randomUUID });
  const squad: Squad = {
    id: 'test',
    name: '',
    description: '',
    roles: [],
    pipeline: [],
    template: () => '',
  };
  expect((await runPipeline(squad, '', settings, () => {})).id).toBe('native-id');
  expect(randomUUID).toHaveBeenCalledOnce();
});
it('按顺序仅执行一次，保存输入输出时间并发出进度，不保存密钥', async () => {
  const called: string[] = [];
  const progress: string[] = [];
  const squad: Squad = {
    id: 'test',
    name: '测试',
    description: '',
    roles: ['a', 'b'].map((id) => ({
      id,
      name: id,
      title: id,
      run: async (ctx) => {
        called.push(id);
        return id + ctx.topic;
      },
    })),
    pipeline: ['a', 'b'],
    template: (ctx) => ctx.outputs.b,
  };
  const run = await runPipeline(squad, '选题', settings, (r) => progress.push(JSON.stringify(r)));
  expect(called).toEqual(['a', 'b']);
  expect(run.finalText).toBe('b选题');
  expect(
    run.steps.every(
      (s) => s.status === 'done' && s.startedAt && s.finishedAt && s.input && s.output,
    ),
  ).toBe(true);
  expect(progress.length).toBeGreaterThan(4);
  expect(JSON.stringify(run)).not.toContain('private-key');
});
it('失败停止，不执行后续步骤', async () => {
  const next = vi.fn();
  const run = await runPipeline(
    {
      id: 't',
      name: '',
      description: '',
      roles: [
        {
          id: 'a',
          name: '',
          title: '',
          run: async () => {
            throw new Error('请求失败');
          },
        },
        { id: 'b', name: '', title: '', run: next },
      ],
      pipeline: ['a', 'b'],
      template: () => '',
    },
    '',
    settings,
    () => {},
  );
  expect(run.steps[0].error).toBe('请求失败');
  expect(run.steps[1].status).toBe('pending');
  expect(next).not.toHaveBeenCalled();
  expect(run.finalText).toBe('');
});
it('空流水线可生成固定模板，重复步骤拒绝', async () => {
  const squad: Squad = {
    id: 't',
    name: '',
    description: '',
    roles: [],
    pipeline: [],
    template: () => '',
  };
  expect((await runPipeline(squad, '', settings, () => {})).steps).toEqual([]);
  await expect(
    runPipeline({ ...squad, pipeline: ['a', 'a'] }, '', settings, () => {}),
  ).rejects.toThrow('配置无效');
});
