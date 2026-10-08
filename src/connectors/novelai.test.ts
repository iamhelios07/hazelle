import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { novelai } from './novelai';
import { detect, modelSettings, resolveConnection, resolveModel } from './registry';
import { ConnectorError, type Connection, type Model, type PictureRequest } from './types';

const connection: Connection = { type: 'novelai', label: 'NovelAI', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'pst-key' }], turns: null, starred: [] };
const [v5, , v45] = novelai.models!;

const picture = (model: Model): PictureRequest => ({
  model,
  prompt: '2girls, classroom',
  negative: 'lowres',
  characters: [
    { prompt: 'girl, red hair', negative: 'hat', center: { x: 0.2468, y: 0.5 } },
    { prompt: 'girl, black hair', negative: '', center: { x: 0.81, y: 0.33 } },
  ],
  width: 832,
  height: 1216,
  seed: 42,
});
const sent = (model: Model) => JSON.parse(novelai.draws!.request(picture(model)).body!) as { model: string; parameters: Record<string, unknown> };

describe('NovelAI', () => {
  it('is a type that only draws: its fixed list needs no fetch, and no chat request is built for it', () => {
    const resolved = resolveConnection(connection)!;
    expect(resolved).toMatchObject({ codec: null, models: novelai.models });
    expect(() => resolveModel(resolved, v5!)).toThrow(new ConnectorError('image-only'));
    expect(modelSettings(connection, v5!)).toBeNull();
    expect(detect('pst-abc123')).toMatchObject({ kind: 'key', type: novelai });
  });

  it('sends V5 the multi-character caption with free centers and no SMEA keys', () => {
    const request = novelai.draws!.request(picture(v5!));
    expect(request).toMatchObject({ url: 'https://image.novelai.net/ai/generate-image', method: 'POST' });
    const { model, parameters } = sent(v5!);
    expect(model).toBe('nai-diffusion-5-full');
    expect(parameters).toMatchObject({ params_version: 4, scale: 7, steps: 28, n_samples: 1, seed: 42, width: 832, height: 1216, uc: 'lowres' });
    expect(parameters).not.toHaveProperty('sm');
    expect(parameters.v4_prompt).toEqual({
      caption: {
        base_caption: '2girls, classroom',
        char_captions: [
          { char_caption: 'girl, red hair', centers: [{ x: 0.247, y: 0.5 }] },
          { char_caption: 'girl, black hair', centers: [{ x: 0.81, y: 0.33 }] },
        ],
      },
      use_coords: true,
      use_order: true,
    });
    expect(parameters.v4_negative_prompt).toEqual({
      caption: {
        base_caption: 'lowres',
        char_captions: [
          { char_caption: 'hat', centers: [{ x: 0.247, y: 0.5 }] },
          { char_caption: '', centers: [{ x: 0.81, y: 0.33 }] },
        ],
      },
    });
  });

  it('sends V4.5 its own body, its centers on the 5×5 grid, and refuses more characters than it takes', () => {
    const { model, parameters } = sent(v45!);
    expect(model).toBe('nai-diffusion-4-5-full');
    expect(parameters).toMatchObject({ params_version: 3, scale: 5, steps: 28, sm: false, sm_dyn: false });
    expect((parameters.v4_prompt as { caption: { char_captions: { centers: unknown }[] } }).caption.char_captions.map(({ centers }) => centers)).toEqual([[{ x: 0.3, y: 0.5 }], [{ x: 0.9, y: 0.3 }]]);
    const crowd = { ...picture(v45!), characters: Array.from({ length: 7 }, () => picture(v45!).characters[0]!) };
    expect(() => novelai.draws!.request(crowd)).toThrow(new ConnectorError('too-many-characters'));
  });

  it('reads the PNG out of the ZIP it answers, and no picture out of anything else', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const zipped = zipSync({ 'image_0.png': png });
    expect(await novelai.draws!.parse(new Uint8Array(zipped), 'application/x-zip-compressed')).toEqual({ bytes: png, type: 'image/png' });
    expect(await novelai.draws!.parse(strToU8('{"statusCode":402,"message":"Not enough Anlas"}'), 'application/json')).toBeNull();
  });

  it('reads the V5 usage limit and Anlas from the subscription, and names the tier', () => {
    const { parse, plan } = novelai.meters![0]!;
    const opus = { tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 250 }, usage: { percent: 42.5, isNegative: false, timeUntilNextPercent: 7888 } };
    expect(parse(opus)).toEqual([
      { kind: 'left', label: 'V5 무료 사용량', unit: 'percent', amount: 42.5, limit: 100, resets: null },
      { kind: 'left', label: 'Anlas', unit: 'credit', amount: 1250, limit: null, resets: null },
    ]);
    expect(plan!(opus)).toBe('Opus');
    expect(parse({ ...opus, usage: { percent: -3, isNegative: true, timeUntilNextPercent: 7888 } })![0]).toMatchObject({ amount: 0 });
    expect(parse({ tier: 1, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 } })).toEqual([{ kind: 'left', label: 'Anlas', unit: 'credit', amount: 0, limit: null, resets: null }]);
  });
});
