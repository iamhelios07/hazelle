import { useState } from 'react';
import { Button, Dialog, Stack, TextField } from '../ui';

type Props = { title: string; value: string; hint?: string; onSave: (name: string) => void; onClose: () => void };

// Naming one thing: a chat, a folder.
export function NameDialog({ title, value, hint, onSave, onClose }: Props) {
  const [name, setName] = useState(value);
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name);
        }}
      >
        <Stack gap="related">
          <TextField label="이름" value={name} onChange={setName} hint={hint} />
          <Button type="submit" size="md">
            저장
          </Button>
        </Stack>
      </form>
    </Dialog>
  );
}
