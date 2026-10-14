import type { Role } from '../../connectors/assignment';
import type { RegexScript } from '../../engine/import/types';
import { KEEP_DAYS } from '../../model/library';

// Sentences stay in their screen and are built from these; the phrases these replaced are refused by lint
// (RETIRED_COPY in eslint.config.js).
// Kept apart on purpose, not variants of one word: 빼기 takes out of a list, 삭제 deletes. 편집 opens an item's
// editor, 수정 changes a message in place. 다시 생성 asks for another reply, 다시 시도 repeats a failed or stopped
// one. 컨텍스트 길이 is the model's own, 컨텍스트 한도 the setting. 원문 is what a translation came from, 요청 원문
// the request a reply was asked with. 사용 중 marks what is in use, 생성 중 a reply being written.

export const MODEL_ROLES: Record<Role, string> = { main: '대화 모델', aux: '보조 모델', embed: '임베딩 모델' };

// Where a translation's model comes from, said beside the model wherever it shows.
export const TRANSLATION_MODEL_HELP = `번역 프롬프트에서 선택하지 않으면 ${MODEL_ROLES.aux}을 사용해요.`;

export const AUX_HELP = '번역, 장기 기억 정리처럼 대화 밖의 작업에 사용해요.';

// 캐릭터 편집's switch for a bot whose script calls a model, and what the card that asks it in the chat says first.
export const BOT_MODELS = '봇의 모델 호출';
export const BOT_MODELS_HELP = '봇 스크립트가 응답과 별도로 모델을 호출해요. 그만큼 요금이 더 들 수 있어요.';
export const BOT_STUCK = '봇 스크립트가 끝나지 않아 멈췄어요';

export const TOOL = '도구';
export const MODULE_MODELS = '모델 호출';
export const MODULE_MODELS_HELP = '이 모듈이 응답과 별도로 모델을 호출해요. 그만큼 요금이 더 들 수 있어요.';
export const MODEL_CONSENT = { character: '이 봇이 모델을 추가로 호출하려고 해요', module: '이 모듈이 모델을 따로 부르려고 해요' };
export const MEMORY_CLAIM = '이 모듈이 장기 기억을 대신 맡으려고 해요';
export const MEMORY_CLAIM_HELP = '허용하면 이 모듈을 쓰는 채팅에서는 기본 장기 기억이 쉬어요. 기록은 지우지 않아요.';
export const TOOL_LATE = '도구가 늦어서 이번엔 빼고 보냈어요';
export const TOOL_STALE = '다음 응답이 나와서 도구가 바꾼 내용은 넣지 않았어요';
export const toolVersion = (version: string) => version || UNKNOWN;
export const TOOL_STUCK = '도구가 응답하지 않아 멈췄어요';
export const TOOL_DISABLED = '도구가 세 번 멈춰서 껐어요. 새로고침하면 다시 켜져요';
export const TOOL_FIELD_CHANGED = '도구가 바뀌어서 다시 설정해야 해요.';

export const SETTINGS = '설정';

// Where what is deleted waits KEEP_DAYS, to be brought back or removed for good: a tab of 캐릭터 둘러보기.
export const BIN = '휴지통';
// What the toast of a deletion that goes there adds.
export const BIN_KEEPS = `${KEEP_DAYS}일 안에 '${BIN}'에서 복원할 수 있어요.`;

export const COMMAND = '명령어';

// A face's picture, a character's or a persona's, in its editor.
export const CHANGE_IMAGE = '이미지 바꾸기';
export const UNREADABLE_IMAGE = '이 이미지는 열 수 없어요.';

export const TRANSLATOR_NOTE = '번역가의 노트';
export const NOTE_PLACEHOLDER = 'Master -> 주인님\n존댓말은 그대로 둬 주세요';
export const noteLines = (note: string | undefined) => (note ?? '').split('\n').filter((line) => line.trim()).length;
export const NOTE_UNSENT = `번역 프롬프트에 '${TRANSLATOR_NOTE}' 블록을 추가해야 노트가 적용돼요.`;

// 설정's pages, which SettingsNav lists and a sentence points to.
export const PAGES = { models: '모델', connections: 'API 연결', chat: '채팅 기본값', prompts: '프롬프트', personas: '페르소나', modules: '모듈', display: '디스플레이', translator: '번역기', account: '계정', usage: '사용량', admin: '운영' };

// A module on in every chat: its mark in 설정's 모듈, its switch there (항상 켜기), and what stands in its switch's
// place in 캐릭터 편집's and a prompt's 모듈 section (항상 켜짐).
export const ALWAYS = '항상';

// The layer of the model assignment that 설정's 모델 page holds, under every prompt and chat.
export const DEFAULT_MODELS = '기본 모델';

// What passes between a person and the operator, always said with its direction. from: what the operator sent, on the
// person's page. received: what people sent, on the operator's page. send: the operator sending one.
export const NOTICES = { from: '운영자가 보낸 알림', received: '받은 알림', send: '알림 보내기' };

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;

// An unset choice takes its value from somewhere else, and names it: 기본 모델 따르기, 보조 모델 따르기.
export const follows = (source: string) => `${source} 따르기`;

// A module Risu kept without a name still needs one to be told apart in a list.
export const moduleName = (name: string) => name.trim() || '이름 없는 모듈';
export const promptName = (name: string) => name || '이름 없는 프롬프트';
export const DELETED_PROMPT = '삭제된 프롬프트';
export const loreName = (name: string) => name.trim() || '이름 없는 항목';

export const NOT_STARRED = '즐겨찾기에 없음';

export const noStarred = (then: string) => `즐겨찾기한 모델이 없어요. ${inSettings('connections')}에서 모델을 즐겨찾기하면 여기서 ${then}.`;

export const CAST = '등장인물';

// A message's tool, the chat ⋯ item and the list it opens.
export const BOOKMARK = '북마크';

// A pack's scripts, 정규식 and 트리거 (Lua and block ones), under one 스크립트.
export const SCRIPTS = { part: '스크립트', regex: '정규식', triggers: '트리거' };
export const STAGES: Record<RegexScript['stage'], string> = { input: '입력', output: '응답', process: '요청', display: '화면' };
// One without a name, by its place in its list: the same in the editor and in 상태창 지정.
export const scriptName = (name: string, list: 'regex' | 'triggers', place: number) => name.trim() || `${SCRIPTS[list]} ${place + 1}`;

export const CHAPTER = '챕터';

// The chats with no character: their shelf, and the choice that puts a chat there.
export const NO_CHARACTER = '캐릭터 없이';

// The chat ⋯ item and its dialog. A 채팅 파일 is one chat as JSON, which 채팅 가져오기 brings back as a new chat.
export const EXPORT = '내보내기';
export const CHAT_FILE = '채팅 파일';
export const IMPORT_CHATS = '채팅 가져오기';
export const ARCA_LOG = '아카라이브용 HTML';

// An empty model setting is unset: nothing is sent, and the provider's default applies. It is never shown as a number.
// Not 기본값, which reads as the default 설정 named 기본.
export const UNSET = '모델 원래 값';

// A 설정 묶음's discount lane (design §6.7), a reply waiting on its batch, and one whose batch 멈추기 canceled, which
// shows an answer made before the cancel landed.
export const DISCOUNT = '할인 받기';
export const DISCOUNT_WAITING = '할인 받는 중이에요. 답이 다 만들어지면 한 번에 보여요.';
export const DISCOUNT_STOPPING = '멈추는 중이에요. 그사이 답이 다 만들어지면 그 답을 보여요.';

// A reply whose try failed before any of it came, sent again (design §6.7, retry on failure): the shared count, a
// connection's or a 설정 묶음's.
export const RETRYING = '응답을 받지 못해서 다시 보내고 있어요.';
export const RETRY_COUNT = '실패하면 다시 보내기';
export const RETRY_HELP = '응답이 오기 전에 실패하면 이 횟수만큼 다시 보내요. 키나 요청이 잘못됐을 때는 바로 알려요.';

// The fold that keeps a page's rarely changed settings out of sight, saying how many of them are set.
export const detailLabel = (set: number) => (set ? `세부 설정 · ${set}개 정함` : '세부 설정');

// A value nobody reported, said as such rather than as a made-up figure.
export const UNKNOWN = '알 수 없음';
export const RESET = '기본값으로 되돌리기';
export const UNDO = '되돌리기';
export const STOP = '멈추기';

// A share link: the character ⋯ item and its dialog, 설정 › 계정's list, the link's own page and the operator's inbox.
// held: paused by a report or the operator; removed: blocked by the operator.
export const SHARE = {
  act: '링크로 공유',
  cut: '링크 끊기',
  update: '새 버전으로 바꾸기',
  received: '받은 횟수',
  list: '공유한 링크',
  held: '보류 중',
  removed: '운영자가 내림',
  cover: '미리보기 글',
  coverHelp: '링크를 붙여 넣은 곳에 이름, 제작자, 소개 첫 줄이 글로 보여요. 이미지는 보이지 않아요.',
  heldNote: '신고가 들어와 운영자가 확인하는 동안 멈춘 링크예요.',
  removedNote: '운영자가 내린 링크예요.',
  goneNote: '끊겼거나 운영자가 내린 링크예요.',
  download: '파일로 받기',
  bring: '헤이젤로 가져오기',
  report: '신고',
};
