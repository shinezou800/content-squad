import { afterEach, expect, it, vi } from 'vitest';
import { complete } from './llm';
const settings = { key: 'test-only', model: 'free', pool: '' };
afterEach(() => vi.unstubAllGlobals());
it('未填密钥时不发请求', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(complete({ ...settings, key: '' }, '', '')).rejects.toThrow('密钥');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [401, '密钥无效'],
  [429, '过于频繁'],
  [500, '模型请求失败'],
])('中文错误 %s', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: false }));
  await expect(complete(settings, '', '')).rejects.toThrow(message);
});
it('处理正常和空模型输出', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '正文' } }] }),
      }),
  );
  expect(await complete(settings, '规则', '选题')).toBe('正文');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }),
  );
  await expect(complete(settings, '', '')).rejects.toThrow('空内容');
});
