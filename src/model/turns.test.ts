import { expect, it } from 'vitest';
import type { Turns } from '../connectors/types';
import { addGroup, cycleOf, moveGroup, removeGroup, schedule, setDay, takeTurn } from './turns';

const OCTOBER_10 = new Date(2026, 9, 10, 12).getTime();
const OCTOBER_20 = new Date(2026, 9, 20, 12).getTime();
const group = (id: string, accounts: string[] = []) => ({ id, name: id, accounts });
const turns: Turns = { day: 16, groups: [group('a', ['x']), group('b'), group('c')], anchor: { group: 'b', cycle: cycleOf(OCTOBER_10, 16) } };
const order = (value: Turns | null, now: number) => schedule(value!, now).timeline.map((entry) => entry.group.id);

it('passes the turn on each switch day, and keeps the current group current whatever its groups are changed', () => {
  expect(order(turns, OCTOBER_10)).toEqual(['b', 'c', 'a']);
  expect(schedule(turns, OCTOBER_20)).toMatchObject({ active: { id: 'c' }, next: { id: 'a' }, window: { start: new Date(2026, 9, 16).getTime(), end: new Date(2026, 10, 16).getTime() } });

  expect(order(addGroup(turns, 'd', OCTOBER_10), OCTOBER_10)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveGroup(turns, 'b', 1, OCTOBER_10)).toBeNull();
  expect(order(moveGroup(turns, 'a', -1, OCTOBER_10), OCTOBER_10)).toEqual(['b', 'a', 'c']);
  expect(order(removeGroup(turns, 'b', OCTOBER_10), OCTOBER_10)).toEqual(['c', 'a']);
  expect(removeGroup(turns, 'a', OCTOBER_10)).toBeNull();
  expect(order(takeTurn(turns, 'a', OCTOBER_10), OCTOBER_10)).toEqual(['a', 'b', 'c']);
  expect(order(setDay(turns, 5, OCTOBER_10), OCTOBER_10)[0]).toBe('b');
});
