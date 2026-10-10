import type { PromptSort, Role, SlotKind } from '../../model/prompt';
import { TOOL, TRANSLATOR_NOTE } from './words';

export const SLOT_NAMES: Record<SlotKind, string> = {
  description: '캐릭터 설명',
  persona: '페르소나',
  lorebook: '로어북',
  authorNote: '작가의 노트',
  postEverything: '최종 삽입',
  chat: '채팅',
  note: TRANSLATOR_NOTE,
  recent: '이전 메시지',
  source: '원문',
  tool: TOOL,
  memory: '장기 기억',
  span: '정리할 메시지',
};

export const MESSAGE_ROLES: Record<Role, string> = { system: '시스템', user: '사용자', assistant: 'AI' };

export const textName = (role: Role) => `${MESSAGE_ROLES[role]} 메시지`;

export const TASK_NAMES: Record<Exclude<PromptSort, 'conversation'>, string> = { translate: '번역', memory: '기억', illustrate: '삽화' };
