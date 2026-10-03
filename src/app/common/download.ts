import type { BackupOutput } from '../../runtime/backup';

const TEMPORARY = 'risu-alpha-backup-downloads';
// URLs remain valid until the user confirms the browser's download finished, not merely until ZIP production ends.
const downloads = new Map<string, string>();

export class DownloadUnavailable extends Error {
  constructor(readonly reason: 'unsupported' | 'pending') { super(reason); }
}

function clickDownload(filename: string, url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

export function download(filename: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  clickDownload(filename, url);
  URL.revokeObjectURL(url);
}

async function temporaryDirectory() {
  if (!navigator.storage?.getDirectory) throw new DownloadUnavailable('unsupported');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(TEMPORARY, { create: true });
}

// Discover spools from an earlier page too: navigating away must not silently orphan their disk space.
export async function pendingDownloadOutputs(): Promise<number> {
  if (!navigator.storage?.getDirectory) return 0;
  const directory = await temporaryDirectory();
  let count = 0;
  for await (const entry of directory.values()) if (entry.kind === 'file') count++;
  return count;
}

export async function clearDownloadOutputs(): Promise<void> {
  const directory = await temporaryDirectory();
  for (;;) {
    const entry = (await directory.values().next()).value;
    if (!entry) return;
    // Do not continue an iterator over entries deleted beneath it.
    await directory.removeEntry(entry.name);
    const url = downloads.get(entry.name);
    if (url) URL.revokeObjectURL(url);
    downloads.delete(entry.name);
  }
}

// Call in the click handler, before any await: a picker requires the original user activation.
export function downloadOutput(filename: string): Promise<BackupOutput> {
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    return picker.call(window, { suggestedName: filename, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] })
      .then((handle) => handle.createWritable())
      .then((stream) => ({ write: (chunk) => stream.write(chunk), close: () => stream.close(), abort: () => stream.abort() }));
  }
  return temporaryOutput(filename);
}

async function temporaryOutput(filename: string): Promise<BackupOutput> {
  const directory = await temporaryDirectory();
  if (!(await directory.values().next()).done) throw new DownloadUnavailable('pending');
  const name = `${crypto.randomUUID()}.zip`;
  const handle = await directory.getFileHandle(name, { create: true });
  let stream: FileSystemWritableFileStream;
  try {
    if (!handle.createWritable) throw new DownloadUnavailable('unsupported');
    stream = await handle.createWritable();
  } catch (error) {
    await directory.removeEntry(name);
    throw error;
  }
  let closed = false;
  return {
    write: (chunk) => stream.write(chunk),
    close: async () => {
      await stream.close();
      closed = true;
      // getFile is disk-backed. Removing its entry may invalidate the File during the browser's download, so only
      // explicit cleanup removes a completed spool (https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile).
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      downloads.set(name, url);
      clickDownload(filename, url);
    },
    abort: async () => {
      try { if (!closed) await stream.abort(); }
      finally {
        closed = true;
        const url = downloads.get(name);
        if (url) URL.revokeObjectURL(url);
        downloads.delete(name);
        await directory.removeEntry(name);
      }
    },
  };
}
