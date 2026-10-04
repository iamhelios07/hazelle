import type { ConnectionType } from './types';
import { decimal, isRecord } from './values';

export const nanogpt: ConnectionType = {
  id: 'nanogpt',
  label: 'NanoGPT',
  group: 'gateway',
  description: '여러 회사의 모델을 NanoGPT 키 하나로 써요. 남은 잔액도 보여요.',
  keyPage: 'https://nano-gpt.com/api',
  // The direct API host, which its docs name for API-key requests; nano-gpt.com is the website's.
  endpoint: { baseUrl: 'https://api.nano-gpt.com/api/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.nano-gpt.com' },

  // Its model list answers without a key, so this call is what checks a pasted one.
  meters: {
    request: (secret) => ({ url: 'https://api.nano-gpt.com/api/check-balance', method: 'POST', headers: { 'x-api-key': secret }, body: null }),
    parse(payload) {
      if (!isRecord(payload)) return null;
      const balance = decimal(payload.usd_balance);
      return balance === null ? [] : [{ kind: 'left', label: '잔액', unit: 'usd', amount: balance, limit: null, resets: null }];
    },
  },
};
