import { ACTS } from '../common/acts';
import { Brand, Button, Intro, Screen } from '../ui';

export function UnreachableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Screen top={<Brand />} actions={<Button onClick={onRetry}>{ACTS.retry.label}</Button>}>
      <Intro title="지금은 열 수 없어요">{message}</Intro>
    </Screen>
  );
}
