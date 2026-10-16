import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { useState } from 'react';
import { storyHtml } from '../../engine/display';
import { EMPTY_SETTINGS, type SavedLook } from '../../model/settings';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { PICTURE_HEIGHT_ERROR, readPictureHeight } from '../common/pictureHeight';
import { HidePicturesRow, ReadingRows, ReplyRow } from '../common/ReadingRows';
import { choices, describeLook, lookOf, moveLook, presetOf, savedPresets, type OwnPreset, type Preset } from '../common/reading';
import { typedText } from '../common/typed';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { ACCENT, Beside, BG, Button, DIALOGUE, QUOTE_SHAPE, ChoiceGroup, ColorDot, INK, MenuItem, NavBar, NumberInput, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEME, type PreviewRow } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: storyHtml(`*창밖으로 늦은 오후의 햇살이 기울어 든다.* 그녀는 찻잔을 내려놓고 고개를 들었다. "오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아." '또 잠든 건 아니겠지.'`, true) },
  { name: '나', mine: true, html: storyHtml('"이번엔 끝까지 읽었어. 결말이 좀 의외던데."', false) },
];

const SWATCH_SAMPLE = '그녀는 찻잔을 내려놓고 고개를 들었다.';

const colorChoices = <T extends string>(pick: 'bg' | 'ink' | 'accent' | 'dialogue', labels: Record<T, string>) =>
  choices(labels).map((option) => ({ ...option, mark: <ColorDot pick={pick} value={option.value} /> }));

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, changeDisplay, pick } = useDisplay();
  const store = useStore();
  const toast = useToast();
  const own = savedPresets(useSettings().looks);
  const current = presetOf([...presets, ...own.presets], reading, display);
  const [naming, setNaming] = useState<{ preset: OwnPreset | null } | null>(null);

  async function change(looks: (looks: SavedLook[]) => SavedLook[], failure: string) {
    const done = await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: looks(settings.looks ?? []) }));
    if (!done.ok) toast.failed(done, failure);
    return done.ok;
  }

  function name(typed: string) {
    const preset = naming?.preset;
    setNaming(null);
    if (preset) return void change((looks) => looks.map((look) => (look.id === preset.id ? { ...look, name: typed.trim() || preset.name } : look)), '이름을 바꾸지 못했어요.');
    const look = { id: crypto.randomUUID(), name: typed.trim() || `내 프리셋 ${own.presets.length + 1}`, look: lookOf(reading, display) };
    void change((looks) => [...looks, look], '저장하지 못했어요.');
  }

  async function remove({ id, name, look }: OwnPreset) {
    let at = 0;
    const removed = await change((looks) => {
      at = looks.findIndex((saved) => saved.id === id);
      return looks.filter((saved) => saved.id !== id);
    }, '삭제하지 못했어요.');
    if (removed) toast.undoable(`'${name}' 프리셋을 삭제했어요.`, () => store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: (settings.looks ?? []).toSpliced(at, 0, { id, name, look }) })));
  }

  const move = (from: number, to: number) => void change((looks) => moveLook(looks, own.presets[from]!.id, own.presets[to]!.id), '옮기지 못했어요.');

  const swatch = (preset: Preset) => ({ name: preset.name, note: describeLook(preset.look), ...preset.look, current: preset === current, onPick: () => pick(preset) });
  const menu = (preset: OwnPreset, index: number) => (
    <>
      <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ preset })} />
      {preset !== current && <MenuItem icon={Save} label="지금 설정으로 덮어쓰기" onClick={() => void change((looks) => looks.map((look) => (look.id === preset.id ? { ...look, look: lookOf(reading, display) } : look)), '저장하지 못했어요.')} />}
      {index > 0 && <MenuItem icon={ArrowLeft} label="앞으로 옮기기" onClick={() => move(index, index - 1)} />}
      {index < own.presets.length - 1 && <MenuItem icon={ArrowRight} label="뒤로 옮기기" onClick={() => move(index, index + 1)} />}
      <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove(preset)} />
    </>
  );
  return (
    <Screen width="page" top={<NavBar title={PAGES.display} {...backBar(back)} />}>
      <Section
        title="프리셋"
        action={
          !current && (
            <Button variant="ghost" onClick={() => setNaming({ preset: null })}>
              지금 설정 저장
            </Button>
          )
        }
      >
        <Swatches label="프리셋" sample={SWATCH_SAMPLE} items={presets.map(swatch)} />
        {(own.presets.length > 0 || own.unread > 0) && (
          <Section title="내 프리셋" level={3} note={own.unread > 0 ? `읽지 못한 프리셋 ${own.unread}개` : undefined}>
            <Swatches label="내 프리셋" sample={SWATCH_SAMPLE} items={own.presets.map((preset, index) => ({ ...swatch(preset), menu: menu(preset, index) }))} onMove={move} />
          </Section>
        )}
      </Section>
      {naming && (
        <NameDialog
          title={naming.preset ? '프리셋 이름 바꾸기' : '프리셋으로 저장'}
          value={naming.preset?.name ?? `내 프리셋 ${own.presets.length + 1}`}
          onSave={name}
          onClose={() => setNaming(null)}
        />
      )}
      <Beside
        variant="preview"
        side={
          <Section title="미리보기">
            <ReadingPreview label="미리보기" reading={reading} rows={SAMPLE} />
          </Section>
        }
      >
        <Section title="색">
          <SettingGroup label="색">
            <SettingRow label="테마" control={<ChoiceGroup layout="segmented" label="테마" options={choices(THEME)} value={display.theme} onChange={(theme) => changeDisplay({ theme })} />} />
            <SettingRow
              label="배경"
              help="봇이 직접 꾸민 부분은 기본 배경에 맞춰져 있어서, 다른 배경에선 어색할 수 있어요."
              control={<ChoiceGroup label="배경" options={colorChoices('bg', BG)} value={display.bg} onChange={(bg) => changeDisplay({ bg })} />}
            />
            <SettingRow label="글자" control={<ChoiceGroup label="글자" options={colorChoices('ink', INK)} value={display.ink} onChange={(ink) => changeDisplay({ ink })} />} />
            <SettingRow label="대사" control={<ChoiceGroup label="대사" options={colorChoices('dialogue', DIALOGUE)} value={display.dialogue} onChange={(dialogue) => changeDisplay({ dialogue })} />} />
            <SettingRow label="강조" control={<ChoiceGroup label="강조" options={colorChoices('accent', ACCENT)} value={display.accent} onChange={(accent) => changeDisplay({ accent })} />} />
          </SettingGroup>
        </Section>
        <Section title="이미지">
          <SettingGroup label="이미지">
            <HidePicturesRow />
            <PictureMostRow />
          </SettingGroup>
        </Section>
        <Section title="텍스트">
          <SettingGroup label="텍스트">
            <ReadingRows />
            <SettingRow label="대사 모양" control={<ChoiceGroup label="대사 모양" options={choices(QUOTE_SHAPE)} value={display.quotes} onChange={(quotes) => changeDisplay({ quotes })} />} />
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
              help="위로 스크롤하면 한 줄로 접고, 맨 아래로 내려가면 다시 펼쳐요."
              control={<Switch label="입력창 접기" checked={display.foldComposer} onChange={(foldComposer) => changeDisplay({ foldComposer })} />}
            />
          </SettingGroup>
        </Section>
      </Beside>
    </Screen>
  );
}

// Unlike a character's, this one is never empty: it is what an empty one follows.
const readMost = (draft: string) => readPictureHeight(draft) ?? null;

function PictureMostRow() {
  const { display, changeDisplay } = useDisplay();
  const [typed, setTyped] = useState<string>();
  const draft = typedText(typed, readMost, display.pictureMost, String);
  const invalid = readMost(draft) === null;
  const type = (next: string) => {
    setTyped(next);
    const most = readMost(next);
    if (most !== null) changeDisplay({ pictureMost: most });
  };
  return (
    <SettingRow
      label="이미지 최대 높이"
      help="화면 높이 대비 비율이에요. 세로로 긴 이미지가 이 높이에 맞춰 줄어들어요. 봇마다 따로 정할 수도 있어요."
      error={invalid ? PICTURE_HEIGHT_ERROR : undefined}
      control={<NumberInput label="이미지 최대 높이" value={draft} unit="%" invalid={invalid} onChange={type} />}
    />
  );
}
