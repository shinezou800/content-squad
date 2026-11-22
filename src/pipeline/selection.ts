import { getMidRegistry, getRegistry, validateMidMembers } from '../squads/custom';
import type { Settings } from '../settings';
import type { Run } from '../storage';
import { runPipeline } from './runner';
import { runMidPipeline } from './midRunner';

export function runContentLine(
  id: string,
  topic: string,
  settings: Settings,
  emit: (run: Run) => void,
): Promise<Run> {
  const registry = getRegistry();
  const mids = getMidRegistry();
  if (Object.hasOwn(mids, id)) {
    const error = validateMidMembers(mids[id].squads, registry);
    if (error) return Promise.reject(new Error(error));
    return runMidPipeline(mids[id], topic, settings, emit);
  }
  if (Object.hasOwn(registry, id)) return runPipeline(registry[id], topic, settings, emit);
  return Promise.reject(new Error('内容线已删除，请选择有效内容线后运行。'));
}
