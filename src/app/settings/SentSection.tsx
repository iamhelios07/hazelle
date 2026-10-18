import { useState, type ReactNode } from 'react';
import { readSentReports, type SentReport } from '../../runtime/account';
import { ago } from '../common/time';
import { HEAD_ROWS, usePages } from '../common/useLoaded';
import { NOTICES } from '../common/words';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Dialog, Empty, List, ListItem, NavBar, Panel, Screen, Section, Stack, Text } from '../ui';
import { ReportButton } from './ReportDialog';

// What the person sent and what came back. sent null: the report was deleted a year after it was resolved.
export function Exchange({ sent, answer }: { sent: string | null; answer: ReactNode }) {
  return (
    <Stack gap="section">
      <Section level={3} title="보낸 내용">
        {sent === null ? <Text variant="note">1년이 지나 삭제됐어요.</Text> : <Text variant="prose">{sent}</Text>}
      </Section>
      <Section level={3} title="운영자 답변">
        {answer}
      </Section>
    </Stack>
  );
}

// A message's row: its first line leads and the rest previews, since a title folds the line breaks the dialog keeps.
export function messageRow(text: string): { title: string; description?: string } {
  const end = text.indexOf('\n');
  if (end < 0) return { title: text };
  const description = text.slice(end + 1).trim();
  return description ? { title: text.slice(0, end), description } : { title: text.slice(0, end) };
}

const status = ({ resolvedAt, reply }: SentReport) => (reply !== null ? '답변 옴' : resolvedAt !== null ? '확인함' : '확인 전');

export function SentScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="form" top={<NavBar title={NOTICES.sent} {...backBar(back)} />}>
      <SentSection head={false} />
    </Screen>
  );
}

// Writing to the operator starts here, where what was sent and its answer show. head: the newest few, which 설정 ›
// 계정 shows.
export function SentSection({ head }: { head: boolean }) {
  const pages = usePages((after) => readSentReports(after, head ? { limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<SentReport | null>(null);
  const { rows } = pages;
  return (
    <Panel
      title={NOTICES.sent}
      help="이 알림은 종단 간 암호화되지 않아요."
      action={<>
        {head && !pages.whole && <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'sent' })}>모두 보기</Button>}
        <ReportButton onSent={pages.reload} />
      </>}
    >
      {pages.failure}
      {rows && rows.length === 0 && <Empty variant="section">{NOTICES.sent}이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label={NOTICES.sent} box>
          {rows.map((report) => (
            <ListItem key={report.id} {...messageRow(report.text)} tags={[status(report)]} aside={ago(report.createdAt)} onClick={() => setOpen(report)} />
          ))}
        </List>
      )}
      {!head && pages.more}
      {open && (
        <Dialog title={NOTICES.sent} note={ago(open.createdAt)} onClose={() => setOpen(null)}>
          <Exchange
            sent={open.text}
            answer={open.reply !== null ? <Text variant="prose">{open.reply}</Text> : <Text variant="note">{open.resolvedAt !== null ? '답변 없이 확인했어요.' : '아직 확인하기 전이에요.'}</Text>}
          />
        </Dialog>
      )}
    </Panel>
  );
}
