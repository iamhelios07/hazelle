import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.1',
  title: '응답 아래에서 사용량과 비용을 바로 볼 수 있어요',
  text: [
    '- 설정 › 채팅 › 세부 설정에서 사용량 표시를 켜면, 응답마다 아래에 비용, 입력·출력 토큰, 캐시 적중률, 걸린 시간이 한 줄로 나와요.',
    '- 그 줄을 누르면 추론 토큰, 첫 토큰까지 걸린 시간, 속도, 모델까지 펼쳐져요. 자세히를 누르면 응답 정보가 열려요.',
    '- 새 채팅에서도 첫 메시지를 보내기 전에 점검을 열 수 있어요. 첫 메시지가 어떤 프롬프트로 나갈지 미리 확인할 수 있어요.',
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
