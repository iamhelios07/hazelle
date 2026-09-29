import { Trash2 } from 'lucide-react';
import type { ChatItem } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { ConfirmDialog } from '../../ui';
import { withChats } from '../shelf';

// The one removal that asks first: 지금 지우기 cannot be undone, where every other deletion offers 되돌리기.
export function PurgeDialog({ shelf, onPurge, onClose }: { shelf: CharacterShelf<ChatItem>; onPurge: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog title="완전히 지울까요?" confirm="완전히 지우기" icon={Trash2} onConfirm={onPurge} onClose={onClose}>
      ‘{shelf.character.card.name}’ {withChats(shelf)} 지금 완전히 지워요. 되돌릴 수 없어요.
    </ConfirmDialog>
  );
}
