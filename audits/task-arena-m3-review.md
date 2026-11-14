# Ревью PR #96 (arena/7d3893cb-briix-ru, merge 71aefd4) — независимое код-ревью

VERDICT: pass-with-findings

Ревьюер: саб-агент (ветка review/arena-m3-96). Дифф: `git diff f0045cc..71aefd4` — studio/studio.js, studio/index.html, studio/studio.css, tools/check-studio.cjs (+ аудиты арены). Правки не вносились.

## Что прогонял лично

- Свежий worktree на merge-коммите: `git worktree add /tmp/review-96 71aefd4` (HEAD арены 79ad410 проверен как предок 71aefd4).
- `NODE_PATH=/opt/homebrew/lib/node_modules node tools/check-studio.cjs` — **SUITE PASS: 28 checks**.
- `NODE_PATH=/opt/homebrew/lib/node_modules node tools/check-wait-phrases.cjs` — **DONE 10 checks** (без NODE_PATH падает по playwright — это окружение, не код).
- `node --check studio/studio.js`, `node --check tools/check-studio.cjs` — OK; скобки CSS 228/228; конфликт-маркеры (`^<{7}|={7}|>{7}`) — пусто.

## Чеклист — что проверено и чисто

1. **Утечки.** `barTimer` (setInterval) удалён совсем — вместо процента остался стадийный индикатор. `watchStage` (MutationObserver) гасится на всех трёх путях createMusic: успех pollJob (studio.js:767), catch автолирики (studio.js:715), общий catch (studio.js:793). `waitRow`-секундомер чистится через `stop()` на всех путях (studio.js:425; вызовы wait.stop() в успехе и обоих catch createMusic/createPhoto). `libPump` декрементит `libActive` через `.finally` — очередь не залипает при исключении (studio.js:1259-1264). Оба IntersectionObserver (addTrackCover:1144, libMedia:1272) дисконнектятся при `!isConnected`. `blobCache`: logout ревокает все URL и чистит blobTypes (studio.js:966), удаление карточки ревокает свой URL (studio.js:1222); objectURL обложек ревокается в onload/onerror (studio.js:1135-1141).
2. **Гонки.** `chatActive` ставится синхронно до первого await, гасится в finally; send в чате блокируется при активном ходе (тест 11). `improving` Set — по одному улучшению на поле; поздний ответ не перезатирает правки пользователя (тест «late improvement preserves newer edits»). `libSeq` guard сохранён. `createMusic` снапшотит advanced/quality/instrumental до автолирики (studio.js:683-687) — тест подтверждает. `currentUser()` guard стоит во всех асинхронных колбэках очередей/библиотеки: addTrackCover (3 точки), libMedia, download/fav/del хендлеры. `logout`/`newChat` блокированы при `runningOps > 0`; chat/медиа/improve все считаются через setBusy — смена профиля посреди операции невозможна (тест «active session cannot leak»).
3. **Святые зоны.** `[hidden] { display: none !important; }` на месте (studio.css:7). Hex-цвета — только в комментарии (строка 2) и внутри `:root` (строки 10–32); вне токенов новых цветов нет. rgba() вне :root — 4 места (108, 147/178, 225 box-shadow) — все унаследованы от f0045cc, **арена не добавила ни одного**.
4. **Решение владельца (duration).** `grep duration studio/studio.js` — **0 совпадений** вообще (ни params, ни комментариев). Тест явно ассертит `params.duration === undefined` (check-studio.cjs, блок «music snapshot»). Правило соблюдено.
5. **audio.controlsList='nodownload'** — на всех трёх аудио-узлах (studio.js:257, 773, 1300); `createElement('audio')` ровно 3.
6. **Регрессии против f0045cc.** renderLibrary merge (server+local по job id, favorites/file/cover переносятся в локальную запись) сохранён и покрыт тестом «merged library…». fileBlob 429-retry (1с/2с/4с) сохранён (studio.js:802) и покрыт тестом `coverRateLimit`. feedRestore работает, медиа дозагружается, cover из feedLog (studio.js:260). autolyrics 150s timeout через `AbortSignal.any([outerSignal, AbortSignal.timeout(150000)])` сохранён (studio.js:672). Null-controller/`local.signal` путь не тронут. Статусы `error/failed/cancelled/expired` в pollJob дополнены `error` — это фикс, не регресс.
7. **Мобильный CSS.** studio-header и media 480px/(max-height:600px) не трогают desktop-вид вне своих брейнпоинтов; печать в studio.css не задействована. `overscroll-behavior: contain` и `dvh` — см. минор M3 ниже (риск деградации, не блокер).
8. **check-studio.cjs.** Старые ассерты не ослаблены: duration-ассерт усилен (явный `undefined`), check прогресса переведён на новый формат метки, мобильный замер стал строже (Math.max→Math.min: обе размерности ≥44). Новые 9 проверок (контекст после reload, черновики, снапшот, merge-библиотека, favourite-fail, поздний improve, logout-guard, очередь ≤2, 320x568) — все добавляют покрытие.

## Находки

### Мажор — нет.

### Минор

**M1. feedRestore: колбэк fileBlob без guard'ов и без учёта objectURL в blobCache.** studio.js:246–268. `fileBlob(d.file).then(blob => …)` не проверяет `currentUser()`/`slot.isConnected` и создаёт objectURL мимо blobCache. Воспроизводимый риск: открыть студию с большой лентой и сразу выйти (logout не блокируется — restore не считается в runningOps): URL создастся для отцепленного узла и не будет ревокнут до перезагрузки страницы (утечка памяти на пару мегабайт на медиа). Приложение к отцепленному узлу — безвредно, чужому пользователю не показывается. Функциональной поломки нет — только гигиена.

**M2. addTrackCover: fallback `await serverJobs()` на карточку без cover.** studio.js:1127. Если у feed-записи нет cover (старые записи, созданные до поля `cover`), каждая карточка ленты делает полный `GET /jobs?limit=100` через общую очередь. Воспроизводимый риск: лента из 80 старых музыкальных карточек (FEED_MAX=80) — до 80 серверных запросов последовательно по 2 воркера при каждом restore. Новые записи cover хранят, так что риск затухает со временем. Можно кешировать результат одного serverJobs() на прогон.

**M3. `dvh`-единицы: деградация на старых браузерах (осознанный риск, по ТЗ — не блокер).** studio.css:225 `max-height: min(60dvh, 360px)` и в media 480px `max-height: 38dvh`. Браузер без dvh выбрасывает всё объявление (min() с неизвестной единицей невалидна целиком) → меню без потолка высоты / advanced без скролл-ограничения. На целевых современных браузерах ок.

**M4. createChat: потеря текста при ошибке, если prompt уже непуст.** studio.js:~599. Ветка ошибки: `if (mode === 'chat' && !els.prompt.value.trim()) els.prompt.value = text; else if (mode !== 'chat' …)` — если пользователь успел набрать новый черновик в chat во время стрима, упавший ход теряется безвозвратно (ни в prompt, ни в drafts.chat). Крайний UX-случай, данные — один ход переписки.

**M5. Факт для координатора по канону (не регресс этого PR): захардкоженные rgba вне :root.** studio.css:108 (`.prompt::placeholder rgba(242,242,240,.35)`), 147/178 (amber-hover), 225 (box-shadow rgba(0,0,0,.5)). Все существовали до PR #96. Правило 5 говорит про «зашитые цвета»; тени исторически считаются допустимыми, но placeholder и rgba-подложки hover — формально цвета вне токенов (при этом ведут себя приемлемо в обеих темах, т.к. поверх тёмного канваса). Вынести отдельным вопросом владельцу/координатору, трогать в этом PR не требую.

## Что осталось непроверенным (честно)

- Живой стенд (demo.briix.ru / реальный BFF) не трогался — все прогоны на mock-BFF из check-studio.cjs. Поведение с реальными 429/медленной шиной — по тестам, не вживую.
- Реальные iOS/Safari-устройства и старые браузеры: mobile-часть проверена Playwright-вьюпортами 320x568/390x844, не реальным тач-устройством ( overscroll/autofill/safe-area вживую не видел).
- Полл 40 минут и 150-секундный таймаут автолирики по времени не ждались — проверено чтением кода и мок-путями.
- Печать studio (CSS print) — вне диффа, не проверялась.
- Мультипользовательская гонка «два таба один ник» не моделировалась.
