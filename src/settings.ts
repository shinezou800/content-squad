import { defaults, legacyDefaultPool, previousDefaultPool, poolCodes } from './data/market';
export const defaultBaseUrl = 'https://openrouter.ai/api/v1';
export type Settings = { key: string; model: string; pool: string; baseUrl: string };
export const defaultSettings: Settings = {
  key: '',
  baseUrl: defaultBaseUrl,
  model: 'google/gemma-4-31b-it:free',
  pool: defaults,
};
export function loadSettings(): Settings {
  try {
    const settings: Settings = {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem('squad-settings') || '{}'),
    };
    if (settings.pool === legacyDefaultPool || settings.pool === previousDefaultPool) {
      settings.pool = defaults;
      try {
        saveSettings(settings);
      } catch {}
    }
    return settings;
  } catch {
    return defaultSettings;
  }
}
export function saveSettings(value: Settings) {
  const baseUrl = normalizeBaseUrl(value.baseUrl);
  poolCodes(value.pool);
  localStorage.setItem('squad-settings', JSON.stringify({ ...value, baseUrl }));
}
export function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (!baseUrl.startsWith('https://') || /[?#]/.test(value) || !url.hostname || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    throw new Error('API 地址必须为有效的 https:// 地址，且不含账号、查询参数或片段。');
  }
  return baseUrl;
}
