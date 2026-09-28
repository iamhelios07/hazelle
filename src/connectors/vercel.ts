import type { ConnectionType, Modality } from './types';
import { amount, count, isRecord } from './values';

const API = 'https://ai-gateway.vercel.sh/v1';

// Vercel names a PDF input where the other catalogs say file.
const MODALITIES: Partial<Record<string, Modality>> = { text: 'text', image: 'image', audio: 'audio', video: 'video', pdf: 'file' };

function modalities(value: unknown): Modality[] | null {
  return Array.isArray(value) ? [...new Set(value.map((item) => MODALITIES[String(item)]).filter((item) => item !== undefined))] : null;
}

// Credits come as decimal strings, such as "95.50".
function decimal(value: unknown): number | null {
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : amount(value);
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

export const vercel: ConnectionType = {
  id: 'vercel',
  label: 'Vercel AI Gateway',
  group: 'gateway',
  description: '여러 회사의 모델을 키 하나로 써요. 남은 잔액도 보여요.',
  keyPage: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys',
  endpoint: { baseUrl: API, protocol: 'chat-completions' },
  detect: { key: /^vck_/, host: 'ai-gateway.vercel.sh' },

  // The list also holds image, video, embedding and speech models; only language models chat.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
    return payload.data
      .filter((raw): raw is Record<string, unknown> => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '' && raw.type === 'language')
      .map((raw) => {
        const kinds = isRecord(raw.modalities) ? raw.modalities : {};
        const tags = Array.isArray(raw.tags) ? raw.tags : null;
        return {
          id: raw.id as string,
          name: typeof raw.name === 'string' && raw.name ? raw.name : (raw.id as string),
          input: modalities(kinds.input),
          output: modalities(kinds.output),
          contextLength: count(raw.context_window),
          maxOutput: count(raw.max_tokens),
          reasoning: tags ? tags.includes('reasoning') : null,
          tools: tags ? tags.includes('tool-use') : null,
          protocol: null,
        };
      });
  },

  // The team's credits, not the key's: every key of a team draws on one balance.
  meters: {
    request: (secret) => ({ url: `${API}/credits`, method: 'GET', headers: bearer(secret), body: null }),
    parse(payload) {
      if (!isRecord(payload)) return null;
      const balance = decimal(payload.balance);
      const used = decimal(payload.total_used);
      return [
        ...(balance === null ? [] : [{ kind: 'left' as const, label: '잔액', unit: 'usd' as const, amount: balance, limit: null, resets: null }]),
        ...(used === null ? [] : [{ kind: 'spent' as const, label: '지금까지 쓴 돈', unit: 'usd' as const, amount: used }]),
      ];
    },
  },

  // Each stream event carries the generation id (gen_…) as its id.
  settle: {
    request: (secret, id) => ({ url: `${API}/generation?id=${encodeURIComponent(id)}`, method: 'GET', headers: bearer(secret), body: null }),
    parse(payload) {
      const cost = isRecord(payload) && isRecord(payload.data) ? amount(payload.data.total_cost) : null;
      return cost === null ? null : { unit: 'usd', amount: cost };
    },
  },
};
