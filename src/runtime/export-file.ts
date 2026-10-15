import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';

// A small file made whole before it goes out, as runExport (app/common/exporting) takes it; a failed write is aborted,
// so no half file stays behind.
export async function writeWhole(output: BackupOutput, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<null>> {
  try {
    await output.write(bytes);
    await output.close();
    return { ok: true, data: null };
  } catch {
    await output.abort();
    return { ok: false, error: 'export-write' };
  }
}
