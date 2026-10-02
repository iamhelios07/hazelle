import type { Page } from '@playwright/test';
import { StreamBox, type BoxStorage } from '../src/server/stream-box';

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

// A bot whose Lua answers a button, speaks, rewrites what is shown and edits a reply once it is saved (design §6.8).
export const SCRIPTED = {
  name: 'scripted.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Scripted',
        description: '',
        first_mes: 'The door is shut. {{button::문 열기::open}}',
        extensions: {
          risuai: {
            triggerscript: [
              {
                comment: 'main',
                type: 'start',
                conditions: [],
                effect: [
                  {
                    type: 'triggerlua',
                    code: [
                      "function open(id) setChatVar(id, 'door', 'open') alertNormal(id, '문이 열렸어요') end",
                      "listenEdit('editDisplay', function(id, value) return value .. ' [door:' .. getChatVar(id, 'door') .. ']' end)",
                      "function onOutput(id) setChat(id, -1, getChat(id, -1).data .. ' (seen)') end",
                    ].join('\n'),
                  },
                ],
              },
            ],
          },
        },
      },
    }),
  ),
};

const REPLY = ['{{char}} smiles. ', '[[bow]]'];

// route.fulfill hands the browser the whole stream in one body: this exercises SSE parsing and the call's sealed
// frames, not text arriving piece by piece. A chat is answered by the server's own StreamBox, in this process, since
// the Worker's Durable Object would call a provider it cannot reach here. Every chat request body is kept for the
// test to read.
export async function fakeProvider(page: Page): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route('**/api/relay', async (route) => {
    await route.fulfill({ headers: { 'x-relay': 'upstream' }, json: { data: [{ id: FAKE_MODEL }] } });
  });
  await page.route('**/api/streams/**', async (route) => {
    if (route.request().method() !== 'POST' || route.request().url().endsWith('/stop')) return route.fulfill({ status: 204 });
    const { key, request } = route.request().postDataJSON() as { key: string; request: { body: string } };
    sent.push(JSON.parse(request.body));
    const events = [...REPLY.map((content) => ({ choices: [{ delta: { content } }] })), { choices: [{ delta: {}, finish_reason: 'stop' }] }];
    const body = [...events.map((event) => JSON.stringify(event)), '[DONE]'].map((data) => `data: ${data}\n\n`).join('');
    const box = new StreamBox(memory(), async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const id = route.request().url().split('/').at(-1)!;
    const frames = await box.handle(new Request('https://stream/start', { method: 'POST', body: JSON.stringify({ id, key, request: { ...request, url: 'https://provider.example/chat' } }) }));
    await route.fulfill({ headers: Object.fromEntries(frames.headers), body: Buffer.from(await frames.arrayBuffer()) });
  });
  return sent;
}

function memory(): BoxStorage {
  const held = new Map<string, unknown>();
  return {
    get: async (key) => held.get(key),
    put: async (key, value) => void held.set(key, value),
    list: async ({ prefix }) => new Map([...held].filter(([key]) => key.startsWith(prefix))),
    deleteAll: async () => held.clear(),
    setAlarm: async () => {},
  };
}
