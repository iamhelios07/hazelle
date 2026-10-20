import { ImageUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ApiFailure } from '../../runtime/api';
import { useToast } from '../toast';
import { FaceRow, FileButton } from '../ui';
import { CHANGE_IMAGE } from './words';

// apply answers 'picture-unreadable' for a file it cannot read as a picture.
export function FaceChange({ face, apply }: { face: ReactNode; apply: (file: File) => Promise<{ ok: true } | ApiFailure> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function change(file: File) {
    setBusy(true);
    const changed = await apply(file);
    setBusy(false);
    if (!changed.ok) toast.failed(changed, '이미지를 바꾸지 못했어요.');
  }

  return (
    <FaceRow face={face}>
      <FileButton accept="image/*" size="sm" icon={ImageUp} busy={busy} onFiles={([file]) => void change(file!)}>
        {CHANGE_IMAGE}
      </FileButton>
    </FaceRow>
  );
}
