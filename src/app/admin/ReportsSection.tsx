import { Check, History } from 'lucide-react';
import { useState } from 'react';
import { readReports, resolveReport, type Report } from '../../runtime/admin';
import { ago } from '../common/time';
import { NOTICES } from '../common/words';
import { Button, Callout, Dialog, Empty, List, ListItem, Panel, Stack, Text, TextField } from '../ui';
import { NoticeDialog } from './NoticeDialog';
import { ShareReportDialog } from './ShareReportDialog';
import { shareTags } from './shareTags';
import { usePages } from '../common/useLoaded';
import { ACTS } from '../common/acts';

export type AccountReport = Report & { accountId: string; username: string };

// A restore starts only from a report the account sent, so it is asked from the report. A share report is its own
// dialog (ShareReportDialog).
export function ReportsSection({ onActed, onRestore }: { onActed: () => void; onRestore: (report: AccountReport) => void }) {
  const pages = usePages(readReports);
  const [open, setOpen] = useState<Report | null>(null);
  const { rows } = pages;
  return (
    <Panel title={NOTICES.received}>
      {pages.failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: pages.retry }}>{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">{NOTICES.received}이 없어요.</Empty>}
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
      {pages.more && (
        <Button variant="ghost" size="sm" busy={pages.busy} onClick={pages.older}>
          더 보기
        </Button>
      )}
      {open?.share != null && (
        <ShareReportDialog
          report={open as Report & { share: string; shareVersion: number; link: string }}
          onClose={() => setOpen(null)}
          onActed={() => {
            pages.reload();
            setOpen(null);
            onActed();
          }}
        />
      )}
      {open && open.share === null && (
        <ReportDialog
          report={open as AccountReport}
          onClose={() => setOpen(null)}
          onRestore={() => {
            setOpen(null);
            onRestore(open as AccountReport);
          }}
          onResolved={(resolvedAt) => {
            pages.patch(open.id, { resolvedAt });
            setOpen(null);
            onActed();
          }}
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
