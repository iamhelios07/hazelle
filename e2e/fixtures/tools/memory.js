//@api 1
//@name memory-lite
//@author hazelle
//@display-name 간단 기억
//@version 1.0.0
//@description 응답마다 요약을 고쳐 써요
//@uses model
//@menu now 지금 정리하기
//@setting {"key":"length","type":"number","label":"요약 길이","default":600}

/* global hazelle */

async function summarize(chat) {
  const messages = await chat.messages(-12);
  if (!messages.length) return;
  const previous = await chat.state.get('summary');
  const settings = await hazelle.settings();
  const answer = await chat.model('aux', [
    { role: 'system', content: `Summarize the conversation in at most ${settings.length} characters. Keep names, facts, and unfinished events. Previous summary: ${typeof previous === 'string' ? previous : ''}` },
    ...messages.map(({ role, text }) => ({ role: role === 'user' ? 'user' : 'assistant', content: text })),
  ]);
  if (answer.ok) chat.state.set('summary', answer.text);
  else chat.say(`기억을 정리하지 못했어요: ${answer.reason}`, 'error');
}

hazelle.on('reply', summarize);
hazelle.on('menu', (chat, item) => { if (item === 'now') return summarize(chat); });
hazelle.on('prompt', async (chat) => {
  const summary = await chat.state.get('summary');
  return typeof summary === 'string' ? summary : null;
});
