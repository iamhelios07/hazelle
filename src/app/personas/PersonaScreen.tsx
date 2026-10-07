import type { Stored } from '../../model/kinds';
import { framePage } from '../common/frame';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { PersonaEditor } from './PersonaEditor';

export function PersonaScreen({ stored, back }: { stored: Stored<'persona'>; back: Back }) {
  return (
    <PersonaEditor
      stored={stored}
      backLabel={back.label}
      onBack={() => navigate(back.to)}
      onRemoved={() => navigate({ kind: 'personas' })}
      frame={framePage}
    />
  );
}
