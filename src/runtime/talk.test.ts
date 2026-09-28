import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import { fold, shown, type Entry } from './chat';
import { fakeServer } from './fake-server';
import { ObjectStore } from './store';
import { addGreeting } from './talk';

describe('addGreeting', () => {
  it('opens the chat on the greeting that was shown, first and last included', async () => {
    const server = fakeServer();
    const store = await ObjectStore.open('account-1', randomBytes(32), server.request);
    const opened = async (chat: string, selected: number) => {
      await addGreeting(store, chat, ['하나', '둘', '셋'], selected);
      const [message] = fold(store.list<Entry>('entry').filter((entry) => entry.parent === chat));
      return [shown(message!).text, message!.versions.length];
    };
    expect(await opened('c1', 0)).toEqual(['하나', 3]);
    expect(await opened('c2', 2)).toEqual(['셋', 3]);
  });
});
