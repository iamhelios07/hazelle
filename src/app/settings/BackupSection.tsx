import { Download, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { exportBackup, readBackup, restoreBackup, type Backup } from '../../runtime/backup';
import { downloadOutput } from '../common/download';
import { describeFailure } from '../common/failure';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, FileButton, Section, SettingGroup, SettingRow } from '../ui';

const UNREAD: Record<'not-backup' | 'other-version' | 'backup-storage' | 'backup-crashed', { message: string; detail?: string }> = {
  'not-backup': { message: 'risu-alpha 백업 파일이 아니거나 망가진 파일이에요.' },
  'other-version': { message: '이 버전이 모르는 백업 파일이에요.', detail: '새로고침한 뒤 다시 해 보세요.' },
  'backup-storage': { message: '백업을 준비할 임시 저장 공간을 열지 못했어요.', detail: '기기의 저장 공간과 브라우저의 저장 설정을 확인해 주세요.' },
  'backup-crashed': { message: '백업을 다루던 작업이 도중에 멈췄어요.', detail: '새로고침한 뒤 다시 해 보세요.' },
};

// sv-SE writes the local date as 2026-09-29.
const today = () => new Date().toLocaleDateString('sv-SE');

// The user's own full backup, loaded back only into a new account.
export function BackupSection() {
  const { username, store, files } = useSession();
  const toast = useToast();
  const [active, setActive] = useState<{ direction: 'save' | 'load'; done: number; total: number } | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const saving = active?.direction === 'save';
  const loading = active?.direction === 'load';

  function begin(direction: 'save' | 'load') {
    const abort = new AbortController();
    running.current = abort;
    setActive({ direction, done: 0, total: 0 });
    return { signal: abort.signal, progress: (done: number, total: number) => setActive({ direction, done, total }) };
  }

  const unread = (error: keyof typeof UNREAD) => toast.error(UNREAD[error].message, { detail: UNREAD[error].detail });

  async function save() {
    const options = begin('save');
    try {
      const destination = downloadOutput(`risu-alpha-${username}-${today()}.zip`);
      const made = await exportBackup(store, files, await destination, options);
      if (!made.ok) {
        if (made.error === 'stopped') return;
        if (made.error === 'backup-crashed') return unread(made.error);
        if (made.error === 'backup-write') return toast.error('백업 파일을 쓰지 못했어요.', { detail: '저장할 곳의 남은 공간을 확인한 뒤 다시 해 보세요.' });
        return toast.failed(made, '백업을 만들지 못했어요.');
      }
      const { left, skipped } = made.data;
      const detail = [left ? `금고 열쇠로 열리지 않는 항목 ${left}개는 담지 못했어요.` : '', skipped ? `내려진 그림 ${skipped}개는 빼고 담았어요.` : ''].filter(Boolean).join(' ');
      toast.show('백업을 받았어요.', detail ? { detail } : undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('백업을 저장하지 못했어요.');
    } finally {
      running.current = null;
      setActive(null);
    }
  }

  async function load(file: File) {
    let backup: Backup | null = null;
    const options = begin('load');
    try {
      const read = await readBackup(file, options);
      if (!read.ok) {
        if (read.error !== 'stopped') unread(read.error);
        return;
      }
      backup = read.backup;
      const loaded = await restoreBackup(store, files, backup, options);
      if (loaded.ok) return toast.show('백업을 불러왔어요.', loaded.data.skipped ? { detail: `내려졌거나 너무 큰 그림 ${loaded.data.skipped}개는 빼고 불러왔어요.` } : undefined);
      if (loaded.error === 'not-new') return toast.error('이미 저장한 것이 있는 계정이에요.', { detail: '백업은 새 계정에만 불러올 수 있어요.' });
      if (loaded.error === 'not-backup' || loaded.error === 'backup-storage' || loaded.error === 'backup-crashed') return unread(loaded.error);
      if (loaded.error === 'stopped') return toast.show('불러오기를 멈췄어요.', { detail: '같은 파일을 다시 불러오면 멈춘 곳부터 이어가요.' });
      toast.error('불러오다 멈췄어요.', { detail: `${describeFailure(loaded)} 같은 파일을 다시 불러오면 멈춘 곳부터 이어가요.` });
    } finally {
      await backup?.close();
      running.current = null;
      setActive(null);
    }
  }

  return (
    <Section title="백업">
      <SettingGroup label="백업">
        <SettingRow
          label="전체 백업"
          help="캐릭터, 채팅, 프롬프트, 페르소나, 연결과 그 키까지 zip 파일 하나로 받아요. 잠기지 않은 파일이라 비밀번호처럼 보관해 주세요."
          sub={saving && `받는 중 · ${active.done} / ${active.total}`}
          control={
            saving ? <Button variant="secondary" size="sm" onClick={() => running.current?.abort()}>중지</Button> :
              <Button variant="secondary" size="sm" icon={Download} disabled={active !== null} onClick={() => void save()}>
                받기
              </Button>
          }
        />
        <SettingRow
          label="백업 불러오기"
          help="아직 아무것도 저장하지 않은 새 계정에만 불러올 수 있어요."
          sub={loading && `불러오는 중 · ${active.done} / ${active.total}`}
          control={
            loading ? <Button variant="secondary" size="sm" onClick={() => running.current?.abort()}>중지</Button> :
              <FileButton accept=".zip" size="sm" icon={Upload} disabled={active !== null} onFile={(file) => void load(file)}>
                불러오기
              </FileButton>
          }
        />
      </SettingGroup>
    </Section>
  );
}
