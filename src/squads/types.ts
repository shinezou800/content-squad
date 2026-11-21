import type { Snapshot } from '../data/market';
import type { Settings } from '../settings';
export type Context = {
  topic: string;
  settings: Settings;
  snapshot: Snapshot;
  outputs: Record<string, string>;
};
export type Role = { id: string; name: string; title: string; run(ctx: Context): Promise<string> };
export type Squad = {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  pipeline: string[];
  template(ctx: Context): string;
};
export type MidSquad = { id: string; name: string; squads: [string, string] };
