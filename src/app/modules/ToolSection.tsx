import { ExternalLink } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { setModels, setTakesMemory } from '../../runtime/pack';
import { scriptsOf } from '../../runtime/scripts';
import { ToolSetting } from '../common/ToolSetting';
import { useAutosave } from '../common/useAutosave';
import { MEMORY_CLAIM_HELP, MODULE_MODELS, MODULE_MODELS_HELP, TOOL, toolVersion } from '../common/words';
import { useSession, useTool } from '../session';
import { navigate } from '../shell/router';
import { Button, Facts, Section, SettingGroup, SettingRow, Stack, Switch } from '../ui';

export function ToolSection({ module }: { module: Stored<'module'> }) {
  const stored = useTool(module.id);
  const lua = scriptsOf([{ id: module.id, pack: module.value, module: { namespace: module.value.namespace } }]).length > 0;
  const models = lua || stored?.value.manifest.uses.some((use) => use === 'model' || use === 'embed');
  if (!stored) return models ? <SettingGroup label={MODULE_MODELS}><ModelConsent module={module} /></SettingGroup> : null;
  const { manifest, settings } = stored.value;
  const memory = manifest.uses.includes('memory');
  return (
    <Section
      title={TOOL}
      action={manifest.page && <Button variant="secondary" icon={ExternalLink} onClick={() => navigate({ kind: 'tool-page', module: module.id })}>열기</Button>}
    >
      <Stack gap="group">
        <Facts items={[{ label: '버전', value: toolVersion(manifest.version) }, { label: '제작자', value: manifest.author }]} />
        {(models || memory || manifest.settings.length > 0) && <SettingGroup label={`${TOOL} 설정`}>
          {models && <ModelConsent module={module} />}
          {memory && <MemoryClaim module={module} />}
          {manifest.settings.map((field) => <ToolSetting key={field.key} module={module.id} field={field} value={settings[field.key]} />)}
        </SettingGroup>}
      </Stack>
    </Section>
  );
}

function ModelConsent({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const save = useAutosave<{ on: boolean }>(`module-models:${module.id}`, ({ on }) => setModels(store, { kind: 'module', id: module.id }, on!));
  return <SettingRow label={MODULE_MODELS} help={MODULE_MODELS_HELP} control={<Switch label={MODULE_MODELS} checked={save.unsaved.on ?? module.value.botModels === true} onChange={(on) => void save.save({ on })} />} />;
}

const MEMORY_CLAIM_LABEL = '장기 기억 맡기기';

function MemoryClaim({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const save = useAutosave<{ on: boolean }>(`module-memory:${module.id}`, ({ on }) => setTakesMemory(store, module.id, on!));
  return <SettingRow label={MEMORY_CLAIM_LABEL} help={MEMORY_CLAIM_HELP} control={<Switch label={MEMORY_CLAIM_LABEL} checked={save.unsaved.on ?? module.value.takesMemory === true} onChange={(on) => void save.save({ on })} />} />;
}
