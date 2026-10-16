import { createHmac } from 'node:crypto';
import { sha256Hex } from '../http';

// AWS Signature Version 4 in the Authorization header, as R2's S3 API takes it.

export type Signer = { accessKeyId: string; secretAccessKey: string; region: string; service: string };

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

// RFC 3986 unreserved characters stay; encodeURIComponent leaves five more.
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// headers: every header to sign, host among them. amzDate: the x-amz-date value, YYYYMMDDTHHMMSSZ. The path is signed as
// the URL encodes it, which is S3's single encoding for the keys this server writes.
export function authorization(signer: Signer, method: string, url: URL, headers: Record<string, string>, payloadHash: string, amzDate: string): string {
  const query = [...url.searchParams]
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const values = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')]));
  const signed = names.join(';');
  const canonical = [method, url.pathname, query, names.map((name) => `${name}:${values[name]}\n`).join(''), signed, payloadHash].join('\n');
  const scope = `${amzDate.slice(0, 8)}/${signer.region}/${signer.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${signer.secretAccessKey}`, amzDate.slice(0, 8)), signer.region), signer.service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${signer.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256', key).update(toSign).digest('hex')}`;
}
