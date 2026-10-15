import { useEffect, useRef, useState } from 'react';
import { exportEveryCharacter, type EveryStep } from '../../runtime/risu-export';
import { ACTS } from '../common/acts';
import { downloadOutput } from '../common/download';
import { RISU_CHAT_FILE, RISU_LOSES, risuLeftOut, STOP, TOOL } from '../common/words';
import { useSaves, useSession } from '../session';
import { useToast } from '../toast';
import { Button, Dialog, Progress, SettingRow } from '../ui';

const LABEL = 'Risu로 옮길 파일';
const HELP = `캐릭터마다 charx 파일과 ${RISU_CHAT_FILE}을 zip 하나에 담아요. 압축을 푼 뒤 charx는 Risu 창에 끌어다 놓아요. ${RISU_LOSES}`;

// Every character with its chats, as files Risu loads one by one. Like the backup, it runs only while this screen
// does: the dialog keeps the person here and the hold has the browser ask before the tab goes.
export function RisuExportRow() {
  const { username, store, files } = useSession();
  const saves = useSaves();
  const toast = useToast();
  const [step, setStep] = useState<EveryStep | 'starting' | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const stop = () => running.current?.abort();

  async function save() {
    const abort = new AbortController();
    running.current = abort;
    const release = saves.hold();
    setStep('starting');
    try {
      const destination = downloadOutput(`hazelle-${username}-risu.zip`);
      const made = await exportEveryCharacter({ store, files }, await destination, abort.signal, setStep);
      if (!made.ok) {
        if (made.error === 'stopped') return;
        if (made.error === 'export-write') return toast.error('파일을 저장하지 못했어요.', { detail: '저장 공간을 확인한 뒤 다시 시도해 주세요.' });
        if (made.error === 'unreadable') return toast.error('내보내지 못했어요.', { detail: '열리지 않는 이미지가 있어요.' });
        return toast.failed(made, '내보내지 못했어요.');
      }
      const detail = [risuLeftOut(made.data), made.data.tools ? `${TOOL}가 든 모듈 ${made.data.tools}개는 빼고 내보냈어요.` : ''].filter(Boolean).join(' ');
      toast.show(`${LABEL}을 내보냈어요.`, detail ? { detail } : undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('파일을 저장하지 못했어요.');
    } finally {
      release();
      running.current = null;
      setStep(null);
    }
  }

  return (
    <>
      <SettingRow
        label={LABEL}
        help={HELP}
        control={
          <Button variant="secondary" size="sm" icon={ACTS.export.icon} disabled={step !== null} onClick={() => void save()}>
            {ACTS.export.label}
          </Button>
        }
      />
      {step && (
        <Dialog title={`${LABEL} 내보내는 중`} onClose={stop} actions={<Button variant="secondary" onClick={stop}>{STOP}</Button>}>
          <Progress hero steps={[step === 'starting' ? { label: '캐릭터' } : { label: `캐릭터 · ${step.name}`, done: step.done, total: step.total }]} />
        </Dialog>
      )}
    </>
  );
}
