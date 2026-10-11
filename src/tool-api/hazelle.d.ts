declare const hazelle: Hazelle.Api;
declare namespace Hazelle {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  type Role = 'user' | 'char';
  // index: place after the greeting (index 0 = first message after it), as Lua counts. id: the message's, the same
  // across its versions. version: the version shown. text: as the prompt reads it.
  interface Message { index: number; id: string; version: string; role: Role; text: string; time: number }
  type At = { index: number; id: string; version: string };
  interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
  type ModelRefusal = 'not-allowed' | 'not-declared' | 'no-model' | 'flood' | 'failed';
  type ModelAnswer = { ok: true; text: string } | { ok: false; reason: ModelRefusal };
  // model: the embedding model that made the vectors; vectors from another model cannot be compared with them.
  type EmbedAnswer = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: ModelRefusal | 'too-large' };
  type Question = { kind: 'input'; text: string } | { kind: 'confirm'; text: string } | { kind: 'select'; text?: string; options: string[] };
  type Settings = Record<string, string | number | boolean>;

  interface ChatState {                         // this tool's own per-chat variables, replayed with the story
    get<T extends Json = Json>(key: string): Promise<T | undefined>;
    set(key: string, value: Json): void;        // lands with the event's outcome; from a page, after the latest message
    delete(key: string): void;
  }
  // This tool's data for this chat: synced, goes with the chat and its branches, not versioned. Vectors keep best as
  // base64 float32 or int8, not JSON numbers. A message id it holds that the chat no longer has is stale: a branch made
  // while the tool was off keeps the source chat's ids.
  interface ChatData {
    get<T extends Json = Json>(key: string): Promise<T | undefined>;
    set(key: string, value: Json): void;        // lands with the event's outcome
    delete(key: string): void;
    keys(): Promise<string[]>;
  }
  interface Chat {
    readonly id: string;
    readonly character: { name: string; description: string } | null;
    readonly persona: { name: string; description: string } | null;
    readonly length: number;
    messages(from?: number, to?: number): Promise<Message[]>;
    greeting(): Promise<string | null>;         // the character's opening message, before index 0
    readonly state: ChatState;
    readonly data: ChatData;
    edit(index: number, text: string): void;    // a new version, as Lua's setChat; throws in change and branch
    add(role: Role, text: string): void;        // as Lua's addChat; throws in change and branch
    model(role: 'main' | 'aux', messages: ModelMessage[]): Promise<ModelAnswer>;   // needs //@uses model
    // needs //@uses embed. as: what the texts are for, which retrieval-tuned models embed differently.
    embed(texts: string[], as?: 'query' | 'document'): Promise<EmbedAnswer>;
    badge(index: number, text: string | null): void;   // on the version shown now; lands with the outcome
    tokens(text: string): Promise<number>;
    lore(reserve?: number): Promise<{ role: 'system' | 'user' | 'assistant'; text: string }[]>;
    ask(question: Question): Promise<string | null>;
    say(text: string, tone?: 'normal' | 'error'): void;
  }
  interface Storage {                           // tool data: synced, owned by the module
    get<T extends Json = Json>(key: string): Promise<T | undefined>;
    set(key: string, value: Json): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    onChange(listener: (keys: string[]) => void): () => void;   // other side, other device, or own write
  }
  // memory: this tool holds the chat's memory slot this turn (//@uses memory, allowed by the user, first in pack order).
  type Turn = { memory: boolean };
  // memory goes in the memory slot, before the history, and should change only when a chunk closes: a text that
  // changes every turn re-sends the cached history every turn. Per-turn recall goes in tool, after the history.
  // through: the id of the last message memory stands for; it and every message before it, the greeting included,
  // leave the request.
  type PromptAnswer = string | null | { tool?: string | null; memory?: { text: string; through: string | null } };
  type Change = At & { kind: 'edit' | 'select' | 'delete' | 'restore' };
  type Branched = { from: string; messages: Record<string, string>; versions: Record<string, string> };   // old id → new
  interface Events {
    reply(chat: Chat, reply: At): void | Promise<void>;                     // a reply was saved
    prompt(chat: Chat, turn: Turn): PromptAnswer | Promise<PromptAnswer>;   // this turn's slots; 5 s deadline
    change(chat: Chat, change: Change): void | Promise<void>;               // the user edited, switched, deleted or restored
    branch(chat: Chat, from: Branched): void | Promise<void>;              // chat is the new branch
    menu(chat: Chat, item: string): void | Promise<void>;                   // a //@menu item pressed in the chat's ⋯
    action(chat: Chat, item: string, message: At): void | Promise<void>;   // a //@action item pressed on a message
    settings(settings: Settings): void | Promise<void>;                     // fields changed on the module page
    message(data: Json): void;                                              // from the other side (page <-> background)
  }
  interface Page { readonly chat: Chat | null; readonly theme: 'dark' | 'light'; close(): void }
  interface Api {
    // Unreleased until tools are published (design §6.10, phase 3): version 1 changes in place until then.
    readonly api: 1;
    readonly tool: { name: string; author: string; displayName: string; version: string };
    readonly context: 'background' | 'page';
    on<E extends keyof Events>(event: E, handler: Events[E]): void;   // events reach background only, except 'message'
    readonly storage: Storage;
    settings(): Promise<Settings>;
    post(data: Json): void;
    readonly page: Page | null;                  // null in background
  }
}
