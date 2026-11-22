import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createCustomId,
  getRegistry,
  getMidRegistry,
  loadCustomSquads,
  loadCustomMids,
  saveCustomSquads,
  saveCustomMids,
  parseCustomCodes,
  validateCodes,
  validateName,
  validateMidMembers,
} from './custom';
import { registry, createSquad } from './registry';
import { midRegistry } from './mid';
import { complete } from '../pipeline/llm';
import { fetchSnapshot } from '../data/market';
import { runContentLine } from '../pipeline/selection';
import { pipelineCards, squadName } from './presentation';
import type { Context } from './types';

vi.mock('../pipeline/llm', () => ({ complete: vi.fn(async () => '[]') }));
vi.mock('../data/market', async (original) => ({
  ...(await original<typeof import('../data/market')>()),
  fetchSnapshot: vi.fn(async (codes: string[]) =>
    codes.map((code) => ({
      code,
      name: code,
      fields: [
        {
          label: '现价',
          value: 21.7,
          unit: code.length === 5 ? '港元' : '元',
          source: 'mock',
          fetchedAt: '',
        },
      ],
    })),
  ),
}));
const line = {
  id: 'custom-100',
  name: '白酒',
  codes: ['600519', '000858', '000568'],
  extraPrompt: '只记录香型。',
};
const mid = { id: 'custom-mid-100', name: '白酒联合记录', squads: [line.id, 'zangu-shouxi'] };
const settings = {
  baseUrl: 'https://example.com/v1',
  key: 'mock',
  model: 'mock',
  pool: '600519 贵州茅台 持仓 分红TTM=1.5元\n00883 中海油 观察池 分红TTM=1.49港元',
};
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('本地定义往返，修改及删除不影响另一种定义', () => {
  expect(loadCustomSquads()).toEqual([]);
  expect(loadCustomMids()).toEqual([]);
  expect(saveCustomSquads([line])).toBe(true);
  expect(saveCustomMids([mid])).toBe(true);
  expect(loadCustomSquads()).toEqual([line]);
  expect(loadCustomMids()).toEqual([mid]);
  expect([...values.keys()]).toEqual(['squad-custom-squads', 'squad-custom-mids']);
  saveCustomSquads([{ ...line, name: '白酒新定义' }]);
  expect(getRegistry()[line.id].name).toBe('白酒新定义');
  saveCustomSquads([]);
  expect(loadCustomSquads()).toEqual([]);
  expect(loadCustomMids()).toEqual([mid]);
});
it.each(['{broken', '{}', 'null', '[null]', '[{"id":"x"}]'])(
  '损坏或结构不符的数据安全回退：%s',
  (raw) => {
    values.set('squad-custom-squads', raw);
    values.set('squad-custom-mids', raw);
    expect(loadCustomSquads()).toEqual([]);
    expect(loadCustomMids()).toEqual([]);
  },
);
it('存储被禁用时读写不向 UI 抛错', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('full');
    },
  });
  expect(loadCustomSquads()).toEqual([]);
  expect(loadCustomMids()).toEqual([]);
  expect(saveCustomSquads([line])).toBe(false);
  expect(saveCustomMids([mid])).toBe(false);
  expect(Object.keys(getRegistry())).toEqual(Object.keys(registry));
});
it('自动 ID 使用独立前缀，同毫秒连续创建及已保存 ID 均不会冲突', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1234567890);
  saveCustomSquads([{ ...line, id: 'custom-1234567890' }]);
  const ids = [createCustomId(), createCustomId(), createCustomId(true)];
  expect(ids[0]).toMatch(/^custom-\d+$/);
  expect(ids[2]).toMatch(/^custom-mid-\d+$/);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('custom-1234567890');
  for (const id of ids) {
    expect(Object.hasOwn(registry, id)).toBe(false);
    expect(Object.hasOwn(midRegistry, id)).toBe(false);
  }
});
it('名称必须非空，跨内置/自定义小团及中团去重，编辑时排除自己', () => {
  expect(validateName('  ', [], [])).toContain('名称');
  for (const name of [...Object.values(registry), ...Object.values(midRegistry)].map((s) => s.name))
    expect(validateName(` ${name} `, [], [])).toContain('已存在');
  expect(validateName('白酒', [line], [mid])).toContain('已存在');
  expect(validateName(mid.name, [line], [mid])).toContain('已存在');
  expect(validateName(' 白酒 ', [line], [mid], line.id)).toBe('');
  expect(validateName('新名字', [line], [mid])).toBe('');
});
it('代码支持多种分隔符、前导零、HK，并去重；无效代码全部列出', () => {
  expect(parseCustomCodes(' 600519,000858，000568\n00883 000858 ')).toEqual({
    codes: ['600519', '000858', '000568', '00883'],
    invalid: [],
  });
  expect(validateCodes('00883')).toBe('');
  expect(validateCodes(' ,，\n ')).toContain('至少');
  const error = validateCodes('600519,12345a，1234 1234567');
  for (const code of ['12345a', '1234', '1234567']) expect(error).toContain(code);
});
it('中团成员必须至少两个、不重复且存在，不改变给定顺序', () => {
  const squads = getRegistry();
  expect(validateMidMembers([], squads)).toContain('至少');
  expect(validateMidMembers(['zangu-shouxi'], squads)).toContain('至少');
  expect(validateMidMembers(['zangu-shouxi', 'zangu-shouxi'], squads)).toContain('不同');
  expect(validateMidMembers(['missing', 'ai-shouji'], squads)).toContain('已删除');
  const ids = ['ai-shouji', 'zangu-shouxi'];
  expect(validateMidMembers(ids, squads)).toBe('');
  expect(ids).toEqual(['ai-shouji', 'zangu-shouxi']);
});
it('有效注册表内置优先、顺序稳定，自定义追加且不能占用内置跨类型 ID', () => {
  saveCustomSquads([{ ...line, id: 'zangu-shouxi' }, { ...line, id: 'mid-bank' }, line]);
  saveCustomMids([{ ...mid, id: 'mid-bank' }, { ...mid, id: 'bank-big4' }, mid]);
  const squads = getRegistry(),
    mids = getMidRegistry();
  expect(Object.keys(squads)).toEqual([...Object.keys(registry), line.id]);
  expect(Object.keys(mids)).toEqual([...Object.keys(midRegistry), mid.id]);
  expect(squads['zangu-shouxi']).toBe(registry['zangu-shouxi']);
  expect(mids['mid-bank']).toBe(midRegistry['mid-bank']);
});
it.each(['  只记录香型。\n保留换行与空格。  ', '  \n '])(
  '工厂三角色、段标题与可选提示词；只在小稿末尾逐字追加：%j',
  async (extra) => {
    const base = createSquad(line.id, line.name, line.codes),
      extended = createSquad(line.id, line.name, line.codes, extra);
    expect(extended.segmentTitle).toBe(line.name);
    expect(extended.roles.map((r) => [r.id, r.name])).toEqual([
      ['data', '小数'],
      ['draft', '小稿'],
      ['check', '小核'],
    ]);
    const ctx = (): Context => ({
      topic: '记录',
      settings,
      snapshot: [],
      outputs: { data: '简报', draft: '正文' },
    });
    for (const squad of [base, extended]) for (const role of squad.roles) await role.run(ctx());
    const prompts = vi.mocked(complete).mock.calls.map((call) => call[1]);
    expect(prompts[3]).toBe(prompts[0]);
    expect(prompts[5]).toBe(prompts[2]);
    expect(prompts[4]).toBe(prompts[1] + '\n' + extra);
    expect(prompts[0]).toContain('家公司');
  },
);
it('自定义工厂复用分类和手动分红，池外明确未持有', async () => {
  const squad = createSquad(line.id, line.name, ['600519', '00883', '000858']);
  const ctx: Context = { topic: '记录', settings, snapshot: [], outputs: {} };
  await squad.roles[0].run(ctx);
  expect(fetchSnapshot).toHaveBeenCalledWith(['600519', '00883', '000858'], {
    '600519': 1.5,
    '00883': 1.49,
  });
  expect(ctx.snapshot.map((s) => s.category)).toEqual(['持仓', '观察池', '未持有']);
});
it('选中的自定义单团实际分流到它自己的代码、提示词及四张卡片', async () => {
  saveCustomSquads([line]);
  const run = await runContentLine(line.id, '记录', settings, () => {});
  expect(run.squadId).toBe(line.id);
  expect(run.steps.map((s) => s.roleId)).toEqual(['data', 'draft', 'check']);
  expect(fetchSnapshot).toHaveBeenCalledWith(line.codes, { '600519': 1.5 });
  expect(vi.mocked(complete).mock.calls[1][1]).toContain(line.extraPrompt);
  expect(pipelineCards(line.id)).toHaveLength(4);
  expect(squadName(line.id)).toBe(line.name);
});
it('自定义中团按成员顺序执行，三步每团加复核，合并使用新注册表', async () => {
  saveCustomSquads([line]);
  saveCustomMids([mid]);
  const run = await runContentLine(mid.id, '记录', settings, () => {});
  expect(run.steps.map((s) => s.roleId)).toEqual([
    ...mid.squads.flatMap((id) => ['data', 'draft', 'check'].map((role) => `${id}:${role}`)),
    'merge:check',
  ]);
  expect(run.steps.every((s) => s.status === 'done')).toBe(true);
  expect(pipelineCards(mid.id)).toHaveLength(7);
  expect(pipelineCards(mid.id)[0].name).toBe('白酒 · 小数');
  expect(run.finalText).toMatch(/^──────── 白酒 ────────/);
  expect(run.snapshot.map((s) => s.code)).toEqual(['600519', '000858', '000568', '00883']);
});
it('删除后历史显示未知内容线且安全渲染，单团和引用它的中团均不能误跑默认团', async () => {
  saveCustomSquads([line]);
  saveCustomMids([mid]);
  saveCustomSquads([]);
  expect(squadName(line.id)).toBe('未知内容线');
  expect(() => pipelineCards(mid.id)).not.toThrow();
  expect(() =>
    pipelineCards(line.id, [{ roleId: 'data' }, { roleId: 'draft' }, { roleId: 'check' }]),
  ).not.toThrow();
  await expect(runContentLine(line.id, '记录', settings, () => {})).rejects.toThrow('已删除');
  await expect(runContentLine(mid.id, '记录', settings, () => {})).rejects.toThrow('已删除');
  expect(fetchSnapshot).not.toHaveBeenCalled();
});
