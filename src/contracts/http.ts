// An answer that changed or read an account's counts carries them, so the page holding the account stays current.
export const ACCOUNT_USAGE_HEADERS = { bytes: 'x-account-bytes', fileBytes: 'x-account-file-bytes' } as const;
export const ACCOUNT_HEADER = 'x-account';
export const RELAY_HEADER = 'x-relay';
// The chat whose bot's script makes a relayed call (an embedding), counted in that chat's cap as its streams are.
export const BOT_HEADER = 'x-hazelle-bot';
