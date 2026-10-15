import { useEffect, useRef, useState } from 'react';
import { exportEveryCharacter } from '../../runtime/risu-export';
import { ACTS } from '../common/acts';
import { runExport } from '../common/exporting';
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
  const [working, setWorking] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const stop = () => running.current?.abort();

  function save() {
    const abort = new AbortController();
    running.current = abort;
    const release = saves.hold();
    runExport(
      toast,
      `hazelle-${username}-risu.zip`,
      (output, progress) => exportEveryCharacter({ store, files }, output, abort.signal, progress),
      (label) => {
        setWorking(label);
        if (label !== null) return;
        release();
        running.current = null;
      },
      (made) => {
        const detail = [risuLeftOut(made), made.tools ? `${TOOL}가 든 모듈 ${made.tools}개는 빼고 내보냈어요.` : ''].filter(Boolean).join(' ');
        toast.show(`${LABEL}을 내보냈어요.`, detail ? { detail } : undefined);
      },
    );
  }

  return (
    <>
      <SettingRow
        label={LABEL}
        help={HELP}
        control={
          <Button variant="secondary" size="sm" icon={ACTS.export.icon} disabled={working !== null} onClick={save}>
            {ACTS.export.label}
          </Button>
        }
      />
      {working && (
        <Dialog title={LABEL} onClose={stop} actions={<Button variant="secondary" onClick={stop}>{STOP}</Button>}>
          <Progress hero steps={[{ label: `캐릭터 ${working}` }]} />
        </Dialog>
      )}
    </>
  );
}
