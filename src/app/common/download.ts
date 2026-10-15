import type { BackupOutput } from '../../runtime/backup';

const TEMPORARY = 'risu-alpha-backup-downloads';
// URLs remain valid until the next export starts, not merely until ZIP production ends: the browser may still be
// reading the File.
const downloads = new Map<string, string>();

function clickDownload(filename: string, url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

// What no file system takes in a name.
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;
export const fileNamed = (name: string, fallback: string, extension: string) => `${name.replace(UNSAFE, '').trim() || fallback}.${extension}`;

export function download(filename: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  clickDownload(filename, url);
  URL.revokeObjectURL(url);
}

// Call in the click handler, before any await: a picker requires the original user activation.
export function downloadOutput(filename: string): Promise<BackupOutput> {
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    const extension = filename.slice(filename.lastIndexOf('.'));
    return picker.call(window, { suggestedName: filename, types: [{ description: extension.slice(1).toUpperCase(), accept: { 'application/octet-stream': [extension] } }] })
      .then((handle) => handle.createWritable())
      .then((stream) => ({ write: (chunk) => stream.write(chunk), close: () => stream.close(), abort: () => stream.abort() }));
  }
  if (!navigator.storage?.getDirectory) return Promise.resolve(memoryOutput(filename));
  return temporaryOutput(filename);
}

// Only a browser with neither a save picker nor a writable disk spool lands here; it holds the whole archive.
function memoryOutput(filename: string): BackupOutput {
  let parts: BlobPart[] = [];
  return {
    write: async (chunk) => { parts.push(new Blob([chunk])); },
    close: async () => {
      download(filename, new Blob(parts, { type: 'application/octet-stream' }));
      parts = [];
    },
    abort: async () => { parts = []; },
  };
}

async function temporaryOutput(filename: string): Promise<BackupOutput> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(TEMPORARY, { create: true });
  // Spools from an earlier export, on this page or an earlier one, go when the next export starts.
  for (;;) {
    const entry = (await directory.values().next()).value;
    if (!entry) break;
    // Do not continue an iterator over entries deleted beneath it.
    await directory.removeEntry(entry.name);
    const url = downloads.get(entry.name);
    if (url) URL.revokeObjectURL(url);
    downloads.delete(entry.name);
  }
  const name = `${crypto.randomUUID()}.zip`;
  const handle = await directory.getFileHandle(name, { create: true });
  if (!handle.createWritable) {
    await directory.removeEntry(name);
    return memoryOutput(filename);
  }
  let stream: FileSystemWritableFileStream;
  try {
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
      // getFile is disk-backed. Removing its entry may invalidate the File during the browser's download, so a
      // completed spool stays until the next export (https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile).
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
