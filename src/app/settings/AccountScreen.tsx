import { sizeText } from '../common/size';
import { useAccount, useSession, useStanding } from '../session';
import { backBar, navigate } from '../shell/router';
import type { AccountSection, Back } from '../shell/routes';
import { useToast } from '../toast';
import { LegalNotice } from '../common/LegalNotice';
import { BUILT_VERSION } from '../common/release';
import { BIN, PAGES, UNKNOWN } from '../common/words';
import { Avatar, Button, Columns, FaceRow, Gauge, NavBar, Panel, Screen, SettingRow, Stack, Text } from '../ui';
import { BackupSection } from './BackupSection';
import { Diagnostics } from './Diagnostics';
import { LeaveSection } from './LeaveSection';
import { NewsSection } from './NewsSection';
import { NoticesSection } from './NoticesSection';
import { SharedLinksSection } from './SharedLinksSection';

// bytes is null while the server could not read it; a meter only where both it and the cap are known.
function Used({ label, bytes, cap }: { label: string; bytes: number | null; cap: number | null }) {
  const share = bytes !== null && cap ? bytes / cap : undefined;
  return <Gauge label={label} share={share} amount={bytes === null ? UNKNOWN : sizeText(bytes)} of={cap === null ? undefined : `/ ${sizeText(cap)}`} />;
}

// section: the one the page was opened at (shell/routes).
export function AccountScreen({ section, back }: { section: AccountSection | null; back: Back | null }) {
  const { username } = useSession();
  const { onLock, onLogout } = useAccount();
  const { suspended, storage } = useStanding();
  const toast = useToast();
  return (
    <Screen width="page" top={<NavBar title={PAGES.account} {...backBar(back)} />}>
      <Panel>
        <FaceRow face={<Avatar face={username} tone="you" />}>
          <Text>{username}</Text>
          <Text variant="note">
            {suspended ? '로그인한 계정 · 정지됨' : '로그인한 계정'}
          </Text>
        </FaceRow>
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
      </Panel>
      {/* The account's own data first, then help and the app, then 탈퇴 last. */}
      <Columns min="panel">
        <Stack gap="section">
          <Panel title="저장 공간" help={`${BIN}에서 영구 삭제하면 공간이 생겨요.`}>
            <Used label="텍스트" bytes={storage.bytes} cap={storage.bytesCap} />
            <Used label="이미지" bytes={storage.fileBytes} cap={storage.fileBytesCap} />
            <SettingRow
              label={PAGES.usage}
              control={
                <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'usage' })}>
                  보기
                </Button>
              }
            />
          </Panel>
          <SharedLinksSection />
        </Stack>
        <BackupSection />
      </Columns>
      <Columns min="panel">
        <Stack gap="section">
          <NoticesSection seek={section === 'notices'} />
          <Panel title="앱 정보">
            <SettingRow label="버전" control={<Text>{BUILT_VERSION ?? UNKNOWN}</Text>} />
            <Diagnostics />
            <LegalNotice />
          </Panel>
        </Stack>
        <NewsSection seek={section === 'news'} />
      </Columns>
      <LeaveSection />
    </Screen>
  );
}
