import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MAX_REASON_LENGTH } from '../../contracts/board';
import type { ApiResult } from '../../runtime/api';
import { readPosts, type ListAsk } from '../../runtime/board';
import { describeFailure } from '../common/failure';
import { PostItem } from '../common/postRow';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { PagedList, usePages } from '../common/useLoaded';
import { Button, Callout, Dialog, TextField } from '../ui';
import { useNicknameGate } from './nickname';
import { useVotes } from './vote';

// A text field's count against its limit, and the error once past it. Counted as the server counts: trimmed.
export function counted(text: string, max: number) {
  const length = text.trim().length;
  const over = length > max;
  return { length, over, hint: `${count(length)} / ${count(max)}자`, error: over ? `${count(max)}자까지 쓸 수 있어요.` : undefined };
}

// Every list of posts: asked again whole when its ask changes, as its caller keys it. votes: 추천 pressed in the feed,
// on the public posts that take one.
export function PostList({ ask, label, empty, votes = false }: { ask: ListAsk; label: string; empty: string; votes?: boolean }) {
  const pages = usePages((after) => readPosts(after, ask));
  const { gate, dialog } = useNicknameGate();
  const vote = useVotes(gate);
  return (
    <>
      <PagedList pages={pages} head={false} label={label} empty={empty} feed>
        {(row) => <PostItem key={row.id} row={row} vote={votes && row.visibility === 'public' && !row.deleted ? vote(row) : null} />}
      </PagedList>
      {dialog}
    </>
  );
}
// A reason typed before an act on a post or comment: a 신고, or the operator hiding it. also: fields beside the reason.
export function ReasonDialog({ title, note, label, confirm, also, ready = true, send, onDone, onClose }: {
  title: string;
  note?: string;
  label: string;
  confirm: { label: string; icon: LucideIcon };
  also?: ReactNode;
  ready?: boolean;
  send: (reason: string) => Promise<ApiResult<undefined>>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const { busy, failure, run } = useAttempt();
  const { length, over, hint, error } = counted(reason, MAX_REASON_LENGTH);
  const submit = () =>
    run(async () => {
      const sent = await send(reason.trim());
      if (!sent.ok) return describeFailure(sent);
      onDone();
      return null;
    });
  return (
    <Dialog
      title={title}
      note={note}
      onClose={onClose}
      onSubmit={() => void submit()}
      actions={
        <Button type="submit" icon={confirm.icon} busy={busy} disabled={length === 0 || over || !ready}>
          {confirm.label}
        </Button>
      }
    >
      <TextField label={label} lines={3} value={reason} onChange={setReason} hint={hint} error={error} />
      {also}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
