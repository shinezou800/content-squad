import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../settings';
import { providerRequest } from './providerRequest';
import { complete } from './llm';
import { fetchModels } from './models';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../storage/supabase', () => ({ supabase: { auth: { getSession } } }));
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://tvxmlknddhwykgzxrvhl.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  getSession.mockResolvedValue({ data: { session: { access_token: 'session-test' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('默认直接请求，不读取云端会话', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  await providerRequest(defaultSettings, 'models', '');
  expect(fetcher.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
  expect(getSession).not.toHaveBeenCalled();
});
it('勾选代理后使用会话鉴权且模型核对过滤仍生效', async () => {
  const content = JSON.stringify([{ 原文: '7.00%', 数据源值: '6.9975%', 问题: '数值不符' }]);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content } }] }));
  vi.stubGlobal('fetch', fetcher);
  const settings = { ...defaultSettings, useProxy: true, key: 'upstream-test' };
  expect(await complete(settings, '', JSON.stringify({ draft: '7.00%', snapshot: [] }))).toBe('[]');
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://tvxmlknddhwykgzxrvhl.supabase.co/functions/v1/llm-proxy');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer session-test', apikey: 'sb_publishable_test' });
  expect(JSON.parse(options.body)).toMatchObject({ path: 'chat/completions', key: 'upstream-test', payload: { model: settings.model } });
});
it('模型列表走代理，仍不把旧密钥发往新地址', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'test' }] }) });
  vi.stubGlobal('fetch', fetcher);
  const saved = { ...defaultSettings, key: 'old-test' };
  expect(await fetchModels({ ...saved, baseUrl: 'https://example.com/v1', useProxy: true }, saved)).toEqual(['test']);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ key: '', path: 'models' });
});
it('未登录不发送请求', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(complete({ ...defaultSettings, useProxy: true }, '', '')).rejects.toThrow('云端转发需要先登录');
  await expect(fetchModels({ ...defaultSettings, useProxy: true }, defaultSettings)).rejects.toThrow('云端转发需要先登录');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([[401, '密钥无效'], [429, '请求频繁'], [502, '502']])('代理上游错误映射 %s', async (status, error) => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(null, { status })));
  await expect(complete({ ...defaultSettings, useProxy: true, key: 'test-only' }, '', '')).rejects.toThrow(error);
});
