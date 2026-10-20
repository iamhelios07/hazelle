import { Hono } from 'hono';
import { CONNECTOR_MODELS, MODELS_DEV_LISTS } from '../connectors/models-dev';
import {
  PULSE_FLOORS,
  PULSE_ROLES,
  type PulseAnswer,
  type PulseBoard,
  type PulseLabel,
  type PulseOrder,
  type PulsePlace,
  type PulseRanking,
  type PulseRankings,
  type PulseRest,
  type PulseRole,
  type PulseRow,
  type PulseWeek,
} from '../contracts/pulse';
import type { Db } from './db/service-db';
import { DAY_MS, fail, type AppEnv } from './http';

// 헤이젤 나우 (design §6.12): counts what the client labels (worker.ts, calls.ts, streams.ts) and answers the public board.
// The current week and the last 48 hours are lists of who used what (pulse_seen, pulse_used, pulse_replies), counted
// when read; a week once past is closed into its totals (pulse_week*) and its lists deleted. The floors apply where a
// count is shown or closed, never where a call is written.

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// 1970-01-05 00:00 KST, a Monday. Migration 0014 repeats it in SQL.
const MONDAY = 4 * DAY_MS - 9 * HOUR_MS;
const weekOf = (at: number) => at - ((((at - MONDAY) % WEEK_MS) + WEEK_MS) % WEEK_MS);
const hourOf = (at: number) => at - (at % HOUR_MS);
// How often the answer is made at most: a reload costs no read before then, and a moment shows this late.
const MEMO_MS = 5 * 60 * 1000;
const HOURS_KEPT_MS = 2 * DAY_MS;

type Call = Extract<PulseLabel, { kind: 'call' }>;

export type Pulse = {
  seen(account: string): Promise<void>;
  // A call its provider answered 2xx.
  call(account: string, label: Call): Promise<void>;
  answer(): Promise<PulseAnswer>;
  // null for anything but one of the board's weeks.
  week(from: number): Promise<PulseWeek | null>;
};

// key: '' for 기타, a model no list confirms, whose name may carry an organisation or a person.
type Named = { key: string; name: string | null };
const OTHER: Named = { key: '', name: null };
const BUILT_IN = new Map(Object.entries(CONNECTOR_MODELS).map(([type, models]) => [type, new Map<string, string>(models.map(({ id, name }) => [id, name]))]));

// One model, one row across lists: models.dev's names agree up to spelling. Variant words (Thinking, Fast, TEE, Pro)
// stay in the key: one that guessed which variants are the same model would be wrong somewhere.
function named(name: string): Named {
  const spelling = name.replace(/\s*\(latest\)\s*$/i, '').trim();
  return { key: spelling.toLowerCase().replace(/[\s_-]+/g, ' '), name: spelling };
}

async function confirm(db: Db, type: string, model: string): Promise<Named> {
  const listed = BUILT_IN.get(type);
  const list = MODELS_DEV_LISTS[type]?.list;
  const name = listed ? listed.get(model) : list ? await db.prepare('SELECT name FROM models_dev WHERE list = ? AND model = ?').bind(list, model).first<string>('name') : null;
  return name ? named(name) : OTHER;
}

export function openPulse(db: Db, clock: () => number = Date.now): Pulse {
  let memo: { at: number; answer: Promise<PulseAnswer> } | null = null;
  const weeks = new Map<number, Promise<PulseWeek | null>>();
  return {
    seen: async (account) => {
      await db.prepare('INSERT INTO pulse_seen (week, account) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(weekOf(clock()), account).run();
    },
    call: async (account, { role, type, model }) => {
      const { key, name } = await confirm(db, type, model);
      // Read after the await: a call across a week's start lands in the week it ended in.
      const now = clock();
      await db.batch([
        db.prepare('INSERT INTO pulse_hours (hour, role, calls) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET calls = calls + 1').bind(hourOf(now), role),
        db.prepare('INSERT INTO pulse_used (week, role, key, type, account, name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name').bind(weekOf(now), role, key, type, account, name),
        ...(role === 'chat'
          ? [
              db
                .prepare('INSERT INTO pulse_replies (hour, key, type, account, name, replies) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET replies = replies + 1, name = excluded.name')
                .bind(hourOf(now), key, type, account, name),
            ]
          : []),
      ]);
    },
    answer: () => {
      const now = clock();
      if (!memo || now - memo.at >= MEMO_MS) {
        const made = { at: now, answer: (async (): Promise<PulseAnswer> => ({ at: now, board: await board(db, now) }))() };
        made.answer.catch(() => {
          if (memo === made) memo = null;
        });
        memo = made;
      }
      return memo.answer;
    },
    week: (from) => {
      const now = clock();
      if (!Number.isSafeInteger(from) || weekOf(from) !== from || from >= weekOf(now)) return Promise.resolve(null);
      // A past week no longer changes. Only weeks found are kept: any number can be asked.
      const kept = weeks.get(from);
      if (kept) return kept;
      const made = closeWeeks(db, now).then(() => pastWeek(db, from));
      weeks.set(from, made);
      made.then(
        (week) => {
          if (!week) weeks.delete(from);
        },
        () => weeks.delete(from),
      );
      return made;
    },
  };
}

// type: '' for the row merged across connection types.
type WeekRow = { role: PulseRole; key: string; type: string; name: string | null; people: number };
// A week as its totals are kept: what passed the floors only.
type Week = { people: number; roles: Map<PulseRole, number>; models: WeekRow[] };

const mostCounted = (names: Map<string | null, number>) => [...names].reduce<[string | null, number]>((best, each) => (each[1] > best[1] ? each : best), [null, 0])[0];
const add = <K>(map: Map<K, number>, key: K, count: number) => map.set(key, (map.get(key) ?? 0) + count);

// The week's lists counted: each row's spelling is the one most of its people used.
async function countWeek(db: Db, week: number): Promise<Week | null> {
  const [seen, roles, merged, mergedNames, split] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS people FROM pulse_seen WHERE week = ?').bind(week).first<number>('people'),
    db.prepare('SELECT role, COUNT(DISTINCT account) AS people FROM pulse_used WHERE week = ? GROUP BY role').bind(week).all<{ role: PulseRole; people: number }>(),
    db.prepare('SELECT role, key, COUNT(DISTINCT account) AS people FROM pulse_used WHERE week = ? GROUP BY role, key').bind(week).all<Omit<WeekRow, 'type' | 'name'>>(),
    db.prepare('SELECT role, key, name, COUNT(DISTINCT account) AS people FROM pulse_used WHERE week = ? GROUP BY role, key, name ORDER BY name').bind(week).all<Omit<WeekRow, 'type'>>(),
    db.prepare('SELECT role, key, type, name, COUNT(*) AS people FROM pulse_used WHERE week = ? GROUP BY role, key, type, name ORDER BY name').bind(week).all<WeekRow>(),
  ]);
  if (seen! < PULSE_FLOORS.board) return null;
  const names = new Map<string, Map<string | null, number>>();
  const people = new Map<string, number>();
  const vote = (id: string, name: string | null, count: number) => add(names.get(id) ?? names.set(id, new Map()).get(id)!, name, count);
  for (const row of mergedNames.results) vote(`${row.role}\0${row.key}\0`, row.name, row.people);
  for (const row of split.results) {
    vote(`${row.role}\0${row.key}\0${row.type}`, row.name, row.people);
    add(people, `${row.role}\0${row.key}\0${row.type}`, row.people);
  }
  for (const row of merged.results) people.set(`${row.role}\0${row.key}\0`, row.people);
  const models = [...people].flatMap(([id, count]) => {
    const [role, key, type] = id.split('\0') as [PulseRole, string, string];
    return count < PULSE_FLOORS.row ? [] : [{ role, key, type, name: mostCounted(names.get(id)!), people: count }];
  });
  return { people: seen!, roles: new Map(roles.results.filter((row) => row.people >= PULSE_FLOORS.row).map((row) => [row.role, row.people])), models };
}

// null for a week that never passed PULSE_FLOORS.board, whose lists were never shown.
async function keptWeek(db: Db, week: number): Promise<Week | null> {
  const people = await db.prepare('SELECT people FROM pulse_week WHERE week = ?').bind(week).first<number>('people');
  if (people === null) return null;
  const [roles, models] = await Promise.all([
    db.prepare('SELECT role, people FROM pulse_week_roles WHERE week = ?').bind(week).all<{ role: PulseRole; people: number }>(),
    db.prepare('SELECT role, key, type, name, people FROM pulse_week_models WHERE week = ?').bind(week).all<WeekRow>(),
  ]);
  return { people, roles: new Map(roles.results.map((row) => [row.role, row.people])), models: models.results };
}

// Every week before now's: its totals written as it was shown, its lists deleted, in one transaction.
async function closeWeeks(db: Db, now: number) {
  const open = await db.prepare('SELECT week FROM pulse_seen WHERE week < ? UNION SELECT week FROM pulse_used WHERE week < ?').bind(weekOf(now), weekOf(now)).all<{ week: number }>();
  for (const { week } of open.results) {
    const counted = await countWeek(db, week);
    await db.batch([
      ...(counted
        ? [
            db.prepare('INSERT INTO pulse_week (week, people) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(week, counted.people),
            ...[...counted.roles].map(([role, people]) => db.prepare('INSERT INTO pulse_week_roles (week, role, people) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(week, role, people)),
            ...counted.models.map((row) =>
              db.prepare('INSERT INTO pulse_week_models (week, role, key, type, name, people) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(week, row.role, row.key, row.type, row.name, row.people),
            ),
          ]
        : []),
      db.prepare('DELETE FROM pulse_seen WHERE week = ?').bind(week),
      db.prepare('DELETE FROM pulse_used WHERE week = ?').bind(week),
    ]);
  }
}

const rounded = (count: number) => Math.round(count / PULSE_FLOORS.round) * PULSE_FLOORS.round;
const typed = (type: string) => (type ? { type } : {});
const byRole = <T>(made: (role: PulseRole) => T) => Object.fromEntries(PULSE_ROLES.map((role) => [role, made(role)])) as Record<PulseRole, T>;
const ranked = (rows: { count: number; row: PulseRow }[]): PulseRanking => {
  const last = '￿';
  const sorted = rows
    .sort((a, b) => b.count - a.count || (a.row.model ?? last).localeCompare(b.row.model ?? last) || (a.row.type ?? '').localeCompare(b.row.type ?? ''))
    .map(({ row }) => row);
  return { merged: sorted.filter((row) => row.type === undefined), split: sorted.filter((row) => row.type !== undefined) };
};
const place = ({ key, type }: PulseRow): PulsePlace => (type === undefined ? { key } : { key, type });
const places = ({ merged, split }: PulseRanking): PulseOrder => ({ merged: merged.map(place), split: split.map(place) });

const rankWeek = (week: Week): PulseRankings =>
  byRole((role) =>
    ranked(week.models.filter((row) => row.role === role).map(({ key, type, name, people }) => ({ count: people, row: { key, model: name, ...typed(type), share: people / week.roles.get(role)!, people } }))),
  );

type Tally = { replies: number; people: Set<string>; names: Map<string | null, number> };

// The 24 whole hours before now's hour: each hour's calls, and 대화 ranked by its replies. A row needs 5 people in those
// hours and its row in `week`, the week of `now`, whose people it shows.
async function chatDay(db: Db, now: number, week: Week): Promise<{ hours: { at: number; calls: Record<PulseRole, number> }[]; ranking: PulseRanking }> {
  const until = hourOf(now);
  const since = until - DAY_MS;
  const [calls, replies] = await Promise.all([
    db.prepare('SELECT hour, role, calls FROM pulse_hours WHERE hour >= ? AND hour < ?').bind(since, until).all<{ hour: number; role: PulseRole; calls: number }>(),
    db.prepare('SELECT key, type, account, name, replies FROM pulse_replies WHERE hour >= ? AND hour < ?').bind(since, until).all<{ key: string; type: string; account: string; name: string | null; replies: number }>(),
  ]);
  const callsAt = new Map(calls.results.map((row) => [`${row.hour}\0${row.role}`, row.calls]));
  const hours = Array.from({ length: 24 }, (_, index) => {
    const at = since + index * HOUR_MS;
    return { at, calls: byRole((role) => callsAt.get(`${at}\0${role}`) ?? 0) };
  });
  const chatCalls = hours.reduce((sum, hour) => sum + hour.calls.chat, 0);
  const tallies = new Map<string, Tally>();
  for (const row of replies.results) {
    for (const id of [`${row.key}\0`, `${row.key}\0${row.type}`]) {
      const tally = tallies.get(id) ?? tallies.set(id, { replies: 0, people: new Set(), names: new Map() }).get(id)!;
      tally.replies += row.replies;
      tally.people.add(row.account);
      add(tally.names, row.name, row.replies);
    }
  }
  const peopleOf = new Map(week.models.filter((row) => row.role === 'chat').map((row) => [`${row.key}\0${row.type}`, row.people]));
  const shown = [...tallies].flatMap(([id, tally]) => {
    const people = peopleOf.get(id);
    if (people === undefined || tally.people.size < PULSE_FLOORS.row) return [];
    const [key, type] = id.split('\0') as [string, string];
    return [{ count: tally.replies, row: { key, model: mostCounted(tally.names), ...typed(type), share: tally.replies / chatCalls, people, replies: rounded(tally.replies) } }];
  });
  const rest = (split: boolean): PulseRest => {
    const count = chatCalls - shown.reduce((sum, each) => ((each.row.type !== undefined) === split ? sum + each.count : sum), 0);
    return { share: chatCalls ? count / chatCalls : 0, replies: rounded(count) };
  };
  return { hours, ranking: { ...ranked(shown), rest: { merged: rest(false), split: rest(true) } } };
}

async function board(db: Db, now: number): Promise<PulseBoard | null> {
  await closeWeeks(db, now);
  const from = weekOf(now);
  const current = await countWeek(db, from);
  if (!current) return null;
  const [lastWeek, weeks] = await Promise.all([keptWeek(db, from - WEEK_MS), db.prepare('SELECT week FROM pulse_week WHERE week < ? ORDER BY week DESC').bind(from).all<{ week: number }>()]);
  // On a Monday the day before reaches into last week, whose people a 대화 row shows: none where it was never shown.
  const weekBefore = weekOf(now - DAY_MS) === from ? current : lastWeek;
  const lastRanking = lastWeek && rankWeek(lastWeek);
  const [day, dayBefore] = await Promise.all([chatDay(db, now, current), weekBefore && chatDay(db, now - DAY_MS, weekBefore)]);
  return {
    week: { from, people: current.people },
    replies: rounded(day.hours.reduce((sum, hour) => sum + hour.calls.chat, 0)),
    hours: day.hours.map(({ at, calls }) => ({ at, calls: byRole((role) => rounded(calls[role])) })),
    // The board's 대화 is the day's replies; the week's people rank it only once the week is past.
    ranking: { ...rankWeek(current), chat: day.ranking },
    before: { ...byRole((role) => lastRanking && places(lastRanking[role])), chat: dayBefore && places(dayBefore.ranking) },
    weeks: weeks.results.map((row) => row.week),
  };
}

async function pastWeek(db: Db, from: number): Promise<PulseWeek | null> {
  const [week, prior] = await Promise.all([keptWeek(db, from), keptWeek(db, from - WEEK_MS)]);
  const priorRanking = prior && rankWeek(prior);
  return week && { from, people: week.people, ranking: rankWeek(week), before: byRole((role) => priorRanking && places(priorRanking[role])) };
}

// Hourly: past weeks closed, and hours gone by hour boundary, so the board's 대화 before reads
// [hourOf(now) - 2 days, hourOf(now) - 1 day) whole.
export async function forgetPulse(db: Db, now = Date.now()) {
  await closeWeeks(db, now);
  await db.batch(['pulse_hours', 'pulse_replies'].map((table) => db.prepare(`DELETE FROM ${table} WHERE hour < ?`).bind(hourOf(now) - HOURS_KEPT_MS)));
}

const WEEK_CACHE_SECONDS = 24 * 60 * 60;
export const pulse = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.env.pulse.answer(), 200, { 'cache-control': `public, max-age=${MEMO_MS / 1000}` }))
  .get('/weeks/:from', async (c) => {
    const found = await c.env.pulse.week(Number(c.req.param('from')));
    return found ? c.json(found, 200, { 'cache-control': `public, max-age=${WEEK_CACHE_SECONDS}` }) : fail(c, 404, 'not-found');
  });
