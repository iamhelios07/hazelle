import type { BackupResult, Imported, ImportedModule, ImportResult, RisuCharacter, RisuChat } from '../../engine/import/types';
import { ImportReadError, type AssetRead, type Down, type Method, type ModuleData, type Replies, type Request, type Up } from './protocol';
import workerUrl from './worker?worker&url';

type Policy = { createScriptURL(url: string): string };
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('import-worker', {
  createScriptURL: (url) => {
    if (url !== workerUrl) throw new TypeError('not the import worker');
    return url;
  },
});

type Pending = { resolve: (value: Replies[Method]) => void; reject: (error: ImportReadError) => void };

export class ImportWorker {
  private worker: Worker | null = null;
  private closed = false;
  private next = 0;
  private pending = new Map<number, Pending>();

  async card(file: File): Promise<ImportResult> {
    const result = await this.ask({ kind: 'card', file });
    if (!result.ok) return result;
    if ('module' in result) return { ok: true, module: this.module(result.module) };
    const { avatar, assets, ...card } = result.card;
    return { ok: true, card: { ...card, avatar: avatar === null ? null : await this.ask({ kind: 'picture', handle: avatar }), assets: this.assets(assets) } };
  }

  async backup(files: File[]): Promise<BackupResult> {
    const result = await this.ask({ kind: 'backup', files });
    if (!result.ok) return result;
    return { ok: true, backup: {
      catalog: result.catalog,
      character: (key) => this.character(key),
      persona: async (key) => {
        const { picture, ...persona } = await this.ask({ kind: 'persona', key });
        return { ...persona, picture: () => this.ask({ kind: 'picture', handle: picture }) };
      },
      preset: (key) => this.ask({ kind: 'preset', key }),
      module: async (key) => this.module(await this.ask({ kind: 'module', key })),
    } };
  }

  close() {
    this.end('closed');
  }

  private async character(key: number): Promise<RisuCharacter> {
    const { avatar, assets, chatCount, ...character } = await this.ask({ kind: 'character', key });
    const chats: RisuChat[] = [];
    try {
      for (let index = 0; index < chatCount; index++) {
        const { header, messages: count } = await this.ask({ kind: 'chat', index });
        const messages: RisuChat['messages'] = [];
        for (let from = 0; from < count; ) {
          const page = await this.ask({ kind: 'messages', index, from });
          messages.push(...page.messages);
          from = page.next;
        }
        chats.push({ ...header, messages });
      }
    } finally {
      if (!this.closed) await this.ask({ kind: 'release' });
    }
    return { ...character, chats, avatar: () => this.ask({ kind: 'picture', handle: avatar }), assets: this.assets(assets) };
  }

  private assets(reads: AssetRead[]): Imported['assets'] {
    return reads.map(({ name, handle }) => ({ name, read: () => this.ask({ kind: 'asset', handle }) }));
  }

  private module({ assets, ...module }: ModuleData): ImportedModule {
    return { ...module, assets: this.assets(assets) };
  }

  private ask<K extends Method>(request: Request<K>): Promise<Replies[K]> {
    if (this.closed) return Promise.reject(new ImportReadError('closed'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as Replies[K]), reject });
      try {
        this.open().postMessage({ id, request } satisfies Down<K>);
      } catch (error) {
        this.end(error instanceof Error ? error.message : String(error));
      }
    });
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker((policy?.createScriptURL(workerUrl) ?? workerUrl) as string, { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<Up>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if ('error' in data) pending.reject(new ImportReadError(data.error));
      else pending.resolve(data.result);
    };
    worker.onerror = (error) => this.end(error.message);
    worker.onmessageerror = () => this.end('unreadable worker message');
    this.worker = worker;
    return worker;
  }

  private end(message: string) {
    this.closed = true;
    this.worker?.terminate();
    this.worker = null;
    const error = new ImportReadError(message);
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
