import { useState, type ReactNode } from 'react';
import { ACTS, importOf } from '../common/acts';
import { useCopy } from '../common/useCopy';
import { Button, Dialog, Disclosure, FileButton, Row, Section, Stack, Text } from '../ui';
import { INLAY_BOOKMARK, INLAY_EXPORT } from './inlayExport';

// Risu에서 이사: says which Risu files to get and takes them, the text's, for an account user the full backup that holds
// the pictures (design F7), and the export of the pictures inside messages. That export alone fills the chats already
// here (메시지 이미지 채우기). MoveFlow tells the files apart by what they hold.
export function MoveDialog({ onRead, onClose }: { onRead: (files: File[]) => void; onClose: () => void }) {
  const copy = useCopy();
  const [text, setText] = useState<File | null>(null);
  const [pictures, setPictures] = useState<File | null>(null);
  const [inlays, setInlays] = useState<File | null>(null);
  return (
    <Dialog
      title="Risu에서 이사"
      onClose={onClose}
      actions={
        <Button disabled={text === null && inlays === null} onClick={() => onRead(text ? [text, pictures, inlays].filter((file) => file !== null) : [inlays!])}>
          {text === null && inlays !== null ? '메시지 이미지 채우기' : '백업 읽기'}
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
        <Disclosure label="메시지 속 이미지도 옮기기">
          <Slot
            title="메시지 속 이미지"
            note="Risu 웹에서 F12를 눌러 콘솔에 코드를 붙여 넣으면 risu-inlays.bin을 받아요. 이미 옮긴 채팅에 채울 때는 이 파일만 넣어요."
            help="콘솔이 붙여 넣기를 막으면 allow pasting을 먼저 입력해요. 북마크로 쓰려면 새 북마크의 URL에 주소를 넣고 Risu 웹에서 눌러요."
            file={inlays}
            onFile={setInlays}
          >
            <Row kind="toolbar">
              <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(INLAY_EXPORT)}>
                코드 복사
              </Button>
              <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(INLAY_BOOKMARK)}>
                북마크 주소 복사
              </Button>
            </Row>
          </Slot>
        </Disclosure>
      </Stack>
    </Dialog>
  );
}

function Slot({ title, note, help, file, onFile, children }: { title: string; note: string; help?: string; file: File | null; onFile: (file: File) => void; children?: ReactNode }) {
  return (
    <Section level={3} title={title} help={help}>
      <Stack gap="related">
        <Text variant="note">{note}</Text>
        {children}
        <FileButton accept=".bin" size="sm" icon={ACTS.import.icon} onFiles={([file]) => onFile(file!)}>
          {file ? file.name : importOf('파일')}
        </FileButton>
      </Stack>
    </Section>
  );
}
