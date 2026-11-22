import type { Squad, Context } from '../squads/types';
import type { Settings } from '../settings';
import type { Run } from '../storage';
let fallbackSequence = 0;

export function createRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${(++fallbackSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function hasReachedFinalStep(run: Run | undefined): boolean {
  return !!run && run.steps.length > 0 && run.steps.every((step) => step.status === 'done');
}

export async function runPipeline(
  squad: Squad,
  topic: string,
  settings: Settings,
  emit: (run: Run) => void,
): Promise<Run> {
  if (
    new Set(squad.pipeline).size !== squad.pipeline.length ||
    squad.pipeline.some((id) => !squad.roles.some((r) => r.id === id))
  )
    throw new Error('小团流水线配置无效。');
  const run: Run = {
    id: createRunId(),
    squadId: squad.id,
    topic,
    createdAt: new Date().toISOString(),
    steps: squad.pipeline.map((roleId) => ({ roleId, status: 'pending' })),
    snapshot: [],
    finalText: '',
    status: 'draft',
  };
  const ctx: Context = { topic, settings, snapshot: [], outputs: {} };
  const publish = () => {
    run.snapshot = ctx.snapshot;
    emit(structuredClone(run));
  };
  publish();
  for (const step of run.steps) {
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.input = JSON.stringify({ topic, snapshot: ctx.snapshot, outputs: ctx.outputs });
    publish();
    try {
      const output = await squad.roles.find((r) => r.id === step.roleId)!.run(ctx);
      step.output = output;
      ctx.outputs[step.roleId] = output;
      step.status = 'done';
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : '运行失败，请重试。';
    }
    step.finishedAt = new Date().toISOString();
    publish();
    if (step.status === 'failed') return run;
  }
  run.finalText = squad.template(ctx);
  publish();
  return run;
}
