// 헤이젤로 가져오기 crosses a page load and the sign-in or unlock it may need, so the link's key waits in this tab's
// session storage until the workspace takes it (ShareArrival), which clears it. While one waits for a link, main.tsx
// answers that link's address with the account flow instead of its public page.
const PENDING = 'hazelle:share-pending';

type Pending = { id: string; key: string };

export function holdPending(pending: Pending) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function pendingFor(id: string): string | null {
  try {
    const held = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as Pending | null;
    return held?.id === id && typeof held.key === 'string' ? held.key : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    // Nothing waits where nothing could be stored.
  }
}
