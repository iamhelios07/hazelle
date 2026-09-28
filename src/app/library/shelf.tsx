import { MessageSquare } from 'lucide-react';
import type { ChatItem } from '../../model/chat';
import { daysLeft, type CharacterShelf, type Shelf } from '../../model/library';
import { ago } from '../common/time';
import { Avatar } from '../ui';

export const shelfName = (shelf: Shelf<ChatItem>) => shelf.character?.card.name ?? '캐릭터 없이';

export function ShelfFace({ shelf, size }: { shelf: Shelf<ChatItem>; size?: 'sm' | 'md' | 'lg' }) {
  return shelf.character ? <Avatar face={shelf.character.card.name} image={shelf.face} size={size} /> : <Avatar face={MessageSquare} size={size} />;
}

export function cardNote(shelf: CharacterShelf<ChatItem>): string {
  const latest = shelf.chats[0];
  return latest?.at ? `${ago(latest.at)} · 채팅 ${shelf.chats.length}개` : '아직 채팅이 없어요';
}

// How long a character in 지운 캐릭터 has left. Past its time it goes when the app next opens.
export function binCardNote(shelf: CharacterShelf<ChatItem>): string {
  const days = daysLeft(shelf.character, Date.now());
  const chats = shelf.chats.length ? ` · 채팅 ${shelf.chats.length}개` : '';
  return (days > 0 ? `${days}일 남음` : '곧 지워져요') + chats;
}
