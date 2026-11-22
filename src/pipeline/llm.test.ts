import { afterEach, expect, it, vi } from 'vitest';
import { complete } from './llm';
const settings = { key: 'test-only', model: 'free', pool: '' };
afterEach(() => vi.unstubAllGlobals());
it('仅核对请求过滤模型舍入差异，写作和非JSON请求不变', async () => {
  const content = JSON.stringify([{ 原文: '7.00%', 数据源值: '6.9975%', 问题: '差异' }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ choices: [{ message: { content } }] }),
  }));
  expect(await complete(settings, '核对', JSON.stringify({ draft: '股息率7.00%', snapshot: [] }))).toBe('[]');
  expect(await complete(settings, '写作', JSON.stringify({ topic: '股息', snapshot: [] }))).toBe(content);
  expect(await complete(settings, '其他', '非JSON')).toBe(content);
});
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
