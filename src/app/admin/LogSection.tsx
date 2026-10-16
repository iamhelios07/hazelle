import { readLog, type LogRow } from '../../runtime/admin';
import { sizeText } from '../common/size';
import { ago } from '../common/time';
import { NOTICES } from '../common/words';
import { Button, Callout, Empty, List, ListItem, Panel } from '../ui';
import { restoreError } from '../common/RestoresDialog';
import { moment } from '../common/time';
import { usePages } from '../common/useLoaded';
import { ACTS } from '../common/acts';

// The actions server/admin logs. One it does not list shows as the server wrote it.
const ACTIONS: Record<string, string> = {
  suspend: '정지',
  lift: '정지 해제',
  'delete-account': '계정 삭제',
  'set-service': '서비스 설정',
  'set-caps': '저장 한도',
  'resolve-report': '알림 확인',
  'send-notice': NOTICES.send,
  'block-file': '파일 차단',
  'unblock-file': '파일 차단 해제',
  'hold-share': '링크 보류',
  'release-share': '링크 보류 풀기',
  'block-share': '링크 차단',
  'restore-begun': '복원 시작',
  'restore-done': '복원 완료',
  'restore-cancelled': '복원 취소',
  'restore-failed': '복원 실패',
};

const capText = (cap: unknown) => (typeof cap === 'number' ? sizeText(cap) : cap === 'default' ? '기본값' : '없음');

function detailOf({ action, detail }: LogRow): string | undefined {
  if (action === 'send-notice' && detail === null) return '모두에게';
  if (detail === null) return undefined;
  const values = detail as Record<string, unknown>;
  if (action === 'send-notice' && typeof values.report === 'number') return `${String(values.username)} · 알림 ${values.report}에 답변`;
  if (action === 'set-caps') return `${String(values.username)} · 텍스트 한도 ${capText(values.bytesCap)} · 이미지 한도 ${capText(values.fileBytesCap)}`;
  if (action === 'restore-begun') return `${String(values.username)} · ${typeof values.at === 'number' ? `${moment(values.at)} 시점으로` : '복원 전으로 되돌리기'}`;
  if (action === 'restore-failed' && typeof values.error === 'string') return `${String(values.username)} · ${restoreError(values.error)}`;
  if (typeof values.username === 'string') return values.username;
  if (action === 'set-service' && typeof values.signupCap === 'number') {
    return `가입 정원 ${values.signupCap}명 · 계정당 텍스트 한도 ${capText(values.accountBytesCap)} · 계정당 이미지 한도 ${capText(values.accountFileBytesCap)}`;
  }
  return JSON.stringify(detail);
}

// An account's row names it by the username in its detail, and 'service' and 'everyone' only restate the action, so
// the target is printed where it is the row's one name: a share's, a file's or a report's id.
function codeOf({ target, detail }: LogRow): string | undefined {
  if (target === 'service' || target === 'everyone') return undefined;
  return typeof (detail as Record<string, unknown> | null)?.username === 'string' ? undefined : target;
}

export function LogSection() {
  const pages = usePages(readLog);
  const { rows } = pages;
  return (
    <Panel title="기록">
      {pages.failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: pages.retry }}>{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">아직 기록이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label="기록" box>
          {rows.map((row) => (
            <ListItem key={row.id} title={ACTIONS[row.action] ?? row.action} code={codeOf(row)} description={detailOf(row)} aside={ago(row.at)} />
          ))}
        </List>
      )}
      {pages.more && (
        <Button variant="ghost" size="sm" busy={pages.busy} onClick={pages.older}>
          더 보기
        </Button>
      )}
    </Panel>
  );
}
