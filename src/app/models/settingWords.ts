import type { Cache, Change, ModelSettings, NumberSetting, ServiceTier, Verbosity } from '../../connectors/settings';
import type { Modality, Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { count } from '../common/typedNumber';
import { DISCOUNT, RETRY_COUNT, UNKNOWN } from '../common/words';

export const MODALITY: Record<Modality, string> = { text: '텍스트', image: '이미지', audio: '오디오', video: '영상', file: '파일', embedding: '임베딩' };

export const inputs = (model: Starred) => (model.input ? model.input.map((modality) => MODALITY[modality]).join(', ') : UNKNOWN);

export type Field = NumberSetting | 'context';
export const NUMBER: Record<Field, { label: string; help?: string; unit?: string; unset?: string }> = {
  maxOutput: { label: '응답 최대 길이', unit: '토큰' },
  context: { label: '컨텍스트 한도', help: '대화가 이보다 길면 오래된 메시지부터 제외해요', unit: '토큰', unset: '모델 한도' },
  temperature: { label: '온도', help: '높을수록 응답이 다양해져요' },
  topP: { label: 'top_p', help: '확률 높은 후보부터 이 비율까지만 선택해요' },
  topK: { label: 'top_k', help: '확률 높은 후보부터 이 개수까지만 선택해요' },
  minP: { label: 'min_p', help: '가장 높은 확률 대비 이 비율보다 낮은 후보는 제외해요' },
  frequencyPenalty: { label: '빈도 억제', help: '자주 나온 말일수록 덜 써요' },
  presencePenalty: { label: '존재 억제', help: '한 번이라도 나온 말을 덜 써요' },
  repetitionPenalty: { label: '반복 억제', help: '1보다 크면 같은 말을 덜 반복해요' },
  seed: { label: 'seed', help: '같은 값이면 같은 조건에서 비슷한 응답이 나와요' },
};
export const MAIN: Field[] = ['maxOutput', 'context', 'temperature'];
export const DETAIL: Field[] = ['topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'seed'];

// In the order a level list reads; a catalog's level not named here keeps its own name, after these.
export const LEVELS: Record<string, string> = { minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대' };
export const levelName = (level: string) => LEVELS[level] ?? level;

export const CACHE: Record<Cache, string> = { '5m': '5분', '1h': '1시간' };

export const VERBOSITY_LABEL = '응답 상세도';
export const VERBOSITY_WORDS: Record<Verbosity, string> = { low: '간단히', medium: '보통', high: '자세히' };
export const SERVICE_TIER_LABEL = '처리 등급';
export const SERVICE_TIER_WORDS: Record<ServiceTier, string> = { auto: '자동', standard_only: '표준' };

const NAMED: Record<Exclude<Change['setting'], Field>, string> = { stop: '멈춤 문구', reasoning: '추론', cache: '캐시', verbosity: VERBOSITY_LABEL, serviceTier: SERVICE_TIER_LABEL, discount: DISCOUNT };
const isField = (setting: Change['setting']): setting is Field => setting in NUMBER;
export const settingLabel = (setting: Change['setting']) => (isField(setting) ? NUMBER[setting].label : NAMED[setting]);

// In the order the editor shows them; empty when none is.
export function valueWords(settings: ModelSettings): string[] {
  const { reasoning, stop, systemAsUser, streaming, cache, verbosity, serviceTier, discount, retries } = settings;
  const number = (field: Field) => {
    const value = settings[field];
    return value === undefined ? [] : [`${NUMBER[field].label} ${count(value)}`];
  };
  const thinking = !reasoning
    ? []
    : [`추론 ${reasoning.kind === 'off' ? '끔' : reasoning.kind === 'budget' ? `예산 ${count(reasoning.tokens)}` : reasoning.kind === 'adaptive' ? (reasoning.level === null ? '적응형' : `적응형 · ${levelName(reasoning.level)}`) : levelName(reasoning.level)}`];
  return [...MAIN.flatMap(number), ...thinking, ...(cache ? [`캐시 ${CACHE[cache]}`] : []), ...(discount ? [DISCOUNT] : []), ...DETAIL.flatMap(number), ...(stop ? [`멈춤 문구 ${stop.length}개`] : []), ...(verbosity ? [`${VERBOSITY_LABEL} ${VERBOSITY_WORDS[verbosity]}`] : []), ...(serviceTier ? [`${SERVICE_TIER_LABEL} ${SERVICE_TIER_WORDS[serviceTier]}`] : []), ...(systemAsUser ? ['시스템 메시지를 사용자 메시지로'] : []), ...(streaming === false ? ['스트리밍 끔'] : []), ...(retries === undefined ? [] : [`${RETRY_COUNT} ${retries}번`])];
}

// A starred model whose wire format this version does not speak (Model protocol 'unsupported').
export const NOT_CALLABLE = '이 버전에서는 이 모델을 호출할 수 없어요';

export function changeLine(left: readonly string[], capped: readonly string[]): string | undefined {
  const parts = [...(left.length ? [`제외: ${left.join(', ')}`] : []), ...(capped.length ? [`조정: ${capped.join(', ')}`] : [])];
  return parts.length ? parts.join(' · ') : undefined;
}

// undefined when it is sent the values as they are.
export function changeWords(changes: Change[]): string | undefined {
  const left = changes.filter((change) => change.change === 'left-out').map((change) => settingLabel(change.setting));
  const capped = changes.flatMap((change) => (change.change === 'capped' ? [`${settingLabel(change.setting)} ${count(change.to)}`] : []));
  return changeLine(left, capped);
}

export const defaultFirst = (profiles: readonly Stored<'profile'>[], defaultId: string | undefined) =>
  [...profiles].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.value.name.localeCompare(b.value.name, 'ko'));
