import { getRegistry, getMidRegistry } from './custom';
import type { Step } from '../storage';

export function squadName(id: string): string {
  const registry = getRegistry();
  const midRegistry = getMidRegistry();
  return Object.hasOwn(midRegistry, id)
    ? midRegistry[id].name
    : Object.hasOwn(registry, id)
      ? registry[id].name
      : '未知内容线';
}

export function isCheckStep(id: string): boolean {
  return id === 'check' || id.endsWith(':check');
}

export function stepPresentation(id: string, squadId = 'zangu-shouxi') {
  const registry = getRegistry();
  const [prefix, roleId] = id.includes(':') ? id.split(':') : ['', id];
  const order = ['data', 'draft', 'check', 'final'].indexOf(roleId);
  const index = order < 0 ? 0 : order;
  const squad = Object.hasOwn(registry, prefix || squadId)
    ? registry[prefix || squadId]
    : undefined;
  const role = squad?.roles.find((item) => item.id === roleId);
  const group = prefix ? (squad?.segmentTitle ?? squad?.name ?? prefix) : '';
  return {
    id,
    name:
      id === 'merge:check'
        ? '小核 · 合并复核'
        : roleId === 'final'
          ? '成稿'
          : role
            ? `${group ? group + ' · ' : ''}${role.name}`
            : id,
    title:
      id === 'merge:check'
        ? '全文数字核验'
        : (role?.title ?? (roleId === 'final' ? '由你拍板' : '历史步骤')),
    description:
      id === 'merge:check'
        ? '共享快照 · 全文数字复核'
        : [
            '行情与财报 · 提炼事实',
            '遵循规则 · 写下记录',
            '数字核验 · 标出疑点',
            '固定模板 · 人工定稿',
          ][index],
    avatar: ['数', '稿', '核', '定'][index],
    avatarIndex: index,
  };
}

export function pipelineCards(squadId: string, steps?: Pick<Step, 'roleId'>[]) {
  const registry = getRegistry();
  const midRegistry = getMidRegistry();
  const mid = Object.hasOwn(midRegistry, squadId) ? midRegistry[squadId] : undefined;
  const small = Object.hasOwn(registry, squadId) ? registry[squadId] : registry['zangu-shouxi'];
  const ids = steps
    ? steps.map((step) => step.roleId)
    : mid
      ? [
          ...mid.squads.flatMap((id) =>
            Object.hasOwn(registry, id)
              ? registry[id].pipeline.map((roleId) => `${id}:${roleId}`)
              : [],
          ),
          'merge:check',
        ]
      : small.pipeline;
  const withFinal = !mid && !ids.some((id) => id.includes(':')) ? [...ids, 'final'] : ids;
  return withFinal.map((id) =>
    stepPresentation(id, Object.hasOwn(registry, squadId) ? squadId : 'zangu-shouxi'),
  );
}
