import type { Role, SlotKind } from '../../model/prompt';

// What a prompt's parts are called, in the prompt editor and in 요청 원문 (design §4.2, F3).
export const SLOT_NAMES: Record<SlotKind, string> = {
  description: '캐릭터 설명',
  persona: '페르소나',
  lorebook: '로어북',
  authorNote: '작가의 노트',
  postEverything: '최종 삽입',
  chat: '채팅',
  cache: '캐시 지점',
};

export const ROLE_WORDS: Record<Role, string> = { system: '시스템', user: '사용자', assistant: 'AI' };

// A text block with no name of its own.
export const textName = (role: Role) => `${ROLE_WORDS[role]} 글`;
