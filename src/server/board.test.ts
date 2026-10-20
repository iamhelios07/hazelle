import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MAX_DIAGNOSTICS_LENGTH, POSTS_PER_DAY, type Activity, type Compose, type Post, type PostList } from '../contracts/board';
import { UNREAD_BOARD_HEADER } from '../contracts/http';
import { beginRestore } from './lifecycle';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 10').run();
});

type Who = { id: string; cookie: string };
// The first signup of an installation is its operator, so a test calls this before member().
const operator = () => t.signUp('operator');
async function member(name: string) {
  const who = await t.signUp();
  expect((await t.put('board/name', { name }, who.cookie)).status).toBe(204);
  return who;
}
const write = (who: Who, compose: Partial<Compose> = {}) => t.post('board/posts', { title: '제목', text: '본문', category: 'idea', visibility: 'public', diagnostics: null, ...compose }, who.cookie);
const posted = async (who: Who, compose: Partial<Compose> = {}) => ((await (await write(who, compose)).json()) as { id: number }).id;
const list = async (who: Who, query = 'sort=new') => (await (await t.get(`board/posts?${query}`, who.cookie)).json()) as PostList;
const titles = async (who: Who, query?: string) => (await list(who, query)).posts.map(({ title }) => title);
const read = async (who: Who, id: number) => ((await (await t.get(`board/posts/${id}`, who.cookie)).json()) as { post: Post }).post;
const comment = async (who: Who, post: number, text: string, parentId: number | null = null) => t.post(`board/posts/${post}/comments`, { text, parentId }, who.cookie);
const commented = async (who: Who, post: number, text: string, parentId: number | null = null) => ((await (await comment(who, post, text, parentId)).json()) as { comment: { id: number } }).comment.id;
const log = async (who: Who) => ((await (await t.get('admin/log', who.cookie)).json()) as { log: { action: string; target: string; detail: unknown }[] }).log;

it('asks for a nickname before the first post, unique ignoring case and spacing, and never one that reads as the operator', async () => {
  await operator();
  const first = await t.signUp();
  expect(await (await t.get('board/name', first.cookie)).json()).toEqual({ name: null });
  expect((await write(first)).status).toBe(403);
  for (const name of ['a', ' 앞공백', 'a@b', '두  칸']) expect(await (await t.put('board/name', { name }, first.cookie)).json()).toEqual({ error: 'bad-nickname' });
  expect((await t.put('board/name', { name: '운영자' }, first.cookie)).status).toBe(409);
  expect((await t.put('board/name', { name: 'Hazel Fan' }, first.cookie)).status).toBe(204);
  expect((await t.put('board/name', { name: 'Hazel Fan' }, first.cookie)).status).toBe(204);
  expect(await (await t.get('board/name', first.cookie)).json()).toEqual({ name: 'Hazel Fan' });
  expect((await write(first)).status).toBe(200);

  const second = await t.signUp();
  expect(await (await t.put('board/name', { name: 'hazel fan' }, second.cookie)).json()).toEqual({ error: 'nickname-taken' });
});

it('gives the operator no nickname: it writes as 운영자 without one', async () => {
  const admin = await operator();
  expect(await (await t.get('board/name', admin.cookie)).json()).toEqual({ name: '운영자' });
  expect((await t.put('board/name', { name: '진짜운영자' }, admin.cookie)).status).toBe(400);
  const id = await posted(admin, { title: '공지' });
  const reader = await member('reader');
  expect((await read(reader, id)).author).toEqual({ name: '운영자', operator: true, mine: false, left: false });
});

it('lists a public post to every account and an operator-only one to its author and the operator alone', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  await posted(author, { title: '공개' });
  const asked = await posted(author, { title: '비공개', visibility: 'operator' });

  expect(await titles(other)).toEqual(['공개']);
  expect(await titles(other, 'sort=new&visibility=operator')).toEqual([]);
  expect((await t.get(`board/posts/${asked}`, other.cookie)).status).toBe(404);
  expect(await titles(author, 'sort=new&mine=1')).toEqual(['비공개', '공개']);
  expect(await titles(admin, 'sort=new&visibility=operator')).toEqual(['비공개']);
  expect((await list(author)).posts[0]).toMatchObject({ author: { name: 'author', operator: false, mine: true }, votes: 0, voted: false, commentCount: 0, hidden: null, deleted: false });
});

it('lets a suspended account write and read only operator-only posts', async () => {
  await operator();
  const writer = await member('writer');
  const suspended = await member('suspended');
  await posted(writer, { title: '공개' });
  const before = await posted(suspended, { title: '정지 전에 쓴 글' });
  await commented(writer, before, '정지 뒤에 달린 댓글');
  await t.env.db.prepare('UPDATE accounts SET suspended_at = 1 WHERE id = ?').bind(suspended.id).run();

  expect(await (await write(suspended)).json()).toEqual({ error: 'suspended' });
  expect((await write(suspended, { title: '지워 주세요', visibility: 'operator' })).status).toBe(200);
  expect(await titles(suspended)).toEqual([]);
  expect(await titles(suspended, 'sort=new&mine=1')).toEqual(['지워 주세요']);
  // What happened on its public posts stays out of its activity and its unread count, and it deletes only what it reads.
  expect(await (await t.get('board/activity', suspended.cookie)).json()).toEqual({ activity: [], next: null });
  expect(await (await t.get('session', suspended.cookie)).json()).toMatchObject({ session: { unreadBoard: 0 } });
  expect((await t.delete(`board/posts/${before}`, undefined, suspended.cookie)).status).toBe(404);
});

it("sorts 'top' by votes, then newest, and pages it on the server's cursor", async () => {
  await operator();
  const author = await member('author');
  const voters = [await member('one'), await member('two')];
  const [a, b, c] = [await posted(author, { title: 'a' }), await posted(author, { title: 'b' }), await posted(author, { title: 'c' })];
  for (const voter of voters) await t.put(`board/posts/${a}/vote`, { voted: true }, voter.cookie);
  await t.put(`board/posts/${c}/vote`, { voted: true }, voters[0]!.cookie);

  const first = await list(author, 'sort=top&limit=2');
  expect([first.posts.map(({ title }) => title), first.next]).toEqual([['a', 'c'], `1:${c}`]);
  expect(await titles(author, `sort=top&limit=2&after=${first.next}`)).toEqual(['b']);
  expect(b).toBeLessThan(c);
  expect((await t.get('board/posts?sort=top&after=12', author.cookie)).status).toBe(400);
});

it('counts one vote per account, taken back by voting false, and refuses votes on an operator-only post', async () => {
  await operator();
  const author = await member('author');
  const voter = await member('voter');
  const id = await posted(author);
  for (const voted of [true, true]) expect(await (await t.put(`board/posts/${id}/vote`, { voted }, voter.cookie)).json()).toEqual({ votes: 1 });
  expect(await (await t.put(`board/posts/${id}/vote`, { voted: true }, author.cookie)).json()).toEqual({ votes: 2 });
  expect((await list(voter)).posts[0]).toMatchObject({ votes: 2, voted: true });
  expect(await (await t.put(`board/posts/${id}/vote`, { voted: false }, voter.cookie)).json()).toEqual({ votes: 1 });

  const asked = await posted(author, { visibility: 'operator' });
  expect((await t.put(`board/posts/${asked}/vote`, { voted: true }, author.cookie)).status).toBe(400);
});

it('keeps comments flat with one level of 답글: a 답글 to a 답글 joins the top-level thread', async () => {
  await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const top = await commented(other, id, '첫 댓글');
  const reply = await commented(author, id, '답글', top);
  await commented(other, id, '답글의 답글', reply);
  expect((await comment(other, id, '남의 글 댓글', 999)).status).toBe(400);

  const post = await read(author, id);
  expect(post.comments.map(({ text, parentId }) => [text, parentId])).toEqual([['첫 댓글', null], ['답글', top], ['답글의 답글', top]]);
  expect(post.commentCount).toBe(3);
});

it("lets only the author edit a post or comment, the operator included among the others", async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const said = await commented(author, id, '처음 말');
  const edit = { title: '고친 제목', text: '고친 본문', category: 'bug' };
  for (const who of [other, admin]) {
    expect((await t.put(`board/posts/${id}`, edit, who.cookie)).status).toBe(404);
    expect((await t.put(`board/comments/${said}`, { text: '남이 고침' }, who.cookie)).status).toBe(404);
  }
  expect((await t.put(`board/posts/${id}`, edit, author.cookie)).status).toBe(204);
  expect((await t.put(`board/comments/${said}`, { text: '고친 말' }, author.cookie)).status).toBe(204);
  expect(await read(other, id)).toMatchObject({ ...edit, editedAt: expect.any(Number), comments: [{ text: '고친 말', editedAt: expect.any(Number) }] });
});

it('refuses comments on a locked post, and logs the lock', async () => {
  const admin = await operator();
  const author = await member('author');
  const id = await posted(author);
  expect((await t.put(`board/posts/${id}/locked`, { locked: true }, author.cookie)).status).toBe(403);
  expect((await t.put(`board/posts/${id}/locked`, { locked: true }, admin.cookie)).status).toBe(204);
  expect(await (await comment(author, id, '닫혔나요')).json()).toEqual({ error: 'post-locked' });
  expect((await read(author, id)).locked).toBe(true);
  expect(await log(admin)).toMatchObject([{ action: 'post-lock', target: String(id) }]);
});

it('hides a post from others but not from its author, until a hold runs out', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author, { title: '가려질 글' });
  expect((await t.put(`board/posts/${id}/hidden`, { hidden: { reason: '신고 검토 중', days: 3 } }, admin.cookie)).status).toBe(204);

  expect(await titles(other)).toEqual([]);
  expect((await t.get(`board/posts/${id}`, other.cookie)).status).toBe(404);
  expect((await read(author, id)).hidden).toEqual({ reason: '신고 검토 중', until: expect.any(Number) });
  expect(await log(admin)).toMatchObject([{ action: 'post-hide', target: String(id), detail: { reason: '신고 검토 중', days: 3 } }]);
  expect(await (await t.get('session', author.cookie)).json()).toMatchObject({ session: { unreadNotices: 1 } });
  expect(await (await t.get('notices', author.cookie)).json()).toMatchObject({ notices: [{ text: '"가려질 글" 글을 가렸어요. 이유: 신고 검토 중. 3일 뒤에 다시 보여요.' }] });

  await t.env.db.prepare('UPDATE posts SET hidden_until = ? WHERE id = ?').bind(Date.now() - 1, id).run();
  expect(await titles(other)).toEqual(['가려질 글']);
  expect((await read(author, id)).hidden).toBeNull();
});

it('hides a comment: its text reaches only its author and the operator', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const said = await commented(other, id, '거친 말');
  expect((await t.put(`board/comments/${said}/hidden`, { hidden: { reason: '욕설', days: null } }, admin.cookie)).status).toBe(204);
  expect((await read(author, id)).comments[0]).toMatchObject({ text: null, hidden: null });
  expect((await read(other, id)).comments[0]).toMatchObject({ text: '거친 말', hidden: { reason: '욕설', until: null } });
  expect((await read(admin, id)).comments[0]).toMatchObject({ text: '거친 말', hidden: { reason: '욕설', until: null } });
  expect(await (await t.get('notices', other.cookie)).json()).toMatchObject({ notices: [{ text: '"제목" 글에 쓴 댓글을 가렸어요. 이유: 욕설.' }] });
  expect(await (await t.get('session', author.cookie)).json()).toMatchObject({ session: { unreadNotices: 0 } });
});

it('holds each account to its posts a day, counted in the database', async () => {
  await operator();
  const author = await member('author');
  for (let index = 0; index < POSTS_PER_DAY; index++) expect((await write(author)).status).toBe(200);
  expect(await (await write(author)).json()).toEqual({ error: 'too-many-posts' });
  await t.env.db.prepare('UPDATE posts SET created_at = created_at - 86400001').run();
  expect((await write(author)).status).toBe(200);
});

it('leaves a placeholder over the comments of a deleted post, and removes a post with none', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const kept = await posted(author, { title: '댓글 있는 글' });
  const gone = await posted(author, { title: '댓글 없는 글' });
  const said = await commented(other, kept, '댓글');
  expect((await t.delete(`board/posts/${kept}`, undefined, other.cookie)).status).toBe(404);
  expect((await t.delete(`board/posts/${kept}`, undefined, author.cookie)).status).toBe(204);
  expect((await t.delete(`board/posts/${kept}`, undefined, author.cookie)).status).toBe(404);
  expect((await t.delete(`board/posts/${gone}`, undefined, admin.cookie)).status).toBe(204);

  expect(await read(other, kept)).toMatchObject({ title: '댓글 있는 글', text: null, deleted: true, comments: [{ text: '댓글' }] });
  expect((await t.get(`board/posts/${gone}`, other.cookie)).status).toBe(404);
  expect(await log(admin)).toMatchObject([{ action: 'post-delete', target: String(gone), detail: { title: '댓글 없는 글' } }]);
  // The placeholder goes with the last comment under it.
  expect((await t.delete(`board/comments/${said}`, undefined, other.cookie)).status).toBe(204);
  expect((await t.get(`board/posts/${kept}`, other.cookie)).status).toBe(404);
});

it("lists what others did to one's posts and comments, counts it unread, and marks it seen up to the newest shown", async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author, { title: '내 글' });
  const mine = await commented(author, id, '내 댓글');
  await commented(author, id, '스스로 단 답글', mine);
  const top = await commented(other, id, '남의 댓글');
  const reply = await commented(other, id, '남의 답글', mine);
  await t.env.db.prepare('UPDATE comments SET created_at = id').run();
  await t.put(`board/posts/${id}/status`, { status: 'done', version: 'v0.4.0' }, admin.cookie);
  expect((await t.put(`board/posts/${id}/status`, { status: 'working', version: 'v0.4.0' }, admin.cookie)).status).toBe(400);
  const read = (await (await t.get(`board/posts/${id}`, author.cookie)).json()) as { post: Post };
  expect(read.post).toMatchObject({ status: 'done', version: 'v0.4.0', statusAt: expect.any(Number) });

  const by = { operator: false, mine: false, left: false, name: 'other' };
  const { activity, next } = (await (await t.get('board/activity', author.cookie)).json()) as { activity: Activity[]; next: string | null };
  expect([activity, next]).toEqual([
    [
      { id: id * 2 + 1, kind: 'status', postId: id, title: '내 글', by: { name: '운영자', operator: true, mine: false, left: false }, at: expect.any(Number), commentId: null, status: 'done' },
      { id: reply * 2, kind: 'reply', postId: id, title: '내 글', by, at: reply, commentId: reply, status: null },
      { id: top * 2, kind: 'comment', postId: id, title: '내 글', by, at: top, commentId: top, status: null },
    ],
    null,
  ]);
  const page = (await (await t.get(`board/activity?limit=1&after=${reply}:${reply * 2}`, author.cookie)).json()) as { activity: Activity[] };
  expect(page.activity.map(({ id }) => id)).toEqual([top * 2]);

  await t.env.db.prepare('UPDATE accounts SET board_seen = 0').run();
  expect(await (await t.get('session', author.cookie)).json()).toMatchObject({ session: { unreadBoard: 3 } });
  expect((await t.get('objects?since=0', author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('3');
  expect((await t.post('board/seen', { id: reply * 2 }, author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('1');
  expect((await t.post('board/seen', { id: id * 2 + 1 }, author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('0');
});

it('takes 신고 on posts and comments into the inbox, once per reporter and target, and resolves one without a reply', async () => {
  const admin = await operator();
  const author = await member('author');
  const reporter = await member('reporter');
  const id = await posted(author, { title: '문제의 글' });
  const said = await commented(author, id, '문제의 댓글');
  for (let index = 0; index < 2; index++) expect((await t.post(`board/posts/${id}/reports`, { text: '광고예요' }, reporter.cookie)).status).toBe(204);
  expect((await t.post(`board/comments/${said}/reports`, { text: '욕이에요' }, reporter.cookie)).status).toBe(204);

  const { reports } = (await (await t.get('admin/reports', admin.cookie)).json()) as { reports: { id: number }[] };
  const row = { accountId: reporter.id, username: 'reporter', createdAt: expect.any(Number), resolvedAt: null, share: null, shareVersion: null, link: null, shared: null };
  expect(reports).toEqual([
    { ...row, id: expect.any(Number), text: '욕이에요', postId: id, commentId: said, postTitle: '문제의 글', commentText: '문제의 댓글' },
    { ...row, id: expect.any(Number), text: '광고예요', postId: id, commentId: null, postTitle: '문제의 글', commentText: null },
  ]);
  expect((await t.post(`admin/reports/${reports[0]!.id}/resolve`, { reply: '무시돼요' }, admin.cookie)).status).toBe(204);
  expect((await t.post(`admin/reports/${reports[0]!.id}/resolve`, undefined, admin.cookie)).status).toBe(404);
  expect(await log(admin)).toMatchObject([{ action: 'resolve-report', target: String(reports[0]!.id), detail: null }]);
});

it('refuses an account another 신고 while twenty of its own are open', async () => {
  await operator();
  const author = await member('author');
  const reporter = await member('reporter');
  const id = await posted(author);
  await t.env.db.batch(Array.from({ length: 20 }, () => t.env.db.prepare(`INSERT INTO reports (account_id, username, text, created_at, post_id) VALUES (?, 'r', 'x', 1, 0)`).bind(reporter.id)));
  expect(await (await t.post(`board/posts/${id}/reports`, { text: '또' }, reporter.cookie)).json()).toEqual({ error: 'too-many-reports' });
});

it("keeps an operator-only post's 문제 진단 and author's account for the operator alone", async () => {
  const admin = await operator();
  const author = await member('author');
  expect((await write(author, { diagnostics: '진단' })).status).toBe(400);
  expect((await write(author, { visibility: 'operator', diagnostics: 'x'.repeat(MAX_DIAGNOSTICS_LENGTH + 1) })).status).toBe(400);
  const id = await posted(author, { visibility: 'operator', diagnostics: '헤이젤 진단 정보' });
  expect(await read(author, id)).toMatchObject({ diagnostics: null, account: null });
  const username = (await t.env.db.prepare('SELECT username FROM accounts WHERE id = ?').bind(author.id).first<string>('username'))!;
  expect(await read(admin, id)).toMatchObject({ diagnostics: '헤이젤 진단 정보', account: { id: author.id, username } });
  expect((await comment(author, id, '추가로요')).status).toBe(200);
  expect((await commented(admin, id, '고쳤어요')) > 0).toBe(true);
});

it("anchors an operator's restore on the account's open operator-only post, dated no earlier than the account even if the clock went back", async () => {
  await operator();
  const author = await member('author');
  const created = (await t.env.db.prepare('SELECT created_at FROM accounts WHERE id = ?').bind(author.id).first<number>('created_at'))!;
  const shown = await posted(author, { title: '공개 글' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(created - 645);
  let asked: number;
  try {
    asked = await posted(author, { title: '되돌려 주세요', visibility: 'operator' });
  } finally {
    clock.mockRestore();
  }
  expect(await t.env.db.prepare('SELECT created_at FROM posts WHERE id = ?').bind(asked).first('created_at')).toBe(created);
  expect(await beginRestore(t.env, author.id, shown, { at: created - 3_600_000 })).toEqual({ refused: 'bad-post' });
  expect(await beginRestore(t.env, author.id, asked, { at: created - 3_600_000 })).toEqual({ begun: expect.any(Number) });
});
