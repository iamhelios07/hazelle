import { useState } from 'react';
import { shown } from '../../model/chat';
import { deleteMessage, editShown, undeleteMessage } from '../../runtime/message-acts';
import type { Shown } from '../../runtime/talk';
import { useSession } from '../session';
import { useToast } from '../toast';

export function useMessageEdit(id: string | null, messages: Shown[], regenerate: (message: Shown) => void) {
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string; text: string; translation: string | null } | null>(null);

  function saveEdit(message: Shown, andReply: boolean) {
    if (!id || !editing) return;
    void editShown(session, id, message, editing.text, editing.translation).then((saved) => saved.ok || toast.failed(saved));
    setEditing(null);
    const next = messages[messages.findIndex(({ id: each }) => each === message.id) + 1];
    if (andReply && next?.role === 'assistant') regenerate(next);
  }

  function remove(message: Shown) {
    if (!id) return;
    void deleteMessage(session, id, message).then((saved) => saved.ok || toast.failed(saved));
    toast.undoable('메시지를 삭제했어요.', () => undeleteMessage(session, id, message));
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
