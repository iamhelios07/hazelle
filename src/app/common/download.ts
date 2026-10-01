import type { BackupOutput } from '../../runtime/backup';

export function download(filename: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Call in the click handler, before any await: a picker requires the original user activation.
export function downloadOutput(filename: string): Promise<BackupOutput> {
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    return picker.call(window, { suggestedName: filename, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] })
      .then((handle) => handle.createWritable())
      .then((stream) => ({ write: (chunk) => stream.write(chunk), close: () => stream.close(), abort: () => stream.abort() }));
  }
  let parts: BlobPart[] = [];
  return Promise.resolve({
    write: async (chunk) => { parts.push(new Blob([chunk])); },
    close: async () => {
      download(filename, new Blob(parts, { type: 'application/zip' }));
      parts = [];
    },
    abort: async () => { parts = []; },
  });
}
