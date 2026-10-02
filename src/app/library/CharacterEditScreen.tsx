import type { Character } from '../../model/library';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { CharacterEditor } from './CharacterEditor';

export function CharacterEditScreen({ id, character, back }: { id: string; character: Character; back: Back }) {
  return <CharacterEditor id={id} character={character} frame={({ head, body }) => <Screen top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>} />;
}
