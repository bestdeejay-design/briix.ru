# Задача 18 (follow-up): замена устаревшей записи Veo в каталоге медиа-студии

**Дата:** 08.11.2026.  
**Ветка:** `arena/c4627ee7-briix-ru`, база `c71bca0` (`origin/main` влит перед правкой).  
**Основание:** пункт 3.1 файла `audits/2026-11-07-arena-handoff-media-hub.md`.  
**Область:** только справочная карточка Google в `media.js`; реальное подключение моделей не выполнялось.

## 1. Что сделано

- В справочном каталоге `Veo 3.1` заменён на **Gemini Omni Flash**.
- Указан актуальный стабильный ID `gemini-omni-1.2-flash` и маршрут через Gemini API / Interactions API.
- В карточку добавлены подтверждённые документацией возможности: видео 3–15 секунд с нативным звуком, диалоговое редактирование и референсы.
- Явно зафиксировано отключение Veo 3.1 Preview **22.10.2026**, чтобы старая запись не выглядела доступным маршрутом интеграции.
- Ссылка карточки заменена на актуальную первичную документацию Gemini Omni Flash.
- Формулировка даты сверки каталога обновлена на 6–8 ноября 2026 года.
- Количество моделей не менялось: остаётся **9**, из них **5 видео-моделей**. Добавление Kandinsky — следующий отдельный пункт handoff.

## 2. Первичные источники

Проверены 08.11.2026:

1. [Video generation in the Gemini API](https://aistudio.google.com/docs/video): Veo 3.1 Preview отключён 22.10.2026; рекомендован Gemini Omni Flash `gemini-omni-1.2-flash`.
2. [Gemini Omni Flash — model card](https://aistudio.google.com/docs/models/gemini-omni-flash): стабильный ID, входы/выходы, видео 3–15 с, 24 FPS, разрешения до 4K и Interactions API.

В интерфейс добавлена только вторая ссылка — непосредственно на карточку актуальной модели.

## 3. Проверки

- `git merge-base --is-ancestor origin/main HEAD` — свежий `main` находится в базе ветки.
- `node --check media.js demo.js demo-data.js site/assets/js/landing.js site/assets/js/theme.js` — синтаксис OK.
- `git diff --check` — OK; маркеров конфликтов нет.
- Статические assertions: 9 записей каталога, присутствуют Gemini Omni Flash и `gemini-omni-1.2-flash`, отдельной карточки Veo 3.1 и старой ссылки `docs/veo` нет.
- `tools/check-media.cjs` — **25 PASS**: создание/скачивание фото и видео, WebM fallback, медиатека, очередь, storage, клавиатура, фокус, responsive и axe.
- Axe: нарушений нет на вкладках create/library/queue/models/showcase при ширине 390 и 1440 px.
- Отдельный browser-сценарий: 9 карточек в общем фильтре, 5 в видео; Gemini Omni Flash присутствует, старая карточка Veo отсутствует, ссылка и текст соответствуют источнику.
- Browser errors: `[]`; внешние requests: `[]`. Скриншот карточки визуально проверен на 1440 px.

Evidence:

- `audits/evidence/2026-11-08-veo-omni-media-regression.json` — полный результат 25 проверок.
- `audits/evidence/2026-11-08-veo-omni-catalog.json` — целевые assertions каталога.

## 4. Файлы

- `media.js` — актуализированы карточка Google и дата сверки.
- `audits/task-18-veo-omni.md` — этот отчёт.
- `audits/evidence/2026-11-08-veo-omni-media-regression.json` — browser regression evidence.
- `audits/evidence/2026-11-08-veo-omni-catalog.json` — целевое browser evidence.

## 5. Что осталось непроверенным / вне области

- Реальные API-вызовы, доступность ключа, оплата, региональные ограничения, фактическое качество и задержка Gemini Omni Flash не проверялись. Каталог остаётся справочной витриной без нового подключения.
- Автоматические браузерные проверки выполнены только в Chromium; Safari, Firefox, реальные устройства и assistive technology не прогонялись.
- Остальные восемь записей каталога в этой задаче заново не сверялись; исторический отчёт от 06.11 не переписывался.
- Пункты handoff про Kandinsky 5.0, пустой видеокадр, CSP, воспроизводимость исходников и переход каталога 9 → 10 не выполнялись и остаются отдельными задачами.
