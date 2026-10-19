import { expect, it } from 'vitest';
import { translatorNoteRequest } from './translator-note';

const card = { name: 'Lotta', description: 'A knight who calls Mira 언니.', greetings: ['', 'Hello, traveler.'], exampleDialogue: '' };

it('sends the card apart from the task, with the note so far, and leaves out what the card lacks', () => {
  const [task, context, note, request] = translatorNoteRequest(card, 'Japanese', ' Master → 주인님 \n');
  expect(task).toMatchObject({ role: 'system', content: expect.stringContaining('into Japanese') });
  expect(context!.content).toMatch(/^A character card, for reference only\./);
  expect(context!.content).toContain('The character: Lotta.\nA knight who calls Mira 언니.');
  expect(context!.content).not.toContain('first message');
  expect(context!.content).not.toContain('Example dialogue');
  expect(note).toMatchObject({ role: 'system', content: expect.stringMatching(/only what it lacks[^]*\n---\nMaster → 주인님$/) });
  expect(request!.role).toBe('user');
});

it('sends the first greeting and example dialogue when the card has them, and no note when it is empty', () => {
  const messages = translatorNoteRequest({ ...card, greetings: ['Halt!'], exampleDialogue: '<START>\n{{char}}: Halt.' }, 'Korean', ' ');
  expect(messages).toHaveLength(3);
  expect(messages[1]!.content).toContain("The character's first message:\nHalt!\n\nExample dialogue:\n<START>\n{{char}}: Halt.");
});
