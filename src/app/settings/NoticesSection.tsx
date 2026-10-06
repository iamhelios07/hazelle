import { useEffect, useState } from 'react';
import { markNoticesSeen, readNotices, type Notice } from '../../runtime/account';
import { ago } from '../common/time';
import { usePages } from '../common/useLoaded';
import { NOTICES } from '../common/words';
import { Button, Callout, Dialog, Empty, List, ListItem, Section, Text } from '../ui';

const REPLY = '내 알림에 대한 답변';

// Opening it marks what it shows as seen. seek: the page was opened at it, from the toast saying notices came.
export function NoticesSection({ seek }: { seek: boolean }) {
  const pages = usePages(readNotices);
  const [open, setOpen] = useState<Notice | null>(null);
  const { rows } = pages;
  const newest = rows?.[0]?.id;
  useEffect(() => {
    if (newest !== undefined) void markNoticesSeen(newest);
  }, [newest]);
  return (
    <Section title={NOTICES.from} hint="이 알림은 종단 간 암호화되지 않아요." seek={seek}>
      {pages.failure && <Callout tone="warn">{pages.failure}</Callout>}
      {rows && rows.length === 0 && <Empty variant="section">{NOTICES.received} 없음</Empty>}
      {rows && rows.length > 0 && (
        <List label={NOTICES.from}>
          {rows.map((notice) => (
            <ListItem
              key={notice.id}
              title={notice.text}
              tags={notice.reportId === null ? [] : [REPLY]}
              aside={ago(notice.createdAt)}
              onClick={() => setOpen(notice)}
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
        <Dialog title={NOTICES.from} note={open.reportId === null ? ago(open.createdAt) : `${ago(open.createdAt)} · ${REPLY}`} onClose={() => setOpen(null)}>
          <Text variant="prose">{open.text}</Text>
        </Dialog>
      )}
    </Section>
  );
}
