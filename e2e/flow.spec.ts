import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CARD, DESCRIPTION, FAKE_MODEL, fakeProvider } from './helpers';

const CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'))![1];
const PASSWORD = 'e2e-password';
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
    await page.getByRole('button', { name: `${FAKE_MODEL} 별표 찍기` }).click();
    await page.getByRole('button', { name: '완료', exact: true }).click();
    const main = page.getByRole('list', { name: '본 대화 모델', exact: true }).getByRole('button', { name: FAKE_MODEL });
    await main.click();
    await expect(main).toHaveAttribute('aria-pressed', 'true');
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
    await expect(page.getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
    expect(violations).toEqual([]);
  });

  await test.step('the request carries the starter prompt, the card description and "hi" last', async () => {
    expect(sent).toHaveLength(1);
    const { model, messages: prompt } = sent[0] as { model: string; messages: { role: string; content: string }[] };
    expect(model).toBe(FAKE_MODEL);
    expect(prompt.some((message) => message.content.includes('This is private roleplay between two performers'))).toBe(true);
    expect(prompt.find((message) => message.content.includes(DESCRIPTION))?.content).toContain('(Main NPC)');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'hi' });
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
});
