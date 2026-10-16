import { describe, expect, it } from 'vitest';
import type { Model } from '../connectors/types';
import type { Portrait } from '../model/likeness';
import { illustratorPrompt, parseScene, pictureRequest, PICTURE_DEFAULTS, profileNames, sceneText } from './illustrate';

const answer = {
  after: 2,
  shape: 'landscape',
  setting: '2girls, indoors, cafe, night',
  framing: 'wide shot',
  characters: [
    { name: 'Ari', look: 'girl, silver hair', outfit: 'white dress', action: 'sitting, smile', x: 0.3, y: 0.6 },
    { name: 'Bea', look: 'girl, black hair', outfit: '', action: 'standing', x: 0.7, y: 0.5 },
  ],
};

describe('parseScene', () => {
  it('reads the scene, naming the paragraph from 0', () => {
    expect(parseScene(JSON.stringify(answer), 3)).toEqual({ ok: true, scene: { paragraph: 1, shape: 'landscape', setting: answer.setting, framing: answer.framing, characters: answer.characters } });
  });

  it('reads a scene inside a fenced code block', () => {
    expect(parseScene('```json\n' + JSON.stringify(answer) + '\n```', 3).ok).toBe(true);
  });

  it('fails a scene missing a field, or naming a paragraph the message lacks, and fills nothing in', () => {
    expect(parseScene(JSON.stringify({ ...answer, framing: undefined }), 3)).toEqual({ ok: false, reason: 'fields' });
    expect(parseScene(JSON.stringify({ ...answer, characters: [{ ...answer.characters[0], x: undefined }] }), 3)).toEqual({ ok: false, reason: 'fields' });
    expect(parseScene(JSON.stringify(answer), 1)).toEqual({ ok: false, reason: 'paragraph' });
    expect(parseScene('Here is the scene.', 3)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reads back a scene written out for the user to change', () => {
    const read = parseScene(JSON.stringify(answer), 3);
    expect(read.ok && parseScene(sceneText(read.scene), 3)).toEqual(read);
  });
});

it('builds the picture request: characters at their centers, the shape as its size', () => {
  const model = { id: 'nai-diffusion-5' } as Model;
  const parsed = parseScene(JSON.stringify(answer), 3);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(pictureRequest(parsed.scene, illustratorPrompt(), model, 42, [])).toEqual({
    model,
    prompt: `2girls, indoors, cafe, night, wide shot, ${PICTURE_DEFAULTS.quality}`,
    negative: PICTURE_DEFAULTS.negative,
    characters: [
      { prompt: 'girl, silver hair, white dress, sitting, smile', negative: '', center: { x: 0.3, y: 0.6 } },
      { prompt: 'girl, black hair, standing', negative: '', center: { x: 0.7, y: 0.5 } },
    ],
    width: 1216,
    height: 832,
    seed: 42,
    steps: null,
    scale: null,
    rescale: null,
    sampler: null,
  });
  expect(pictureRequest({ ...parsed.scene, shape: 'portrait' }, illustratorPrompt(), model, 1, [])).toMatchObject({ width: 832, height: 1216 });
});

it("puts a prompt's own tags and settings into the picture: artist first, an emptied field sends none, a fixed seed", () => {
  const model = { id: 'nai-diffusion-5' } as Model;
  const parsed = parseScene(JSON.stringify(answer), 3);
  if (!parsed.ok) throw new Error(parsed.reason);
  const prompt = { ...illustratorPrompt(), tags: { artist: 'artist:somebody', quality: '', negative: ' bad hands ' }, picture: { steps: 23, sampler: 'k_euler', seed: 7 } };
  expect(pictureRequest(parsed.scene, prompt, model, 42, [])).toMatchObject({
    prompt: 'artist:somebody, 2girls, indoors, cafe, night, wide shot',
    negative: 'bad hands',
    seed: 7,
    steps: 23,
    scale: null,
    sampler: 'k_euler',
  });
});

describe('pictureRequest with portraits', () => {
  const model = { id: 'nai-diffusion-5' } as Model;
  const scene = (characters: { name: string; outfit: string }[]) => ({ paragraph: 0, shape: 'square' as const, setting: 'indoors', framing: '', characters: characters.map((each) => ({ ...each, look: 'girl, from scene', action: 'smile', x: 0.5, y: 0.5 })) });
  const portrait = (name: string, more: Partial<Portrait> = {}): Portrait => ({ name, aliases: [], look: `girl, ${name} look`, outfits: [{ name: 'usual', tags: `${name} uniform` }, { name: 'night', tags: 'pajamas' }], artist: '', source: 'text', ...more });
  const prompts = (characters: { name: string; outfit: string }[], portraits: Portrait[], artist = '') =>
    pictureRequest(scene(characters), { ...illustratorPrompt(), tags: { ...PICTURE_DEFAULTS, artist } }, model, 1, portraits);

  it("draws a figure named by a portrait's name or alias, after trim, NFC and case, with the portrait's look in place of the scene's", () => {
    const request = prompts([{ name: ' café ', outfit: 'apron' }, { name: 'ARI', outfit: 'coat' }], [portrait('Ari'), portrait('Mina', { aliases: ['Cafe\u0301'] })]);
    expect(request.characters.map(({ prompt }) => prompt)).toEqual(['girl, Mina look, apron, smile', 'girl, Ari look, coat, smile']);
  });

  it("dresses a matched figure in the portrait's first outfit when the scene gives none, and leaves an unmatched figure as written", () => {
    const request = prompts([{ name: 'Ari', outfit: ' ' }, { name: 'Stranger', outfit: '' }], [portrait('Ari')]);
    expect(request.characters.map(({ prompt }) => prompt)).toEqual(['girl, Ari look, Ari uniform, smile', 'girl, from scene, smile']);
  });

  it("swaps each outfit tag that is a portrait outfit's name, after trim, NFC and case, for its tags, keeping the rest", () => {
    const request = prompts([{ name: 'Ari', outfit: ' NIGHT ' }, { name: 'Ari', outfit: 'night, torn' }, { name: 'Ari', outfit: 'red night' }], [portrait('Ari')]);
    expect(request.characters.map(({ prompt }) => prompt)).toEqual(['girl, Ari look, pajamas, smile', 'girl, Ari look, pajamas, torn, smile', 'girl, Ari look, red night, smile']);
  });

  it('tells the scene writer each portrait’s names and its named outfits', () => {
    const told = profileNames([portrait('Ari', { aliases: ['Lotta'] }), portrait('Mina', { outfits: [{ name: ' ', tags: 'unnamed' }] })]);
    expect(told).toContain('- Ari (also called Lotta), outfits: "usual", "night"');
    expect(told).toMatch(/\n- Mina$/);
  });

  it("leads with the prompt's artist tags, else the first drawn portrait's in pack order", () => {
    const portraits = [portrait('Ari', { artist: 'artist:own' }), portrait('Mina', { artist: 'artist:module' }), portrait('Undrawn', { artist: 'artist:never' })];
    expect(prompts([{ name: 'Mina', outfit: '' }, { name: 'Ari', outfit: '' }], portraits).prompt).toMatch(/^artist:own, indoors/);
    expect(prompts([{ name: 'Mina', outfit: '' }], portraits).prompt).toMatch(/^artist:module, indoors/);
    expect(prompts([{ name: 'Ari', outfit: '' }], portraits, 'artist:chosen').prompt).toMatch(/^artist:chosen, indoors/);
  });
});
