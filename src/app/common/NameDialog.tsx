import { useState } from 'react';
import { Button, Dialog, TextField } from '../ui';
import { withParticle } from './particles';

// blank: a blank is a value here, such as a chat title that falls back to its first message. Elsewhere a blank keeps
// the old name (a ruling), so the dialog refuses it and onSave never gets one.
type Props = { title: string; field?: string; value: string; hint?: string; blank?: boolean; onSave: (name: string) => void; onClose: () => void };

export function NameDialog({ title, field = '이름', value, hint, blank = false, onSave, onClose }: Props) {
  const [name, setName] = useState(value);
  const refused = !blank && !name.trim();
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
      <TextField label={field} value={name} onChange={setName} hint={hint ?? (refused ? `${withParticle(field, '을/를')} 입력해 주세요.` : undefined)} />
    </Dialog>
  );
}
