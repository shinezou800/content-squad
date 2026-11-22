import { defaultBaseUrl, normalizeBaseUrl, type Settings } from '../settings';
import { providerRequest, checkProviderStatus } from './providerRequest';

export async function fetchModels(settings: Settings, saved: Settings): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const url = new URL(baseUrl);
  const isDefault = url.origin + url.pathname.replace(/\/+$/, '') === defaultBaseUrl;
  const sendKey = settings.key.trim() &&
    (baseUrl === normalizeBaseUrl(saved.baseUrl) || settings.key !== saved.key);
  const response = await providerRequest(settings, 'models', sendKey ? settings.key : '');
  checkProviderStatus(response);
  const json = await response.json();
  return json.data
    .map((model: { id: string }) => model.id)
    .filter((id: unknown): id is string => typeof id === 'string' && (!isDefault || id.endsWith(':free')))
    .sort();
}
