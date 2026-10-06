import { ReadingRows, ReplyRow } from '../common/ReadingRows';
import { choices, describeLook, presetOf } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { ChoiceGroup, List, ListItem, NavBar, Screen, Section, SettingGroup, SettingRow, Switch, THEME } from '../ui';

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, changeDisplay, pick } = useDisplay();
  const current = presetOf(presets, reading, display);
  return (
    <Screen width="form" top={<NavBar title={PAGES.display} {...backBar(back)} />}>
      <SettingGroup label="테마">
        <SettingRow label="테마" control={<ChoiceGroup layout="segmented" label="테마" options={choices(THEME)} value={display.theme} onChange={(theme) => changeDisplay({ theme })} />} />
      </SettingGroup>
      <Section title="글">
        <SettingGroup label="글">
          <ReadingRows place="group" />
        </SettingGroup>
      </Section>
      <Section title="읽는 동안">
        <SettingGroup label="읽는 동안">
          <ReplyRow place="group" />
          <SettingRow
            label="헤더 숨기기"
            help="내려 읽는 동안 숨기고, 위로 올리거나 화면 위쪽을 가리키면 다시 보여요."
            control={<Switch label="헤더 숨기기" checked={display.hideHeader} onChange={(hideHeader) => changeDisplay({ hideHeader })} />}
          />
          <SettingRow
            label="입력창 접기"
            help="끝에서 위로 올려 읽는 동안 한 줄로 접고, 끝에 닿으면 다시 펼쳐요."
            control={<Switch label="입력창 접기" checked={display.foldComposer} onChange={(foldComposer) => changeDisplay({ foldComposer })} />}
          />
        </SettingGroup>
      </Section>
      <Section title="프리셋">
        <List label="프리셋">
          {presets.map((preset) => (
            <ListItem key={preset.name} title={preset.name} description={describeLook(preset.look)} selected={preset === current} onClick={() => pick(preset)} />
          ))}
        </List>
      </Section>
    </Screen>
  );
}
