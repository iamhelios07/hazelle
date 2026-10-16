import { useState } from 'react';
import type { Card } from '../../engine/import/types';
import type { Assembled, From, Problem } from '../../engine/pipeline';
import type { Receipt } from '../../model/chat';
import { isChapter } from '../../engine/memory';
import type { Chapter, Memory, MemoryRecord } from '../../model/memory';
import type { Role } from '../../model/prompt';
import type { HttpRequest } from '../../connectors/types';
import type { Sent } from '../../runtime/talk';
import { MESSAGE_ROLES, SLOT, textName } from '../common/prompt-words';
import { Button, Callout, ChoiceGroup, CodeBlock, Disclosure, Empty, Facts, List, ListItem, Row, Section, Stack, Text } from '../ui';
import { loreBudgetEditor, type Side } from './panels';
import { budgetCut } from './infoReply';
import { navigate } from '../shell/router';
import { recordScene, recordTitle } from './memory';
import { tokens } from '../common/receipt';
import { CHAPTER, COMMAND, inSettings, LORE_BUDGET_LABEL, loreName, opens } from '../common/words';

type Lore = NonNullable<Assembled['lore']>[number];

// Not "none" or "gone": what a call sent is kept only by the page that made it, while its chat stays open (runtime/talk
// sent), so a reload, another device or a resumed call has none of it to show.
const UNKEPT = '요청을 보낸 기기에서 채팅 화면을 열어 둔 동안에만 볼 수 있어요.';

export function partName(from: From, role: Role): string {
  switch (from.kind) {
    case 'block':
      return from.name ?? (from.slot ? SLOT[from.slot].name : textName(role));
    case 'lore':
      return `${SLOT[from.slot].name} · ${loreName(from.name)}`;
    case 'depth':
      return `${SLOT.lorebook.name} · ${loreName(from.name)} · @@depth ${from.depth}`;
    case 'continue':
      return '이어 쓰기 지시';
    case 'retrieval':
      return `${SLOT.memory.name} · 찾은 기록`;
    case 'tool':
      return `${SLOT.tool.name} · ${from.name}`;
    case 'script':
      return '봇의 스크립트';
  }
}

// Headers, which carry the credential, are never kept (runtime/generate), so there is nothing to redact here.
export function SentRequest({ sent, receipt }: { sent: Sent | null; receipt: Receipt }) {
  if (!sent) {
    return (
      <>
        <Facts
          variant="tiles"
          items={[
            { label: '모델', value: receipt.modelName },
            { label: '연결', value: receipt.source },
            { label: '보낸 토큰', value: tokens(receipt.usage?.inputTokens ?? null) },
          ]}
        />
        <Empty variant="section">{UNKEPT}</Empty>
      </>
    );
  }
  return <RequestView prompt={sent.prompt} title="보낸 순서대로" request={() => sent.request} unbuilt="요청을 보내기 전에 멈춰서 본문이 없어요." />;
}

export function SentResponse({ sent }: { sent: Sent | null }) {
  if (!sent) return <Empty variant="section">{UNKEPT}</Empty>;
  if (!sent.response) return <Empty variant="section">이 응답의 응답 원문이 없어요.</Empty>;
  return <CodeBlock>{sent.response}</CodeBlock>;
}

type RequestViewProps = {
  prompt: Pick<Assembled, 'messages' | 'parts' | 'problems'>;
  title: string;
  // Read only while 본문 shows: the wire body of a request not sent yet is built on demand.
  request: () => Pick<HttpRequest, 'url' | 'body'> | null;
  unbuilt: string;
  editor?: (from: From) => Side | null;
  onEdit?: (side: Side) => void;
};

const PROBLEM = { 'unknown-tag': `모르는 ${COMMAND}`, 'error-text': '오류 문구' } as const;

const problemCounts = (problems: Problem[]) =>
  (['unknown-tag', 'error-text'] as const).flatMap((kind) => {
    const count = problems.filter((problem) => problem.kind === kind).length;
    return count ? [`${PROBLEM[kind]} ${count}개`] : [];
  }).join(' · ');

const problemPlace = ({ from }: Problem) => (from.kind === 'block' ? (from.name ?? (from.slot ? SLOT[from.slot].name : '이름 없는 블록')) : loreName(from.name));

// placed: whether the problems sit under their part, which names their place already.
function ProblemList({ problems, placed }: { problems: Problem[]; placed: boolean }) {
  return (
    <List label="문제">
      {problems.map((problem, index) => (
        <ListItem key={index} title={PROBLEM[problem.kind]} code={problem.text} aside={placed ? undefined : problemPlace(problem)} />
      ))}
    </List>
  );
}

export function RequestView({ prompt, title, request, unbuilt, editor, onEdit }: RequestViewProps) {
  const [view, setView] = useState<'parts' | 'body'>('parts');
  const total = prompt.parts.reduce((sum, part) => sum + part.tokens, 0);
  const { found, omitted } = prompt.problems;
  // A problem shows at the first part built from its text; a text that rendered to nothing has none.
  const owners = found.map((problem) => prompt.parts.findIndex(({ from }) => from.kind === problem.from.kind && 'id' in from && from.id === problem.from.id));
  const at = (index: number) => found.filter((_, problem) => owners[problem] === index);
  const unplaced = at(-1);
  return (
    <>
      <ChoiceGroup
        label="요청 원문 보기"
        layout="segmented"
        options={[
          { value: 'parts', label: '블록별' },
          { value: 'body', label: '본문' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'parts' ? (
        <Section level={3} title={title} note={`약 ${tokens(total)} 토큰 · 앱 추정`}>
          <Stack gap="related">
            {found.length > 0 && (
              <Callout tone="warn">{`문제 ${found.length + omitted}개 · 모르는 ${COMMAND}나 오류 문구가 모델에 그대로 가요.${omitted ? ` ${omitted}개는 목록에서 뺐어요.` : ''}`}</Callout>
            )}
            {prompt.messages.map((message, index) => {
              const part = prompt.parts[index]!;
              const side = editor?.(part.from);
              const problems = at(index);
              return (
                <Disclosure key={index} label={`${partName(part.from, message.role)} · ${MESSAGE_ROLES[message.role]} · 약 ${tokens(part.tokens)} 토큰${problems.length ? ` · ${problemCounts(problems)}` : ''}`}>
                  <Stack gap="related">
                    {problems.length > 0 && <ProblemList problems={problems} placed />}
                    <CodeBlock>{message.content}</CodeBlock>
                    {side && onEdit && (
                      <Row kind="actions">
                        <Button variant="link" size="sm" onClick={() => onEdit(side)}>
                          편집
                        </Button>
                      </Row>
                    )}
                  </Stack>
                </Disclosure>
              );
            })}
            {unplaced.length > 0 && (
              <Disclosure label={`그 밖에 · ${problemCounts(unplaced)}`}>
                <Stack gap="related">
                  <Text variant="note">요청에 그대로 들어가지 않은 블록이나 로어북 항목이에요.</Text>
                  <ProblemList problems={unplaced} placed={false} />
                </Stack>
              </Disclosure>
            )}
          </Stack>
        </Section>
      ) : (
        <RequestBody request={request()} unbuilt={unbuilt} />
      )}
    </>
  );
}

function RequestBody({ request, unbuilt }: { request: Pick<HttpRequest, 'url' | 'body'> | null; unbuilt: string }) {
  if (!request) return <Empty variant="section">{unbuilt}</Empty>;
  return (
    <>
      <Section level={3} title="주소">
        <CodeBlock>{request.url}</CodeBlock>
      </Section>
      <Section level={3} title="본문">
        {request.body && <CodeBlock>{JSON.stringify(JSON.parse(request.body), null, 2)}</CodeBlock>}
      </Section>
    </>
  );
}

const QUERY = { primary: '키워드', secondary: '보조 키워드', additional: '추가 키워드' } as const;

function why({ why }: Lore, names: Map<string, string>): string {
  switch (why.kind) {
    case 'constant':
      return '항상 켜 둔 항목';
    case 'decorator':
      return why.name === 'activate' ? '@@activate로 켜짐' : '이전 응답에서 활성화돼 유지됨 (@@keep_activate_after_match)';
    case 'keys':
      return why.matched
        .map(({ query, key, source }) => `${QUERY[query]} '${key}' · ${source.kind === 'message' ? '메시지에서' : `'${loreName(names.get(source.id)!)}' 항목에서 (재귀)`}`)
        .join(', ');
  }
}

const DROPPED = { probability: '확률로 빠짐', budget: `${LORE_BUDGET_LABEL}을 넘어 빠짐`, 'no-target': '합칠 항목이 없어 빠짐' } as const;

function fate({ fate }: Lore, names: Map<string, string>): string {
  switch (fate.kind) {
    case 'placed':
      return '들어감';
    case 'merged':
      return `'${loreName(names.get(fate.into)!)}'에 합쳐 들어감`;
    case 'dropped':
      return fate.cause === 'no-block' ? `프롬프트에 @@inject_at ${fate.target} 자리가 없어 빠짐` : DROPPED[fate.cause];
  }
}

// The records are named as they are now; one deleted since reads as gone.
export function SentMemory({ sent, memory, onRecord }: { sent: Sent | null; memory: Memory | null; onRecord: (record: string) => void }) {
  if (!sent) return <Empty variant="section">{UNKEPT}</Empty>;
  const { memory: used, dropped } = sent.prompt;
  const cut = { label: '컨텍스트 한도로 빠진 메시지', value: `${dropped}개`, tone: dropped ? ('warn' as const) : undefined };
  if (!used) {
    return (
      <>
        <Text variant="note">이 응답을 요청할 때는 장기 기억이 꺼져 있었어요.</Text>
        <Facts variant="tiles" items={[cut]} />
      </>
    );
  }
  const unsent = !used.slot && <Text variant="note">프롬프트에 장기 기억 블록이 없거나 꺼져 있어서 기억을 보내지 않았어요.</Text>;
  if (used.by !== null) {
    return (
      <>
        {unsent}
        <Facts variant="tiles" items={[{ label: '기억을 맡은 도구', value: used.by }, { label: '기억에 담긴 메시지', value: `${used.covered}개` }, cut]} />
        {used.slot && used.text.trim() && (
          <Section level={3} title="보낸 기억">
            <CodeBlock variant="prose">{used.text}</CodeBlock>
          </Section>
        )}
      </>
    );
  }
  const records = new Map([...(memory?.records ?? []), ...(memory?.chapters ?? [])].map((record) => [record.id, record]));
  return (
    <>
      {unsent}
      <Facts
        variant="tiles"
        items={[
          { label: '보낸 기록', value: `${used.sent.length}개` },
          { label: '찾아 넣은 기록', value: `${used.found.length}개` },
          { label: '기억에 담긴 메시지', value: `${used.covered}개` },
          { label: '기억에 없는 메시지', value: `${used.missing}개`, tone: used.missing ? 'warn' : undefined },
          cut,
        ]}
      />
      {used.sent.length > 0 && <SentRecords title="보낸 기록" ids={used.sent} records={records} onRecord={onRecord} />}
      {used.found.length > 0 && <SentRecords title="찾아 넣은 기록" ids={used.found} records={records} onRecord={onRecord} />}
    </>
  );
}

function SentRecords({ title, ids, records, onRecord }: { title: string; ids: string[]; records: ReadonlyMap<string, MemoryRecord | Chapter>; onRecord: (record: string) => void }) {
  return (
    <Section level={3} title={title} note={`${ids.length}개`}>
      <List label={title}>
        {ids.map((id) => {
          const record = records.get(id);
          return record ? (
            <ListItem key={id} title={recordTitle(record)} description={recordScene(record) || undefined} tags={isChapter(record) ? [CHAPTER] : undefined} onClick={() => onRecord(id)} />
          ) : (
            <ListItem key={id} title="지금은 없는 기록" />
          );
        })}
      </List>
    </Section>
  );
}

export function SentLore({ sent, character, onEdit }: { sent: Sent | null; character: { id: string; card: Card } | null; onEdit: (side: Side) => void }) {
  if (!sent) return <Empty variant="section">{UNKEPT}</Empty>;
  const lore = sent.prompt.lore;
  if (!lore) return <Empty variant="section">캐릭터 없이 대화하는 채팅이라 로어북이 없어요.</Empty>;
  if (lore.length === 0) return <Empty variant="section">이 응답에서 켜진 로어북 항목이 없어요.</Empty>;
  const names = new Map(lore.map(({ id, name }) => [id, name]));
  const went = lore.filter((entry) => entry.fate.kind !== 'dropped').length;
  const cut = budgetCut(lore);
  const editor = loreBudgetEditor(character);
  const door = editor ? { label: opens('캐릭터 편집 › 로어북'), onClick: () => onEdit(editor) } : { label: opens(inSettings('chat')), onClick: () => navigate({ kind: 'chat-settings' }) };
  return (
    <>
      {cut > 0 && <Callout tone="warn" action={door}>{`${LORE_BUDGET_LABEL}(${sent.prompt.loreBudget.toLocaleString()} 토큰)을 넘어 ${cut}개가 빠졌어요.`}</Callout>}
      <Section level={3} title="활성화된 항목" note={`${lore.length}개 중 ${went}개 들어감`}>
        <List label="활성화된 로어북 항목">
          {lore.map((entry) => (
            <ListItem key={entry.id} title={loreName(entry.name)} description={`${why(entry, names)} → ${fate(entry, names)}`} />
          ))}
        </List>
      </Section>
    </>
  );
}
