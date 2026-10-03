import { REMOVABLE } from '../model/library';
import type { ApiResult } from './api';
import type { ObjectStore, Pin } from './store';

export type BackupPin = { pin: Pin; excluded: Set<string> };

// The metadata scan cannot see a deletion mark or a chat's character: both are sealed in the body. Only their ids
// cross to the backup worker, never the library's complete character cards and chat values. Pin can hydrate a fresh
// or rewound store, so capture these marks only after pin settles, as part of the same host request.
export async function pinBackup(store: Pick<ObjectStore, 'pin' | 'list'>, signal?: AbortSignal): Promise<ApiResult<BackupPin>> {
  const pinned = await store.pin(signal);
  if (!pinned.ok) return pinned;
  const excluded = new Set(REMOVABLE.flatMap((kind) => store.list(kind).filter(({ value }) => value.deleted !== undefined).map(({ id }) => id)));
  for (const { id, value } of store.list('chat')) if (value.character !== null && excluded.has(value.character)) excluded.add(id);
  return { ok: true, data: { pin: pinned.data, excluded } };
}
