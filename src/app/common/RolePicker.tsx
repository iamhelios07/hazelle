import { fitsRole, type ModelRef, type Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { ChipButton, Empty, Menu, MenuItem, SettingRow } from '../ui';

export const ROLE_WORDS: Record<Role, string> = { main: '본 대화', aux: '보조' };

export const GONE = '별표 목록에 없는 모델';
const same = (a: ModelRef, b: ModelRef) => a.connection === b.connection && a.model === b.model;

export function starredModels(connections: readonly Stored<'connection'>[], role: Role) {
  return connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, role)).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
}

export function findStarred(ref: ModelRef, connections: readonly Stored<'connection'>[]) {
  const connection = connections.find(({ id }) => id === ref.connection);
  const model = connection?.value.starred.find(({ id }) => id === ref.model);
  return connection && model ? { name: model.name, source: connection.value.label } : undefined;
}

// A starred model reads as its name and connection; one no longer starred reads as missing, never as another model.
function modelName(ref: ModelRef, connections: readonly Stored<'connection'>[]): string {
  const choice = findStarred(ref, connections);
  return choice ? `${choice.name} · ${choice.source}` : GONE;
}

// role: the models it offers. label: a task's own model is picked from 보조's models under the task's name.
type Props = {
  role: Role;
  label?: string;
  help?: string;
  own: ModelRef | undefined;
  // What leaving it unset means here; null where it cannot be left unset. It names no model: 본 대화 differs by
  // chat, so a model named here would be wrong in any chat that picked another.
  follow: string | null;
  connections: readonly Stored<'connection'>[];
  onPick: (ref: ModelRef | null) => void;
};

// One role of one layer of the model assignment, or a task prompt's own model.
export function RolePicker({ role, label = `${ROLE_WORDS[role]} 모델`, help, own, follow, connections, onPick }: Props) {
  const starred = starredModels(connections, role);
  const current = own ? modelName(own, connections) : (follow ?? '정하지 않음');
  return (
    <SettingRow
      label={label}
      help={help}
      control={
        <Menu place="below-end" label={label} trigger={(opener) => <ChipButton variant="field" label={current} title={label} {...opener} />}>
          {follow && <MenuItem label={follow} checked={!own} onClick={() => onPick(null)} />}
          {own && !findStarred(own, connections) && <MenuItem label={GONE} sub={own.model} checked onClick={() => undefined} />}
          {starred.length === 0 ? (
            <Empty variant="menu">별표 찍은 모델이 없어요. 연결에서 모델에 별표를 찍으면 여기서 고를 수 있어요.</Empty>
          ) : (
            starred.map((choice) => (
              <MenuItem
                key={`${choice.ref.connection}/${choice.ref.model}`}
                label={choice.name}
                sub={choice.source}
                checked={!!own && same(own, choice.ref)}
                onClick={() => onPick(choice.ref)}
              />
            ))
          )}
        </Menu>
      }
    />
  );
}
