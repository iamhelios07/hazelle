import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.4.4',
  title: '답을 받는 동안 화면이 가벼워졌어요',
  text: [
    '- 답이 들어오는 동안 이미 받은 메시지까지 매번 다시 그리던 문제를 고쳤어요. 긴 채팅이나 휴대폰에서 답을 받을 때 덜 버벅여요.',
    '- 번역한 메시지에서도 삽화가 화면에 보이는 문단 옆에 놓여요. 본문 위쪽에 줄이 늘어나도 삽화가 원래 문단을 따라가요.',
  ].join('\n'),
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
