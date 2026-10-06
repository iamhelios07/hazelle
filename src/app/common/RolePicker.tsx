import { fitsRole, sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { ChipButton, Empty, Menu, MenuItem, SettingRow } from '../ui';
import { MODEL_ROLES, NOT_STARRED, noStarred } from './words';

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
  return choice ? `${choice.name} · ${choice.source}` : NOT_STARRED;
}

// label: a task's own model is picked from 보조 모델's models under the task's name.
type Props = {
  role: Role;
  label?: string;
  help?: string;
  own: ModelRef | undefined;
  // What leaving it unset means here; null where it cannot be left unset. It names no model: 대화 모델 differs by
  // chat, so a model named here would be wrong in any chat that picked another.
  follow: string | null;
  connections: readonly Stored<'connection'>[];
  onPick: (ref: ModelRef | null) => void;
};

export function RolePicker({ role, label = MODEL_ROLES[role], help, own, follow, connections, onPick }: Props) {
  const starred = starredModels(connections, role);
  const current = own ? modelName(own, connections) : (follow ?? '정하지 않음');
  return (
    <SettingRow
      label={label}
      help={help}
      control={
        <Menu place="below-end" label={label} trigger={(opener) => <ChipButton variant="field" label={current} title={label} {...opener} />}>
          {follow && <MenuItem label={follow} checked={!own} onClick={() => onPick(null)} />}
          {own && !findStarred(own, connections) && <MenuItem label={NOT_STARRED} sub={own.model} checked onClick={() => undefined} />}
          {starred.length === 0 ? (
            <Empty variant="menu">{noStarred('선택할 수 있어요')}</Empty>
          ) : (
            starred.map((choice) => (
              <MenuItem
                key={`${choice.ref.connection}/${choice.ref.model}`}
                label={choice.name}
                sub={choice.source}
                checked={!!own && sameModelRef(own, choice.ref)}
                onClick={() => onPick(choice.ref)}
              />
            ))
          )}
        </Menu>
      }
    />
  );
}
