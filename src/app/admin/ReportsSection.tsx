import { Check, History } from 'lucide-react';
import { useState } from 'react';
import { readReports, resolveReport, type Report } from '../../runtime/admin';
import { ago } from '../common/time';
import { NOTICES } from '../common/words';
import { RestoresDialog } from '../common/RestoresDialog';
import { navigate } from '../shell/router';
import { Button, Dialog, Empty, List, ListItem, Panel, Stack, Text, TextField } from '../ui';
import { NoticeDialog } from './NoticeDialog';
import { ShareReportDialog } from './ShareReportDialog';
import { shareTags } from './shareTags';
import { HEAD_ROWS, usePages } from '../common/useLoaded';

type AccountReport = Report & { accountId: string; username: string };

// A restore starts only from a report the account sent, so it is asked from the report. A share report is its own
// dialog (ShareReportDialog). head: only the reports not resolved, the few 운영 shows, asked again after each act so
// the next waiting one comes up. onActed: the account a restore acted on, when one did.
export function ReportsSection({ head, onActed }: { head: boolean; onActed?: (account?: string) => void }) {
  const pages = usePages((after) => readReports(after, head ? { open: true, limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<Report | null>(null);
  const [restoring, setRestoring] = useState<AccountReport | null>(null);
  const { rows } = pages;
  return (
    <Panel
      title={NOTICES.received}
      help={head ? '확인하지 않은 알림만 여기에 보여요.' : undefined}
      action={head ? <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'admin-list', list: 'reports' })}>모두 보기</Button> : undefined}
    >
      {pages.loading}
      {pages.failure}
      {rows && rows.length === 0 && <Empty variant="section">{head ? '확인할 알림이 없어요.' : `${NOTICES.received}이 없어요.`}</Empty>}
      {rows && rows.length > 0 && (
        <List label={NOTICES.received} box>
          {rows.map((report) => (
            <ListItem
              key={report.id}
              title={report.share === null ? report.username! : `링크 신고 · ${report.username ?? '익명'}`}
              tags={[...(report.resolvedAt === null ? [] : ['확인함']), ...(report.diagnostics === null ? [] : ['진단 정보']), ...(report.shared ? shareTags(report.shared) : [])]}
              aside={ago(report.createdAt)}
              description={report.text}
              onClick={() => setOpen(report)}
            />
          ))}
        </List>
      )}
      {!head && pages.more}
      {open?.share != null && (
        <ShareReportDialog
          report={open as Report & { share: string; shareVersion: number; link: string }}
          onClose={() => setOpen(null)}
          onActed={() => {
            pages.reload();
            setOpen(null);
            onActed?.();
          }}
        />
      )}
      {open && open.share === null && (
        <ReportDialog
          report={open as AccountReport}
          onClose={() => setOpen(null)}
          onRestore={() => {
            setOpen(null);
            setRestoring(open as AccountReport);
          }}
          onResolved={(resolvedAt) => {
            if (head) pages.reload();
            else pages.update((shown) => shown.map((row) => (row.id === open.id ? { ...row, resolvedAt } : row)));
            setOpen(null);
            onActed?.();
          }}
        />
      )}
      {restoring && (
        <RestoresDialog
          key={restoring.accountId}
          operated={{ accountId: restoring.accountId, username: restoring.username, report: restoring }}
          onClose={() => setRestoring(null)}
          onActed={() => onActed?.(restoring.accountId)}
        />
      )}
    </Panel>
  );
}

function ReportDialog({ report, onClose, onRestore, onResolved }: { report: AccountReport; onClose: () => void; onRestore: () => void; onResolved: (at: number) => void }) {
  const title = `${report.username}의 알림`;
  const text = (
    <Stack gap="related">
      <Text variant="prose">{report.text}</Text>
      {report.diagnostics !== null && <TextField label="진단 정보" lines={8} value={report.diagnostics} onChange={() => {}} readOnly />}
    </Stack>
  );
  if (report.resolvedAt !== null) {
    return (
      <Dialog title={title} note={ago(report.createdAt)} onClose={onClose}>
        {text}
      </Dialog>
    );
  }
  return (
    <NoticeDialog
      title={title}
      note={ago(report.createdAt)}
      label="답변"
      optional
      placeholder="비워 두면 답변을 보내지 않고 확인 처리만 해요."
      confirm={{ label: '확인 처리', icon: Check }}
      about={text}
      also={
        <Button variant="secondary" icon={History} onClick={onRestore}>
          이 알림으로 복원
        </Button>
      }
      send={(reply) => resolveReport(report.id, reply)}
      onSent={() => onResolved(Date.now())}
      onClose={onClose}
    />
  );
}
