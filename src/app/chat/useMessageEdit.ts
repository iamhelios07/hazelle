import { useState } from 'react';
import { shown } from '../../model/chat';
import { editMessage, removeMessage, restoreMessage } from '../../runtime/chat-log';
import type { Shown } from '../../runtime/talk';
import { useSession } from '../session';
import { useToast } from '../toast';

export function useMessageEdit(id: string | null, last: Shown | undefined, regenerate: (message: Shown) => void) {
  const { store } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string; text: string; translation: string | null } | null>(null);

  function saveEdit(message: Shown, andReply: boolean) {
    if (!id || !editing) return;
    void editMessage(store, id, message, editing.text, editing.translation).then((saved) => saved.ok || toast.failed(saved));
    setEditing(null);
    if (andReply && last && last.role === 'assistant') regenerate(last);
  }

  function remove(message: Shown) {
    if (!id) return;
    void removeMessage(store, id, message.id).then((saved) => saved.ok || toast.failed(saved));
    toast.undoable('메시지를 삭제했어요', () => void restoreMessage(store, id, message.id));
  }

  return {
    editing,
    actions: {
      edit: (message: Shown) => {
        const version = shown(message);
        setEditing({ id: message.id, text: version.text, translation: version.translation?.text ?? null });
      },
      changeEdit: (change: { text: string } | { translation: string }) => setEditing((current) => current && { ...current, ...change }),
      cancelEdit: () => setEditing(null),
      saveEdit,
      remove,
    },
  };
}
