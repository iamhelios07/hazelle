import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.2',
  title: '로어북을 파일로 가져오고 내보낼 수 있어요',
  text: [
    '- 로어북 편집 화면마다 가져오기·내보내기가 생겼어요. RisuAI, SillyTavern, NovelAI 로어북 파일도 읽어요.',
    '- 재귀 검색이 이제 기본으로 꺼져 있어요. 따로 켜 두지 않은 캐릭터는 로어북 항목이 다른 항목을 연달아 불러오지 않아요. 설정 › 채팅 › 세부 설정에서 한 번에 켜거나, 캐릭터 편집 › 로어북 › 세부 설정에서 캐릭터마다 정할 수 있어요.',
    '- 채팅 세부 설정을 응답과 로어북으로 나눠 정리했어요.',
    '- 플러그인이 파일 저장, 클립보드 복사, 확인 창을 쓸 수 있어요. 저장 공간도 값 하나 4 MB, 플러그인 하나 32 MB까지 늘었어요.',
    '- 노블리스틱이 채팅의 모든 메시지를 장으로 읽어요.',
    '- 스크롤 고정에서 맨 아래로 버튼이 제때 나와요.',
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
