import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.4.1',
  title: 'Risu 플러그인을 더 많이 쓸 수 있어요',
  text: [
    'RisuAI 플러그인이 쓰는 기능을 더 연결했어요. 플러그인이 채팅을 보내고, 채팅 로어북과 봇의 채팅 변수를 읽고 쓸 수 있어요. 선택지 용사 같은 플러그인이 이제 끝까지 돌아가요.',
    '플러그인이 화면에 그려진 메시지를 읽을 수 있어요. 봇 CSS가 입혀진 모습 그대로 미리보기에 보여 줄 수 있어요.',
    '플러그인 허용 카드는 플러그인마다 한 장이에요. 앱 밖으로 보내기, 모델 호출, 장기 기억을 한 번에 묻고, 답은 플러그인 화면에서 하나씩 바꿀 수 있어요.',
    '저장하기 전 새 채팅에서도 플러그인이 돌아가요.',
    '손님도 게시판에 글을 쓸 수 있어요.',
    '내 말풍선 안의 봇 카드가 좁게 그려지던 문제를 고쳤어요.',
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
