import { describe, expect, it } from 'vitest';
import { fold, shown } from '../model/chat';
import { addGreeting } from './talk';
import { testServer } from './testing';

const server = testServer();

describe('addGreeting', () => {
  it('opens the chat on the greeting that was shown, first and last included', async () => {
    const { store } = await server.account();
    const opened = async (selected: number) => {
      const chat = await store.create('chat', { title: null, character: null, models: {} });
      const id = chat.ok ? chat.data.id : '';
      await addGreeting(store, id, ['하나', '둘', '셋'], selected);
      const [message] = fold(store.children('entry', id));
      return [shown(message!).text, message!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});
