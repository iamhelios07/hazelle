import { GitBranch } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import { shown } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { ACTS } from '../common/acts';
import { day } from '../common/time';
import { useChatSummary } from '../session';
import { navigate } from '../shell/router';
import { Callout, Divider, Empty, Progress, Text, Viewport } from '../ui';
import { ChatMessage } from './ChatMessage';
import { foldTerm } from './search';
import type { OpenChat } from './useChat';

export function speakers({ card, shelf, persona, route }: OpenChat) {
  return {
    character: card && { name: card.nickname || card.name, image: shelf!.face },
    me: persona.kind === 'persona' ? { name: persona.persona.value.name, image: persona.persona.value.picture } : null,
    modelName: 'kind' in route ? null : route.model.name,
  };
}

const NO_PICTURES: Stored<'illustration'>[] = [];
const NO_BADGES: string[] = [];

export function ChatLog({ chat }: { chat: OpenChat }) {
  const { item, messages, texts, placed, pictures, remarks, fresh, badges, messageTools, illustrating, decor, hosted, offered, translating, awaited, flipped, opening, card, notUsed, personaNote, busy, editing, pinned, bookmarked, found, search, branching, modelMenu, actions } = chat;
  // Rows keep event identities while their handlers read the latest screen state, never a skipped render's closure.
  const latestActions = useRef(actions);
  useLayoutEffect(() => { latestActions.current = actions; });
  const rowActions = useMemo(() => Object.fromEntries(Object.keys(actions).map((key) => [key, (...args: unknown[]) =>
    Reflect.apply(latestActions.current[key as keyof typeof actions], undefined, args),
  ])) as typeof actions, []);
  const originChat = useChatSummary(item?.chat.origin?.id ?? null);
  const origin = item?.chat.origin;
  const { character, me, modelName } = speakers(chat);
  const term = search ? foldTerm(search.term) : '';
  if (chat.displayPending) return chat.displayError === undefined ? <Progress steps={[{ label: '채팅을 불러오는 중' }]} /> : (
    <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: chat.retryDisplay }}>채팅을 화면에 표시하지 못했어요.</Callout>
  );
  return <>
    {notUsed && <Text variant="note" align="center">{notUsed}</Text>}
    {personaNote && <Text variant="note" align="center">{personaNote}</Text>}
    {messages.length === 0 ? <Empty variant="story">
      {card ? '첫인사가 없는 캐릭터예요.' : '캐릭터 없이 모델과 바로 대화하는 채팅이에요.'}
    </Empty> : <Viewport keys={messages.map((message) => message.id)} variant="story" keep={editing ? [editing.id] : []} seek={chat.scroll.seek}
      // Story bodies are shadow roots, whose controls a row's light-DOM query cannot see: Tab stays the browser's.
      traverse={false}>{(index) => {
      const message = messages[index]!;
      const label = day(message.at);
      const version = shown(message).id;
      const drawing = illustrating.get(message.id);
      const remark = (chat.features.mascot && remarks.get(version)) || null;
      const divider = index === 0 || day(messages[index - 1]!.at) !== label;
      return <Fragment>
        {divider && <Divider label={label} />}
        <ChatMessage
          key={message.id}
          message={message}
          text={texts[index]!}
          placed={placed.get(index) ?? null}
          pictures={pictures.get(version) ?? NO_PICTURES}
          drawing={drawing?.version === version ? drawing : null}
          remark={remark}
          fresh={remark !== null && fresh(remark)}
          badges={badges.get(version) ?? NO_BADGES}
          toolActions={messageTools}
          decor={decor}
          hosted={hosted(index)}
          offered={offered(index)}
          translating={translating}
          canTranslate={chat.features.translate}
          canIllustrate={chat.features.illustrate}
          awaited={awaited(version)}
          flipped={flipped.has(version)}
          showOriginal={chat.translate.original}
          replyNext={message.role === 'user' && messages[index + 1]?.role === 'assistant'}
          character={character}
          me={me}
          modelName={modelName}
          opening={message === opening}
          last={index === messages.length - 1}
          busy={busy}
          editing={editing?.id === message.id ? editing : null}
          pinned={pinned === message.id}
          bookmarked={bookmarked.has(message.id)}
          found={found?.ids.has(message.id) ? found.at : 0}
          marked={search?.at === message.id}
          term={term}
          branching={branching}
          modelMenu={modelMenu}
          actions={rowActions}
        />
        {/* Deleting the message the split comes after takes its divider with it, until 되돌리기. */}
        {origin?.after === message.id && <Divider
          icon={GitBranch}
          label={originChat !== null ? `'${origin.name}'에서 분기됨` : `삭제된 채팅 '${origin.name}'에서 분기됨`}
          action={originChat !== null ? { label: '원래 채팅 보기', onClick: () => navigate({ kind: 'chat', id: origin.id }) } : undefined}
        />}
      </Fragment>;
    }}</Viewport>}
  </>;
}
