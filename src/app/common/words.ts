import type { LeftOut } from '../../runtime/risu-export';
import type { Role } from '../../connectors/assignment';
import type { RegexScript } from '../../engine/import/types';
import type { Feature } from '../../model/features';
import { KEEP_DAYS } from '../../model/library';
import { FIRST_PROFILE_NAME } from '../../runtime/profiles';

// Sentences stay in their screen and are built from these; the phrases these replaced are refused by lint
// (RETIRED_COPY in eslint.config.js).
// Kept apart on purpose, not variants of one word: 빼기 takes out of a list, 삭제 deletes. 편집 opens an item's
// editor, 수정 changes a message in place. 다시 생성 asks for another reply, 다시 시도 repeats a failed or stopped
// one. 컨텍스트 길이 is the model's own, 컨텍스트 한도 the setting. 원문 is what a translation came from, 요청 원문
// the request a reply was asked with, 응답 원문 the provider's answer as it came. 사용 중 marks what is in use, 생성 중 a reply being written.

export const MODEL_ROLES: Record<Role, string> = { main: '대화 모델', aux: '보조 모델', embed: '임베딩 모델' };
// A role as a tag on a model's row, where 모델 is the column: the prompts page tags its kinds the same short way.
export const ROLE_TAGS: Record<Role, string> = { main: '대화', aux: '보조', embed: '임베딩' };

// Where a task's model comes from, said beside the model wherever it shows, and the door to where it is chosen: the
// prompt's 모델 pane, whose picker reads 보조 모델 따르기. Without a prompt the task cannot run at all (prompt-missing),
// so the door goes to the prompts, not to 보조 모델.
export const taskModelHelp = (task: string, prompted: boolean) => ({
  text: `${task} 프롬프트에서 선택해요. 선택하지 않으면 ${MODEL_ROLES.aux}을 따라요.`,
  door: prompted ? opens(`${task} 프롬프트`) : opens(inSettings('prompts')),
});

export const AUX_HELP = '번역이나 장기 기억 정리처럼 대화 밖의 작업에 써요.';

// 캐릭터 편집's switch for a bot whose script calls a model, and what the card that asks it in the chat says first.
export const BOT_MODELS = '봇의 모델 호출';
export const BOT_MODELS_HELP = '봇 스크립트가 대화 응답과 별개로 모델을 호출해요. 호출한 만큼 요금이 더 나올 수 있어요.';
// 캐릭터 편집's switch for scripts that rewrite the card, and what the card that asks it in the chat says first.
export const CARD_WRITES = '스크립트의 카드 수정';
export const CARD_WRITES_HELP = '스크립트가 이 캐릭터의 배경 HTML을 바꿔서 저장해요. 바뀐 배경은 이 캐릭터의 모든 채팅에 적용돼요.';
export const CARD_WRITE_CONSENT = { character: '이 봇이 캐릭터 카드를 수정하려고 해요', module: '이 모듈이 캐릭터 카드를 수정하려고 해요' };
export const CARD_WRITE_ASK_HELP = '허용하면 이 캐릭터의 배경 HTML이 바뀌고 모든 채팅에 적용돼요. 이 캐릭터에서는 한 번만 물어봐요. 나중에 캐릭터 편집에서 다시 바꿀 수 있어요.';
export const BOT_STUCK = '봇 스크립트가 끝나지 않아서 멈췄어요';

export const TOOL = '도구';
export const RISU_PLUGIN = 'Risu 플러그인';
export const MODULE_MODELS = '모델 호출';
export const MODULE_MODELS_HELP = '이 모듈이 대화 응답과 별개로 모델을 호출해요. 호출한 만큼 요금이 더 나올 수 있어요.';
export const MODEL_CONSENT = { character: '이 봇이 모델을 추가로 호출하려고 해요', module: '이 모듈이 모델을 추가로 호출하려고 해요' };
export const MEMORY_CLAIM = '이 모듈이 장기 기억을 대신 관리하려고 해요';
export const MEMORY_CLAIM_HELP = '허용하면 이 모듈을 쓰는 채팅에서는 기본 장기 기억이 쉬어요. 기록은 지우지 않아요.';
// The ruling (design §6.10) is that the ask says plainly what the network allows, so the card's line is that sentence.
export const NETWORK = '외부 연결';
export const NETWORK_HELP = '켜면 이 모듈이 대화 내용을 앱 밖으로 보낼 수 있어요. 바깥 이미지와 글꼴은 화면을 새로고침한 뒤부터 보여요.';
export const NETWORK_CONSENT = '이 모듈이 대화 내용을 앱 밖으로 보낼 수 있어요';
export const networkAskHelp = (hosts: string[]) => ['허용하면 이 모듈이 바깥 주소에 연결해요. 이 모듈에서는 한 번만 물어보고, 모듈 화면에서 다시 바꿀 수 있어요.', ...(hosts.length ? [`코드에 적힌 주소: ${hosts.join(', ')}`] : [])].join(' ');
export const NETWORK_CALLED = '연결한 곳';
export const TOOL_LATE = '도구 응답이 늦어져서 이번에는 빼고 보냈어요';
export const TOOL_STALE = '이미 다음 응답이 나와서 도구가 바꾼 내용은 반영하지 않았어요';
export const toolVersion = (version: string) => version || UNKNOWN;
export const TOOL_STUCK = '도구가 응답하지 않아서 멈췄어요';
export const TOOL_DISABLED = '도구가 세 번 연속 멈춰서 껐어요. 화면을 새로고침하면 다시 켜져요';
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
export const NOTE_PLACEHOLDER = 'Master -> 주인님\n존댓말은 그대로 유지해 주세요';
export const noteLines = (note: string | undefined) => (note ?? '').split('\n').filter((line) => line.trim()).length;
export const NOTE_UNSENT = `번역 프롬프트에 '${TRANSLATOR_NOTE}' 블록을 추가해야 노트가 적용돼요.`;
export const ILLUSTRATE_NOTE = '삽화 노트';
export const ILLUSTRATE_NOTE_UNSENT = `삽화 프롬프트에 '${ILLUSTRATE_NOTE}' 블록을 추가해야 노트가 적용돼요.`;

// 설정's pages, which SettingsNav lists and a sentence points to.
export const PAGES = { models: '모델', connections: 'API 연결', chat: '채팅', prompts: '프롬프트', personas: '페르소나', modules: '모듈', display: '디스플레이', labs: '실험실', translator: '번역기', account: '계정', usage: '사용량', admin: '운영' };

// A module on in every chat: its mark in 설정's 모듈, its switch there (항상 켜기), and what stands in its switch's
// place in 캐릭터 편집's and a prompt's 모듈 section (항상 켜짐).
export const ALWAYS = '항상';

// The layer of the model assignment that 설정's 모델 page holds, under every prompt and chat.
export const DEFAULT_MODELS = '기본 모델';

// The profile object (design §4.4) on every screen; RETIRED_COPY bans the names it replaced.
export const MODEL_SETTINGS = '모델 설정';

// What passes between a person and the operator, always said with its direction. from: what the operator sent, on the
// person's page. received: what people sent, on the operator's page. send: the operator sending one.
export const NOTICES = { from: '운영자가 보낸 알림', sent: '내가 보낸 알림', received: '받은 알림', send: '알림 보내기' };

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;
export const inFeature = (feature: Feature) => `${inSettings('chat')} › ${FEATURE_NAMES[feature]}`;

// A hint's door to the place it names: the thing itself, or a settings page by inSettings when it lands on the page.
export const opens = (place: string) => `${place} 열기`;

// The only words for a layer's state, a tag beside the title of a panel that overrides a shared value (design, Secondary
// screens; user 2026-10-15). default: the shared layer's word, re-ruled 2026-10-16 to 공용, leaving 기본값 a field's
// starting value only.
export const SCOPE = { default: '공용', chat: '이 채팅만', character: '이 캐릭터만' } as const;
export const scopeTag = (scope: keyof typeof SCOPE) => ({ label: SCOPE[scope], tone: scope === 'default' ? 'plain' : 'accent' }) as const;

export const FEATURES_TITLE = '기능';
export const FEATURE_NAMES: Record<Feature, string> = { translate: '번역', illustrate: '삽화', memory: '장기 기억', mascot: '마스코트' };

// An unset choice takes its value from somewhere else, and names it: 기본 모델 따르기, 보조 모델 따르기.
export const follows = (source: string) => `${source} 따르기`;

// A module Risu kept without a name still needs one to be told apart in a list.
export const moduleName = (name: string) => name.trim() || '이름 없는 모듈';
export const promptName = (name: string) => name || '이름 없는 프롬프트';
export const DELETED_PROMPT = '삭제된 프롬프트';
export const loreName = (name: string) => name.trim() || '이름 없는 항목';

export const NOT_STARRED = '즐겨찾기에 없음';

export const noStarred = (then: string) => `즐겨찾기한 모델이 없어요. ${inSettings('connections')}에서 모델을 즐겨찾기에 추가하면 여기서 ${then}.`;

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
// A chat's or a character's chats in Risu's own chat file (risuChat, risuAllChats), which Risu loads only through its
// chat list, into the character picked there; what the file cannot hold, behind each place's ⓘ.
export const RISU_CHAT_FILE = 'Risu 채팅 파일';
export const RISU_LOSES = 'Risu에서 캐릭터를 선택한 뒤 채팅 목록의 가져오기로 채팅 파일을 추가해요. 지금 화면에 보이는 버전만 담겨요. 다른 버전이나 수정한 첫 메시지, 번역, 이미지와 삽화, 장기 기억, 등장인물, 채팅에서 선택한 프롬프트·페르소나·모델은 빠져요.';
export const risuLeftOut = ({ greetings, lore, unread }: LeftOut) =>
  [
    greetings ? `수정한 첫 메시지 ${greetings}개는 빠지고 캐릭터 카드의 원래 첫 메시지로 보여요.` : '',
    lore ? `Risu 로어북에서 지원하지 않는 ${CHAT_LORE} 항목 ${lore}개는 빠졌어요.` : '',
    unread ? `열리지 않는 채팅 ${unread}개는 빠졌어요.` : '',
  ].filter(Boolean).join(' ');

// Nothing set, so the thing behaves as it would untouched. An empty model setting is unset: nothing is sent, and the
// provider's default applies. It is never shown as a number. Not 기본값, which reads as the default 설정 named 기본.
export const ORIGINAL = '원래 값';
export const UNSET = `모델 ${ORIGINAL}`;

// A 설정 묶음's discount lane (design §6.7), a reply waiting on its batch, and one whose batch 멈추기 canceled, which
// shows an answer made before the cancel landed.
export const DISCOUNT = '할인 받기';
export const DISCOUNT_WAITING = '할인 받는 중이에요. 답이 다 만들어지면 한 번에 보여요.';
export const DISCOUNT_STOPPING = '멈추는 중이에요. 그사이에 응답이 다 만들어지면 완성된 응답을 보여 줘요.';

// A reply whose try failed before any of it came, sent again (design §6.7, retry on failure): the shared count, a
// connection's or a 설정 묶음's.
export const RETRYING = '응답을 받지 못해서 다시 보내고 있어요.';
export const RETRY_COUNT = '실패하면 다시 보내기';
export const RETRY_HELP = '응답이 오기 전에 실패하면 이 횟수만큼 다시 시도해요. 다만 키나 요청 내용이 잘못됐을 때는 바로 알려 줘요.';
export const LORE_BUDGET_LABEL = '로어북 최대 분량';
// 응답 받기: the send button pressed with nothing typed.
export const ANSWER = '응답 받기';
export const ANSWER_INSTRUCTION_LABEL = `${ANSWER} 지시`;
export const CHAT_LORE = '채팅 로어북';

// The mark on the default 설정 묶음 or prompt, left off where its name already says it, as the starter 묶음's 기본 does.
export const defaultMark = (isDefault: boolean, name: string) => (isDefault && name.trim() !== FIRST_PROFILE_NAME ? '기본' : undefined);

// The fold that keeps a page's rarely changed settings out of sight, saying how many of them are set.
export const detailLabel = (set: number) => (set ? `세부 설정 · ${set}개 정함` : '세부 설정');

// A value nobody reported, said as such rather than as a made-up figure.
export const UNKNOWN = '알 수 없음';
// 으로, not 로: every word it takes ends in a consonant, 기본값, 공용 and 원래 값.
export const resetTo = (value: string) => `${value}으로 되돌리기`;
export const RESET = resetTo('기본값');
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
  coverHelp: '링크를 붙여 넣은 곳에 이름과 제작자, 소개 첫 줄이 글자로 보여요. 이미지는 나오지 않아요.',
  heldNote: '신고가 들어와 운영자가 확인하는 동안 멈춘 링크예요.',
  removedNote: '운영자가 내린 링크예요.',
  goneNote: '끊겼거나 운영자가 내린 링크예요.',
  download: '파일로 받기',
  bring: '헤이젤로 가져오기',
  report: '신고',
};
