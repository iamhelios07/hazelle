// A sign of life from inside one synchronous pass, given between units a bot's script or an imported file can make
// long: one stage of one message, one lorebook entry's scan, one count, one step of unpacking. Only the evaluation and
// import workers listen (runtime/worker postProgress), so their watchdogs bound a unit rather than a whole pass;
// anywhere else a call does nothing.
let listener = () => {};

export const progressed = () => listener();

export function onProgress(next: () => void) {
  listener = next;
}
