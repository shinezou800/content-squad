import { afterEach, expect, it, vi } from 'vitest';
import { complete } from './llm';
const settings = { useProxy: false, baseUrl: 'https://example.com/v1', key: 'test-only', model: 'free', pool: '' };
afterEach(() => vi.unstubAllGlobals());
it('自定义 API 地址去除尾部斜线，保留请求模型与核对过滤', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '[]' } }] }) });
  vi.stubGlobal('fetch', fetcher);
  await complete({ ...settings, baseUrl: 'https://example.com/v1///' }, '核对', '{}');
  expect(fetcher.mock.calls[0][0]).toBe('https://example.com/v1/chat/completions');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    model: settings.model,
    messages: [{ role: 'system', content: '核对' }, { role: 'user', content: '{}' }],
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('stream');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('max_tokens');
});
it.each([401, 429, 'missing', 'network'])('自定义接口错误不包含供应商名称 %s', async (failure) => {
  vi.stubGlobal('fetch', failure === 'network'
    ? vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    : vi.fn().mockResolvedValue({ status: failure, ok: false }));
  const error = await complete({ ...settings, key: failure === 'missing' ? '' : settings.key }, '', '').catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('预期请求失败');
  expect(error.message).not.toContain('OpenRouter');
  if (failure === 'network') expect(error.message).toBe('该接口拒绝了浏览器直接请求（可能不支持跨域）或网络不可达');
  if (failure === 'missing') expect(error.message).toBe('请先在设置中填写 API 密钥');
});
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
  [429, '请求频繁或额度已用尽'],
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
