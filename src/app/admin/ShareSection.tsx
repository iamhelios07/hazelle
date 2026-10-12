import { useState } from 'react';
import { SHARE_ID } from '../../contracts/shares';
import { holdShare, releaseShare } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, Row, Section, Stack, TextField } from '../ui';

// 보류 by a share's id, for what the operator learns without a report; 보류 풀기 marks the share reviewed.
export function ShareSection({ onActed }: { onActed: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const { busy, failure, run } = useAttempt();
  // A whole link is taken too: its id is between /s/ and #.
  const id = /\/s\/([^/#?]+)/.exec(typed)?.[1] ?? typed.trim();
  const valid = SHARE_ID.test(id);

  const act = (hold: boolean) =>
    run(async () => {
      const done = await (hold ? holdShare(id) : releaseShare(id));
      if (!done.ok) return done.error === 'not-found' ? (hold ? '없거나 이미 멈춘 링크예요.' : '없거나 차단된 링크예요.') : describeFailure(done);
      toast.show(hold ? '링크를 멈췄어요.' : '링크 보류를 풀었어요.', { detail: id });
      setTyped('');
      onActed();
      return null;
    });

  return (
    <Section title="링크 보류" help="멈춘 링크는 운영자가 풀 때까지 열리지 않아요.">
      <Stack gap="related">
        <TextField label="링크 id" kind="key" value={typed} onChange={setTyped} placeholder="16자 id 또는 링크" error={typed && !valid ? '링크 id를 찾지 못했어요.' : undefined} />
        <Row kind="actions">
          <Button variant="danger" size="sm" busy={busy} disabled={!valid} onClick={() => void act(true)}>
            보류
          </Button>
          <Button variant="secondary" size="sm" busy={busy} disabled={!valid} onClick={() => void act(false)}>
            보류 풀기
          </Button>
        </Row>
        {failure && <Callout tone="warn" alert>{failure}</Callout>}
      </Stack>
    </Section>
  );
}
