// What no file system takes in a name.
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;

export const fileStem = (name: string, fallback: string) => name.replace(UNSAFE, '').trim() || fallback;
