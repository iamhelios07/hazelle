import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Text } from '../foundation/Text';
import { Dialog } from './Dialog';

type Props = {
  title: string;
  confirm: string;
  icon: LucideIcon;
  // While the act runs, such as a request to the server.
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
  // What the act asks for before it runs, such as the password again; Enter in it confirms.
  field?: ReactNode;
};

// Asks before something that cannot be undone; children say what will happen.
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
