import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { useState } from 'react';
import { EMPTY_SETTINGS, type SavedLook } from '../../model/settings';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { choices, describeLook, lookOf, moveLook, presetOf, savedPresets, type OwnPreset, type Preset } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { ACCENT, Beside, BG, Button, DIALOGUE, ChoiceGroup, ColorDot, INK, MenuItem, NavBar, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEME, type PreviewRow } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: '<p><em>창밖으로 늦은 오후의 햇살이 기울어 든다. 그녀는 찻잔을 내려놓고 고개를 들었다.</em></p><p>"오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아."</p>' },
  { name: '나', mine: true, html: '<p>"이번엔 끝까지 읽었어. 결말이 좀 의외던데."</p>' },
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
            <SettingRow
              label="이미지 가리기"
              help="채팅 속 이미지는 눌러서 하나씩 볼 수 있어요."
              control={<Switch label="이미지 가리기" checked={display.hidePictures} onChange={(hidePictures) => changeDisplay({ hidePictures })} />}
            />
          </SettingGroup>
        </Section>
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
