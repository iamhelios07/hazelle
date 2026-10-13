// The tag this page was built from: the Dockerfile hands its HAZELLE_VERSION to Vite. A build without one (dev, tests, a
// local docker build) has none, and then neither compares with the server nor says news.
export const BUILT_VERSION: string | null = (import.meta.env.VITE_HAZELLE_VERSION as string | undefined) || null;

// version: the tag of the release it came with. date: YYYY-MM-DD. lines: what a user notices, in the app's words.
export type News = { version: string; date: string; lines: string[] };

// Newest first. Only a release a user would notice gets an entry; the deploy skill drafts it from scripts/release-notes.sh.
export const NEWS: News[] = [];

// Said once, on the first open of a release that came with news, on a device that opened another release before: a
// device's first open is someone new, who has no before to compare.
export function newsToSay(built: string | null, lastOpened: string, news: News[]): News | null {
  if (built === null || lastOpened === '' || lastOpened === built) return null;
  return news.find(({ version }) => version === built) ?? null;
}
