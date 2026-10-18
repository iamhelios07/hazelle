import { CONNECTION_TYPES } from '../../connectors/registry';
import { DIRECT_TYPE, PULSE_ROLES, type PulseRanking, type PulseRole } from '../../contracts/pulse';
import { count } from '../common/typedNumber';
import type { Ranked } from '../ui';
import { DIRECT_CONNECTION, ROLE_TAGS } from '../common/words';

export const PULSE_ROLE_NAMES: Record<PulseRole, string> = { chat: ROLE_TAGS.main, aux: ROLE_TAGS.aux, image: '이미지', embedding: ROLE_TAGS.embed };

// null: a type this build does not list, which a newer client may label; its row is left out rather than named wrong.
export function providerName(type: string): string | null {
  if (type === DIRECT_TYPE) return DIRECT_CONNECTION;
  return CONNECTION_TYPES.find((each) => each.id === type)?.label ?? null;
}

// The server counts its week from Monday 00:00 KST, so the page tells every time in KST whatever the viewer's zone.
const KST = 'Asia/Seoul';
const startFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric' });
const hourFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: 'numeric' });
const clockFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: 'numeric', minute: '2-digit' });
export const startsText = (at: number) => startFormat.format(at);
export const hourText = (at: number) => hourFormat.format(at);
export const clockText = (at: number) => clockFormat.format(at);

export const hourDetail = (calls: Record<PulseRole, number>) =>
  PULSE_ROLES.filter((role) => role === 'chat' || calls[role] > 0)
    .map((role) => `${role === 'chat' ? '응답' : PULSE_ROLE_NAMES[role]} ${count(calls[role])}번`)
    .join(' · ');

export const percent = (share: number) => (share > 0 && share < 0.005 ? '1% 미만' : `${Math.round(share * 100)}%`);

// The server ranks 기타 by its count among the models; here it holds no place and goes last, so a pool never takes a medal.
// A split row whose provider this build cannot name is left out, and places run without gaps.
export function rankRows(ranking: PulseRanking, split: boolean): Ranked[] {
  const shown = split
    ? ranking.split.flatMap((row) => {
        const provider = row.type === undefined ? null : providerName(row.type);
        return provider === null ? [] : [{ row, provider }];
      })
    : ranking.merged.map((row) => ({ row, provider: null }));
  const rows = [...shown.filter(({ row }) => row.model !== null), ...shown.filter(({ row }) => row.model === null)];
  const largest = Math.max(0, ...rows.map(({ row }) => row.share));
  return rows.map(({ row, provider }, index) => ({
    key: `${row.key}\0${row.type ?? ''}`,
    rank: row.model === null ? null : index + 1,
    name: row.model ?? '기타',
    detail: [provider, row.replies === undefined ? null : `응답 ${count(row.replies)}번`, `이번 주 ${count(row.people)}명`].filter(Boolean).join(' · '),
    value: percent(row.share),
    share: largest ? row.share / largest : 0,
  }));
}
