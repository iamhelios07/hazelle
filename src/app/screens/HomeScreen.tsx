import { Import, Lock, LogOut, Plug } from 'lucide-react';
import { ActionCard, Brand, Callout, IconButton, Intro, Row, Screen, Stack } from '../ui';

type Props = { connectionCount: number; onConnections: () => void; onLock: () => void; onLogout: () => void; message: string | null };

// F1 step 4 (design §2). Import does not exist yet, so its card says so.
export function HomeScreen({ connectionCount, onConnections, onLock, onLogout, message }: Props) {
  return (
    <Screen
      align="center"
      top={
        <>
          <Brand />
          <Row>
            <IconButton icon={Lock} label="잠그기" onClick={onLock} />
            <IconButton icon={LogOut} label="로그아웃" onClick={onLogout} />
          </Row>
        </>
      }
    >
      <Intro title="아직 비어 있어요">봇을 먼저 가져와도, 연결부터 해도 괜찮아요.</Intro>
      <Stack>
        <ActionCard
          tone="accent"
          icon={Import}
          title="봇 가져오기"
          description="PNG · charx · JSON · risum 파일을 끌어다 놓거나 눌러서 고르기"
          pending="준비 중"
        />
        {connectionCount === 0 ? (
          <ActionCard icon={Plug} title="연결 추가" description="쓰는 곳을 고르고 API 키만 넣으면 돼요" onClick={onConnections} />
        ) : (
          <ActionCard icon={Plug} title="연결" description={`연결 ${connectionCount}개 · 모델 별표와 기본 모델, 시험해 보기`} onClick={onConnections} />
        )}
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
