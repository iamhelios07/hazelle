// The sharer's own record of a share link (runtime/share): the server's id for it and the key its fragment holds, which
// the server never has. One per character it shares.
export type Share = { share: string; key: string };
