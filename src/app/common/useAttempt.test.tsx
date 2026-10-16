import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { useAttempt } from './useAttempt';
import { probeRoot } from '../ui/probe';

it('stops the signal its task was given when the screen is left', async () => {
  let attempt: ReturnType<typeof useAttempt>;
  function Probe() {
    attempt = useAttempt();
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    let seen: AbortSignal | undefined;
    await act(() => void attempt!.run((signal) => new Promise(() => void (seen = signal))));
    expect(seen!.aborted).toBe(false);
    await act(() => root.unmount());
    expect(seen!.aborted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
