import type { Page } from '@playwright/test';
import { createServer } from 'node:http';
import { unpack } from '../src/engine/import/risum';

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

// The provider behind FAKE_ADDRESS: an OpenAI-compatible server in this process. A connection takes only a public https
// address, so the page's relay and stream requests for FAKE_ADDRESS are readdressed to it on their way out; the server
// then reaches it as a listed local provider (FAKE_PROVIDER in HAZELLE_LOCAL_PROVIDERS) through its own relay, stream
// registry and outbound. Every chat request body it hears is kept for the test to read.
export const FAKE_ADDRESS = 'https://fake-provider.test/v1';
export const FAKE_PROVIDER = '127.0.0.1:4419';

const REPLY = ['{{char}} smiles. ', '[[bow]]'];
let heard: unknown[] = [];
let listening: Promise<void> | null = null;

function upstream(): Promise<void> {
  listening ??= new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      if (request.url === '/v1/models') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: FAKE_MODEL }] }));
      if (request.url !== '/v1/chat/completions') return response.writeHead(404).end();
      heard.push(JSON.parse(Buffer.concat(chunks).toString()));
      const events = [...REPLY.map((content) => ({ choices: [{ delta: { content } }] })), { choices: [{ delta: {}, finish_reason: 'stop' }] }];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end([...events.map((event) => JSON.stringify(event)), '[DONE]'].map((data) => `data: ${data}\n\n`).join(''));
    });
    const [host, port] = FAKE_PROVIDER.split(':');
    server.on('error', reject).listen(Number(port), host, () => resolve());
    server.unref();
  });
  return listening;
}

export async function fakeProvider(page: Page): Promise<unknown[]> {
  await upstream();
  heard = [];
  const readdress = (url: string) => (url.startsWith(FAKE_ADDRESS) ? `http://${FAKE_PROVIDER}/v1${url.slice(FAKE_ADDRESS.length)}` : url);
  await page.route('**/api/relay', (route) => {
    const envelope = route.request().postDataJSON() as { url: string };
    return route.continue({ postData: JSON.stringify({ ...envelope, url: readdress(envelope.url) }) });
  });
  // One segment: a start. Its /stop goes to the server as sent, like every read and drop.
  await page.route('**/api/streams/*', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const start = route.request().postDataJSON() as { request: { url: string } };
    return route.continue({ postData: JSON.stringify({ ...start, request: { ...start.request, url: readdress(start.request.url) } }) });
  });
  return heard;
}

// A module file as Risu writes one (src/engine/import/risum.ts), encoded with the inverse of the decode table.
function risum(module: unknown): Buffer {
  const encode = new Uint8Array(256);
  unpack(Uint8Array.from({ length: 256 }, (_, byte) => byte)).forEach((plain, packed) => (encode[plain] = packed));
  const main = Buffer.from(JSON.stringify({ type: 'risuModule', module })).map((byte) => encode[byte]!);
  return Buffer.concat([Buffer.from([111, 0]), Buffer.from(new Uint32Array([main.length]).buffer), main, Buffer.from([0])]);
}

// A module whose display script draws a state and a button under every message, and whose block trigger answers the
// button (design §6.5): its operand is CBS, which the run evaluates in its worker.
export const MODULE = {
  name: 'bell.risum',
  mimeType: 'application/octet-stream',
  buffer: risum({
    name: 'Bell',
    description: '',
    id: 'e2e-bell',
    regex: [{ comment: 'bell', in: '$', out: ' [bell:{{getvar::bell}}] {{button::벨 울리기::ring}}', type: 'editdisplay' }],
    trigger: [
      {
        comment: 'ring',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'setvar', operator: '=', var: 'bell', value: '{{? 1+1}}' },
          { type: 'showAlert', alertType: 'normal', value: '따르릉' },
        ],
      },
    ],
  }),
};
