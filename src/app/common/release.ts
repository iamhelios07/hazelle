// The tag this page was built from: the Dockerfile hands its HAZELLE_VERSION to Vite. A build without one (dev, tests, a
// local docker build) has none, and then neither compares with the server nor says news.
export const BUILT_VERSION: string | null = (import.meta.env.VITE_HAZELLE_VERSION as string | undefined) || null;

// version: the tag of the release it came with. date: YYYY-MM-DD. lines: what a user notices, in the app's words.
export type News = { version: string; date: string; lines: string[] };

// Newest first. Only a release a user would notice gets an entry; the deploy skill drafts it from scripts/release-notes.sh.
export const NEWS: News[] = [
  {
    version: 'v0.1.79',
    date: '2026-10-14',
    lines: [
      '운영자에게 알리기에서 기기 정보와 최근 오류를 함께 보낼 수 있어요. 진단 내용을 따로 복사하지 않아도 돼요.',
      '실패하면 다시 보내기 횟수를 채팅 기본값에서 한 번에 정하고, 연결이나 설정 묶음마다 따로 정할 수도 있어요.',
      '설정 화면을 더 읽기 쉽게 정리했어요.',
    ],
  },
  { version: 'v0.1.78', date: '2026-10-14', lines: ['iPhone에서 메시지를 보내지 못하던 문제를 고쳤어요.'] },
  { version: 'v0.1.77', date: '2026-10-14', lines: ['계정 → 앱 정보에 문제 진단이 생겼어요. 오류가 나면 진단하기를 누르고, 나온 내용을 복사해 운영자에게 보내 주세요.'] },
];

// Said once, on the first open of a release that came with news, on a device that opened another release before: a
// device's first open is someone new, who has no before to compare.
export function newsToSay(built: string | null, lastOpened: string, news: News[]): News | null {
  if (built === null || lastOpened === '' || lastOpened === built) return null;
  return news.find(({ version }) => version === built) ?? null;
}
