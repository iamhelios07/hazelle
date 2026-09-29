import { useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { Button, ChoiceGroup, Dialog, IconButton, Menu, readingDefault, Row, SettingRow, Stack, Stepper, type Reading } from '../ui';
import { choices, FONT, parseReading, SIZE, SPACING } from './reading';

const READING = 'risu-alpha:reading';

// Per device, never in the synced settings, since a phone and a desktop screen differ.
export function useReading() {
  const [initial] = useState(readingDefault);
  const [value, set] = usePersisted(READING, (stored) => parseReading(stored, initial), initial);
  return { value, set, initial };
}

export type ReadingControl = ReturnType<typeof useReading>;

export function ReadingMenu({ reading }: { reading: ReadingControl }) {
  return (
    <Menu kind="dialog" size="lg" place="below-end" label="읽기 설정" trigger={(opener) => <IconButton icon="가" label="읽기 설정" size="sm" {...opener} />}>
      <ReadingForm reading={reading} />
    </Menu>
  );
}

export function ReadingDialog({ reading, onClose }: { reading: ReadingControl; onClose: () => void }) {
  return (
    <Dialog title="읽기 설정" onClose={onClose}>
      <ReadingForm reading={reading} />
    </Dialog>
  );
}

function ReadingForm({ reading }: { reading: ReadingControl }) {
  const { value, set, initial } = reading;
  const change = (next: Partial<Reading>) => set({ ...value, ...next });
  return (
    <Stack gap="related">
      <SettingRow
        place="panel"
        label="글꼴"
        control={<ChoiceGroup layout="segmented" label="글꼴" options={choices(FONT)} value={value.font} onChange={(font) => change({ font })} />}
      />
      <SettingRow
        place="panel"
        label="글자 크기"
        control={<Stepper label="글자 크기" less="글자 작게" more="글자 크게" value={value.size} min={SIZE.min} max={SIZE.max} onChange={(size) => change({ size })} />}
      />
      <SettingRow
        place="panel"
        label="줄 간격"
        control={<ChoiceGroup layout="segmented" label="줄 간격" options={choices(SPACING)} value={value.leading} onChange={(leading) => change({ leading })} />}
      />
      <SettingRow
        place="panel"
        label="읽기 폭"
        control={<ChoiceGroup layout="segmented" label="읽기 폭" options={choices(SPACING)} value={value.width} onChange={(width) => change({ width })} />}
      />
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={() => set(initial)}>
          처음대로
        </Button>
      </Row>
    </Stack>
  );
}
