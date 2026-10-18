import { useEffect, useState } from 'react';
import { markNoticesSeen, readNotices, type Notice } from '../../runtime/account';
import { ago } from '../common/time';
import { HEAD_ROWS, usePages } from '../common/useLoaded';
import { NOTICES } from '../common/words';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Dialog, Empty, List, ListItem, NavBar, Panel, Screen, Text } from '../ui';
import { Exchange, messageRow } from './SentSection';

const REPLY = '내 알림에 대한 답변';

export function NoticesScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="form" top={<NavBar title={NOTICES.from} {...backBar(back)} />}>
      <NoticesSection head={false} seek={false} />
    </Screen>
  );
}

// head: the newest few, which 설정 › 계정 shows.
export function NoticesSection({ head, seek }: { head: boolean; seek: boolean }) {
  const pages = usePages((after) => readNotices(after, head ? { limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<Notice | null>(null);
  const { rows } = pages;
  // A head with more behind 모두 보기 marks nothing: an unread notice past its five was not shown.
  const newest = head && !pages.whole ? undefined : rows?.[0]?.id;
  useEffect(() => {
    if (newest !== undefined) void markNoticesSeen(newest);
  }, [newest]);
  return (
    <Panel
      title={NOTICES.from}
      help="이 알림은 종단 간 암호화되지 않아요."
      action={head && !pages.whole ? <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'notices' })}>모두 보기</Button> : undefined}
      seek={seek}
    >
      {pages.failure}
      {rows && rows.length === 0 && <Empty variant="section">{NOTICES.from}이 없어요.</Empty>}
      {rows && rows.length > 0 && (
        <List label={NOTICES.from} box>
          {rows.map((notice) => (
            <ListItem
              key={notice.id}
              {...messageRow(notice.text)}
              tags={notice.reportId === null ? [] : [REPLY]}
              aside={ago(notice.createdAt)}
              onClick={() => setOpen(notice)}
            />
          ))}
        </List>
      )}
      {!head && pages.more}
      {open && (
        <Dialog title={NOTICES.from} note={open.reportId === null ? ago(open.createdAt) : `${ago(open.createdAt)} · ${REPLY}`} onClose={() => setOpen(null)}>
          {open.reportId === null ? <Text variant="prose">{open.text}</Text> : <Exchange sent={open.question} answer={<Text variant="prose">{open.text}</Text>} />}
        </Dialog>
      )}
    </Panel>
  );
}
