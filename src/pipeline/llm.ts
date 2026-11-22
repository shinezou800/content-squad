import type { Settings } from '../settings';
import { normalizeBaseUrl } from '../settings';
import { filterModelCheck } from './checks';
export async function complete(settings: Settings, system: string, user: string) {
  if (!settings.key.trim()) throw new Error('请先在设置中填写 API 密钥');
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error('该接口拒绝了浏览器直接请求（可能不支持跨域）或网络不可达');
    throw error;
  }
  if (res.status === 401) throw new Error('API 密钥无效或已过期，请在设置中检查。');
  if (res.status === 429)
    throw new Error('请求频繁或额度已用尽，请稍后重试或更换模型。');
  if (!res.ok) throw new Error(`模型请求失败（${res.status}），请稍后重试。`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
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
