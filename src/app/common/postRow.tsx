import { OPERATOR_NAME, type Author, type PostRow } from '../../contracts/board';
import { navigate } from '../shell/router';
import { ListItem } from '../ui';
import { ago } from './time';
import { count } from './typedNumber';
import { BOARD } from './words';

export const authorName = (author: Author) => (author.operator ? OPERATOR_NAME : author.left ? BOARD.left : (author.name ?? BOARD.unnamed));

export const statusWord = ({ status, version }: Pick<PostRow, 'status' | 'version'>) =>
  status === 'done' && version ? `${BOARD.statuses.done} · ${version}` : BOARD.statuses[status];

// An open post carries no status mark: every post starts open.
export const postTags = (row: PostRow) => [
  BOARD.categories[row.category],
  ...(row.status === 'open' ? [] : [statusWord(row)]),
  ...(row.visibility === 'operator' ? [BOARD.operatorOnly] : []),
  ...(row.hidden ? [BOARD.hidden] : []),
  ...(row.deleted ? [BOARD.deleted] : []),
];

export const postMeta = (row: PostRow) => `${authorName(row.author)} · ${ago(row.createdAt)}`;

export function PostItem({ row }: { row: PostRow }) {
  return (
    <ListItem
      title={row.title}
      tone={row.deleted ? 'muted' : 'plain'}
      tags={postTags(row)}
      description={postMeta(row)}
      note={`${BOARD.vote} ${count(row.votes)} · ${BOARD.comment} ${count(row.commentCount)}`}
      onClick={() => navigate({ kind: 'post', id: row.id })}
    />
  );
}
