import type { Activity } from '../../contracts/board';
import { authorName } from '../common/postRow';
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
