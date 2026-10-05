// How a provider address is matched against HAZELLE_LOCAL_PROVIDERS: the server's outbound policy and 직접 연결 both
// key by it (eslint/boundaries.js), so the screen accepts exactly the addresses the server lets through. URL.host drops
// a default port, which an entry always states.
export const destination = (url: URL) => `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
