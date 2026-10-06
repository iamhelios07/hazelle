import { Check, History } from 'lucide-react';
import { useState } from 'react';
import { readReports, resolveReport, type Report } from '../../runtime/admin';
import { ago } from '../common/time';
import { NOTICES } from '../common/words';
import { Button, Callout, Dialog, Empty, List, ListItem, Section, Text } from '../ui';
import { NoticeDialog } from './NoticeDialog';
import { usePages } from '../common/useLoaded';

// A restore starts only from a report the account sent, so it is asked from the report.
export function ReportsSection({ onActed, onRestore }: { onActed: () => void; onRestore: (report: Report) => void }) {
  const pages = usePages(readReports);
  const [open, setOpen] = useState<Report | null>(null);
  const { rows } = pages;
  return (
    <Section title={NOTICES.received}>
      {pages.failure && <Callout tone="warn">{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">{NOTICES.received}이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label={NOTICES.received}>
          {rows.map((report) => (
            <ListItem
              key={report.id}
              title={report.username}
              tags={report.resolvedAt === null ? [] : ['확인함']}
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
      {open && (
        <ReportDialog
          report={open}
          onClose={() => setOpen(null)}
          onRestore={() => {
            setOpen(null);
            onRestore(open);
          }}
          onResolved={(resolvedAt) => {
            pages.patch(open.id, { resolvedAt });
            setOpen(null);
            onActed();
          }}
        />
      )}
    </Section>
  );
}

function ReportDialog({ report, onClose, onRestore, onResolved }: { report: Report; onClose: () => void; onRestore: () => void; onResolved: (at: number) => void }) {
  const title = `${report.username}의 알림`;
  const text = <Text variant="prose">{report.text}</Text>;
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
      placeholder="비워 두면 답변 없이 확인 처리해요."
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
