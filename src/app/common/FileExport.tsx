import { useState } from 'react';
import { Button, Callout, Dialog, Section, Text } from '../ui';
import { ACTS } from './acts';
import { EXPORT } from './words';

type Props = {
  format: string;
  file: string;
  // What the file leaves behind and where the other app opens it.
  help: string;
  // Why no file can be made, said in place of the 내보내기 that would make one the other app refuses.
  blocked: string | null;
  // Runs in the press, so runExport's save picker opens (common/exporting); show is its busy label.
  onExport: (show: (label: string | null) => void) => void;
  onClose: () => void;
};

export function FileExport({ format, file, help, blocked, onExport, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog
      title={EXPORT}
      onClose={onClose}
      actions={
        <Button icon={ACTS.export.icon} busy={busy !== null} disabled={blocked !== null} onClick={() => onExport(setBusy)}>
          {busy ?? ACTS.export.label}
        </Button>
      }
    >
      <Section level={3} title={format} help={help}>
        {blocked === null ? <Text variant="note">{file}</Text> : <Callout tone="warn">{blocked}</Callout>}
      </Section>
    </Dialog>
  );
}
