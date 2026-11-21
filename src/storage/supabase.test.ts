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
  it('同一运行的慢草稿不能覆盖后续编辑或拍板，按调用顺序保存快照', async () => {
    const mock = mockClient();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: Run[] = [];
    mock.upsert.mockImplementation(async ({ data }: { data: Run }) => {
      if (!writes.length) await firstGate;
      writes.push(data);
      return { error: null };
    });
    const store = new SupabaseRuns(mock.client, 'owner');
    const first = store.save(run);
    const edited = { ...run, finalText: '最新正文' };
    const second = store.save(edited);
    const approved = store.save({ ...edited, status: 'approved' });
    edited.finalText = '调用后被修改';
    await vi.waitFor(() => expect(mock.upsert).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([]);
    releaseFirst();
    await Promise.all([first, second, approved]);
    expect(writes.map((row) => [row.finalText, row.status])).toEqual([
      ['正文', 'draft'],
      ['最新正文', 'draft'],
      ['最新正文', 'approved'],
    ]);
  });
  it('前一次保存失败不阻塞同一运行的后续保存', async () => {
    const mock = mockClient();
    mock.upsert.mockResolvedValueOnce({ error: { code: '42501' } });
    const store = new SupabaseRuns(mock.client, 'owner');
    const first = store.save(run);
    const second = store.save({ ...run, finalText: '重试正文', status: 'approved' });
    await expect(first).rejects.toThrow('没有云端访问权限');
    await expect(second).resolves.toBeUndefined();
    expect(mock.upsert).toHaveBeenCalledTimes(2);
    expect(mock.upsert.mock.calls[1][0].data.finalText).toBe('重试正文');
  });
  it('不同运行不相互阻塞', async () => {
    const mock = mockClient();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mock.upsert.mockImplementationOnce(async () => {
      await gate;
      return { error: null };
    });
    const store = new SupabaseRuns(mock.client, 'owner');
    const first = store.save(run);
    await store.save({ ...run, id: 'other-run' });
    expect(mock.upsert).toHaveBeenCalledTimes(2);
    releaseFirst();
    await first;
  });
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
