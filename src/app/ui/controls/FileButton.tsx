import type { LucideIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Button } from './Button';

type Props = { accept: string; multiple?: boolean; icon?: LucideIcon; size?: 'sm' | 'lg'; busy?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; children: ReactNode };

// A real button opens the hidden file input, so the picker is reachable by keyboard.
export function FileButton({ accept, multiple = false, icon, size = 'lg', busy = false, disabled = false, onFiles, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="secondary" size={size} icon={icon} busy={busy} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
