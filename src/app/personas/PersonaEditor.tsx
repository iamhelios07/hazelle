import { ImageUp } from 'lucide-react';
import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { Persona } from '../../model/persona';
import { editPersona, removePersona, restorePersona, setDefaultPersona } from '../../runtime/personas';
import { thumbnail } from '../../runtime/picture';
import { useSettings, useStore } from '../session';
import { aliased } from '../common/alias';
import type { Frame } from '../common/frame';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { useToast } from '../toast';
import { Avatar, Button, FaceRow, FileButton, Row, Text, TextField } from '../ui';

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
  const { id } = stored;
  const [persona, setPersona] = useState(stored.value);
  const { status, save, flush, change: queue } = useAutosave<Persona>((patch) => editPersona(store, id, patch));

  function change(field: 'name' | 'alias' | 'description', value: string) {
    setPersona((current) => ({ ...current, [field]: value }));
    queue({ [field]: value }, field !== 'name' || !!value.trim());
  }

  async function picture(file: File) {
    const made = await thumbnail({ bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }).catch(() => null);
    if (made === null) return toast.error('이 그림은 열 수 없어요.');
    setPersona((current) => ({ ...current, picture: made }));
    await save({ picture: made });
  }

  async function makeDefault() {
    const saved = await setDefaultPersona(store, id);
    if (!saved.ok) toast.failed(saved, '기본으로 정하지 못했어요.');
  }

  async function remove() {
    await flush();
    const removed = await removePersona(store, id);
    if (!removed.ok) {
      if (removed.error === 'default') return toast.error('기본 페르소나는 지울 수 없어요.', { detail: '다른 페르소나를 기본으로 정한 뒤 지워 주세요.' });
      return toast.failed(removed, '지우지 못했어요.');
    }
    onRemoved();
    toast.undoable(`${removed.data.value.name} 페르소나를 지웠어요.`, () => void restorePersona(store, removed.data));
  }

  const isDefault = settings.persona === id;
  const body = (
    <>
      <FaceRow face={<Avatar face={persona.name} image={persona.picture} size="lg" tone="you" />}>
        <FileButton accept="image/*" size="sm" icon={ImageUp} onFile={(file) => void picture(file)}>
          사진 바꾸기
        </FileButton>
        {isDefault ? (
          <Text size="sm" tone="accent">
            새 채팅의 기본 페르소나예요
          </Text>
        ) : (
          <Button variant="link" size="xs" onClick={() => void makeDefault()}>
            새 채팅의 기본으로 정하기
          </Button>
        )}
      </FaceRow>
      <TextField label="이름" value={persona.name} onChange={(value) => change('name', value)} help="채팅 속 {{user}}가 이 이름으로 바뀌어요." error={persona.name.trim() ? undefined : '이름을 적어 주세요.'} />
      <TextField label="별명" value={persona.alias ?? ''} onChange={(value) => change('alias', value)} placeholder="예: 부자 스티브" help="나만 보는 이름이에요. 모델에게는 보내지 않아요." />
      <TextField label="설명" lines={8} value={persona.description} onChange={(value) => change('description', value)} help="프롬프트의 ‘페르소나’ 자리에 이 설명이 들어가요." />
      <Row kind="actions">
        <Button variant="danger" size="sm" onClick={() => void remove()}>
          이 페르소나 지우기
        </Button>
      </Row>
    </>
  );
  return frame({ head: { title: aliased(persona.name, persona.alias), backLabel, onBack, actions: status && <Text tone="muted">{SAVE_STATUS[status]}</Text> }, body });
}
