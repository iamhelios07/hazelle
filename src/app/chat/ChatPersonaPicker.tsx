import { UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { aliased, personaFaces, personaTexts } from '../common/alias';
import { useSearch } from '../common/useSearch';
import { usePersonas } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Avatar, Button, CardGrid, Checkbox, ChipButton, Dialog, Empty, FaceCard, hasFinePointer, Hint, Row } from '../ui';
import type { OpenChat } from './useChat';

const MISSING = { chat: '페르소나 삭제됨', character: '고정한 페르소나 삭제됨', current: '현재 페르소나 삭제됨' };

export function ChatPersonaPicker({ chat }: { chat: OpenChat }) {
  const { persona, dialog, actions } = chat;
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  return (
    <ChipButton
      label={shown ? aliased(shown.name, shown.alias) : MISSING[persona.from]}
      title="이 채팅의 페르소나"
      variant="ghost"
      opens="up"
      popup="dialog"
      expanded={dialog === 'persona'}
      ref={null}
      leading={<Avatar size="sm" tone="you" face={shown?.name ?? UserRound} image={shown?.picture} />}
      tone={shown ? 'default' : 'warn'}
      onClick={() => actions.openDialog('persona')}
    />
  );
}

// Mounted only while open, so each opening starts with an empty search. A touch screen gets no focused search, whose
// keyboard would cover half the faces.
export function PersonaDialog({ chat }: { chat: OpenChat }) {
  const { persona, shelf, actions } = chat;
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const search = useSearch(personaFaces(usePersonas()), '페르소나 검색', personaTexts, { ref: field, onEnter: ({ persona }) => choose(persona.id) });
  useEffect(() => {
    if (hasFinePointer()) field.current?.focus();
  }, []);
  const using = persona.kind === 'persona' ? persona.persona.id : null;
  const pinned = shelf?.character.persona;

  function choose(id: string) {
    actions.closeDialog();
    void actions.choosePersona(id).then((saved) => saved.ok || toast.failed(saved));
  }

  const footer = (
    <>
      {shelf && (
        <Row kind="toolbar">
          <Checkbox
            label={`${shelf.character.card.name}에 고정`}
            checked={using !== null && pinned === using}
            disabled={using === null}
            onChange={(checked) => void actions.pinPersona(checked ? using : null).then((saved) => saved.ok || toast.failed(saved))}
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
    <Dialog title="이 채팅의 페르소나" size="wide" onClose={actions.closeDialog} toolbar={search.field || undefined} footer={footer}>
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
