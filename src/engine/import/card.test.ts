import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importCard } from './card';
import type { ImportResult, Imported } from './types';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => (bytes.reduce((c, byte) => CRC[(c ^ byte) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const tEXt = (key: string, value: string) => chunk('tEXt', strToU8(`${key}\0${value}`));
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const cardText = (card: unknown) => base64(strToU8(JSON.stringify(card)));

// A 1x1 PNG; its IDAT is not a valid image, which the importer never inspects.
function png(...chunks: Uint8Array[]): Uint8Array {
  const ihdr = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, chunk('IDAT', new Uint8Array([1, 2, 3])), ...chunks, chunk('IEND', new Uint8Array()));
}

const v2 = (data: Record<string, unknown>) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Mira', description: 'd', first_mes: 'hi', ...data } });
const v3 = (data: Record<string, unknown>) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Mira', description: 'd', first_mes: 'hi', ...data } });

function ok(result: ImportResult): Imported {
  if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result.failure)}`);
  return result.card;
}
const json = (card: unknown) => ok(importCard('card.json', strToU8(JSON.stringify(card))));
const charx = (files: Record<string, Uint8Array>) => ok(importCard('card.charx', zipSync(files)));
const counts = (imported: Imported) => Object.fromEntries(imported.report.unsupported.map(({ kind, count }) => [kind, count]));

describe('importCard', () => {
  it('prefers the ccv3 chunk over chara in a PNG', () => {
    const imported = ok(importCard('Mira.PNG', png(tEXt('chara', cardText(v2({ name: 'Old' }))), tEXt('ccv3', cardText(v3({ name: 'New' }))))));
    expect(imported.card.name).toBe('New');
    expect(imported.report).toMatchObject({ format: 'png', spec: 'v3' });
  });

  it('stores the PNG without the card chunks as the avatar', () => {
    const software = tEXt('Software', 'paint');
    const file = png(software, tEXt('chara', cardText(v2({}))), tEXt('ccv3', cardText(v3({}))), tEXt('chara-ext-asset_:1', 'AAAA'));
    expect(ok(importCard('Mira.png', file)).avatar).toEqual({ bytes: png(software), type: 'image/png' });
  });

  it('takes the icon named main from a charx', () => {
    const main = png(tEXt('Title', 'main'));
    const imported = charx({
      'card.json': strToU8(
        JSON.stringify(
          v3({
            assets: [
              { type: 'icon', uri: 'embeded://assets/icon/image/other.png', name: 'other', ext: 'png' },
              { type: 'icon', uri: 'embeded://assets/icon/image/main.png', name: 'main', ext: 'png' },
              { type: 'emotion', uri: 'embeded://assets/emotion/image/smile.png', name: 'smile', ext: 'png' },
            ],
          }),
        ),
      ),
      'assets/icon/image/other.png': png(tEXt('Title', 'other')),
      'assets/icon/image/main.png': main,
      'assets/emotion/image/smile.png': png(),
    });
    expect(imported.avatar).toEqual({ bytes: main, type: 'image/png' });
    expect(counts(imported)).toEqual({ asset: 2 });
  });

  it('reads a zip appended to a JPEG and keeps the JPEG as the avatar', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
    const imported = ok(importCard('Mira.jpeg', concat(jpeg, zipSync({ 'card.json': strToU8(JSON.stringify(v3({ name: 'Jay' }))) }))));
    expect(imported.card.name).toBe('Jay');
    expect(imported.avatar).toEqual({ bytes: jpeg, type: 'image/jpeg' });
    expect(imported.report.format).toBe('charx');
  });

  it('resolves a data: icon, as Risu writes it into a JSON export', () => {
    const image = png();
    const imported = json(v3({ assets: [{ type: 'icon', uri: `data:application/octet-stream;base64,${base64(image)}`, name: 'main', ext: 'png' }] }));
    expect(imported.avatar).toEqual({ bytes: image, type: 'image/png' });
  });

  it('falls back to Tavern v1 fields, including the char_* names', () => {
    const tavern = json({ name: 'Old', description: 'desc', personality: 'calm', scenario: 'inn', first_mes: 'hello', mes_example: '<START>' });
    expect(tavern.report.spec).toBe('v1');
    expect(tavern.card).toMatchObject({ name: 'Old', description: 'desc', personality: 'calm', scenario: 'inn', greetings: ['hello'], exampleDialogue: '<START>' });
    const pygmalion = json({ char_name: 'Py', char_persona: 'p', world_scenario: 'w', char_greeting: 'g', example_dialogue: 'e' });
    expect(pygmalion.card).toMatchObject({ name: 'Py', description: 'p', scenario: 'w', greetings: ['g'], exampleDialogue: 'e' });
  });

  it('imports a card without extensions', () => {
    const imported = json(v2({ character_version: 2 }));
    expect(imported.card).toMatchObject({ version: '2', regex: [], variables: [], toggles: '', utility: false, bias: [] });
    expect(imported.card.loreSettings).toEqual({ scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null });
    expect(imported.lore).toEqual([]);
  });

  it('keeps greeting positions and drops only trailing empties', () => {
    expect(json(v3({ first_mes: '', alternate_greetings: ['a', '', 'b', ''] })).card.greetings).toEqual(['', 'a', '', 'b']);
  });

  it('keeps each lore setting on its own', () => {
    expect(json(v3({ character_book: { token_budget: 2000, entries: [] } })).card.loreSettings).toEqual({
      scanDepth: null,
      tokenBudget: 2000,
      recursive: null,
      fullWordMatching: null,
    });
  });

  it('honors enabled and case_sensitive and keeps CCv3 key arrays intact', () => {
    const entry = { keys: ['dragon, wyrm', '/a{1,3}/', ' '], content: 'x', enabled: false, case_sensitive: true, insertion_order: 5, priority: 3, position: 'after_char' };
    expect(json(v3({ character_book: { entries: [entry] } })).lore).toEqual([
      {
        name: '',
        keys: ['dragon, wyrm', '/a{1,3}/'],
        secondaryKeys: [],
        content: 'x',
        enabled: false,
        constant: false,
        selective: false,
        useRegex: false,
        caseSensitive: true,
        insertionOrder: 5,
        priority: 3,
        position: 'after_char',
        folder: null,
      },
    ]);
  });

  it('turns SillyTavern entry extensions into decorators in front of the content', () => {
    const extensions = { useProbability: true, probability: 30, position: 4, depth: 2, role: 1, selectiveLogic: 2, delay: 3, match_whole_words: true };
    const entry = { keys: ['k'], secondary_keys: ['x', 'y'], selective: true, content: 'body', enabled: true, insertion_order: 1, extensions };
    const [lore] = json(v3({ character_book: { entries: [entry] } })).lore;
    expect(lore).toMatchObject({
      selective: false,
      content: '@@match_full_word\n@@activate_only_after 3\n@@exclude_keys y\n@@exclude_keys x\n@@depth 2\n@@role user\n@@probability 30\nbody',
    });
  });

  it('splits defaultVariables lines at the first =', () => {
    const imported = json(v3({ extensions: { risuai: { defaultVariables: 'a=b=c\r\nhp=\n=x\nnoeq' } } }));
    expect(imported.card.variables).toEqual([
      ['a', 'b=c'],
      ['hp', ''],
    ]);
  });

  it("applies a charx's module.risum over the card", () => {
    const card = v3({
      extensions: { risuai: { customScripts: [{ comment: 'card', in: 'a', out: 'b', type: 'editoutput' }] } },
      character_book: {
        scan_depth: 7,
        token_budget: 900,
        recursive_scanning: false,
        extensions: { risu_fullWordMatching: true },
        entries: [{ keys: ['old'], content: 'old', enabled: true, insertion_order: 1 }],
      },
    });
    const imported = charx({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': Uint8Array.from(atob(RISU_MODULE.join('')), (char) => char.charCodeAt(0)) });
    expect(imported.card.regex).toEqual([{ name: '상태창 숨김', find: '<status>[\\s\\S]*?</status>', replace: '', stage: 'display', flags: 'gi' }]);
    expect(imported.card.loreSettings).toEqual({ scanDepth: 7, tokenBudget: 900, recursive: false, fullWordMatching: true });
    expect(imported.loreFolders).toEqual(['장소']);
    expect(imported.lore).toMatchObject([
      { name: 'Castle', keys: ['성', 'castle'], caseSensitive: true, insertionOrder: 120, content: '@@probability 40\n{{char}} lives in the castle.', folder: 0 },
      { name: 'Dragon', keys: ['dragon'], content: '@@end\n<user> met a dragon.', folder: null },
    ]);
    expect(counts(imported)).toEqual({ lua: 1, trigger: 1, 'regex-stage': 1 });
  });

  it('imports the card alone when module.risum is unreadable', () => {
    const card = v3({ extensions: { risuai: { customScripts: [{ comment: 'card', in: 'a', out: 'b', type: 'editoutput', ableFlag: false, flag: 'i' }] } } });
    const imported = charx({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': new Uint8Array([111, 0, 255, 255, 255, 255]) });
    expect(imported.card.regex).toEqual([{ name: 'card', find: 'a', replace: 'b', stage: 'output', flags: null }]);
    expect(counts(imported)).toEqual({ module: 1 });
  });

  it('counts what it cannot run and leaves it in the text', () => {
    const imported = json(
      v3({
        description: '{{img::x}} {{getvar::y}} {{ Trigger_ID }}',
        assets: [
          { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
          { type: 'emotion', uri: 'data:image/png;base64,AAAA', name: 'smile', ext: 'png' },
        ],
        extensions: {
          depth_prompt: { depth: 4, prompt: 'stay in character' },
          risuai: {
            backgroundHTML: '<div>{{getvar::hp}}</div>',
            additionalText: 'extra',
            prebuiltAssetCommand: true,
            triggerscript: [{ effect: [{ type: 'triggerlua', code: '' }] }, { effect: [{ type: 'setvar' }] }],
            customScripts: [
              { comment: 't', in: 'a', out: 'b', type: 'edittrans' },
              { comment: 'off', in: 'a', out: 'b', type: 'disabled' },
            ],
          },
        },
        character_book: { entries: [{ keys: ['k'], content: '@@disable_ui_prompt x\n@@depth 1\nbody {{button::a::b}}', enabled: true, insertion_order: 1 }] },
      }),
    );
    expect(imported.card.description).toBe('{{img::x}} {{getvar::y}} {{ Trigger_ID }}');
    expect(imported.avatar).toBeNull();
    expect(imported.report.unsupported).toEqual([
      { kind: 'trigger', count: 1 },
      { kind: 'lua', count: 1 },
      { kind: 'asset', count: 1 },
      { kind: 'background-html', count: 1 },
      { kind: 'additional-text', count: 1 },
      { kind: 'prebuilt-asset-command', count: 1 },
      { kind: 'depth-prompt', count: 1 },
      { kind: 'disable-ui-prompt', count: 1 },
      { kind: 'cbs-tag', count: 3 },
      { kind: 'regex-stage', count: 2 },
    ]);
  });

  it('fails by kind instead of throwing', () => {
    expect(importCard('Mira.png', png(tEXt('chara', 'rcc||rccv1||abc||def||ghi')))).toEqual({ ok: false, failure: { kind: 'encrypted' } });
    expect(importCard('Mira.webp', new Uint8Array())).toEqual({ ok: false, failure: { kind: 'unknown-format' } });
    expect(importCard('Mira.risum', new Uint8Array([111, 0]))).toEqual({ ok: false, failure: { kind: 'module-file' } });
    expect(importCard('Mira.png', strToU8('not a png'))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
    expect(importCard('Mira.json', strToU8('{'))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
    expect(importCard('Mira.charx', strToU8('PK'))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
  });
});

// A module.risum laid out as Risu's exportModuleLegacy writes it and encoded with the encode half of the real
// rpack_map.bin (RisuAI ca1345fc), so it checks the ported decode table against Risu's own bytes. It holds a Lua
// and a plain trigger, an editdisplay and an edittrans script, and a lore folder with a bookVersion 1 entry
// (activationPercent 40) and a bookVersion 2 entry.
const RISU_MODULE = [
  'bwDfBwAA5m5hYSAtQOKyTAUgl2HmbmFhYWEg8tMtBSCXYSChNUqhRmdh20DiskwFIABuYWFhYSDiBUg8eQ4sDw5A8iCXYSDbQOKy',
  'TAVhjkB5YaE1SqFGZyAAbmFhYWEgDuIgl2Eg0h2RPFaO0gUMkdNkggwWPGRkDHSOFhYMVuLSPBaOgo7B08HSIABuYWFhYSAPeQ4q',
  'KgV5IJdh9G5hYWFhYWHmbmFhYWFhYWFhIDxALS0F8g8gl2EgIABuYWFhYWFhYWEgD2wsBSCXYSBID9N5DyAAbmFhYWFhYWFhIDxA',
  '8uIODw5A8kggl2H0zwBuYWFhYWFhYWEgBY6OBTwPIJdh9G5hYWFhYWFhYWFh5m5hYWFhYWFhYWFhYWEgD2wsBSCXYSAPeQ4qKgV5',
  'TLLTIABuYWFhYWFhYWFhYWFhIDxA4gUgl2EgjrLyPA8OQPJhQPJLD9N5D22rYQXy4iBuYWFhYWFhYWFhYXtuYWFhYWFhYWHPAG5h',
  'YWFhYWFhYSBMQLVJBXoFTLQ8PAVISCCXYY7TTEgFbmFhYWFhYXsAbmFhYWFhYeZuYWFhYWFhYWEgPEAtLQXyDyCXYSBXLCAAbmFh',
  'YWFhYWFhIA9sLAUgl2EgQLIPLLIPIABuYWFhYWFhYWEgPEDy4g4PDkDySCCXYfTPAG5hYWFhYWFhYSAFjo4FPA8gl2H0bmFhYWFh',
  'YWFhYWHmbmFhYWFhYWFhYWFhYSAPbCwFIJdhIEgFD3rTeSAAbmFhYWFhYWFhYWFhYSBALAV50w9AeSCXYSDWIABuYWFhYWFhYWFh',
  'YWFhIHrTeSCXYSBXLCAAbmFhYWFhYWFhYWFhYSB600yyBSCXYSDB0iBuYWFhYWFhYWFhYXtuYWFhYWFhYWHPbmFhYWFhYXtuYWFh',
  'Yc8AbmFhYWEgeQUqBacgl2H0bmFhYWFhYeZuYWFhYWFhYWEgPEAtLQXyDyCXYSATmof3miETntRhE+tEWfP+IABuYWFhYWFhYWEg',
  'DvIgl2EgI0gP0w+ySFL0FRVIFRVLz8nRI69ID9MPskhSIABuYWFhYWFhYWEgQLIPIJdhICAAbmFhYWFhYWFhIA9sLAUgl2EgBeIO',
  'D+IOSCxM02wgAG5hYWFhYWFhYSDTHUwFWEzTKiCXYQ95sgUAbmFhYWFhYWFhII5M0yogl2EgKg4gbmFhYWFhYXsAbmFhYWFhYeZu',
  'YWFhYWFhYWEgPEAtLQXyDyCXYSAPedPySEzTDwUgAG5hYWFhYWFhYSAO8iCXYSDTIABuYWFhYWFhYWEgQLIPIJdhIB0gAG5hYWFh',
  'YWFhYSAPbCwFIJdhIAXiDg8PedPySCAAbmFhYWFhYWFhINMdTAVYTNMqIJdhjtNMSAVuYWFhYWFhe25hYWFhzwBuYWFhYSBMQHkF',
  'HUBAzSCXYfRuYWFhYWFh5m5hYWFhYWFhYSDNBWwgl2Egff7+jkBM4gV5lxbiwTwgAG5hYWFhYWFhYSA8QC0tBfIPIJdhIBMf7hMz',
  '3SAAbmFhYWFhYWFhIDxA8g8F8g8gl2EgIABuYWFhYWFhYWEgLUDiBSCXYSCOQEziBXkgAG5hYWFhYWFhYSAO8kgFeQ9AeeIFeSCX',
  'YcHS0gBuYWFhYWFhYWEg00y102xItDwPDnoFIJdhjtNMSAUAbmFhYWFhYWFhIEgFPEDy4s0FbCCXYSAgAG5hYWFhYWFhYSBIBUwF',
  'PA8OegUgl2GO00xIBW5hYWFhYWF7AG5hYWFhYWHmbmFhYWFhYWFhIM0FbCCXYSATAmkAYTzTSA9MBSAAbmFhYWFhYWFhIEgFPEDy',
  '4s0FbCCXYSAgAG5hYWFhYWFhYSAO8kgFeQ9AeeIFeSCXYcFW0gBuYWFhYWFhYWEgPEAtLQXyDyCXYSDo00gPTAUgAG5hYWFhYWFh',
  'YSA8QPIPBfIPIJdhICM8V9N5UmFMDnoFSGEO8mEPVwVhPNNID0wFXSAAbmFhYWFhYWFhIC1A4gUgl2Eg8kB5LdNMIABuYWFhYWFh',
  'YWEg00y102xItDwPDnoFIJdhjtNMSAUAbmFhYWFhYWFhIEgFTAU8Dw56BSCXYY7TTEgFAG5hYWFhYWFhYSAFpw8F8g8OQPJIIJdh',
  '5m5hYWFhYWFhYWFhIHkOSLI0PNNIBTRIBfJIDg8OegUgl2EPebIFbmFhYWFhYWFhewBuYWFhYWFhYWEg0zwPDnrTDw5A8jsFeTwF',
  '8g8gl2EW0gBuYWFhYWFhYWEgjkBM4gV5IJdhIH3+/o5ATOIFeZcW4sE8IG5hYWFhYWF7AG5hYWFhYWHmbmFhYWFhYWFhIM0FbCCX',
  'YSDiedMqQPIgAG5hYWFhYWFhYSBIBTxA8uLNBWwgl2EgIABuYWFhYWFhYWEgDvJIBXkPQHniBXkgl2HB0tIAbmFhYWFhYWFhIDxA',
  'LS0F8g8gl2EgL3nTKkDyIABuYWFhYWFhYWEgPEDyDwXyDyCXYSD//wXy4hXyI7JIBXlSYS0FD2HTYeJ50ypA8l0gAG5hYWFhYWFh',
  'YSAtQOIFIJdhIPJAeS3TTCAAbmFhYWFhYWFhINNMtdNsSLQ8Dw56BSCXYY7TTEgFAG5hYWFhYWFhYSBIBUwFPA8OegUgl2GO00xI',
  'BQBuYWFhYWFhYWEgHUBAzUcFeUgOQPIgl2FWbmFhYWFhYXtuYWFhYc9uYWF7AG5hYSAPbCwFIJdhIHkOSLLbQOKyTAUgbnsA',
];
