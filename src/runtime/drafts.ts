import { ChangeSignal } from '../change-signal';
// Unsent text per chat, kept in page memory until the vault closes: it outlives the chat's screen and the session, and a reply that
// fails after its screen is gone still hands its text back. A chat not saved yet has no id to keep it under, so its
// text is kept per character (draftKey) and moved under the chat's id once it is saved.
export const draftKey = (chat: string | null, character: string | null) => chat ?? (character ? `new-${character}` : 'new');

export class Drafts {
  private readonly texts = new Map<string, string>();
  private readonly changes = new ChangeSignal();

  readonly subscribe = this.changes.subscribe;

  text(key: string): string {
    return this.texts.get(key) ?? '';
  }

  set(key: string, text: string) {
    if (text) this.texts.set(key, text);
    else this.texts.delete(key);
    this.changes.notify();
  }

  move(from: string, to: string) {
    const text = this.text(from);
    if (!text) return;
    this.texts.delete(from);
    this.set(to, text);
  }

  // Text a send took and its chat did not keep goes before what was typed since: neither replaces the other.
  putBack(key: string, text: string) {
    const typed = this.text(key);
    this.set(key, typed ? `${text}\n${typed}` : text);
  }

  close() {
    this.texts.clear();
  }
}
