import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Text } from '../foundation/Text';
import { Dialog } from './Dialog';

type Props = { title: string; confirm: string; icon: LucideIcon; onConfirm: () => void; onClose: () => void; children: ReactNode };

// Asks before something that cannot be undone; children say what will happen.
export function ConfirmDialog({ title, confirm, icon, onConfirm, onClose, children }: Props) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button icon={icon} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      <Text>{children}</Text>
    </Dialog>
  );
}
