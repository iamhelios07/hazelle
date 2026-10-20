import { Eraser, HardDriveDownload, MonitorSmartphone, Smartphone, Unplug } from 'lucide-react';
import { PRIVACY, TERMS } from './legal';
import { evictsUnlessInstalled } from './platform';
import type { GuestDoors } from '../session';
import { Button, Link, NoticeCard, Text } from '../ui';

// The four limits a guest lives with (design §6.14), said in the user's ruled words; a file backup softens the second.
const POINTS = [
  { icon: Unplug, text: '답을 받는 중에 나가면 끊겨요' },
  { icon: HardDriveDownload, text: '자동 백업이 안 돼요 · 파일로는 저장할 수 있어요' },
  { icon: MonitorSmartphone, text: '다른 기기에서 열 수 없어요' },
  { icon: Eraser, text: '이 브라우저의 데이터를 지우면 사라져요' },
];
const SAFARI = { icon: Smartphone, text: 'Safari는 7일 동안 열지 않으면 데이터를 지워요 · 공유 › 홈 화면에 추가하면 지우지 않아요' };

export function GuestNotice({ guest, onClose }: { guest: GuestDoors; onClose?: () => void }) {
  return (
    <NoticeCard
      title="손님으로 쓰는 중"
      note="만든 내용은 이 브라우저에만 저장돼요."
      points={evictsUnlessInstalled() ? [...POINTS, SAFARI] : POINTS}
      onClose={onClose}
      actions={
        <>
          {guest.signupOpen ? (
            <Button size="sm" onClick={guest.onSignup}>
              계정 만들기
            </Button>
          ) : (
            <Text variant="note">지금은 정원이 차서 계정을 만들 수 없어요</Text>
          )}
          <Button variant="secondary" size="sm" onClick={guest.onSignIn}>
            계정이 있으면 로그인
          </Button>
        </>
      }
      foot={
        <>
          쓰면 <Link href={TERMS.path}>{TERMS.title}</Link>과 <Link href={PRIVACY.path}>{PRIVACY.title}</Link>에 동의하게 돼요.
        </>
      }
    />
  );
}
