import { Import, Lock, LogOut, Plug } from 'lucide-react';
import { ActionCard, Brand, Callout, IconButton, Intro, Row, Screen, Stack } from '../ui';

type Props = { onLock: () => void; onLogout: () => void; message: string | null };

// F1 step 4 (design §2). Import and connections do not exist yet, so both cards say so.
export function HomeScreen({ onLock, onLogout, message }: Props) {
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
        <ActionCard icon={Plug} title="연결 추가" description="API 키나 주소를 붙여 넣으면 어디인지 알아서 알아봐요" pending="준비 중" />
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
