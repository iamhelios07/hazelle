import { describe, expect, it } from 'vitest';
import { fold, shown } from '../model/chat';
import { startChat } from './chat-log';
import { testServer } from './testing';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included', async () => {
    const { store } = await server.account();
    const opened = async (selected: number) => {
      const started = await startChat(store, { title: null, character: null, models: {} }, { texts: ['하나', '둘', '셋'], selected });
      const [message] = fold(store.children('entry', started.ok ? started.id : ''));
      return [shown(message!).text, message!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});
