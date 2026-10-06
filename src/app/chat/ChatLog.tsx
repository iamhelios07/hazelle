import { GitBranch } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import { shown } from '../../model/chat';
import { day } from '../common/time';
import { useChatSummary } from '../session';
import { navigate } from '../shell/router';
import { Button, Divider, Empty, Progress, Text, Viewport } from '../ui';
import { ChatMessage } from './ChatMessage';
import { foldTerm } from './search';
import type { OpenChat } from './useChat';

export function ChatLog({ chat }: { chat: OpenChat }) {
  const { item, messages, texts, decor, hosted, offered, translating, awaited, flipped, opening, last, card, shelf, route, notUsed, busy, editing, pinned, found, search, branching, modelMenu, infoDrawer, actions } = chat;
  // Rows keep event identities while their handlers read the latest screen state, never a skipped render's closure.
  const latestActions = useRef(actions);
  useLayoutEffect(() => { latestActions.current = actions; });
  const rowActions = useMemo(() => Object.fromEntries(Object.keys(actions).map((key) => [key, (...args: unknown[]) =>
    Reflect.apply(latestActions.current[key as keyof typeof actions], undefined, args),
  ])) as typeof actions, []);
  const originModel = useChatSummary(item?.chat.origin?.id ?? null);
  const origin = item?.chat.origin;
  const character = card && { name: card.nickname || card.name, image: shelf!.face };
  const me = chat.persona.kind === 'persona' ? { name: chat.persona.persona.value.name, image: chat.persona.persona.value.picture } : null;
  const modelName = 'kind' in route ? null : route.model.name;
  const term = search ? foldTerm(search.term) : '';
  if (chat.displayPending) return chat.displayError === undefined ? <Progress steps={[{ label: '채팅을 불러오는 중' }]} /> : <>
    <Text>채팅을 표시하지 못했어요.</Text>
    <Button variant="secondary" size="sm" onClick={chat.retryDisplay}>다시 시도</Button>
  </>;
  return <>
    {notUsed && <Text variant="note" align="center">{notUsed}</Text>}
    {messages.length === 0 ? <Empty variant="story">
      {card ? '첫인사가 없는 캐릭터예요.' : '캐릭터 없이 모델과 대화하는 채팅이에요.'}
    </Empty> : <Viewport keys={messages.map((message) => message.id)} variant="story" keep={editing ? [editing.id] : []} seek={chat.scroll.seek}
      // Story bodies are shadow roots, whose controls a row's light-DOM query cannot see: Tab stays the browser's.
      traverse={false}>{(index) => {
      const message = messages[index]!;
      const label = day(message.at);
      const divider = index === 0 || day(messages[index - 1]!.at) !== label;
      return <Fragment>
        {divider && <Divider label={label} />}
        <ChatMessage
          key={message.id}
          message={message}
          text={texts[index]!}
          decor={decor}
          hosted={hosted(index)}
          offered={offered(index)}
          translating={translating}
          awaited={awaited === shown(message).id}
          flipped={flipped.has(shown(message).id)}
          isLast={index === messages.length - 1}
          beforeLastReply={message.role === 'user' && index === messages.length - 2 && last?.role === 'assistant'}
          character={character}
          me={me}
          modelName={modelName}
          opening={message === opening}
          busy={busy}
          editing={editing?.id === message.id ? editing : null}
          pinned={pinned === message.id}
          found={found?.ids.has(message.id) ? found.at : 0}
          marked={search?.at === message.id}
          term={term}
          branching={branching}
          modelMenu={modelMenu}
          infoDrawer={infoDrawer}
          actions={rowActions}
        />
        {/* Deleting the message the split comes after takes its divider with it, until 되돌리기. */}
        {origin?.after === message.id && <Divider
          icon={GitBranch}
          label={originModel !== null ? `'${origin.name}'에서 분기됨` : `삭제된 채팅 '${origin.name}'에서 분기됨`}
          action={originModel !== null ? { label: '원래 채팅 보기', onClick: () => navigate({ kind: 'chat', id: origin.id }) } : undefined}
        />}
      </Fragment>;
    }}</Viewport>}
  </>;
}
