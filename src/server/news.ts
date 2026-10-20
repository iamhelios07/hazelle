import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.3.5',
  title: '게시판이 생겼어요',
  text: [
    '버그, 제안, 질문, 이야기를 모두가 읽고 쓰는 게시판이에요. 추천과 댓글, 답글을 달 수 있고, 첫 글을 쓸 때 닉네임을 골라요.',
    '운영자에게 알리기는 게시판의 운영자에게만 보내기로 바뀌었어요. 예전에 보낸 글과 운영자의 댓글은 게시판 › 내 글에 있어요.',
    '내 글에 댓글이나 답글이 달리거나 운영자가 처리 상태를 바꾸면 게시판 알림으로 알려 줘요.',
    '새 소식도 게시판의 소식으로 옮겨 왔어요. 지난 소식도 모두 거기 있어요.',
  ].join('\n\n'),
};

// Once per version: a restart finds the post there. Nothing before an operator exists, since the operator writes it.
export function publishNews(db: DatabaseSync, version: string | null, news: ReleaseNews | null, now: number) {
  if (version === null || news === null || news.version !== version) return;
  db.prepare(
    `INSERT INTO posts (account_id, title, text, category, version, visibility, created_at)
     SELECT operator_account, ?, ?, 'news', ?, 'public', ? FROM installation
     WHERE operator_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM posts WHERE category = 'news' AND version = ?)`,
  ).run(news.title, news.text, version, now, version);
}
