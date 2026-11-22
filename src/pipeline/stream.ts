export type Segment = { text: string; finishReason?: string; done: boolean };

export async function readSegment(response: Response): Promise<Segment> {
  const segment: Segment = { text: '', done: false };
  if (!response.body) return segment;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let mode: 'sse' | 'json' | undefined = response.headers?.get('content-type')?.includes('text/event-stream') ? 'sse' : undefined;
  let started = false;
  let skipLf = false;
  let data: string[] = [];
  const dispatch = () => {
    if (!data.length) return;
    const value = data.join('\n');
    data = [];
    if (value === '[DONE]') {
      segment.done = true;
      return;
    }
    let event;
    try { event = JSON.parse(value); }
    catch { throw new Error('模型流式返回格式无效，请稍后重试。'); }
    if (event?.error) throw modelStreamError(event.error);
    const choice = event?.choices?.[0];
    if (typeof choice?.delta?.content === 'string') segment.text += choice.delta.content;
    if (typeof choice?.finish_reason === 'string') segment.finishReason = choice.finish_reason;
  };
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { return segment; }
      if (chunk.done) {
        buffer += decoder.decode();
        if (mode !== 'sse') {
          let json;
          try { json = JSON.parse(buffer); }
          catch { throw new Error('模型返回格式无法识别，请稍后重试。'); }
          if (json?.error) throw modelStreamError(json.error);
          if (!json || typeof json !== 'object' || !Array.isArray(json.choices))
            throw new Error('模型返回格式无法识别，请稍后重试。');
          const choice = json?.choices?.[0];
          return {
            text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
            finishReason: choice?.finish_reason,
            done: true,
          };
        }
        dispatch();
        return segment;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!started) {
        buffer = buffer.trimStart();
        if (!buffer) continue;
        started = true;
      }
      if (!mode) {
        const prefixes = [':', 'data:', 'event:', 'id:', 'retry:'];
        if (prefixes.some((prefix) => buffer.startsWith(prefix))) mode = 'sse';
        else if (prefixes.some((prefix) => prefix.startsWith(buffer))) continue;
        else mode = 'json';
      }
      if (mode === 'json') continue;
      if (skipLf && buffer.length) {
        if (buffer.startsWith('\n')) buffer = buffer.slice(1);
        skipLf = false;
      }
      let end: number;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        const line = buffer.slice(0, end);
        const cr = buffer[end] === '\r';
        buffer = buffer.slice(end + 1);
        if (cr) {
          if (buffer.startsWith('\n')) buffer = buffer.slice(1);
          else if (!buffer.length) skipLf = true;
        }
        if (!line) dispatch();
        else if (line === 'data') data.push('');
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        if (segment.done || segment.finishReason !== undefined) return segment;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function modelStreamError(error: { message?: unknown } | string): Error {
  const message = typeof error === 'string' ? error : error.message;
  return new Error(`模型流式返回错误：${typeof message === 'string' ? message : '未知错误'}`);
}
