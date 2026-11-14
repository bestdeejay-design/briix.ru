/* Session storage: transactional IndexedDB with a sticky, lock-protected local fallback. */
(() => {
  'use strict';

  const DB_NAME = 'briix-studio-sessions';
  const DB_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const STORE = 'profiles';
  const feedKey = nick => 'briix-studio-feed-' + nick;
  const historyKey = nick => 'briix-studio-history-' + nick;

  class SessionStoreError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'SessionStoreError';
      this.code = code;
      this.cause = cause;
    }
  }

  function parseLegacy(raw, key) {
    if (raw === null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) { throw new SessionStoreError('legacy_invalid', 'Старые данные повреждены: ' + key, error); }
    if (!Array.isArray(parsed)) throw new SessionStoreError('legacy_invalid', 'Старые данные имеют неожиданный формат: ' + key);
    return parsed;
  }

  function legacyProfile(nick, storage, now = Date.now()) {
    let feedRaw, historyRaw;
    try {
      feedRaw = storage.getItem(feedKey(nick));
      historyRaw = storage.getItem(historyKey(nick));
    } catch (error) {
      throw new SessionStoreError('storage_unavailable', 'Не удалось прочитать старые данные.', error);
    }
    const feed = parseLegacy(feedRaw, feedKey(nick));
    const history = parseLegacy(historyRaw, historyKey(nick));
    const first = feed.find(item => item && item.t === 'user' && typeof item.text === 'string' && item.text.trim());
    const title = first ? first.text.trim().replace(/\s+/g, ' ').slice(0, 80) : 'Предыдущая сессия';
    const hasLegacy = feedRaw !== null || historyRaw !== null;
    return {
      schemaVersion: SCHEMA_VERSION,
      nick,
      revision: 0,
      activeSessionId: hasLegacy ? 'legacy' : null,
      sessions: hasLegacy ? [{ id: 'legacy', title, titleSet: Boolean(first), createdAt: now, updatedAt: now, feed, history }] : [],
      // Exact originals are committed in the same transaction as the import; legacy keys remain untouched.
      legacyBackup: { feedRaw, historyRaw, capturedAt: now }
    };
  }

  function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new SessionStoreError('idb_unavailable', 'IndexedDB недоступна.')); return; }
      let request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (error) { reject(new SessionStoreError('idb_unavailable', 'Не удалось открыть IndexedDB.', error)); return; }
      let settled = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'nick' });
      };
      request.onerror = () => { if (!settled) { settled = true; reject(new SessionStoreError('idb_unavailable', 'Не удалось открыть IndexedDB.', request.error)); } };
      request.onblocked = () => { if (!settled) { settled = true; reject(new SessionStoreError('idb_blocked', 'Другая вкладка блокирует открытие хранилища.')); } };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }

  function transact(db, operation) {
    return new Promise((resolve, reject) => {
      let transaction, result, reason;
      try {
        transaction = db.transaction(STORE, 'readwrite');
        operation(transaction.objectStore(STORE), value => { result = value; }, error => { reason = error; transaction.abort(); });
      } catch (error) {
        if (transaction) { try { transaction.abort(); } catch (_) {} }
        reject(error instanceof SessionStoreError ? error : new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error));
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(reason || new SessionStoreError('storage_write', 'Не удалось сохранить данные.', transaction.error));
      transaction.onerror = () => { /* onabort carries the final failure */ };
    });
  }

  async function openProfile(nick, options = {}) {
    if (typeof nick !== 'string' || !nick) throw new SessionStoreError('invalid_nick', 'Нужен ник профиля.');
    const db = await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    try {
      // A single write transaction serializes concurrent first opens and commits backup + import together.
      return await transact(db, (store, done, fail) => {
        const get = store.get(nick);
        get.onsuccess = () => {
          if (get.result !== undefined) {
            if (get.result.schemaVersion !== SCHEMA_VERSION) {
              fail(new SessionStoreError('schema_unsupported', 'Версия данных сессий не поддерживается.'));
            } else done(get.result);
            return;
          }
          try {
            const profile = legacyProfile(nick, storage);
            store.add(profile);
            done(profile);
          } catch (error) {
            fail(error instanceof SessionStoreError ? error : new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error));
          }
        };
      });
    } finally { db.close(); }
  }

  async function saveProfile(profile, expectedRevision, options = {}) {
    if (!profile || typeof profile.nick !== 'string' || !profile.nick || profile.schemaVersion !== SCHEMA_VERSION ||
        !Array.isArray(profile.sessions) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SessionStoreError('invalid_profile', 'Некорректные данные сессий.');
    }
    const db = await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
    try {
      return await transact(db, (store, done, fail) => {
        const get = store.get(profile.nick);
        get.onsuccess = () => {
          try {
            const current = get.result;
            if (!current || current.revision !== expectedRevision) {
              fail(new SessionStoreError('conflict', 'Данные сессии изменились в другой вкладке. Перезагрузите их перед сохранением.'));
              return;
            }
            if (current.schemaVersion !== SCHEMA_VERSION) {
              fail(new SessionStoreError('schema_unsupported', 'Версия данных сессий не поддерживается.'));
              return;
            }
            // A normal save cannot destroy the recovery copy, even if the caller supplies an outdated object.
            const next = { ...profile, legacyBackup: current.legacyBackup, revision: expectedRevision + 1 };
            store.put(next);
            done(next);
          } catch (error) { fail(new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error)); }
        };
      });
    } finally { db.close(); }
  }

  const modeKey = nick => 'briix-studio-sessions-backend-' + nick;
  const fallbackKey = nick => 'briix-studio-sessions-v1-' + nick;

  function withProfileLock(nick, operation, options, allowIdbWithoutLock = false) {
    const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
    if (!locks) {
      if (allowIdbWithoutLock) return operation();
      throw new SessionStoreError('lock_unavailable', 'Без блокировки вкладок нельзя безопасно открыть локальное хранилище.');
    }
    return locks.request('briix-studio-sessions:' + nick, operation);
  }

  function localRead(storage, key) {
    try { return storage.getItem(key); }
    catch (error) { throw new SessionStoreError('storage_unavailable', 'Не удалось прочитать локальное хранилище.', error); }
  }
  function localWrite(storage, key, value) {
    try { storage.setItem(key, value); }
    catch (error) { throw new SessionStoreError('storage_write', 'Не удалось сохранить локальные данные.', error); }
  }

  // The backend choice is sticky: returning to IDB automatically after fallback would fork history.
  async function open(nick, options = {}) {
    if (typeof nick !== 'string' || !nick) throw new SessionStoreError('invalid_nick', 'Нужен ник профиля.');
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    return withProfileLock(nick, async () => {
      let mode = localRead(storage, modeKey(nick));
      if (mode !== null && mode !== 'idb' && mode !== 'local') throw new SessionStoreError('schema_unsupported', 'Неизвестный тип хранилища сессий.');
      const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
      if (mode === 'local' && !locks) throw new SessionStoreError('lock_unavailable', 'Локальные сессии доступны только с блокировкой вкладок.');
      if (!mode) {
        try {
          const db = await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
          db.close();
          mode = 'idb';
        } catch (error) {
          if (error.code !== 'idb_unavailable') throw error;
          if (!locks) throw new SessionStoreError('lock_unavailable', 'IndexedDB и блокировка вкладок недоступны; безопасное сохранение невозможно.', error);
          mode = 'local';
        }
        // Set before any profile write: an interruption cannot silently create two histories.
        localWrite(storage, modeKey(nick), mode);
      }
      if (mode === 'idb') return { backend: mode, profile: await openProfile(nick, { ...options, storage }) };
      const raw = localRead(storage, fallbackKey(nick));
      if (raw !== null) {
        let profile;
        try { profile = JSON.parse(raw); } catch (error) { throw new SessionStoreError('legacy_invalid', 'Локальные сессии повреждены.', error); }
        if (!profile || profile.nick !== nick || profile.schemaVersion !== SCHEMA_VERSION || !Array.isArray(profile.sessions)) {
          throw new SessionStoreError('schema_unsupported', 'Неизвестный формат локальных сессий.');
        }
        return { backend: mode, profile };
      }
      const profile = legacyProfile(nick, storage);
      localWrite(storage, fallbackKey(nick), JSON.stringify(profile));
      return { backend: mode, profile };
    }, options, true);
  }

  async function save(profile, expectedRevision, backend, options = {}) {
    if (backend === 'idb') return saveProfile(profile, expectedRevision, options);
    if (backend !== 'local' || !profile || !profile.nick || profile.schemaVersion !== SCHEMA_VERSION || !Array.isArray(profile.sessions)) {
      throw new SessionStoreError('invalid_profile', 'Некорректные данные сессий.');
    }
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    return withProfileLock(profile.nick, () => {
      const raw = localRead(storage, fallbackKey(profile.nick));
      let current;
      try { current = JSON.parse(raw); } catch (error) { throw new SessionStoreError('legacy_invalid', 'Локальные сессии повреждены.', error); }
      if (!current || current.schemaVersion !== SCHEMA_VERSION || current.nick !== profile.nick || current.revision !== expectedRevision) {
        throw new SessionStoreError('conflict', 'Данные сессии изменились в другой вкладке.');
      }
      const next = { ...profile, revision: expectedRevision + 1, legacyBackup: current.legacyBackup };
      localWrite(storage, fallbackKey(profile.nick), JSON.stringify(next));
      return next;
    }, options);
  }

  globalThis.BriixSessionStore = Object.freeze({ open, save, openProfile, saveProfile, SessionStoreError });
})();
