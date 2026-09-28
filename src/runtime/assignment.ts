import { resolveRole, type ModelRef } from '../connectors/assignment';
import type { Model } from '../connectors/types';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { SETTINGS_ID, type Settings } from '../model/settings';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

// Every read and write of the model assignment's layers (design §4.1). The chat layer lives in the
// chat object, which runtime/chat-log writes otherwise; its `models` field is written only here.

export type Route = { connection: Stored<'connection'>; model: Model };
export type RouteFailure = { kind: 'no-model' } | { kind: 'model-gone' };

// The 본 대화 model for a chat: its own layer, then 전체 기본값.
export function chatModel(store: ObjectStore, chat: Chat): Route | RouteFailure {
  const ref = resolveRole('main', [chat.models, store.get('settings', SETTINGS_ID)?.value.models ?? {}]);
  if (!ref) return { kind: 'no-model' };
  const connection = store.get('connection', ref.connection);
  const model = connection?.value.starred.find((starred) => starred.id === ref.model);
  return connection && model ? { connection, model } : { kind: 'model-gone' };
}

export const defaultModel = (settings: Settings): ModelRef | null => resolveRole('main', [settings.models]);

// The chat layer, which the model button writes (design F4).
export function setChatModel(store: ObjectStore, chat: string, ref: ModelRef): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => ({ ...current, models: { ...current.models, main: ref } }));
}

export function setDefaultModel(store: ObjectStore, ref: ModelRef): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current) => ({ ...current, models: { ...current?.models, main: ref } }));
}
