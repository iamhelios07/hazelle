type Pending<Value, Context> = { context: Context; resolve: (value: Value) => void; reject: (error: unknown) => void };

export class PendingRequests<Value, Context = void> {
  private next = 0;
  private readonly pending = new Map<number, Pending<Value, Context>>();

  get size() {
    return this.pending.size;
  }

  add(context: Context) {
    const id = ++this.next;
    const promise = new Promise<Value>((resolve, reject) => {
      this.pending.set(id, { context, resolve, reject });
    });
    return { id, promise };
  }

  context(id: number): Context | undefined {
    return this.pending.get(id)?.context;
  }

  take(id: number) {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    return pending;
  }

  rejectAll(error: () => unknown) {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const call of pending) call.reject(error());
  }
}
