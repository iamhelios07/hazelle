import { PICTURE_DEFAULTS } from '../../engine/illustrate';
import type { PictureTags } from '../../model/prompt';
import { Button, Section, Stack, TextField } from '../ui';

// The fields show the app's tags while the prompt sets none, since those are what is sent; the first edit stores all
// three, and an emptied field sends none rather than the app's.
export function PictureTagsPane({ tags, onChange }: { tags: PictureTags | undefined; onChange: (tags: PictureTags | undefined) => void }) {
  const shown = tags ?? PICTURE_DEFAULTS;
  const set = (field: keyof PictureTags) => (value: string) => onChange({ ...shown, [field]: value });
  return (
    <Section
      title="이미지 태그"
      note={tags ? '직접 지정' : '기본값'}
      hint="이 프롬프트로 만드는 모든 삽화에 넣어요. 작가 태그는 맨 앞에, 품질 태그는 장면 뒤에 붙어요."
      action={
        tags && (
          <Button variant="link" size="xs" onClick={() => onChange(undefined)}>
            기본값으로 되돌리기
          </Button>
        )
      }
    >
      <Stack gap="related">
        <TextField label="작가 태그" lines={2} value={shown.artist} onChange={set('artist')} placeholder="artist:이름, artist:이름" />
        <TextField label="품질 태그" lines={2} value={shown.quality} onChange={set('quality')} />
        <TextField label="제외할 태그" lines={4} value={shown.negative} onChange={set('negative')} />
      </Stack>
    </Section>
  );
}
