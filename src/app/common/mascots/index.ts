import type { Expression, MascotId } from '../../../model/mascot';
import angry from './yeongae/angry.webp';
import calm from './yeongae/calm.webp';
import face from './yeongae/face.webp';
import flustered from './yeongae/flustered.webp';
import laughing from './yeongae/laughing.webp';
import moved from './yeongae/moved.webp';
import sad from './yeongae/sad.webp';
import surprised from './yeongae/surprised.webp';
import thrilled from './yeongae/thrilled.webp';

// face: the calm face cut round for the small mark (72×72). expressions: chest-up cutouts drawn 3:5 (264×440), the
// shape of the card's portrait frame.
export const MASCOT_PICTURES: { [M in MascotId]: { face: string; expressions: Record<Expression<M>, string> } } = {
  yeongae: { face, expressions: { calm, thrilled, surprised, sad, angry, laughing, flustered, moved } },
};
