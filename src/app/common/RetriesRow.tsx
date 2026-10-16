import { useState } from 'react';
import { RETRY_MOST } from '../../contracts/streams';
import { NumberInput, SettingRow } from '../ui';
import { typedText } from './typed';
import { readOptional } from './typedNumber';
import { RETRY_COUNT, RETRY_HELP } from './words';

// undefined: left empty. null: not a count the field takes.
const readRetries = (text: string) => {
  const count = readOptional(text, true);
  return count === undefined || (count !== null && count >= 0 && count <= RETRY_MOST) ? count : null;
};

// A count over the one above it (a connection's over the shared one, a 설정 묶음's over its connection's). Left empty, it
// follows that one, which the placeholder names.
export function RetriesRow({ value, follows, onChange }: { value: number | undefined; follows: string; onChange: (retries: number | undefined) => void }) {
  const [typed, setTyped] = useState<string>();
  const draft = typedText(typed, readRetries, value, (count) => (count === undefined ? '' : String(count)));
  const invalid = readRetries(draft) === null;
  const type = (next: string) => {
    setTyped(next);
    const count = readRetries(next);
    if (count !== null) onChange(count);
  };
  return (
    <SettingRow
      label={RETRY_COUNT}
      help={RETRY_HELP}
      changed={value !== undefined}
      error={invalid ? `0부터 ${RETRY_MOST} 사이의 정수를 입력해 주세요.` : undefined}
      control={<NumberInput label={RETRY_COUNT} value={draft} placeholder={follows} invalid={invalid} onChange={type} />}
    />
  );
}
