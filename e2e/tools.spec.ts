import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { FAKE_ADDRESS, FAKE_MODEL, fakeProvider, type FakeChatRequest } from './helpers';

const PASSWORD = 'e2e-password';
const NOTE = 'The brass key is under the lantern.';
const summary = (index: number) => `TOOL_SUMMARY_${index}: the gate is open.`;
const auxiliary = (request: FakeChatRequest) => request.messages.some(({ role, content }) => role === 'system' && content.startsWith('Summarize the conversation'));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/tools/${name}.js`, import.meta.url));

// The display-only marker observes the saved per-version state, not merely an aux response arriving at the server.
const CARD = {
  name: 'tool-observer.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: 'Tool observer', description: '', first_mes: 'The gate is closed.',
      extensions: { risuai: { customScripts: [{ comment: 'memory state', in: '$', out: ' [memory={{getvar::tool:hazelle/memory-lite:summary}}]', type: 'editdisplay' }] } },
    },
  })),
};

async function enter(page: Page): Promise<boolean> {
  await page.goto('/');
  const signup = page.getByLabel('비밀번호 확인', { exact: true });
  const signin = page.getByRole('button', { name: '로그인', exact: true });
  await expect(signup.or(signin)).toBeVisible();
  await page.getByLabel('아이디', { exact: true }).fill('e2e');
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  // flow.spec.ts owns the first signup in the full suite; this file must also work on its own fresh server.
  if (await signin.isVisible()) {
    await signin.click();
    await expect(signin).toBeHidden();
    return false;
  }
  await signup.fill(PASSWORD);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '복구 키 파일 내려받기', exact: true }).click();
  await page.getByLabel('안전한 곳에 저장했어요', { exact: true }).check();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '아직 비어 있어요', exact: true })).toBeVisible();
  return true;
}

async function importFile(page: Page, button: string, file: string | typeof CARD) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button, exact: true }).first().click();
  const notice = page.getByRole('button', { name: '확인했어요', exact: true });
  if (await notice.isVisible()) await notice.click();
  await (await chooser).setFiles(file);
  const report = page.getByRole('dialog', { name: '가져왔어요', exact: true });
  await expect(report).toBeVisible();
  return report;
}

async function importModule(page: Page, name: string) {
  await page.goto('/modules');
  const report = await importFile(page, '모듈 가져오기', fixture(name));
  await report.getByRole('button', { name: '모듈 보기', exact: true }).click();
  // Importing from 설정 › 모듈 places the new module in 항상 without a second activation write.
  await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).toBeChecked();
}

async function openNotepad(page: Page) {
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /^메모장 열기/ }).click();
  const frame = page.frameLocator('iframe[title="메모장"]');
  await expect(frame.getByRole('heading', { name: '메모장', exact: true })).toBeVisible();
  return frame;
}

test('tools keep a notepad across reload and put versioned aux summaries into the tool slot', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let summaries = 0;
  const sent = await fakeProvider((request) => auxiliary(request) ? [summary(++summaries)] : ['The gate opens.']);
  const requests = () => sent as FakeChatRequest[];
  const main = () => requests().filter((request) => !auxiliary(request));
  const aux = () => requests().filter(auxiliary);

  await test.step('assign both the conversation model and an explicit auxiliary model', async () => {
    const fresh = await enter(page);
    if (fresh) {
      await page.goto('/connections/new');
      await page.getByRole('button', { name: /^직접 연결/ }).click();
      await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
      await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
      await page.getByRole('button', { name: '모델 선택', exact: true }).click();
      await page.getByRole('button', { name: `${FAKE_MODEL} 즐겨찾기`, exact: true }).click();
      await page.getByRole('button', { name: '완료', exact: true }).click();
    }
    await page.goto('/models');
    for (const role of ['대화 모델', '보조 모델']) {
      const picker = page.getByRole('button', { name: new RegExp(`^${role} · `) });
      if ((await picker.innerText()).includes(FAKE_MODEL)) continue;
      await picker.click();
      const saved = page.waitForResponse((response) => response.url().includes('/api/objects/batch') && response.request().method() === 'POST');
      await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).click();
      await saved;
      await expect(picker).toContainText(FAKE_MODEL);
    }
    await page.reload();
    await expect(page.getByRole('button', { name: /^보조 모델 · / })).toContainText(FAKE_MODEL);
  });

  await test.step('import the reference notepad in settings and capture its tool section', async () => {
    await importModule(page, 'notepad');
    await expect(page.getByLabel('메모 제목', { exact: true })).toHaveValue('메모장');
    await expect(page.getByRole('heading', { name: '도구', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('module-tool-section.png'), fullPage: true });
  });

  await test.step('write in the chat panel and reopen the persisted note after reload', async () => {
    await page.goto('/');
    const report = await importFile(page, '봇 가져오기', CARD);
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    // A saved chat owns the page context; the first send happens before memory is imported.
    await page.getByLabel('메시지', { exact: true }).fill('Keep this note for the journey.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText('The gate opens.');
    await expect(page.getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
    const frame = await openNotepad(page);
    await frame.getByLabel('메모 내용', { exact: true }).fill(NOTE);
    await expect(frame.getByText('저장했어요', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('chat-tool-panel.png'), fullPage: true });
    await page.getByRole('button', { name: '메모장 닫기', exact: true }).click();
    await page.reload();
    const reopened = await openNotepad(page);
    await expect(reopened.getByLabel('메모 내용', { exact: true })).toHaveValue(NOTE);
    await page.getByRole('button', { name: '메모장 닫기', exact: true }).click();
  });

  const chat = page.url();
  await test.step('import memory and consent to its first auxiliary call as the module', async () => {
    await importModule(page, 'memory');
    await expect(page.getByRole('switch', { name: '모델 호출', exact: true })).not.toBeChecked();
    await page.goto(chat);
    await page.getByLabel('메시지', { exact: true }).fill('The gate is open now.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByText('이 모듈이 모델을 따로 부르려고 해요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '허용', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(1));
    expect(aux()).toHaveLength(1);
    expect(aux()[0]!.model).toBe(FAKE_MODEL);
  });

  await test.step('the next request carries the first summary as a tool part, shown in response info', async () => {
    await page.getByLabel('메시지', { exact: true }).fill('We walk through the gate.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(2));
    expect(aux()).toHaveLength(2);
    expect(main().at(-1)!.messages).toContainEqual({ role: 'system', content: summary(1) });
    const last = page.getByRole('article').last();
    await last.hover();
    await last.getByRole('button', { name: '응답 정보', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '응답 정보', exact: true });
    await panel.getByRole('button', { name: '요청 원문', exact: true }).click();
    await panel.getByRole('button', { name: /^도구 · 간단 기억 · 시스템/ }).click();
    await expect(panel).toContainText(summary(1));
    await page.getByRole('button', { name: '응답 정보 닫기', exact: true }).click();
  });

  await test.step('regeneration rolls back the outgoing summary before building its request', async () => {
    const count = main().length;
    await page.getByRole('article').last().hover();
    await page.getByRole('button', { name: '다시 생성', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(3));
    expect(main()).toHaveLength(count + 1);
    expect(aux()).toHaveLength(3);
    const regenerated = main().at(-1)!.messages;
    expect(regenerated).toContainEqual({ role: 'system', content: summary(1) });
    expect(regenerated.some(({ content }) => content.includes('TOOL_SUMMARY_2'))).toBe(false);
    expect(aux().at(-1)!.messages[0]!.content).toContain(`Previous summary: ${summary(1)}`);
  });
});
