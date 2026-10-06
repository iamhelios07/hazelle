import { ImageUp } from 'lucide-react';
import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { Persona } from '../../model/persona';
import { editPersona, removePersona, restorePersona } from '../../runtime/personas';
import { thumbnail } from '../../runtime/picture';
import { useLibrary, useSettings, useStore } from '../session';
import { aliased } from '../common/alias';
import type { Frame } from '../common/frame';
import { filled, typedText } from '../common/typed';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { BIN_KEEPS } from '../common/words';
import { useToast } from '../toast';
import { Avatar, Button, FaceRow, Facts, FileButton, Row, TextField } from '../ui';

type Props = {
  stored: Stored<'persona'>;
  backLabel: string;
  onBack: () => void;
  onRemoved: () => void;
  frame: Frame;
};

// A caller leaves by unmounting it, which saves.
export function PersonaEditor({ stored, backLabel, onBack, onRemoved, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const library = useLibrary();
  const { id } = stored;
  const autosave = useAutosave<Persona>(`persona:${id}`, (patch) => editPersona(store, id, patch));
  const [typedName, setTypedName] = useState<string>();
  const held = { ...stored.value, ...autosave.unsaved };
  const persona = { ...held, name: typedText(typedName, filled, held.name, String) };

  function change(field: 'name' | 'alias' | 'description', value: string) {
    if (field === 'name') setTypedName(value);
    autosave.change({ [field]: value }, field !== 'name' || !!value.trim());
  }

  async function picture(file: File) {
    const made = await thumbnail({ bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }).catch(() => null);
    if (made === null) return toast.error('이 이미지는 열 수 없어요.');
    await autosave.save({ picture: made });
  }

  async function remove() {
    const removed = await autosave.remove(() => removePersona(store, id));
    if (!removed) return;
    if (!removed.ok) {
      if (removed.error === 'current') return toast.error('현재 페르소나는 삭제할 수 없어요.', { detail: '채팅에서 다른 페르소나를 선택한 뒤 삭제해 주세요.' });
      return toast.failed(removed, '삭제하지 못했어요.');
    }
    onRemoved();
    toast.undoable(`${removed.data.value.name} 페르소나를 삭제했어요.`, () => void restorePersona(store, id), BIN_KEEPS);
  }

  const pinnedBy = library.characters.filter(({ character }) => character.persona === id).map(({ character }) => character.card.name);
  const facts = [
    ...(settings.persona === id ? [{ label: '사용처', value: '현재 페르소나' }] : []),
    ...(pinnedBy.length ? [{ label: '고정', value: pinnedBy.join(', ') }] : []),
  ];
  const body = (
    <>
      <FaceRow face={<Avatar face={persona.name} image={persona.picture} size="lg" tone="you" />}>
        <FileButton accept="image/*" size="sm" icon={ImageUp} onFile={(file) => void picture(file)}>
          사진 바꾸기
        </FileButton>
      </FaceRow>
      {facts.length > 0 && <Facts items={facts} />}
      <TextField label="이름" value={persona.name} onChange={(value) => change('name', value)} help="채팅 속 {{user}}가 이 이름으로 바뀌어요." error={persona.name.trim() ? undefined : '이름을 입력해 주세요.'} />
      <TextField label="별명" value={persona.alias ?? ''} onChange={(value) => change('alias', value)} placeholder="예: 부자 스티브" help="나만 보는 이름이에요." />
      <TextField label="설명" lines={8} value={persona.description} onChange={(value) => change('description', value)} />
      <Row kind="actions">
        <Button variant="danger" size="sm" onClick={() => void remove()}>
          이 페르소나 삭제
        </Button>
      </Row>
    </>
  );
  return frame({ head: { title: aliased(persona.name, persona.alias), backLabel, onBack, status: autosave.status ? SAVE_STATUS[autosave.status] : undefined }, body });
}
