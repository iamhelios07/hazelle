import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { migrate } from './db/migrate';
import { publishNews } from './news';

it("publishes the release's 소식 once, as the operator, only on the server of that version", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, 'migrations');
  const news = { version: 'v9.0.0', title: '새 기능', text: '본문' };
  const posts = () => db.prepare("SELECT account_id, title, version, created_at FROM posts WHERE category = 'news'").all();
  publishNews(db, 'v9.0.0', news, 5);
  expect(posts()).toEqual([]);
  db.exec("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline, notices_seen) VALUES ('op', 'op', 'h', 1, 'iop', 't', 0); UPDATE installation SET operator_account = 'op'");
  publishNews(db, null, news, 5);
  publishNews(db, 'v9.0.1', news, 5);
  expect(posts()).toEqual([]);
  publishNews(db, 'v9.0.0', news, 5);
  publishNews(db, 'v9.0.0', news, 6);
  expect(posts()).toEqual([{ account_id: 'op', title: '새 기능', version: 'v9.0.0', created_at: 5 }]);
  db.close();
});
