// 게시판 (design §6.13): the wire shapes the server (server/board) and the client (runtime/board) share.

// A nickname is chosen on the first visit and changed at will; unique ignoring case and spacing (nicknameKey).
export const NICKNAME_LENGTH = { min: 2, max: 20 } as const;
// Letters, digits, marks and single inner spaces; nothing that reads as an address, a path or a tag.
const NICKNAME_FORBIDDEN = /[\s@#/\\<>]/u;
export function validNickname(name: string): boolean {
  const words = name.split(' ');
  if (name !== name.trim() || words.some((word) => word === '')) return false;
  const length = [...name].length;
  return length >= NICKNAME_LENGTH.min && length <= NICKNAME_LENGTH.max && !words.some((word) => NICKNAME_FORBIDDEN.test(word));
}
export const nicknameKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
// What the operator writes as; never a nickname anyone else can take.
export const OPERATOR_NAME = '운영자';

export const MAX_TITLE_LENGTH = 80;
export const MAX_POST_LENGTH = 8000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_REASON_LENGTH = 200;
// A 문제 진단 sent with an operator-only post, clipped to this by the sender.
export const MAX_DIAGNOSTICS_LENGTH = 16000;
// Per account, counted over the last 24 hours in the database, so a restart resets nothing.
export const POSTS_PER_DAY = 10;
export const COMMENTS_PER_DAY = 60;
// 임시조치 (정보통신망법 제44조의2): a reported post is held hidden at most this long.
export const HOLD_DAYS_MAX = 30;

export const CATEGORIES = ['bug', 'idea', 'question', 'talk'] as const;
export type Category = (typeof CATEGORIES)[number];
// The operator moves a post along; 'done' may name the version that shipped it.
export const STATUSES = ['open', 'seen', 'working', 'done', 'declined'] as const;
export type Status = (typeof STATUSES)[number];
// operator: the author and the operator alone read it; the only kind a suspended account reads or writes.
export type Visibility = 'public' | 'operator';
export const SORTS = ['new', 'top'] as const;
export type Sort = (typeof SORTS)[number];

// left: the account is gone (탈퇴한 사용자). name null while not left: the account has not chosen a nickname, which only
// a post moved from 운영자에게 알리기 (migration 0015) can be, since writing asks for one. mine: written by the asking account.
export type Author = { name: string | null; operator: boolean; mine: boolean; left: boolean };
// A post or comment the operator hid: its reason, and when a hold ends (null: hidden until the operator shows it again).
// Shown to its author and the operator; others see no trace of a hidden post, and a comment's placeholder (text and
// hidden both null, deleted false), which the client draws as hidden, not deleted.
export type Hidden = { reason: string; until: number | null };

export type PostRow = {
  id: number;
  title: string;
  // The start of its text; null once deleted.
  excerpt: string | null;
  category: Category;
  status: Status;
  version: string | null;
  visibility: Visibility;
  author: Author;
  createdAt: number;
  editedAt: number | null;
  votes: number;
  voted: boolean;
  commentCount: number;
  locked: boolean;
  hidden: Hidden | null;
  // The author deleted it while it had comments: the row stays as a placeholder over them, its text gone.
  deleted: boolean;
};
export type Comment = {
  id: number;
  postId: number;
  parentId: number | null;
  author: Author;
  // null once deleted or hidden from the asking account.
  text: string | null;
  createdAt: number;
  editedAt: number | null;
  hidden: Hidden | null;
  deleted: boolean;
};
// text null: deleted. diagnostics: an operator-only post's 문제 진단, to the operator alone; null otherwise.
export type Post = PostRow & {
  text: string | null;
  diagnostics: string | null;
  // The author's account, to the operator alone (a restore or a deletion starts from an operator-only post); null for others, or once the account left.
  account: { id: string; username: string } | null;
  comments: Comment[];
};

export type Compose = { title: string; text: string; category: Category; visibility: Visibility; diagnostics: string | null };

// What happened to what one wrote, newest first: a comment on one's post, a 답글 to one's comment, or a status change.
export type ActivityKind = 'comment' | 'reply' | 'status';
export type Activity = { id: number; kind: ActivityKind; postId: number; title: string; by: Author; at: number; commentId: number | null; status: Status | null };

// The cursor of a 'top' list is `${votes}:${id}` of the last row shown, since votes order it; a 'new' list cursors on id.
export type PostList = { posts: PostRow[]; next: string | null };
