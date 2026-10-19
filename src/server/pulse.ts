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
  type PulseRole,
  type PulseRow,
  type PulseWeek,
} from '../contracts/pulse';
import type { Db, Statement } from './db/service-db';
import { DAY_MS, fail, type AppEnv } from './http';

// 헤이젤 나우 (design §6.12): counts what the client labels (worker.ts, calls.ts, streams.ts) and answers the public board.

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// 1970-01-05 00:00 KST, a Monday.
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

// Who counted toward a row, in memory only, never written or shown (as the relay quotas, limits.ts). stored: the people
// last written, so a row is written only as it grows; replies: an hour's 대화 replies, of which stored are written.
type Group = { people: Set<string>; names: Map<string, number>; stored: number };
type Hour = Group & { replies: number };
const group = (): Group => ({ people: new Set(), names: new Map(), stored: 0 });
const entryIn = <K, V>(map: Map<K, V>, id: K, made: () => V): V => {
  const found = map.get(id);
  if (found) return found;
  const fresh = made();
  map.set(id, fresh);
  return fresh;
};
// A restart empties the sets and the stored row keeps its count, so a row can only lag behind, never pass its people.
const grown = (into: Group, account: string, floor: number) => {
  into.people.add(account);
  if (into.people.size < floor || into.people.size <= into.stored) return false;
  into.stored = into.people.size;
  return true;
};
const spellingOf = (names: Map<string, number>) => [...names].reduce<[string | null, number]>((best, each) => (each[1] > best[1] ? each : best), [null, 0])[0];

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

export async function openPulse(db: Db, clock: () => number = Date.now): Promise<Pulse> {
  let week = { from: -1, active: group(), roles: new Map<string, Group>(), models: new Map<string, Group>() };
  const thisWeek = (now: number) => {
    const from = weekOf(now);
    if (week.from !== from) week = { from, active: group(), roles: new Map(), models: new Map() };
    return week;
  };
  // By hour start, the last 24 hours' 대화 replies per model; a model's are written while it has PULSE_FLOORS.row people
  // across those hours.
  const hours = new Map<number, Map<string, Hour>>();

  const replied = (account: string, { key, name }: Named, type: string, now: number): Statement[] => {
    const hour = hourOf(now);
    for (const at of hours.keys()) if (at <= hour - DAY_MS) hours.delete(at);
    const bucket = entryIn(hours, hour, () => new Map<string, Hour>());
    const writes: Statement[] = [];
    for (const split of ['', type]) {
      const id = `${key}\0${split}`;
      const tally = entryIn(bucket, id, () => ({ ...group(), replies: 0 }));
      tally.people.add(account);
      tally.replies++;
      if (name) tally.names.set(name, (tally.names.get(name) ?? 0) + 1);
      const people = new Set([...hours.values()].flatMap((each) => [...(each.get(id)?.people ?? [])]));
      if (people.size < PULSE_FLOORS.row) continue;
      for (const [at, each] of hours) {
        const held = each.get(id);
        if (!held || held.replies === held.stored) continue;
        writes.push(
          db
            .prepare('INSERT INTO pulse_hour_replies (hour, key, type, name, replies) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET replies = replies + excluded.replies, name = excluded.name')
            .bind(at, key, split, spellingOf(held.names), held.replies - held.stored),
        );
        held.stored = held.replies;
      }
    }
    return writes;
  };

  let memo: { at: number; answer: Promise<PulseAnswer> } | null = null;
  const weeks = new Map<number, Promise<PulseWeek | null>>();
  return {
    seen: async (account) => {
      const { from, active } = thisWeek(clock());
      if (grown(active, account, PULSE_FLOORS.board)) await db.prepare('INSERT INTO pulse_week (week, people) VALUES (?, ?) ON CONFLICT DO UPDATE SET people = max(people, excluded.people)').bind(from, active.stored).run();
    },
    call: async (account, { role, type, model }) => {
      const confirmed = await confirm(db, type, model);
      const { key, name } = confirmed;
      // Read after the await, beside the sets it changes: two calls across a week's start never swap the week back.
      const now = clock();
      const current = thisWeek(now);
      const writes = [db.prepare('INSERT INTO pulse_hours (hour, role, calls) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET calls = calls + 1').bind(hourOf(now), role)];
      // 대화's too, though the board shares it by replies: a past week shares it by people (pastWeek).
      const total = entryIn(current.roles, role, group);
      if (grown(total, account, PULSE_FLOORS.row)) {
        writes.push(db.prepare('INSERT INTO pulse_week_roles (week, role, people) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET people = max(people, excluded.people)').bind(current.from, role, total.stored));
      }
      for (const split of ['', type]) {
        const row = entryIn(current.models, `${role}\0${key}\0${split}`, group);
        if (name) row.names.set(name, (row.names.get(name) ?? 0) + 1);
        if (!grown(row, account, PULSE_FLOORS.row)) continue;
        writes.push(
          db
            .prepare('INSERT INTO pulse_week_models (week, role, key, type, name, people) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET people = max(people, excluded.people), name = excluded.name')
            .bind(current.from, role, key, split, spellingOf(row.names), row.stored),
        );
      }
      if (role === 'chat') writes.push(...replied(account, confirmed, type, now));
      await db.batch(writes);
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
      if (!Number.isSafeInteger(from) || weekOf(from) !== from || from >= weekOf(clock())) return Promise.resolve(null);
      // A past week no longer changes. Only weeks found are kept: any number can be asked.
      const kept = weeks.get(from);
      if (kept) return kept;
      const made = pastWeek(db, from);
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

type WeekRow = { role: PulseRole; key: string; type: string; name: string | null; people: number };
type ReplyRow = { key: string; type: string; name: string | null; replies: number };
const rounded = (count: number) => Math.round(count / PULSE_FLOORS.round) * PULSE_FLOORS.round;
const typed = (type: string) => (type ? { type } : {});
const byRole = <T>(made: (role: PulseRole) => T) => Object.fromEntries(PULSE_ROLES.map((role) => [role, made(role)])) as Record<PulseRole, T>;
const ranked = (rows: { count: number; row: PulseRow }[]): PulseRanking => {
  const last = '\uffff';
  const sorted = rows
    .sort((a, b) => b.count - a.count || (a.row.model ?? last).localeCompare(b.row.model ?? last) || (a.row.type ?? '').localeCompare(b.row.type ?? ''))
    .map(({ row }) => row);
  return { merged: sorted.filter((row) => row.type === undefined), split: sorted.filter((row) => row.type !== undefined) };
};
const place = ({ key, type }: PulseRow): PulsePlace => (type === undefined ? { key } : { key, type });
const places = ({ merged, split }: PulseRanking): PulseOrder => ({ merged: merged.map(place), split: split.map(place) });

// Stored rows passed their floors when written, so the board reads only the database: a restart hides nothing it showed.
// The 24 whole hours before now's hour: each hour's calls, and 대화 ranked by its replies.
async function chatDay(db: Db, now: number): Promise<{ hours: { at: number; calls: Record<PulseRole, number> }[]; ranking: PulseRanking }> {
  const until = hourOf(now);
  const since = until - DAY_MS;
  const [calls, weekRows, replies] = await Promise.all([
    db.prepare('SELECT hour, role, calls FROM pulse_hours WHERE hour >= ? AND hour < ?').bind(since, until).all<{ hour: number; role: PulseRole; calls: number }>(),
    db.prepare("SELECT key, type, people FROM pulse_week_models WHERE week = ? AND role = 'chat'").bind(weekOf(now)).all<{ key: string; type: string; people: number }>(),
    db.prepare('SELECT key, type, name, replies FROM pulse_hour_replies WHERE hour >= ? AND hour < ? ORDER BY replies DESC').bind(since, until).all<ReplyRow>(),
  ]);
  const callsAt = new Map(calls.results.map((row) => [`${row.hour}\0${row.role}`, row.calls]));
  const hours = Array.from({ length: 24 }, (_, index) => {
    const at = since + index * HOUR_MS;
    return { at, calls: byRole((role) => callsAt.get(`${at}\0${role}`) ?? 0) };
  });
  const chatCalls = hours.reduce((sum, hour) => sum + hour.calls.chat, 0);
  const peopleOf = new Map(weekRows.results.map((row) => [`${row.key}\0${row.type}`, row.people]));
  // Ordered by replies, so the first row of a model names it in its most-counted spelling.
  const summed = new Map<string, ReplyRow>();
  for (const row of replies.results) {
    const id = `${row.key}\0${row.type}`;
    const found = summed.get(id);
    if (found) found.replies += row.replies;
    else summed.set(id, { ...row });
  }
  // A 대화 row also shows its week's people, so it waits for its week row (at PULSE_FLOORS.row people) as well.
  const ranking = ranked(
    [...summed].flatMap(([id, { key, type, name, replies: count }]) => {
      const people = peopleOf.get(id);
      return people === undefined ? [] : [{ count, row: { key, model: name, ...typed(type), share: count / chatCalls, people, replies: rounded(count) } }];
    }),
  );
  return { hours, ranking };
}

// null for a week that never passed PULSE_FLOORS.board, whose lists were never shown.
async function weekRanking(db: Db, week: number): Promise<{ people: number; ranking: PulseRankings } | null> {
  const people = await db.prepare('SELECT people FROM pulse_week WHERE week = ?').bind(week).first<number>('people');
  if (people === null) return null;
  const [roles, models] = await Promise.all([
    db.prepare('SELECT role, people FROM pulse_week_roles WHERE week = ?').bind(week).all<{ role: PulseRole; people: number }>(),
    db.prepare('SELECT role, key, type, name, people FROM pulse_week_models WHERE week = ?').bind(week).all<WeekRow>(),
  ]);
  const totals = new Map(roles.results.map((row) => [row.role, row.people]));
  const ranking = byRole((role) =>
    ranked(models.results.filter((row) => row.role === role).map(({ key, type, name, people: count }) => ({ count, row: { key, model: name, ...typed(type), share: count / totals.get(role)!, people: count } }))),
  );
  return { people, ranking };
}

async function board(db: Db, now: number): Promise<PulseBoard | null> {
  const from = weekOf(now);
  const current = await weekRanking(db, from);
  if (!current) return null;
  const [day, dayBefore, lastWeek, weeks] = await Promise.all([
    chatDay(db, now),
    // Its oldest hour is the oldest forgetPulseHours keeps.
    chatDay(db, now - DAY_MS),
    weekRanking(db, from - WEEK_MS),
    db.prepare('SELECT week FROM pulse_week WHERE week < ? ORDER BY week DESC').bind(from).all<{ week: number }>(),
  ]);
  return {
    week: { from, people: current.people },
    replies: rounded(day.hours.reduce((sum, hour) => sum + hour.calls.chat, 0)),
    hours: day.hours.map(({ at, calls }) => ({ at, calls: byRole((role) => rounded(calls[role])) })),
    // The board's 대화 is the day's replies; the week's people rank it only once the week is past.
    ranking: { ...current.ranking, chat: day.ranking },
    before: { ...byRole((role) => lastWeek && places(lastWeek.ranking[role])), chat: dayBefore && places(dayBefore.ranking) },
    weeks: weeks.results.map((row) => row.week),
  };
}

async function pastWeek(db: Db, from: number): Promise<PulseWeek | null> {
  const [week, prior] = await Promise.all([weekRanking(db, from), weekRanking(db, from - WEEK_MS)]);
  return week && { from, people: week.people, ranking: week.ranking, before: byRole((role) => prior && places(prior.ranking[role])) };
}

// By hour boundary: the board's 대화 before reads [hourOf(now) - 2 days, hourOf(now) - 1 day) whole.
export const forgetPulseHours = (db: Db, now = Date.now()) =>
  db.batch(['pulse_hours', 'pulse_hour_replies'].map((table) => db.prepare(`DELETE FROM ${table} WHERE hour < ?`).bind(hourOf(now) - HOURS_KEPT_MS)));

const WEEK_CACHE_SECONDS = 24 * 60 * 60;
export const pulse = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.env.pulse.answer(), 200, { 'cache-control': `public, max-age=${MEMO_MS / 1000}` }))
  .get('/weeks/:from', async (c) => {
    const found = await c.env.pulse.week(Number(c.req.param('from')));
    return found ? c.json(found, 200, { 'cache-control': `public, max-age=${WEEK_CACHE_SECONDS}` }) : fail(c, 404, 'not-found');
  });
