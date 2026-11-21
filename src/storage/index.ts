import type { Snapshot } from '../data/market';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudError } from './supabase';
export type Step = {
  roleId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  input?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};
export type Run = {
  id: string;
  squadId: string;
  topic: string;
  createdAt: string;
  steps: Step[];
  snapshot: Snapshot;
  finalText: string;
  status: 'draft' | 'approved';
};
export interface RunStorage {
  list(): Promise<Run[]>;
  save(run: Run): Promise<void>;
}
export class LocalStorageRuns implements RunStorage {
  async list(): Promise<Run[]> {
    const raw = localStorage.getItem('squad-runs');
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('本地历史格式异常，请先备份浏览器数据。');
    return rows;
  }
  async save(run: Run) {
    const rows = await this.list();
    localStorage.setItem(
      'squad-runs',
      JSON.stringify([run, ...rows.filter((r) => r.id !== run.id)]),
    );
  }
}
export class SupabaseRuns implements RunStorage {
  constructor(
    private client: SupabaseClient,
    private ownerId: string,
  ) {}

  async list(): Promise<Run[]> {
    const { data, error } = await this.client
      .from('runs')
      .select('data')
      .eq('owner_id', this.ownerId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(cloudError(error));
    return (data ?? []).map((row) => row.data as Run);
  }
  async save(run: Run): Promise<void> {
    const data: Run = {
      id: run.id,
      squadId: run.squadId,
      topic: run.topic,
      createdAt: run.createdAt,
      steps: run.steps,
      snapshot: run.snapshot,
      finalText: run.finalText,
      status: run.status,
    };
    const { error } = await this.client.from('runs').upsert(
      {
        id: run.id,
        owner_id: this.ownerId,
        squad_id: run.squadId,
        topic: run.topic,
        status: run.status,
        data,
        created_at: run.createdAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(cloudError(error));
  }
}
