// A classic scrollbar takes room beside what it scrolls (Windows, macOS with a mouse); an overlay one takes none and
// hides when idle (macOS with a trackpad, phones). scrollbar.css restyles only the classic kind: a styled bar is always
// classic, so styling an overlay one would bring back a bar the platform hides.
export function markScrollbars() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position: absolute; visibility: hidden; width: 100px; height: 100px; overflow: scroll';
  document.body.append(probe);
  if (probe.offsetWidth > probe.clientWidth) document.documentElement.dataset.scrollbars = 'classic';
  probe.remove();
}

// For a shadow root's host, which scrollbar.css reads as the document's root is read outside it.
export const scrollbarKind = () => document.documentElement.dataset.scrollbars;
