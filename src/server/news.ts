import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.4.3',
  title: '처음 오신 분을 위한 튜토리얼이 생겼어요',
  text: [
    '처음 오신 분은 AI를 연결하고 대화를 시작하기까지 실제 화면을 따라가며 해 볼 수 있어요. 눌러야 할 곳을 하나씩 짚어 주고, 대화창에 도착하면 끝나요. 아직 응답을 받아 본 적 없다면 캐릭터 둘러보기 맨 앞의 튜토리얼 보기에서 언제든 시작할 수 있어요.',
    '실험실에 에이전트가 생겼어요. 답을 쓰기 전에 장면을 먼저 정리하는 전처리 에이전트와, 받은 답을 다듬는 후처리 에이전트를 붙일 수 있어요. 어떤 에이전트가 무엇을 보내고 받았는지는 응답 정보와 점검의 기록에서 볼 수 있어요.',
    '전체 백업을 내보내고 복원할 때 그림을 더 많이 한꺼번에 주고받아요.',
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
