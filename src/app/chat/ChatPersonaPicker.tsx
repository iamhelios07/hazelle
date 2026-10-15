import { UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { aliased, personaFaces, personaTexts } from '../common/alias';
import { useSearch } from '../common/useSearch';
import { usePersonas } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Avatar, Button, CardGrid, Checkbox, ChipButton, Dialog, Empty, FaceCard, hasFinePointer, Hint, Row } from '../ui';
import type { PersonaChoice } from '../../runtime/personas';
import type { ChatSettingsActions } from './useChatSettings';

const MISSING = { chat: '페르소나 삭제됨', character: '고정한 페르소나 삭제됨', current: '현재 페르소나 삭제됨' };

export function ChatPersonaPicker({ persona, open, onOpen }: { persona: PersonaChoice; open: boolean; onOpen: () => void }) {
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  return (
    <ChipButton
      label={shown ? aliased(shown.name, shown.alias) : MISSING[persona.from]}
      title="이 채팅의 페르소나"
      variant="ghost"
      opens="up"
      popup="dialog"
      expanded={open}
      ref={null}
      leading={<Avatar size="sm" tone="you" face={shown?.name ?? UserRound} image={shown?.picture} />}
      tone={shown ? 'default' : 'warn'}
      onClick={onOpen}
    />
  );
}

// Mounted only while open, so each opening starts with an empty search. A touch screen gets no focused search, whose
// keyboard would cover half the faces.
type DialogProps = {
  persona: PersonaChoice;
  characterName: string | null;
  pinned: string | undefined;
  onChoose: ChatSettingsActions['choosePersona'];
  onPin: ChatSettingsActions['pinPersona'];
  onClose: () => void;
};

export function PersonaDialog({ persona, characterName, pinned, onChoose, onPin, onClose }: DialogProps) {
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const search = useSearch(personaFaces(usePersonas()), '페르소나 검색', personaTexts, { ref: field, onEnter: ({ persona }) => choose(persona.id) });
  useEffect(() => {
    if (hasFinePointer()) field.current?.focus();
  }, []);
  const using = persona.kind === 'persona' ? persona.persona.id : null;

  function choose(id: string) {
    onClose();
    void onChoose(id).then((saved) => saved.ok || toast.failed(saved));
  }

  const footer = (
    <>
      {characterName !== null && (
        <Row kind="toolbar">
          <Checkbox
            label={`${characterName}에 고정`}
            checked={using !== null && pinned === using}
            disabled={using === null}
            onChange={(checked) => void onPin(checked ? using : null).then((saved) => saved.ok || toast.failed(saved))}
          />
          <Hint label="고정">이 캐릭터와 새로 시작하는 채팅에 이 페르소나를 사용해요.</Hint>
        </Row>
      )}
      <Button variant="link" onClick={() => navigate(using ? { kind: 'persona', id: using } : { kind: 'personas' })}>
        페르소나 관리
      </Button>
    </>
  );
  return (
    <Dialog title="이 채팅의 페르소나" size="wide" onClose={onClose} toolbar={search.field || undefined} footer={footer}>
      {search.none && <Empty>{search.none}</Empty>}
      <CardGrid label="페르소나" variant="face" current={using ?? undefined} keys={search.found.map(({ persona: { id } }) => id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = search.found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} current={id === using} tag={id === pinned ? '고정' : undefined} onClick={() => choose(id)} />;
        }}
      </CardGrid>
    </Dialog>
  );
}
