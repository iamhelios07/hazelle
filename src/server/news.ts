import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.4.0',
  title: '가입 없이 바로 써 볼 수 있어요',
  text: [
    '처음 온 사람은 계정 없이 손님으로 바로 시작해요. 손님의 캐릭터와 채팅은 그 브라우저에만 저장되고, AI 제공사에는 헤이젤 서버를 거치지 않고 바로 연결해요.',
    '손님은 계정 만들기로 쓰던 내용을 그대로 계정에 옮길 수 있어요. 이미 계정이 있으면 로그인할 때 손님 내용을 계정에 더할지 고를 수 있어요.',
    '로그인이 풀린 기기에서는 로그인 화면이나 손님 홈이 나와요. 손님 홈에서도 계정이 있으면 로그인을 누르면 돼요.',
    '도구에 비용 계산기가 생겼어요. 모델을 고르고 토큰 수를 넣으면 한 번에 드는 비용을 알려 줘요.',
    '디스플레이 프리셋이 시스템의 라이트·다크 모드를 따라 바뀔 수 있어요. 채팅의 읽기 설정에서도 프리셋을 고를 수 있어요.',
    '게시판의 이야기 분류가 없어지고, 이야기 글은 질문으로 옮겼어요. 답글은 글쓴이와 운영자만 달 수 있어요.',
    '약관과 개인정보 처리방침에 손님 내용을 더했어요. 약관이 바뀌면 이제 알린 날부터 적용돼요.',
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
