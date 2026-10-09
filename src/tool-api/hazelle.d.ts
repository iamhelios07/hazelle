declare const hazelle: Hazelle.Api;
declare namespace Hazelle {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  type Role = 'user' | 'char';
  // index: place after the greeting (index 0 = first message after it), as Lua counts. text: as the prompt reads it.
  interface Message { index: number; id: string; role: Role; text: string; time: number }
  interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
  type ModelAnswer = { ok: true; text: string } | { ok: false; reason: 'not-allowed' | 'not-declared' | 'no-model' | 'flood' | 'failed' };
  type Question = { kind: 'input'; text: string } | { kind: 'confirm'; text: string } | { kind: 'select'; options: string[] };
  type Settings = Record<string, string | number | boolean>;

  interface ChatState {                         // this tool's own per-chat variables, replayed with the story
    get<T extends Json = Json>(key: string): Promise<T | undefined>;
    set(key: string, value: Json): void;        // lands with the event's outcome; from a page, after the latest message
    delete(key: string): void;
  }
  interface Chat {
    readonly id: string;
    readonly character: { name: string; description: string } | null;
    readonly persona: { name: string; description: string };
    readonly length: number;
    messages(from?: number, to?: number): Promise<Message[]>;
    readonly state: ChatState;
    edit(index: number, text: string): void;    // a new version, as Lua's setChat
    add(role: Role, text: string): void;        // as Lua's addChat
    model(role: 'main' | 'aux', messages: ModelMessage[]): Promise<ModelAnswer>;   // needs //@uses model
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
  interface Events {
    reply(chat: Chat, reply: { index: number; id: string }): void | Promise<void>;   // a reply was saved
    prompt(chat: Chat): string | null | Promise<string | null>;  // this turn's slot text; 5 s deadline
    menu(chat: Chat, item: string): void | Promise<void>;        // a //@menu item pressed in the chat's ⋯
    settings(settings: Settings): void | Promise<void>;          // fields changed on the module page
    message(data: Json): void;                                   // from the other side (page <-> background)
  }
  interface Page { readonly chat: Chat | null; readonly theme: 'dark' | 'light'; close(): void }
  interface Api {
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
