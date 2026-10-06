import { UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { aliased, aliasNotes, byName } from '../common/alias';
import { matches, noResults } from '../common/search';
import { usePersonas } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Avatar, Button, CardGrid, Checkbox, ChipButton, Dialog, Empty, FaceCard, hasFinePointer, Hint, Row, SearchField } from '../ui';
import type { OpenChat } from './useChat';

const MISSING = { chat: '페르소나 삭제됨', character: '고정한 페르소나 삭제됨', current: '현재 페르소나 삭제됨' };

export function ChatPersonaPicker({ chat }: { chat: OpenChat }) {
  const { persona, dialog, actions } = chat;
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  return (
    <>
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
      {dialog === 'persona' && <PersonaDialog chat={chat} />}
    </>
  );
}

// Mounted only while open, so each opening starts with an empty search. A touch screen gets no focused search, whose
// keyboard would cover half the faces.
function PersonaDialog({ chat }: { chat: OpenChat }) {
  const { persona, shelf, actions } = chat;
  const personas = usePersonas().toSorted((a, b) => byName(a.value, b.value));
  const toast = useToast();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hasFinePointer()) search.current?.focus();
  }, []);
  const using = persona.kind === 'persona' ? persona.persona.id : null;
  const pinned = shelf?.character.persona;
  const notes = aliasNotes(personas.map(({ value }) => value));
  const found = personas.flatMap((each, index) => (matches(query, each.value.name, each.value.alias ?? '') ? [{ persona: each, ...notes[index]! }] : []));

  function choose(id: string) {
    actions.closeDialog();
    void actions.choosePersona(id).then((saved) => saved.ok || toast.failed(saved));
  }

  const toolbar = (
    <SearchField
      ref={search}
      size="sm"
      label="페르소나 검색"
      value={query}
      onChange={setQuery}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !found[0]) return;
        event.preventDefault();
        choose(found[0].persona.id);
      }}
    />
  );
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
      <Button variant="link" size="sm" onClick={() => navigate(using ? { kind: 'persona', id: using } : { kind: 'personas' })}>
        페르소나 관리
      </Button>
    </>
  );
  return (
    <Dialog title="이 채팅의 페르소나" size="wide" onClose={actions.closeDialog} toolbar={toolbar} footer={footer}>
      {found.length === 0 && <Empty>{noResults(query.trim())}</Empty>}
      <CardGrid label="페르소나" variant="face" current={using ?? undefined} keys={found.map(({ persona: { id } }) => id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} current={id === using} tag={id === pinned ? '고정' : undefined} onClick={() => choose(id)} />;
        }}
      </CardGrid>
    </Dialog>
  );
}
