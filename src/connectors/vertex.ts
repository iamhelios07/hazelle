import { bareModel } from './chat-completions';
import { ConnectorError, type ConnectionType, type Endpoint } from './types';
import { isRecord } from './values';

// Vertex AI with a service-account key, checked against a live service account on 2026-10-13: the key signs a JWT that
// buys an hour's access token, a reply is asked of the project's global location in the Gemini API's format (refused
// without the project), and the model list answers only outside a project, at v1beta1.

type ServiceAccount = { projectId: string; keyId: string; privateKey: string; clientEmail: string; tokenUri: string };

function serviceAccount(secret: string): ServiceAccount | null {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.type !== 'service_account') return null;
  const account = { projectId: raw.project_id, keyId: raw.private_key_id, privateKey: raw.private_key, clientEmail: raw.client_email, tokenUri: raw.token_uri };
  return Object.values(account).every((field) => typeof field === 'string' && field) ? (account as ServiceAccount) : null;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encoded = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

// A key file whose private key is cut short or edited is refused here, before anything is sent.
async function signingKey(pem: string): Promise<CryptoKey> {
  try {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (char) => char.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new ConnectorError('unreadable-key');
  }
}

async function signed(account: ServiceAccount, now: number): Promise<string> {
  const key = await signingKey(account.privateKey);
  const iat = Math.floor(now / 1000);
  const body = `${encoded({ alg: 'RS256', typ: 'JWT', kid: account.keyId })}.${encoded({ iss: account.clientEmail, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: account.tokenUri, iat, exp: iat + 3600 })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export const vertex: ConnectionType = {
  id: 'vertex',
  label: 'Vertex AI',
  group: 'maker',
  description: '서비스 계정 키(JSON)로 Vertex AI의 Gemini를 사용해요.',
  keyPage: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  detect: { key: /^\{[\s\S]*"type"\s*:\s*"service_account"[\s\S]*\}$/, host: 'aiplatform.googleapis.com' },
  endpointFor(secret): Endpoint | null {
    const account = serviceAccount(secret);
    return account && { baseUrl: `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/locations/global/publishers/google`, protocol: 'gemini' };
  },
  // Asked only of a secret endpointFor read, so it is a service-account key.
  exchange: {
    async request(secret) {
      const account = serviceAccount(secret)!;
      const assertion = await signed(account, Date.now());
      return {
        url: account.tokenUri,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      };
    },
    parse(payload) {
      if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token) return null;
      const lasts = payload.expires_in;
      if (typeof lasts !== 'number' || !Number.isFinite(lasts)) return null;
      return { value: payload.access_token, expiresAt: Date.now() + lasts * 1000 };
    },
  },
  headers: (token) => ({ authorization: `Bearer ${token}` }),
  // 300 is the most a page holds (a larger size is refused with 400); a later page (nextPageToken) is not asked for.
  listModels: () => ({ url: 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300', method: 'GET', headers: {}, body: null }),
  // The list names models and nothing of what they take or give; models.dev's google-vertex list fills what it knows.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.publisherModels)) return null;
    return payload.publisherModels.flatMap((raw) => {
      const id = isRecord(raw) && typeof raw.name === 'string' ? raw.name.split('/').at(-1) : '';
      return id ? [bareModel(id)] : [];
    });
  },
  usagePage: 'https://console.cloud.google.com/billing',
  // The gemini codec embeds through batchEmbedContents; Vertex AI embeds through predict.
  embeds: null,
};
