import { readVisits } from '../../runtime/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Button, Panel, Table, type TableColumn } from '../ui';

const GUESTS = '응답 받은 손님';
const COLUMNS: TableColumn[] = [
  { label: '날짜', track: 'fill' },
  { label: '방문자', track: 'figure' },
  { label: GUESTS, track: 'figure' },
  { label: '새 계정', track: 'figure' },
  { label: '그중 손님에서', track: 'figure' },
];
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export function VisitsSection() {
  const loaded = useLoaded(readVisits);
  return (
    <Panel title="방문자 통계" note="최근 14일 · 한국 시간" action={<Button variant="ghost" onClick={loaded.reload}>새로고침</Button>}>
      {loaded.loading}
      {loaded.failure}
      {loaded.data && <Table label="방문자 통계" columns={COLUMNS} rows={loaded.data.days.map((day) => ({
        key: String(day.day),
        summary: `방문자 ${count(day.visitors)} · ${GUESTS} ${count(day.guests)} · 새 계정 ${count(day.accounts)} · 그중 손님에서 ${count(day.converted)}`,
        cells: [date.format(day.day), count(day.visitors), count(day.guests), count(day.accounts), count(day.converted)],
      }))} />}
    </Panel>
  );
}
