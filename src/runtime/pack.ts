import type { Pack, RegexScript, Trigger } from '../engine/import/types';
import { without } from '../model/fields';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

export type PackOwner = { kind: 'character' | 'module'; id: string };
export type ScriptList = 'regex' | 'triggers';
type Scripts = Pick<Pack, ScriptList>;
type Listed = { id: string; off?: true };

// The one place that knows where an owner keeps its pack: a character in its card, a module at its top level.
function packOf(store: ObjectStore, { kind, id }: PackOwner): Scripts | null {
  return (kind === 'character' ? store.get('character', id)?.value.card : store.get('module', id)?.value) ?? null;
}

// Each change is applied to the copy written over, so an edit to another script on another device survives. null: what
// it changes is gone there, and nothing is written.
function updatePack(store: ObjectStore, { kind, id }: PackOwner, change: (pack: Scripts) => Partial<Scripts> | null): Promise<ApiResult<unknown>> {
  return kind === 'character'
    ? store.update('character', id, (current) => {
        const pack = change(current.card);
        return pack && { ...current, card: { ...current.card, ...pack } };
      })
    : store.update('module', id, (current) => {
        const pack = change(current);
        return pack && { ...current, ...pack };
      });
}

function updateList(store: ObjectStore, owner: PackOwner, list: ScriptList, change: <S extends Listed>(scripts: S[]) => S[] | null) {
  return updatePack(store, owner, (pack) => {
    if (list === 'regex') {
      const regex = change(pack.regex);
      return regex && { regex };
    }
    const triggers = change(pack.triggers);
    return triggers && { triggers };
  });
}

function patched<S extends Listed>(scripts: S[], id: string, patch: (script: S) => S): S[] | null {
  const at = scripts.findIndex((script) => script.id === id);
  return at === -1 ? null : scripts.with(at, patch(scripts[at]!));
}

// id: the caller's, so the screen knows the script before it is stored.
export const addRegex = (store: ObjectStore, owner: PackOwner, id: string) =>
  updatePack(store, owner, ({ regex }) => ({ regex: [...regex, { id, name: '', find: '', replace: '', stage: 'display', flags: null }] }));

export const addLua = (store: ObjectStore, owner: PackOwner, id: string) => updatePack(store, owner, ({ triggers }) => ({ triggers: [...triggers, { kind: 'lua', id, name: '', code: '' }] }));

// Only the fields given.
export const editRegex = (store: ObjectStore, owner: PackOwner, id: string, patch: Partial<Omit<RegexScript, 'id' | 'off'>>) =>
  updatePack(store, owner, ({ regex }) => {
    const edited = patched(regex, id, (script) => ({ ...script, ...patch }));
    return edited && { regex: edited };
  });

export const editTrigger = (store: ObjectStore, owner: PackOwner, id: string, patch: Partial<Pick<Extract<Trigger, { kind: 'lua' }>, 'name' | 'code'>>) =>
  updatePack(store, owner, ({ triggers }) => {
    const edited = patched(triggers, id, (trigger) => ({ ...trigger, ...patch }));
    return edited && { triggers: edited };
  });

export const setScriptOff = (store: ObjectStore, owner: PackOwner, list: ScriptList, id: string, off: boolean) =>
  updateList(store, owner, list, (scripts) =>
    patched(scripts, id, (script) => (off ? { ...script, off: true } : without(script, 'off'))),
  );

// A script moves past its neighbour in its list; a regex script past the nearest one of its own stage, since only
// their order within a stage means anything. null: it has none that way.
export const neighbour = (pack: Scripts, list: ScriptList, id: string, by: -1 | 1): number | null => {
  const scripts: Listed[] = pack[list];
  const at = scripts.findIndex((script) => script.id === id);
  if (at === -1) return null;
  const stage = list === 'regex' ? pack.regex[at]!.stage : null;
  for (let other = at + by; other >= 0 && other < scripts.length; other += by) if (stage === null || pack.regex[other]!.stage === stage) return other;
  return null;
};

export const moveScript = (store: ObjectStore, owner: PackOwner, list: ScriptList, id: string, by: -1 | 1) =>
  updatePack(store, owner, (pack) => {
    const other = neighbour(pack, list, id, by);
    if (other === null) return null;
    const swap = <S extends Listed>(scripts: S[]) => {
      const at = scripts.findIndex((script) => script.id === id);
      return scripts.with(at, scripts[other]!).with(other, scripts[at]!);
    };
    return list === 'regex' ? { regex: swap(pack.regex) } : { triggers: swap(pack.triggers) };
  });

export type RemovedScript = { list: ScriptList; script: Listed; at: number };

// A script has no 휴지통: it goes at once, and the toast's 되돌리기 puts it back where it stood.
export async function removeScript(store: ObjectStore, owner: PackOwner, list: ScriptList, id: string): Promise<ApiResult<RemovedScript>> {
  const scripts: Listed[] = packOf(store, owner)?.[list] ?? [];
  const at = scripts.findIndex((script) => script.id === id);
  if (at === -1) return { ok: false, error: 'gone' };
  const removed = await updateList(store, owner, list, (current) => {
    const rest = current.filter((script) => script.id !== id);
    return rest.length === current.length ? null : rest;
  });
  return removed.ok ? { ok: true, data: { list, script: scripts[at]!, at } } : removed;
}

export const restoreScript = (store: ObjectStore, owner: PackOwner, { list, script, at }: RemovedScript) =>
  updateList(store, owner, list, (scripts) => scripts.toSpliced(Math.min(at, scripts.length), 0, script as (typeof scripts)[number]));
