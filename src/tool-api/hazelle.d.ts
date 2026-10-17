declare const hazelle: Hazelle.Api;
declare namespace Hazelle {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  type Role = 'user' | 'char';
  // index: place after the greeting (index 0 = first message after it), as Lua counts. id: the message's, the same
  // across its versions. version: the version shown. text: as the prompt reads it.
  interface Message { index: number; id: string; version: string; role: Role; text: string; time: number }
  type At = { index: number; id: string; version: string };
  interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
  // A message of the request about to be sent. message: the id of the chat message it renders, absent for the prompt's
  // own parts; an answered one that keeps it keeps that message's pictures. cache: the provider caches the request
  // through it.
  interface RequestMessage extends ModelMessage { message?: string; cache?: true }
  // A message about to be shown; at: null for the greeting.
  type Shown = { at: At | null; text: string };
  type ModelRefusal = 'not-allowed' | 'not-declared' | 'no-model' | 'flood' | 'failed';
  type ModelAnswer = { ok: true; text: string } | { ok: false; reason: ModelRefusal };
  // model: the embedding model that made the vectors; vectors from another model cannot be compared with them.
  type EmbedAnswer = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: ModelRefusal | 'too-large' };
  // refused: the relay or the app refused the call, code naming why (not-https, not-public, upstream-redirect,
  // upstream-not-api, relay-host-limit, relay-traffic-limit, …). A body is text; a redirect is not followed.
  type FetchRefusal = 'not-allowed' | 'not-declared' | 'flood' | 'refused' | 'offline' | 'stopped';
  type FetchInit = { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
  type FetchAnswer = { ok: true; status: number; headers: [string, string][]; body: ArrayBuffer } | { ok: false; reason: FetchRefusal; code?: string };
  type Question = { kind: 'input'; text: string } | { kind: 'confirm'; text: string } | { kind: 'select'; text?: string; options: string[] };
  type Settings = Record<string, string | number | boolean>;
  // The chat's character card. id: the character's, the same in every chat with it. greeting: the card's first
  // message, null when it has none.
  interface Card {
    readonly id: string; name: string; description: string; personality: string; scenario: string; greeting: string | null;
    creatorNotes: string; tags: string[];
  }
  // A lorebook entry as written, before any activation. on: whether it is switched on. owner: whose lorebook holds it,
  // with that one's id: the chat's character, one of its 등장인물, the chat itself, or a module on in it.
  interface LoreEntry { name: string; keys: string[]; text: string; always: boolean; on: boolean; owner: { kind: 'character' | 'cast' | 'chat' | 'module'; id: string } }
  // The account's personas (current: the one chats start with) and characters, read only; no chat of theirs is offered.
  interface Account { personas: { id: string; name: string; description: string; current: boolean }[]; characters: { id: string; name: string }[] }
  // persona: the id of the persona this chat speaks as, null when it is gone. limits: the chat model's context and reply
  // lengths in tokens, null where unknown or no model is set. modules: those on in the chat, in pack order.
  interface Setup { persona: string | null; limits: { context: number | null; reply: number | null }; modules: { id: string; name: string }[] }

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
    card(): Promise<Card | null>;               // null in a chat with no character
    readonly state: ChatState;
    readonly data: ChatData;
    edit(index: number, text: string): void;    // a new version, as Lua's setChat; throws in change and branch
    add(role: Role, text: string): void;        // as Lua's addChat; throws in change and branch
    model(role: 'main' | 'aux', messages: ModelMessage[]): Promise<ModelAnswer>;   // needs //@uses model
    // needs //@uses embed. as: what the texts are for, which retrieval-tuned models embed differently.
    embed(texts: string[], as?: 'query' | 'document'): Promise<EmbedAnswer>;
    // needs //@uses network, which the user allows once per module; through the app's relay. An aborted signal rejects
    // with its reason, as fetch does.
    fetch(url: string, init?: FetchInit): Promise<FetchAnswer>;
    badge(index: number, text: string | null): void;   // on the version shown now; lands with the outcome
    tokens(text: string): Promise<number>;
    lore(reserve?: number): Promise<{ role: 'system' | 'user' | 'assistant'; text: string }[]>;
    lorebook(): Promise<LoreEntry[]>;           // every entry the chat's lorebooks hold, as written, in the prompt's order
    setup(): Promise<Setup>;
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
    // a reply about to be saved, after the bot's Lua: a text answered is saved instead; 5 s deadline, past which the
    // reply is saved as it came. The story cannot be changed here.
    replying(chat: Chat, text: string): string | void | Promise<string | void>;
    // The same after the bot's Lua, with the same deadline, past which it goes on as it came; the story cannot be
    // changed in them. sending: the user's message about to be saved. requesting: the request about to be sent, which a
    // list answered replaces. showing: messages about to be shown, a stretch at a time, whose texts answered (one per
    // message, in order) are shown instead; nothing is saved in it, so its writes throw.
    sending(chat: Chat, text: string): string | void | Promise<string | void>;
    requesting(chat: Chat, messages: RequestMessage[]): RequestMessage[] | void | Promise<RequestMessage[] | void>;
    showing(chat: Chat, shown: Shown[]): string[] | void | Promise<string[] | void>;
    prompt(chat: Chat, turn: Turn): PromptAnswer | Promise<PromptAnswer>;   // this turn's slots; 5 s deadline
    change(chat: Chat, change: Change): void | Promise<void>;               // the user edited, switched, deleted or restored
    branch(chat: Chat, from: Branched): void | Promise<void>;              // chat is the new branch
    menu(chat: Chat, item: string): void | Promise<void>;                   // a //@menu item pressed in the chat's ⋯
    action(chat: Chat, item: string, message: At): void | Promise<void>;   // a //@action item pressed on a message
    settings(settings: Settings): void | Promise<void>;                     // fields changed on the module page
    open(): void | Promise<void>;                                           // the user opened a frame tool's page
    message(data: Json): void;                                              // from the other side (page <-> background)
  }
  interface Page { readonly chat: Chat | null; readonly theme: 'dark' | 'light'; close(): void }
  // A frame tool's one document, which holds its listeners and its screen together (a RisuAI plugin's, through the
  // adapter). It is shown on the tool's page only while it asks to be; closing the page hides it.
  interface Frame {
    chat(): Promise<Chat | null>;              // the chat open for it now; null on the module page with no chat
    show(): void;                              // brings its page up with this document in it
    hide(): void;                              // and closes that page
    menu(items: { id: string; label: string }[]): void;   // its ⋯ items in the chat, replacing the last; pressed: 'menu'
    missing(name: string): void;               // tells 점검 it met a name the API it was written for has and this one lacks
  }
  interface Api {
    // Unreleased until tools are published (design §6.10, phase 3): version 1 changes in place until then.
    readonly api: 1;
    readonly tool: { name: string; author: string; displayName: string; version: string };
    readonly context: 'background' | 'page' | 'frame';
    on<E extends keyof Events>(event: E, handler: Events[E]): void;   // events reach background and frame, except 'message'
    readonly storage: Storage;
    settings(): Promise<Settings>;
    setSetting(key: string, value: string | number | boolean): Promise<void>;   // one of its own fields; throws on a value the field cannot hold
    account(): Promise<Account>;
    post(data: Json): void;
    readonly page: Page | null;                  // null in background and frame
    readonly frame: Frame | null;                // only in frame
  }
}
