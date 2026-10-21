import type { Route } from '../shell/routes';

// The tag this page was built from: the Dockerfile hands its HAZELLE_VERSION to Vite. A build without one (dev, tests, a
// local docker build) has none, and then neither compares with the server nor says news.
export const BUILT_VERSION: string | null = (import.meta.env.VITE_HAZELLE_VERSION as string | undefined) || null;

// The pictures common/tourArt draws, one name per page.
export type TourArt = 'board-list' | 'board-thread' | 'board-operator';
// A release's headline feature shown page by page (common/Tour), under the version of its 소식 post (server/news).
export type Tour = { version: string; title: string; pages: { title: string; text: string; art: TourArt }[]; go: { label: string; route: Route } };

// Newest first. Only a release whose headline everyone should know of gets one; the deploy skill drafts it.
export const TOURS: Tour[] = [
  {
    version: 'v0.3.5',
    title: '새로 생긴 게시판',
    pages: [
      { title: '게시판이 생겼어요', text: '버그, 제안, 질문을 모두가 읽고 써요. 중요한 버그와 좋은 제안은 추천으로 밀어 올려요. 첫 글을 쓸 때 닉네임을 골라요.', art: 'board-list' },
      { title: '댓글과 답글, 그리고 알림', text: '글에 댓글을 달아요. 답글은 글쓴이와 운영자가 서로 주고받아요. 내 글에 무슨 일이 생기면 게시판 알림으로 알려 줘요.', art: 'board-thread' },
      { title: '운영자에게만 보내기', text: '운영자에게 알리기는 여기로 왔어요. 운영자에게만 보내면 둘만 읽고, 예전에 보낸 글도 내 글에 있어요.', art: 'board-operator' },
    ],
    go: { label: '게시판 가기', route: { kind: 'board', operator: false } },
  },
];

export const tourOf = (version: string | null) => TOURS.find((tour) => tour.version === version) ?? null;

// A release's 소식 is said once, on its first open on a device that opened another release before: a device's first
// open is someone new, who has no before to compare.
export const openedNewRelease = (built: string | null, lastOpened: string) => built !== null && lastOpened !== '' && lastOpened !== built;

// The tour to show on this device: the newest, unless the device has seen it, and whoever opens the app, since a feature
// everyone should know of is news to a newcomer too (user, 2026-10-20). Never on a build without a version (dev, tests).
export function tourToShow(built: string | null, seen: string, tours: Tour[]): Tour | null {
  const newest = tours[0];
  return built !== null && newest && newest.version !== seen ? newest : null;
}
