import type { Snapshot } from '../data/market';
export type Step = { roleId: string; status: 'pending' | 'running' | 'done' | 'failed'; input?: string; output?: string; error?: string; startedAt?: string; finishedAt?: string };
export type Run = { id: string; squadId: string; topic: string; createdAt: string; steps: Step[]; snapshot: Snapshot; finalText: string; status: 'draft' | 'approved' };
export interface RunStorage { list(): Promise<Run[]>; save(run: Run): Promise<void> }
export class LocalStorageRuns implements RunStorage {
  async list(): Promise<Run[]> { const raw = localStorage.getItem('squad-runs'); if (!raw) return []; const rows = JSON.parse(raw); if (!Array.isArray(rows)) throw new Error('本地历史格式异常，请先备份浏览器数据。'); return rows; }
  async save(run: Run) { const rows = await this.list(); localStorage.setItem('squad-runs', JSON.stringify([run, ...rows.filter(r => r.id !== run.id)])); }
}
export class SupabaseRuns implements RunStorage {
  async list(): Promise<Run[]> { throw new Error('尚未配置云端存储。'); }
  async save(_run: Run): Promise<void> { throw new Error('尚未配置云端存储。'); }
}
