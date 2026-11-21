import { defaults } from './data/market';
export type Settings = { key: string; model: string; pool: string };
export const defaultSettings: Settings = { key: '', model: 'google/gemma-4-31b-it:free', pool: defaults };
export function loadSettings(): Settings { try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('squad-settings') || '{}') }; } catch { return defaultSettings; } }
export function saveSettings(value: Settings) { localStorage.setItem('squad-settings', JSON.stringify(value)); }
