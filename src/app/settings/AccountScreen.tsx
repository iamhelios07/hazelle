import { sizeText } from '../common/size';
import { useAccount, useSession, useStanding } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { LegalNotice } from '../common/LegalNotice';
import { PAGES } from '../common/words';
import { Avatar, Button, FaceRow, NavBar, Screen, Section, SettingGroup, SettingRow, Text } from '../ui';
import { BackupSection } from './BackupSection';
import { LeaveSection } from './LeaveSection';
import { NoticesSection } from './NoticesSection';
import { ReportSection } from './ReportSection';

// Used, and the cap when there is one. bytes is null while the server could not read it.
const used = (name: string, bytes: number | null, cap: number | null) => `${name} ${bytes === null ? '알 수 없음' : sizeText(bytes)}${cap === null ? '' : ` / ${sizeText(cap)}`}`;

// section: the one the page was opened at (shell/routes).
export function AccountScreen({ section, back }: { section: 'notices' | null; back: Back | null }) {
  const { username } = useSession();
  const { onLock, onLogout } = useAccount();
  const { suspended, storage } = useStanding();
  const toast = useToast();
  return (
    <Screen width="form" top={<NavBar title={PAGES.account} {...backBar(back)} />}>
      <FaceRow face={<Avatar face={username} tone="you" />}>
        <Text>{username}</Text>
        <Text variant="note">
          {suspended ? '지금 로그인한 계정 · 운영자가 정지함' : '지금 로그인한 계정'}
        </Text>
      </FaceRow>
      <SettingGroup label="계정">
        <SettingRow
          label="저장 공간"
          help="그림은 올린 크기로 세고, 지워도 줄지 않아요."
          sub={`${used('글', storage.bytes, storage.bytesCap)} · ${used('그림', storage.fileBytes, storage.fileBytesCap)}`}
          control={null}
        />
        <SettingRow
          label="잠그기"
          help="금고를 닫아요. 다시 열 때는 비밀번호를 넣어요."
          control={
            <Button variant="secondary" size="sm" onClick={onLock}>
              잠그기
            </Button>
          }
        />
        <SettingRow
          label="로그아웃"
          help="이 기기에서 나가요. 저장한 것은 서버에 잠긴 채로 남아요."
          control={
            <Button variant="secondary" size="sm" onClick={() => void onLogout().then((failure) => failure && toast.error(failure))}>
              로그아웃
            </Button>
          }
        />
      </SettingGroup>
      <BackupSection />
      <NoticesSection seek={section === 'notices'} />
      <ReportSection />
      <Section title="프로그램 정보">
        <LegalNotice />
      </Section>
      <LeaveSection />
    </Screen>
  );
}
