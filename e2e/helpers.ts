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

// A bot's HTML at its worst: nothing in it may run, post, load from outside or cover the app (design §6.4).
// A 1x1 PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const HOSTILE = {
  name: 'hostile.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Hostile',
        description: '',
        first_mes: [
          '<div id="cover" style="position: fixed; inset: 0; background: rgb(200, 0, 0)">cover</div>',
          '<img id="outside" src="https://example.com/a.png" onerror="window.ran = 1"><script>window.ran = 1</script>',
          '<form action="https://example.com/post"><input id="field"></form>',
          '<a id="out" href="https://example.com">out</a> <a id="js" href="javascript:window.ran = 1">js</a>',
          '<div id="tone" class="x-risu-tone" style="background: url(https://example.com/b.png)">tone</div>',
          '{{button::누르기::go}}',
          '',
          '*nods* "hello"',
          '',
          '<div id="pic">{{img::smile}}</div><div id="backdrop" style="background-image: url( &quot;{{raw::smile}}&quot; )">backdrop</div>',
        ].join('\n'),
        assets: [{ type: 'x-risu-asset', uri: `data:image/png;base64,${PIXEL}`, name: 'smile', ext: 'png' }],
        extensions: { risuai: { backgroundHTML: '<style>.tone { color: rgb(0, 128, 0) }</style>' } },
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
