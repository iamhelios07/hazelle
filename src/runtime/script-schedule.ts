import { live } from '../model/library';
import type { ToolUnit } from '../model/tool';
import { evaluationFailure } from './evaluation';
import type { ScriptInteractions } from './script-interactions';
import type { ObjectStore } from './store';
import { toolsOf } from './tools/store';

export class ScriptSchedule {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lanes = new Map<string, Promise<void>>();
  // Each chat's runs queued and not yet ended.
  private readonly held = new Map<string, number>();

  constructor(
    private readonly store: ObjectStore,
    private readonly interactions: ScriptInteractions,
    private readonly closing: AbortSignal,
  ) {}

  // One run at a time per chat, each reading the chat as the one before left it: a write returns before its chat's
  // projection is made again, so each waits for it, and a projection that fails is shown on the chat's scope
  // (ChatProjections.evaluate). A question still open when the next comes is dismissed, so a card the user passed over
  // never holds up a send.
  queued<T>(chat: string, task: () => Promise<T>): Promise<T> {
    this.interactions.dismiss(chat);
    const next = (this.queues.get(chat) ?? Promise.resolve()).then(() => this.store.projections.evaluate(chat).catch(evaluationFailure)).then(task);
    this.queues.set(chat, next.catch(() => {}));
    this.held.set(chat, (this.held.get(chat) ?? 0) + 1);
    void next.catch(() => {}).finally(() => {
      const left = this.held.get(chat)! - 1;
      if (left) this.held.set(chat, left);
      else this.held.delete(chat);
    });
    return next;
  }

  // Whether what is queued now waits for an earlier run.
  busy(chat: string): boolean {
    return this.held.has(chat);
  }

  // One chain per chat and tool, off the send queue: a tool hears reply, change, branch, menu and action in the order
  // they came, and a send never waits for them. Each job runs with the chat held, only while the same tool is on in it,
  // and dismisses the chat's open question first, as a send does.
  lane(chat: string, unit: ToolUnit, job: () => Promise<unknown>): Promise<void> {
    const { store } = this;
    const key = `${chat}:${unit.module}`;
    const lease = store.retainChat(chat);
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(async () => {
      if (await lease.ready || this.closing.aborted) return;
      const stored = live(store.get('chat', chat));
      if (!stored || !toolsOf(store, stored.value).some((current) => current.module === unit.module && current.tool.file.id === unit.tool.file.id)) return;
      this.interactions.dismiss(chat);
      await job();
    }).catch((error: unknown) => this.interactions.report(chat, error, { kind: 'module', id: unit.module })).finally(() => {
      lease.release();
      if (this.lanes.get(key) === next) this.lanes.delete(key);
    });
    this.lanes.set(key, next);
    return next;
  }
}
