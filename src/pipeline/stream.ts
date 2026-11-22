export type Segment = { text: string; finishReason?: string; done: boolean };

export async function readSegment(response: Response): Promise<Segment> {
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
    const json = await response.json();
    if (json.error) throw modelStreamError(json.error);
    const choice = json.choices?.[0];
    return {
      text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
      finishReason: choice?.finish_reason,
      done: true,
    };
  }
  const segment: Segment = { text: '', done: false };
  if (!response.body) return segment;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { return segment; }
      if (chunk.done) return segment;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          segment.done = true;
          return segment;
        }
        let event;
        try { event = JSON.parse(data); }
        catch { throw new Error('模型流式返回格式无效，请稍后重试。'); }
        if (event?.error) throw modelStreamError(event.error);
        const choice = event?.choices?.[0];
        if (typeof choice?.delta?.content === 'string') segment.text += choice.delta.content;
        if (typeof choice?.finish_reason === 'string') segment.finishReason = choice.finish_reason;
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
