/* BRIIX — сквозной мобильный контракт.
 *
 * Один прогон обходит все разделы и вкладки на телефоне (390x844, тач, DPR 2) и
 * собирает нарушения целиком, а не падает на первом: удобно и как аудит, и как гейт.
 *
 * Контракт мобильного экрана:
 *   1. нет горизонтального скролла и нет обрезанных за правый край контролов;
 *   2. тач-таргеты не меньше 40 px (главные действия — 44 px);
 *   3. поля ввода не меньше 16 px — иначе iOS приближает страницу при фокусе;
 *   4. главное творческое действие видно без прокрутки;
 *   5. служебные пояснения не съедают первый экран;
 *   6. axe (wcag2a/2aa/21aa) без нарушений.
 *
 * Запуск: NODE_PATH=... node tools/check-mobile-ui.cjs [--report]
 *   --report — только печать находок и скриншоты, без падения (для аудита).
 */
const { launch, AxeBuilder, BASE_URL, OUT } = require('./browser-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const REPORT_ONLY = process.argv.includes('--report');
const SHOTS = path.join(OUT, 'mobile-ui');
fs.mkdirSync(SHOTS, { recursive: true });

const ROUTES = [
  { id: 'home', hash: '#/home', ready: '.home', primary: '#send-button', creative: '#prompt-input' },
  // Диалог живёт по адресу с id: берём первый из посеянной истории.
  { id: 'chat', hash: '#/chat/example-coffee', ready: '.chat-page', primary: '#send-button', creative: '#prompt-input' },
  { id: 'assistants', hash: '#/assistants', ready: '.page', primary: null },
  { id: 'prompts', hash: '#/prompts', ready: '.page', primary: null },
  { id: 'favorites', hash: '#/favorites', ready: '.page', primary: null },
  { id: 'media', hash: '#/media', ready: '.media-page', primary: '#media-generate', creative: '#media-prompt', tabs: ['create', 'library', 'queue', 'models', 'showcase'], tabPrefix: 'media-tab-' },
  { id: 'music', hash: '#/music', ready: '.music-page', primary: '#music-generate', creative: '#music-prompt', tabs: ['create', 'library', 'queue', 'models', 'showcase'], tabPrefix: 'music-tab-' },
  { id: 'settings', hash: '#/settings', ready: '.page', primary: null }
];

const MIN_TARGET = 40;
const MIN_PRIMARY = 44;
const MIN_INPUT_FONT = 16;

async function measure(page, primary, creative) {
  return page.evaluate(({ primary, creative, MIN_TARGET, MIN_PRIMARY, MIN_INPUT_FONT }) => {
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const inContent = el => !!el.closest('.page, .home, .chat, .settings-page, .music-page, .media-page, main');
    const visible = el => {
      if (!el.getClientRects().length) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const label = el => (el.getAttribute('aria-label') || el.textContent || el.id || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 46);
    const box = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };

    const controls = [...document.querySelectorAll('button, a[href], summary, [role="tab"], input[type="checkbox"], input[type="radio"]')]
      .filter(el => visible(el) && inContent(el));
    const smallTargets = controls
      .map(el => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ el, b }) => b.width > 0 && b.height > 0)
      .filter(({ el, b }) => {
        // чекбокс/радио живут внутри крупной строки-подписи — площадь даёт label
        if (el.matches('input[type="checkbox"], input[type="radio"]')) {
          const host = el.closest('label');
          if (host && host.getBoundingClientRect().height >= MIN_TARGET) return false;
        }
        return b.width < MIN_TARGET || b.height < MIN_TARGET;
      })
      .map(({ el }) => ({ label: label(el), cls: el.className.toString().slice(0, 34), ...box(el) }));

    // Лента с overflow-x:auto — не обрезка: до элемента долистывают пальцем.
    // Обрезка — когда контрол вылез за край, а листать нечего.
    const scrollableAncestor = el => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (['auto', 'scroll'].includes(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
        p = p.parentElement;
      }
      return false;
    };
    const clipped = controls.map(el => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ el, b }) => b.width > 0 && (b.right > vw + 1 || b.x < -1) && !scrollableAncestor(el))
      .map(({ el }) => ({ label: label(el), cls: el.className.toString().slice(0, 34), ...box(el) }));

    // Отдельное правило интерфейса: все вкладки раздела обязаны помещаться в экран.
    // Спрятанную за краем вкладку пользователь не находит — это уже проверено жалобой.
    const tabsOffscreen = [...document.querySelectorAll('.media-tab, .music-tab')]
      .map(el => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ b }) => b.width > 0 && (b.right > vw + 1 || b.x < -1))
      .map(({ el }) => ({ label: label(el), id: el.id, ...box(el) }));

    const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea, select')]
      .filter(el => visible(el) && inContent(el));
    const tinyFields = fields.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }))
      .filter(({ size }) => size < MIN_INPUT_FONT)
      .map(({ el, size }) => ({ label: label(el), id: el.id, size }));

    const primaryEl = primary ? document.querySelector(primary) : null;
    const primaryInfo = primaryEl ? {
      ...box(primaryEl),
      label: label(primaryEl),
      visibleWithoutScroll: (() => { const b = primaryEl.getBoundingClientRect(); return b.top < vh && b.bottom > 0; })(),
      bigEnough: (() => { const b = primaryEl.getBoundingClientRect(); return b.height >= MIN_PRIMARY; })()
    } : null;

    // сколько первого экрана уходит до главного действия/поля творчества
    const firstCreative = creative ? document.querySelector(creative) : null;
    const creativeTop = firstCreative ? Math.round(firstCreative.getBoundingClientRect().top) : null;

    return {
      vw, vh,
      overflow: document.documentElement.scrollWidth - vw,
      smallTargets, clipped, tabsOffscreen, tinyFields, primary: primaryInfo, creativeTop,
      controlCount: controls.length
    };
  }, { primary, creative, MIN_TARGET, MIN_PRIMARY, MIN_INPUT_FONT });
}

(async () => {
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce'
  });
  await context.newPage();
  const page = context.pages()[0];
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const findings = [];
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const flag = (screen, kind, detail) => findings.push({ screen, kind, detail });

  for (const route of ROUTES) {
    const screens = route.tabs ? route.tabs.map(t => ({ id: `${route.id}/${t}`, tab: t })) : [{ id: route.id, tab: null }];
    for (const screen of screens) {
      await page.goto(BASE_URL + '/' + route.hash);
      await page.waitForSelector(route.ready, { timeout: 15000 });
      if (screen.tab) {
        await page.locator('#' + route.tabPrefix + screen.tab).click();
        await page.waitForTimeout(350);
      } else {
        await page.waitForTimeout(300);
      }
      const onCreate = !screen.tab || screen.tab === 'create';
      const m = await measure(page, onCreate ? route.primary : null, onCreate ? route.creative : null);
      if (m.overflow > 1) flag(screen.id, 'horizontal-overflow', m.overflow);
      if (m.clipped.length) flag(screen.id, 'clipped-controls', m.clipped);
      if (m.tabsOffscreen.length) flag(screen.id, 'tabs-offscreen', m.tabsOffscreen);
      if (m.smallTargets.length) flag(screen.id, 'small-targets', m.smallTargets);
      if (m.tinyFields.length) flag(screen.id, 'input-font-under-16', m.tinyFields);
      if (m.primary && !m.primary.visibleWithoutScroll) flag(screen.id, 'primary-below-fold', m.primary);
      if (m.primary && !m.primary.bigEnough) flag(screen.id, 'primary-too-small', m.primary);
      if (m.creativeTop !== null && m.creativeTop > m.vh - 120) flag(screen.id, 'creative-field-too-low', m.creativeTop);

      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      if (axe.violations.length) flag(screen.id, 'axe', axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target).slice(0, 6) })));

      await page.screenshot({ path: path.join(SHOTS, screen.id.replace('/', '-') + '.png') });
      console.log('SCREEN', screen.id, JSON.stringify({ overflow: m.overflow, controls: m.controlCount, small: m.smallTargets.length, clipped: m.clipped.length, tabsOff: m.tabsOffscreen.length, tinyFields: m.tinyFields.length, primary: m.primary ? m.primary.visibleWithoutScroll : null, creativeTop: m.creativeTop, axe: axe.violations.length }));
    }
  }

  // Боковая панель на телефоне — тоже рабочий экран, а не декорация.
  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.home');
  await page.locator('[data-action="toggle-sidebar"]').click();
  await page.waitForTimeout(300);
  const drawer = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.sidebar .nav-item, .sidebar .history-item, .sidebar .btn')]
      .filter(el => el.getClientRects().length)
      .map(el => ({ label: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }));
    return { items, small: items.filter(i => i.h < 40) };
  });
  if (drawer.small.length) flag('sidebar', 'small-targets', drawer.small);
  await page.screenshot({ path: path.join(SHOTS, 'sidebar.png') });

  if (pageErrors.length) flag('global', 'page-errors', pageErrors);

  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify({ findings, results }, null, 2));
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  console.log('\nFINDINGS', JSON.stringify(byKind));
  for (const f of findings) console.log(' -', f.screen, f.kind, JSON.stringify(f.detail).slice(0, 300));

  if (!REPORT_ONLY) {
    assert.deepEqual(findings, [], 'мобильный контракт нарушен: ' + findings.length + ' находок (подробности выше)');
    ok('mobile contract holds across every section', { screens: results.length });
  }
  console.log(REPORT_ONLY ? 'REPORT DONE' : 'DONE');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
