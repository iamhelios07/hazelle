// Someone's own installation rather than hazelle.app (HAZELLE_SELF_HOST). main.tsx reads it off the page, which the
// server marks (server/static.ts), before anything renders, so a page shown before sign-in knows it too. The dev server
// marks nothing and runs as hazelle.app.
let own = false;
export const selfHost = () => own;
export function markSelfHost(marked: boolean) {
  own = marked;
}
