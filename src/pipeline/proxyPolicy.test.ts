import { expect, it, vi } from 'vitest';
import { allowedOrigin, proxyTarget } from '../../supabase/functions/llm-proxy/policy.ts';
import { createProxyHandler } from '../../supabase/functions/llm-proxy/handler.ts';

const body = { baseUrl: 'https://developer.amd.com.cn/radeon/api/v1/', path: 'models', key: 'test-only' };
it('允许列表构建准确目标地址', () => {
  expect(proxyTarget(body, 'developer.amd.com.cn').url).toBe('https://developer.amd.com.cn/radeon/api/v1/models');
  expect(proxyTarget({ ...body, path: 'chat/completions', payload: { model: 'test' } }, 'developer.amd.com.cn').url).toContain('/chat/completions');
});
it.each([
  { ...body, baseUrl: 'https://example.com/v1' },
  { ...body, baseUrl: 'http://developer.amd.com.cn/v1' },
  { ...body, baseUrl: 'https://developer.amd.com.cn.evil.example/v1' },
  { ...body, baseUrl: 'https://user:pass@developer.amd.com.cn/v1' },
  { ...body, baseUrl: 'https://developer.amd.com.cn:8080/v1' },
  { ...body, baseUrl: 'https://developer.amd.com.cn/v1?' },
  { ...body, path: '../other' },
  { ...body, path: 'chat/completions' },
  {}, null,
])('无效端点或请求被拒绝 %j', (input) => {
  expect(() => proxyTarget(input, 'developer.amd.com.cn')).toThrow();
});
it.each([
  ['https://shinezou800.github.io', true], ['http://localhost:5173', true],
  ['http://localhost', true], ['https://evil.example', false],
  ['https://shinezou800.github.io.evil.example', false], ['http://localhost.evil.example', false], ['', false],
])('Origin %s → %s', (origin, expected) => expect(allowedOrigin(origin)).toBe(expected));

function setup(userId: string | undefined = 'owner') {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"error":"limited"}', { status: 429, headers: { 'Content-Type': 'application/json' } }));
  const getUserId = vi.fn().mockResolvedValue(userId);
  return { fetcher, getUserId, handler: createProxyHandler({ ownerId: 'owner', allowedHosts: 'developer.amd.com.cn', getUserId, fetch: fetcher }) };
}
function request(token = 'user-token', input: unknown = body) {
  return new Request('https://proxy.example', { method: 'POST', headers: { Origin: 'https://shinezou800.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
}
it('预检无需认证并返回浏览器所需 CORS 头', async () => {
  const { handler, fetcher } = setup();
  const response = await handler(new Request('https://proxy.example', { method: 'OPTIONS', headers: { Origin: 'https://shinezou800.github.io' } }));
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe('https://shinezou800.github.io');
  expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['', 'sb_publishable_test'])('无用户 token 拒绝转发 %s', async (token) => {
  const { handler, fetcher, getUserId } = setup();
  expect((await handler(request(token))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getUserId).not.toHaveBeenCalled();
});
it.each([['', 401], ['other', 403]])('认证失败或非 owner 不转发', async (id, status) => {
  const { fetcher } = setup();
  const invalidHandler = createProxyHandler({ ownerId: 'owner', allowedHosts: 'developer.amd.com.cn', getUserId: async () => id || undefined, fetch: fetcher });
  expect((await invalidHandler(request())).status).toBe(status);
  expect(fetcher).not.toHaveBeenCalled();
});
it('owner 请求保留上游状态及正文且不跟随重定向', async () => {
  const { handler, fetcher, getUserId } = setup();
  const response = await handler(request());
  expect(getUserId).toHaveBeenCalledWith('user-token');
  expect(response.status).toBe(429);
  expect(await response.text()).toBe('{"error":"limited"}');
  expect(fetcher).toHaveBeenCalledWith('https://developer.amd.com.cn/radeon/api/v1/models', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, redirect: 'manual' }));
});
it('owner 聊天请求以 JSON POST 转发', async () => {
  const { handler, fetcher } = setup();
  await handler(request('user-token', { ...body, path: 'chat/completions', payload: { model: 'test' } }));
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"model":"test","stream":true}' });
});
it('聊天强制 stream:true 并原样传递 SSE 流及状态，不缓冲正文', async () => {
  const { handler, fetcher } = setup();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const upstream = new Response(stream, { status: 201, headers: { 'Content-Type': 'text/event-stream' } });
  fetcher.mockResolvedValue(upstream);
  const response = await handler(request('user-token', { ...body, path: 'chat/completions', payload: { model: 'test', stream: false } }));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: 'test', stream: true });
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect(response.headers.get('access-control-expose-headers')).toBe('content-type');
  expect(response.body).toBe(upstream.body);
  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
  controller.close();
  expect(await response.text()).toBe('data: [DONE]\n\n');
});
it('禁止来源和非法目标均不转发', async () => {
  const { handler, fetcher } = setup();
  expect((await handler(new Request('https://proxy.example', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }))).status).toBe(403);
  expect((await handler(request('user-token', { ...body, baseUrl: 'https://evil.example/v1' }))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('上游网络失败只返回通用错误', async () => {
  const { handler, fetcher } = setup();
  fetcher.mockRejectedValue(new TypeError('private upstream detail'));
  const response = await handler(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'Upstream unavailable' });
});
