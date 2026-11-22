import { normalizeBaseUrl, type Settings } from '../settings';
import { supabase } from '../storage/supabase';

export async function providerRequest(settings: Settings, path: 'models' | 'chat/completions', key: string, payload?: unknown): Promise<Response> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (settings.useProxy) {
    if (!supabase) throw new Error('云端转发需要先登录');
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error('云端转发需要先登录');
    if (path === 'chat/completions' && !key.trim()) throw new Error('请先在设置中填写 API 密钥');
    return fetch(`${import.meta.env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '')}/functions/v1/llm-proxy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baseUrl, path, key, ...(payload === undefined ? {} : { payload }) }),
    });
  }
  return fetch(`${baseUrl}/${path}`, path === 'models'
    ? { headers: key.trim() ? { Authorization: `Bearer ${key}` } : {} }
    : {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
}

export function checkProviderStatus(response: Response): void {
  if (response.status === 401) throw new Error('API 密钥无效或已过期，请在设置中检查。');
  if (response.status === 429) throw new Error('请求频繁或额度已用尽，请稍后重试或更换模型。');
  if (!response.ok) throw new Error(`模型请求失败（${response.status}），请稍后重试。`);
}

export async function proxyStatusError(response: Response, key: string): Promise<Error> {
  const body = (await response.text().catch(() => '')).trim();
  let detail = body;
  try {
    const json = JSON.parse(body);
    detail = [json?.error?.message, json?.error, json?.message]
      .find((value) => typeof value === 'string' && value.trim()) ?? body;
  } catch {
    if (body.startsWith('<')) detail = '';
  }
  if (key.trim()) detail = detail.split(key.trim()).join('[已隐藏]');
  return new Error(`模型请求失败（${response.status}），${detail ? detail.slice(0, 500) : '请稍后重试。'}`);
}
