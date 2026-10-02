import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { CARD, DESCRIPTION, FAKE_MODEL, fakeProvider, HOSTILE, MODULE, SCRIPTED } from './helpers';

const CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'))![1];
const PASSWORD = 'e2e-password';
const NICKNAME = 'rich-steve';
const GREETING = /Welcome to the inn\. Tonight's omen is (amber|birch)\./;

test('a new account imports a card, chats through the fake provider and finds the chat after a reload', async ({ page }) => {
  const sent = await fakeProvider(page);
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  const messages = page.getByRole('article');

  await test.step('sign up and reach the library', async () => {
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toBe(CSP);
    await page.getByLabel('아이디', { exact: true }).fill('e2e');
    await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
    await page.getByLabel('한 번 더', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('button', { name: '복구 키 파일 내려받기', exact: true }).click();
    await page.getByLabel('안전한 곳에 따로 저장했어요', { exact: true }).check();
    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '아직 비어 있어요', exact: true })).toBeVisible();
  });

  await test.step('connect the fake provider and make its model the default', async () => {
    await page.getByRole('button', { name: /^연결 추가/ }).click();
    await page.getByRole('button', { name: /^직접 연결/ }).click();
    await page.getByLabel('주소', { exact: true }).fill('https://fake-provider.test/v1');
    await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
    await page.getByRole('button', { name: '모델 고르기', exact: true }).click();
    await page.getByRole('button', { name: `${FAKE_MODEL} 별표하기` }).click();
    await page.getByRole('button', { name: '완료', exact: true }).click();
    await page.getByRole('button', { name: '모델', exact: true }).click();
    const main = page.getByRole('button', { name: /^대화 모델 · / });
    await main.click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).click();
    await expect(main).toContainText(FAKE_MODEL);
  });

  await test.step('give the default persona a 별명, which lists show and no request carries', async () => {
    await page.getByRole('button', { name: '페르소나', exact: true }).click();
    await page.getByRole('button', { name: /^e2e/ }).click();
    await page.getByLabel('별명', { exact: true }).fill(NICKNAME);
    await expect(page.getByRole('button', { name: new RegExp(`^e2e · ${NICKNAME}`) })).toBeVisible();
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  });

  await test.step('import the card and see its report', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '봇 가져오기', exact: true }).click();
    await (await chooser).setFiles(CARD);
    const report = page.getByRole('dialog', { name: '가져왔어요', exact: true });
    await expect(report).toContainText('첫인사 1개 · 로어북 1개 · 정규식 1개');
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    await expect(messages).toHaveCount(1);
    await expect(messages.first()).toContainText(GREETING);
  });

  await test.step('send "hi" and see the fake reply rendered, after the tokenizer chunk loads under the CSP', async () => {
    const tokenizer = page.waitForResponse(/o200k_base-[\w-]+\.js$/);
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    expect((await tokenizer).status()).toBe(200);
    await expect(messages.nth(2)).toHaveText(/Mira smiles\. \(bows\)/);
    // Shown once the reply is saved and the turn is over.
    await expect(page.getByRole('button', { name: '새 답장 받기', exact: true })).toBeAttached();
    expect(violations).toEqual([]);
  });

  await test.step('the request carries the starter prompt, the card description and "hi" last', async () => {
    expect(sent).toHaveLength(1);
    const { model, messages: prompt } = sent[0] as { model: string; messages: { role: string; content: string }[] };
    expect(model).toBe(FAKE_MODEL);
    expect(prompt.some((message) => message.content.includes('This is private roleplay between two performers'))).toBe(true);
    expect(prompt.find((message) => message.content.includes(DESCRIPTION))?.content).toContain('(Main NPC)');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(JSON.stringify(sent[0])).not.toContain(NICKNAME);
  });

  await test.step('after a reload the chat and its rendered messages are still there', async () => {
    const shown = await messages.allTextContents();
    await page.reload();
    await expect(messages).toHaveCount(3);
    expect(await messages.allTextContents()).toEqual(shown);
    await expect(messages.nth(0)).toContainText(GREETING);
    await expect(messages.nth(1)).toContainText('hi');
    await expect(messages.nth(2)).toContainText('Mira smiles. (bows)');
  });

  await test.step('Ctrl+P opens the prompts beside the chat, a role changed there comes back with Ctrl+Z, Ctrl+/ lists every shortcut, and Ctrl+S opens and closes 설정', async () => {
    await page.keyboard.press('Control+p');
    const side = page.getByRole('complementary', { name: '프롬프트' });
    await side.getByRole('button', { name: /핑퐁 간소화/ }).first().click();
    await side.getByRole('button', { name: /^1\. / }).click();
    const system = side.getByRole('button', { name: '시스템', exact: true });
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await side.getByRole('button', { name: '사용자', exact: true }).click();
    await expect(system).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Control+z');
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await expect(messages).toHaveCount(3);
    await page.keyboard.press('Control+p');
    await expect(side).toBeHidden();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();
    await page.keyboard.press('Escape');
    const closeSettings = page.getByRole('button', { name: '설정 닫기', exact: true });
    await page.keyboard.press('Control+s');
    await expect(closeSettings).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(closeSettings).toBeHidden();
    expect(violations).toEqual([]);
  });

  await test.step('the backup holds the card and the reply, and loading it again carries on without adding anything', async () => {
    await page.goto('/account');
    // A native save dialog does not emit Playwright's download event; this flow exercises the Blob fallback.
    await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }));
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: '받기', exact: true }).click();
    const file = await (await saved).path();
    const objects = strFromU8(unzipSync(readFileSync(file))['objects.jsonl']!);
    expect(objects).toContain(DESCRIPTION);
    expect(objects).toContain('[[bow]]');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '불러오기', exact: true }).click();
    await (await chooser).setFiles(file);
    await expect(page.getByText('백업을 불러왔어요.', { exact: true })).toBeVisible();
    expect(violations).toEqual([]);
  });

  await test.step('a bot’s HTML is drawn in its message with its CSS and pictures, and nothing in it runs, posts, loads from outside or covers the app', async () => {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '봇 가져오기', exact: true }).first().click();
    await (await chooser).setFiles(HOSTILE);
    await page.getByRole('dialog', { name: '가져왔어요', exact: true }).getByRole('button', { name: '채팅 시작', exact: true }).click();
    const greeting = messages.first();
    // The message is drawn again once its picture loads, so the rest is measured after.
    await expect(greeting.locator('#pic img')).toHaveAttribute('src', /^blob:/);
    await expect(greeting.locator('#pic img')).toHaveJSProperty('naturalWidth', 1);
    await expect(greeting.locator('#backdrop')).toHaveCSS('background-image', /^url\("blob:/);
    await expect(greeting.locator('#tone')).toHaveCSS('color', 'rgb(0, 128, 0)');
    await expect(greeting.locator('#cover')).toHaveCSS('background-color', 'rgb(200, 0, 0)');
    const [cover, message] = await Promise.all([greeting.locator('#cover').boundingBox(), greeting.boundingBox()]);
    expect(cover!.y).toBeGreaterThanOrEqual(message!.y);
    expect(cover!.y + cover!.height).toBeLessThanOrEqual(message!.y + message!.height);
    await expect(greeting.locator('#outside')).toHaveCount(0);
    await expect(greeting.locator('form')).toHaveCount(0);
    await expect(greeting.locator('#field')).toHaveCount(1);
    await expect(greeting.locator('#out')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(greeting.locator('#js')).not.toHaveAttribute('href', /./);
    await expect(greeting.locator('em')).toHaveText('nods');
    await expect(greeting.locator('mark')).toHaveText('"hello"');
    await greeting.getByRole('button', { name: '누르기', exact: true }).click();
    await expect(page.getByText('이 버튼에는 이어진 동작이 없어요.', { exact: true })).toBeVisible();
    expect(await page.evaluate('window.ran')).toBeUndefined();
    expect(violations).toEqual([]);
  });

  await test.step('a bot’s Lua runs in its worker under the CSP: a button is answered, the bot speaks, the display follows its state, and a reply is edited once saved', async () => {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '봇 가져오기', exact: true }).first().click();
    await (await chooser).setFiles(SCRIPTED);
    await page.getByRole('dialog', { name: '가져왔어요', exact: true }).getByRole('button', { name: '채팅 시작', exact: true }).click();
    const greeting = messages.first();
    await expect(greeting).toContainText('[door:null]');
    await greeting.getByRole('button', { name: '문 열기', exact: true }).click();
    await expect(page.getByText('문이 열렸어요', { exact: true })).toBeVisible();
    await expect(greeting).toContainText('[door:open]');
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(messages.nth(2)).toContainText('Scripted smiles. [[bow]] (seen) [door:open]');
    expect(violations).toEqual([]);
  });

  await test.step('a module file becomes a module, and once always on it works on a chat already there: its display script draws and its block trigger answers a button', async () => {
    const chat = page.url();
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '봇 가져오기', exact: true }).first().click();
    await (await chooser).setFiles(MODULE);
    await page.getByRole('dialog', { name: '가져왔어요', exact: true }).getByRole('button', { name: '모듈 보기', exact: true }).click();
    await page.getByRole('switch', { name: '항상 켜기', exact: true }).click();
    await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).toBeChecked();
    await page.goto(chat);
    const last = messages.nth(2);
    await expect(last).toContainText('[bell:]');
    await last.getByRole('button', { name: '벨 울리기', exact: true }).click();
    await expect(page.getByText('따르릉', { exact: true })).toBeVisible();
    await expect(last).toContainText('[bell:2]');
    await expect(messages.first()).toContainText('[bell:]');
    expect(violations).toEqual([]);
  });
});
