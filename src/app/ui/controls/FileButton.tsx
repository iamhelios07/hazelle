import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

type Props = { accept: string; multiple?: boolean; icon?: LucideIcon; size?: 'sm' | 'lg'; busy?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; children: ReactNode };

// Call it in the press itself: the picker opens only on the press's own activation. The input is put in the document
// while it is open, since some mobile browsers open no picker for one outside it.
export function pickFiles(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.hidden = true;
  const done = () => input.remove();
  input.addEventListener('cancel', done);
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    done();
    if (files.length) onFiles(files);
  });
  document.body.append(input);
  input.click();
}

export function FileButton({ accept, multiple = false, icon, size = 'lg', busy = false, disabled = false, onFiles, children }: Props) {
  return (
    <Button variant="secondary" size={size} icon={icon} busy={busy} disabled={disabled} onClick={() => pickFiles(accept, multiple, onFiles)}>
      {children}
    </Button>
  );
}
