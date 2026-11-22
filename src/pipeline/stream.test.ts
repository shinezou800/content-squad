import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../settings';
import { complete } from './llm';
import { readSegment } from './stream';

vi.mock('../storage/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'session-test' } } }) } } }));
const settings = { ...defaultSettings, key: 'test-only', useProxy: true };
const encoder = new TextEncoder();
const event = (content: string, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
function sse(chunks: (string | Uint8Array)[], broken = false) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      } else if (broken) controller.error(new TypeError('interrupted'));
      else controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
function success(text = '完成') { return sse([event(text, 'stop'), 'data: [DONE]\n\n']); }
function withoutSseHeader(chunks: string[], broken = false, contentType?: string) {
  return new Response(sse(chunks, broken).body, { headers: contentType ? { 'Content-Type': contentType } : {} });
}
it.each([undefined, 'application/json'])('无 SSE Content-Type 时嗅探 ping 和跨 chunk data：%s', async (contentType) => {
  const response = withoutSseHeader(['\uFEFF  \n: pi', 'ng\n\nda', 'ta: {"choices":[{"delta":{"content":"正文"}}]}\n\n', 'data: [DONE]\n\n', event('不应读取')], false, contentType);
  expect(await readSegment(response)).toEqual({ text: '正文', done: true });
});
it.each(['data:', 'event:', 'id:', 'retry:'])('跨 chunk 嗅探 SSE 字段 %s', async (field) => {
  const prefix = field === 'data:' ? '' : `${field} test\n`;
  const text = prefix + event('正文', 'stop');
  expect(await readSegment(withoutSseHeader([...text]))).toMatchObject({ text: '正文', finishReason: 'stop' });
});
it('无 Content-Type 的 JSON 正文回退解析', async () => {
  const json = JSON.stringify({ choices: [{ message: { content: 'JSON正文' }, finish_reason: 'stop' }] });
  expect(await readSegment(withoutSseHeader(['\uFEFF \n', json.slice(0, 5), json.slice(5)]))).toEqual({ text: 'JSON正文', finishReason: 'stop', done: true });
});
it.each(['garbage', '', '{invalid json'])('无法识别的正文给出中文错误：%s', async (text) => {
  await expect(readSegment(withoutSseHeader([text]))).rejects.toThrow('模型返回格式无法识别');
});
it('嗅探后的 SSE 断流不作为完成，持续断流明确报错', async () => {
  const chunks = [': ping\n\n', event('部分'), 'data: {"choices":'];
  expect(await readSegment(withoutSseHeader(chunks, true))).toEqual({ text: '部分', done: false });
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(withoutSseHeader([': ping\n\n', 'data: {'], true)));
  fetcher.mockResolvedValueOnce(withoutSseHeader(chunks, true));
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('模型流式返回中途断开（已重试 4 次）');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('JSON 正文读取中断也不返回部分成功', async () => {
  expect(await readSegment(withoutSseHeader(['{"choices":'], true))).toEqual({ text: '', done: false });
});
it('支持仅 CR 分隔的事件', async () => {
  expect(await readSegment(sse([event('正文', 'stop').replaceAll('\n', '\r')]))).toMatchObject({ text: '正文', finishReason: 'stop' });
});
it.each(['stop', 'length', 'content_filter'])('finish_reason=%s 无需等待流关闭，并取消 reader', async (reason) => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(event('保留正文', reason))); },
    cancel,
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  expect(await readSegment(response)).toEqual({ text: '保留正文', finishReason: reason, done: false });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('多个 data 行按换行合并，在空行或 EOF 派发事件', async () => {
  const data = 'data: {"choices":\r\ndata: [{"delta":{"content":"正文"}}]}\r\n';
  expect(await readSegment(sse([data, '\r\n', 'data: [DONE]\n\n']))).toMatchObject({ text: '正文', done: true });
  expect(await readSegment(sse([data]))).toMatchObject({ text: '正文' });
});
it('CRLF 跨 chunk 时不提前派发多行事件', async () => {
  expect(await readSegment(sse(['data: {"choices":\r', '\ndata: [{"delta":{"content":"正文"}}]}\r', '\n\r', '\n']))).toMatchObject({ text: '正文' });
});
function payload(fetcher: ReturnType<typeof vi.fn>, index: number) { return JSON.parse(fetcher.mock.calls[index][1].body).payload; }
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://tvxmlknddhwykgzxrvhl.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('跨 data 行和 UTF8 字节边界拼接中文，忽略注释及推理', async () => {
  const bytes = encoder.encode(': comment\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"不输出"}}]}\n\n' + event('中文🙂') + event('完成', 'stop') + 'data: [DONE]\n\n');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([...bytes].map((byte) => Uint8Array.of(byte)))));
  expect(await complete(settings, '规则', '选题')).toBe('中文🙂完成');
});
it('代理不支持 SSE 时回退 JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '非流式正文' }, finish_reason: 'stop' }] })));
  expect(await complete(settings, '', '')).toBe('非流式正文');
});
it('length 续写带上完整 assistant 正文并拼接最终结果', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse([event('第一段', 'length'), 'data: [DONE]\n\n'])).mockResolvedValueOnce(success('第二段'));
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '规则', '选题')).toBe('第一段第二段');
  expect(payload(fetcher, 0)).toEqual({ model: settings.model, messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '选题' }], stream: true, max_tokens: 4096 });
  expect(payload(fetcher, 1).messages).toEqual([
    ...payload(fetcher, 0).messages,
    { role: 'assistant', content: '第一段' },
    { role: 'user', content: '从上文最后一个字接着写，不要重复已写内容，不要加任何说明' },
  ]);
});
it('JSON length 也发起续写', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '前半' }, finish_reason: 'length' }] })).mockResolvedValueOnce(success('后半'));
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '', '')).toBe('前半后半');
});
it.each([true, false])('中断后保留完整 data 行，丢弃尾部残行并续写：reader throws=%s', async (broken) => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse([event('保留'), 'data: {"choices":[{"delta":{"content":"丢弃'], broken)).mockResolvedValueOnce(success('续写'));
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '', '')).toBe('保留续写');
  expect(payload(fetcher, 1).messages[2]).toEqual({ role: 'assistant', content: '保留' });
});
it('连续三次无进展报错，不返回已生成的部分正文', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse([], true)));
  fetcher.mockResolvedValueOnce(sse([event('未完成')], true));
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('模型流式返回中途断开（已重试 4 次）');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('无任何正文的断流三次失败，同样消息重试', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse([], true)));
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('已重试 3 次');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(payload(fetcher, 0).messages).toEqual(payload(fetcher, 2).messages);
});
it('持续有进展也最多十二段，不静默返回半篇', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse([event('片段', 'length')])));
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('已重试 12 次');
  expect(fetcher).toHaveBeenCalledTimes(12);
});
it('546 后重试同样消息成功', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 546 })).mockResolvedValueOnce(success());
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '', '')).toBe('完成');
  expect(payload(fetcher, 0).messages).toEqual(payload(fetcher, 1).messages);
});
it('后续 fetch TypeError 作为中断重试，不误报浏览器 CORS', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse([event('上文', 'length')])).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(success('下文'));
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '', '')).toBe('上文下文');
  expect(payload(fetcher, 1).messages).toEqual(payload(fetcher, 2).messages);
});
it('data error 直接报错，不再续写', async () => {
  const fetcher = vi.fn().mockResolvedValue(sse([event('部分'), 'data: {"error":{"message":"额度不足"}}\n\n']));
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('模型流式返回错误：额度不足');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['sse', 'json'])('非正常 finish_reason 直接报错，不重试或返回部分正文：%s', async (format) => {
  const response = format === 'sse' ? sse([event('部分正文', 'content_filter')])
    : Response.json({ choices: [{ message: { content: '部分正文' }, finish_reason: 'content_filter' }] });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  await expect(complete(settings, '', '')).rejects.toThrow('模型提前结束生成（content_filter），请调整内容后重试。');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([event('仅 stop', 'stop'), event('仅 DONE') + 'data: [DONE]\n\n'])('正常终止标志足够结束', async (data) => {
  const fetcher = vi.fn().mockResolvedValue(sse([data]));
  vi.stubGlobal('fetch', fetcher);
  expect(await complete(settings, '', '')).toMatch(/仅 (?:stop|DONE)/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('完整空响应仍走原有空内容检查', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success('')));
  await expect(complete(settings, '', '')).rejects.toThrow('模型返回空内容');
});
