import type { Activity } from '../../contracts/board';
import { CircleDot, ShieldCheck } from 'lucide-react';
import { authorName } from '../common/postRow';
import { Avatar } from '../ui';
import { withParticle } from '../common/particles';
import { BOARD, UNKNOWN } from '../common/words';

// A status change the server sent without its status reads as unknown rather than as a made-up one.
export function activityLine({ kind, by, status }: Activity): string {
  switch (kind) {
    case 'comment':
      return `${authorName(by)}님이 내 글에 댓글을 남겼어요`;
    case 'reply':
      return `${authorName(by)}님이 내 댓글에 답글을 남겼어요`;
    case 'status':
      return `내 글이 ${withParticle(status === null ? UNKNOWN : BOARD.statuses[status], '으로/로')} 바뀌었어요`;
  }
}

// Who did it, or a status mark for the operator's move.
export const activityFace = ({ kind, by }: Activity) =>
  kind === 'status' ? <Avatar face={CircleDot} /> : <Avatar face={by.operator ? ShieldCheck : authorName(by)} tone={by.operator ? 'accent' : 'plain'} />;
