import { useState } from 'react';
import { ToolSection } from './ToolSection';
import type { Stored } from '../../model/kinds';
import { likenessId } from '../../model/likeness';
import { isToggle } from '../../model/prompt';
import { exportModule } from '../../runtime/card-file';
import { editModule, setModuleAlways, setModuleDeleted } from '../../runtime/modules';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { holdsLine } from '../common/pack';
import { AssetsEditor } from '../common/AssetsEditor';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { LoreEditor } from '../common/LoreEditor';
import { PackToggles } from '../common/PackToggles';
import { ScriptsEditor } from '../common/ScriptsEditor';
import { PortraitsEditor } from '../common/PortraitsEditor';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { ALWAYS, BIN_KEEPS, EXPORT, moduleName, promptName, TOOL } from '../common/words';
import { useChildren, useFiles, useLibrary, usePersonas, usePrompts, useSettings, useStore, useStored } from '../session';
import { backBar, navigate } from '../shell/router';
import { characterPage, type Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Button, Empty, List, ListItem, MenuItem, NavBar, Screen, Section, SettingGroup, SettingRow, Switch, Text, TextField, useWide } from '../ui';
import { useModuleParts } from './ModulesScreen';

const ALWAYS_ON = `${ALWAYS} 켜기`;
const USED_BY = '쓰는 캐릭터';
const PROMPTS_USING = '쓰는 프롬프트';
const PERSONAS_USING = '쓰는 페르소나';
const RISU_FILE = 'Risu 모듈 파일';
const RISU_FILE_HELP =
  'RisuAI 설정 › 모듈에서 가져오거나 창에 끌어다 놓으면 열려요. 이미지는 그대로 담겨요. 도구와 삽화 프로필은 빠져요. 꺼 둔 스크립트와 로어북 항목은 Risu에 없고, 우선순위·위치가 있거나 키에 쉼표가 든 항목은 Risu에서 일부만 적용돼요. 헤이젤로 다시 가져오면 모두 그대로 돌아와요. Lua 트리거가 있으면 Risu의 저수준 접근을 켠 채로 내보내요.';

export function ModuleScreen({ stored, pane, back }: { stored: Stored<'module'>; pane: 'toggles' | null; back: Back }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const wide = useWide();
  const [exporting, setExporting] = useState<string | null>(null);
  const { id, value } = stored;
  const always = useSettings().modules?.includes(id) ?? false;
  const users = useLibrary().characters.filter(({ character }) => character.modules?.includes(id));
  const prompts = usePrompts().filter(({ value }) => value.task === undefined && value.modules?.includes(id));
  const personas = usePersonas().filter(({ value }) => value.modules?.includes(id));
  const holds = holdsLine(useModuleParts([stored])[0]!);
  // A module of scripts alone describes no one, so it offers no 삽화 profiles.
  const describes = useChildren('lore', id).length + useChildren('asset', id).length > 0 || useStored('likeness', likenessId(id)) !== null;
  const autosave = useAutosave<{ name: string; description: string }>(`module:${id}`, (patch) => editModule(store, id, patch));
  const name = autosave.unsaved.name ?? value.name;
  const description = autosave.unsaved.description ?? value.description;

  async function setAlways(on: boolean) {
    const saved = await setModuleAlways(store, id, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  function exportFile() {
    runExport(
      toast,
      fileNamed(name, moduleName(''), 'risum'),
      (output, progress) => exportModule(store, files, id, output, progress),
      setExporting,
      ({ tools }) => toast.show(`'${moduleName(name)}' 모듈을 내보냈어요.`, tools ? { detail: `${TOOL}는 빼고 내보냈어요.` } : undefined),
    );
  }

  function remove() {
    void setModuleDeleted(store, id, Date.now()).then((saved) => saved.ok || toast.failed(saved));
    navigate({ kind: 'modules' });
    toast.undoable(`'${moduleName(name)}' 모듈을 삭제했어요.`, () => setModuleDeleted(store, id, null), BIN_KEEPS);
  }

  if (pane === 'toggles')
    return (
      <Screen width="form" top={<NavBar title={moduleName(name)} {...backBar(back)} />}>
        <PackToggles owner={{ kind: 'module', id }} lines={value.toggles} />
      </Screen>
    );

  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={name}
          rename={{ label: '모듈 이름', placeholder: moduleName(''), onChange: (next) => autosave.change({ name: next }) }}
          status={autosave.status ? SAVE_STATUS[autosave.status] : undefined}
          {...backBar(back)}
          menu={{ of: '모듈', items: <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={remove} /> }}
        />
      }
    >
      <TextField label="설명" lines={3} value={description} onChange={(next) => autosave.change({ description: next })} />
      <Text variant="note">{holds}</Text>
      <SettingGroup label={ALWAYS_ON}>
        <SettingRow
          label={ALWAYS_ON}
          help="켜면 모든 채팅에 적용돼요."
          control={<Switch label={ALWAYS_ON} checked={always} onChange={(on) => void setAlways(on)} />}
        />
      </SettingGroup>
      <SettingGroup label={EXPORT}>
        <SettingRow
          label={RISU_FILE}
          help={RISU_FILE_HELP}
          control={
            <Button variant="secondary" size="sm" icon={ACTS.export.icon} busy={exporting !== null} onClick={exportFile}>
              {exporting ?? EXPORT}
            </Button>
          }
        />
      </SettingGroup>
      <ToolSection module={stored} />
      <Section title={PROMPTS_USING}>
        {prompts.length > 0 ? (
          <List label={PROMPTS_USING}>
            {prompts.map(({ id: prompt, value: { name } }) => (
              <ListItem key={prompt} title={promptName(name)} onClick={() => navigate({ kind: 'prompt', id: prompt, pane: null })} />
            ))}
          </List>
        ) : (
          <Empty variant="section">{always ? '따로 켠 프롬프트가 없어요.' : '켠 프롬프트가 없어요.'}</Empty>
        )}
      </Section>
      <Section title={USED_BY}>
        {users.length > 0 ? (
          <List label={USED_BY}>
            {users.map(({ id: character, character: { card, alias }, face }) => (
              <ListItem key={character} leading={<Avatar face={card.name} image={face} />} title={aliased(card.name, alias)} onClick={() => navigate(characterPage(character, wide))} />
            ))}
          </List>
        ) : (
          <Empty variant="section">{always ? '따로 켠 캐릭터가 없어요.' : '켠 캐릭터가 없어요.'}</Empty>
        )}
      </Section>
      <Section title={PERSONAS_USING}>
        {personas.length > 0 ? (
          <List label={PERSONAS_USING}>
            {personas.map(({ id: persona, value: { name, alias, picture } }) => (
              <ListItem key={persona} leading={<Avatar face={name} image={picture} tone="you" />} title={aliased(name, alias)} onClick={() => navigate({ kind: 'persona', id: persona })} />
            ))}
          </List>
        ) : (
          <Empty variant="section">{always ? '따로 켠 페르소나가 없어요.' : '켠 페르소나가 없어요.'}</Empty>
        )}
      </Section>
      <List box places label="토글">
        <ListItem title="토글" aside={`${value.toggles.filter(isToggle).length}개`} onClick={() => navigate({ kind: 'module', id, pane: 'toggles' })} />
      </List>
      <LoreEditor owner={{ kind: 'module', id }} folders={value.loreFolders} />
      <ScriptsEditor owner={{ kind: 'module', id }} pack={value} drill={!wide} />
      <AssetsEditor owner={id} />
      {describes && <PortraitsEditor owner={id} />}
    </Screen>
  );
}
