// A file read in slices: a Risu backup (design F7; research/risu-backup-spec.md) or a .risum. Either can exceed
// memory, so readers take slices, never an arrayBuffer of the whole file. Pictures stay in the file until a character,
// persona or module is brought.
export type FileSource = { size: number; read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> };

export const fileSource = (file: File): FileSource => ({
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
});
