import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from './settings';
import { defaults, legacyDefaultPool, poolCodes, poolEntries } from './data/market';
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('默认池严格为四只持仓及十只观察股，保持顺序及港股前导零', () => {
  expect(poolCodes(defaults)).toEqual([
    '601318',
    '601166',
    '600690',
    '000538',
    '600036',
    '600887',
    '601398',
    '600377',
    '600900',
    '000333',
    '601088',
    '600941',
    '600050',
    '00883',
  ]);
  expect(poolEntries(defaults).map((entry) => entry.category)).toEqual([
    ...Array(4).fill('持仓'),
    ...Array(10).fill('观察池'),
  ]);
  expect(loadSettings()).toEqual(defaultSettings);
});
it('仅精确匹配旧默认池时迁移并保存，保留其他偏好', () => {
  const old = { key: 'test-key', model: 'custom-model', pool: legacyDefaultPool };
  stored.set('squad-settings', JSON.stringify(old));
  expect(loadSettings()).toEqual({ ...old, pool: defaults });
  expect(JSON.parse(stored.get('squad-settings')!).pool).toBe(defaults);
});
it.each(['601318 中国平安 持仓\n00883 中海油 观察池', legacyDefaultPool + '\n'])(
  '自定义池不被默认迁移覆盖',
  (pool) => {
    saveSettings({ ...defaultSettings, pool });
    expect(loadSettings().pool).toBe(pool);
  },
);
it('无效保存不覆盖之前已保存的池，未保存的修改不影响读取', () => {
  const saved = { ...defaultSettings, pool: '601318 中国平安 持仓' };
  saveSettings(saved);
  const draft = { ...saved, pool: 'invalid' };
  expect(() => saveSettings(draft)).toThrow('股票池');
  expect(loadSettings()).toEqual(saved);
});
it('损坏设置回退默认值，迁移遇到写入失败仍返回迁移后的设置', () => {
  stored.set('squad-settings', '{');
  expect(loadSettings()).toEqual(defaultSettings);
  stored.set('squad-settings', JSON.stringify({ ...defaultSettings, pool: legacyDefaultPool }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key),
    setItem: () => {
      throw new Error('full');
    },
  });
  expect(loadSettings().pool).toBe(defaults);
});
