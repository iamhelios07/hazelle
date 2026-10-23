import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.0',
  title: '헤이젤을 내 컴퓨터나 폰에 설치할 수 있어요',
  text: [
    '- 윈도우는 zip을 풀고 더블클릭하면 켜져요. 도커는 필요 없어요. 새 버전이 나오면 켤 때 현재 버전과 최신 버전을 보여 주고 업데이트할지 물어봐요.',
    '- 도커를 쓰면 명령어 한 줄로 설치하고, 같은 명령어로 업데이트해요. 안드로이드는 Termux에서 명령어 한 줄이면 돼요.',
    '- 혼자 쓰려고 설치한 헤이젤은 처음 열 때 비밀번호만 정해요. 회원가입도 아이디도 없이 그 비밀번호로 열어요.',
    '- 직접 설치한 헤이젤에는 용량 한도가 없어요. 게시판과 헤이젤 나우는 hazelle.app으로 이어져서, 새 소식과 질문은 여기 그대로 모여요.',
    '- 운영 화면에서 백업 폴더를 정하면, 매일 만드는 백업을 USB나 OneDrive 같은 다른 곳에도 복사해요.',
    '- Ollama, LM Studio, koboldcpp를 켜 두면 새 연결 화면에 바로 나와서, 한 번에 연결할 수 있어요.',
    '- 직접 설치한 헤이젤도 헤이젤 나우 집계에 더해져요. 빼고 싶으면 설정 › 계정 › 앱 정보에서 끌 수 있어요.',
    '- 넓은 화면에서는 답의 버전을 넘기는 버튼이 메시지 도구 줄에 있어요. 긴 답을 읽는 중에도 바로 넘길 수 있어요.',
    '',
    '설치 방법은 [설치 안내](https://github.com/jiniill/hazelle/blob/master/README.ko.md)에 있어요.',
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
