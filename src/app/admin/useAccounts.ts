import { useEffect, useState } from 'react';
import { readAccounts, readAdminAccount, type AccountsPage } from '../../runtime/admin';
import { describeFailure } from '../common/failure';

// Navigation replaces the current page rather than accumulating every visited account in the DOM. Only cursor
// strings are kept for going back; an account action refreshes that account, not all pages or all store usage.
// A failed reload keeps the same page visible; navigation never presents the previous page as the newly asked one.
export function useAccounts() {
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState<{ cursor: string | null; page: AccountsPage } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = history.at(-1)!;
  const data = shown?.cursor === cursor ? shown.page : null;
  useEffect(() => {
    const stop = new AbortController();
    setBusy(true);
    void readAccounts(cursor, stop.signal).then((answer) => {
      if (stop.signal.aborted) return;
      setBusy(false);
      setFailure(answer.ok ? null : describeFailure(answer));
      if (answer.ok) setShown({ cursor, page: answer.data });
    });
    return () => stop.abort();
  }, [cursor, attempt]);

  async function refresh(id: string) {
    if (!data?.accounts.some(({ accountId }) => accountId === id)) return false;
    const answer = await readAdminAccount(id);
    if (!answer.ok) {
      setFailure(describeFailure(answer));
      return false;
    }
    const account = answer.data.account;
    setShown((current) => current && {
      ...current,
      page: { ...current.page, accounts: current.page.accounts.flatMap((row) => row.accountId === id ? account ? [account] : [] : [row]) },
    });
    return account === null;
  }

  return {
    data, failure, busy, refresh,
    page: history.length,
    previous: history.length > 1 ? () => setHistory((held) => held.slice(0, -1)) : null,
    next: data?.next ? () => setHistory((held) => [...held, data.next]) : null,
    reload: () => setAttempt((held) => held + 1),
  };
}
