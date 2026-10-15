import { useEffect, useRef, useState } from 'react';

// How many screens that take dropped files of their own are mounted; while one is, the app-wide drop stands aside.
let screens = 0;

// A drag enters the next element before it leaves the last, so only a leave from the element last entered means it left
// the page or was cancelled. Content replaced under the pointer, as a streaming reply is, gets its leave sent to a node
// no longer in the page; DropOverlay takes the pointer so the element under it stays put.
// scope 'screen': a screen's own drop, such as an editor's 에셋 taking pictures, which the app's import would read as cards.
export function useFileDrop(onDrop: (files: File[]) => void, scope: 'app' | 'screen' = 'app'): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    if (scope === 'screen') screens += 1;
    let entered: EventTarget | null = null;
    const carriesFiles = (event: DragEvent) => (scope === 'screen' || screens === 0) && (event.dataTransfer?.types.includes('Files') ?? false);
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Cancelled like dragover: when the element under the pointer changed since the last tick, the browser takes the
      // drop or refuses it by this event alone, and over a streaming reply it changes every tick.
      event.preventDefault();
      entered = event.target;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event) || event.target !== entered) return;
      entered = null;
      setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      entered = null;
      setDragging(false);
      // Entries are only readable during the drop event itself; their files are read after it. An item that is not from
      // the file system has no entry, and is taken as its file.
      const dropped = [...(event.dataTransfer?.items ?? [])].flatMap((item) => (item.kind === 'file' ? (item.webkitGetAsEntry() ?? item.getAsFile() ?? []) : []));
      void droppedFiles(dropped).then((files) => latest.current(files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      if (scope === 'screen') screens -= 1;
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [scope]);
  return dragging;
}

// A folder brings every file under it, in its folders too. readEntries hands a folder out a batch at a time (100 in
// Chromium), so it is asked again until it hands none.
export async function droppedFiles(entries: readonly (FileSystemEntry | File)[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry instanceof File) files.push(entry);
    else if (isFolder(entry)) files.push(...(await droppedFiles(await inside(entry))));
    else if (isFile(entry)) {
      const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) files.push(file);
    }
  }
  return files;
}

const isFolder = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;
const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;

async function inside(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = folder.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}
