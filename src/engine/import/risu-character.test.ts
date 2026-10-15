import { expect, it } from 'vitest';
import { risuChatFile } from './risu-character';

it('counts a chat whose own toggle values Risu reads over the account, with or without its local-toggle switch on', () => {
  const chat = (over: Record<string, unknown>) => ({ message: [], ...over });
  const file = risuChatFile({
    type: 'risuAllChats',
    ver: 2,
    data: [
      chat({ useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_nsfw: '1' } }),
      chat({ GLGlobalVariables: { toggle_mode: 'b' } }),
      chat({ useLocallySetGlobalVariables: true }),
      chat({ useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: 'null', toggle_b: '', score: '3' } }),
    ],
  })!;
  expect(file.missed).toEqual([{ kind: 'chat-toggles', count: 2 }]);
});
