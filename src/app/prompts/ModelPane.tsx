import { fitsRole, type Assignment, type ModelRef } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { ChoiceGroup, Section, Text } from '../ui';

const DEFAULT = 'default';
const keyOf = (ref: ModelRef) => `${ref.connection}/${ref.model}`;

// The starred models a prompt's 본 대화 can be set to, named as the model picker names them (design F4).
export function starredModels(connections: readonly Stored<'connection'>[]) {
  return connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, 'main')).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
}

// What the 모델 row says: the model this prompt sets, or that it follows 전체 기본값.
export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const ref = models.main;
  if (!ref) return '전체 기본값 따르기';
  return starredModels(connections).find((choice) => keyOf(choice.ref) === keyOf(ref))?.name ?? '별표 목록에 없는 모델';
}

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void };

// The prompt's layer of the model assignment (design §4.1): its 본 대화 model, or 전체 기본값.
export function ModelPane({ models, defaults, connections, onPick }: Props) {
  const starred = starredModels(connections);
  const current = models.main;
  const fallback = defaults.main ? (starred.find((choice) => keyOf(choice.ref) === keyOf(defaults.main!))?.name ?? '별표 목록에 없는 모델') : '정해지지 않았어요';
  const options = [
    { value: DEFAULT, label: '전체 기본값 따르기', sub: fallback },
    ...starred.map((choice) => ({ value: keyOf(choice.ref), label: choice.name, sub: choice.source })),
    ...(current && !starred.some((choice) => keyOf(choice.ref) === keyOf(current)) ? [{ value: keyOf(current), label: '별표 목록에 없는 모델', sub: current.model }] : []),
  ];
  return (
    <Section title="모델">
      <Text tone="muted">이 프롬프트로 여는 채팅이 쓰는 본 대화 모델이에요. 채팅에서 모델을 바꾸면 그 채팅만 바뀌어요. 온도 같은 값은 설정 › 모델 설정에서 정해요.</Text>
      <ChoiceGroup
        label="본 대화 모델"
        layout="list"
        options={options}
        value={current ? keyOf(current) : DEFAULT}
        onChange={(value) => onPick(value === DEFAULT ? null : (starred.find((choice) => keyOf(choice.ref) === value)?.ref ?? current ?? null))}
      />
    </Section>
  );
}
