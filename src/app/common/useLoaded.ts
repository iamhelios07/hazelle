import { useEffect, useState } from 'react';
import type { ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/pages';
import { describeFailure } from './failure';

// A failed reload keeps what was shown.
export function useLoaded<T>(load: () => Promise<ApiResult<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void load().then((answer) => {
      if (!live) return;
      setFailure(answer.ok ? null : describeFailure(answer));
      if (answer.ok) setData(answer.data);
    });
    return () => {
      live = false;
    };
  }, [attempt]);
  return { data, failure, reload: () => setAttempt((count) => count + 1) };
}

export function usePages<T extends { id: number }>(load: (before: number | null) => Promise<ApiResult<Page<T>>>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function fetch(before: number | null, live = () => true) {
    setBusy(true);
    const answer = await load(before);
    if (!live()) return;
    setBusy(false);
    setFailure(answer.ok ? null : describeFailure(answer));
    if (!answer.ok) return;
    setRows((shown) => (before === null ? answer.data.rows : [...(shown ?? []), ...answer.data.rows]));
    setMore(answer.data.more);
  }

  useEffect(() => {
    let live = true;
    void fetch(null, () => live);
    return () => {
      live = false;
    };
  }, []);

  return {
    rows,
    more,
    busy,
    failure,
    older: () => void fetch(rows!.at(-1)!.id),
    // Rows are kept only on success, so none yet means the first page failed and some means an older one did.
    retry: () => void fetch(rows === null ? null : (rows.at(-1)?.id ?? null)),
    patch: (id: number, change: Partial<T>) => setRows((shown) => shown && shown.map((row) => (row.id === id ? { ...row, ...change } : row))),
  };
}
