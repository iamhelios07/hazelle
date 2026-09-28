import { Import, MessageSquarePlus, Plug } from 'lucide-react';
import { navigate } from '../router';
import { useChats, useConnections } from '../store';
import { ActionCard, Intro, Screen, Stack } from '../ui';

// F1's landing, and the page beside the chat list when no chat is open. Import does not exist yet, so
// its card says so. 새 채팅 appears once there is a connection to talk through.
export function Welcome() {
  const connections = useConnections();
  const chats = useChats();
  return (
    <Stack gap={24}>
      {chats.length ? (
        <Intro title="어디서 이어 갈까요?">채팅을 고르거나 새 채팅을 시작해요.</Intro>
      ) : (
        <Intro title="아직 비어 있어요">봇을 먼저 가져와도, 연결부터 해도 괜찮아요.</Intro>
      )}
      <Stack>
        {connections.length > 0 && (
          <ActionCard tone="accent" icon={MessageSquarePlus} title="새 채팅" description="캐릭터 없이 모델과 바로 이야기해요" onClick={() => navigate('/chats/new')} />
        )}
        <ActionCard
          tone={connections.length ? 'default' : 'accent'}
          icon={Import}
          title="봇 가져오기"
          description="PNG · charx · JSON · risum 파일을 끌어다 놓거나 눌러서 고르기"
          pending="준비 중"
        />
        {connections.length === 0 ? (
          <ActionCard icon={Plug} title="연결 추가" description="쓰는 곳을 고르고 API 키만 넣으면 돼요" onClick={() => navigate('/connections/new')} />
        ) : (
          <ActionCard icon={Plug} title="연결" description={`연결 ${connections.length}개 · 모델 별표와 기본 모델`} onClick={() => navigate('/connections')} />
        )}
      </Stack>
    </Stack>
  );
}

export function HomeScreen() {
  return (
    <Screen align="center">
      <Welcome />
    </Screen>
  );
}
