import { Globe, Lock } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, MAX_POST_LENGTH, MAX_TITLE_LENGTH, type Category, type Post } from '../../contracts/board';
import { editPost, readPost, writePost } from '../../runtime/board';
import { diagnosticReport } from '../../runtime/diagnostics';
import { describeFailure } from '../common/failure';
import { BUILT_VERSION } from '../common/release';
import { useAttempt } from '../common/useAttempt';
import { CATEGORY_LOOK } from '../common/postRow';
import { useLoaded } from '../common/useLoaded';
import { BOARD } from '../common/words';
import { useStanding } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Checkbox, ChoiceGroup, NavBar, Screen, Stack, Tag, Text, TextField } from '../ui';
import { useNicknameGate } from './nickname';
import { counted } from './parts';

const CATEGORY_CARDS = CATEGORIES.map((value) => ({
  value,
  label: BOARD.categories[value],
  sub: CATEGORY_LOOK[value].sub,
  mark: <Tag hue={CATEGORY_LOOK[value].hue} icon={CATEGORY_LOOK[value].icon} />,
}));
type Reach = 'public' | 'operator';
const REACH_CARDS: { value: Reach; label: string; sub: string; mark: ReactNode }[] = [
  { value: 'public', label: '모두에게', sub: '게시판의 누구나 읽고 댓글을 달아요', mark: <Tag icon={Globe} /> },
  { value: 'operator', label: BOARD.operatorOnly, sub: '운영자와 나만 읽어요. 오류 제보에 좋아요', mark: <Tag icon={Lock} /> },
];

// A post read for its edit; only its title, text and category change (runtime/board editPost).
export function EditScreen({ id, back }: { id: number; back: Back }) {
  const loaded = useLoaded(() => readPost(id), [id]);
  if (!loaded.data) return (
    <Screen width="form" top={<NavBar title="글 수정" {...backBar(back)} />}>
      {loaded.loading}
      {loaded.failure}
    </Screen>
  );
  return <WriteScreen key={id} editing={loaded.data.post} operator={false} back={back} />;
}

// operator: 운영자에게만 preset, as 설정 › 계정 and 내 글 open it. A suspended account writes nothing else (design §6.13).
export function WriteScreen({ editing, operator, back }: { editing: Post | null; operator: boolean; back: Back }) {
  const { suspended } = useStanding();
  const { gate, dialog } = useNicknameGate();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [text, setText] = useState(editing?.text ?? '');
  // An error report is what an operator-only post most often is.
  const [category, setCategory] = useState<Category | null>(editing?.category ?? (operator ? 'bug' : null));
  const [toOperator, setToOperator] = useState(operator);
  // On by default: an error report is rarely answerable without it, and it holds no chat text or key.
  const [withDevice, setWithDevice] = useState(true);
  const { busy, failure, run } = useAttempt();
  const titled = counted(title, MAX_TITLE_LENGTH);
  const body = counted(text, MAX_POST_LENGTH);
  const operatorOnly = toOperator || suspended;
  const ready = titled.length > 0 && !titled.over && body.length > 0 && !body.over && category !== null;

  const send = (picked: Category) =>
    run(async () => {
      const fields = { title: title.trim(), text: text.trim(), category: picked };
      if (editing) {
        const saved = await editPost(editing.id, fields);
        if (!saved.ok) return describeFailure(saved);
        navigate({ kind: 'post', id: editing.id }, { replace: true });
        return null;
      }
      const diagnostics = operatorOnly && withDevice ? await diagnosticReport(BUILT_VERSION) : null;
      const written = await writePost({ ...fields, visibility: operatorOnly ? 'operator' : 'public', diagnostics });
      if (!written.ok) return describeFailure(written);
      navigate({ kind: 'post', id: written.data.id }, { replace: true });
      return null;
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || category === null) return;
    const picked = category;
    gate(() => void send(picked));
  }

  return (
    <Screen
      width="form"
      top={<NavBar title={editing ? '글 수정' : BOARD.write} {...backBar(back)} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!ready}>
          {editing ? '저장' : '올리기'}
        </Button>
      }
    >
      <ChoiceGroup label="분류" showLabel options={CATEGORY_CARDS} value={category} onChange={setCategory} layout="cards" />
      <TextField label="제목" value={title} onChange={setTitle} placeholder="한 줄로 요약해 주세요" hint={titled.hint} error={titled.error} />
      <TextField label="내용" lines={12} value={text} onChange={setText} placeholder={category === 'bug' ? '무엇을 했을 때 어떻게 되는지, 순서대로 적어 주세요' : undefined} hint={body.hint} error={body.error} />
      {!editing &&
        (suspended ? (
          <Text variant="note">정지된 계정은 운영자에게만 보낼 수 있어요.</Text>
        ) : (
          <ChoiceGroup label="공개 범위" showLabel options={REACH_CARDS} value={operatorOnly ? 'operator' : 'public'} onChange={(reach) => setToOperator(reach === 'operator')} layout="cards" />
        ))}
      {!editing && operatorOnly && (
        <Stack gap="related">
          <Checkbox label="기기 정보와 최근 오류도 보내기" checked={withDevice} onChange={setWithDevice} />
          <Text variant="note">앱 정보의 문제 진단과 같은 내용이에요. 채팅 내용이나 API 키는 담기지 않아요.</Text>
        </Stack>
      )}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      {dialog}
    </Screen>
  );
}
