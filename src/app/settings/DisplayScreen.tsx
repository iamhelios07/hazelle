import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { choices, describeLook, presetOf } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { ChoiceGroup, NavBar, PreviewSplit, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEME, type PreviewRow } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: '<p><em>창밖으로 늦은 오후의 햇살이 기울어 든다. 그녀는 찻잔을 내려놓고 고개를 들었다.</em></p><p>"오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아."</p>' },
  { name: '나', mine: true, html: '<p>"이번엔 끝까지 읽었어. 결말이 좀 의외던데."</p>' },
];

const SWATCH_SAMPLE = '그녀는 찻잔을 내려놓고 고개를 들었다.';

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, changeDisplay, pick } = useDisplay();
  const current = presetOf(presets, reading, display);
  return (
    <Screen width="page" top={<NavBar title={PAGES.display} {...backBar(back)} />}>
      <Section title="프리셋">
        <Swatches
          label="프리셋"
          sample={SWATCH_SAMPLE}
          items={presets.map((preset) => ({ name: preset.name, note: describeLook(preset.look), ...preset.look, current: preset === current, onPick: () => pick(preset) }))}
        />
      </Section>
      <PreviewSplit
        preview={
          <Section title="미리보기">
            <ReadingPreview label="미리보기" reading={reading} rows={SAMPLE} />
          </Section>
        }
      >
        <SettingGroup label={PAGES.display}>
          <SettingRow label="테마" control={<ChoiceGroup layout="segmented" label="테마" options={choices(THEME)} value={display.theme} onChange={(theme) => changeDisplay({ theme })} />} />
          <SettingRow
            label="이미지 가리기"
            help="채팅 속 이미지는 눌러서 하나씩 볼 수 있어요."
            control={<Switch label="이미지 가리기" checked={display.hidePictures} onChange={(hidePictures) => changeDisplay({ hidePictures })} />}
          />
        </SettingGroup>
        <Section title="텍스트">
          <SettingGroup label="텍스트">
            <ReadingRows />
          </SettingGroup>
        </Section>
        <Section title="스크롤할 때">
          <SettingGroup label="스크롤할 때">
            <ReplyRow />
            <SettingRow
              label="헤더 숨기기"
              help="아래로 스크롤하면 숨기고, 위로 스크롤하면 다시 보여요."
              control={<Switch label="헤더 숨기기" checked={display.hideHeader} onChange={(hideHeader) => changeDisplay({ hideHeader })} />}
            />
            <SettingRow
              label="입력창 접기"
              help="위로 스크롤하면 한 줄로 접고, 맨 아래에서 다시 펼쳐요."
              control={<Switch label="입력창 접기" checked={display.foldComposer} onChange={(foldComposer) => changeDisplay({ foldComposer })} />}
            />
          </SettingGroup>
        </Section>
      </PreviewSplit>
    </Screen>
  );
}
