import { createFolder, folderRemoval, moveCharacters, removeFolder, renameFolder, restoreFolder, type RemovedFolder } from '../../runtime/characters';
import type { FolderTree } from '../../model/library';
import { useLibrary, useStore } from '../session';
import { useToast } from '../toast';

export function useFolderActions() {
  const store = useStore();
  const toast = useToast();
  const { byFolder } = useLibrary();

  function create(name: string, parent: string | null) {
    void createFolder(store, name, parent).then((saved) => saved.ok || toast.failed(saved));
  }

  function rename(id: string, name: string) {
    void renameFolder(store, id, name).then((saved) => saved.ok || toast.failed(saved));
  }

  // What goes and where its characters go, or null when the folder is gone.
  function remove(folder: FolderTree): RemovedFolder | null {
    const removal = folderRemoval(store, folder.id);
    if (!removal) return null;
    void removeFolder(store, removal).then((removed) => removed.ok || toast.failed(removed));
    const { folders: gone, up } = removal;
    const inside = gone.length > 1 ? `와 안의 폴더 ${gone.length - 1}개` : '';
    toast.undoable(
      `'${folder.value.name}' 폴더${inside}를 삭제했어요.`,
      () => restoreFolder(store, removal),
      `캐릭터는 ${up ? `'${up.value.name}' 폴더로` : '폴더 밖으로'} 옮겼어요.`,
    );
    return removal;
  }

  // to null takes them out of every folder.
  function move(ids: string[], to: string | null) {
    void moveCharacters(store, ids, to).then((moved) => moved.ok || toast.failed(moved));
    const name = to === null ? undefined : byFolder.get(to)?.folder.value.name;
    toast.show(to ? `${ids.length}명을 '${name}' 폴더로 옮겼어요.` : `${ids.length}명을 폴더에서 뺐어요.`);
  }

  return { create, rename, remove, move };
}
