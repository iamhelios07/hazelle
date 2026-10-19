import type { CodeDoc, CodeItem } from '../../ui';

// The character's 기본 변수, as name and value.
export type Defaults = readonly (readonly [string, string])[];

export const variableDoc = (name: string, defaults: Defaults): CodeDoc => ({ form: name, text: '채팅 변수예요.', facts: [['기본 변수', defaults.find(([known]) => known === name)?.[1] ?? '없음']] });

// written: the names the text itself sets, after 기본 변수.
export function variableItems(defaults: Defaults, written: Iterable<string>): CodeItem[] {
  const names = new Set([...defaults.map(([name]) => name), ...written]);
  return [...names].map((name) => ({ label: name, kind: 'variable', detail: defaults.find(([known]) => known === name)?.[1], doc: variableDoc(name, defaults) }));
}
