import type { Cache, Change, ModelSettings, NumberSetting } from '../../connectors/settings';
import type { Stored } from '../../model/kinds';
import { count } from './typedNumber';

// An empty field is unset: nothing is sent, and the provider's default applies. It is never shown as a number.
// Not 기본값, which reads as the default 설정 named 기본.
export const UNSET = '모델 원래 값';

export type Field = NumberSetting | 'context';
export const NUMBER: Record<Field, { label: string; help?: string; unit?: string; unset?: string }> = {
  maxOutput: { label: '답장 최대 길이', unit: '토큰' },
  context: { label: '컨텍스트 한도', help: '대화가 이보다 길면 오래된 메시지부터 덜어 내요', unit: '토큰', unset: '모델 한도' },
  temperature: { label: '온도', help: '높을수록 답이 들쭉날쭉해져요' },
  topP: { label: 'top_p', help: '확률 높은 후보부터 이 비율만큼만 골라요' },
  topK: { label: 'top_k', help: '후보를 이 개수만큼만 봐요' },
  minP: { label: 'min_p', help: '가장 그럴듯한 후보에 비해 이 비율보다 낮은 후보는 버려요' },
  frequencyPenalty: { label: '빈도 억제', help: '자주 나온 말일수록 덜 써요' },
  presencePenalty: { label: '존재 억제', help: '한 번이라도 나온 말을 덜 써요' },
  repetitionPenalty: { label: '반복 억제', help: '1보다 크면 같은 말을 덜 되풀이해요' },
  seed: { label: 'seed', help: '같은 값이면 같은 조건에서 비슷한 답이 나와요' },
};
export const MAIN: Field[] = ['maxOutput', 'context', 'temperature'];
export const DETAIL: Field[] = ['topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'seed'];

// In the order a level list reads; a catalog's level not named here keeps its own name, after these.
export const LEVELS: Record<string, string> = { minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대' };
export const levelName = (level: string) => LEVELS[level] ?? level;

export const CACHE: Record<Cache, string> = { '5m': '5분', '1h': '1시간' };

export const settingLabel = (setting: Change['setting']) => (setting === 'stop' ? '멈춤 문구' : setting === 'reasoning' ? '생각' : setting === 'cache' ? '캐시' : NUMBER[setting].label);

// In the order the editor shows them; empty when none is.
export function valueWords(settings: ModelSettings): string[] {
  const { reasoning, stop, systemAsUser, streaming, cache } = settings;
  const number = (field: Field) => {
    const value = settings[field];
    return value === undefined ? [] : [`${NUMBER[field].label} ${count(value)}`];
  };
  const thinking = !reasoning
    ? []
    : [`생각 ${reasoning.kind === 'off' ? '끔' : reasoning.kind === 'budget' ? `예산 ${count(reasoning.tokens)}` : reasoning.kind === 'adaptive' ? (reasoning.level === null ? '적응형' : `적응형 · ${levelName(reasoning.level)}`) : levelName(reasoning.level)}`];
  return [...MAIN.flatMap(number), ...thinking, ...(cache ? [`캐시 ${CACHE[cache]}`] : []), ...DETAIL.flatMap(number), ...(stop ? [`멈춤 문구 ${stop.length}개`] : []), ...(systemAsUser ? ['시스템 메시지를 사용자 메시지로'] : []), ...(streaming === false ? ['스트리밍 끔'] : [])];
}

// A starred model whose wire format this version does not speak (Model protocol 'unsupported').
export const NOT_CALLABLE = '이 버전은 이 모델을 부를 수 없어요';

// undefined when it is sent the values as they are.
export function changeWords(changes: Change[]): string | undefined {
  const left = changes.filter((change) => change.change === 'left-out').map((change) => settingLabel(change.setting));
  const capped = changes.flatMap((change) => (change.change === 'capped' ? [`${settingLabel(change.setting)} ${count(change.to)}`] : []));
  const parts = [...(left.length ? [`빼고 보냄: ${left.join(', ')}`] : []), ...(capped.length ? [`맞춰 보냄: ${capped.join(', ')}`] : [])];
  return parts.length ? parts.join(' · ') : undefined;
}

export const defaultFirst = (profiles: readonly Stored<'profile'>[], defaultId: string | undefined) =>
  [...profiles].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.value.name.localeCompare(b.value.name, 'ko'));
