import { afterEach, expect, it, vi } from 'vitest';
import { registry } from './registry';
import { complete } from '../pipeline/llm';
import type { Context } from './types';

vi.mock('../pipeline/llm', () => ({ complete: vi.fn(async () => '[]') }));
vi.mock('../data/market', async (original) => ({
  ...(await original<typeof import('../data/market')>()),
  fetchSnapshot: vi.fn(async () => []),
}));
afterEach(() => vi.clearAllMocks());
it.each(['bank-big4', 'bank-joint', 'bank-city'])('银行三角色提示词字节不变：%s', async (id) => {
  const ctx: Context = {
    topic: '记录',
    settings: { key: '', model: 'mock', pool: '601398 工商银行 持仓' },
    snapshot: [],
    outputs: { data: '简报', draft: '正文' },
  };
  for (const role of registry[id].roles) await role.run(ctx);
  expect(vi.mocked(complete).mock.calls.map((call) => call[1])).toMatchSnapshot();
});
