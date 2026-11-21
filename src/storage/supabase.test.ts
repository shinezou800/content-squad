import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRuns, type Run } from './index';

const run: Run = {
  id: 'run-id',
  squadId: 'squad',
  topic: '选题',
  createdAt: '2026-11-21T00:00:00.000Z',
  steps: [],
  snapshot: [],
  finalText: '正文',
  status: 'draft',
};
function mockClient(data: unknown = [], error: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ select, upsert });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, order, upsert };
}
describe('Supabase 运行存储（仅模拟客户端）', () => {
  it('按用户筛选、按时间倒序读取完整运行', async () => {
    const mock = mockClient([{ data: run }]);
    expect(await new SupabaseRuns(mock.client, 'owner').list()).toEqual([run]);
    expect(mock.from).toHaveBeenCalledWith('runs');
    expect(mock.select).toHaveBeenCalledWith('data');
    expect(mock.eq).toHaveBeenCalledWith('owner_id', 'owner');
    expect(mock.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
  it.each([[], null])('无历史返回空列表：%s', async (data) => {
    expect(await new SupabaseRuns(mockClient(data).client, 'owner').list()).toEqual([]);
  });
  it('upsert 保留完整运行及元数据，但不上传设置或额外密钥字段', async () => {
    const mock = mockClient();
    await new SupabaseRuns(mock.client, 'owner').save({
      ...run,
      settings: { key: 'must-not-upload' },
      key: 'must-not-upload',
    } as Run);
    expect(mock.upsert).toHaveBeenCalledWith(
      {
        id: run.id,
        owner_id: 'owner',
        squad_id: run.squadId,
        topic: run.topic,
        status: run.status,
        data: run,
        created_at: run.createdAt,
        updated_at: expect.any(String),
      },
      { onConflict: 'id' },
    );
    expect(JSON.stringify(mock.upsert.mock.calls)).not.toContain('must-not-upload');
  });
  it('读取和保存失败时给出中文错误，不把鉴权错误当空列表', async () => {
    const store = new SupabaseRuns(mockClient(null, { code: '42501' }).client, 'owner');
    await expect(store.list()).rejects.toThrow('没有云端访问权限');
    await expect(store.save(run)).rejects.toThrow('没有云端访问权限');
  });
  it('未知网络错误也转换为中文', async () => {
    const store = new SupabaseRuns(mockClient(null, { message: 'fetch failed' }).client, 'owner');
    await expect(store.list()).rejects.toThrow('云端操作失败');
  });
});
