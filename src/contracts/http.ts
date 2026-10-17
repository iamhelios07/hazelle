// An answer that changed or read an account's counts carries them, so the page holding the account stays current.
export const ACCOUNT_USAGE_HEADERS = { bytes: 'x-account-bytes', fileBytes: 'x-account-file-bytes' } as const;
export const ACCOUNT_HEADER = 'x-account';
// The release the server runs, on every API answer, so a page built from an older one can offer a reload.
export const VERSION_HEADER = 'x-hazelle-version';
export const RELAY_HEADER = 'x-relay';
// The chat whose bot's script makes a relayed call (an embedding), counted in that chat's cap as its streams are.
export const BOT_HEADER = 'x-hazelle-bot';
// Who sent a request, as the public listener saw it (server/frontend-worker): the key of the per-visitor limits.
export const VISITOR_HEADER = 'x-hazelle-visitor';

// Every `error` an API answer carries (server/http fail, server/stream-box). The client words each one or names it on
// its generic fallback (app/common/failure), so a code added here fails tsc until it is decided there.
export type ServerError =
  | 'account-busy'
  | 'account-leaving'
  | 'account-mismatch'
  | 'account-restoring'
  | 'bad-body'
  | 'bad-content-type'
  | 'bad-id'
  | 'bad-input'
  | 'bad-key'
  | 'bad-report'
  | 'bad-time'
  | 'bad-username'
  | 'busy'
  | 'cache-reset'
  | 'cannot-cancel'
  | 'cannot-undo'
  | 'conflict'
  | 'file-blocked'
  | 'files-full'
  | 'length-required'
  | 'no-consent'
  | 'no-session'
  | 'not-admin'
  | 'not-found'
  | 'server-error'
  | 'share-held'
  | 'signup-closed'
  | 'sole-operator'
  | 'storage-full'
  | 'store-unavailable'
  | 'stream-exists'
  | 'stream-gone'
  | 'suspended'
  | 'too-large'
  | 'too-many-attempts'
  | 'too-many-bot-calls'
  | 'too-many-calls'
  | 'too-many-live-calls'
  | 'too-many-publishes'
  | 'too-many-reports'
  | 'too-many-restores'
  | 'too-many-shares'
  | 'too-many-signups'
  | 'too-many-versions'
  | 'too-many-visits'
  | 'too-many-writes'
  | 'username-taken'
  | 'wrong-login';
// The relay's own refusals, answered marked RELAY_HEADER: error (server/relay).
export type RelayError = 'bad-envelope' | 'not-https' | 'not-public' | 'upstream-unreachable' | 'upstream-redirect' | 'upstream-not-api' | 'relay-traffic-limit' | 'relay-host-limit';
