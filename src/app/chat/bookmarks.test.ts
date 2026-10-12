import { expect, it } from 'vitest';
import { foldTree, type Entry } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { bookmarkRows } from './bookmarks';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const said = (role: 'user' | 'assistant', follows: string | null) => ({ type: 'message' as const, role, at: rev, text: '', receipt: null, follows });

it("lists bookmarks in story order, one after another version with the switch that shows it, and none of a deleted message's", () => {
  const tree = foldTree([
    entry('u1', said('user', null)),
    entry('b1', said('assistant', 'u1')),
    entry('u2', said('user', 'b1')),
    entry('b1v2', { type: 'version', message: 'b1', replaces: null, edit: false, at: rev, text: '', receipt: null }),
    entry('u3', said('user', 'b1v2')),
    entry('d1', said('assistant', 'u3')),
    entry('del', { type: 'delete', message: 'd1', at: rev }),
  ]);
  const rows = bookmarkRows([{ message: 'd1' }, { message: 'u3' }, { message: 'u2', name: '갈림길' }], tree);
  expect(rows.map(({ message, name, to }) => [message.id, name, to.map(({ message, index }) => [message.id, index])])).toEqual([
    ['u2', '갈림길', [['b1', 0]]],
    ['u3', null, []],
  ]);
});
