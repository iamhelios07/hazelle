import type { ModelRef } from '../connectors/assignment';
import { UsageCounter, type ModelUsage } from '../model/chat';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

export async function readUsage(store: ObjectStore, ref: ModelRef, signal: AbortSignal): Promise<ApiResult<ModelUsage>> {
  const failed = await store.pull({ signal });
  if (failed) return failed;
  const counter = new UsageCounter(ref);
  for (const { id } of store.list('chat')) {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    const result = await store.withChat(id, async () => {
      const projection = store.projection(id);
      if (projection) counter.add(projection.model.messages);
      return { ok: true, data: null };
    });
    if (!result.ok) return result;
  }
  return { ok: true, data: counter.value };
}
