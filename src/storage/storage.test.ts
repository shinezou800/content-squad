import { afterEach, expect, it, vi } from 'vitest';
import { LocalStorageRuns, type Run } from './index';
afterEach(() => vi.unstubAllGlobals());
it('本地历史空列表、保存、替换，不同步云端', async () => {
  const map = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k),
    setItem: (k: string, v: string) => map.set(k, v),
  });
  const store = new LocalStorageRuns();
  expect(await store.list()).toEqual([]);
  const run: Run = {
    id: '1',
    squadId: 's',
    topic: '选题',
    createdAt: '今天',
    steps: [],
    snapshot: [],
    finalText: '稿件',
    status: 'draft',
  };
  await store.save(run);
  await store.save({ ...run, status: 'approved' });
  expect(await store.list()).toEqual([{ ...run, status: 'approved' }]);
  map.set('squad-runs', '{}');
  await expect(store.list()).rejects.toThrow('格式异常');
});
