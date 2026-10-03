import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ApiResult } from '../../runtime/api';
import { NOTICE_LENGTH } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Dialog, TextField } from '../ui';

type Props = {
  title: string;
  note?: string;
  label: string;
  // An act the notice goes with, such as resolving a report, may leave the text optional: blank sends no notice.
  optional?: boolean;
  placeholder?: string;
  confirm: { label: string; icon: LucideIcon };
  about?: ReactNode;
  also?: ReactNode;
  send: (text: string) => Promise<ApiResult<undefined>>;
  onSent: () => void;
  onClose: () => void;
};

// The one place the operator writes a notice: alone, with a report's resolving, or with a suspension.
export function NoticeDialog({ title, note, label, optional = false, placeholder, confirm, about, also, send, onSent, onClose }: Props) {
  const [text, setText] = useState('');
  const { busy, failure, run } = useAttempt();
  const length = text.trim().length;
  const over = length > NOTICE_LENGTH;
  const submit = () =>
    run(async () => {
      const sent = await send(text);
      if (!sent.ok) return describeFailure(sent);
      onSent();
      return null;
    });
  return (
    <Dialog
      title={title}
      note={note}
      onClose={onClose}
      actions={
        <>
          {also}
          <Button icon={confirm.icon} busy={busy} disabled={over || (!optional && length === 0)} onClick={() => void submit()}>
            {confirm.label}
          </Button>
        </>
      }
    >
      {about}
      <TextField
        label={label}
        lines={5}
        value={text}
        onChange={setText}
        placeholder={placeholder}
        hint={`${length.toLocaleString('ko-KR')} / ${NOTICE_LENGTH.toLocaleString('ko-KR')}자`}
        error={over ? `${NOTICE_LENGTH.toLocaleString('ko-KR')}자까지 보낼 수 있어요.` : undefined}
      />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
