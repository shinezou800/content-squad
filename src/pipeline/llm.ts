import type { Settings } from '../settings';
import { filterModelCheck } from './checks';
import { providerRequest, checkProviderStatus } from './providerRequest';
import { readSegment } from './stream';

async function proxyContent(settings: Settings, system: string, user: string): Promise<string> {
  let text = '';
  let noProgress = 0;
  const initial = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (let attempt = 1; attempt <= 12; attempt++) {
    const messages = text ? [...initial,
      { role: 'assistant', content: text },
      { role: 'user', content: '从上文最后一个字接着写，不要重复已写内容，不要加任何说明' },
    ] : initial;
    let response: Response | undefined;
    try {
      response = await providerRequest(settings, 'chat/completions', settings.key, {
        model: settings.model, messages, stream: true, max_tokens: 4096,
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    let added = '';
    if (response && response.status !== 546) {
      checkProviderStatus(response);
      const segment = await readSegment(response);
      added = segment.text;
      text += added;
      if (segment.finishReason != null && segment.finishReason !== 'length' && segment.finishReason !== 'stop')
        throw new Error(`模型提前结束生成（${segment.finishReason}），请调整内容后重试。`);
      if (segment.finishReason !== 'length' && (segment.done || segment.finishReason === 'stop')) return text;
    } else if (response?.body) {
      void response.body.cancel().catch(() => {});
    }
    noProgress = added ? 0 : noProgress + 1;
    if (noProgress >= 3 || attempt === 12)
      throw new Error(`模型流式返回中途断开（已重试 ${attempt} 次），请稍后重试。`);
  }
  throw new Error('模型流式返回中途断开，请稍后重试。');
}

export async function complete(settings: Settings, system: string, user: string) {
  if (!settings.useProxy && !settings.key.trim()) throw new Error('请先在设置中填写 API 密钥');
  let content: unknown;
  if (settings.useProxy) {
    content = await proxyContent(settings, system, user);
  } else {
    let res: Response;
    try {
      res = await providerRequest(settings, 'chat/completions', settings.key, {
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error('该接口拒绝了浏览器直接请求（可能不支持跨域）或网络不可达');
      throw error;
    }
    checkProviderStatus(res);
    const json = await res.json();
    content = json.choices?.[0]?.message?.content;
  }
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回空内容，请重试。');
  try {
    const input = JSON.parse(user);
    if (typeof input?.draft === 'string' && Array.isArray(input.snapshot))
      return filterModelCheck(content);
  } catch {
    // Non-JSON requests retain the original response.
  }
  return content;
}
