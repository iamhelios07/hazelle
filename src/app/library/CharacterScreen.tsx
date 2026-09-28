import { Copy, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { unused } from '../../engine/pipeline';
import type { ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { describeUnused } from '../common/unused';
import { useCharacter, useLoreCount } from '../session';
import { navigate } from '../shell/router';
import { characterPage, HOME, type Back } from '../shell/routes';
import { Button, Callout, Intro, NavBar, Portrait, Prose, Row, Screen, Section, Tag, Text, useWide } from '../ui';
import { useCharacterActions } from './useCharacterActions';

// A character's own page beside its chats (design F6), or with shelf null, 캐릭터 없이.
export function CharacterScreen({ shelf, back }: { shelf: CharacterShelf<ChatItem> | null; back: Back | null }) {
  const id = shelf?.id ?? null;
  const original = useCharacter(shelf?.character.origin?.id ?? null);
  const lore = useLoreCount(id);
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
        <Intro title="캐릭터 없이">모델과 바로 이야기하는 채팅이 여기 모여요. 모델은 채팅마다 오른쪽 위에서 바꿀 수 있어요.</Intro>
        {start}
      </Screen>
    );
  }

  const { card, origin } = shelf.character;
  const notUsed = describeUnused(unused(card, lore));
  const originHere = original !== null;
  const copying = busy?.id === shelf.id ? busy.label : null;

  return (
    <Screen top={back && <NavBar title={card.name} onBack={() => navigate(back.to)} backLabel={back.label} />}>
      <Portrait image={shelf.face} name={card.name} />
      <Intro title={card.name}>{card.creator ? `만든 사람 ${card.creator}` : undefined}</Intro>
      {origin && (
        <Row kind="actions">
          <Text tone="muted">
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
        <Button variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => void remove(shelf).then((removed) => removed && navigate(HOME))}>
          지우기
        </Button>
      </Row>
      {card.creatorNotes.trim() && (
        <Section title="만든 사람의 말">
          <Prose text={card.creatorNotes} />
        </Section>
      )}
    </Screen>
  );
}
