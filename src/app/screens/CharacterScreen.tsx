import { MessageSquarePlus } from 'lucide-react';
import { unused } from '../../engine/prompt';
import { navigate } from '../router';
import { useLibrary, useLoreCount } from '../store';
import { Button, Callout, Intro, NavBar, Portrait, Prose, Row, Screen, Section, Stack, Tag, Text, useWide } from '../ui';
import { newChatPath, shelfPath } from './shelves';
import { describeUnused } from './unused';

// A character's own page beside its chats (design F6), or with id null, 캐릭터 없이.
export function CharacterScreen({ id }: { id: string | null }) {
  const { characters } = useLibrary();
  const lore = useLoreCount(id);
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
    return (
      <Screen top={<NavBar title="캐릭터" onBack={() => navigate('/')} backLabel="목록으로" />}>
        <Text tone="muted">이 캐릭터가 없어요. 지워졌거나 주소가 잘못됐어요.</Text>
      </Screen>
    );
  }

  const { card } = shelf.character;
  const notUsed = describeUnused(unused(card, lore));
  return (
    <Screen top={wide ? undefined : <NavBar title={card.name} onBack={() => navigate(shelfPath(id))} backLabel="채팅 목록" />}>
      <Stack gap={24}>
        <Portrait image={shelf.face} name={card.name} />
        <Intro title={card.name}>{card.creator ? `만든 사람 ${card.creator}` : undefined}</Intro>
        {card.tags.length > 0 && (
          <Row>
            {card.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Row>
        )}
        {notUsed && <Callout tone="warn">{notUsed}</Callout>}
        {start}
        {card.creatorNotes.trim() && (
          <Section title="만든 사람의 말">
            <Prose text={card.creatorNotes} />
          </Section>
        )}
      </Stack>
    </Screen>
  );
}
