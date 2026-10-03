import { createFolder, moveCharacters, removeFolder, renameFolder, restoreFolder, type RemovedFolder } from '../../runtime/characters';
import type { FolderTree } from '../../model/library';
import { useLibrary, useStore } from '../session';
import { useToast } from '../toast';

export function useFolderActions() {
  const store = useStore();
  const toast = useToast();
  const { byFolder } = useLibrary();

  async function create(name: string, parent: string | null) {
    const saved = await createFolder(store, name, parent);
    if (!saved.ok) toast.failed(saved);
  }

  async function rename(id: string, name: string) {
    const saved = await renameFolder(store, id, name);
    if (!saved.ok) toast.failed(saved);
  }

  // What went and where its characters went, or null when nothing did.
  async function remove(folder: FolderTree): Promise<RemovedFolder | null> {
    const removed = await removeFolder(store, folder.id);
    if (!removed.ok) {
      toast.failed(removed);
      return null;
    }
    const { folders: gone, up } = removed.data;
    const inside = gone.length > 1 ? `와 안의 폴더 ${gone.length - 1}개` : '';
    toast.undoable(
      `‘${folder.value.name}’ 폴더${inside}를 지웠어요.`,
      () => void restoreFolder(store, removed.data).then((restored) => restored.ok || toast.failed(restored)),
      `캐릭터는 ${up ? `‘${up.value.name}’ 폴더로` : '폴더 밖으로'} 옮겼어요.`,
    );
    return removed.data;
  }

  // to null takes them out of every folder. Answers whether they moved.
  async function move(ids: string[], to: string | null): Promise<boolean> {
    const moved = await moveCharacters(store, ids, to);
    if (!moved.ok) {
      toast.failed(moved);
      return false;
    }
    const name = to === null ? undefined : byFolder.get(to)?.folder.value.name;
    toast.show(to ? `${ids.length}명을 ‘${name}’ 폴더로 옮겼어요.` : `${ids.length}명을 폴더에서 뺐어요.`);
    return true;
  }

  return { create, rename, remove, move };
}
