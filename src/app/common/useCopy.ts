import { useToast } from '../toast';

function useClipboard<T>(write: (value: T) => Promise<void>): (value: T) => void {
  const toast = useToast();
  return (value) =>
    void write(value).then(
      () => toast.show('복사했어요'),
      () => toast.error('복사하지 못했어요.', { detail: '브라우저에서 클립보드 접근을 막았어요.' }),
    );
}

export const useCopy = () => useClipboard((text: string) => navigator.clipboard.writeText(text));

// Pasted as markup where a page takes it, and as its source where only text goes in (a board's HTML mode). Call it in
// the press itself, before any await: the clipboard needs the press's own activation.
export const useCopyHtml = () =>
  useClipboard((html: string) => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([html], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]));
