import { useState } from 'react';
import type { Assembled, From } from '../../engine/pipeline';
import type { Receipt } from '../../model/chat';
import type { Memory } from '../../model/memory';
import type { Role } from '../../model/prompt';
import type { Sent } from '../../runtime/talk';
import { MESSAGE_ROLES, SLOT_NAMES, textName } from '../common/prompt-words';
import { ChoiceGroup, CodeBlock, Disclosure, Empty, Facts, List, ListItem, Section, Stack, Text } from '../ui';
import { recordScene, recordTitle } from './memory';
import { tokens } from '../common/receipt';
import { loreName } from '../common/words';

type Lore = NonNullable<Assembled['lore']>[number];

export function partName(from: From, role: Role): string {
  switch (from.kind) {
    case 'block':
      return from.name ?? (from.slot ? SLOT_NAMES[from.slot] : textName(role));
    case 'lore':
      return `${SLOT_NAMES[from.slot]} · ${loreName(from.name)}`;
    case 'depth':
      return `${SLOT_NAMES.lorebook} · ${loreName(from.name)} · @@depth ${from.depth}`;
    case 'continue':
      return '이어 쓰기 지시';
    case 'script':
      return '봇의 스크립트';
  }
}

// Headers, which carry the credential, are never kept (runtime/generate), so there is nothing to redact here.
export function SentRequest({ sent, receipt }: { sent: Sent | null; receipt: Receipt }) {
  const [view, setView] = useState<'parts' | 'body'>('parts');
  // Not "gone": a reply written before this page opened, on another device, or edited is not here either.
  if (!sent) {
    return (
      <>
        <Facts
          items={[
            { label: '모델', value: receipt.modelName },
            { label: '연결', value: receipt.source },
            { label: '보낸 토큰', value: tokens(receipt.usage?.inputTokens ?? null) },
          ]}
        />
        <Empty variant="section">이 답장의 요청 원문이 이 페이지에 없어요. 요청 원문은 이 채팅을 벗어나면 사라져요.</Empty>
      </>
    );
  }
  const { request, prompt } = sent;
  const total = prompt.parts.reduce((sum, part) => sum + part.tokens, 0);
  return (
    <>
      <ChoiceGroup
        label="요청 원문 보기"
        layout="segmented"
        options={[
          { value: 'parts', label: '자리별' },
          { value: 'body', label: '본문' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'parts' ? (
        <Section level={3} title="보낸 순서대로" note={`약 ${tokens(total)} 토큰 · 추정`} hint="토큰 수는 o200k 기준으로 센 추정이에요. 모델에 맞춰 바꾼 모양은 ‘본문’에 있어요.">
          <Stack gap="related">
            {prompt.messages.map((message, index) => {
              const part = prompt.parts[index]!;
              return (
                <Disclosure key={index} label={`${partName(part.from, message.role)} · ${MESSAGE_ROLES[message.role]} · 약 ${tokens(part.tokens)} 토큰`}>
                  <CodeBlock>{message.content}</CodeBlock>
                </Disclosure>
              );
            })}
          </Stack>
        </Section>
      ) : request ? (
        <>
          <Section level={3} title="주소">
            <CodeBlock>{request.url}</CodeBlock>
          </Section>
          <Section level={3} title="본문" hint="인증 정보는 헤더에 실려 가서 여기에 담지 않아요.">
            {request.body && <CodeBlock>{JSON.stringify(JSON.parse(request.body), null, 2)}</CodeBlock>}
          </Section>
        </>
      ) : (
        <Empty variant="section">요청을 만들기 전에 멈춰서 보낸 본문이 없어요.</Empty>
      )}
    </>
  );
}

const QUERY = { primary: '키', secondary: '보조 키', additional: '추가 키' } as const;

function why({ why }: Lore, names: Map<string, string>): string {
  switch (why.kind) {
    case 'constant':
      return '항상 켜 둔 항목';
    case 'decorator':
      return why.name === 'activate' ? '@@activate로 켜짐' : '앞선 답장에 들어가서 계속 켜짐 · @@keep_activate_after_match';
    case 'keys':
      return why.matched
        .map(({ query, key, source }) => `${QUERY[query]} ‘${key}’ · ${source.kind === 'message' ? '메시지에서' : `‘${loreName(names.get(source.id)!)}’ 항목에서 (재귀)`}`)
        .join(', ');
  }
}

const DROPPED = { probability: '확률로 빠짐', budget: '예산을 넘어 빠짐', 'no-target': '합칠 항목이 없어 빠짐' } as const;

function fate({ fate }: Lore, names: Map<string, string>): string {
  switch (fate.kind) {
    case 'placed':
      return '들어감';
    case 'merged':
      return `‘${loreName(names.get(fate.into)!)}’에 합쳐 들어감`;
    case 'dropped':
      return DROPPED[fate.cause];
  }
}

// The records are named as they are now; one deleted since reads as gone.
export function SentMemory({ sent, memory, onRecord }: { sent: Sent | null; memory: Memory | null; onRecord: (record: string) => void }) {
  if (!sent) return <Empty variant="section">이 답장의 기억 기록이 이 페이지에 없어요. 기억 기록도 요청 원문처럼 이 채팅을 벗어나면 사라져요.</Empty>;
  const { memory: used, dropped } = sent.prompt;
  const cut = { label: '컨텍스트 한도로 빠진 메시지', value: `${dropped}개`, tone: dropped ? ('warn' as const) : undefined };
  if (!used) {
    return (
      <>
        <Text variant="note">이 답장을 보낼 때 장기 기억이 꺼져 있었어요.</Text>
        <Facts variant="tiles" items={[cut]} />
      </>
    );
  }
  const records = new Map((memory?.records ?? []).map((record) => [record.id, record]));
  return (
    <>
      {!used.slot && <Text variant="note">프롬프트에 장기 기억 자리가 없거나 토글로 빠져서 기억을 보내지 않았어요.</Text>}
      <Facts
        variant="tiles"
        items={[
          { label: '보낸 기록', value: `${used.sent.length}개` },
          { label: '기억이 맡은 메시지', value: `${used.covered}개` },
          { label: '기억 없이 빠진 메시지', value: `${used.missing}개`, tone: used.missing ? 'warn' : undefined },
          cut,
        ]}
      />
      {used.sent.length > 0 && (
        <Section level={3} title="보낸 기록" note={`${used.sent.length}개`} hint="답장이 여기 있는 기록의 일을 잊었다면 모델이 쓰지 않은 거예요. 여기 없는 일은 기억에서 빠진 거예요.">
          <List label="보낸 기록">
            {used.sent.map((id) => {
              const record = records.get(id);
              return record ? (
                <ListItem key={id} title={recordTitle(record)} description={recordScene(record) || undefined} onClick={() => onRecord(id)} />
              ) : (
                <ListItem key={id} title="지금은 없는 기록" />
              );
            })}
          </List>
        </Section>
      )}
    </>
  );
}

export function SentLore({ sent }: { sent: Sent | null }) {
  if (!sent) return <Empty variant="section">이 답장의 로어북 기록이 이 페이지에 없어요. 로어북 기록도 요청 원문처럼 이 채팅을 벗어나면 사라져요.</Empty>;
  const lore = sent.prompt.lore;
  if (!lore) return <Empty variant="section">캐릭터가 없는 채팅이라 로어북이 없어요.</Empty>;
  if (lore.length === 0) return <Empty variant="section">이 답장에는 떠오른 로어북 항목이 없어요.</Empty>;
  const names = new Map(lore.map(({ id, name }) => [id, name]));
  const went = lore.filter((entry) => entry.fate.kind !== 'dropped').length;
  return (
    <Section level={3} title="떠오른 항목" note={`${lore.length}개 중 ${went}개 들어감`}>
      <List label="떠오른 로어북 항목">
        {lore.map((entry) => (
          <ListItem key={entry.id} title={loreName(entry.name)} description={`${why(entry, names)} → ${fate(entry, names)}`} />
        ))}
      </List>
    </Section>
  );
}
