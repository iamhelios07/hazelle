import type { BackupResult, BackupSource } from './types';

// Track stub: the engine track replaces this body.
export function readBackup(source: BackupSource): Promise<BackupResult> {
  return Promise.resolve({ ok: false, failure: { kind: 'unreadable', detail: `not built (${source.size})` } });
}
