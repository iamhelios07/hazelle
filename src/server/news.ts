import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.4',
  title: '메시지에 이미지를 붙여 보낼 수 있어요',
  text: [
    '- 보내기 칸의 첨부 › 이미지 추가로 이미지를 붙여요. 끌어다 놓거나 붙여 넣어도 돼요.',
    '- 이미지를 읽는 모델에는 이미지가 함께 가요. 읽지 못하는 모델에는 글만 보내고, 메시지에 보내지 않은 이미지 수를 적어 둬요.',
    '- 이미지를 읽는지 알 수 없는 모델은 모델 화면에서 이미지 읽기를 켜면 이미지를 보내요.',
    '- Risu에서 옮겨 온 이미지는 그대로 두고, 채팅마다 첨부 › 옮겨 온 이미지도 보내기를 켜면 함께 보내요.',
    '- 헤이젤 나우 순위 아래에 순위 밖 모델 이름을 많이 쓴 순서대로 보여 줘요. 숫자는 보여 주지 않아요.',
    '- 이에 맞춰 개인정보 처리방침을 고쳤어요. 지난 주 순위 밖 모델의 이름과 순서를 주별 집계에 남겨요. 계정과 사람 수는 남기지 않아요.',
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
