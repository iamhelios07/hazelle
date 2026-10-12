import type { ModelSettings } from '../connectors/settings';
import type { From } from '../engine/pipeline';
import { inverted } from './memory';
import type { Role } from './prompt';

// One message as the provider's cache reads it: hash of its role and content, its tokens as the prompt counted them
// (o200k_base, an estimate for any other tokenizer), where the prompt took it from, and whether a cache point ends it.
export type WireMessage = { role: Role; hash: string; tokens: number; from: From; point?: true };

// The chat's last reply call that sent a cache point, as the provider's cache reads it: messages in wire order
// (connectors/registry CacheView). One object per chat at cachePrintId(chat), parent the chat, replaced by each such
// call. account: the connection's account that served it; null where unknown.
export type CachePrint = {
  call: string;
  connection: string;
  account: string | null;
  model: string;
  reasoning?: ModelSettings['reasoning'];
  messages: WireMessage[];
};

// Why a send reads less than the last call cached. expired: the last call's TTL ran out. far: the next point lies
// past the provider's lookback from the last point it could read. changed, added, removed: a message of the prompt.
export type CacheBreak =
  | { kind: 'model' | 'account' | 'reasoning' | 'off' | 'expired' | 'far' }
  | { kind: 'changed' | 'added' | 'removed'; from: From; role: Role };

// read: the tokens the send would read from the cache, of all the last call cached up to its last point. broken: the
// first reason in wire order, null when it reads all of it. Kept on the send's receipt (model/chat Receipt forecast).
export type CacheForecast = { read: number; of: number; broken: CacheBreak | null };

// The chat's id with its second group's hex digits inverted, as memoryId inverts the first and vectorsId the last.
export const cachePrintId = (chat: string) => chat.replace(/^([0-9a-f]{8}-)([0-9a-f]{4})/, (_, head: string, group: string) => head + inverted(group));
