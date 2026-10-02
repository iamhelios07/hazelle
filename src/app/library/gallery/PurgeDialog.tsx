import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../ui';

// The one removal that asks first: 지금 지우기 cannot be undone, where every other deletion offers 되돌리기. what is
// what goes, as the object of 지워요.
export function PurgeDialog({ what, onPurge, onClose }: { what: string; onPurge: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog title="완전히 지울까요?" confirm="완전히 지우기" icon={Trash2} onConfirm={onPurge} onClose={onClose}>
      {what} 지금 완전히 지워요. 되돌릴 수 없어요.
    </ConfirmDialog>
  );
}
