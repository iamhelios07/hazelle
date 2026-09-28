import type { Page } from '@playwright/test';

export const FAKE_MODEL = 'fake-model';
export const DESCRIPTION = 'Mira keeps the lantern inn at the edge of the marsh.';

export const CARD = {
  name: 'mira.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Mira',
        description: DESCRIPTION,
        first_mes: "Welcome to the inn. Tonight's omen is {{random::amber::birch}}.",
        character_book: { entries: [{ keys: ['lantern'], content: 'The lantern never goes out.', enabled: true, insertion_order: 1 }] },
        extensions: { risuai: { customScripts: [{ comment: 'bow', in: '\\[\\[bow\\]\\]', out: '(bows)', type: 'editdisplay' }] } },
      },
    }),
  ),
};

const REPLY = ['{{char}} smiles. ', '[[bow]]'];

// route.fulfill hands the browser the whole stream in one body: this exercises SSE parsing, not text arriving
// piece by piece. Every chat request body is kept for the test to read.
export async function fakeProvider(page: Page): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route('**/api/relay', async (route) => {
    const envelope = route.request().postDataJSON() as { url: string; body: string | null };
    const headers = { 'x-relay': 'upstream' };
    if (envelope.url.endsWith('/models')) {
      await route.fulfill({ headers, json: { data: [{ id: FAKE_MODEL }] } });
      return;
    }
    sent.push(JSON.parse(envelope.body!));
    const events = [...REPLY.map((content) => ({ choices: [{ delta: { content } }] })), { choices: [{ delta: {}, finish_reason: 'stop' }] }];
    const body = [...events.map((event) => JSON.stringify(event)), '[DONE]'].map((data) => `data: ${data}\n\n`).join('');
    await route.fulfill({ headers: { ...headers, 'content-type': 'text/event-stream' }, body });
  });
  return sent;
}
