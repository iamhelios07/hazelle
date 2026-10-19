import { useEffect, useState } from 'react';
import { PULSE_FLOORS, PULSE_ROLES, type PulseAnswer, type PulseBoard, type PulseOrder, type PulseRanking, type PulseRole } from '../../contracts/pulse';
import { readPulse, readPulseWeek } from '../../runtime/pulse';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { LegalNotice } from '../common/LegalNotice';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { PULSE } from '../common/words';
import { Bars, Brand, Callout, ChoiceGroup, Divider, Empty, Facts, Intro, Screen, Ranking, Section, SettingRow, Switch, Tab, Tabs, Text } from '../ui';
import { clockText, hourDetail, hourText, PULSE_ROLE_NAMES, rankRows, weekText } from './board';

type View = { kind: 'loading' } | { kind: 'failed'; failure: string } | { kind: 'read'; answer: PulseAnswer };

const SPLIT = '제공자별로 보기';
const CURRENT = 'current';
const LOADING = <Text variant="note">불러오는 중…</Text>;

// Says what PulseBefore compares (contracts/pulse.ts); change both together.
const RANKING_HELP = {
  current: `이번 주에 ${PULSE_FLOORS.row}명 이상 쓴 모델이 순위에 올라요. 대화는 최근 24시간 동안 응답을 받은 사람이 ${PULSE_FLOORS.row}명 이상이어야 해요. 순위 변동은 대화는 그 전 24시간, 다른 역할은 지난주와 비교해요. 비교할 기간이 다 집계되지 않았거나 쓴 사람이 ${PULSE_FLOORS.board}명이 안 됐으면 표시하지 않아요.`,
  earlier: `그 주에 ${PULSE_FLOORS.row}명 이상 쓴 모델이 순위에 올라요. 순위 변동은 그 전 주와 비교해요. 그 전 주가 다 집계되지 않았거나 쓴 사람이 ${PULSE_FLOORS.board}명이 안 됐으면 표시하지 않아요.`,
};

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
      <Intro title={PULSE.title} />
      {view.kind === 'loading' && LOADING}
      {view.kind === 'failed' && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: retry }}>{view.failure}</Callout>}
      {view.kind === 'read' && <Answer answer={view.answer} />}
      <Divider label="" />
      <LegalNotice />
    </Screen>
  );
}

function Answer({ answer }: { answer: PulseAnswer }) {
  if (!answer.board) return <Empty variant="section">이번 주 집계에 참여한 사람이 {PULSE_FLOORS.board}명이 되면 보여 드려요.</Empty>;
  return <Board board={answer.board} at={answer.at} />;
}

function Board({ board, at }: { board: PulseBoard; at: number }) {
  const [role, setRole] = useState<PulseRole>('chat');
  const [split, setSplit] = useState(false);
  const [week, setWeek] = useState(CURRENT);
  const current = week === CURRENT;
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
      <Section
        title="모델 순위"
        note={!current ? '그 주 쓴 사람 순' : role === 'chat' ? '최근 24시간 응답 순' : '이번 주 쓴 사람 순'}
        help={current ? RANKING_HELP.current : RANKING_HELP.earlier}
        action={
          board.weeks.length > 0 && (
            <ChoiceGroup
              label="기간"
              layout="menu"
              options={[{ value: CURRENT, label: '이번 주' }, ...board.weeks.map((from) => ({ value: String(from), label: weekText(from) }))]}
              value={week}
              onChange={setWeek}
            />
          )
        }
      >
        <Tabs label="역할">
          {PULSE_ROLES.map((each) => (
            <Tab key={each} label={PULSE_ROLE_NAMES[each]} current={role === each} onClick={() => setRole(each)} />
          ))}
        </Tabs>
        <SettingRow label={SPLIT} control={<Switch label={SPLIT} checked={split} onChange={setSplit} />} />
        {current ? (
          <Standing role={role} split={split} ranking={board.ranking[role]} before={board.before[role]} earlier={false} />
        ) : (
          <EarlierWeek key={week} from={Number(week)} role={role} split={split} />
        )}
      </Section>
    </>
  );
}

function EarlierWeek({ from, role, split }: { from: number; role: PulseRole; split: boolean }) {
  const week = useLoaded((signal) => readPulseWeek(from, signal));
  if (week.failure) return <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: week.reload }}>{week.failure}</Callout>;
  if (!week.data) return LOADING;
  return <Standing role={role} split={split} ranking={week.data.ranking[role]} before={week.data.before[role]} earlier />;
}

function Standing({ role, split, ranking, before, earlier }: { role: PulseRole; split: boolean; ranking: PulseRanking; before: PulseOrder | null; earlier: boolean }) {
  const rows = rankRows(ranking, before, split, earlier);
  if (!rows.length) return <Empty variant="section">{earlier ? '순위에 오른 모델이 없었어요.' : '아직 순위에 오른 모델이 없어요.'}</Empty>;
  return <Ranking label={`${PULSE_ROLE_NAMES[role]} 모델 순위`} items={rows} />;
}
