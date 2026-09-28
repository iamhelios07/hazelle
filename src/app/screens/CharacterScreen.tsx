import { Copy, MessageSquarePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { unused } from '../../engine/prompt';
import { copyCharacter } from '../../runtime/library';
import { navigate } from '../router';
import { useLibrary, useLoreCount, useStore, useVault } from '../store';
import { useToast } from '../toast';
import { Button, Callout, Intro, NavBar, Portrait, Prose, Row, Screen, Section, Stack, Tag, Text, useWide } from '../ui';
import { describeFailure } from './failure';
import { describeStep } from './saving';
import { editPath, newChatPath, pagePath, shelfPath } from './shelves';
import { describeUnused } from './unused';

// A character's own page beside its chats (design F6), or with id null, 캐릭터 없이.
export function CharacterScreen({ id }: { id: string | null }) {
  const { characters } = useLibrary();
  const lore = useLoreCount(id);
  const store = useStore();
  const vault = useVault();
  const toast = useToast();
  // What 사본 만들기 is doing, while it copies.
  const [copying, setCopying] = useState<string | null>(null);
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

  const { card, origin } = shelf.character;
  const notUsed = describeUnused(unused(card, lore));

  async function copy(from: string) {
    setCopying('사본 만드는 중');
    const copied = await copyCharacter(store, vault, from, `${card.name} (사본)`, (step) => setCopying(describeStep(step)));
    setCopying(null);
    if (!copied.ok) return toast({ message: `사본을 만들지 못했어요. ${describeFailure(copied)}` });
    toast({ message: '사본을 만들었어요. 사본을 고쳐도 원본은 그대로예요.' });
    navigate(editPath(copied.data));
  }

  return (
    <Screen top={wide ? undefined : <NavBar title={card.name} onBack={() => navigate(shelfPath(id))} backLabel="채팅 목록" />}>
      <Stack gap={24}>
        <Portrait image={shelf.face} name={card.name} />
        <Intro title={card.name}>{card.creator ? `만든 사람 ${card.creator}` : undefined}</Intro>
        {origin && (
          <Row>
            <Text tone="muted">‘{origin.name}’에서 만든 사본</Text>
            <Button variant="ghost" size="sm" onClick={() => navigate(pagePath(origin.id, wide))}>
              원본 보기
            </Button>
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
          <Button variant="secondary" icon={Copy} busy={copying !== null} disabled={copying !== null} onClick={() => void copy(shelf.id)}>
            {copying ?? '사본 만들기'}
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
