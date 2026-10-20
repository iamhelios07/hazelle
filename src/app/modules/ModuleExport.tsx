import { exportModule } from '../../runtime/card-file';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { FileExport } from '../common/FileExport';
import { moduleName } from '../common/words';
import { useFiles, useStore } from '../session';
import { useToast } from '../toast';

const LEFT =
  'RisuAI 설정 › 모듈에서 가져오거나 창에 끌어다 놓으면 열려요. 이미지는 그대로 담기고, 삽화 프로필은 빠져요. Risu에는 끄기 기능이 없어서 꺼 둔 스크립트와 로어북 항목은 빠지고, 로어북의 우선순위와 위치도 빠지며, 쉼표가 들어간 키는 쉼표 기준으로 나뉘어요. 헤이젤로 다시 가져오면 모두 원래대로 돌아와요. Lua 트리거가 있으면 Risu의 저수준 접근을 켠 채로 내보내요.';

export function ModuleExport({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const file = fileNamed(name, moduleName(''), 'risum');

  function save(show: (label: string | null) => void) {
    runExport(toast, file, (output, progress) => exportModule(store, files, id, output, progress), show, () => {
      toast.show(`'${moduleName(name)}' 모듈을 내보냈어요.`);
      onClose();
    });
  }

  return <FileExport format="Risu 모듈" file={file} help={LEFT} blocked={null} onExport={save} onClose={onClose} />;
}
