import { GitBranch } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { shown } from '../../model/chat';
import { day } from '../common/time';
import { useChatSummary } from '../session';
import { navigate } from '../shell/router';
import { Divider, Empty, Text } from '../ui';
import { ChatMessage } from './ChatMessage';
import type { OpenChat } from './useChat';

export function ChatLog({ chat }: { chat: OpenChat }) {
  const { item, messages, texts, decor, hosted, offered, translating, awaited, sendLanguage, flipped, opening, last, card, shelf, route, notUsed, busy, editing, pinned, branching, modelMenu, actions } = chat;
  // Rows keep event identities while their handlers read the latest screen state, never a skipped render's closure.
  const latestActions = useRef(actions);
  useLayoutEffect(() => { latestActions.current = actions; });
  const rowActions = useMemo(() => Object.fromEntries(Object.keys(actions).map((key) => [key, (...args: unknown[]) =>
    Reflect.apply(latestActions.current[key as keyof typeof actions], undefined, args),
  ])) as typeof actions, []);
  const originModel = useChatSummary(item?.chat.origin?.id ?? null);
  const origin = item?.chat.origin;
  const character = card && { name: card.nickname || card.name, image: shelf!.face };
  const modelName = 'kind' in route ? null : route.model.name;
  const rows: ReactNode[] = [];
  if (notUsed) {
    rows.push(
      <Text key="unused" tone="muted" align="center">
        {notUsed}
      </Text>,
    );
  }
  if (messages.length === 0) {
    rows.push(
      <Empty key="intro" variant="story">
        {card ? '첫인사가 없는 캐릭터예요. 먼저 말을 걸어 보세요.' : '캐릭터 없이 모델과 바로 이야기하는 채팅이에요. 모델은 오른쪽 위 버튼에서 이 채팅만 바꿀 수 있어요.'}
      </Empty>,
    );
  }
  let lastDay = '';
  messages.forEach((message, index) => {
    const label = day(message.at);
    if (label !== lastDay) {
      rows.push(<Divider key={`day-${message.at}`} label={label} />);
      lastDay = label;
    }
    rows.push(
      <ChatMessage
        key={message.id}
        message={message}
        text={texts[index]!}
        decor={decor}
        hosted={hosted[index]!}
        offered={offered[index]!}
        translating={translating}
        awaited={awaited === shown(message).id}
        sendLanguage={sendLanguage}
        flipped={flipped.has(shown(message).id)}
        isLast={index === messages.length - 1}
        beforeLastReply={message.role === 'user' && index === messages.length - 2 && last?.role === 'assistant'}
        character={character}
        modelName={modelName}
        opening={message === opening}
        busy={busy}
        editing={editing?.id === message.id ? editing : null}
        pinned={pinned === message.id}
        branching={branching}
        modelMenu={modelMenu}
        actions={rowActions}
      />,
    );
    // Deleting the message the split comes after takes its divider with it, until 되돌리기.
    if (origin?.after === message.id) {
      const here = originModel !== null;
      rows.push(
        <Divider
          key="split"
          icon={GitBranch}
          label={here ? `‘${origin.name}’에서 갈라졌어요` : `‘${origin.name}’에서 갈라졌어요 · 원래 채팅은 지워졌어요`}
          action={here ? { label: '원래 채팅 보기', onClick: () => navigate({ kind: 'chat', id: origin.id }) } : undefined}
        />,
      );
    }
  });
  return rows;
}
