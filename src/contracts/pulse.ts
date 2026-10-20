// 헤이젤 나우 (design §6.12): the label a client adds to requests it already sends, and the public board's answer.
// The server counts only labelled requests; it infers nothing from traffic.

// The page's address and name, which the server also writes into the page's link preview (server/static.ts).
export const PULSE_PAGE = { path: '/now', title: '헤이젤 나우' } as const;

export const PULSE_ROLES = ['chat', 'aux', 'image', 'embedding'] as const;
export type PulseRole = (typeof PULSE_ROLES)[number];

// The connection type a generic connection (an OpenAI-compatible address or reverse proxy) is labelled with: shown as
// 직접 연결, its models always 기타. Never its address.
export const DIRECT_TYPE = 'direct';

// seen: the page-load mark, which counts the account active and nothing else. A call names its role, its connection
// type and the model id it asked for; the server names the model only when a list it holds confirms it.
export type PulseLabel = { kind: 'seen' } | { kind: 'call'; role: PulseRole; type: string; model: string };

const TYPE = /^[a-z0-9-]{1,40}$/;
const MODEL_MOST = 200;

export function pulseHeader(label: PulseLabel): string {
  return label.kind === 'seen' ? 'seen' : `${label.role} ${label.type} ${encodeURIComponent(label.model)}`;
}

// null for anything a client of this release does not send.
export function readPulseHeader(value: string | undefined | null): PulseLabel | null {
  if (value === 'seen') return { kind: 'seen' };
  const [role, type, encoded, ...rest] = value?.split(' ') ?? [];
  if (rest.length || !PULSE_ROLES.includes(role as PulseRole) || !type || !TYPE.test(type) || !encoded) return null;
  let model: string;
  try {
    model = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return model && model.length <= MODEL_MOST ? { kind: 'call', role: role as PulseRole, type, model } : null;
}

// A weekly model row shows only with at least `row` distinct people that week (a 대화 row: replied to in the last 24
// hours); the whole board hides below `board` people sharing that week. Counts of calls round to `round`.
export const PULSE_FLOORS = { row: 5, board: 10, round: 10 } as const;

// One ranking row. key: the server's one name for the model across spellings and periods, '' for 기타; a row is the same
// row in another period by key and type, never by model, whose spelling can change. model: the confirmed name in the
// spelling most counted, null for 기타. type: the connection type,
// present only in the split view (제공자별로 보기). share: of the role's total in the same window, 0 to 1. people:
// that week's distinct people on the row. replies: the board's 대화 only, replies received in the last 24 hours, rounded.
export type PulseRow = { key: string; model: string | null; type?: string; share: number; people: number; replies?: number };

// rest: the board's 대화 only, the replies of rows below the floor in each view, so the shares there add up to the
// whole. It names no model and counts no people: neither is ever written for those rows.
export type PulseRest = { share: number; replies: number };
export type PulseRanking = { merged: PulseRow[]; split: PulseRow[]; rest?: { merged: PulseRest; split: PulseRest } };
export type PulseRankings = Record<PulseRole, PulseRanking>;

// Who stood where a period earlier, for the rank change marks: the same rows in the same order, nothing else.
export type PulsePlace = Pick<PulseRow, 'key' | 'type'>;
export type PulseOrder = { merged: PulsePlace[]; split: PulsePlace[] };
// A role is null where its earlier period was not counted whole (대화: the 24 hours before reach back past the start;
// the rest: last week did not pass PULSE_FLOORS.board), so no mark compares against a list that was never shown.
export type PulseBefore = Record<PulseRole, PulseOrder | null>;

// hours: the last 24 whole hours, oldest first, each hour's calls per role (rounded); at is the hour's start.
// week.from: the start of the counting week (Monday 00:00 KST). before: 대화 the 24 hours before, the other roles last
// week. weeks: the earlier weeks that passed PULSE_FLOORS.board, newest first, each read as a PulseWeek.
export type PulseBoard = {
  week: { from: number; people: number };
  replies: number;
  hours: { at: number; calls: Record<PulseRole, number> }[];
  ranking: PulseRankings;
  before: PulseBefore;
  weeks: number[];
};

// board: null while fewer than PULSE_FLOORS.board people share this week. at: when this answer was made; the server refreshes it every few minutes.
export type PulseAnswer = { at: number; board: PulseBoard | null };

// An earlier week (GET /api/pulse/weeks/:from), every role ranked by that week's people, 대화 too: its replies are kept
// only 48 hours, so its share is people over the role's people, not the board's replies. before: the week before it.
export type PulseWeek = { from: number; people: number; ranking: PulseRankings; before: PulseBefore };
