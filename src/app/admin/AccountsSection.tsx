import { Ban, HardDrive, History, LockOpen, Send } from 'lucide-react';
import { useState } from 'react';
import type { AccountState } from '../../contracts/admin';
import type { ApiResult } from '../../runtime/api';
import { liftSuspension, removeAccount, sendNotice, suspend, type AdminAccount, type OwnCap } from '../../runtime/admin';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { monthDay } from '../common/time';
import { NOTICES, UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ConfirmDialog, List, ListItem, MenuItem, MoreMenu, Section } from '../ui';
import { CapsDialog } from './CapsDialog';
import { NoticeDialog } from './NoticeDialog';
import type { useAccounts } from './useAccounts';

const STATES: Record<AccountState, string | null> = { active: null, restoring: '복원 중', leaving: '탈퇴 중' };

const size = (bytes: number | null) => (bytes === null ? UNKNOWN : sizeText(bytes));
const held = (name: string, bytes: number | null, cap: OwnCap) => `${name} ${size(bytes)}${cap === 'default' ? '' : ` / ${cap === null ? '한도 없음' : sizeText(cap)}`}`;

type Named = Pick<AdminAccount, 'accountId' | 'username'>;

export function AccountsSection({ loaded, onActed, onRestores }: { loaded: ReturnType<typeof useAccounts>; onActed: (id?: string) => void; onRestores: (account: Named) => void }) {
  const { username: own } = useSession();
  const toast = useToast();
  const { data, failure, reload } = loaded;
  const [removing, setRemoving] = useState<AdminAccount | null>(null);
  const [capping, setCapping] = useState<AdminAccount | null>(null);
  const [writing, setWriting] = useState<{ account: AdminAccount; suspend: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(id: string, done: Promise<ApiResult<undefined>>, failed: string) {
    const answer = await done;
    if (!answer.ok) return toast.error(failed, { detail: describeFailure(answer) });
    onActed(id);
  }

  async function remove(account: AdminAccount) {
    setBusy(true);
    await act(account.accountId, removeAccount(account.accountId), account.state === 'leaving' ? `${account.username} 계정의 탈퇴를 마무리하지 못했어요.` : `${account.username} 계정을 삭제하지 못했어요.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <Section
      title="계정"
      note={`${loaded.page}쪽${data ? ` · ${data.accounts.length.toLocaleString('ko-KR')}명` : ''}`}
      action={<>
        <Button variant="ghost" busy={loaded.busy} onClick={reload}>새로고침</Button>
        <Button variant="ghost" disabled={loaded.busy || !loaded.previous} onClick={loaded.previous ?? undefined}>이전</Button>
        <Button variant="ghost" disabled={loaded.busy || !loaded.next} onClick={loaded.next ?? undefined}>다음</Button>
      </>}
      help="텍스트는 계정이 저장한 내용의 크기, 디스크는 그 내용이 서버에서 차지하는 크기예요."
    >
      {failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: reload }}>{failure}</Callout>}
      {data && (
        <List label="계정">
          {data.accounts.map((account) => {
            const state = STATES[account.state];
            const others = account.username !== own;
            return (
              <ListItem
                key={account.accountId}
                title={account.username}
                tags={[...(others ? [] : ['운영자']), ...(state ? [state] : []), ...(account.suspended ? ['정지됨'] : [])]}
                description={`${monthDay(account.createdAt)} 가입 · ${held('텍스트', account.bytes, account.bytesCap)} · 디스크 ${size(account.disk)} · ${held('이미지', account.fileBytes, account.fileBytesCap)}`}
                trailing={
                  <MoreMenu of={account.username}>
                    {account.state === 'leaving' ? (
                      <MenuItem icon={ACTS.remove.icon} label="탈퇴 마무리" sub="중단된 탈퇴를 완료해요" tone="warn" onClick={() => setRemoving(account)} />
                    ) : (
                      <>
                        <MenuItem icon={HardDrive} label="저장 한도" onClick={() => setCapping(account)} />
                        <MenuItem icon={History} label="복원 기록" onClick={() => onRestores(account)} />
                        {others && <MenuItem icon={Send} label={NOTICES.send} onClick={() => setWriting({ account, suspend: false })} />}
                        {others &&
                          (account.suspended ? (
                            <MenuItem icon={LockOpen} label="정지 해제" onClick={() => void act(account.accountId, liftSuspension(account.accountId), `${account.username} 계정의 정지를 해제하지 못했어요.`)} />
                          ) : (
                            <MenuItem icon={Ban} label="정지" sub="읽기, 백업, 알림, 탈퇴만 가능해요" onClick={() => setWriting({ account, suspend: true })} />
                          ))}
                        {others && account.state === 'active' && <MenuItem icon={ACTS.remove.icon} label="계정 삭제" tone="warn" onClick={() => setRemoving(account)} />}
                      </>
                    )}
                  </MoreMenu>
                }
              />
            );
          })}
        </List>
      )}
      {capping && (
        <CapsDialog
          account={capping}
          onClose={() => setCapping(null)}
          onSaved={() => {
            setCapping(null);
            onActed(capping.accountId);
          }}
        />
      )}
      {writing &&
        (writing.suspend ? (
          <NoticeDialog
            title={`${writing.account.username} 계정을 정지할까요?`}
            label="정지 이유"
            placeholder="이 내용은 알림으로 전달돼요."
            confirm={{ label: '정지', icon: Ban }}
            send={(reason) => suspend(writing.account.accountId, reason)}
            onSent={() => {
              setWriting(null);
              onActed(writing.account.accountId);
            }}
            onClose={() => setWriting(null)}
          />
        ) : (
          <NoticeDialog
            title={`${writing.account.username}에게 ${NOTICES.send}`}
            label="보낼 내용"
            confirm={{ label: '보내기', icon: Send }}
            send={(text) => sendNotice(writing.account.accountId, text)}
            onSent={() => {
              setWriting(null);
              toast.show(`${writing.account.username}에게 보냈어요.`);
              onActed();
            }}
            onClose={() => setWriting(null)}
          />
        ))}
      {removing &&
        (removing.state === 'leaving' ? (
          <ConfirmDialog title={`${removing.username} 계정의 탈퇴를 마무리할까요?`} confirm="마무리" icon={ACTS.remove.icon} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            남은 데이터를 삭제하고 계정을 없애요. 되돌릴 수 없어요.
          </ConfirmDialog>
        ) : (
          <ConfirmDialog title={`${removing.username} 계정을 삭제할까요?`} confirm={ACTS.remove.label} icon={ACTS.remove.icon} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            그 계정과 저장한 모든 데이터를 삭제해요. 되돌릴 수 없어요.
          </ConfirmDialog>
        ))}
    </Section>
  );
}
