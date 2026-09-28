import type { LucideIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Button } from './Button';

type Props = { accept: string; icon?: LucideIcon; size?: 'sm' | 'md' | 'lg'; onFile: (file: File) => void; children: ReactNode };

// A real button opens the hidden file input, so the picker is reachable by keyboard.
export function FileButton({ accept, icon, size, onFile, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="secondary" size={size} icon={icon} onClick={() => input.current?.click()}>
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
