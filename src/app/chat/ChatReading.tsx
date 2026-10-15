import { HidePicturesRow, ReadingRows, ReplyRow } from '../common/ReadingRows';
import { RESET } from '../common/words';
import { useDisplay } from '../display';
import { Button, Dialog, Row, Stack } from '../ui';

export function ReadingDialog({ onClose }: { onClose: () => void }) {
  const { reset } = useDisplay();
  return (
    <Dialog title="읽기 설정" onClose={onClose}>
      <Stack gap="related">
        <HidePicturesRow />
        <ReadingRows  />
        <ReplyRow  />
        <Row kind="actions">
          <Button variant="link" size="sm" onClick={reset}>
            {RESET}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
