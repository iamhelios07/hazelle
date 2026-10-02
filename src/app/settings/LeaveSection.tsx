import { UserX } from 'lucide-react';
import { useState } from 'react';
import { credentialFor, deleteAccount } from '../../runtime/account';
import type { Method } from '../../vault/keys';
import { describeFailure, wrongSecret } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { useAccount, useSession } from '../session';
import { Button, ConfirmDialog, Section, SettingGroup, SettingRow, Stack, TextField } from '../ui';

// 탈퇴. The server asks the password or the recovery key again, as login does.
export function LeaveSection() {
  const [asking, setAsking] = useState(false);
  return (
    <Section title="탈퇴">
      <SettingGroup label="탈퇴">
        <SettingRow
          label="계정 지우기"
          sub="되돌릴 수 없어요. 먼저 전체 백업을 받아 두세요."
          control={
            <Button variant="danger" size="sm" icon={UserX} onClick={() => setAsking(true)}>
              탈퇴
            </Button>
          }
        />
      </SettingGroup>
      {asking && <LeaveDialog onClose={() => setAsking(false)} />}
    </Section>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { username } = useSession();
  const { onLogout } = useAccount();
  const [method, setMethod] = useState<Method>('password');
  const [secret, setSecret] = useState('');
  const { busy, failure, run, setFailure } = useAttempt();
  const recovery = method === 'recovery';

  const leave = () =>
    run(async () => {
      const credential = await credentialFor(username, method, secret);
      if (!credential) return wrongSecret(method, false);
      const left = await deleteAccount(credential);
      if (!left.ok) return left.error === 'wrong-login' ? wrongSecret(method, false) : describeFailure(left);
      return onLogout();
    });

  return (
    <ConfirmDialog
      title="탈퇴할까요?"
      confirm="탈퇴"
      icon={UserX}
      busy={busy}
      onConfirm={() => void leave()}
      onClose={onClose}
      field={
        <Stack gap="related">
          <TextField
            label={recovery ? '복구 키' : '비밀번호'}
            kind={recovery ? 'code' : 'current-password'}
            value={secret}
            onChange={setSecret}
            placeholder={recovery ? 'XXXX-XXXX-XXXX-…' : undefined}
            error={failure ?? undefined}
          />
          <Button
            variant="link"
            size="xs"
            onClick={() => {
              setMethod(recovery ? 'password' : 'recovery');
              setSecret('');
              setFailure(null);
            }}
          >
            {recovery ? '비밀번호로 확인' : '복구 키로 확인'}
          </Button>
        </Stack>
      }
    >
      이 계정과 캐릭터, 채팅, 프롬프트, 페르소나, 모듈, 그림, 연결과 그 키를 서버에서 지워요. 되돌릴 수 없어요. 운영자에게 보낸 알림과
      운영자가 이 계정에 한 일의 기록은 남아요.
    </ConfirmDialog>
  );
}
