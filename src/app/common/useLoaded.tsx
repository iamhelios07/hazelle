import { useEffect, useState } from 'react';
import type { ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/pages';
import { Button, Callout } from '../ui';
import { ACTS } from './acts';
import { describeFailure } from './failure';

// A failed reload keeps what was shown.
export function useLoaded<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).then((answer) => {
      if (abort.signal.aborted) return;
      setFailure(answer.ok ? null : describeFailure(answer));
      if (answer.ok) setData(answer.data);
    });
    return () => abort.abort();
  }, [attempt]);
  return { data, failure, reload: () => setAttempt((count) => count + 1) };
}

// How many rows a list shows on a page that leads elsewhere to it whole (운영, 설정 › 계정): the newest, or what waits.
export const HEAD_ROWS = 5;

export function usePages<T>(load: (after: string | null) => Promise<ApiResult<Page<T>>>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function fetch(after: string | null, live = () => true) {
    setBusy(true);
    const answer = await load(after);
    if (!live()) return;
    setBusy(false);
    setFailure(answer.ok ? null : describeFailure(answer));
    if (!answer.ok) return;
    setRows((shown) => (after === null ? answer.data.rows : [...(shown ?? []), ...answer.data.rows]));
    setNext(answer.data.next);
  }

  useEffect(() => {
    let live = true;
    void fetch(null, () => live);
    return () => {
      live = false;
    };
  }, []);

  // Rows and next are kept only on success, so none yet means the first page failed and some means the next one did.
  const retry = () => void fetch(rows === null ? null : next);
  return {
    rows,
    busy,
    // Every row is in hand: a head that is whole needs no door to the rest.
    whole: rows !== null && next === null,
    failure: failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: retry }}>{failure}</Callout>,
    more: next !== null && (
      <Button variant="ghost" size="sm" busy={busy} onClick={() => void fetch(next)}>
        더 보기
      </Button>
    ),
    // After an act that changed rows not in hand, such as every report on one share: the first page again.
    reload: () => void fetch(null),
    update: (change: (shown: T[]) => T[]) => setRows((shown) => shown && change(shown)),
  };
}
