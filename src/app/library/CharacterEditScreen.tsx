import { useState } from 'react';
import type { Card } from '../../engine/import/types';
import { editCard } from '../../runtime/characters';
import { EntryList } from '../common/EntryList';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen, Section, Text, TextField } from '../ui';

// 캐릭터 편집: the card's text. Only the fields changed here go to editCard.
export function CharacterEditScreen({ id, initial, back }: { id: string; initial: Card; back: Back }) {
  const store = useStore();
  const [card, setCard] = useState(initial);
  const { status, change: queue } = useAutosave<Card>((patch) => editCard(store, id, patch));

  function change<K extends keyof Card>(field: K, value: Card[K]) {
    setCard((current) => ({ ...current, [field]: value }));
    queue(field, value, field !== 'name' || !!(value as string).trim());
  }

  return (
    <Screen top={<NavBar title="캐릭터 편집" subtitle={card.name} {...backBar(back)} actions={status && <Text tone="muted">{SAVE_STATUS[status]}</Text>} />}>
      <Text tone="muted">로어북과 정규식은 아직 여기서 고칠 수 없어요.</Text>
      <Section title="기본">
        <TextField label="이름" value={card.name} onChange={(value) => change('name', value)} error={card.name.trim() ? undefined : '이름을 적어 주세요.'} />
        <TextField
          label="부르는 이름"
          value={card.nickname ?? ''}
          onChange={(value) => change('nickname', value === '' ? null : value)}
          help="채팅에서 {{char}} 자리에 이름 대신 들어가요. 비우면 이름을 써요."
        />
      </Section>
      <Section title="캐릭터">
        <TextField label="설명" lines={10} value={card.description} onChange={(value) => change('description', value)} />
        <TextField label="성격" lines={4} value={card.personality} onChange={(value) => change('personality', value)} />
        <TextField label="상황" lines={4} value={card.scenario} onChange={(value) => change('scenario', value)} />
        <TextField label="예시 대화" lines={6} value={card.exampleDialogue} onChange={(value) => change('exampleDialogue', value)} />
      </Section>
      <Section title="첫인사" hint="새 채팅을 열면 이 중에서 고를 수 있어요. 이미 시작한 채팅의 첫인사는 바뀌지 않아요.">
        <EntryList
          entries={card.greetings}
          onChange={(greetings) => change('greetings', greetings)}
          name={(index) => `첫인사 ${index + 1}`}
          blank=""
          addLabel="첫인사 추가"
          removed={(index) => `${index + 1}번째 첫인사를 지웠어요.`}
        >
          {({ value, name, set, remove }) => <TextField label={name} lines={6} value={value} onChange={set} action={remove} />}
        </EntryList>
      </Section>
      <Section title="지시문">
        <TextField
          label="시스템 프롬프트"
          lines={6}
          value={card.systemPrompt}
          onChange={(value) => change('systemPrompt', value)}
          help="비우면 기본 지시문을 써요. {{original}}을 넣으면 그 자리에 기본 지시문이 들어가요."
        />
        <TextField
          label="대화 뒤 지시문"
          lines={4}
          value={card.postHistoryInstructions}
          onChange={(value) => change('postHistoryInstructions', value)}
          help="대화 기록 바로 뒤에 붙어요."
        />
      </Section>
    </Screen>
  );
}
