import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { RESET } from '../common/words';
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
        <Button variant="link" size="sm" onClick={reset}>
          {RESET}
        </Button>
      </Row>
    </Stack>
  );
}
