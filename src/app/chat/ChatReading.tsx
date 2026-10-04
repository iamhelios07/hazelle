import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { useDisplay } from '../display';
import { Button, Dialog, IconButton, Menu, Row, Stack } from '../ui';

export function ReadingMenu() {
  return (
    <Menu kind="dialog" size="lg" place="below-end" label="읽기 설정" trigger={(opener) => <IconButton icon="가" label="읽기 설정" size="sm" {...opener} />}>
      <ReadingForm />
    </Menu>
  );
}

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
          처음 값으로 되돌리기
        </Button>
      </Row>
    </Stack>
  );
}
