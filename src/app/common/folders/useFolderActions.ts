import { FOLDER_DEPTH, type Filed } from '../../../model/folders';
import { createFolder, folderRemoval, moveInto, removeFolder, renameFolder, restoreFolder } from '../../../runtime/folders';
import { useStore } from '../../session';
import { useToast } from '../../toast';
import type { NamedFolder } from './FolderParts';
import { filedObject, filedTopic } from './filing';

export function useFolderActions(kind: Filed) {
  const store = useStore();
  const toast = useToast();

  function create(name: string, parent: string | null) {
    void createFolder(store, kind, name, parent).then((saved) => saved.ok || toast.failed(saved));
  }

  function rename(id: string, name: string) {
    void renameFolder(store, id, name).then((saved) => saved.ok || toast.failed(saved));
  }

  function remove(folder: NamedFolder) {
    const removal = folderRemoval(store, folder.id);
    if (!removal) return false;
    void removeFolder(store, removal).then((removed) => removed.ok || toast.failed(removed));
    const { folders: gone, up } = removal;
    const inside = gone.length > 1 ? `와 안의 폴더 ${gone.length - 1}개` : '';
    toast.undoable(
      `'${folder.name}' 폴더${inside}를 삭제했어요.`,
      () => restoreFolder(store, removal),
      `${filedTopic(kind)} ${up ? `'${up.value.name}' 폴더로` : '폴더 밖으로'} 옮겼어요.`,
    );
    return true;
  }

  // to: a folder, or null for out of every folder. shown: how many the user moved, where ids carry more along.
  function move(ids: string[], to: { id: string; name: string } | null, shown = ids.length) {
    void moveInto(store, kind, ids, to?.id ?? null).then((moved) => moved.ok || toast.failed(moved));
    toast.show(to ? `${filedObject(kind, shown)} '${to.name}' 폴더로 옮겼어요.` : `${filedObject(kind, shown)} 폴더에서 뺐어요.`);
  }

  return { deepest: FOLDER_DEPTH, create, rename, remove, move };
}
