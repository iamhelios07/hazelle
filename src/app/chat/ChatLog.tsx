import type { ReactNode } from 'react';
import { render } from '../../engine/render';
import { shown } from '../../model/chat';
import { day } from '../common/time';
import { Divider, Text } from '../ui';
import { ChatMessage } from './ChatMessage';
import type { OpenChat } from './useChat';

export function ChatLog({ chat }: { chat: OpenChat }) {
  const { messages, opening, last, card, shelf, route, scope, notUsed, busy, editing, pinned, actions } = chat;
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
      <Text key="intro" tone="muted" align="center">
        {card ? '첫인사가 없는 캐릭터예요. 먼저 말을 걸어 보세요.' : '캐릭터 없이 모델과 바로 이야기하는 채팅이에요. 모델은 오른쪽 위 버튼에서 이 채팅만 바꿀 수 있어요.'}
      </Text>,
    );
  }
  let lastDay = '';
  messages.forEach((message, index) => {
    const text = render('display', shown(message).text, scope);
    const label = day(message.at);
    if (label !== lastDay) {
      rows.push(<Divider key={`day-${message.at}`} label={label} />);
      lastDay = label;
    }
    rows.push(
      <ChatMessage
        key={message.id}
        message={message}
        text={text}
        isLast={index === messages.length - 1}
        beforeLastReply={message.role === 'user' && index === messages.length - 2 && last?.role === 'assistant'}
        character={card && { name: card.nickname || card.name, image: shelf!.face }}
        modelName={'kind' in route ? null : route.model.name}
        opening={message === opening}
        busy={busy}
        editing={editing?.id === message.id ? editing.text : null}
        pinned={pinned === message.id}
        actions={actions}
      />,
    );
  });
  return rows;
}
