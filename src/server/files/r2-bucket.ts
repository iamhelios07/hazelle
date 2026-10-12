import { checkedKey, checkedPrefix, isKey, isPrefix, type R2Bucket } from './bucket';
import { authorization, sha256Hex, type Signer } from './sigv4';

// Pictures in an R2 bucket through its S3 API, path-style: <endpoint>/<bucket>/<key>. A PUT that answered 200 is
// durable, and an object is whole or absent, so nothing is left for a sweep. The server reads it through the copy on
// its disk (cached-r2-bucket.ts), which has the trim.

export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

const HEADERS_MS = 30_000;
// Deletes at a time while a prefix is removed: R2 deletes one key per request.
const DELETES = 8;
const EMPTY = sha256Hex('');

const unescape = (text: string) =>
  text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]!);
const tags = (xml: string, pattern: RegExp) => [...xml.matchAll(pattern)].map((match) => unescape(match[1]!));

export function r2Bucket(config: R2Config): R2Bucket {
  const signer: Signer = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: 'auto', service: 's3' };
  const base = new URL(config.endpoint);

  // Only the wait for the answer's headers is timed: a picture's body streams to a reader as slowly as it reads.
  const send = async (method: string, path: string, query: Record<string, string> = {}, body?: Uint8Array<ArrayBuffer>) => {
    const url = new URL(`/${config.bucket}/${path}`, base);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const payload = body ? sha256Hex(body) : EMPTY;
    // fetch sends the host itself.
    const headers = { 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
    const signed = { host: url.host, ...headers };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error(`r2: ${method} ${path} had no answer in ${HEADERS_MS / 1000} s`)), HEADERS_MS);
    try {
      return await fetch(url, { method, headers: { ...headers, authorization: authorization(signer, method, url, signed, payload, amzDate) }, body, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  // A refusal names the request and its status, never the credential.
  const refused = async (response: Response, what: string): Promise<never> => {
    await response.body?.cancel();
    throw new Error(`r2: ${what} answered ${response.status}`);
  };

  // ListObjectsV2, every page.
  const listing = async (query: Record<string, string>) => {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | null = null;
    do {
      const response = await send('GET', '', { 'list-type': '2', ...query, ...(token ? { 'continuation-token': token } : {}) });
      if (!response.ok) await refused(response, `list ${query.prefix}`);
      const xml = await response.text();
      keys.push(...tags(xml, /<Key>([^<]*)<\/Key>/g));
      prefixes.push(...tags(xml, /<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (tags(xml, /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/g)[0] ?? null) : null;
    } while (token);
    return { keys, prefixes };
  };

  const remove = async (key: string) => {
    const response = await send('DELETE', checkedKey(key));
    if (!response.ok && response.status !== 404) await refused(response, `delete ${key}`);
    await response.body?.cancel();
  };
  const list = async (prefix: string) => (await listing({ prefix: checkedPrefix(prefix) })).keys.filter(isKey).sort();

  return {
    kind: 'r2',
    put: async (key, body) => {
      // A view of an ArrayBuffer is sent as it is; a Uint8Array, which may view a shared buffer, is copied.
      const response = await send('PUT', checkedKey(key), {}, body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body));
      if (!response.ok) await refused(response, `put ${key}`);
      await response.body?.cancel();
    },
    get: async (key) => {
      const response = await send('GET', checkedKey(key));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || !response.body) return refused(response, `get ${key}`);
      return response.body;
    },
    head: async (key) => {
      const response = await send('HEAD', checkedKey(key));
      if (response.status === 404) return null;
      if (!response.ok) return refused(response, `head ${key}`);
      return Number(response.headers.get('content-length'));
    },
    delete: remove,
    list,
    deletePrefix: async (prefix) => {
      const keys = await list(prefix);
      for (let start = 0; start < keys.length; start += DELETES) await Promise.all(keys.slice(start, start + DELETES).map(remove));
    },
    prefixes: async () => (await listing({ prefix: 'files/', delimiter: '/' })).prefixes.filter(isPrefix).sort(),
    trim: async () => [],
  };
}
