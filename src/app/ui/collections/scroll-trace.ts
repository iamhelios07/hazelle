// Off unless the device asks: localStorage.setItem('hazelle:trace-scroll', '1'), then reload. Lines go to the console only.
const on = (() => {
  try {
    return localStorage.getItem('hazelle:trace-scroll') === '1';
  } catch {
    return false;
  }
})();

const round = (value: unknown) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value);

export function traceScroll(label: string, data: Record<string, unknown> = {}) {
  if (!on) return;
  console.log(`[scroll] ${Math.round(performance.now())} ${label}`, Object.fromEntries(Object.entries(data).map(([key, value]) => [key, round(value)])));
}

// A write that no labelled site logged just before it shows with its caller; a scroll with no write before it is the
// browser's own.
export function traceScroller(element: HTMLElement): () => void {
  if (!on) return () => {};
  const native = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get() {
      return native.get!.call(this);
    },
    set(value: number) {
      const before = native.get!.call(this) as number;
      native.set!.call(this, value);
      traceScroll('write', { before, asked: value, after: native.get!.call(this), height: element.scrollHeight, caller: new Error().stack?.split('\n').slice(2, 5).join(' < ') });
    },
  });
  const scrolled = () => traceScroll('scroll', { top: native.get!.call(element), height: element.scrollHeight, client: element.clientHeight });
  element.addEventListener('scroll', scrolled, { passive: true });
  return () => {
    delete (element as { scrollTop?: number }).scrollTop;
    element.removeEventListener('scroll', scrolled);
  };
}
