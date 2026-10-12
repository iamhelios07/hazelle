import { useEffect, useMemo, useState } from 'react';
import { usageReport, type ModelUsage, type ReportWindow, type UsageGroup, type UsageHeld } from '../../model/chat';
import { ACTS } from '../common/acts';
import { count } from '../common/typedNumber';
import { spent, tally } from '../common/usage';
import { NO_CHARACTER, PAGES } from '../common/words';
import { useLibrary, useSession, useSummaries } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Bars, Button, Callout, Empty, Facts, NavBar, Screen, Section, Shares, Tab, Tabs, Text } from '../ui';

const WINDOWS: [ReportWindow, string][] = [['today', '오늘'], ['week', '이번 주'], ['month', '이번 달'], ['all', '전체']];
const CHATS_SHOWN = 10;
// A chat already read since the last change takes no time, so the count moves by steps rather than one render a chat,
// and a read of fewer chats is too short to count.
const PROGRESS_STEP = 50;

const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const month = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' });

const brief = (usage: ModelUsage) => (usage.costs.length ? `${count(usage.calls)}번 · ${spent(usage)}` : `${count(usage.calls)}번`);

// groups: busiest first, as the report sorts them.
const shares = <G extends UsageGroup<unknown>>(groups: G[], name: (group: G) => string) => {
  const most = groups[0]?.usage.calls ?? 0;
  return groups.map((group) => ({ key: String(group.key), label: name(group), value: brief(group.usage), share: most ? group.usage.calls / most : 0 }));
};

export function UsageScreen({ back }: { back: Back | null }) {
  const { usage: usageIndex } = useSession();
  const library = useLibrary();
  const summaries = useSummaries();
  const [window, setWindow] = useState<ReportWindow>('month');
  const [attempt, setAttempt] = useState(0);
  const recount = () => setAttempt((held) => held + 1);
  const [held, setHeld] = useState<UsageHeld[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<{ read: number; of: number } | null>(null);
  const [allChats, setAllChats] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setHeld(null);
    setFailed(false);
    setProgress(null);
    void usageIndex.read((read) => read, abort.signal, (read, of) => of > PROGRESS_STEP && read % PROGRESS_STEP === 0 && setProgress({ read, of })).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) setHeld(result.data);
      else setFailed(true);
    });
    return () => abort.abort();
  }, [usageIndex, attempt]);
  const report = useMemo(() => held && usageReport(held, window, Date.now()), [held, window]);
  const titles = useMemo(() => new Map(summaries.map(({ parent, value }) => [parent, value.title])), [summaries]);
  const characterName = (id: string | null) => (id === null ? NO_CHARACTER : (library.byCharacter.get(id)?.character.card.name ?? '삭제된 캐릭터'));
  const total = report?.total;
  const chats = report?.chats ?? [];

  return (
    <Screen width="form" top={<NavBar title={PAGES.usage} {...backBar(back)} />}>
      <Tabs label="기간">
        {WINDOWS.map(([each, label]) => <Tab key={each} label={label} current={window === each} onClick={() => setWindow(each)} />)}
      </Tabs>
      <Section title="합계" note="남아 있는 채팅 기준" action={<Button variant="secondary" size="sm" onClick={recount}>다시 집계</Button>}>
        {failed ? (
          <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: recount }}>
            사용량을 불러오지 못했어요.
          </Callout>
        ) : !total ? (
          <Text variant="note">{progress ? `채팅 ${count(progress.of)}개 중 ${count(progress.read)}개 확인함…` : '사용량을 확인하는 중…'}</Text>
        ) : total.calls ? (
          <Facts
            variant="tiles"
            items={[
              { label: '응답', value: `${count(total.calls)}번` },
              { label: '입력 토큰', value: tally(total.input, total.calls) },
              { label: '출력 토큰', value: tally(total.output, total.calls) },
              { label: '비용', value: spent(total) },
            ]}
          />
        ) : (
          <Empty variant="section">이 기간에 받은 응답이 없어요.</Empty>
        )}
      </Section>
      {report && total!.calls > 0 && (
        <>
          {window !== 'today' && (
            <Section title={window === 'all' ? '월별' : '날짜별'}>
              <Bars label={window === 'all' ? '월별 응답' : '날짜별 응답'} bars={report.periods.map(({ key, usage }) => ({ label: (window === 'all' ? month : day).format(key), value: usage.calls, detail: brief(usage) }))} />
            </Section>
          )}
          <Section title="모델">
            <Shares items={shares(report.models, ({ modelName, source }) => `${modelName} · ${source}`)} />
          </Section>
          <Section title="캐릭터">
            <Shares items={shares(report.characters, ({ key }) => characterName(key))} />
          </Section>
          {chats.length > 0 && (
            <Section title="채팅" action={chats.length > CHATS_SHOWN ? <Button variant="secondary" size="sm" onClick={() => setAllChats((open) => !open)}>{allChats ? '접기' : `모두 보기 (${count(chats.length)})`}</Button> : undefined}>
              <Shares items={shares(allChats ? chats : chats.slice(0, CHATS_SHOWN), ({ key }) => titles.get(key) ?? '새 채팅')} />
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
