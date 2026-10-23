import { useEffect } from 'react';
import { usageNoticesOf } from '../../runtime/chat-context';
import { usageNotice } from '../common/calls';
import { useSession } from '../session';
import { useToast } from '../toast';

// 사용량 알림 stands in the shell, not in the chat screen: a call may end for a chat that is not the one open.
export function UsageNotices() {
  const { store, log } = useSession();
  const toast = useToast();
  useEffect(
    () =>
      log.onRecord((entry) => {
        const notice = usageNotice(entry, usageNoticesOf(store));
        if (notice) toast.show(notice.message, { detail: notice.detail });
      }),
    [store, log, toast],
  );
  return null;
}
