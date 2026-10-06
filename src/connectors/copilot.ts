import { effortLevels, type ReasoningTakes } from './settings';
import type { ConnectionType, HttpRequest, Meter, Modality, Model, Protocol } from './types';
import { count, isRecord, modelEntries, nameOf } from './values';

// Copilot serves only clients it knows, so every request names VS Code's Copilot Chat, as provider-hub
// did. The versions are the ones it last sent successfully.
const CLIENT_ID = '01ab8ac9400c4e429b23';
const CHAT_VERSION = '0.37.4';
// api.github.com refuses a request without a User-Agent, and a relayed request carries only the
// headers set here.
const USER_AGENT = { 'user-agent': `GitHubCopilotChat/${CHAT_VERSION}` };

const API = 'https://api.githubcopilot.com';

// The endpoints a model may declare, in order of preference. A model that declares only /responses
// has no codec yet.
const ENDPOINTS: [string, Protocol][] = [
  ['/v1/messages', 'anthropic-messages'],
  ['/chat/completions', 'chat-completions'],
];

const github = (url: string, secret: string, accept = 'application/json'): HttpRequest => ({
  url,
  method: 'GET',
  headers: { authorization: `Bearer ${secret}`, accept, ...USER_AGENT },
  body: null,
});

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

// An older list without supported_endpoints was served entirely over chat completions.
function protocol(raw: Record<string, unknown>): Model['protocol'] {
  const declared = Array.isArray(raw.supported_endpoints) ? raw.supported_endpoints : [];
  if (declared.length === 0) return null;
  return ENDPOINTS.find(([path]) => declared.includes(path))?.[1] ?? 'unsupported';
}

// Reasoning shows up as thinking, adaptive thinking or a list of effort levels; any one of them decides.
function reasoning(supports: Record<string, unknown>): boolean | null {
  const effort = Array.isArray(supports.reasoning_effort) ? supports.reasoning_effort.length > 0 : null;
  const signals = [flag(supports.thinking), flag(supports.adaptive_thinking), effort].filter((signal) => signal !== null);
  return signals.length ? signals.includes(true) : null;
}

// Copilot lists no sampling parameters, only reasoning ones. thinking is budgeted thinking, bounded by
// min_thinking_budget and max_thinking_budget.
function reasoningTakes(supports: Record<string, unknown>): ReasoningTakes {
  const efforts = effortLevels(supports.reasoning_effort);
  const min = count(supports.min_thinking_budget);
  const max = count(supports.max_thinking_budget);
  const budgeted = flag(supports.thinking) ?? (min !== null || max !== null ? true : null);
  return {
    off: efforts?.none ? true : null,
    levels: efforts?.levels ?? null,
    budget: budgeted === null ? null : budgeted && { min, max },
    adaptive: flag(supports.adaptive_thinking),
  };
}

// The allowance model use draws on: AI credits on token billing, premium requests before it. An
// unlimited plan, or an organization's shared pool, reports no figure for one account.
function quota(payload: unknown): Meter[] | null {
  if (!isRecord(payload) || !isRecord(payload.quota_snapshots)) return null;
  const premium = payload.quota_snapshots.premium_interactions;
  if (!isRecord(premium) || premium.unlimited === true) return [];
  const limit = typeof premium.entitlement === 'number' && premium.entitlement > 0 ? premium.entitlement : null;
  const left = premium.quota_remaining ?? premium.remaining;
  if (limit === null || typeof left !== 'number' || !Number.isFinite(left)) return [];
  const credits = payload.token_based_billing === true;
  const date = payload.quota_reset_date_utc ?? payload.quota_reset_date;
  const at = typeof date === 'string' ? Date.parse(date) : NaN;
  return [
    {
      kind: 'left',
      label: credits ? 'AI 크레딧' : '프리미엄 요청',
      unit: credits ? 'credit' : 'requests',
      // Past the allowance, overage is billed separately; what is left of the allowance is none.
      amount: Math.max(left, 0),
      limit,
      resets: Number.isFinite(at) ? { at } : null,
    },
  ];
}

// copilot_plan as GitHub's own clients read it; a value none of these match is shown as it came.
function plan(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.copilot_plan !== 'string' || !payload.copilot_plan) return null;
  const sku = payload.copilot_plan.toLowerCase().replace(/[- ]/g, '_');
  if (/business|enterprise/.test(sku)) return '조직 관리형';
  if (sku.includes('max')) return 'Copilot Max';
  if (/pro_?plus|pro\+/.test(sku)) return 'Copilot Pro+';
  if (sku.includes('pro')) return 'Copilot Pro';
  return payload.copilot_plan;
}

export const copilot: ConnectionType = {
  id: 'copilot',
  label: 'Copilot',
  group: 'subscription',
  major: true,
  description: 'GitHub Copilot 구독으로 Claude, GPT 같은 모델을 써요.',
  endpoint: { baseUrl: API, protocol: 'chat-completions' },
  routes: { 'anthropic-messages': `${API}/v1` },

  signIn: {
    site: 'GitHub',
    codeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: CLIENT_ID,
    scope: 'user:email',
    headers: USER_AGENT,
    account: {
      request: (secret) => github('https://api.github.com/user', secret, 'application/vnd.github+json'),
      parse: (payload) => (isRecord(payload) && typeof payload.login === 'string' && payload.login ? payload.login : null),
    },
  },

  // The stored GitHub token buys a Copilot token that lasts about half an hour.
  exchange: {
    request: (secret) => github('https://api.github.com/copilot_internal/v2/token', secret),
    parse(payload) {
      if (!isRecord(payload) || typeof payload.token !== 'string' || !payload.token) return null;
      const expiresAt = payload.expires_at;
      if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
      return { value: payload.token, expiresAt: expiresAt * 1000 };
    },
  },

  headers: (token) => ({
    authorization: `Bearer ${token}`,
    'copilot-integration-id': 'vscode-chat',
    'editor-version': 'vscode/1.109.2',
    'editor-plugin-version': `copilot-chat/${CHAT_VERSION}`,
    ...USER_AGENT,
  }),

  pool: true,
  meters: [{
    request: (secret) => github('https://api.github.com/copilot_internal/user', secret),
    parse: quota,
    plan,
  }],
  usagePage: 'https://github.com/settings/billing',

  // The list also holds embedding models, and models that VS Code's model picker does not offer.
  parseModels(payload) {
    const entries = modelEntries(payload);
    if (!entries) return null;
    return entries
      .filter((raw) => raw.model_picker_enabled !== false && (!isRecord(raw.capabilities) || (raw.capabilities.type ?? 'chat') === 'chat'))
      .map((raw) => {
        const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {};
        const limits = isRecord(capabilities.limits) ? capabilities.limits : {};
        const supports = isRecord(capabilities.supports) ? capabilities.supports : {};
        const vision = flag(supports.vision);
        const input: Modality[] | null = vision === null ? null : vision ? ['text', 'image'] : ['text'];
        return {
          id: raw.id,
          name: nameOf(raw, 'name'),
          input,
          output: ['text'],
          contextLength: count(limits.max_context_window_tokens),
          maxOutput: count(limits.max_output_tokens),
          reasoning: reasoning(supports),
          tools: flag(supports.tool_calls),
          protocol: protocol(raw),
          takes: { settings: null, reasoning: reasoningTakes(supports) },
        };
      });
  },
};
