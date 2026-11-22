import type { Context, MidSquad } from '../squads/types';
import type { Settings } from '../settings';
import type { Run } from '../storage';
import { getRegistry } from '../squads/custom';
import { createRunId } from './runner';
import { complete } from './llm';
import { checkNumbers } from './checks';

export async function runMidPipeline(
  mid: MidSquad,
  topic: string,
  settings: Settings,
  emit: (run: Run) => void,
): Promise<Run> {
  const registry = getRegistry();
  const squads = mid.squads.map((id) => (Object.hasOwn(registry, id) ? registry[id] : undefined));
  if (
    !mid.id ||
    mid.squads.length < 2 ||
    new Set(mid.squads).size !== mid.squads.length ||
    squads.some(
      (squad, index) =>
        !squad ||
        squad.id !== mid.squads[index] ||
        squad.pipeline.length !== 3 ||
        new Set(squad.pipeline).size !== squad.pipeline.length ||
        new Set(squad.roles.map((role) => role.id)).size !== squad.roles.length ||
        ['data', 'draft', 'check'].some((id) => !squad.pipeline.includes(id)) ||
        squad.pipeline.some((id) => !squad.roles.some((role) => role.id === id)),
    )
  )
    throw new Error('中团流水线配置无效。');

  const contexts: Context[] = squads.map(() => ({ topic, settings, snapshot: [], outputs: {} }));
  const validSquads = squads.map((squad) => squad!);
  const title = (index: number) => validSquads[index].segmentTitle ?? validSquads[index].name;
  const mergedBody = () =>
    contexts
      .map((ctx, index) => `──────── ${title(index)} ────────\n\n${ctx.outputs.draft}`)
      .join('\n\n');
  const unionSnapshot = () => {
    const first = contexts[0].snapshot;
    if (contexts.every((ctx) => ctx.snapshot === first || !ctx.snapshot.length)) return first;
    const seen = new Set<string>();
    return contexts
      .flatMap((ctx) => ctx.snapshot)
      .filter((stock) => {
        if (seen.has(stock.code)) return false;
        seen.add(stock.code);
        return true;
      });
  };
  const jobs = validSquads.flatMap((squad, index) =>
    squad.pipeline.map((id) => ({
      roleId: `${squad.id}:${id}`,
      ctx: contexts[index],
      input: () => ({
        topic,
        snapshot: contexts[index].snapshot,
        outputs: contexts[index].outputs,
      }),
      run: async () => {
        const output = await squad.roles.find((role) => role.id === id)!.run(contexts[index]);
        contexts[index].outputs[id] = output;
        return output;
      },
    })),
  );
  jobs.push({
    roleId: 'merge:check',
    ctx: contexts.at(-1)!,
    input: () => ({
      topic,
      snapshot: unionSnapshot(),
      outputs: contexts.at(-1)!.outputs,
      draft: mergedBody(),
    }),
    run: async () => {
      const body = mergedBody();
      const snapshot = unionSnapshot();
      const flags = checkNumbers(body, snapshot);
      const result = await complete(
        settings,
        '你是小核 · 合并复核。只核对合并正文中的数字与快照是否一致，保留港元与人民币的区别及主人手动提供的来源。只输出JSON列表，每项字段为原文、问题、数据源值；无问题输出[]。不检查声明或披露的位置，不改写正文，不输出改写文本。',
        JSON.stringify({ draft: body, snapshot }),
      );
      return `【规则核对】\n${JSON.stringify(flags, null, 2)}\n\n【模型事实核对】\n${result}`;
    },
  });
  const run: Run = {
    id: createRunId(),
    squadId: mid.id,
    topic,
    createdAt: new Date().toISOString(),
    steps: jobs.map((job) => ({ roleId: job.roleId, status: 'pending' })),
    snapshot: [],
    finalText: '',
    status: 'draft',
  };
  const publish = () => {
    run.snapshot = unionSnapshot();
    emit(structuredClone(run));
  };
  publish();
  for (const [index, job] of jobs.entries()) {
    const previousContext = jobs[index - 1]?.ctx;
    if (previousContext && previousContext !== job.ctx && !job.ctx.snapshot.length)
      job.ctx.snapshot = previousContext.snapshot;
    const step = run.steps[index];
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.input = JSON.stringify(job.input());
    publish();
    try {
      step.output = await job.run();
      step.status = 'done';
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : '运行失败，请重试。';
    }
    step.finishedAt = new Date().toISOString();
    publish();
    if (step.status === 'failed') return run;
  }
  run.finalText = `${mergedBody()}\n\n──────── 核对记录 · 发布前请逐项确认 ────────\n${contexts.map((ctx, index) => `【${title(index)}段】\n${ctx.outputs.check}`).join('\n\n')}\n\n【合并全文数字复核】\n${run.steps.at(-1)!.output}`;
  publish();
  return run;
}
