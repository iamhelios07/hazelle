import { Ban, HardDrive, History, MoreHorizontal, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiResult } from '../../runtime/api';
import { liftSuspension, removeAccount, sendNotice, suspend, type AccountState, type AdminAccount, type OwnCap } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { monthDay } from '../common/time';
import { NOTICES } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ConfirmDialog, IconButton, List, ListItem, Menu, MenuItem, Section } from '../ui';
import { CapsDialog } from './CapsDialog';
import { NoticeDialog } from './NoticeDialog';
import type { useAccounts } from './useAccounts';

const UNKNOWN = '알 수 없음';
const STATES: Record<AccountState, string | null> = { active: null, restoring: '복원 중', leaving: '탈퇴 중' };

const size = (bytes: number | null) => (bytes === null ? UNKNOWN : sizeText(bytes));
// What it holds, and its own cap when it has one.
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
    await act(account.accountId, removeAccount(account.accountId), account.state === 'leaving' ? `${account.username} 계정의 탈퇴를 마무리하지 못했어요.` : `${account.username} 계정을 지우지 못했어요.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <Section
      title="계정"
      note={`${loaded.page}쪽${data ? ` · ${data.accounts.length.toLocaleString('ko-KR')}명` : ''}`}
      action={<>
        <Button variant="ghost" size="sm" busy={loaded.busy} onClick={reload}>새로고침</Button>
        <Button variant="ghost" size="sm" disabled={loaded.busy || !loaded.previous} onClick={loaded.previous ?? undefined}>이전</Button>
        <Button variant="ghost" size="sm" disabled={loaded.busy || !loaded.next} onClick={loaded.next ?? undefined}>다음</Button>
      </>}
      hint="글은 계정이 저장한 내용의 크기, 디스크는 그 내용이 서버에서 차지해 요금이 매겨지는 크기예요. 제때 답하지 않았거나 복원 중, 탈퇴 중인 계정은 알 수 없음으로 보여요."
    >
      {failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: reload }}>{failure}</Callout>}
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
                description={`${monthDay(account.createdAt)} 가입 · ${held('글', account.bytes, account.bytesCap)} · 디스크 ${size(account.disk)} · ${held('그림', account.fileBytes, account.fileBytesCap)}`}
                trailing={
                  <Menu place="below-end" label={`${account.username} 관리`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${account.username} 관리`} size="sm" {...opener} />}>
                    {account.state === 'leaving' ? (
                      <MenuItem icon={Trash2} label="탈퇴 마무리" sub="멈춘 탈퇴를 이어서 끝내요" tone="warn" onClick={() => setRemoving(account)} />
                    ) : (
                      <>
                        <MenuItem icon={HardDrive} label="저장 한도" onClick={() => setCapping(account)} />
                        <MenuItem icon={History} label="복원 기록" onClick={() => onRestores(account)} />
                        {others && <MenuItem icon={Send} label={NOTICES.send} onClick={() => setWriting({ account, suspend: false })} />}
                        {others &&
                          (account.suspended ? (
                            <MenuItem icon={RotateCcw} label="정지 풀기" onClick={() => void act(account.accountId, liftSuspension(account.accountId), `${account.username} 계정의 정지를 풀지 못했어요.`)} />
                          ) : (
                            <MenuItem icon={Ban} label="정지" sub="읽기, 백업, 알리기, 탈퇴만 돼요" onClick={() => setWriting({ account, suspend: true })} />
                          ))}
                        {others && account.state === 'active' && <MenuItem icon={Trash2} label="계정 지우기" tone="warn" onClick={() => setRemoving(account)} />}
                      </>
                    )}
                  </Menu>
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
            placeholder="그 계정에 알림으로 가요."
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
          <ConfirmDialog title={`${removing.username} 계정의 탈퇴를 마무리할까요?`} confirm="마무리" icon={Trash2} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            이 계정은 지우던 중에 멈췄어요. 남은 글과 그림을 지우고 계정을 없애요. 되돌릴 수 없어요.
          </ConfirmDialog>
        ) : (
          <ConfirmDialog title={`${removing.username} 계정을 지울까요?`} confirm="지우기" icon={Trash2} busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
            그 계정과 저장한 모든 것을 지워요. 되돌릴 수 없어요. 그 계정이 보낸 알림과 이 기록은 남아요.
          </ConfirmDialog>
        ))}
    </Section>
  );
}
