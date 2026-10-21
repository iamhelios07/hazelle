import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.4.2',
  title: '게시판 댓글은 글쓴이와 운영자의 대화가 돼요',
  text: [
    '이제 게시판 글에는 글쓴이와 운영자만 댓글과 답글을 달 수 있어요. 다른 분들은 글을 읽고 추천할 수 있어요. 전에 달린 댓글은 그대로 남아요.',
    '소식은 공지처럼 읽어요. 궁금한 점은 소식 글 아래 질문 쓰기로 남겨 주세요.',
    '게시판 전체 맨 위에서 가장 최근 소식을 볼 수 있어요.',
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
