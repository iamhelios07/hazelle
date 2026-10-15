import type { ConversationPrompt } from '../../model/prompt';
import { presetFile } from '../../runtime/prompts';
import { download, fileNamed } from '../common/download';
import { FileExport } from '../common/FileExport';
import { SLOT_NAMES } from '../common/prompt-words';
import { promptName } from '../common/words';
import { useStore } from '../session';
import { useToast } from '../toast';

// Export spec §3 "Lost" and ruling 9: the prompt's models stay here, Risu keeps its own model settings, and top_p is the
// one Risu resets.
const LEFT = `Risu의 프리셋 가져오기로 열거나 Risu 창에 끌어다 놓으면 돼요. 이 프롬프트의 모델과 ${SLOT_NAMES.tool} 블록은 빠져요. 고르면 Risu에서 쓰던 모델과 설정은 그대로 두고, top_p만 1로 돌아가요.`;

export function PresetExport({ prompt, onClose }: { prompt: ConversationPrompt; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const name = promptName(prompt.name);
  const file = fileNamed(name, '프롬프트', 'risup');

  async function save() {
    const { bytes, tools } = await presetFile(store, prompt);
    download(file, new Blob([bytes]));
    toast.show(`'${name}' 프롬프트를 내보냈어요.`, tools ? { detail: `${SLOT_NAMES.tool} 블록 ${tools}개는 빼고 내보냈어요.` } : undefined);
    onClose();
  }

  return <FileExport format="Risu 프리셋" file={file} help={LEFT} blocked={null} onExport={save} onClose={onClose} />;
}
