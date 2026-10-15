import type { Persona } from '../../model/persona';
import { exportPersona } from '../../runtime/personas';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { FileExport } from '../common/FileExport';
import { useToast } from '../toast';

// Export spec §4 "Mapping both ways": modules and likenesses have no place in Risu's persona file; the alias is its note.
// A dropped PNG is a character card to Risu, so its persona import is the one way in.
const LEFT = 'Risu의 페르소나 설정에서 가져오기로 열어요. Risu 창에 끌어다 놓으면 캐릭터로 읽혀서 열리지 않아요. 켜 둔 모듈과 삽화 프로필은 빠지고, 별명은 Risu의 노트로 가요.';

export function PersonaExport({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  const toast = useToast();
  const file = fileNamed(persona.name, '페르소나', 'png');

  function save(show: (label: string | null) => void) {
    runExport(toast, file, (output) => exportPersona(persona, output), show, () => {
      toast.show(`'${persona.name}' 페르소나를 내보냈어요.`);
      onClose();
    });
  }

  const blocked = persona.description ? null : '설명이 비어 있으면 Risu가 받지 않아요. 설명을 채운 뒤 내보내 주세요.';
  return <FileExport format="Risu 페르소나" file={file} help={LEFT} blocked={blocked} onExport={save} onClose={onClose} />;
}
