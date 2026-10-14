import { detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { ACTS, importOf, newOf } from '../common/acts';
import { Callout, FileButton, Link, Stack, TextField } from '../ui';

// type null: a 직접 연결, which may need no key and takes any.
export function KeyField({ type, value, onChange }: { type: ConnectionType | null; value: string; onChange: (key: string) => void }) {
  const form = type?.keyForm;
  const other = type && detect(value.trim());
  const elsewhere = other?.kind === 'key' && other.type !== type ? other.type : null;
  return (
    <Stack>
      <TextField
        label={form?.label ?? 'API 키'}
        kind="key"
        lines={form?.lines}
        placeholder={form?.placeholder}
        value={value}
        onChange={onChange}
        help="키는 암호화해서 저장하고, 서버에 남기지 않아요."
        hint={type ? undefined : '키가 필요 없으면 비워 두세요.'}
        action={
          form && (
            <FileButton accept={form.accept} size="sm" icon={ACTS.import.icon} onFiles={([file]) => void file!.text().then(onChange)}>
              {importOf('파일')}
            </FileButton>
          )
        }
      />
      {type?.keyPage && <Link href={type.keyPage}>{new URL(type.keyPage).host}에서 키 만들기</Link>}
      {elsewhere && <Callout tone="warn">{elsewhere.label} 키 같아요. {newOf('연결')}에서 다시 선택해 주세요.</Callout>}
    </Stack>
  );
}
