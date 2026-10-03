import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { useAttempt } from './useAttempt';
import { useCredential } from './useCredential';
import { probeRoot } from './probe';

it('owns both input modes and clears the previous secret and failure on every method switch', async () => {
  let credential: ReturnType<typeof useCredential>;
  let attempt: ReturnType<typeof useAttempt>;
  function Probe() {
    attempt = useAttempt();
    credential = useCredential(attempt.setFailure);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    expect(credential!).toMatchObject({ method: 'password', secret: '', recovery: false, alternate: '복구 키', field: { label: '비밀번호', kind: 'current-password', placeholder: undefined } });
    await act(() => { credential!.field.onChange('password'); attempt!.setFailure('wrong password'); });
    expect(credential!.secret).toBe('password');
    await act(() => credential!.switchMethod());
    expect(attempt!.failure).toBeNull();
    expect(credential!).toMatchObject({ method: 'recovery', secret: '', recovery: true, alternate: '비밀번호', field: { label: '복구 키', kind: 'code', value: '', placeholder: 'XXXX-XXXX-XXXX-…' } });
    await act(() => { credential!.field.onChange('recovery text'); attempt!.setFailure('wrong recovery'); });
    expect(credential!.secret).toBe('recovery text');
    await act(() => credential!.switchMethod());
    expect(attempt!.failure).toBeNull();
    expect(credential!).toMatchObject({ method: 'password', secret: '', recovery: false, field: { label: '비밀번호', kind: 'current-password', value: '', placeholder: undefined } });
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
