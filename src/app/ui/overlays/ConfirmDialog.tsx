import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Text } from '../foundation/Text';
import { Dialog } from './Dialog';

type Props = {
  title: string;
  confirm: string;
  icon: LucideIcon;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
  field?: ReactNode;
};

export function ConfirmDialog({ title, confirm, icon, busy = false, onConfirm, onClose, children, field }: Props) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={onConfirm}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" icon={icon} busy={busy}>
            {confirm}
          </Button>
        </>
      }
    >
      <Text>{children}</Text>
      {field}
    </Dialog>
  );
}
