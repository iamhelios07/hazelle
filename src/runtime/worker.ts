type Policy = { createScriptURL(url: string): string };

// The CSP requires Trusted Types for script URLs. This policy is never exported: it signs only a URL handed to
// moduleWorker, whose callers pass their bundled `?worker&url` import.
const workers = new Set<string>();
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('module-worker', {
  createScriptURL: (url) => {
    if (!workers.has(url)) throw new TypeError('not a bundled worker');
    return url;
  },
});

export function moduleWorker(url: string): Worker {
  workers.add(url);
  return new Worker((policy?.createScriptURL(url) ?? url) as string, { type: 'module' });
}
