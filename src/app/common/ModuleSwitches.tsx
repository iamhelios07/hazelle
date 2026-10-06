import { setModuleAt, type ModulePlace } from '../../runtime/modules';
import { useModules, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Section, SettingGroup, SettingRow, Switch, Text } from '../ui';
import { ALWAYS, moduleName, PAGES } from './words';

type Owner = Exclude<ModulePlace, { kind: 'always' }>;

const WORKS: Record<Owner['kind'], string> = { character: '켠 모듈은 이 캐릭터의 모든 채팅에 적용돼요.', prompt: '켠 모듈은 이 프롬프트를 쓰는 채팅에 적용돼요.' };

// 캐릭터 편집's and a conversation prompt's 모듈 section. own: the owner's modules as stored.
export function ModuleSwitches({ owner, own }: { owner: Owner; own: string[] }) {
  const store = useStore();
  const toast = useToast();
  const modules = useModules();
  const always = useSettings().modules ?? [];

  async function change(module: string, on: boolean) {
    const saved = await setModuleAt(store, owner, module, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  if (modules.length === 0) return null;
  return (
    <Section title={PAGES.modules} hint={WORKS[owner.kind]}>
      <SettingGroup label={PAGES.modules}>
        {modules.map(({ id: module, value }) => (
          <SettingRow
            key={module}
            label={moduleName(value.name)}
            control={
              always.includes(module) ? (
                <Text variant="note">{ALWAYS} 켜짐</Text>
              ) : (
                <Switch label={moduleName(value.name)} checked={own.includes(module)} onChange={(on) => void change(module, on)} />
              )
            }
          />
        ))}
      </SettingGroup>
    </Section>
  );
}
