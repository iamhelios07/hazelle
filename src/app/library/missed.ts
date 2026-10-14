import type { MoveUnsupported, MoveUnsupportedKind, Unsupported, UnsupportedKind } from '../../engine/import/types';
import type { Dropped } from '../../runtime/chat-log';
import { CAST, COMMAND } from '../common/words';

const UNSUPPORTED: Record<UnsupportedKind, (count: number) => string> = {
  'extra-icon': (count) => `추가 아이콘 ${count}개`,
  emotion: (count) => `감정 표현 ${count}개`,
  background: (count) => `배경 이미지 ${count}개`,
  voice: (count) => `음성 ${count}개`,
  'other-asset': (count) => `그 밖의 에셋 ${count}개`,
  'missing-asset': (count) => `파일에 없는 에셋 ${count}개`,
  'not-image': (count) => `이미지가 아닌 파일 ${count}개`,
  'refused-picture': (count) => `올리지 못한 이미지 ${count}개`,
  'background-html': () => '배경 HTML의 스타일 외 내용',
  'additional-text': () => '추가 설명(임베딩)',
  'prebuilt-asset-command': () => '에셋 명령',
  'depth-prompt': () => '깊이 프롬프트',
  'disable-ui-prompt': (count) => `@@disable_ui_prompt ${count}곳`,
  'cbs-tag': (count) => `지원하지 않는 ${COMMAND} ${count}개`,
  'regex-stage': (count) => `지원하지 않는 단계의 정규식 ${count}개`,
  module: () => '읽지 못한 모듈',
  'toggle-line': (count) => `읽지 못한 토글 줄 ${count}개`,
  mcp: () => 'MCP 서버 연결',
  cjs: () => '모듈 자바스크립트(cjs)',
  hazelle: () => '파일이 바뀌어 읽지 않은 헤이젤 설정과 모듈',
};

const MOVE_UNSUPPORTED: Record<MoveUnsupportedKind, (count: number) => string> = {
  'group-chat': (count) => `그룹 채팅 ${count}개`,
  'chat-lore': (count) => `채팅 로어북 ${count}개`,
  memory: (count) => `Risu 장기 기억 ${count}개`,
  inlay: (count) => `메시지 속 이미지 ${count}개`,
  'chat-folder': (count) => `채팅 폴더 ${count}개`,
  'hidden-message': (count) => `숨김·코멘트 메시지 ${count}개(일반 메시지로 들어옴)`,
  'cold-missing': (count) => `백업에 없는 대화 ${count}개`,
  'missing-picture': (count) => `백업에 없는 이미지 ${count}개`,
};

export const missedLines = (unsupported: Unsupported): string[] => unsupported.map((item) => UNSUPPORTED[item.kind](item.count));

export const cardMissed = (unsupported: Unsupported, faceless: boolean): string[] => [...(faceless ? ['이미지: 가져오지 못함'] : []), ...missedLines(unsupported)];

export const moveMissed = (items: MoveUnsupported[]): string[] => items.map((item) => MOVE_UNSUPPORTED[item.kind](item.count));

const DROPPED: Record<keyof Dropped, (count: number) => string> = {
  prompt: () => '프롬프트',
  persona: () => '페르소나',
  cast: (count) => `${CAST} ${count}명`,
  models: (count) => `모델 ${count}개`,
  pictures: (count) => `삽화 ${count}개`,
  inlays: (count) => `메시지 속 이미지 ${count}개`,
};

export const chatMissed = (dropped: Dropped): string[] => (Object.keys(DROPPED) as (keyof Dropped)[]).flatMap((kind) => (dropped[kind] ? [DROPPED[kind](dropped[kind])] : []));
