import { PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Menu, Row, Stack, Text, TextField, ToolButton, useMenuClose } from '../ui';
import type { OpenChat } from './useChat';

// A saved chat's note is written this long after the last key, and at once when the box closes.
const SAVE_AFTER = 600;

// '' is the chat's own choice of no note; following the prompt's default again is a separate choice, never an
// emptied box.
export function ChatNote({ chat }: { chat: OpenChat }) {
  const { note } = chat;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="작가의 노트"
      trigger={(opener) => (
        <ToolButton
          icon={PenLine}
          label="노트"
          detail={note === undefined ? undefined : note ? '이 채팅만의 노트' : '이 채팅은 노트 없음'}
          mark={note === undefined ? undefined : { kind: 'dot' }}
          {...opener}
        />
      )}
    >
      <NoteEditor chat={chat} />
    </Menu>
  );
}

// Mounted only while the box is open, so it starts from what is saved.
function NoteEditor({ chat }: { chat: OpenChat }) {
  const { id, note, prompt, actions } = chat;
  const close = useMenuClose();
  const fallback = prompt.kind === 'prompt' ? prompt.prompt.value.authorNote : null;
  const [text, setText] = useState(note ?? fallback ?? '');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef('');

  function flush() {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    void actions.setOwn('note', unsaved.current).then(() => setSaving(false));
  }
  const flushLatest = useRef(flush);
  flushLatest.current = flush;
  useEffect(() => () => flushLatest.current(), []);

  function change(value: string) {
    setText(value);
    if (!id) return void actions.setOwn('note', value);
    unsaved.current = value;
    setSaving(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  }

  function follow() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setSaving(false);
    setText(fallback ?? '');
    void actions.setOwn('note', null);
  }

  const own = note !== undefined || saving;
  const status = !own ? '' : !id ? '첫 메시지와 함께 저장돼요' : saving ? '저장 중…' : '저장됨';
  const state = own
    ? text
      ? '이 채팅만의 노트예요'
      : '이 채팅은 노트 없이 보내요'
    : fallback === null
      ? '프롬프트가 없어서 기본 노트를 알 수 없어요'
      : fallback
        ? '프롬프트의 기본 노트를 따르고 있어요'
        : '프롬프트의 기본 노트: 비어 있음';

  return (
    <Stack gap="related">
      <TextField
        label="작가의 노트"
        lines={5}
        value={text}
        onChange={change}
        placeholder="예: 이번 장면은 짧게 끝내요."
        help="이 채팅에만 들어가요. 프롬프트의 ‘작가의 노트’ 자리에 놓여요."
        action={
          <Text size="sm" tone="muted">
            {status}
          </Text>
        }
      />
      <Row kind="spread">
        <Text size="sm" tone="muted">
          {state}
        </Text>
        {text && (
          <Button variant="ghost" size="sm" onClick={() => change('')}>
            비우기
          </Button>
        )}
        {own && (
          <Button variant="ghost" size="sm" onClick={follow}>
            기본 노트 따르기
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={close}>
          닫기
        </Button>
      </Row>
    </Stack>
  );
}
