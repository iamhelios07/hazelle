import { ToolSection } from './ToolSection';
import type { Stored } from '../../model/kinds';
import { editModule, setModuleAlways, setModuleDeleted } from '../../runtime/modules';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { LoreEditor } from '../common/LoreEditor';
import { ScriptsEditor } from '../common/ScriptsEditor';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { ALWAYS, BIN_KEEPS, moduleName, promptName } from '../common/words';
import { useLibrary, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import { characterPage, type Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Empty, List, ListItem, MenuItem, NavBar, Screen, Section, SettingGroup, SettingRow, Switch, Text, TextField, useWide } from '../ui';
import { useHolds } from './ModulesScreen';

const ALWAYS_ON = `${ALWAYS} 켜기`;
const USED_BY = '쓰는 캐릭터';
const PROMPTS_USING = '쓰는 프롬프트';

export function ModuleScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const wide = useWide();
  const { id, value } = stored;
  const always = useSettings().modules?.includes(id) ?? false;
  const users = useLibrary().characters.filter(({ character }) => character.modules?.includes(id));
  const prompts = usePrompts().filter(({ value }) => value.task === undefined && value.modules?.includes(id));
  const holds = useHolds(stored);
  const autosave = useAutosave<{ name: string; description: string }>(`module:${id}`, (patch) => editModule(store, id, patch));
  const name = autosave.unsaved.name ?? value.name;
  const description = autosave.unsaved.description ?? value.description;

  async function setAlways(on: boolean) {
    const saved = await setModuleAlways(store, id, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  function mark(at: number | null) {
    void setModuleDeleted(store, id, at).then((saved) => saved.ok || toast.failed(saved));
  }

  function remove() {
    mark(Date.now());
    navigate({ kind: 'modules' });
    toast.undoable(`'${moduleName(name)}' 모듈을 삭제했어요.`, () => mark(null), BIN_KEEPS);
  }

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
      <LoreEditor owner={{ kind: 'module', id }} folders={value.loreFolders} />
      <ScriptsEditor owner={{ kind: 'module', id }} pack={value} drill={!wide} />
    </Screen>
  );
}
