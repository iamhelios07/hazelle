import type { ImportReport, MoveUnsupported, MoveUnsupportedKind, UnsupportedKind } from '../../engine/import/types';
import { COMMAND } from '../common/words';

const UNSUPPORTED: Record<UnsupportedKind, (count: number) => string> = {
  trigger: (count) => `트리거 ${count}개`,
  asset: (count) => `에셋 ${count}개`,
  'background-html': () => '배경 HTML의 스타일 밖 내용',
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
  inlay: (count) => `메시지 속 그림 ${count}개`,
  module: (count) => `모듈 ${count}개`,
  'chat-folder': (count) => `채팅 폴더 ${count}개`,
  bookmark: (count) => `북마크 ${count}개`,
  'hidden-message': (count) => `숨김·코멘트 메시지 ${count}개(일반 메시지로 들어옴)`,
  'cold-missing': (count) => `백업에 없는 대화 ${count}개`,
  'missing-picture': (count) => `백업에 없는 그림 ${count}개`,
};

// Assets a card names but lacks and those it holds that could not be kept (skipped), as one count.
export function assetsMissed(report: ImportReport, skipped: number): string[] {
  const count = (report.unsupported.find((item) => item.kind === 'asset')?.count ?? 0) + skipped;
  return count ? [UNSUPPORTED.asset(count)] : [];
}

export function cardMissed(report: ImportReport, skipped: number, faceless: boolean): string[] {
  const missed = report.unsupported.filter((item) => item.kind !== 'asset').map((item) => UNSUPPORTED[item.kind](item.count));
  return [...(faceless ? ['그림: 읽지 못함'] : []), ...missed, ...assetsMissed(report, skipped)];
}

export const moveMissed = (items: MoveUnsupported[]): string[] => items.map((item) => MOVE_UNSUPPORTED[item.kind](item.count));
