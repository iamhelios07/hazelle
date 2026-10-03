// Node-only test adapter. Production imports backup.ts and always uses its worker and disk-backed encrypted stage;
// tests inject this in-memory stage explicitly instead of installing a browser/worker-detection fallback.
import { exportBackup as exportCore, readBackup as readCore, type Options } from './backup-core';
import type { ExportFiles, ExportStore } from './backup-job';
import { pinBackup } from './backup-metadata';
import type { BackupRecord, BackupRecords } from './backup-records';
import type { BackupOutput } from './backup-zip';
import { ownershipDepth } from './removal';

export { restoreBackup } from './backup-core';
export type { BackupOutput } from './backup-zip';

export class MemoryBackupRecords implements BackupRecords {
  private readonly depths = new Map<number, BackupRecord[]>();
  async write(records: BackupRecord[], signal: AbortSignal) {
    signal.throwIfAborted();
    for (const record of records) {
      const depth = ownershipDepth(record.object.kind);
      let page = this.depths.get(depth);
      if (!page) this.depths.set(depth, (page = []));
      page.push(structuredClone(record));
    }
  }
  async *read(depth: number, wanted: ReadonlySet<string>, signal: AbortSignal) {
    for (const record of this.depths.get(depth) ?? []) {
      signal.throwIfAborted();
      if (wanted.has(record.object.id)) yield structuredClone(record);
    }
  }
  async close() { this.depths.clear(); }
}

export const exportBackup = (store: ExportStore, files: ExportFiles, output: BackupOutput, options: Options = {}) =>
  exportCore(store, files, output, (signal) => pinBackup(store, signal), options);
export const readBackup = (file: Blob, options: Options = {}) => readCore(file, async () => new MemoryBackupRecords(), options);
