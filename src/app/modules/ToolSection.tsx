import { ExternalLink } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { setModels, setNetwork, setTakesMemory } from '../../runtime/pack';
import { scriptsOf } from '../../runtime/scripts';
import { ToolSetting } from '../common/ToolSetting';
import { opensPage } from '../common/ToolView';
import type { Write } from '../common/saveQueue';
import { useAutosave } from '../common/useAutosave';
import { MEMORY_CLAIM_HELP, MODULE_MODELS, MODULE_MODELS_HELP, NETWORK, NETWORK_CALLED, NETWORK_HELP, TOOL, toolVersion } from '../common/words';
import { useSession, useTool, useToolHosts } from '../session';
import { navigate } from '../shell/router';
import { Button, Disclosure, Facts, Section, SettingGroup, SettingRow, Stack, Switch } from '../ui';

export function ToolSection({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const stored = useTool(module.id);
  const lua = scriptsOf([{ id: module.id, pack: module.value, module: { namespace: module.value.namespace } }]).length > 0;
  const models = lua || stored?.value.manifest.uses.some((use) => use === 'model' || use === 'embed');
  const consent = models && (
    <FlagRow
      saveKey={`module-models:${module.id}`}
      label={MODULE_MODELS}
      help={MODULE_MODELS_HELP}
      stored={module.value.botModels === true}
      write={(on) => setModels(store, { kind: 'module', id: module.id }, on)}
    />
  );
  if (!stored) return consent ? <SettingGroup label={MODULE_MODELS}>{consent}</SettingGroup> : null;
  const { manifest, settings } = stored.value;
  const memory = manifest.uses.includes('memory');
  const network = manifest.uses.includes('network');
  return (
    <Section
      title={TOOL}
      action={opensPage(manifest) && <Button variant="secondary" icon={ExternalLink} onClick={() => navigate({ kind: 'tool-page', module: module.id })}>열기</Button>}
    >
      <Stack gap="group">
        <Facts items={[{ label: '버전', value: toolVersion(manifest.version) }, { label: '제작자', value: manifest.author }]} />
        {(models || memory || network || manifest.settings.length > 0) && <SettingGroup label={`${TOOL} 설정`}>
          {consent}
          {network && (
            <FlagRow
              saveKey={`module-network:${module.id}`}
              label={NETWORK}
              help={NETWORK_HELP}
              stored={module.value.network === true}
              write={(on) => setNetwork(store, module.id, on)}
            />
          )}
          {memory && (
            <FlagRow
              saveKey={`module-memory:${module.id}`}
              label={MEMORY_CLAIM_LABEL}
              help={MEMORY_CLAIM_HELP}
              stored={module.value.takesMemory === true}
              write={(on) => setTakesMemory(store, module.id, on)}
            />
          )}
          {manifest.settings.map((field) => <ToolSetting key={field.key} module={module.id} field={field} value={settings[field.key]} />)}
        </SettingGroup>}
        {network && <CalledHosts module={module.id} />}
      </Stack>
    </Section>
  );
}

const MEMORY_CLAIM_LABEL = '장기 기억 맡기기';

// Only since this page loaded, and only where and how often: what was sent is never kept.
function CalledHosts({ module }: { module: string }) {
  const hosts = useToolHosts(module);
  if (!hosts) return null;
  return (
    <Disclosure label={NETWORK_CALLED}>
      <Facts items={[...hosts].map(([host, count]) => ({ label: host, value: `${count}번` }))} />
    </Disclosure>
  );
}

type FlagProps = { saveKey: string; label: string; help: string; stored: boolean; write: (on: boolean) => ReturnType<Write<{ on: boolean }>> };

function FlagRow({ saveKey, label, help, stored, write }: FlagProps) {
  const save = useAutosave<{ on: boolean }>(saveKey, ({ on }) => write(on!));
  return <SettingRow label={label} help={help} control={<Switch label={label} checked={save.unsaved.on ?? stored} onChange={(on) => void save.save({ on })} />} />;
}
