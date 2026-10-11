import { useState } from 'react';
import { Button, Dialog, TextField } from '../ui';

type Props = { title: string; field?: string; value: string; hint?: string; onSave: (name: string) => void; onClose: () => void };

export function NameDialog({ title, field = '이름', value, hint, onSave, onClose }: Props) {
  const [name, setName] = useState(value);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={() => onSave(name)}
      actionsLayout="full"
      actions={
        <Button type="submit">
          저장
        </Button>
      }
    >
      <TextField label={field} value={name} onChange={setName} hint={hint} />
    </Dialog>
  );
}
