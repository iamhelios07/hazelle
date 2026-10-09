//@api 1
//@name notepad
//@author hazelle
//@display-name 메모장
//@version 1.0.0
//@description 채팅 옆에서 메모를 적어요
//@page 메모장 열기
//@setting {"key":"title","type":"text","label":"메모 제목","default":"메모장"}

/* global hazelle, document */

if (hazelle.context === 'background') {
  hazelle.on('message', async (data) => {
    if (!data || typeof data !== 'object' || data.kind !== 'save' || typeof data.text !== 'string') return;
    try {
      await hazelle.storage.set('note', data.text);
      hazelle.post({ kind: 'saved', text: data.text });
    } catch (error) {
      hazelle.post({ kind: 'failed', message: String(error) });
    }
  });
  hazelle.on('settings', () => hazelle.post({ kind: 'settings' }));
} else {
  const title = document.createElement('h1');
  const label = document.createElement('label');
  label.textContent = '메모 내용';
  label.htmlFor = 'note';
  const note = document.createElement('textarea');
  note.id = 'note';
  note.rows = 12;
  note.cols = 40;
  note.setAttribute('aria-label', '메모 내용');
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  document.body.append(title, label, note, status);
  let dirty = false;
  const showTitle = async () => { title.textContent = String((await hazelle.settings()).title); };
  const read = async () => {
    const text = await hazelle.storage.get('note');
    if (!dirty) note.value = typeof text === 'string' ? text : '';
  };
  const failed = (error) => { status.textContent = `저장하지 못했어요: ${String(error)}`; };
  note.addEventListener('input', () => {
    dirty = true;
    status.textContent = '저장 중';
    hazelle.post({ kind: 'save', text: note.value });
  });
  hazelle.on('message', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'saved' && data.text === note.value) {
      dirty = false;
      status.textContent = '저장했어요';
    } else if (data.kind === 'failed') failed(data.message);
    else if (data.kind === 'settings') void showTitle().catch(failed);
  });
  hazelle.storage.onChange((keys) => { if (keys.includes('note')) void read().catch(failed); });
  void showTitle().catch(failed);
  void read().catch(failed);
}
