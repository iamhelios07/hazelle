import { resolveRole, type Assignment, type ModelRef, type Role } from '../connectors/assignment';
import type { Model } from '../connectors/types';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { chatPrompt } from './prompts';
import { without, type ObjectStore } from './store';

// Every read and write of the model assignment's layers. The chat layer lives in the chat object and
// the prompt layer in the prompt, which runtime/chat-log and runtime/prompts write otherwise; their
// `models` fields are written only here.

export type Route = { connection: Stored<'connection'>; model: Model };
export type RouteFailure = { kind: 'no-model' } | { kind: 'model-gone' };

// A chat's model for a role: its own layer, its prompt's, then 전체 기본값. A missing prompt has no layer;
// the turn stops on it before the model matters.
export function chatModel(store: ObjectStore, chat: Chat, role: Role): Route | RouteFailure {
  const prompt = chatPrompt(store, chat);
  const ref = resolveRole(role, [chat.models, ...(prompt.kind === 'prompt' ? [prompt.prompt.value.models] : []), store.get('settings', SETTINGS_ID)?.value.models ?? {}]);
  if (!ref) return { kind: 'no-model' };
  const connection = store.get('connection', ref.connection);
  const model = connection?.value.starred.find((starred) => starred.id === ref.model);
  return connection && model ? { connection, model } : { kind: 'model-gone' };
}

// The chat layer, which the model button writes.
export function setChatModel(store: ObjectStore, chat: string, ref: ModelRef): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => ({ ...current, models: { ...current.models, main: ref } }));
}

// null leaves the role to the layer below, or to the role it falls back to.
function assign(models: Assignment, role: Role, ref: ModelRef | null): Assignment {
  return ref === null ? without(models, role) : { ...models, [role]: ref };
}

export function setPromptModel(store: ObjectStore, prompt: string, role: Role, ref: ModelRef | null): Promise<ApiResult<Stored<'prompt'>>> {
  return store.update('prompt', prompt, (current) => (current.task === undefined ? { ...current, models: assign(current.models, role, ref) } : current));
}

export function setDefaultModel(store: ObjectStore, role: Role, ref: ModelRef | null): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current) => ({ ...current, models: assign(current?.models ?? {}, role, ref) }));
}
