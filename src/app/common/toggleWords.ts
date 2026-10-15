import { isToggle, type ToggleLine } from '../../model/prompt';
import { keyInUse } from '../../model/toggles';

// A key stands inside {{#when::toggle::KEY}}, so it holds none of CBS's own marks, and in Risu's `key=label` text, so
// no = either (engine/import/toggles writeToggles).
export function keyProblem(key: string, lines: readonly ToggleLine[], own: string | null): string | null {
  if (!key) return '키를 적어 주세요.';
  if (/[\s:{}=]/.test(key)) return '공백과 :, {, }, =는 쓸 수 없어요.';
  if (key !== own && keyInUse(lines, key)) return '다른 토글이 쓰고 있는 키예요.';
  return null;
}

export const LINE_WORDS = { check: '켜고 끄기', choice: '선택', text: '텍스트', divider: '구분선', caption: '설명', group: '그룹 시작', groupEnd: '그룹 끝', unread: '읽을 수 없는 줄' } as const;

export const lineTitle = (line: ToggleLine) =>
  isToggle(line) ? `'${line.label}' 토글` : line.kind === 'groupEnd' || line.kind === 'unread' || !line.label ? LINE_WORDS[line.kind] : `'${line.label}' ${LINE_WORDS[line.kind]}`;
