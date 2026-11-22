import { defaultBaseUrl, normalizeBaseUrl, type Settings } from '../settings';

export async function fetchModels(settings: Settings, saved: Settings): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const url = new URL(baseUrl);
  const isDefault = url.origin + url.pathname.replace(/\/+$/, '') === defaultBaseUrl;
  const sendKey = settings.key.trim() &&
    (baseUrl === normalizeBaseUrl(saved.baseUrl) || settings.key !== saved.key);
  const response = await fetch(`${baseUrl}/models`, {
    headers: sendKey ? { Authorization: `Bearer ${settings.key}` } : {},
  });
  if (!response.ok) throw new Error('模型列表加载失败');
  const json = await response.json();
  return json.data
    .map((model: { id: string }) => model.id)
    .filter((id: unknown): id is string => typeof id === 'string' && (!isDefault || id.endsWith(':free')))
    .sort();
}
