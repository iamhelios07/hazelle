import type { ImportedTool } from '../../engine/import/tool';
import type { BackupResult, Imported, ImportedModule, ImportResult, RisuCharacter, RisuChat } from '../../engine/import/types';
import { ImportReadError, type AssetRead, type ChatsRead, type Down, type Method, type ModuleData, type Replies, type Request, type Up } from './protocol';
import { PendingRequests } from '../pending-requests';
import { moduleWorker } from '../worker';
import workerUrl from './worker?worker&url';

export class ImportWorker {
  private worker: Worker | null = null;
  private closed = false;
  private readonly pending = new PendingRequests<Replies[Method]>();

  async card(file: File): Promise<ImportResult | ChatsRead | { ok: true; tool: ImportedTool }> {
    const result = await this.ask({ kind: 'card', file });
    if (!result.ok || 'tool' in result || 'chat' in result || 'risuChats' in result) return result;
    if ('module' in result) return { ok: true, module: this.module(result.module) };
    const { avatar, assets, bundled, ...card } = result.card;
    return { ok: true, card: { ...card, avatar: avatar === null ? null : await this.ask({ kind: 'picture', handle: avatar }), assets: this.assets(assets), bundled: bundled.map((module) => this.module(module)) } };
  }

  async backup(files: File[]): Promise<BackupResult> {
    const result = await this.ask({ kind: 'backup', files });
    if (!result.ok) return result;
    return { ok: true, backup: {
      catalog: result.catalog,
      character: (key) => this.character(key),
      persona: async (key) => {
        const { picture, module, ...persona } = await this.ask({ kind: 'persona', key });
        return { ...persona, picture: () => this.ask({ kind: 'picture', handle: picture }), module: module && this.module(module) };
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

  private module<M extends ModuleData>({ assets, ...module }: M): Omit<M, 'assets'> & Pick<ImportedModule, 'assets'> {
    return { ...module, assets: this.assets(assets) };
  }

  private ask<K extends Method>(request: Request<K>): Promise<Replies[K]> {
    if (this.closed) return Promise.reject(new ImportReadError('closed'));
    const { id, promise } = this.pending.add();
    try {
      this.open().postMessage({ id, request } satisfies Down<K>);
    } catch (error) {
      this.end(error instanceof Error ? error.message : String(error));
    }
    return promise as Promise<Replies[K]>;
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<Up>) => {
      const pending = this.pending.take(data.id);
      if (!pending) return;
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
    this.pending.rejectAll(() => error);
  }
}
