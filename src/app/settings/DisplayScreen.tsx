import { useState } from 'react';
import { EMPTY_SETTINGS, type SavedLook } from '../../model/settings';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { choices, describeLook, lookOf, presetOf, savedPresets, type Preset } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { ACCENT, Beside, BG, Button, ChoiceGroup, ColorDot, INK, MenuItem, NavBar, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEME, type PreviewRow } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: '<p><em>창밖으로 늦은 오후의 햇살이 기울어 든다. 그녀는 찻잔을 내려놓고 고개를 들었다.</em></p><p>"오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아."</p>' },
  { name: '나', mine: true, html: '<p>"이번엔 끝까지 읽었어. 결말이 좀 의외던데."</p>' },
];

const SWATCH_SAMPLE = '그녀는 찻잔을 내려놓고 고개를 들었다.';

const colorChoices = <T extends string>(pick: 'bg' | 'ink' | 'accent', labels: Record<T, string>) =>
  choices(labels).map((option) => ({ ...option, mark: <ColorDot pick={pick} value={option.value} /> }));

const withLook = (looks: SavedLook[] = [], saved: SavedLook) => [...looks.filter(({ name }) => name !== saved.name), saved];

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, changeDisplay, pick } = useDisplay();
  const store = useStore();
  const toast = useToast();
  const own = savedPresets(useSettings().looks);
  const current = presetOf([...presets, ...own.presets], reading, display);
  const [naming, setNaming] = useState(false);

  async function save(name: string) {
    setNaming(false);
    const look = { name: name.trim() || `내 프리셋 ${own.presets.length + 1}`, look: lookOf(reading, display) };
    const saved = await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: withLook(settings.looks, look) }));
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  async function remove({ name, look }: Preset) {
    const removed = await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: (settings.looks ?? []).filter((saved) => saved.name !== name) }));
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${name}' 프리셋을 삭제했어요.`, () => store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: withLook(settings.looks, { name, look }) })));
  }

  const swatch = (preset: Preset) => ({ name: preset.name, note: describeLook(preset.look), ...preset.look, current: preset === current, onPick: () => pick(preset) });
  return (
    <Screen width="page" top={<NavBar title={PAGES.display} {...backBar(back)} />}>
      <Section
        title="프리셋"
        note={own.unread > 0 ? `읽지 못한 프리셋 ${own.unread}개` : undefined}
        action={
          !current && (
            <Button variant="ghost" onClick={() => setNaming(true)}>
              지금 설정 저장
            </Button>
          )
        }
      >
        <Swatches
          label="프리셋"
          sample={SWATCH_SAMPLE}
          items={[
            ...presets.map(swatch),
            ...own.presets.map((preset) => ({ ...swatch(preset), menu: <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove(preset)} /> })),
          ]}
        />
      </Section>
      {naming && <NameDialog title="프리셋으로 저장" value={`내 프리셋 ${own.presets.length + 1}`} hint="같은 이름의 내 프리셋은 지금 설정으로 바뀌어요." onSave={(name) => void save(name)} onClose={() => setNaming(false)} />}
      <Beside
        variant="preview"
        side={
          <Section title="미리보기">
            <ReadingPreview label="미리보기" reading={reading} rows={SAMPLE} />
          </Section>
        }
      >
        <SettingGroup label={PAGES.display}>
          <SettingRow label="테마" control={<ChoiceGroup layout="segmented" label="테마" options={choices(THEME)} value={display.theme} onChange={(theme) => changeDisplay({ theme })} />} />
          <SettingRow
            label="배경"
            help="봇이 직접 꾸민 부분은 기본 배경에 맞춰져 있어서, 다른 배경에선 어색할 수 있어요."
            control={<ChoiceGroup label="배경" options={colorChoices('bg', BG)} value={display.bg} onChange={(bg) => changeDisplay({ bg })} />}
          />
          <SettingRow label="글자" control={<ChoiceGroup label="글자" options={colorChoices('ink', INK)} value={display.ink} onChange={(ink) => changeDisplay({ ink })} />} />
          <SettingRow label="강조" control={<ChoiceGroup label="강조" options={colorChoices('accent', ACCENT)} value={display.accent} onChange={(accent) => changeDisplay({ accent })} />} />
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
      </Beside>
    </Screen>
  );
}
