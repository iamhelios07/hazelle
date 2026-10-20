import { useState } from 'react';
import { Button, Dialog, TextField } from '../ui';
import { withParticle } from './particles';

// blank: what a blank means where it is a value, such as a chat title that falls back to its first message; it lets the
// blank through and stands as the hint. Elsewhere a blank keeps the old name (a ruling), so the dialog refuses it and
// onSave never gets one.
type Props = { title: string; field?: string; value: string; hint?: string; blank?: string; onSave: (name: string) => void; onClose: () => void };

export function NameDialog({ title, field = '이름', value, hint, blank, onSave, onClose }: Props) {
  const [name, setName] = useState(value);
  const refused = blank === undefined && !name.trim();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={() => onSave(name.trim())}
      actionsLayout="full"
      actions={
        <Button type="submit" disabled={refused}>
          저장
        </Button>
      }
    >
      <TextField label={field} value={name} onChange={setName} hint={blank ?? hint ?? (refused ? `${withParticle(field, '을/를')} 입력해 주세요.` : undefined)} />
    </Dialog>
  );
}
