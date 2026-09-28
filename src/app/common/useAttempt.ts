import { useState } from 'react';

// A submit that is busy until it settles, then shows why it failed beside the form. The task answers
// with the failure in words, or null when it went through.
export function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setFailure(null);
    const failed = await task();
    setBusy(false);
    setFailure(failed);
  }

  return { busy, failure, run, setFailure };
}
