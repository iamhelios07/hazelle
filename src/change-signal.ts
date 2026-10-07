export class ChangeSignal {
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  notify() {
    for (const listener of this.listeners) listener();
  }

  clear() {
    this.listeners.clear();
  }
}
