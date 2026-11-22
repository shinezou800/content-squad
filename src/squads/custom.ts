import { createSquad, registry } from './registry';
import { midRegistry } from './mid';
import type { MidSquad, Squad } from './types';

export type CustomSquad = { id: string; name: string; codes: string[]; extraPrompt?: string };
export type CustomMid = MidSquad;
const squadKey = 'squad-custom-squads';
const midKey = 'squad-custom-mids';
const codePattern = /^\d{5,6}$/;
function load<T>(key: string, valid: (value: any) => boolean): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) && value.every(valid) ? value : [];
  } catch {
    return [];
  }
}
const baseValid = (value: any) =>
  value &&
  typeof value.id === 'string' &&
  !!value.id &&
  typeof value.name === 'string' &&
  !!value.name.trim();
export const loadCustomSquads = (): CustomSquad[] =>
  load(
    squadKey,
    (v) =>
      baseValid(v) &&
      Array.isArray(v.codes) &&
      v.codes.length > 0 &&
      v.codes.every((c: unknown) => typeof c === 'string' && codePattern.test(c)) &&
      (v.extraPrompt === undefined || typeof v.extraPrompt === 'string'),
  );
export const loadCustomMids = (): CustomMid[] =>
  load(
    midKey,
    (v) =>
      baseValid(v) &&
      Array.isArray(v.squads) &&
      v.squads.every((id: unknown) => typeof id === 'string'),
  );
function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export const saveCustomSquads = (value: CustomSquad[]) => save(squadKey, value);
export const saveCustomMids = (value: CustomMid[]) => save(midKey, value);

let lastId = 0;
export function createCustomId(mid = false): string {
  const used = new Set([
    ...Object.keys(registry),
    ...Object.keys(midRegistry),
    ...loadCustomSquads().map((s) => s.id),
    ...loadCustomMids().map((s) => s.id),
  ]);
  let id: string;
  do {
    lastId = Math.max(Date.now(), lastId + 1);
    id = `${mid ? 'custom-mid' : 'custom'}-${lastId}`;
  } while (used.has(id));
  return id;
}
export function validateName(
  name: string,
  squads: CustomSquad[],
  mids: CustomMid[],
  editingId?: string,
): string {
  if (!name.trim()) return '请填写名称。';
  const names = [
    ...Object.values(registry),
    ...Object.values(midRegistry),
    ...squads.filter((s) => s.id !== editingId),
    ...mids.filter((s) => s.id !== editingId),
  ];
  return names.some((s) => s.name.trim() === name.trim()) ? '名称已存在，请使用不同名称。' : '';
}
export function parseCustomCodes(text: string): { codes: string[]; invalid: string[] } {
  const values = [
    ...new Set(
      text
        .trim()
        .split(/[\s,，]+/)
        .filter(Boolean),
    ),
  ];
  return {
    codes: values.filter((value) => codePattern.test(value)),
    invalid: values.filter((value) => !codePattern.test(value)),
  };
}
export function validateCodes(text: string): string {
  const { codes, invalid } = parseCustomCodes(text);
  return invalid.length
    ? `无效股票代码：${invalid.join('、')}。请填写六位 A 股或五位港股代码。`
    : codes.length
      ? ''
      : '请至少填写一个有效股票代码。';
}
export function validateMidMembers(ids: string[], squads: Record<string, Squad>): string {
  if (ids.length < 2 || new Set(ids).size !== ids.length) return '中团需要至少两条不同的内容线。';
  return ids.every((id) => Object.hasOwn(squads, id)) ? '' : '所选内容线已删除，请重新选择。';
}
const builtInIds = new Set([...Object.keys(registry), ...Object.keys(midRegistry)]);
export function getRegistry(): Record<string, Squad> {
  return Object.fromEntries([
    ...Object.entries(registry),
    ...loadCustomSquads()
      .filter((s) => !builtInIds.has(s.id))
      .map((s) => [s.id, createSquad(s.id, s.name, s.codes, s.extraPrompt)] as const),
  ]);
}
export function getMidRegistry(): Record<string, MidSquad> {
  return Object.fromEntries([
    ...Object.entries(midRegistry),
    ...loadCustomMids()
      .filter((s) => !builtInIds.has(s.id))
      .map((s) => [s.id, s]),
  ]);
}
