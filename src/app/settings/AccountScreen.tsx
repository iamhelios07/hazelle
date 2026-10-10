import { sizeText } from '../common/size';
import { useAccount, useSession, useStanding } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { LegalNotice } from '../common/LegalNotice';
import { PAGES, UNKNOWN } from '../common/words';
import { Avatar, Button, FaceRow, NavBar, Screen, Section, SettingGroup, SettingRow, Text } from '../ui';
import { BackupSection } from './BackupSection';
import { LeaveSection } from './LeaveSection';
import { NoticesSection } from './NoticesSection';
import { ReportSection } from './ReportSection';

// bytes is null while the server could not read it.
const used = (name: string, bytes: number | null, cap: number | null) => `${name} ${bytes === null ? UNKNOWN : sizeText(bytes)}${cap === null ? '' : ` / ${sizeText(cap)}`}`;

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
          {suspended ? '로그인한 계정 · 정지됨' : '로그인한 계정'}
        </Text>
      </FaceRow>
      <SettingGroup label="계정">
        <SettingRow
          label="저장 공간"
          help="이미지는 삭제해도 사용량이 줄지 않아요."
          sub={`${used('텍스트', storage.bytes, storage.bytesCap)} · ${used('이미지', storage.fileBytes, storage.fileBytesCap)}`}
          control={null}
        />
        <SettingRow
          label="잠그기"
          help="다시 열 때 비밀번호가 필요해요."
          control={
            <Button variant="secondary" size="sm" onClick={onLock}>
              잠그기
            </Button>
          }
        />
        <SettingRow
          label="로그아웃"
          help="저장한 내용은 암호화된 채로 서버에 남아요."
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
      <Section title="앱 정보">
        <LegalNotice />
      </Section>
      <LeaveSection />
    </Screen>
  );
}
