import { defaults, legacyDefaultPool, previousDefaultPool, poolCodes } from './data/market';
export type Settings = { key: string; model: string; pool: string };
export const defaultSettings: Settings = {
  key: '',
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
  poolCodes(value.pool);
  localStorage.setItem('squad-settings', JSON.stringify(value));
}
