import { useEffect, useState } from 'react';
import { PULSE_FLOORS, PULSE_ROLES, type PulseAnswer, type PulseBoard, type PulseRole } from '../../contracts/pulse';
import { readPulse } from '../../runtime/pulse';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { LegalNotice } from '../common/LegalNotice';
import { count } from '../common/typedNumber';
import { inSettings, PULSE } from '../common/words';
import { Bars, Brand, Callout, Divider, Empty, Facts, Intro, Screen, Section, SettingRow, Switch, Tab, Table, Tabs, Text, type TableColumn } from '../ui';
import { clockText, hourDetail, hourText, PULSE_ROLE_NAMES, rankRows, startsText } from './board';

type View = { kind: 'loading' } | { kind: 'failed'; failure: string } | { kind: 'read'; answer: PulseAnswer };

const SPLIT = '제공자별로 보기';

// main.tsx asks before the account flow, as for /terms: the page reads the same signed in or out.
export function pulsePage(path: string) {
  return path === PULSE.path ? <PulsePage /> : null;
}

function PulsePage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void readPulse(abort.signal).then((read) => {
      if (!abort.signal.aborted) setView(read.ok ? { kind: 'read', answer: read.data } : { kind: 'failed', failure: describeFailure(read) });
    });
    return () => abort.abort();
  }, [attempt]);

  const retry = () => {
    setView({ kind: 'loading' });
    setAttempt((held) => held + 1);
  };

  return (
    <Screen width="form" top={<Brand />}>
      <Intro title={PULSE.title}>집계에 참여한 사람의 사용량만 담아요. 참여는 {inSettings('account')} › 앱 정보에서 바꿀 수 있어요.</Intro>
      {view.kind === 'loading' && <Text variant="note">불러오는 중…</Text>}
      {view.kind === 'failed' && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: retry }}>{view.failure}</Callout>}
      {view.kind === 'read' && <Answer answer={view.answer} />}
      <Divider label="" />
      <LegalNotice />
    </Screen>
  );
}

function Answer({ answer }: { answer: PulseAnswer }) {
  // Ruled (design §6.12): counting starts a day after the notice; this branch goes once that date has passed.
  if (answer.at < answer.starts) return <Empty variant="section">{startsText(answer.starts)}부터 집계를 시작해요.</Empty>;
  if (!answer.board) return <Empty variant="section">이번 주 집계에 참여한 사람이 {PULSE_FLOORS.board}명이 되면 보여 드려요.</Empty>;
  return <Board board={answer.board} at={answer.at} />;
}

function Board({ board, at }: { board: PulseBoard; at: number }) {
  const [role, setRole] = useState<PulseRole>('chat');
  const [split, setSplit] = useState(false);
  const rows = rankRows(board.ranking[role], split);
  const chat = role === 'chat';
  const columns: TableColumn[] = [
    { label: '모델', size: 'name' },
    ...(split ? [{ label: '제공자', size: 'fill' } as const] : []),
    ...(chat ? [{ label: '응답', size: 'figure' } as const] : []),
    { label: '비율', size: 'figure' },
    { label: '사람', size: 'figure' },
  ];
  return (
    <>
      <Facts
        variant="figures"
        items={[
          { label: '최근 24시간 응답', value: `${count(board.replies)}번` },
          { label: '이번 주 쓴 사람', value: `${count(board.week.people)}명` },
        ]}
      />
      <Section title="시간별 응답" note={`${clockText(at)} 기준`}>
        <Bars label="시간별 응답" bars={board.hours.map((hour) => ({ label: hourText(hour.at), value: hour.calls.chat, detail: hourDetail(hour.calls) }))} />
      </Section>
      <Section title="모델 순위" note={chat ? '최근 24시간 응답 순' : '이번 주 쓴 사람 순'}>
        <Tabs label="역할">
          {PULSE_ROLES.map((each) => (
            <Tab key={each} label={PULSE_ROLE_NAMES[each]} current={role === each} onClick={() => setRole(each)} />
          ))}
        </Tabs>
        <SettingRow label={SPLIT} control={<Switch label={SPLIT} checked={split} onChange={setSplit} />} />
        {rows.length ? (
          <Table
            label={`${PULSE_ROLE_NAMES[role]} 모델 순위`}
            columns={columns}
            rows={rows.map((row) => {
              const facts = [...(split ? [row.provider] : []), ...(chat ? [row.replies] : []), row.share, row.people];
              return { key: String(row.rank), cells: [`${row.rank}. ${row.model}`, ...facts], summary: facts.filter(Boolean).join(' · ') };
            })}
          />
        ) : (
          <Empty variant="section">아직 순위에 오른 모델이 없어요.</Empty>
        )}
      </Section>
    </>
  );
}
