import type { PromptSort, Role, SlotKind } from '../../model/prompt';

// What a prompt's parts are called, in the prompt editor and in 요청 원문.
export const SLOT_NAMES: Record<SlotKind, string> = {
  description: '캐릭터 설명',
  persona: '페르소나',
  lorebook: '로어북',
  authorNote: '작가의 노트',
  postEverything: '최종 삽입',
  chat: '채팅',
  recent: '앞 메시지',
  source: '원문',
  memory: '장기 기억',
  span: '정리할 메시지',
};

export const MESSAGE_ROLES: Record<Role, string> = { system: '시스템', user: '사용자', assistant: 'AI' };

// A text block with no name of its own.
export const textName = (role: Role) => `${MESSAGE_ROLES[role]} 글`;

// A task prompt's tag where it is listed among others.
export const TASK_NAMES: Record<Exclude<PromptSort, 'conversation'>, string> = { translate: '번역', memory: '기억' };
