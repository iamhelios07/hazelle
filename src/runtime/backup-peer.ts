export type BackupMessage =
  | { kind: 'call'; id: number; name: string; args: unknown }
  | { kind: 'answer'; id: number; ok: true; value: unknown }
  | { kind: 'answer'; id: number; ok: false; error: string }
  | { kind: 'notice'; name: string; args: unknown };

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

// Both sides can make calls: a codec job streams records/chunks to its host and awaits each acknowledgement. There
// is no posted-chunk backlog behind a slow file writer or account scan. Payload views are cloned, not transferred:
// ZIP passthrough chunks can still share the producer's input buffer with the next chunk.
export class BackupPeer {
  private next = 0;
  private readonly pending = new Map<number, Pending>();
  private ended = false;

  constructor(private readonly send: (message: BackupMessage) => void, private readonly handle: (name: string, args: unknown) => unknown | Promise<unknown>) {}

  call<T>(name: string, args?: unknown): Promise<T> {
    if (this.ended) return Promise.reject(new Error('Backup worker is closed'));
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try { this.send({ kind: 'call', id, name, args }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  notice(name: string, args?: unknown) {
    if (!this.ended) this.send({ kind: 'notice', name, args });
  }

  receive(message: BackupMessage) {
    if (this.ended) return;
    if (message.kind === 'answer') {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!pending) return;
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error));
      return;
    }
    const answer = Promise.resolve().then(() => this.handle(message.name, message.args));
    if (message.kind === 'notice') { void answer.catch(() => {}); return; }
    void answer.then(
      (value) => { if (!this.ended) this.send({ kind: 'answer', id: message.id, ok: true, value }); },
      (error: unknown) => { if (!this.ended) this.send({ kind: 'answer', id: message.id, ok: false, error: String(error) }); },
    );
  }

  close() {
    this.ended = true;
    for (const { reject } of this.pending.values()) reject(new Error('Backup worker is closed'));
    this.pending.clear();
  }
}
