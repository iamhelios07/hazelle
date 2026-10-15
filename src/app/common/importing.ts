import { createContext, useContext } from 'react';

// The app's one import, provided by library/ImportFlow, so any feature can open it. pickChats: the character a file of
// chats goes to, null for 캐릭터 없이. bring: a file the app made, a share link's charx, taken as a dropped one; true once
// a character came of it.
export type Importer = { pick: () => void; pickChats: (target: string | null) => void; pickPrompts: () => void; pickPersonas: () => void; move: () => void; bring: (file: File) => Promise<boolean> };

export const ImportContext = createContext<Importer | null>(null);

export function useImport(): Importer {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}
