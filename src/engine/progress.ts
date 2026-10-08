// A sign of life from inside one synchronous pass, given between units a bot's script can make long: one stage of one
// message, one lorebook entry's scan, one count. Only the evaluation worker listens (runtime/evaluation-worker), so
// its watchdog bounds a unit rather than a whole pass; anywhere else a call does nothing.
let listener = () => {};

export const progressed = () => listener();

export function onProgress(next: () => void) {
  listener = next;
}
