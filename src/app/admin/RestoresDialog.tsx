import { History, MoreHorizontal, Play, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import type { RestoreAction, RestorePhase } from '../../contracts/admin';
import { beginRestore, continueRestore, readRestores, readSnapshotTime, type Report, type Restore, type RestoreRun } from '../../runtime/admin';
import type { ApiResult } from '../../runtime/api';
import { describeFailure } from '../common/failure';
import { ago } from '../common/time';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, ConfirmDialog, Dialog, Empty, IconButton, List, ListItem, Menu, MenuItem, Section, Stack, Text, TextField } from '../ui';
import { moment, TIME_FORMAT, typedTime } from './time';
import { useLoaded } from '../common/useLoaded';

// report: the one a new restore or an undo is asked on; null when opened from the account, which only continues one.
export type Restoring = { accountId: string; username: string; report: Report | null };

type Words = { tag: string; says: string };
const UNCHANGED = '계정 데이터는 바뀌지 않았어요.';
const PHASES: Record<Exclude<RestorePhase, 'done'>, Words> = {
  begun: { tag: '시작함', says: `복원을 시작했어요. ${UNCHANGED}` },
  fenced: { tag: '저장 차단', says: `그 계정의 저장과 불러오기를 차단했어요. ${UNCHANGED}` },
  checkpointed: { tag: '스냅샷 저장', says: `복원 직전 상태를 스냅샷으로 저장했어요. ${UNCHANGED}` },
  targeted: { tag: '시점 지정', says: `복원할 시점을 지정했어요. ${UNCHANGED} 여기까지는 취소할 수 있어요.` },
  armed: { tag: '복원 적용 중', says: '복원을 적용했어요. 이제 취소할 수 없어요.' },
  rewound: { tag: '복원함', says: '데이터를 복원했어요. 계정을 다시 열면 끝나요.' },
  failed: { tag: '실패', says: '복원하지 못하고 멈췄어요. 계정은 복원 전 상태예요.' },
  cancelled: { tag: '취소함', says: '취소했어요. 계정은 복원 전 상태예요.' },
};
const DONE: Words = { tag: '완료', says: '복원을 마치고 계정을 다시 열었어요.' };
const UNVERIFIED: Words = { tag: '확인 필요', says: '복원은 끝났지만 계정이 다시 열렸는지 확인하지 못했어요. 마무리 확인을 해 주세요.' };
const wordsOf = ({ phase, verified }: RestoreRun): Words => (phase === 'done' ? (verified ? DONE : UNVERIFIED) : PHASES[phase]);

// The server's error codes this page knows; another shows as the server wrote it.
const ERRORS: Record<string, string> = {
  'too-early': '그 시각의 기록이 저장소에 없어요. 더 늦은 시각으로 새로 복원해 주세요.',
  'store-unavailable': '그 계정의 저장소나 스냅샷을 읽지 못했어요. 잠시 뒤 이어서 해 주세요.',
  'not-rewound': '저장소가 아직 그 시점으로 돌아가지 않았어요. 잠시 뒤 이어서 해 주세요.',
  'not-verified': '계정이 아직 다시 열리지 않았어요. 잠시 뒤 마무리 확인을 해 주세요.',
  stuck: '같은 단계가 반복되어 멈췄어요. 계속되면 서버 기록을 확인해 주세요.',
};
export const restoreError = (code: string) => ERRORS[code] ?? code;
const REFUSED: Record<string, string> = {
  'bad-report': '그 계정이 보낸, 확인 처리하지 않은 알림으로만 복원할 수 있어요.',
  'bad-time': '10분 전부터 6일 전 사이의 시각으로만 복원할 수 있어요.',
  'cannot-undo': '그 계정의 마지막 복원만, 완료 후 7일 안에 한 번 되돌릴 수 있어요.',
  'account-busy': '그 계정에서 다른 복원이나 탈퇴가 진행 중이에요.',
  'cannot-cancel': '복원을 적용해서 취소할 수 없어요. 이어서 하기로 완료해 주세요.',
};

// Up to targeted nothing has changed, so resuming from there arms the restore, which cannot be taken back.
const BEFORE_ARMED: RestorePhase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];

const ACTIONS: Record<RestoreAction, { label: string; sub: string }> = {
  resume: { label: '이어서 하기', sub: '중단된 단계부터 이어서 진행해요' },
  cancel: { label: '취소', sub: '계정을 복원 전 상태로 다시 열어요' },
  finalize: { label: '마무리 확인', sub: '계정이 다시 열렸는지 확인해요' },
};

function described(restore: Restore): string {
  const error = restore.error === null ? '' : ` 오류: ${restoreError(restore.error)}`;
  const undo = restore.canUndo && restore.undoExpiresAt !== null ? ` ${moment(restore.undoExpiresAt)}까지 복원 전으로 되돌릴 수 있어요.` : '';
  return `${wordsOf(restore).says}${error}${undo}`;
}

// takenAt: when the snapshot the restore lands on was taken, shown before it is confirmed.
type Asking = { kind: 'restore'; at: number; takenAt: number } | { kind: 'undo'; restore: Restore } | { kind: 'resume'; restore: Restore };

export function RestoresDialog({ restoring, onClose, onActed }: { restoring: Restoring; onClose: () => void; onActed: () => void }) {
  const { accountId, username, report } = restoring;
  const toast = useToast();
  const restores = useLoaded(() => readRestores(accountId));
  const [time, setTime] = useState('');
  const [asking, setAsking] = useState<Asking | null>(null);
  const { busy, failure, run } = useAttempt();
  const at = typedTime(time);

  // The server runs it in the request and the operation keeps its phase if the page goes, so the request is not stopped
  // when the dialog closes; the toast tells where it ended.
  const go = (request: () => Promise<ApiResult<RestoreRun>>) =>
    run(async () => {
      const answer = await request();
      setAsking(null);
      if (!answer.ok) {
        toast.error(`${username} 계정을 복원하지 못했어요.`, { detail: REFUSED[answer.error] ?? describeFailure(answer) });
        return null;
      }
      const ended = answer.data;
      if (ended.phase === 'done' && ended.verified) toast.show(`${username} 계정의 복원을 끝냈어요.`);
      else if (ended.phase === 'cancelled') toast.show(`${username} 계정의 복원을 취소했어요.`);
      else toast.error(`${username} 계정의 복원이 '${wordsOf(ended).tag}'에서 멈췄어요.`, { detail: `${wordsOf(ended).says}${ended.error === null ? '' : ` 오류: ${restoreError(ended.error)}`}` });
      restores.reload();
      onActed();
      return null;
    });

  const ask = (at: number) =>
    run(async () => {
      const taken = await readSnapshotTime(accountId, at);
      if (!taken.ok) return describeFailure(taken);
      if (taken.data === null) return restoreError('too-early');
      setAsking({ kind: 'restore', at, takenAt: taken.data });
      return null;
    });

  const act = (restore: Restore, action: RestoreAction) =>
    action === 'resume' && BEFORE_ARMED.includes(restore.phase) ? setAsking({ kind: 'resume', restore }) : void go(() => continueRestore(restore.id, action));

  if (asking?.kind === 'restore') {
    return (
      <ConfirmDialog title={`${username} 계정을 ${moment(asking.takenAt)} 기록으로 복원할까요?`} confirm="복원" icon={History} busy={busy} onConfirm={() => void go(() => beginRestore(accountId, { report: report!.id, at: asking.at }))} onClose={() => setAsking(null)}>
        그 기록 이후 저장한 텍스트, 캐릭터, 채팅, 설정은 사라지고 이미지는 남아요. 완료 후 7일 안에는 복원 전으로 되돌릴 수 있어요.
      </ConfirmDialog>
    );
  }
  if (asking?.kind === 'undo') {
    return (
      <ConfirmDialog title={`${username} 계정을 복원 전으로 되돌릴까요?`} confirm="복원 전으로 되돌리기" icon={Undo2} busy={busy} onConfirm={() => void go(() => beginRestore(accountId, { report: report!.id, undoes: asking.restore.id }))} onClose={() => setAsking(null)}>
        이 복원 직전 상태로 돌아가요. 그 복원 이후 저장한 것은 사라져요.
      </ConfirmDialog>
    );
  }
  if (asking?.kind === 'resume') {
    return (
      <ConfirmDialog title="복원을 이어서 할까요?" confirm="이어서 하기" icon={Play} busy={busy} onConfirm={() => void go(() => continueRestore(asking.restore.id, 'resume'))} onClose={() => setAsking(null)}>
        적용하면 취소할 수 없고, 복원 시점 이후 저장한 것은 사라져요.
      </ConfirmDialog>
    );
  }

  return (
    <Dialog title={`${username} 복원`} onClose={onClose}>
      <Stack gap="group">
        {report && (
          <Stack gap="related">
            <Text variant="prose">{report.text}</Text>
            <TextField
              label="복원할 시각"
              value={time}
              onChange={setTime}
              placeholder={TIME_FORMAT}
              help="그 계정의 텍스트, 캐릭터, 채팅, 설정을 이 시각 또는 그 직전 기록으로 복원해요."
              error={time.trim() !== '' && at === undefined ? `${TIME_FORMAT} 형식으로 입력해 주세요.` : undefined}
            />
            {failure && <Callout tone="warn">{failure}</Callout>}
            <Button icon={History} busy={busy} disabled={at === undefined} onClick={() => void ask(at!)}>
              이 시각으로 복원
            </Button>
          </Stack>
        )}
        <Section level={3} title="복원 기록" hint={report ? undefined : '복원은 그 계정이 보낸 알림에서 시작해요.'}>
          {restores.failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: restores.reload }}>{restores.failure}</Callout>}
          {restores.data && restores.data.length === 0 && <Empty variant="section">복원한 적이 없어요.</Empty>}
          {restores.data && restores.data.length > 0 && (
            <List label="복원 기록">
              {restores.data.map((restore) => {
                const undoable = restore.canUndo && report !== null;
                return (
                  <ListItem
                    key={restore.id}
                    title={restore.at === null ? '복원 전으로 되돌리기' : `${moment(restore.targetAt ?? restore.at)} ${restore.targetAt === null ? '시점' : '기록'}으로 복원`}
                    tags={[wordsOf(restore).tag]}
                    description={described(restore)}
                    aside={ago(restore.updatedAt)}
                    trailing={
                      (restore.actions.length > 0 || undoable) && (
                        <Menu place="below-end" label="복원 관리" trigger={(opener) => <IconButton icon={MoreHorizontal} label="복원 관리" size="sm" {...opener} />}>
                          {restore.actions.map((action) => (
                            <MenuItem key={action} icon={action === 'cancel' ? X : Play} label={ACTIONS[action].label} sub={ACTIONS[action].sub} onClick={() => act(restore, action)} />
                          ))}
                          {undoable && <MenuItem icon={Undo2} label="복원 전으로 되돌리기" sub="복원 이후 저장한 것은 사라져요" tone="warn" onClick={() => setAsking({ kind: 'undo', restore })} />}
                        </Menu>
                      )
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </Stack>
    </Dialog>
  );
}
