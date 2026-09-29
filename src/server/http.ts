import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type Account = { id: string; username: string };
// Account and object ids are UUIDs made by the client.
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AppEnv = { Bindings: Env; Variables: { account: Account } };

export function fail(c: Context, status: ContentfulStatusCode, error: string, detail: Record<string, unknown> = {}) {
  return c.json({ error, ...detail }, status);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return hex(digest);
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
