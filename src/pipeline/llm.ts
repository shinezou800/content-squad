import type { Settings } from '../settings';
import { filterModelCheck } from './checks';
import { providerRequest, checkProviderStatus } from './providerRequest';
export async function complete(settings: Settings, system: string, user: string) {
  if (!settings.useProxy && !settings.key.trim()) throw new Error('请先在设置中填写 API 密钥');
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
