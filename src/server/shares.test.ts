import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VISITOR_HEADER } from '../contracts/http';
import { hex } from './http';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 3').run();
});

async function account(username: string) {
  const body = signupBody(username);
  return { id: body.accountId, cookie: sessionCookie(await t.post('signup', body)) };
}

async function stored(bytes: number[], cookie: string) {
  const body = new Uint8Array(bytes);
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', body)));
  await t.put(`files/${id}`, body, cookie);
  return id;
}

// The operator first (the installation's first signup), then a sharer who has agreed and published a manifest naming
// one picture.
async function published() {
  const operator = await account('operator');
  const sharer = await account('sharer');
  await t.put('shares/consent', undefined, sharer.cookie);
  const manifest = await stored([1, 1, 1], sharer.cookie);
  const picture = await stored([2, 2, 2], sharer.cookie);
  const answer = await t.post('shares', { manifest, files: [picture], cover: null }, sharer.cookie);
  const { id } = (await answer.json()) as { id: string };
  return { operator, sharer, manifest, picture, id };
}

let visitor = 0;
const report = (share: string, from = `visitor-${++visitor}`) =>
  t.raw(`shares/${share}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [VISITOR_HEADER]: from },
    body: JSON.stringify({ text: '미성년자로 보여요', link: `https://hazelle.app/s/${share}#key`, version: 1 }),
  });
const state = async (share: string) => ((await (await t.get(`shares/${share}`)).json()) as { state: string }).state;

describe('a share link', () => {
  it('is held by its first report, both anonymous reads answer held, and once reviewed a report no longer holds it', async () => {
    const { operator, sharer, picture, id } = await published();
    expect(await state(id)).toBe('live');
    expect((await t.get(`shares/${id}/files/${picture}`)).status).toBe(200);

    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('held');
    const file = await t.get(`shares/${id}/files/${picture}`);
    expect([file.status, await file.json()]).toEqual([403, { error: 'share-held' }]);

    expect((await t.post(`admin/shares/${id}/release`, undefined, operator.cookie)).status).toBe(204);
    expect(await state(id)).toBe('live');
    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('live');
    const inbox = (await (await t.get('admin/reports', operator.cookie)).json()) as { reports: { resolvedAt: number | null; shared: { reviewed: boolean } }[] };
    expect(inbox.reports.map(({ resolvedAt, shared }) => [resolvedAt === null, shared.reviewed])).toEqual([[true, true], [false, true]]);

    const next = { manifest: await stored([4, 4, 4], sharer.cookie), files: [picture], cover: null };
    expect((await t.post(`shares/${id}/versions`, next, sharer.cookie)).status).toBe(200);
    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('held');
  });

  it("blocks the reviewed version's files for every account on a block, and refuses them in a publish after", async () => {
    const { operator, sharer, manifest, picture, id } = await published();
    await report(id);
    const blocked = await t.post(`admin/shares/${id}/block`, { version: 1, notice: '미성년자 성적 묘사로 차단했어요.', suspend: true }, operator.cookie);
    expect(blocked.status).toBe(204);
    expect(await t.env.db.prepare('SELECT id FROM file_blocks').all()).toMatchObject({ results: [{ id: picture }] });
    expect(await state(id)).toBe('gone');
    expect((await t.get(`files/${picture}`, sharer.cookie)).status).toBe(403);

    const again = await t.post('shares', { manifest, files: [picture], cover: null }, operator.cookie);
    expect([again.status, await again.json()]).toEqual([403, { error: 'no-consent' }]);
    await t.put('shares/consent', undefined, operator.cookie);
    const own = await stored([2, 2, 2], operator.cookie);
    expect(own).toBe(picture);
    const refused = await t.post('shares', { manifest: await stored([3], operator.cookie), files: [picture], cover: null }, operator.cookie);
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'file-blocked' }]);
  });

  it('keeps its manifest for the operator when the sharer cuts it under an open report', async () => {
    const { operator, sharer, manifest, id } = await published();
    await report(id);
    expect((await t.delete(`shares/${id}`, undefined, sharer.cookie)).status).toBe(204);
    expect(await state(id)).toBe('gone');
    expect((await t.get(`shares/${id}/files/${manifest}`)).status).toBe(404);
    const opened = await t.get(`admin/shares/${id}/files/${manifest}`, operator.cookie);
    expect([opened.status, [...new Uint8Array(await opened.arrayBuffer())]]).toEqual([200, [1, 1, 1]]);
  });

  it("reads as held, cover and files too, while its sharer is suspended, and comes back when the suspension lifts", async () => {
    const { operator, sharer, picture, id } = await published();
    await t.put(`shares/${id}/cover`, { cover: { name: 'Sora', creator: 'jin', line: '연을 만들어요' } }, sharer.cookie);
    const suspended = (on: boolean) => t.put(`admin/accounts/${sharer.id}/suspended`, on ? { suspended: true, reason: '확인 중이에요.' } : { suspended: false }, operator.cookie);
    expect((await suspended(true)).status).toBe(204);
    const cover = async () => ((await (await t.get(`shares/${id}/cover`)).json()) as { cover: unknown }).cover;
    expect([await state(id), await cover(), (await t.get(`shares/${id}/files/${picture}`)).status]).toEqual(['held', null, 403]);
    expect((await suspended(false)).status).toBe(204);
    expect([await state(id), await cover(), (await t.get(`shares/${id}/files/${picture}`)).status]).toEqual(['live', { name: 'Sora', creator: 'jin', line: '연을 만들어요' }, 200]);
  });

  it('limits each visitor of the anonymous routes on its own', async () => {
    const { id, operator } = await published();
    await t.post(`admin/shares/${id}/release`, undefined, operator.cookie);
    const statuses = [];
    for (let sent = 0; sent < 7; sent++) statuses.push((await report(id, 'one visitor')).status);
    expect(statuses).toEqual([204, 204, 204, 204, 204, 204, 429]);
    expect((await report(id, 'another visitor')).status).toBe(204);
  });
});
