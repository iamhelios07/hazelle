import { useState } from 'react';
import { ACTS, importOf } from '../common/acts';
import { Button, Dialog, FileButton, Section, Stack, Text } from '../ui';

// Risu에서 이사: says which Risu backup files to get and takes them, the text's and, for an account user, the full backup
// that holds the pictures (design F7). onRead gets them in that order; MoveFlow reads them as one.
export function MoveDialog({ onRead, onClose }: { onRead: (files: File[]) => void; onClose: () => void }) {
  const [text, setText] = useState<File | null>(null);
  const [pictures, setPictures] = useState<File | null>(null);
  return (
    <Dialog
      title="Risu에서 이사"
      onClose={onClose}
      actions={
        <Button disabled={text === null} onClick={() => onRead(pictures ? [text!, pictures] : [text!])}>
          백업 읽기
        </Button>
      }
    >
      <Stack gap="section">
        <Text>Risu 로컬 백업(.bin)에서 캐릭터, 채팅, 페르소나, 프롬프트, 모듈을 가져와요.</Text>
        <Slot title="백업 파일" note="Risu의 '로컬 백업 저장'으로 받은 파일이에요. Risu 계정을 쓰면 '부분 백업'으로 받아 주세요." file={text} onFile={setText} />
        <Slot
          title="이미지가 든 전체 백업"
          note="Risu 계정을 쓸 때만 넣어요. 고급 설정에서 'Skip Saving Assets on Web Sync'를 끄고 받아야 이미지가 들어 있어요."
          file={pictures}
          onFile={setPictures}
        />
      </Stack>
    </Dialog>
  );
}

function Slot({ title, note, file, onFile }: { title: string; note: string; file: File | null; onFile: (file: File) => void }) {
  return (
    <Section level={3} title={title}>
      <Stack gap="related">
        <Text variant="note">{note}</Text>
        <FileButton accept=".bin" size="sm" icon={ACTS.import.icon} onFile={onFile}>
          {file ? file.name : importOf('파일')}
        </FileButton>
      </Stack>
    </Section>
  );
}
