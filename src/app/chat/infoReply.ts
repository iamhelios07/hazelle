import type { Shown } from '../../runtime/talk';

// The reply 답장 정보 shows: the one picked by a message's ⓘ or the stepper while the chat is open, else the latest.
export const infoReply = (replies: Shown[], picked: string | null) => replies.find((message) => message.id === picked) ?? replies.at(-1);

// What a reply starting while 답장 정보 is held leaves picked: nothing when it is the latest message, so 정보 goes on
// following the latest after it; an earlier one (다시 시도, 이어 쓰기 on an older reply) is picked.
export const pickStarted = (messages: Shown[], started: string) => (started === messages.at(-1)?.id ? null : started);
