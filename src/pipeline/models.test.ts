import { afterEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../settings';
import { fetchModels } from './models';

afterEach(() => vi.unstubAllGlobals());
it.each([
  ['https://openrouter.ai/api/v1/', ['a:free']],
  ['https://openrouter.ai:443/api/v1', ['a:free']],
  ['https://example.com/v1///', ['a:free', 'z-paid']],
])('API %s 使用正确模型过滤', async (baseUrl, expected) => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'z-paid' }, { id: 'a:free' }] }) });
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchModels({ ...defaultSettings, baseUrl, key: 'test-only' }, defaultSettings)).toEqual(expected);
  expect(fetcher.mock.calls[0][0]).toBe(baseUrl.replace(/\/+$/, '') + '/models');
  expect(fetcher.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test-only' });
});
it('空模型列表正常返回，失败请求抛出错误', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
  expect(await fetchModels(defaultSettings, defaultSettings)).toEqual([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(fetchModels(defaultSettings, defaultSettings)).rejects.toThrow('模型列表加载失败');
});
it.each([
  ['https://example.com/v1', 'saved-key', {}],
  ['https://example.com/v1', 'new-key', { Authorization: 'Bearer new-key' }],
  [defaultSettings.baseUrl + '/', 'saved-key', { Authorization: 'Bearer saved-key' }],
  ['https://example.com/v1', '', {}],
])('地址 %s 的模型请求仅在允许时发送表单密钥', async (baseUrl, key, headers) => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal('fetch', fetcher);
  await fetchModels({ ...defaultSettings, baseUrl, key }, { ...defaultSettings, key: 'saved-key' });
  expect(fetcher.mock.calls[0][1].headers).toEqual(headers);
});
