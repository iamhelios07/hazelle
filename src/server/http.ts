import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type Account = { id: string; username: string };
export type AppEnv = { Bindings: Env; Variables: { account: Account } };

export function fail(c: Context, status: ContentfulStatusCode, error: string, detail: Record<string, unknown> = {}) {
  return c.json({ error, ...detail }, status);
}

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
