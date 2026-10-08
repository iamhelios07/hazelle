import { describe, expect, it } from 'vitest';
import type { Model } from '../connectors/types';
import { parseScene, pictureRequest, PICTURE_DEFAULTS, sceneText } from './illustrate';

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
  expect(pictureRequest(parsed.scene, PICTURE_DEFAULTS, model, 42)).toEqual({
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
  });
  expect(pictureRequest({ ...parsed.scene, shape: 'portrait' }, PICTURE_DEFAULTS, model, 1)).toMatchObject({ width: 832, height: 1216 });
});

it("puts a prompt's own tags into the picture: artist first, an emptied field sends none", () => {
  const model = { id: 'nai-diffusion-5' } as Model;
  const parsed = parseScene(JSON.stringify(answer), 3);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(pictureRequest(parsed.scene, { artist: 'artist:somebody', quality: '', negative: ' bad hands ' }, model, 42)).toMatchObject({
    prompt: 'artist:somebody, 2girls, indoors, cafe, night, wide shot',
    negative: 'bad hands',
  });
});
