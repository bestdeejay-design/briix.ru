/* BRIIX — живое ожидание. Ротация коротких фраз под прогрессом задачи.
 * Пул лежит в wait-phrases.js (данные отдельно от логики).
 * Правила:
 *  — фраза привязана к реальной стадии из GET /jobs/{id}; у локального мока свои
 *    честные зоны (заглушка не притворяется студией);
 *  — анти-повтор: последние NO_REPEAT фраз типа не повторяются, история в localStorage;
 *  — смена раз в 4–6 секунд, мелким кеглем под прогрессом;
 *  — prefers-reduced-motion: одна фраза, без ротации.
 */
(() => {
  'use strict';
  const KEY = 'briix-wait-phrases-v1';
  const MIN_MS = 4000;
  const MAX_MS = 6000;
  const TICK_MS = 1000;
  const NO_REPEAT = 15;
  const MAX_RECENT = 40;
  const STAGED_PROBABILITY = 0.65;   // чаще говорим о текущей стадии, иногда — общее
  const nodes = new WeakMap();
  let recent = load();
  let timer = null;
  let picks = 0;
  let rotations = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const out = {};
      for (const [type, list] of Object.entries(raw || {})) {
        if (Array.isArray(list)) out[type] = list.filter(x => typeof x === 'string').slice(-MAX_RECENT);
      }
      return out;
    } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(recent)); } catch { /* приватный режим браузера */ }
  }
  const data = () => window.BRIIX_WAIT_PHRASES || {};

  /* Пул для узла: реальная стадия, честная зона мока или общие фразы типа. */
  function poolFor({ type = 'music', stage = '', mock = false, zone = '' } = {}) {
    const set = data()[type] || {};
    if (mock) {
      const zones = set.mock || {};
      const list = Array.isArray(zones[zone]) ? zones[zone] : [];
      const fallback = Object.values(zones).flat();
      return { key: type + ':mock:' + (list.length ? zone : 'any'), staged: false, list: list.length ? list : fallback };
    }
    const staged = Array.isArray(set[stage]) ? set[stage] : [];
    const any = Array.isArray(set.any) ? set.any : [];
    return { key: type + ':' + (staged.length ? stage : 'any'), staged: staged.length ? stage : null, list: [...staged, ...any] };
  }

  function remember(type, phrase) {
    const list = recent[type] || [];
    list.push(phrase);
    recent[type] = list.slice(-MAX_RECENT);
    save();
  }

  function pick(options) {
    const { type = 'music' } = options || {};
    const pool = poolFor(options);
    if (!pool.list.length) return '';
    const seen = new Set((recent[type] || []).slice(-NO_REPEAT));
    let candidates = pool.list.filter(x => !seen.has(x));
    if (!candidates.length) candidates = pool.list.slice();   // пул исчерпан — окно не должно вешать ожидание
    let from = candidates;
    if (pool.staged && Math.random() < STAGED_PROBABILITY) {
      const stagedList = candidates.filter(x => (data()[type]?.[pool.staged] || []).includes(x));
      if (stagedList.length) from = stagedList;
    }
    const phrase = from[Math.floor(Math.random() * from.length)];
    picks++;
    remember(type, phrase);
    return phrase;
  }

  const optionsOf = el => ({
    type: el.dataset.waitType || 'music',
    stage: el.dataset.waitStage || '',
    mock: el.dataset.waitMock === '1',
    zone: el.dataset.waitZone || ''
  });
  const signature = el => JSON.stringify(optionsOf(el));

  function fill(el, isRotation) {
    const options = optionsOf(el);
    const phrase = pick(options);
    if (!phrase) { el.textContent = ''; return; }
    el.textContent = phrase;
    const now = Date.now();
    nodes.set(el, { sig: signature(el), nextAt: now + MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS)) });
    if (isRotation) rotations++;
  }

  function scan() {
    const list = document.querySelectorAll('[data-wait]');
    for (const el of list) {
      const state = nodes.get(el);
      if (!state || state.sig !== signature(el)) { fill(el, false); continue; }
      if (reduced.matches) continue;                       // уменьшенное движение — без ротации
      if (Date.now() >= state.nextAt) fill(el, true);
    }
    if (!list.length && timer) { clearInterval(timer); timer = null; }
  }

  function refresh() {
    scan();
    if (!timer && document.querySelector('[data-wait]')) timer = setInterval(scan, TICK_MS);
  }

  // Новый узел заполняется сразу, а не через секунду тика.
  const observer = new MutationObserver(records => {
    let touched = false;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('[data-wait]') || node.querySelector?.('[data-wait]')) { touched = true; break; }
      }
      if (r.type === 'attributes' && r.target.matches?.('[data-wait]')) touched = true;
      if (touched) break;
    }
    if (touched) refresh();
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-wait-stage', 'data-wait-zone', 'data-wait-mock'] });
    refresh();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  reduced.addEventListener?.('change', () => { for (const el of document.querySelectorAll('[data-wait]')) nodes.delete(el); refresh(); });

  window.BRIIX_WAIT = {
    refresh,
    poolFor,
    pick,
    noRepeatWindow: () => NO_REPEAT,
    interval: () => ({ min: MIN_MS, max: MAX_MS, tick: TICK_MS }),
    stats: () => ({ picks, rotations, recent: Object.fromEntries(Object.entries(recent).map(([k, v]) => [k, v.length])) }),
    recentFor: type => (recent[type] || []).slice(),
    reset() { recent = {}; save(); picks = 0; rotations = 0; for (const el of document.querySelectorAll('[data-wait]')) nodes.delete(el); refresh(); }
  };
})();
