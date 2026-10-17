import { readAccounts, readAdminAccount } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { HEAD_ROWS, usePages } from '../common/useLoaded';
import { useToast } from '../toast';

// head: only the accounts suspended, restoring or leaving, the few 운영 shows; it is asked again after an act, which may
// flag an account not in hand. The whole list refetches only the account acted on (gone when null), keeping the pages
// read so far.
export function useAccounts(head: boolean) {
  const toast = useToast();
  const pages = usePages((after) => readAccounts(after, head ? { flagged: true, limit: HEAD_ROWS } : {}));

  async function refresh(id: string) {
    if (!pages.rows?.some(({ accountId }) => accountId === id)) return;
    const answer = await readAdminAccount(id);
    if (!answer.ok) return toast.error('계정을 다시 읽지 못했어요.', { detail: describeFailure(answer) });
    const account = answer.data.account;
    pages.update((rows) => rows.flatMap((row) => (row.accountId === id ? (account ? [account] : []) : [row])));
  }

  function acted(id?: string) {
    if (head) pages.reload();
    else if (id) void refresh(id);
  }

  return { ...pages, head, acted };
}
