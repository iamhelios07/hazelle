// The signed-out first screen (design F1). An installation that admits one account, the self-host default, is one
// person's: setup asks that person for a password, and solo then asks only for it, never for a username or a guest. Any
// other installation opens as a guest, with 계정 만들기 (open) or without (full).
export type Door = { kind: 'setup' } | { kind: 'solo'; username: string } | { kind: 'open' } | { kind: 'full' };
