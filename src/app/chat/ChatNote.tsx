import { PenLine } from 'lucide-react';
import { useState } from 'react';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { follows } from '../common/words';
import { Button, Menu, Row, Stack, Text, TextField, ToolButton, useMenuClose } from '../ui';
import type { OpenChat } from './useChat';

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
  // An unsaved chat holds the note itself until its first send, so only a saved one goes through autosave.
  const autosave = useAutosave<{ note: string | null }>(`note:${id}`, (patch) => actions.setOwn('note', patch.note as string | null));
  // A save still on its way from the box opened before is newer than what is stored.
  const [text, setText] = useState(('note' in autosave.unsaved ? autosave.unsaved.note : note) ?? fallback ?? '');

  function change(value: string) {
    setText(value);
    if (!id) return void actions.setOwn('note', value);
    autosave.change({ note: value });
  }

  function follow() {
    setText(fallback ?? '');
    if (!id) return void actions.setOwn('note', null);
    void autosave.save({ note: null });
  }

  const own = 'note' in autosave.unsaved ? autosave.unsaved.note !== null : note !== undefined;
  const status = !id ? (own ? '첫 메시지와 함께 저장돼요' : '') : own || autosave.status === 'failed' ? SAVE_STATUS[autosave.status ?? 'saved'] : '';
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
          <Text variant="note">
            {status}
          </Text>
        }
      />
      <Row kind="spread">
        <Text variant="note">
          {state}
        </Text>
        {text && (
          <Button variant="ghost" size="sm" onClick={() => change('')}>
            비우기
          </Button>
        )}
        {own && (
          <Button variant="ghost" size="sm" onClick={follow}>
            {follows('기본 노트')}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={close}>
          닫기
        </Button>
      </Row>
    </Stack>
  );
}
