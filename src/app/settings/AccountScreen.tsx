import { useAccount, useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Button, NavBar, Row, Screen, SettingGroup, SettingRow, Stack, Text } from '../ui';
import { BackupSection } from './BackupSection';

export function AccountScreen({ back }: { back: Back | null }) {
  const { username } = useSession();
  const { onLock, onLogout } = useAccount();
  const toast = useToast();
  return (
    <Screen width="form" top={<NavBar title="계정" {...backBar(back)} />}>
      <Row kind="actions">
        <Avatar face={username} tone="you" />
        <Stack gap="related">
          <Text>{username}</Text>
          <Text size="sm" tone="muted">
            지금 로그인한 계정
          </Text>
        </Stack>
      </Row>
      <SettingGroup label="계정">
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
            <Button variant="secondary" size="sm" onClick={() => void onLogout().then((failure) => failure && toast.show(failure))}>
              로그아웃
            </Button>
          }
        />
      </SettingGroup>
      <BackupSection />
    </Screen>
  );
}
