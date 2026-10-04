export const STORE_ADMIN = '00000000-0000-4000-8000-000000000001';

// Generated only by the store spec's local Wrangler config. Inherited store methods and the built HTTP handler
// stay untouched; the probes expose physical storage and delay real binding calls, never replace their results.
export function storeSpecWorker(entry: string) {
  return `
import app, { AccountStore as BuiltStore } from ${JSON.stringify(entry)};
export { Relay, ReplyStream } from ${JSON.stringify(entry)};

export class AccountStore extends BuiltStore {
  constructor(ctx, env) {
    const probe = { instance: crypto.randomUUID(), reads: 0, delay: 0 };
    const DB = new Proxy(env.DB, {
      get(db, key) {
        if (key !== 'prepare') return typeof db[key] === 'function' ? db[key].bind(db) : db[key];
        return (sql) => {
          const statement = db.prepare(sql);
          if (sql !== 'SELECT state, timeline, operation FROM accounts WHERE incarnation = ?') return statement;
          return { bind: (...args) => ({ first: async () => {
            probe.reads++;
            if (probe.delay) await new Promise(resolve => setTimeout(resolve, probe.delay));
            return statement.bind(...args).first();
          } }) };
        };
      },
    });
    super(ctx, { ...env, DB });
    this.probe = probe;
  }
  inspect() {
    const storage = this.ctx.storage;
    const tables = storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('head', 'objects') ORDER BY name").toArray().map(row => row.name);
    return {
      ...this.probe, tables,
      head: tables.includes('head') ? storage.sql.exec('SELECT rev, bytes, timeline FROM head').one() : null,
      objects: tables.includes('objects') ? storage.sql.exec('SELECT COUNT(*) AS n FROM objects').one().n : 0,
      keys: [...storage.kv.list({ limit: 10 })].map(([key]) => key),
    };
  }
  delayWake() { this.probe.delay = 200; }
  seedKey() { this.ctx.storage.kv.put('store-spec-marker', 'must disappear'); }
}

const holds = new Map();
const rpcMethods = new Set(['status', 'usage', 'feed', 'batch', 'restart', 'destroy', 'inspect', 'delayWake', 'seedKey']);
export default {
  scheduled: app.scheduled,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__store-spec/operator') {
      const token = crypto.randomUUID();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
      await env.DB.batch([
        env.DB.prepare("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES (?, 'store-operator', 'unused', ?, lower(hex(randomblob(16))), lower(hex(randomblob(16)))) ON CONFLICT (id) DO NOTHING").bind(env.ADMIN_ACCOUNT, Date.now()),
        env.DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(hash, env.ADMIN_ACCOUNT, Date.now() + 3600000),
        // Fresh prices: otherwise the sweep test's scheduled run downloads models.dev's 5 MB list live (1 s to 40 s).
        env.DB.prepare('UPDATE price_fetch SET fetched_at = ? WHERE id = 1').bind(Date.now()),
      ]);
      return Response.json({ accountId: env.ADMIN_ACCOUNT, cookie: '__Host-session=' + token });
    }
    if (url.pathname === '/__store-spec/rpc') {
      const { incarnation, method, args = [] } = await request.json();
      if (!rpcMethods.has(method)) return new Response(null, { status: 400 });
      try {
        const answer = await env.STORES.getByName(incarnation)[method](...args);
        return Response.json({ answer: answer ?? null });
      } catch (error) {
        return Response.json({ thrown: String(error) });
      }
    }
    if (url.pathname === '/__store-spec/prefix') {
      const prefix = 'files/' + url.searchParams.get('incarnation') + '/';
      const listed = await env.BLOBS.list({ prefix, limit: 20 });
      return Response.json({ keys: listed.objects.map(object => object.key), truncated: listed.truncated });
    }
    if (url.pathname === '/__store-spec/file') {
      const file = await env.BLOBS.get(url.searchParams.get('key'));
      return file ? new Response(file.body) : new Response(null, { status: 404 });
    }
    if (url.pathname === '/__store-spec/hold') {
      const { key } = await request.json();
      const token = crypto.randomUUID();
      holds.set(token, { key, released: false, entered: false });
      return Response.json({ token });
    }
    if (url.pathname.startsWith('/__store-spec/hold/')) {
      const token = url.pathname.split('/').pop();
      const hold = holds.get(token);
      if (!hold) return new Response(null, { status: 404 });
      if (request.method === 'POST') {
        hold.released = true;
        holds.delete(token);
      }
      return Response.json({ entered: hold.entered });
    }
    const hold = holds.get(request.headers.get('x-store-spec-hold'));
    if (hold) {
      const BLOBS = new Proxy(env.BLOBS, { get(bucket, method) {
        if (method === 'put') return async (...args) => {
          if (args[0] !== hold.key) throw new Error('Wrong held upload key');
          hold.entered = true;
          // Timers belong to the upload request: awaiting a promise owned by the finished hold request hangs.
          for (let attempt = 0; !hold.released && attempt < 400; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
          if (!hold.released) throw new Error('The upload hold was not released within ten seconds');
          return bucket.put(...args);
        };
        return typeof bucket[method] === 'function' ? bucket[method].bind(bucket) : bucket[method];
      } });
      return app.fetch(request, { ...env, BLOBS }, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};
`;
}
