import { Trash2 } from 'lucide-react';
import type { ChatItem } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { Button, Dialog, Row, Stack, Text } from '../../ui';

// The one removal that asks first: 지금 지우기 cannot be undone, where every other deletion offers 되돌리기 (design F3).
export function PurgeDialog({ shelf, onPurge, onClose }: { shelf: CharacterShelf<ChatItem>; onPurge: () => void; onClose: () => void }) {
  return (
    <Dialog title="완전히 지울까요?" onClose={onClose}>
      <Stack>
        <Text>
          ‘{shelf.character.card.name}’ {shelf.chats.length ? `캐릭터와 채팅 ${shelf.chats.length}개를` : '캐릭터를'} 지금 완전히 지워요. 되돌릴 수 없어요.
        </Text>
        <Row kind="actions">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button icon={Trash2} onClick={onPurge}>
            완전히 지우기
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
