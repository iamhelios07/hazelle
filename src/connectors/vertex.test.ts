import { describe, expect, it } from 'vitest';
import { catalogRequest, chatRequest, detect, embedRoute, parseCatalog, resolveConnection, withCredential, type Route } from './registry';
import { decodeStream } from './stream';
import type { Connection } from './types';
import { vertex } from './vertex';

const pem = (der: ArrayBuffer) => `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der))).replace(/.{64}/g, '$&\n')}\n-----END PRIVATE KEY-----\n`;
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
const decoded = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part))) as Record<string, unknown>;

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const key = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'key-id',
  private_key: pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  client_email: 'bot@test-project.iam.gserviceaccount.com',
  client_id: '1',
  token_uri: 'https://oauth2.googleapis.com/token',
};
const secret = JSON.stringify(key, null, 2);
const connection: Connection = { type: 'vertex', label: 'Vertex AI', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret }], turns: null, starred: [] };

describe('Vertex AI', () => {
  it('signs an RS256 assertion with the key and trades it for an access token', async () => {
    const request = await vertex.exchange!.request(secret);
    expect(request).toMatchObject({ url: key.token_uri, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const form = new URLSearchParams(request.body!);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.get('assertion')!.split('.') as [string, string, string];
    expect(decoded(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'key-id' });
    const { iat, exp, ...rest } = decoded(claims);
    expect(rest).toEqual({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: key.token_uri });
    expect(exp).toBe((iat as number) + 3600);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, fromBase64url(signature), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);

    const before = Date.now();
    expect(vertex.exchange!.parse({ access_token: 'token', expires_in: 3599, token_type: 'Bearer' })!.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(vertex.exchange!.parse({ error: 'invalid_grant' })).toBeNull();
    await expect(vertex.exchange!.request(JSON.stringify({ ...key, private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n' }))).rejects.toThrow('unreadable-key');
  });

  it('is found by its key, sends replies to the project the key names, and embeds nothing there', () => {
    expect(detect(secret)).toMatchObject({ kind: 'key', type: { id: 'vertex' } });
    const route = resolveConnection(connection) as Route;
    expect(route.endpoint).toEqual({ baseUrl: 'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google', protocol: 'gemini' });
    const model = parseCatalog(route, { publisherModels: [{ name: 'publishers/google/models/gemini-2.5-flash' }] })![0]!;
    const request = withCredential(route, chatRequest(route, { model, messages: [{ role: 'user', content: '안녕' }], settings: {} }), 'token');
    expect(request.url).toBe('https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(request.headers.authorization).toBe('Bearer token');
    expect(embedRoute(connection, model)).toBeNull();
    expect(resolveConnection({ ...connection, accounts: [{ id: 'key', secret: '{"type": "service_account"}' }] })).toBeNull();
  });

  it('lists the publisher models outside the project, every entry by its last name segment and nothing more', () => {
    const route = resolveConnection(connection) as Route;
    expect(catalogRequest(route).url).toBe('https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300');
    const models = parseCatalog(route, { publisherModels: [{ name: 'publishers/google/models/gemini-3.5-flash', launchStage: 'GA' }, { name: 'publishers/google/models/gemini-2.5-flash-tts' }, { versionId: '001' }] });
    expect(models!.map(({ id, name, input, output, contextLength }) => [id, name, input, output, contextLength])).toEqual([
      ['gemini-3.5-flash', 'gemini-3.5-flash', null, null, null],
      ['gemini-2.5-flash-tts', 'gemini-2.5-flash-tts', null, null, null],
    ]);
    expect(parseCatalog(route, { models: [] })).toBeNull();
  });

  it('asks for Flex with both headers only on the discount lane, and halves only a reply Flex served', async () => {
    const route = resolveConnection(connection) as Route;
    const [model] = parseCatalog(route, { publisherModels: [{ name: 'publishers/google/models/gemini-3-flash-preview' }] })!;
    const asked = (settings: { discount?: true }) => withCredential(route, chatRequest(route, { model: model!, messages: [{ role: 'user', content: '안녕' }], settings }), 'token').headers;
    expect(asked({ discount: true })).toMatchObject({ 'x-vertex-ai-llm-request-type': 'shared', 'x-vertex-ai-llm-shared-request-type': 'flex', authorization: 'Bearer token' });
    expect(Object.keys(asked({})).filter((name) => name.startsWith('x-vertex-ai-'))).toEqual([]);

    const priced = { ...model!, price: { input: 2, output: 8, cacheRead: null, cacheWrite: null, tiers: [] } };
    const reply = (trafficType: string) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '안녕' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, trafficType } }), { headers: { 'content-type': 'application/json' } });
    const flex = await decodeStream(route, priced, reply('ON_DEMAND_FLEX'), new AbortController().signal, () => {});
    expect(flex).toMatchObject({ discount: 'tier', cost: { amount: (2 + 8) / 2 } });
    const standard = await decodeStream(route, priced, reply('ON_DEMAND'), new AbortController().signal, () => {});
    expect(standard.discount).toBeUndefined();
    expect(standard.cost).toMatchObject({ amount: 2 + 8 });
  });
});
