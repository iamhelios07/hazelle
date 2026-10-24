import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.3',
  title: '캐시가 왜 깨졌는지 앱이 짚어 줘요',
  text: [
    '- 채팅 메뉴 › 점검 › 요청의 캐시에서 깨지는 부분을 누르면, 직전 요청과 달라진 곳만 골라 보여 줘요.',
    '- 왜 달라졌는지도 짚어요. {{time}} 같은 태그 값이 바뀐 것, 로어북 항목이 켜지거나 꺼진 것, 깊이로 넣는 항목이 자리를 옮긴 것, 메시지를 수정한 것을 알려 주고, ⓘ에 깨지지 않게 하는 방법을 적어 뒀어요.',
    '- 최근 응답 중 몇 번 깨졌는지, 어디서 자주 깨지는지 모아 보여 줘요.',
    '- 제공자가 예상보다 캐시를 적게 읽으면 기록과 응답 정보에 알려 줘요. 같은 연결에서 세 번 연달아 그러면 보내기 버튼 옆에도 표시해요.',
    '- 설정 › 디스플레이에 삽화를 본문에 넣기가 생겼어요. 넓은 화면에서도 삽화를 옆에 띄우지 않고 그 문단 바로 뒤에 넣어요.',
    '- 읽기 폭과 줄 간격에 매우 넓게가 생겼어요.',
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
