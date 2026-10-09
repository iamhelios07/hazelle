import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { fieldValue } from '../../engine/import/tool';
import type { Stored } from '../../model/kinds';
import type { Settings, ToolField } from '../../tool-api/manifest';
import { setModels } from '../../runtime/pack';
import { scriptsOf } from '../../runtime/scripts';
import { setToolSettings } from '../../runtime/tools/store';
import { typedText } from '../common/typed';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { MODULE_MODELS, MODULE_MODELS_HELP, TOOL, TOOL_FIELD_CHANGED } from '../common/words';
import { useSession, useTool } from '../session';
import { navigate } from '../shell/router';
import { Button, ChoiceGroup, Facts, NumberInput, Section, SettingGroup, SettingRow, Stack, Switch, TextField } from '../ui';

export function ToolSection({ module }: { module: Stored<'module'> }) {
  const stored = useTool(module.id);
  const lua = scriptsOf([{ id: module.id, pack: module.value, module: { namespace: module.value.namespace } }]).length > 0;
  const models = lua || stored?.value.manifest.uses.includes('model');
  if (!stored) return models ? <SettingGroup label={MODULE_MODELS}><ModelConsent module={module} /></SettingGroup> : null;
  const { manifest, settings } = stored.value;
  return (
    <Section
      title={TOOL}
      action={manifest.page && <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => navigate({ kind: 'tool-page', module: module.id })}>열기</Button>}
    >
      <Stack gap="group">
        <Facts items={[{ label: '버전', value: manifest.version || '알 수 없음' }, { label: '제작자', value: manifest.author }]} />
        {(models || manifest.settings.length > 0) && <SettingGroup label={`${TOOL} 설정`}>
          {models && <ModelConsent module={module} />}
          {manifest.settings.map((field) => <ToolSetting key={field.key} module={module.id} field={field} value={settings[field.key]} />)}
        </SettingGroup>}
      </Stack>
    </Section>
  );
}

function ModelConsent({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const save = useAutosave<{ on: boolean }>(`module-models:${module.id}`, ({ on }) => setModels(store, { kind: 'module', id: module.id }, on!));
  return <SettingRow label={MODULE_MODELS} help={MODULE_MODELS_HELP} note={save.status ? SAVE_STATUS[save.status] : undefined} control={<Switch label={MODULE_MODELS} checked={save.unsaved.on ?? module.value.botModels === true} onChange={(on) => void save.save({ on })} />} />;
}

const readNumber = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
type SettingProps = { module: string; field: ToolField; value: Settings[string] | undefined };

function ToolSetting({ module, field, value: stored }: SettingProps) {
  const session = useSession();
  const save = useAutosave<{ value: Settings[string] }>(`tool-setting:${module}:${field.key}`, ({ value }) => setToolSettings(session, module, { [field.key]: value! }));
  const [typed, setTyped] = useState<string>();
  const value = save.unsaved.value ?? stored;
  const changedType = value !== undefined && !fieldValue(field, value);
  const note = save.status ? SAVE_STATUS[save.status] : undefined;
  if (field.type === 'number') {
    const text = typedText<Settings[string] | undefined>(typed, readNumber, value, (current) => current === undefined ? '' : String(current));
    const invalid = (typed !== undefined || value !== undefined) && readNumber(text) === null;
    return <SettingRow label={field.label} error={invalid ? '숫자를 입력해 주세요.' : undefined} note={invalid ? undefined : note} control={<NumberInput label={field.label} value={text} invalid={invalid} onChange={(text) => {
      setTyped(text);
      const number = readNumber(text);
      save.change({ value: number ?? text }, number !== null);
    }} />} />;
  }
  const error = changedType ? TOOL_FIELD_CHANGED : undefined;
  if (field.type === 'text') return <SettingRow label={field.label} wide error={error} note={error ? undefined : note} control={<TextField label={field.label} showLabel={false} value={value === undefined ? '' : String(value)} onChange={(value) => save.change({ value })} />} />;
  if (field.type === 'switch') return <SettingRow label={field.label} error={error} note={error ? undefined : note} control={<Switch label={field.label} checked={value === true} onChange={(value) => void save.save({ value })} />} />;
  return <SettingRow label={field.label} wide error={error} note={error ? undefined : note} control={<ChoiceGroup label={field.label} options={(field.options ?? []).map((option) => ({ value: option, label: option }))} value={typeof value === 'string' ? value : null} onChange={(value) => void save.save({ value })} />} />;
}
