import type { Listed, Pack, RegexScript, Trigger } from '../engine/import/types';
import { without } from '../model/fields';
import type { PackOwner } from '../model/library';
import type { ApiResult } from './api';
import { evaluationFailure } from './evaluation';
import type { ObjectStore } from './store';

export type ScriptList = 'regex' | 'triggers';
type Scripts = Pick<Pack, ScriptList>;

// The one place that knows where an owner keeps its pack: a character in its card, a module at its top level. Each
// change is applied to the copy written over, so an edit to another script on another device survives, and may run
// again over its own result (ObjectStore.reaching), so it must read the same applied twice as once. null: what it
// changes is gone there, and nothing is written.
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

const holds = (scripts: Listed[], id: string) => scripts.some((script) => script.id === id);

// id: the caller's, so the screen knows the script before it is stored.
export const addRegex = (store: ObjectStore, owner: PackOwner, id: string) =>
  updatePack(store, owner, ({ regex }) => ({ regex: holds(regex, id) ? regex : [...regex, { id, name: '', find: '', replace: '', stage: 'display', flags: null }] }));

export const addLua = (store: ObjectStore, owner: PackOwner, id: string) =>
  updatePack(store, owner, ({ triggers }) => ({ triggers: holds(triggers, id) ? triggers : [...triggers, { kind: 'lua', id, name: '', code: '' }] }));

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
export const neighbour = (pack: Scripts, list: ScriptList, id: string, by: -1 | 1): string | null => {
  const scripts: Listed[] = pack[list];
  const at = scripts.findIndex((script) => script.id === id);
  if (at === -1) return null;
  const stage = list === 'regex' ? pack.regex[at]!.stage : null;
  for (let other = at + by; other >= 0 && other < scripts.length; other += by) if (stage === null || pack.regex[other]!.stage === stage) return scripts[other]!.id;
  return null;
};

// past: the neighbour the move was pressed against, so a move that already stands past it changes nothing.
export const moveScript = (store: ObjectStore, owner: PackOwner, list: ScriptList, id: string, by: -1 | 1, past: string) =>
  updateList(store, owner, list, (scripts) => {
    const at = scripts.findIndex((script) => script.id === id);
    const other = scripts.findIndex((script) => script.id === past);
    if (at === -1 || other === -1) return null;
    return Math.sign(other - at) === by ? scripts.with(at, scripts[other]!).with(other, scripts[at]!) : scripts;
  });

export type RemovedScript = { list: ScriptList; script: Listed; at: number };

// A script has no 휴지통: it goes at once, and the toast's 되돌리기 puts it back where it stood.
export async function removeScript(store: ObjectStore, owner: PackOwner, list: ScriptList, id: string): Promise<ApiResult<RemovedScript>> {
  let taken = null as RemovedScript | null;
  const removed = await updateList(store, owner, list, (scripts) => {
    const at = scripts.findIndex((script) => script.id === id);
    if (at === -1) return taken && scripts;
    taken = { list, script: scripts[at]!, at };
    return scripts.toSpliced(at, 1);
  });
  if (!removed.ok) return removed;
  return taken ? { ok: true, data: taken } : { ok: false, error: 'gone' };
}

export const restoreScript = (store: ObjectStore, owner: PackOwner, { list, script, at }: RemovedScript) =>
  updateList(store, owner, list, (scripts) => (holds(scripts, script.id) ? scripts : scripts.toSpliced(Math.min(at, scripts.length), 0, script as (typeof scripts)[number])));

// A pattern may never end, so a sample runs where a chat's scripts do: in the evaluation worker, which is stopped when
// it hangs. A newer sample of the same script takes the place of one still waiting.
export const sampleScript = (store: ObjectStore, owner: PackOwner, script: RegexScript, text: string, signal: AbortSignal): Promise<ApiResult<string>> =>
  store.evaluation.sample(`sample:${owner.id}:${script.id}`, script, text, signal).then((data) => ({ ok: true, data }), evaluationFailure);

export const setTakesMemory = (store: ObjectStore, module: string, takesMemory: boolean): Promise<ApiResult<unknown>> =>
  store.update('module', module, (current) => current.deleted === undefined ? { ...current, takesMemory } : null);

export const setModels = (store: ObjectStore, { kind, id }: PackOwner, botModels: boolean): Promise<ApiResult<unknown>> =>
  kind === 'character'
    ? store.update('character', id, (current) => current.deleted === undefined ? { ...current, botModels } : null)
    : store.update('module', id, (current) => current.deleted === undefined ? { ...current, botModels } : null);
