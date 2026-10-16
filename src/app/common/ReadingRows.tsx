import { useDisplay } from '../display';
import { ChoiceGroup, SettingRow, Stepper, Switch } from '../ui';
import { choices, FONT, REPLY, SIZE, SPACING } from './reading';

export function ReadingRows() {
  const { reading, changeReading } = useDisplay();
  return (
    <>
      <SettingRow
        label="글꼴"
        control={<ChoiceGroup layout="segmented" label="글꼴" options={choices(FONT)} value={reading.font} onChange={(font) => changeReading({ font })} />}
      />
      <SettingRow
        label="글자 크기"
        control={<Stepper label="글자 크기" less="글자 작게" more="글자 크게" value={reading.size} min={SIZE.min} max={SIZE.max} onChange={(size) => changeReading({ size })} />}
      />
      <SettingRow
        label="줄 간격"
        control={<ChoiceGroup layout="segmented" label="줄 간격" options={choices(SPACING)} value={reading.leading} onChange={(leading) => changeReading({ leading })} />}
      />
      <SettingRow
        label="읽기 폭"
        control={<ChoiceGroup layout="segmented" label="읽기 폭" options={choices(SPACING)} value={reading.width} onChange={(width) => changeReading({ width })} />}
      />
    </>
  );
}

export function ReplyRow() {
  const { reading, changeReading } = useDisplay();
  return (
    <SettingRow
      label="응답이 올 때"
      wide
      control={<ChoiceGroup layout="segmented" label="응답이 올 때" options={choices(REPLY)} value={reading.reply} onChange={(reply) => changeReading({ reply })} />}
    />
  );
}

export function HidePicturesRow() {
  const { display, changeDisplay } = useDisplay();
  return (
    <SettingRow
      label="이미지 가리기"
      help="채팅에 있는 이미지는 눌러서 하나씩 크게 볼 수 있어요."
      control={<Switch label="이미지 가리기" checked={display.hidePictures} onChange={(hidePictures) => changeDisplay({ hidePictures })} />}
    />
  );
}
