import { Hono } from 'hono';
import { fail, readObject, type AppEnv } from './http';
import { requireSession } from './session';

// The server stores the wrapped keys without understanding them (tech-spec §4). The cap only keeps
// rows small: a real wrap is under 100 characters and the KDF parameters under 200.
const MAX_FIELD_LENGTH = 1024;

export const vaults = new Hono<AppEnv>();

vaults.use(requireSession);

vaults.get('/', async (c) => {
  const row = await c.env.DB.prepare('SELECT kdf, passphrase_wrap, recovery_wrap FROM vaults WHERE account_id = ?')
    .bind(c.get('account').id)
    .first<{ kdf: string; passphrase_wrap: string; recovery_wrap: string }>();
  if (!row) return fail(c, 404, 'no-vault');
  return c.json({ kdf: JSON.parse(row.kdf), passphraseWrap: row.passphrase_wrap, recoveryWrap: row.recovery_wrap });
});

vaults.post('/', async (c) => {
  const body = await readObject(c);
  const kdf = readKdf(body?.kdf);
  const passphraseWrap = readField(body?.passphraseWrap);
  const recoveryWrap = readField(body?.recoveryWrap);
  if (!kdf || !passphraseWrap || !recoveryWrap) return fail(c, 400, 'bad-input');
  const now = Date.now();
  const result = await c.env.DB.prepare(
    'INSERT INTO vaults (account_id, kdf, passphrase_wrap, recovery_wrap, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (account_id) DO NOTHING',
  )
    .bind(c.get('account').id, kdf, passphraseWrap, recoveryWrap, now, now)
    .run();
  if (result.meta.changes === 0) return fail(c, 409, 'vault-exists');
  return c.json({}, 201);
});

vaults.put('/passphrase', async (c) => {
  const body = await readObject(c);
  const kdf = readKdf(body?.kdf);
  const passphraseWrap = readField(body?.passphraseWrap);
  if (!kdf || !passphraseWrap) return fail(c, 400, 'bad-input');
  const result = await c.env.DB.prepare('UPDATE vaults SET kdf = ?, passphrase_wrap = ?, updated_at = ? WHERE account_id = ?')
    .bind(kdf, passphraseWrap, Date.now(), c.get('account').id)
    .run();
  if (result.meta.changes === 0) return fail(c, 404, 'no-vault');
  return c.body(null, 204);
});

function readKdf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return readField(JSON.stringify(value));
}

function readField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH ? value : null;
}
