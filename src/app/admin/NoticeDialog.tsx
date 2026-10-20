import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MAX_NOTICE_LENGTH } from '../../contracts/admin';
import type { ApiResult } from '../../runtime/api';
import { describeFailure } from '../common/failure';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Dialog, TextField } from '../ui';

type Props = {
  title: string;
  note?: string;
  label: string;
  placeholder?: string;
  confirm: { label: string; icon: LucideIcon };
  about?: ReactNode;
  send: (text: string) => Promise<ApiResult<undefined>>;
  onSent: () => void;
  onClose: () => void;
};

// The one place the operator writes a notice: alone, with a link's block, or with a suspension.
export function NoticeDialog({ title, note, label, placeholder, confirm, about, send, onSent, onClose }: Props) {
  const [text, setText] = useState('');
  const { busy, failure, run } = useAttempt();
  const length = text.trim().length;
  const over = length > MAX_NOTICE_LENGTH;
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
        <Button icon={confirm.icon} busy={busy} disabled={over || length === 0} onClick={() => void submit()}>
          {confirm.label}
        </Button>
      }
    >
      {about}
      <TextField
        label={label}
        lines={5}
        value={text}
        onChange={setText}
        placeholder={placeholder}
        hint={`${count(length)} / ${count(MAX_NOTICE_LENGTH)}자`}
        error={over ? `최대 ${count(MAX_NOTICE_LENGTH)}자까지 보낼 수 있어요.` : undefined}
      />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
