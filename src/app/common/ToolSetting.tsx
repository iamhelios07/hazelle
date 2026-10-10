import { useState } from 'react';
import { fieldValue } from '../../engine/import/tool';
import { setToolSettings } from '../../runtime/tools/store';
import type { Settings, ToolField } from '../../tool-api/manifest';
import { useSession } from '../session';
import { ChoiceGroup, NumberInput, SettingRow, Switch, TextField } from '../ui';
import { typedText } from './typed';
import { readTyped } from './typedNumber';
import { SAVE_STATUS, useAutosave } from './useAutosave';
import { TOOL_FIELD_CHANGED } from './words';

// A tool's //@setting field, on its module's page and, marked composer, in the chat's composer.
const readNumber = (text: string) => {
  const typed = readTyped(text, false);
  return typed.ok ? typed.value : null;
};
// place: panel in the composer's popover.
type SettingProps = { module: string; field: ToolField; value: Settings[string] | undefined; place?: 'group' | 'panel' };

export function ToolSetting({ module, field, value: stored, place }: SettingProps) {
  const session = useSession();
  const save = useAutosave<{ value: Settings[string] }>(`tool-setting:${module}:${field.key}`, ({ value }) => setToolSettings(session, module, { [field.key]: value! }));
  const [typed, setTyped] = useState<string>();
  const value = save.unsaved.value ?? stored;
  const changedType = value !== undefined && !fieldValue(field, value);
  const note = save.status ? SAVE_STATUS[save.status] : undefined;
  if (field.type === 'number') {
    const text = typedText<Settings[string] | undefined>(typed, readNumber, value, (current) => current === undefined ? '' : String(current));
    const invalid = (typed !== undefined || value !== undefined) && readNumber(text) === null;
    return <SettingRow place={place} label={field.label} error={invalid ? '숫자를 입력해 주세요.' : undefined} note={invalid ? undefined : note} control={<NumberInput label={field.label} value={text} invalid={invalid} onChange={(text) => {
      setTyped(text);
      const number = readNumber(text);
      save.change({ value: number ?? text }, number !== null);
    }} />} />;
  }
  const error = changedType ? TOOL_FIELD_CHANGED : undefined;
  if (field.type === 'text') return <SettingRow place={place} label={field.label} wide error={error} note={error ? undefined : note} control={<TextField label={field.label} showLabel={false} value={value === undefined ? '' : String(value)} onChange={(value) => save.change({ value })} />} />;
  if (field.type === 'switch') return <SettingRow place={place} label={field.label} error={error} note={error ? undefined : note} control={<Switch label={field.label} checked={value === true} onChange={(value) => void save.save({ value })} />} />;
  return <SettingRow place={place} label={field.label} wide error={error} note={error ? undefined : note} control={<ChoiceGroup label={field.label} options={(field.options ?? []).map((option) => ({ value: option, label: option }))} value={typeof value === 'string' ? value : null} onChange={(value) => void save.save({ value })} />} />;
}
