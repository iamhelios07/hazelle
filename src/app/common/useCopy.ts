import { useToast } from '../toast';

export function useCopy(): (text: string) => void {
  const toast = useToast();
  return (text) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.show('복사했어요'),
      () => toast.error('복사하지 못했어요.', { detail: '브라우저가 클립보드를 막았어요.' }),
    );
}
