import { MAX_DIAGNOSTICS_LENGTH, type Activity, type Category, type Comment, type Compose, type Post, type PostRow, type Sort, type Status, type Visibility } from '../contracts/board';
import { api } from './api';
import { page } from './pages';

// 게시판 (design §6.13), one thin wrapper per route of server/board. Every route needs a session.

// null: not chosen yet, which the board asks for before the first write. The operator has none and needs none.
export const readNickname = () => api<{ name: string | null }>('GET', 'board/name');
export const setNickname = (name: string) => api<undefined>('PUT', 'board/name', { name });

// mine: only what this account wrote. visibility 'operator' lists operator-only posts: one's own, or every one for the
// operator. 'top' sorts by votes; its cursor is the server's (contracts/board PostList).
export type ListAsk = { sort: Sort; category?: Category; status?: Status; visibility?: Visibility; mine?: boolean; limit?: number };
export const readPosts = (after: string | null, { sort, category, status, visibility, mine, limit }: ListAsk) =>
  page<'posts', PostRow>('board/posts', 'posts', after, { sort, category, status, visibility, mine, limit });

export const readPost = (id: number) => api<{ post: Post }>('GET', `board/posts/${id}`);
export const writePost = ({ diagnostics, ...compose }: Compose) => api<{ id: number }>('POST', 'board/posts', { ...compose, diagnostics: diagnostics?.slice(0, MAX_DIAGNOSTICS_LENGTH) ?? null });
export const editPost = (id: number, edit: Pick<Compose, 'title' | 'text' | 'category'>) => api<undefined>('PUT', `board/posts/${id}`, edit);
// The author's or the operator's: a post with comments stays as a placeholder (PostRow.deleted).
export const deletePost = (id: number) => api<undefined>('DELETE', `board/posts/${id}`);
export const votePost = (id: number, voted: boolean) => api<{ votes: number }>('PUT', `board/posts/${id}/vote`, { voted });

export const writeComment = (post: number, text: string, parentId: number | null) => api<{ comment: Comment }>('POST', `board/posts/${post}/comments`, { text, parentId });
export const editComment = (id: number, text: string) => api<undefined>('PUT', `board/comments/${id}`, { text });
export const deleteComment = (id: number) => api<undefined>('DELETE', `board/comments/${id}`);

// 신고: into the operator's inbox (admin reports), beside share reports.
export const reportPost = (id: number, text: string) => api<undefined>('POST', `board/posts/${id}/reports`, { text });
export const reportComment = (id: number, text: string) => api<undefined>('POST', `board/comments/${id}/reports`, { text });

// What happened to what one wrote, newest first; seen up to the newest the page showed.
export const readActivity = (after: string | null, ask: { limit?: number } = {}) => page<'activity', Activity>('board/activity', 'activity', after, ask);
export const markActivitySeen = (newest: number) => api<undefined>('POST', 'board/seen', { id: newest });

// The operator's moves. hidden: a reason and, for a hold (임시조치), its length in days; null shows it again.
export const setPostStatus = (id: number, status: Status, version: string | null) => api<undefined>('PUT', `board/posts/${id}/status`, { status, version });
export const setPostHidden = (id: number, hidden: { reason: string; days: number | null } | null) => api<undefined>('PUT', `board/posts/${id}/hidden`, { hidden });
export const setPostLocked = (id: number, locked: boolean) => api<undefined>('PUT', `board/posts/${id}/locked`, { locked });
export const setCommentHidden = (id: number, hidden: { reason: string; days: number | null } | null) => api<undefined>('PUT', `board/comments/${id}/hidden`, { hidden });
