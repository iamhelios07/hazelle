import { unzipSync } from 'fflate';
import { ConnectorError, type ConnectionType, type Meter, type Model, type PictureRequest } from './types';
import { count, isRecord } from './values';

const drawing = (id: string, name: string): Model => ({
  id,
  name,
  input: ['text'],
  output: ['image'],
  contextLength: null,
  maxOutput: null,
  reasoning: null,
  tools: null,
  protocol: null,
  takes: { settings: null, reasoning: null },
});

// Per model as NAIWeaver's NaiCaps and NaiModelDefaults state it (nai_model.dart), read from NovelAI's own frontend.
// V4.5 places characters only on a 5×5 grid and takes at most 6 of them; V5 places them freely.
type Body = { paramsVersion: number; scale: number; maxCharacters: number; grid: boolean; v5: boolean };
const V5: Body = { paramsVersion: 4, scale: 7, maxCharacters: 32, grid: false, v5: true };
const V45: Body = { paramsVersion: 3, scale: 5, maxCharacters: 6, grid: true, v5: false };
const BODIES: Partial<Record<string, Body>> = { 'nai-diffusion-5-full': V5, 'nai-diffusion-5-curated': V5, 'nai-diffusion-4-5-full': V45, 'nai-diffusion-4-5-curated': V45 };

// The first is the default.
const MODELS: Model[] = [
  drawing('nai-diffusion-5-full', 'NovelAI Diffusion V5 Full'),
  drawing('nai-diffusion-5-curated', 'NovelAI Diffusion V5 Curated'),
  drawing('nai-diffusion-4-5-full', 'NovelAI Diffusion V4.5 Full'),
  drawing('nai-diffusion-4-5-curated', 'NovelAI Diffusion V4.5 Curated'),
];

const onGrid = (value: number) => (Math.min(Math.floor(value * 5), 4) * 2 + 1) / 10;
const thousandths = (value: number) => Math.round(value * 1000) / 1000;

// Steps stay at 28 and samples at 1: past either, an Opus picture costs Anlas.
function generateBody({ model, prompt, negative, characters, width, height, seed }: PictureRequest): Record<string, unknown> {
  const body = BODIES[model.id];
  if (!body) throw new ConnectorError('unknown-model');
  if (characters.length > body.maxCharacters) throw new ConnectorError('too-many-characters');
  const place = body.grid ? onGrid : thousandths;
  const centers = characters.map(({ center }) => [{ x: place(center.x), y: place(center.y) }]);
  return {
    input: prompt,
    model: model.id,
    action: 'generate',
    parameters: {
      params_version: body.paramsVersion,
      width,
      height,
      scale: body.scale,
      sampler: 'k_euler_ancestral',
      steps: 28,
      seed,
      n_samples: 1,
      noise_schedule: 'karras',
      // V4.5 keeps the SMEA keys, always false: true is a 500 on every V4+ model. V5 drops them.
      ...(!body.v5 && { sm: false, sm_dyn: false }),
      dynamic_thresholding: false,
      cfg_rescale: 0,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      uc: negative,
      v4_prompt: {
        caption: { base_caption: prompt, char_captions: characters.map((character, index) => ({ char_caption: character.prompt, centers: centers[index] })) },
        use_coords: characters.length > 0,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negative, char_captions: characters.map((character, index) => ({ char_caption: character.negative, centers: centers[index] })) },
      },
    },
  };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The answer is a ZIP holding one PNG. Anything else, a refusal's JSON among them, holds no picture.
function pictureIn(body: Uint8Array<ArrayBuffer>) {
  let entries: Uint8Array[];
  try {
    entries = Object.values(unzipSync(body));
  } catch {
    return null;
  }
  const png = entries.find((entry) => PNG.every((byte, index) => entry[index] === byte));
  return png ? { bytes: png.slice(), type: 'image/png' } : null;
}

const TIERS = ['Paper', 'Tablet', 'Scroll', 'Opus'];

// Field names as NAIWeaver's NaiSubscription and NaiUsage read them (nai_model.dart) and its V5 research measured with
// a real key. usage, the V5 allowance, comes only on Opus; it refills a percent at a time, so it names no reset.
function meters(payload: unknown): Meter[] | null {
  if (!isRecord(payload)) return null;
  const found: Meter[] = [];
  const usage = isRecord(payload.usage) ? payload.usage : null;
  if (usage && typeof usage.percent === 'number') {
    found.push({ kind: 'left', label: 'V5 무료 사용량', unit: 'percent', amount: usage.isNegative === true ? 0 : Math.min(Math.max(usage.percent, 0), 100), limit: 100, resets: null });
  }
  const steps = isRecord(payload.trainingStepsLeft) ? payload.trainingStepsLeft : null;
  const fixed = count(steps?.fixedTrainingStepsLeft);
  const purchased = count(steps?.purchasedTrainingSteps);
  if (fixed !== null && purchased !== null) found.push({ kind: 'left', label: 'Anlas', unit: 'credit', amount: fixed + purchased, limit: null, resets: null });
  return found;
}

const plan = (payload: unknown) => (isRecord(payload) && payload.active === true && typeof payload.tier === 'number' ? (TIERS[payload.tier] ?? null) : null);

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

export const novelai: ConnectionType = {
  id: 'novelai',
  label: 'NovelAI',
  group: 'maker',
  description: 'NovelAI로 삽화를 그려요.',
  keyPage: 'https://docs.novelai.net/en/text/usersettings/account',
  detect: { key: /^pst-/, host: 'image.novelai.net' },
  models: MODELS,
  // The only check that a pasted key works: there is no model list to ask. api.novelai.net refuses this path now.
  meters: [{ request: (secret) => ({ url: 'https://image.novelai.net/user/subscription', method: 'GET', headers: bearer(secret), body: null }), parse: meters, plan }],
  draws: {
    request: (picture) => ({ url: 'https://image.novelai.net/ai/generate-image', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(generateBody(picture)) }),
    authHeaders: bearer,
    parse: (body) => Promise.resolve(pictureIn(body)),
  },
};
