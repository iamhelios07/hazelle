import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { useDisplay } from '../display';
import { Button, Dialog, Row, Stack } from '../ui';

export function ReadingDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="읽기 설정" onClose={onClose}>
      <ReadingForm />
    </Dialog>
  );
}

function ReadingForm() {
  const { reset } = useDisplay();
  return (
    <Stack gap="related">
      <ReadingRows place="panel" />
      <ReplyRow place="panel" />
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={reset}>
          기본값으로 되돌리기
        </Button>
      </Row>
    </Stack>
  );
}
