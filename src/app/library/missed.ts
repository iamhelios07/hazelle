import type { ImportReport, MoveUnsupported, MoveUnsupportedKind, UnsupportedKind } from '../../engine/import/types';
import type { Dropped } from '../../runtime/chat-log';
import { CAST, COMMAND } from '../common/words';

const UNSUPPORTED: Record<UnsupportedKind, (count: number) => string> = {
  asset: (count) => `에셋 ${count}개`,
  'background-html': () => '배경 HTML의 스타일 외 내용',
  'additional-text': () => '추가 설명(임베딩)',
  'prebuilt-asset-command': () => '에셋 명령',
  'depth-prompt': () => '깊이 프롬프트',
  'disable-ui-prompt': (count) => `@@disable_ui_prompt ${count}곳`,
  'cbs-tag': (count) => `지원하지 않는 ${COMMAND} ${count}개`,
  'regex-stage': (count) => `지원하지 않는 단계의 정규식 ${count}개`,
  module: () => '읽지 못한 모듈',
  'toggle-line': (count) => `읽지 못한 토글 줄 ${count}개`,
};

const MOVE_UNSUPPORTED: Record<MoveUnsupportedKind, (count: number) => string> = {
  'group-chat': (count) => `그룹 채팅 ${count}개`,
  'chat-lore': (count) => `채팅 로어북 ${count}개`,
  memory: (count) => `Risu 장기 기억 ${count}개`,
  inlay: (count) => `메시지 속 이미지 ${count}개`,
  'chat-folder': (count) => `채팅 폴더 ${count}개`,
  bookmark: (count) => `북마크 ${count}개`,
  'hidden-message': (count) => `숨김·코멘트 메시지 ${count}개(일반 메시지로 들어옴)`,
  'cold-missing': (count) => `백업에 없는 대화 ${count}개`,
  'missing-picture': (count) => `백업에 없는 이미지 ${count}개`,
};

type Unsupported = ImportReport['unsupported'];

function assets(unsupported: Unsupported, skipped: number): string[] {
  const count = (unsupported.find((item) => item.kind === 'asset')?.count ?? 0) + skipped;
  return count ? [UNSUPPORTED.asset(count)] : [];
}
export const assetsMissed = (report: ImportReport, skipped: number) => assets(report.unsupported, skipped);

export function moduleMissed(unsupported: Unsupported, skipped: number): string[] {
  return [...unsupported.filter((item) => item.kind !== 'asset').map((item) => UNSUPPORTED[item.kind](item.count)), ...assets(unsupported, skipped)];
}

export const cardMissed = (report: ImportReport, skipped: number, faceless: boolean): string[] => [...(faceless ? ['이미지: 읽지 못함'] : []), ...moduleMissed(report.unsupported, skipped)];

export const moveMissed = (items: MoveUnsupported[]): string[] => items.map((item) => MOVE_UNSUPPORTED[item.kind](item.count));

const DROPPED: Record<keyof Dropped, (count: number) => string> = {
  prompt: () => '프롬프트',
  persona: () => '페르소나',
  cast: (count) => `${CAST} ${count}명`,
  models: (count) => `모델 ${count}개`,
  pictures: (count) => `삽화 ${count}개`,
};

export const chatMissed = (dropped: Dropped): string[] => (Object.keys(DROPPED) as (keyof Dropped)[]).flatMap((kind) => (dropped[kind] ? [DROPPED[kind](dropped[kind])] : []));
