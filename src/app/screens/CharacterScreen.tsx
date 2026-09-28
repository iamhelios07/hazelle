import { Copy, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { unused } from '../../engine/prompt';
import { navigate } from '../router';
import { useLibrary, useLoreCount } from '../store';
import { Button, Callout, Intro, NavBar, Portrait, Prose, Row, Screen, Section, Stack, Tag, Text, useWide } from '../ui';
import { useCharacterActions } from './characterActions';
import { editPath, newChatPath, pagePath, shelfPath } from './shelves';
import { describeUnused } from './unused';

// A character's own page beside its chats (design F6), or with id null, 캐릭터 없이.
export function CharacterScreen({ id }: { id: string | null }) {
  const { characters, deleted } = useLibrary();
  const lore = useLoreCount(id);
  const { busy, copy, remove } = useCharacterActions();
  const wide = useWide();
  const start = (
    <Button icon={MessageSquarePlus} onClick={() => navigate(newChatPath(id))}>
      새 채팅
    </Button>
  );

  if (id === null) {
    return (
      <Screen align="center">
        <Intro title="캐릭터 없이">모델과 바로 이야기하는 채팅이 여기 모여요. 모델은 채팅마다 오른쪽 위에서 바꿀 수 있어요.</Intro>
        {start}
      </Screen>
    );
  }

  const shelf = characters.find((candidate) => candidate.id === id);
  if (!shelf) {
    const inBin = deleted.some((candidate) => candidate.id === id);
    return (
      <Screen top={<NavBar title="캐릭터" onBack={() => navigate('/')} backLabel="목록으로" />}>
        <Text tone="muted">{inBin ? '지운 캐릭터예요. 캐릭터 둘러보기의 ‘지운 캐릭터’에서 되살릴 수 있어요.' : '이 캐릭터가 없어요. 지워졌거나 주소가 잘못됐어요.'}</Text>
      </Screen>
    );
  }

  const { card, origin } = shelf.character;
  const notUsed = describeUnused(unused(card, lore));
  const originHere = origin && characters.some((candidate) => candidate.id === origin.id);
  const copying = busy?.id === shelf.id ? busy.label : null;

  return (
    <Screen top={wide ? undefined : <NavBar title={card.name} onBack={() => navigate(shelfPath(id))} backLabel="채팅 목록" />}>
      <Stack gap={24}>
        <Portrait image={shelf.face} name={card.name} />
        <Intro title={card.name}>{card.creator ? `만든 사람 ${card.creator}` : undefined}</Intro>
        {origin && (
          <Row>
            <Text tone="muted">
              ‘{origin.name}’에서 만든 사본{originHere ? '' : ' · 원본은 지워졌어요'}
            </Text>
            {originHere && (
              <Button variant="ghost" size="sm" onClick={() => navigate(pagePath(origin.id, wide))}>
                원본 보기
              </Button>
            )}
          </Row>
        )}
        {card.tags.length > 0 && (
          <Row>
            {card.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Row>
        )}
        {notUsed && <Callout tone="warn">{notUsed}</Callout>}
        <Row>
          {start}
          <Button variant="secondary" icon={Pencil} onClick={() => navigate(editPath(shelf.id))}>
            편집
          </Button>
          <Button variant="secondary" icon={Copy} busy={copying !== null} disabled={busy !== null} onClick={() => void copy(shelf)}>
            {copying ?? '사본 만들기'}
          </Button>
          <Button variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => void remove(shelf).then((removed) => removed && navigate('/'))}>
            지우기
          </Button>
        </Row>
        {card.creatorNotes.trim() && (
          <Section title="만든 사람의 말">
            <Prose text={card.creatorNotes} />
          </Section>
        )}
      </Stack>
    </Screen>
  );
}
