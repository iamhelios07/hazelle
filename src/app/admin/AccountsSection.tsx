import { Ban, HardDrive, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiResult } from '../../runtime/api';
import { readAccounts, removeAccount, setSuspended, type AdminAccount, type OwnCap } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { monthDay } from '../common/time';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Callout, ConfirmDialog, IconButton, List, ListItem, Menu, MenuItem, Section } from '../ui';
import { CapsDialog } from './CapsDialog';
import { useLoaded } from './useLoaded';

// What it holds, and its own cap when it has one.
const held = (name: string, bytes: number, cap: OwnCap) => `${name} ${sizeText(bytes)}${cap === 'default' ? '' : ` / ${cap === null ? '한도 없음' : sizeText(cap)}`}`;

export function AccountsSection({ onActed }: { onActed: () => void }) {
  const { username: own } = useSession();
  const toast = useToast();
  const { data: accounts, failure, reload } = useLoaded(readAccounts);
  const [removing, setRemoving] = useState<AdminAccount | null>(null);
  const [capping, setCapping] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(done: Promise<ApiResult<undefined>>, failed: string) {
    const answer = await done;
    if (!answer.ok) return toast.error(failed, { detail: describeFailure(answer) });
    reload();
    onActed();
  }

  async function remove(account: AdminAccount) {
    setBusy(true);
    await act(removeAccount(account.accountId), `${account.username} 계정을 지우지 못했어요.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <Section title="계정" note={accounts ? `${accounts.length.toLocaleString('ko-KR')}명` : undefined}>
      {failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: reload }}>{failure}</Callout>}
      {accounts && (
        <List label="계정">
          {accounts.map((account) => (
            <ListItem
              key={account.accountId}
              title={account.username}
              tags={[...(account.username === own ? ['운영자'] : []), ...(account.suspended ? ['정지됨'] : [])]}
              description={`${monthDay(account.createdAt)} 가입 · ${held('글', account.bytes, account.bytesCap)} · ${held('그림', account.fileBytes, account.fileBytesCap)}`}
              trailing={
                <Menu place="below-end" label={`${account.username} 관리`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${account.username} 관리`} size="sm" {...opener} />}>
                  <MenuItem icon={HardDrive} label="저장 한도" onClick={() => setCapping(account)} />
                  {account.username !== own &&
                    (account.suspended ? (
                      <MenuItem icon={RotateCcw} label="정지 풀기" onClick={() => void act(setSuspended(account.accountId, false), `${account.username} 계정의 정지를 풀지 못했어요.`)} />
                    ) : (
                      <MenuItem icon={Ban} label="정지" sub="읽기, 백업, 알리기, 탈퇴만 돼요" onClick={() => void act(setSuspended(account.accountId, true), `${account.username} 계정을 정지하지 못했어요.`)} />
                    ))}
                  {account.username !== own && <MenuItem icon={Trash2} label="계정 지우기" tone="warn" onClick={() => setRemoving(account)} />}
                </Menu>
              }
            />
          ))}
        </List>
      )}
      {capping && (
        <CapsDialog
          account={capping}
          onClose={() => setCapping(null)}
          onSaved={() => {
            setCapping(null);
            reload();
            onActed();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog title={`${removing.username} 계정을 지울까요?`} confirm="지우기" icon={Trash2} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
          그 계정과 저장한 모든 것을 지워요. 되돌릴 수 없어요. 그 계정이 보낸 알림과 이 기록은 남아요.
        </ConfirmDialog>
      )}
    </Section>
  );
}
