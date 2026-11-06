# Задача: локальная Медиа-студия и аудит демо BRIIX

**Дата:** 06.11.2026; завершение и финальные проверки — 07.11.2026.  
**Ветка:** `arena/135ab064-briix-ru`, база `ec16a5a`.  
**Статус:** реализовано и проверено; готово к сохранению в ветке.  
**Главное ограничение:** это локальный мок, не подключённая нейросеть и не облачный сервис.

## 1. Что сделано

### Медиа-студия

- Новый маршрут `#/media` и пункт навигации «Медиа-студия».
- Вкладки: создание, медиатека, очередь, модели и рецепты.
- Фото/видео-сценарии, 5 рецептов, 9 моделей в справочном каталоге без подключения.
- Бриф 12–1500 символов, форматы 1:1, 4:5, 16:9, 9:16; для видео — 16:9/9:16.
- Локальная очередь: queued/running/ready/error/cancelled; восстановление running после reload.
- Лимиты: 6 активных заданий, 40 записей истории; favorites и активные защищены от вытеснения.
- Референсы пользователя: до 3 PNG/JPEG/WebP по 10 MB, только метаданные.
- Медиатека: поиск, фильтры, избранное, повтор брифа, удаление с подтверждением, JSON-экспорт.
- Скачивание: фото — canvas center-crop выбранного формата; видео — готовый MP4, WebM fallback.
- Явная маркировка «Локальный мок, не нейросеть» и объяснение происхождения видео.

### Ассеты и сборка

- `assets/media/`: 3 JPEG, 6 MP4 H.264, 6 WebM VP9, `manifest.json`.
- Видео: 5 секунд, 24 fps, 120 кадров, без звука; landscape 1280×720 и portrait 720×1280.
- `tools/build-media-assets.py`: детерминированная сборка, `--check`, SHA-256, codec/fps/frames/audio, версии инструментов.
- Повторная сборка не изменила 15 хэшей; общий размер около 1.94 MiB.

### Исправления демо и CSS

- Импорт/экспорт, повреждённый storage, черновики, cross-tab guard, pending-send, stream holder, modal focus, skip link, theme route, settings focus.
- Лимит вариантов ответа при `regenerate`.
- Контраст faint/warning/code-head/media-label; scoped reduced-motion; print/hover/focus polish.
- Видео больше не раздувает grid track: absolute positioning и object-fit contain; detail modal не меняет геометрию после play.

### Отчёты

- `2026-11-06-media-hub-research.md` — рынок хабов/провайдеров, бесплатный вход, лицензии, РФ-контур, хранение.
- `2026-11-06-free-mock-guide.md` — как бесплатно собрать и проверить мок.
- `2026-11-06-demo-code-css-audit.md` — находки, исправления, результаты и остаточные ограничения.
- `evidence/` — JSON-доказательства browser/CSS проверок.

## 2. Критерии приёмки и результат

| Критерий | Результат |
|---|---|
| Статический сайт без runtime-зависимостей и внешних запросов | Выполнено: browser harness зафиксировал 0 external requests; runtime network scan чист |
| Фото/видео-мок работает локально | Выполнено: 25 media PASS, 12 видео metadata OK, скачивание и fallback проверены |
| Очередь, медиатека, ошибки, отмена, reload | Выполнено: media regression |
| Доступность и адаптивность | Выполнено в Chromium: axe 0 на demo routes light/dark, media tabs 390/1440, visual dark/mobile |
| Видео не обрезается и не ломает layout | Выполнено: video ≤ frame на desktop/mobile; modal geometry stable |
| Код/CSS проверены | Выполнено: syntax OK, demo/tools ESLint 0, CSS parse 0; site lint findings зафиксированы отдельно |
| Ассеты воспроизводимы и проверены | Выполнено: build --check OK, 15 SHA-256 unchanged при повторной сборке |
| Русскоязычные отчёты | Выполнено: 4 отчёта + evidence |

## 3. Как запустить и проверить

```bash
python3 -m http.server 3000 --bind 0.0.0.0
# открыть /#/media

export BRIIX_URL=http://127.0.0.1:3000
export NODE_PATH=/tmp/briix-tools/node_modules
export BRIIX_CHROMIUM=/tmp/chromium

node tools/check-demo.cjs          # 19 PASS
node tools/check-media.cjs         # 25 PASS
node tools/check-media-visual.cjs  # 12 assets + geometry + axe

PYTHONPATH=/tmp/briix-py python3 tools/build-media-assets.py --check --ffmpeg /path/to/ffmpeg
```

## 4. Что не входит в задачу

- Реальная генерация, API-ключи, биллинг, аккаунты и серверная очередь.
- Юридическая очистка прав на сторонние модели/исходники.
- Полноценная multi-tab синхронизация медиа и долговечное хранилище.
- Ручные прогоны Safari/Firefox/реальных устройств/assistive tech.
- Исправление read-only находок `site/assets/js/theme.js` и `landing.js`.

## 5. Следующий разумный шаг

Оставить мок как проверяемый UX-контракт. Перед реальным подключением выбрать 1–2 провайдера из исследования, сделать серверный адаптер с бюджетом и хранением, затем заменить локальные таймеры на реальные статусы, не меняя пользовательский сценарий.
