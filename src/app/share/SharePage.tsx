import { Flag, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_REPORT_LENGTH } from '../../contracts/admin';
import { countReceived, openVersion, readShareLink, readShareState, reportShare, shareLink, type Opened } from '../../runtime/share';
import { describeFailure } from '../common/failure';
import { LegalNotice } from '../common/LegalNotice';
import { SharePreview } from '../common/SharePreview';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { ACTS } from '../common/acts';
import { SHARE } from '../common/words';
import { Brand, Button, Callout, Dialog, Intro, Row, Screen, Stack, Text, TextField } from '../ui';
import { holdPending, pendingFor } from '../common/sharePending';

type View =
  | { kind: 'loading' }
  | { kind: 'live'; opened: Opened; version: number; received: number }
  | { kind: 'held' }
  | { kind: 'gone' }
  // A link cut short of its key, or a key that does not open it.
  | { kind: 'broken' }
  | { kind: 'failed'; failure: string };

// main.tsx asks before the account flow, as for /terms: the page reads the same signed in or out, and opens without an
// account. A link whose 헤이젤로 가져오기 is waiting goes to the account flow instead (common/sharePending).
export function sharePage(path: string, hash: string) {
  const link = readShareLink(path, hash);
  if (!link || pendingFor(link.id) !== null) return null;
  return <SharePage id={link.id} shareKey={link.key} />;
}

function SharePage({ id, shareKey }: { id: string; shareKey: string | null }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async (): Promise<View> => {
      if (shareKey === null) return { kind: 'broken' };
      const state = await readShareState(id);
      if (!state.ok) return { kind: 'failed', failure: describeFailure(state) };
      if (state.data.state !== 'live') return { kind: state.data.state };
      const opened = await openVersion({ id, operator: false }, state.data.manifest, shareKey);
      if (opened.ok) return { kind: 'live', opened: opened.data, version: state.data.version, received: state.data.received };
      return opened.error === 'unreadable' ? { kind: 'broken' } : { kind: 'failed', failure: describeFailure(opened) };
    })().then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [id, shareKey, attempt]);

  const received = () => void countReceived(id);
  // The workspace takes the link from here after a reload, through the sign-in or unlock it may need.
  const bring = () => {
    if (shareKey !== null && holdPending({ id, key: shareKey })) location.reload();
    else setFailure('이 브라우저에서는 가져올 수 없어요. 파일로 받은 뒤 가져와 주세요.');
  };

  return (
    <Screen top={<Brand />} width="narrow">
      {view.kind === 'loading' && <Text variant="note">불러오는 중…</Text>}
      {view.kind === 'failed' && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => setAttempt((held) => held + 1) }}>{view.failure}</Callout>}
      {view.kind === 'held' && <Intro title="멈춘 링크">{SHARE.heldNote}</Intro>}
      {view.kind === 'gone' && <Intro title="없는 링크">{SHARE.goneNote}</Intro>}
      {view.kind === 'broken' && <Intro title="열 수 없는 링크">주소의 # 뒤까지 모두 복사했는지 확인해 주세요.</Intro>}
      {view.kind === 'live' && (
        <Stack gap="section">
          <SharePreview
            source={{ id, operator: false }}
            opened={view.opened}
            first={<Button onClick={bring}>{SHARE.bring}</Button>}
            onDownloaded={received}
            failed={setFailure}
          />
          {failure && <Callout tone="warn" alert>{failure}</Callout>}
          {said && <Callout tone="success">{said}</Callout>}
          <Stack gap="related">
            <Text variant="note">{`${SHARE.received} ${count(view.received)} · 운영자가 검토하지 않은 내용이에요.`}</Text>
            <Row kind="actions">
              <Button variant="link" icon={Flag} onClick={() => setReporting(true)}>
                {SHARE.report}
              </Button>
            </Row>
          </Stack>
        </Stack>
      )}
      {reporting && view.kind === 'live' && shareKey !== null && (
        <ReportDialog
          send={(text) => reportShare(id, text, shareLink(location.origin, id, shareKey), view.version)}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false);
            setSaid('신고를 보냈어요. 운영자가 확인할게요.');
            setAttempt((held) => held + 1);
          }}
        />
      )}
      <LegalNotice />
    </Screen>
  );
}

function ReportDialog({ send, onClose, onSent }: { send: (text: string) => ReturnType<typeof reportShare>; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const { busy, failure, run } = useAttempt();
  const length = text.trim().length;
  const submit = () =>
    run(async () => {
      const sent = await send(text);
      if (!sent.ok) return describeFailure(sent);
      onSent();
      return null;
    });
  return (
    <Dialog
      title={SHARE.report}
      onClose={onClose}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" icon={Send} busy={busy} disabled={length === 0 || length > MAX_REPORT_LENGTH}>
            보내기
          </Button>
        </>
      }
    >
      <TextField
        label="신고 내용"
        lines={4}
        value={text}
        onChange={setText}
        help="운영자가 이 링크를 열어 확인해요. 확인하는 동안 링크가 멈출 수 있어요."
        placeholder="예: 미성년자로 보이는 캐릭터의 성적인 이미지가 있어요."
      />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Dialog>
  );
}
