import { normalizeBaseUrl, type Settings } from '../settings';
import { filterModelCheck } from './checks';
import { providerRequest, checkProviderStatus, proxyStatusError } from './providerRequest';
import { readSegment } from './stream';

const proxyMaxTokens = 2048;
const relayRetryStatuses = new Set([502, 504, 546]);
const radeonThinkingModels = new Set(['glm-5.3-flash', 'qwen3.8-27b']);

async function proxyContent(settings: Settings, system: string, user: string): Promise<string> {
  const canReduceThinking = new URL(normalizeBaseUrl(settings.baseUrl)).hostname === 'developer.amd.com.cn'
    && radeonThinkingModels.has(settings.model.toLowerCase());
  let reduceThinking = false;
  let text = '';
  let noProgress = 0;
  let relayError: Error | undefined;
  const initial = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (let attempt = 1; attempt <= 12; attempt++) {
    const messages = text ? [...initial,
      { role: 'assistant', content: text },
      { role: 'user', content: '从上文最后一个字接着写，不要重复已写内容，不要加任何说明' },
    ] : initial;
    let response: Response | undefined;
    try {
      response = await providerRequest(settings, 'chat/completions', settings.key, {
        model: settings.model, messages, stream: true, max_tokens: proxyMaxTokens,
        ...(reduceThinking ? { reasoning_effort: 'low' } : {}),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    let added = '';
    if (response?.ok) {
      const segment = await readSegment(response);
      added = segment.text;
      text += added;
      if (segment.finishReason != null && segment.finishReason !== 'length' && segment.finishReason !== 'stop')
        throw new Error(`模型提前结束生成（${segment.finishReason}），请调整内容后重试。`);
      if (segment.finishReason !== 'length' && (segment.done || segment.finishReason === 'stop')) return text;
      // Radeon counts reasoning against max_tokens, so a reasoning-only retry needs a lower effort.
      if (!added && canReduceThinking) reduceThinking = true;
    } else if (response) {
      const upstreamHttp = response.headers.get('x-llm-proxy-error') === 'upstream-http';
      if (upstreamHttp || !relayRetryStatuses.has(response.status)) {
        if (response.status === 401 || response.status === 429) checkProviderStatus(response);
        throw await proxyStatusError(response, settings.key);
      }
      relayError = await proxyStatusError(response, settings.key);
    }
    if (added) relayError = undefined;
    noProgress = added ? 0 : noProgress + 1;
    if (noProgress >= 3 || attempt === 12)
      throw new Error(`模型流式返回中途断开（已重试 ${attempt} 次），请稍后重试。${relayError ? ` ${relayError.message}` : ''}`);
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
