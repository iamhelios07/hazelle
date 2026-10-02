import { Check, History } from 'lucide-react';
import { useState } from 'react';
import { readReports, resolveReport, type Report } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { ago } from '../common/time';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Dialog, Empty, List, ListItem, Section, Text } from '../ui';
import { usePages } from './useLoaded';

// A restore starts only from a report the account sent, so it is asked from the report.
export function ReportsSection({ onActed, onRestore }: { onActed: () => void; onRestore: (report: Report) => void }) {
  const pages = usePages(readReports);
  const [open, setOpen] = useState<Report | null>(null);
  const { rows } = pages;
  return (
    <Section title="알림">
      {pages.failure && <Callout tone="warn">{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">받은 알림이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label="알림">
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
  const { busy, failure, run } = useAttempt();
  const resolve = () =>
    run(async () => {
      const done = await resolveReport(report.id);
      if (!done.ok) return describeFailure(done);
      onResolved(Date.now());
      return null;
    });
  return (
    <Dialog
      title={`${report.username}의 알림`}
      note={ago(report.createdAt)}
      onClose={onClose}
      actions={
        report.resolvedAt === null ? (
          <>
            <Button variant="secondary" icon={History} onClick={onRestore}>
              이 알림으로 복원
            </Button>
            <Button icon={Check} busy={busy} onClick={() => void resolve()}>
              확인함으로 두기
            </Button>
          </>
        ) : undefined
      }
    >
      <Text variant="prose">{report.text}</Text>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
