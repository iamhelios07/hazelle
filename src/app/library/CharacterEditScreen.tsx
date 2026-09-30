import type { Character } from '../../model/library';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { CharacterEditor } from './CharacterEditor';

export function CharacterEditScreen({ id, initial, back }: { id: string; initial: Character; back: Back }) {
  return <CharacterEditor id={id} initial={initial} frame={({ head, body }) => <Screen top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>} />;
}
