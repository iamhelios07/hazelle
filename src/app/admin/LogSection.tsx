import { readLog, type LogRow } from '../../runtime/admin';
import { sizeText } from '../common/size';
import { ago } from '../common/time';
import { Button, Callout, Empty, List, ListItem, Section } from '../ui';
import { usePages } from './useLoaded';

// The actions server/admin logs. One it does not list shows as the server wrote it.
const ACTIONS: Record<string, string> = {
  suspend: '정지',
  lift: '정지 풀기',
  'delete-account': '계정 지우기',
  'set-service': '서비스 설정',
  'set-caps': '저장 한도',
  'resolve-report': '알림 확인',
  'block-file': '파일 차단',
  'unblock-file': '파일 차단 풀기',
  'restore-begun': '복원 시작',
  'restore-done': '복원 끝남',
  'restore-cancelled': '복원 취소',
  'restore-failed': '복원 실패',
};

const capText = (cap: unknown) => (typeof cap === 'number' ? sizeText(cap) : cap === 'default' ? '기본값' : '없음');

function detailOf({ action, detail }: LogRow): string | undefined {
  if (detail === null) return undefined;
  const values = detail as Record<string, unknown>;
  if (action === 'set-caps') return `${String(values.username)} · 글 한도 ${capText(values.bytesCap)} · 그림 한도 ${capText(values.fileBytesCap)}`;
  if (typeof values.username === 'string') return values.username;
  if (action === 'set-service' && typeof values.signupCap === 'number') {
    return `가입 정원 ${values.signupCap}명 · 계정당 글 한도 ${capText(values.accountBytesCap)} · 계정당 그림 한도 ${capText(values.accountFileBytesCap)}`;
  }
  return JSON.stringify(detail);
}

export function LogSection() {
  const pages = usePages(readLog);
  const { rows } = pages;
  return (
    <Section title="기록">
      {pages.failure && <Callout tone="warn">{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">아직 한 일이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label="기록">
          {rows.map((row) => (
            <ListItem key={row.id} title={ACTIONS[row.action] ?? row.action} code={row.target} description={detailOf(row)} aside={ago(row.at)} />
          ))}
        </List>
      )}
      {pages.more && (
        <Button variant="ghost" size="sm" busy={pages.busy} onClick={pages.older}>
          더 보기
        </Button>
      )}
    </Section>
  );
}
