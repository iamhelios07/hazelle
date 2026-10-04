import { Copy, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { storyHtml } from '../../engine/display';
import { unused } from '../../engine/pipeline';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { aliased } from '../common/alias';
import { describeUnused } from '../common/unused';
import { useCharacter } from '../session';
import { backBar, navigate } from '../shell/router';
import { characterPage, HOME, type Back } from '../shell/routes';
import { Button, Callout, Intro, NavBar, Portrait, Row, Screen, Section, Story, Tag, Text, useWide } from '../ui';
import { useCharacterActions } from './useCharacterActions';

// shelf null is 캐릭터 없이.
export function CharacterScreen({ shelf, back }: { shelf: CharacterShelf<ChatSummary> | null; back: Back | null }) {
  const id = shelf?.id ?? null;
  const original = useCharacter(shelf?.character.origin?.id ?? null);
  const { busy, copy, remove } = useCharacterActions();
  const wide = useWide();
  const start = (
    <Button icon={MessageSquarePlus} onClick={() => navigate({ kind: 'new-chat', character: id })}>
      새 채팅
    </Button>
  );

  if (shelf === null) {
    return (
      <Screen align="center">
        <Intro title="캐릭터 없이" />
        {start}
      </Screen>
    );
  }

  const { card, origin, alias } = shelf.character;
  const title = aliased(card.name, alias);
  const notUsed = describeUnused(unused(card));
  const originHere = original !== null;
  const copying = busy?.id === shelf.id ? busy.label : null;

  return (
    <Screen top={back && <NavBar title={title} {...backBar(back)} />}>
      <Portrait image={shelf.face} name={card.name} />
      <Intro title={title}>{card.creator ? `만든 사람 ${card.creator}` : undefined}</Intro>
      {origin && (
        <Row kind="actions">
          <Text variant="note">
            ‘{origin.name}’에서 만든 사본{originHere ? '' : ' · 원본은 지워졌어요'}
          </Text>
          {originHere && (
            <Button variant="ghost" size="sm" onClick={() => navigate(characterPage(origin.id, wide))}>
              원본 보기
            </Button>
          )}
        </Row>
      )}
      {card.tags.length > 0 && (
        <Row kind="tags">
          {card.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Row>
      )}
      {notUsed && <Callout tone="warn">{notUsed}</Callout>}
      <Row kind="actions">
        {start}
        <Button variant="secondary" icon={Pencil} onClick={() => navigate({ kind: 'edit', character: shelf.id })}>
          편집
        </Button>
        <Button variant="secondary" icon={Copy} busy={copying !== null} disabled={busy !== null} onClick={() => void copy(shelf)}>
          {copying ?? '사본 만들기'}
        </Button>
        <Button variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => {
          remove(shelf);
          navigate(HOME);
        }}>
          지우기
        </Button>
      </Row>
      {card.creatorNotes.trim() && (
        <Section title="만든 사람의 말">
          <Story html={storyHtml(card.creatorNotes, true)} />
        </Section>
      )}
    </Screen>
  );
}
