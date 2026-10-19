import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { IllustrateRows } from '../common/IllustrateRows';
import { PerCharacter } from '../common/TaskPrompt';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { ILLUSTRATE_NOTE, ILLUSTRATE_NOTE_UNSENT, scopeTag } from '../common/words';
import { useSession } from '../session';
import { Divider, Menu, Section, Stack, Text, TextField, ToolButton } from '../ui';
import type { IllustrateSetup } from '../../runtime/characters';
import type { PromptDoor } from '../common/TaskPrompt';
import { sendsIllustrateNote, type sceneWriterOf } from '../../runtime/illustrate';
import { illustrationPrompt } from '../../runtime/prompts';
import type { ChatSettingsActions } from './useChatSettings';
import type { IllustrationActions } from './useChatIllustrations';

type Props = {
  id: string | null;
  illustrate: IllustrateSetup;
  note: string | undefined;
  sceneWriter: ReturnType<typeof sceneWriterOf>;
  card: { name: string } | null;
  onChange: IllustrationActions['setIllustrate'];
  onOwnChange: IllustrationActions['setOwnIllustrate'];
  onSaveNote: ChatSettingsActions['setIllustrateNote'];
  onEditPrompt: (door: PromptDoor) => void;
};

export function ChatIllustrate({ id, illustrate, note, sceneWriter, card, onChange, onOwnChange, onSaveNote, onEditPrompt }: Props) {
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="삽화"
      trigger={(opener) => <ToolButton icon={ImageIcon} label="삽화" phone="icon" detail={illustrate.auto ? '자동 삽화 켜짐' : undefined} mark={illustrate.auto || note ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Section level={3} title="삽화" tag={scopeTag(card && illustrate.own ? 'character' : 'default')}>
        <Stack gap="related">
          <IllustrateRows illustrate={illustrate} sceneWriter={sceneWriter} card={card} opens="up" onChange={onChange} onEditPrompt={onEditPrompt}>
            <PerCharacter card={card} own={illustrate.own} onChange={onOwnChange} />
          </IllustrateRows>
          <Divider variant="menu" />
          <NoteEditor id={id} note={note} prompt={illustrate.prompt} onSave={onSaveNote} />
        </Stack>
      </Section>
    </Menu>
  );
}

// Mounted only while the menu is open, so it starts from what is saved. A blank note is stored as none.
function NoteEditor({ id, note, prompt, onSave }: { id: string | null; note: string | undefined; prompt: string | undefined; onSave: Props['onSaveNote'] }) {
  const { store } = useSession();
  const chosen = illustrationPrompt(store, prompt);
  const autosave = useAutosave<{ note: string | null }>(`illustrate-note:${id}`, (patch) => onSave(patch.note ?? null));
  const [text, setText] = useState(('note' in autosave.unsaved ? autosave.unsaved.note : note) ?? '');
  const unsent = text.trim() !== '' && chosen.kind === 'prompt' && !sendsIllustrateNote(chosen.prompt.value);

  function change(value: string) {
    setText(value);
    const stored = value.trim() ? value : null;
    if (!id) return void onSave(stored);
    autosave.change({ note: stored });
  }

  const status = !id ? (text ? '첫 메시지를 보내면 저장돼요' : '') : text || autosave.status === 'failed' ? SAVE_STATUS[autosave.status ?? 'saved'] : '';
  return (
    <TextField
      label={ILLUSTRATE_NOTE}
      lines={4}
      value={text}
      onChange={change}
      placeholder="예: 아리는 지금 잠옷 차림. 배경은 비 오는 밤."
      help="지금 이 채팅의 삽화에만 적용돼요. 누가 무엇을 입었는지, 어떤 분위기로 그릴지 적어요."
      error={unsent ? ILLUSTRATE_NOTE_UNSENT : undefined}
      action={
        <Text variant="note">
          {status}
        </Text>
      }
    />
  );
}
