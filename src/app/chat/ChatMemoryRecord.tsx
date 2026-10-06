import type { MemoryRecord } from '../../model/memory';
import type { Staleness } from '../../engine/memory';
import { editRecord, forgetRecord, pinRecord, restoreRecord, type RecordPatch, type RecordStatus } from '../../runtime/memory';
import { EntryList } from '../common/EntryList';
import { ago } from '../common/time';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, NavBar, PhraseField, Row, Section, SettingGroup, SettingRow, SidePanel, Stack, Switch, Text, TextField, useWide } from '../ui';
import { spanOf } from './memory';
import type { ChatActions } from './useChat';

type Props = {
  chat: string;
  record: MemoryRecord;
  // null while the panel's view is being worked out.
  status: RecordStatus | null;
  // A record the user edited or pinned is still sent while stale.
  stale: Staleness | null;
  positions: ReadonlyMap<string, number>;
  actions: ChatActions;
};

export function ChatMemoryRecord({ chat, record, status, stale, positions, actions }: Props) {
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const wide = useWide();
  const save = useAutosave<RecordPatch>(`record:${chat}:${record.id}`, (patch) => editRecord(store, chat, record.id, patch));
  const shown = { ...record, ...save.unsaved };
  const span = spanOf(record.sources, positions);
  const back = () => actions.memory(null);
  const change = (patch: RecordPatch) => save.change(patch);

  // A narrow panel covers the story, so it steps aside for the messages it points at.
  function find() {
    actions.find(span.there);
    if (!wide) actions.closePanel();
  }

  function rebuild() {
    session.memory.rebuild(chat, record.id);
    toast.show('기록 다시 만드는 중…');
  }

  function pin(on: boolean) {
    void pinRecord(store, chat, record.id, on).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));
  }

  async function forget() {
    const done = await save.remove(() => forgetRecord(store, chat, record.id));
    if (!done) return;
    if (!done.ok) return toast.failed(done, '삭제하지 못했어요.');
    back();
    toast.undoable('기록을 삭제했어요', () => void restoreRecord(store, chat, done.data).then((restored) => restored.ok || toast.failed(restored, '되돌리지 못했어요.')));
  }

  const text = (field: 'when' | 'where', label: string) => (
    <TextField label={label} value={shown[field] ?? ''} placeholder="이야기에 나오지 않음" onChange={(value) => change({ [field]: value === '' ? null : value })} />
  );

  return (
    <SidePanel
      title="장기 기억"
      top={<NavBar title="기록" subtitle={span.words} backLabel="장기 기억" onBack={back} status={save.status ? SAVE_STATUS[save.status] : undefined} />}
      page={record.id}
      onClose={actions.closePanel}
    >
      {stale && !record.forgotten && (
        <Callout tone="warn" action={stale === 'changed' ? { label: '원문에서 다시 만들기', onClick: rebuild } : undefined}>
          {`${stale === 'changed' ? '원문이 바뀌었어요.' : '원문 메시지가 삭제됐어요.'} ${status === 'stale' ? '이 기록은 보내지 않아요.' : '수정했거나 고정한 기록이라 계속 보내요.'}`}
        </Callout>
      )}
      {status === 'over' && <Text variant="note">한도를 넘어 보내지 않아요.</Text>}
      {record.forgotten && (
        <Callout tone="warn" action={{ label: '원문에서 다시 만들기', onClick: rebuild }}>
          삭제한 기록이에요.
        </Callout>
      )}
      <Row kind="actions">
        <Button variant="secondary" size="sm" disabled={span.there.length === 0} onClick={find}>
          원문 보기
        </Button>
        {!record.forgotten && (
          <Button variant="secondary" size="sm" onClick={rebuild}>
            원문에서 다시 만들기
          </Button>
        )}
      </Row>
      <TextField label="무슨 일" lines={5} value={shown.what} onChange={(what) => change({ what })} />
      {text('when', '언제')}
      {text('where', '어디서')}
      <SettingGroup label="기록">
        <SettingRow label="누가" wide control={<PhraseField label="누가" phrases={shown.who} onChange={(who) => change({ who })} />} />
        <SettingRow
          label="고정"
          help="원문이 바뀌어도 다른 기록보다 먼저 보내요."
          control={<Switch label="고정" checked={record.pinned === true} onChange={pin} />}
        />
      </SettingGroup>
      <Section level={3} title="대사" note={`${shown.lines.length}개`}>
        <Stack gap="related">
          <EntryList
            entries={shown.lines}
            onChange={(lines) => change({ lines })}
            name={(index) => `대사 ${index + 1}`}
            blank={{ speaker: '', text: '' }}
            addLabel="대사 추가"
            removed={(index) => `${index + 1}번째 대사를 삭제했어요.`}
          >
            {({ value, name, set, remove }) => (
              <Stack gap="related">
                <TextField label={`${name} · 말한 사람`} value={value.speaker} onChange={(speaker) => set({ ...value, speaker })} action={remove} />
                <TextField label={name} lines={2} value={value.text} onChange={(said) => set({ ...value, text: said })} />
              </Stack>
            )}
          </EntryList>
        </Stack>
      </Section>
      <TextField label="결과" lines={3} value={shown.outcome} onChange={(outcome) => change({ outcome })} />
      <Text variant="note">{record.receipt ? `${record.receipt.modelName} · ${ago(record.at)} 정리` : `직접 쓴 기록 · ${ago(record.at)}`}</Text>
      {!record.forgotten && (
        <Row kind="actions">
          <Button variant="danger" size="sm" onClick={() => void forget()}>
            이 기록 삭제
          </Button>
        </Row>
      )}
    </SidePanel>
  );
}
