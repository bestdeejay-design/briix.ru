/* Isolated browser checks for the not-yet-integrated storage foundation.
 * Run with the same Playwright dependencies as tools/check-studio.cjs.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./browser-env.cjs');

(async () => {
  const script = fs.readFileSync(path.join(__dirname, '../studio/session-store.js'));
  const server = http.createServer((req, res) => {
    if (req.url === '/session-store.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(script); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><script src="/session-store.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const otherTab = await context.newPage();
    const url = 'http://127.0.0.1:' + server.address().port;
    await Promise.all([page.goto(url), otherTab.goto(url)]);
    const feed = Array.from({ length: 105 }, (_, i) => ({ t: 'user', who: 'Вы', text: 'Запрос ' + i }));
    feed.push({ t: 'media', who: 'Музыка', kind: 'music', job: 'job-a', file: '/files/job-a' });
    const history = [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Ответ' }];
    const feedRaw = JSON.stringify(feed), historyRaw = JSON.stringify(history);
    await page.evaluate(({ feedRaw, historyRaw }) => {
      localStorage.setItem('briix-studio-feed-Аня', feedRaw);
      localStorage.setItem('briix-studio-history-Аня', historyRaw);
    }, { feedRaw, historyRaw });
    const [first, second] = await Promise.all([
      page.evaluate(() => BriixSessionStore.openProfile('Аня')),
      otherTab.evaluate(() => BriixSessionStore.openProfile('Аня'))
    ]);
    assert.deepEqual(first, second, 'concurrent migration is idempotent');
    assert.deepEqual(first.sessions[0].feed, feed, 'feed is not truncated at 80 entries');
    assert.deepEqual(first.sessions[0].history, history);
    assert.equal(first.sessions[0].title, 'Запрос 0');
    assert.equal(first.legacyBackup.feedRaw, feedRaw);
    assert.equal(first.legacyBackup.historyRaw, historyRaw);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('briix-studio-feed-Аня'), localStorage.getItem('briix-studio-history-Аня')]), [feedRaw, historyRaw]);

    const saveInTab = (tab, title) => tab.evaluate(async ({ profile, title }) => {
      profile.sessions.push({ id: title, title, createdAt: 2, updatedAt: 2, feed: [], history: [] });
      profile.legacyBackup = null;
      try { return { profile: await BriixSessionStore.saveProfile(profile, 0) }; }
      catch (error) { return { code: error.code }; }
    }, { profile: first, title });
    const writes = await Promise.all([saveInTab(page, 'вторая'), saveInTab(otherTab, 'третья')]);
    assert.equal(writes.filter(x => x.profile).length, 1, 'exactly one writer wins');
    assert.equal(writes.filter(x => x.code === 'conflict').length, 1, 'stale writer is rejected');
    const saved = writes.find(x => x.profile).profile;
    assert.equal(saved.revision, 1);
    assert.equal(saved.legacyBackup.feedRaw, feedRaw, 'normal save cannot erase backup');
    await page.evaluate(() => localStorage.setItem('briix-studio-feed-Аня', '{broken'));
    assert.deepEqual(await page.evaluate(() => BriixSessionStore.openProfile('Аня')), saved, 'committed import is authoritative');
    const other = await page.evaluate(() => BriixSessionStore.openProfile('Борис'));
    assert.deepEqual(other.sessions, [], 'profiles are separate');

    const failures = await page.evaluate(async ({ feedRaw }) => {
      localStorage.setItem('briix-studio-feed-повреждено', '{bad');
      const result = {};
      try { await BriixSessionStore.openProfile('повреждено'); } catch (e) { result.corrupt = e.code; }
      result.original = localStorage.getItem('briix-studio-feed-повреждено');
      localStorage.setItem('briix-studio-feed-повреждено', feedRaw);
      result.afterRetry = (await BriixSessionStore.openProfile('повреждено')).sessions[0].feed.length;
      try { await BriixSessionStore.openProfile('нет-idb', { indexedDB: null }); } catch (e) { result.noIdb = e.code; }
      try { await BriixSessionStore.openProfile('нет-доступа', { storage: { getItem() { throw new Error('denied'); } } }); } catch (e) { result.denied = e.code; }
      try { await BriixSessionStore.saveProfile({ nick: 'x' }, 0); } catch (e) { result.invalid = e.code; }
      localStorage.setItem('briix-studio-feed-quota', feedRaw);
      const originalAdd = IDBObjectStore.prototype.add;
      try {
        IDBObjectStore.prototype.add = function () { throw new DOMException('full', 'QuotaExceededError'); };
        try { await BriixSessionStore.openProfile('quota'); } catch (e) { result.quota = e.cause?.name; }
      } finally { IDBObjectStore.prototype.add = originalAdd; }
      result.quotaOriginal = localStorage.getItem('briix-studio-feed-quota') === feedRaw;
      result.quotaRetry = (await BriixSessionStore.openProfile('quota')).sessions[0].feed.length;
      return result;
    }, { feedRaw });
    assert.deepEqual(failures, { corrupt: 'legacy_invalid', original: '{bad', afterRetry: 106, noIdb: 'idb_unavailable', denied: 'storage_unavailable', invalid: 'invalid_profile', quota: 'QuotaExceededError', quotaOriginal: true, quotaRetry: 106 });
    await context.close();
    console.log('PASS session storage foundation: browser migration, backup, isolation, conflicts and failures');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
