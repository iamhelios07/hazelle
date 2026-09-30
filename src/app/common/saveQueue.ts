import type { ApiFailure } from '../../runtime/api';

// How long typing pauses before a change is saved.
const PAUSE = 600;

export type SaveStatus = 'saving' | 'saved' | 'failed';
export type Write<T> = (patch: Partial<T>) => Promise<{ ok: true } | ApiFailure>;

const empty = (patch: object) => Object.keys(patch).length === 0;

// One thing's changes, merged per field and written one save at a time: a store write retried on a conflict reapplies
// its patch, so two in flight could land out of order and an older value win.
export class SaveQueue<T extends object> {
  private pending: Partial<T> = {};
  private writing: Partial<T> | null = null;
  private chain: Promise<boolean> = Promise.resolve(true);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: 'saved' | 'failed' | null = null;
  // A failed patch put back reads as failed until something is typed over it.
  private edited = false;

  constructor(
    private readonly write: Write<T>,
    private readonly changed: (failure?: ApiFailure) => void,
  ) {}

  get status(): SaveStatus | null {
    return this.writing || (this.edited && !empty(this.pending)) ? 'saving' : this.last;
  }

  get unsaved(): Partial<T> {
    return { ...this.writing, ...this.pending };
  }

  get busy(): boolean {
    return this.writing !== null || !empty(this.pending);
  }

  // An invalid value, such as a blank name, is shown but never saved, and takes back the one waiting.
  change = (patch: Partial<T>, valid = true) => {
    const next = { ...this.pending, ...patch };
    if (!valid) for (const field of Object.keys(patch)) delete next[field as keyof T];
    this.pending = next;
    this.edited = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), PAUSE);
    this.changed();
  };

  save = (patch: Partial<T>) => {
    this.change(patch);
    return this.flush();
  };

  // True once everything changed so far is stored.
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer);
    this.chain = this.chain.then(() => this.step());
    return this.chain;
  };

  private async step(): Promise<boolean> {
    const patch = this.pending;
    if (empty(patch)) return true;
    this.pending = {};
    this.writing = patch;
    this.edited = false;
    this.changed();
    const saved = await this.write(patch);
    this.writing = null;
    this.last = saved.ok ? 'saved' : 'failed';
    // Kept for the next flush to try again, under anything typed since.
    if (!saved.ok) this.pending = { ...patch, ...this.pending };
    this.changed(saved.ok ? undefined : saved);
    return saved.ok;
  }
}
