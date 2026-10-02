import type { Role } from '../../connectors/assignment';

// The words several screens use for one thing, so it reads the same wherever it appears. Sentences stay in their
// screen and are built from these; the phrases these replaced are refused by lint (RETIRED_COPY in eslint.config.js).
// Kept apart on purpose, not variants of one word: 빼기 takes out of a list, 지우기 deletes. 편집 opens an item's
// editor, 수정 changes a message in place. 새 답장 받기 asks for another reply, 다시 시도 repeats a failed or stopped
// one. 컨텍스트 길이 is the model's own, 컨텍스트 한도 the setting. 원문 is what a translation came from, 요청 원문
// the request a reply was asked with. 사용 중 marks what is in use, 쓰는 중 a reply being written.

export const MODEL_ROLES: Record<Role, string> = { main: '대화 모델', aux: '보조 모델' };

export const AUX_HELP = '번역과 장기 기억 정리처럼 대화 밖에서 하는 일에 써요. 번역 프롬프트나 기억 프롬프트에서 모델을 고르면 그 일은 그 모델로 해요.';

// 캐릭터 편집's switch for a bot whose script calls a model, and what the card that asks it in the chat says first.
export const BOT_MODELS = '봇이 모델 부르기';
export const BOT_MODELS_HELP = '봇의 스크립트가 답장과 별개로 모델에 요청을 보내요. 그만큼 요금이 더 들 수 있어요.';

export const SETTINGS = '설정';

// A {{…}} tag in a prompt or a card's text.
export const COMMAND = '명령어';

// 설정's pages, which SettingsNav lists and a sentence points to.
export const PAGES = { models: '모델', connections: '연결', chat: '채팅', prompts: '프롬프트', personas: '페르소나', modules: '모듈', account: '계정', admin: '운영' };

// A module on in every chat: its mark in 설정's 모듈, its switch there (항상 켜기), and what stands in its switch's
// place in 캐릭터 편집 (항상 켜짐).
export const ALWAYS = '항상';
// Who a script's words and questions are from in a chat with no character, where only a module's script runs.
export const MODULE_VOICE = { name: PAGES.modules, face: null };

// The layer of the model assignment that 설정's 모델 page holds, under every prompt and chat.
export const DEFAULT_MODELS = '기본 모델';

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;

// An unset choice takes its value from somewhere else, and names it: 기본 모델 따르기, 보조 모델 따르기.
export const follows = (source: string) => `${source} 따르기`;

// A module Risu kept without a name still needs one to be told apart in a list.
export const moduleName = (name: string) => name.trim() || '이름 없는 모듈';

export const NOT_STARRED = '별표한 모델에 없음';

export const noStarred = (then: string) => `별표한 모델이 없어요. ${inSettings('connections')}에서 모델에 별표하면 여기서 ${then}.`;
