import { logOutOthers } from '../../runtime/account';
import { setPulseSharing, sharesPulse } from '../../runtime/pulse';
import { sizeText } from '../common/size';
import { count } from '../common/typedNumber';
import { useAccount, useSession, useSettings, useStanding, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { AccountSection, Back } from '../shell/routes';
import { useToast } from '../toast';
import { LegalNotice } from '../common/LegalNotice';
import { BUILT_VERSION } from '../common/release';
import { BIN, BOARD, PAGES, PULSE, UNKNOWN } from '../common/words';
import { Avatar, Button, Columns, FaceRow, Gauge, NavBar, Panel, Screen, SettingGroup, SettingRow, Stack, Switch, Text } from '../ui';
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

export function AccountScreen({ section, back }: { section: AccountSection | null; back: Back | null }) {
  const { username } = useSession();
  const { onLock, onLogout } = useAccount();
  const { suspended, storage } = useStanding();
  const toast = useToast();
  const store = useStore();
  const sharing = sharesPulse(useSettings());
  async function logOutElsewhere() {
    const ended = await logOutOthers();
    if (!ended.ok) return toast.failed(ended, '다른 기기에서 로그아웃하지 못했어요.');
    toast.show(ended.data.ended ? `다른 기기 ${count(ended.data.ended)}곳에서 로그아웃했어요.` : '로그인한 다른 기기가 없어요.');
  }
  async function share(on: boolean) {
    const done = await setPulseSharing(store, on);
    if (!done.ok) toast.failed(done, '바꾸지 못했어요.');
  }
  return (
    <Screen width="page" top={<NavBar title={PAGES.account} {...backBar(back)} />}>
      <Stack gap="group">
        <FaceRow face={<Avatar face={username} tone="you" />}>
          <Text>{username}</Text>
          <Text variant="note">
            {suspended ? '로그인한 계정 · 정지됨' : '로그인한 계정'}
          </Text>
        </FaceRow>
        <SettingGroup label="계정">
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
          <SettingRow
            label="다른 기기에서 로그아웃"
            help="지금 쓰는 기기는 로그인한 채로 남아요."
            control={
              <Button variant="secondary" size="sm" onClick={() => void logOutElsewhere()}>
                로그아웃
              </Button>
            }
          />
        </SettingGroup>
      </Stack>
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
          <NoticesSection head seek={section === 'notices'} />
          <Panel title={BOARD.title}>
            <SettingGroup label={BOARD.title}>
              <SettingRow
                label={BOARD.mine}
                control={
                  <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'board-mine' })}>
                    보기
                  </Button>
                }
              />
              <SettingRow
                label={BOARD.toOperator}
                help="운영자만 읽을 수 있는 글로 보내요."
                control={
                  <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'board-write', operator: true })}>
                    쓰기
                  </Button>
                }
              />
            </SettingGroup>
          </Panel>
          <Panel title="앱 정보">
            <SettingGroup label="앱 정보">
              <SettingRow label="버전" control={<Text>{BUILT_VERSION ?? UNKNOWN}</Text>} />
              <SettingRow
                label={PULSE.sharing}
                help="켜 두면 쓰는 모델과 제공자, 응답 수가 집계에 더해져요. 누가 썼는지와 대화 내용은 남지 않아요."
                control={<Switch label={PULSE.sharing} checked={sharing} onChange={(on) => void share(on)} />}
              />
              <Diagnostics />
            </SettingGroup>
            <LegalNotice />
          </Panel>
        </Stack>
        <NewsSection seek={section === 'news'} />
      </Columns>
      <LeaveSection />
    </Screen>
  );
}
