import { PenLine } from 'lucide-react';
import { follows } from '../common/words';
import { Button, Menu, Row, Stack, Text, TextField, ToolButton, useMenuClose } from '../ui';
import type { PromptChoice } from '../../runtime/prompts';
import type { ChatSettingsActions } from './useChatSettings';
import { useChatNote } from './useChatNote';

type Props = { id: string | null; note: string | undefined; prompt: PromptChoice; onSave: ChatSettingsActions['setNote'] };

// '' is the chat's own choice of no note, what an emptied box stores; following the prompt's default again (null, which
// runtime/chat-context.ts and runtime/lua/snapshot.ts read apart from '') is a separate choice.
export function ChatNote(props: Props) {
  const { note } = props;
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
          phone="icon"
          detail={note === undefined ? undefined : note ? '이 채팅만의 노트' : '이 채팅은 노트 없음'}
          mark={note === undefined ? undefined : { kind: 'dot' }}
          {...opener}
        />
      )}
    >
      <NoteEditor {...props} />
    </Menu>
  );
}

function NoteEditor({ id, note, prompt, onSave }: Props) {
  const close = useMenuClose();
  const fallback = prompt.kind === 'prompt' ? prompt.prompt.value.authorNote : null;
  const { text, own, status, change, follow } = useChatNote('note', id, note, onSave, '', fallback ?? '');
  const state = own
    ? text
      ? '이 채팅 전용 노트'
      : '노트 없음'
    : fallback === null
      ? '프롬프트가 없어 기본 노트를 알 수 없음'
      : fallback
        ? '기본 노트 사용 중'
        : '프롬프트의 기본 노트: 비어 있음';

  return (
    <Stack gap="related">
      <TextField
        label="작가의 노트"
        lines={5}
        value={text}
        onChange={change}
        placeholder="예: 이번 장면은 짧게 끝내요."
        help="지금 이 채팅에만 적용돼요."
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
