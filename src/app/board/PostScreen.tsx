import { Check, EyeOff, Eye, Flag, History, Lock, LockOpen, PenLine, Tag as TagIcon } from 'lucide-react';
import { useState } from 'react';
import { HOLD_DAYS_MAX, MAX_COMMENT_LENGTH, STATUSES, type Comment, type Hidden, type Post, type Status } from '../../contracts/board';
import type { ApiResult } from '../../runtime/api';
import {
  deleteComment,
  deletePost,
  editComment,
  readPost,
  reportComment,
  reportPost,
  setCommentHidden,
  setPostHidden,
  setPostLocked,
  setPostStatus,
  writeComment,
} from '../../runtime/board';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { linkify } from '../common/linkify';
import { AuthorLine, authorName, PostMarks } from '../common/postRow';
import { RestoresDialog } from '../common/RestoresDialog';
import { ago, moment } from '../common/time';
import { count, readCount } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { useLoaded } from '../common/useLoaded';
import { BOARD, SHARE } from '../common/words';
import { useAccount } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, CommentBox, ConfirmDialog, Dialog, Empty, MenuHeading, MenuItem, MoreMenu, NavBar, Row, Screen, Section, Stack, Tag, Text, TextField, Thread, ThreadItem, VoteButton } from '../ui';
import { useNicknameGate } from './nickname';
import { counted, ReasonDialog } from './parts';
import { useVotes } from './vote';

type Gate = (then: () => void) => void;
type Author = Post['author'];
type Asking =
  | { kind: 'delete-post' }
  | { kind: 'report-post' }
  | { kind: 'status' }
  | { kind: 'hide-post' }
  | { kind: 'restore'; account: { id: string; username: string } }
  | { kind: 'delete-comment'; comment: Comment }
  | { kind: 'report-comment'; comment: Comment }
  | { kind: 'hide-comment'; comment: Comment };

const edited = (at: number, editedAt: number | null) => (editedAt === null ? ago(at) : `${ago(at)} · 수정됨`);
const hiddenLine = (what: string, { reason, until }: Hidden) => `운영자가 가린 ${what}이에요. 이유: ${reason}${until === null ? '' : ` · ${moment(until)}까지`}`;

export function PostScreen({ id, back }: { id: number; back: Back }) {
  const loaded = useLoaded(() => readPost(id), [id]);
  const post = loaded.data?.post;
  // A reload that failed shows its failure, not the post as it was: the post may be gone (its last comment deleted).
  if (!post || loaded.failure) return (
    <Screen width="form" top={<NavBar title={BOARD.title} {...backBar(back)} />}>
      {loaded.loading}
      {loaded.failure}
    </Screen>
  );
  return <PostView post={post} reload={loaded.reload} back={back} />;
}

function PostView({ post, reload, back }: { post: Post; reload: () => void; back: Back }) {
  const { admin } = useAccount();
  const toast = useToast();
  const { gate, dialog } = useNicknameGate();
  const vote = useVotes(gate)(post);
  const [asking, setAsking] = useState<Asking | null>(null);
  const { busy, run } = useAttempt();
  const mine = post.author.mine;
  const close = () => setAsking(null);
  const done = () => {
    close();
    reload();
  };

  const act = (request: () => Promise<ApiResult<undefined>>, failed: string) =>
    void request().then((answer) => (answer.ok ? reload() : toast.failed(answer, failed)));

  const removePost = () =>
    run(async () => {
      const removed = await deletePost(post.id);
      if (!removed.ok) {
        toast.failed(removed, '삭제하지 못했어요.');
        return null;
      }
      toast.show('삭제했어요.');
      close();
      if (post.comments.length) reload();
      else navigate({ kind: 'board', operator: false }, { replace: true });
      return null;
    });

  const removeComment = (comment: Comment) =>
    run(async () => {
      const removed = await deleteComment(comment.id);
      if (!removed.ok) toast.failed(removed, '삭제하지 못했어요.');
      else done();
      return null;
    });

  const live = post.text !== null;
  const items = [
    ...(mine && live
      ? [
          <MenuItem key="edit" icon={PenLine} label="수정" onClick={() => navigate({ kind: 'board-edit', id: post.id })} />,
          <MenuItem key="delete" icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => setAsking({ kind: 'delete-post' })} />,
        ]
      : []),
    ...(!mine && live ? [<MenuItem key="report" icon={Flag} label={SHARE.report} onClick={() => setAsking({ kind: 'report-post' })} />] : []),
    ...(admin
      ? [
          <MenuHeading key="operate">운영</MenuHeading>,
          <MenuItem key="status" icon={TagIcon} label="상태 바꾸기" onClick={() => setAsking({ kind: 'status' })} />,
          post.hidden ? (
            <MenuItem key="show" icon={Eye} label="보이기" onClick={() => act(() => setPostHidden(post.id, null), '보이게 하지 못했어요.')} />
          ) : (
            <MenuItem key="hide" icon={EyeOff} label="가리기" onClick={() => setAsking({ kind: 'hide-post' })} />
          ),
          <MenuItem
            key="lock"
            icon={post.locked ? LockOpen : Lock}
            label={post.locked ? '댓글 열기' : '댓글 닫기'}
            onClick={() => act(() => setPostLocked(post.id, !post.locked), '바꾸지 못했어요.')}
          />,
          ...(post.visibility === 'operator' && post.account
            ? [<MenuItem key="restore" icon={History} label="이 글로 복원" onClick={() => setAsking({ kind: 'restore', account: post.account! })} />]
            : []),
          ...(mine ? [] : [<MenuItem key="remove" icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => setAsking({ kind: 'delete-post' })} />]),
        ]
      : []),
  ];

  const voteLabel = `${BOARD.vote} ${count(vote.votes)}`;
  return (
    <Screen width="form" top={<NavBar title={post.title} {...backBar(back)} menu={items.length ? { of: '글', items } : undefined} />}>
      <Stack gap="group">
        <Row kind="tags">
          <PostMarks row={post} />
        </Row>
        <AuthorLine author={post.author} note={edited(post.createdAt, post.editedAt)} size="md" />
        {post.hidden && <Callout tone="warn">{hiddenLine('글', post.hidden)}</Callout>}
        {post.visibility === 'operator' && <Text variant="note">운영자만 읽을 수 있는 글이에요.</Text>}
        {live ? <Text variant="written">{linkify(post.text!)}</Text> : <Text variant="note">삭제된 글이에요.</Text>}
        {admin && post.diagnostics !== null && <TextField label="진단 정보" lines={8} value={post.diagnostics} onChange={() => {}} readOnly />}
        {live && post.visibility === 'public' && (
          <Row kind="actions">
            <VoteButton label={vote.voted ? `${voteLabel}, 추천함` : voteLabel} count={count(vote.votes)} pressed={vote.voted} onClick={vote.onFlip} />
          </Row>
        )}
      </Stack>
      <Comments post={post} admin={admin} gate={gate} onAsk={setAsking} onChanged={reload} />
      {dialog}
      {asking?.kind === 'delete-post' && (
        <ConfirmDialog title="이 글을 삭제할까요?" confirm={ACTS.remove.label} icon={ACTS.remove.icon} busy={busy} onConfirm={() => void removePost()} onClose={close}>
          {post.comments.length ? '댓글은 남고, 글은 삭제됐다고 표시돼요.' : '삭제하면 되돌릴 수 없어요.'}
        </ConfirmDialog>
      )}
      {asking?.kind === 'delete-comment' && (
        <ConfirmDialog title="이 댓글을 삭제할까요?" confirm={ACTS.remove.label} icon={ACTS.remove.icon} busy={busy} onConfirm={() => void removeComment(asking.comment)} onClose={close}>
          삭제하면 되돌릴 수 없어요.
        </ConfirmDialog>
      )}
      {(asking?.kind === 'report-post' || asking?.kind === 'report-comment') && (
        <ReasonDialog
          title={asking.kind === 'report-post' ? '글 신고' : '댓글 신고'}
          note="운영자가 확인해요."
          label="신고 이유"
          confirm={{ label: SHARE.report, icon: Flag }}
          send={(reason) => (asking.kind === 'report-post' ? reportPost(post.id, reason) : reportComment(asking.comment.id, reason))}
          onDone={() => {
            close();
            toast.show('신고했어요.');
          }}
          onClose={close}
        />
      )}
      {asking?.kind === 'hide-post' && <HideDialog what="글" send={(hidden) => setPostHidden(post.id, hidden)} onDone={done} onClose={close} />}
      {asking?.kind === 'hide-comment' && <HideDialog what="댓글" send={(hidden) => setCommentHidden(asking.comment.id, hidden)} onDone={done} onClose={close} />}
      {asking?.kind === 'status' && <StatusDialog post={post} onDone={done} onClose={close} />}
      {asking?.kind === 'restore' && (
        <RestoresDialog
          operated={{ accountId: asking.account.id, username: asking.account.username, post: { id: post.id, text: post.text ?? post.title } }}
          onClose={close}
        />
      )}
    </Screen>
  );
}

// Flat under the post, each 답글 one level under the comment it answers; a 답글 whose comment is not here stands at the
// top rather than vanish.
function Comments({ post, admin, gate, onAsk, onChanged }: { post: Post; admin: boolean; gate: Gate; onAsk: (asking: Asking) => void; onChanged: () => void }) {
  const toast = useToast();
  const [replying, setReplying] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const ids = new Set(post.comments.map((comment) => comment.id));
  const tops = post.comments.filter((comment) => comment.parentId === null || !ids.has(comment.parentId));
  const repliesOf = (id: number) => post.comments.filter((comment) => comment.parentId === id);
  const open = (!post.locked || admin) && post.text !== null;

  function item(comment: Comment, top: boolean) {
    const { mine } = comment.author;
    const live = comment.text !== null;
    const menu = [
      ...(mine && live
        ? [
            <MenuItem key="edit" icon={PenLine} label="수정" onClick={() => setEditing(comment.id)} />,
            <MenuItem key="delete" icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onAsk({ kind: 'delete-comment', comment })} />,
          ]
        : []),
      ...(!mine && live ? [<MenuItem key="report" icon={Flag} label={SHARE.report} onClick={() => onAsk({ kind: 'report-comment', comment })} />] : []),
      ...(admin && !comment.deleted
        ? [
            <MenuHeading key="operate">운영</MenuHeading>,
            comment.hidden ? (
              <MenuItem
                key="show"
                icon={Eye}
                label="보이기"
                onClick={() => void setCommentHidden(comment.id, null).then((answer) => (answer.ok ? onChanged() : toast.failed(answer, '보이게 하지 못했어요.')))}
              />
            ) : (
              <MenuItem key="hide" icon={EyeOff} label="가리기" onClick={() => onAsk({ kind: 'hide-comment', comment })} />
            ),
            ...(mine ? [] : [<MenuItem key="remove" icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onAsk({ kind: 'delete-comment', comment })} />]),
          ]
        : []),
    ];
    const replies = top ? repliesOf(comment.id).map((reply) => item(reply, false)) : [];
    const answering = top && open && replying === comment.id;
    return (
      <ThreadItem
        key={comment.id}
        byline={
          <AuthorLine
            author={comment.author}
            size="md"
            note={edited(comment.createdAt, comment.editedAt)}
            marks={
              <>
                {byAuthor(comment.author, post.author) && <Tag>{BOARD.author}</Tag>}
                {comment.hidden && <Tag tone="faint">{BOARD.hidden}</Tag>}
              </>
            }
          />
        }
        control={menu.length ? <MoreMenu of={BOARD.comment}>{menu}</MoreMenu> : undefined}
        foot={
          top && open && !answering && editing !== comment.id ? (
            <Button variant="link" size="xs" onClick={() => gate(() => setReplying(comment.id))}>
              {BOARD.reply}
            </Button>
          ) : undefined
        }
        replies={
          replies.length || answering ? (
            <>
              {replies}
              {answering && (
                <li>
                  <CommentComposer
                    label={BOARD.reply}
                    placeholder={`${authorName(comment.author)}님에게 ${BOARD.reply}`}
                    confirm="등록"
                    focus
                    gate={gate}
                    send={(text) => writeComment(post.id, text, comment.id)}
                    onDone={() => {
                      setReplying(null);
                      onChanged();
                    }}
                    onCancel={() => setReplying(null)}
                  />
                </li>
              )}
            </>
          ) : undefined
        }
      >
        {editing === comment.id ? (
          <CommentComposer
            label={BOARD.comment}
            initial={comment.text ?? ''}
            confirm="저장"
            focus
            gate={gate}
            send={(text) => editComment(comment.id, text)}
            onDone={() => {
              setEditing(null);
              onChanged();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : live ? (
          <>
            <Text variant="written">{linkify(comment.text!)}</Text>
            {comment.hidden && <Text variant="note">{hiddenLine('댓글', comment.hidden)}</Text>}
          </>
        ) : (
          <Text variant="note">{comment.deleted ? '삭제된 댓글' : '운영자가 가린 댓글'}</Text>
        )}
      </ThreadItem>
    );
  }

  return (
    <Section title={`${BOARD.comment} ${count(post.comments.length)}`}>
      {tops.length ? <Thread label={BOARD.comment}>{tops.map((comment) => item(comment, true))}</Thread> : <Empty variant="section">첫 댓글을 남겨 보세요.</Empty>}
      {post.locked ? (
        <Text variant="note">운영자가 댓글을 닫았어요.</Text>
      ) : (
        post.text !== null && <CommentComposer label={BOARD.comment} placeholder="댓글 남기기" confirm="등록" gate={gate} send={(text) => writeComment(post.id, text, null)} onDone={onChanged} />
      )}
    </Section>
  );
}

// Names are unique, so the same name is the same account; an account without one, or gone, matches nothing.
const byAuthor = (by: Author, author: Author) => (by.operator && author.operator) || (!by.left && !author.left && by.name !== null && by.name === author.name);

function CommentComposer({ label, placeholder, initial = '', confirm, focus = false, gate, send, onDone, onCancel }: {
  label: string;
  placeholder?: string;
  initial?: string;
  confirm: string;
  focus?: boolean;
  gate: Gate;
  send: (text: string) => Promise<ApiResult<unknown>>;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const { busy, failure, run } = useAttempt();
  const { length, over, hint, error } = counted(text, MAX_COMMENT_LENGTH);
  const submit = () =>
    run(async () => {
      const sent = await send(text.trim());
      if (!sent.ok) return describeFailure(sent);
      setText('');
      onDone();
      return null;
    });
  return (
    <Stack gap="related">
      <CommentBox
        label={label}
        placeholder={placeholder}
        value={text}
        onChange={setText}
        hint={length ? hint : undefined}
        error={error}
        focus={focus}
        actions={
          <>
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                취소
              </Button>
            )}
            <Button size="sm" busy={busy} disabled={length === 0 || over || text.trim() === initial.trim()} onClick={() => gate(() => void submit())}>
              {confirm}
            </Button>
          </>
        }
      />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Stack>
  );
}

// days: a hold (임시조치) of that many days; blank hides it until the operator shows it again.
function HideDialog({ what, send, onDone, onClose }: { what: string; send: (hidden: { reason: string; days: number | null }) => Promise<ApiResult<undefined>>; onDone: () => void; onClose: () => void }) {
  const [days, setDays] = useState('');
  const held = days.trim() === '' ? null : readCount(days);
  const valid = days.trim() === '' || (held !== null && held <= HOLD_DAYS_MAX);
  return (
    <ReasonDialog
      title={`${what} 가리기`}
      note={`${what}을 쓴 사람에게는 이유와 함께 보여요.`}
      label="가리는 이유"
      confirm={{ label: '가리기', icon: EyeOff }}
      ready={valid}
      also={
        <TextField
          label="기간 (일)"
          value={days}
          onChange={setDays}
          hint={`비워 두면 다시 보이게 할 때까지 가려요. 최대 ${HOLD_DAYS_MAX}일`}
          error={valid ? undefined : `1~${HOLD_DAYS_MAX}일로 입력해 주세요.`}
        />
      }
      send={(reason) => send({ reason, days: held })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

function StatusDialog({ post, onDone, onClose }: { post: Post; onDone: () => void; onClose: () => void }) {
  const [status, setStatus] = useState<Status>(post.status);
  const [version, setVersion] = useState(post.version ?? '');
  const { busy, failure, run } = useAttempt();
  const submit = () =>
    run(async () => {
      const saved = await setPostStatus(post.id, status, status === 'done' && version.trim() ? version.trim() : null);
      if (!saved.ok) return describeFailure(saved);
      onDone();
      return null;
    });
  return (
    <Dialog
      title="상태 바꾸기"
      onClose={onClose}
      onSubmit={() => void submit()}
      actions={
        <Button type="submit" icon={Check} busy={busy}>
          저장
        </Button>
      }
    >
      <ChoiceGroup label="상태" options={STATUSES.map((value) => ({ value, label: BOARD.statuses[value] }))} value={status} onChange={setStatus} layout="list" />
      {status === 'done' && <TextField label="버전" value={version} onChange={setVersion} placeholder="v0.3.5" hint="비워 두면 버전 없이 완료로 표시돼요." />}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
