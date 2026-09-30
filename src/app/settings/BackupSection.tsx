import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { exportBackup, readBackup, restoreBackup } from '../../runtime/backup';
import { download } from '../common/download';
import { describeFailure } from '../common/failure';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, FileButton, Section, SettingGroup, SettingRow } from '../ui';

const UNREAD = {
  'not-backup': 'risu-alpha 백업 파일이 아니거나 망가진 파일이에요.',
  'other-version': '이 버전이 모르는 백업 파일이에요. 새로고침한 뒤 다시 해 보세요.',
};

// sv-SE writes the local date as 2026-09-29.
const today = () => new Date().toLocaleDateString('sv-SE');

// The user's own full backup, loaded back only into a new account.
export function BackupSection() {
  const { username, store, files } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);

  async function save() {
    setSaving(true);
    const made = await exportBackup(store, files);
    setSaving(false);
    if (!made.ok) return toast.failed(made, '백업을 만들지 못했어요.');
    download(`risu-alpha-${username}-${today()}.zip`, new Blob([made.data.zip], { type: 'application/zip' }));
    const { left } = made.data;
    toast.show(left ? `백업을 받았어요. 금고 열쇠로 열리지 않는 항목 ${left}개는 담지 못했어요.` : '백업을 받았어요.');
  }

  async function load(file: File) {
    setLoading({ done: 0, total: 0 });
    const read = readBackup(new Uint8Array(await file.arrayBuffer()));
    if (!read.ok) {
      setLoading(null);
      return toast.show(UNREAD[read.error]);
    }
    const loaded = await restoreBackup(store, files, read.backup, (done, total) => setLoading({ done, total }));
    setLoading(null);
    if (loaded.ok) return toast.show('백업을 불러왔어요.');
    if (loaded.error === 'not-new') return toast.show('이미 저장한 것이 있는 계정이에요. 백업은 새 계정에만 불러올 수 있어요.');
    if (loaded.error === 'not-backup') return toast.show(UNREAD['not-backup']);
    toast.show(`불러오다 멈췄어요. ${describeFailure(loaded)} 같은 파일을 다시 불러오면 멈춘 곳부터 이어가요.`);
  }

  return (
    <Section title="백업">
      <SettingGroup label="백업">
        <SettingRow
          label="전체 백업"
          help="캐릭터, 채팅, 프롬프트, 페르소나, 연결과 그 키까지 zip 파일 하나로 받아요."
          sub="잠기지 않은 파일이라 비밀번호처럼 보관해 주세요."
          control={
            <Button variant="secondary" size="sm" icon={Download} busy={saving} onClick={() => void save()}>
              받기
            </Button>
          }
        />
        <SettingRow
          label="백업 불러오기"
          help="아직 아무것도 저장하지 않은 새 계정에만 불러올 수 있어요."
          sub={loading && (loading.total ? `불러오는 중 ${loading.done}/${loading.total}` : '불러오는 중…')}
          control={
            <FileButton accept=".zip" size="sm" icon={Upload} busy={loading !== null} onFile={(file) => void load(file)}>
              불러오기
            </FileButton>
          }
        />
      </SettingGroup>
    </Section>
  );
}
