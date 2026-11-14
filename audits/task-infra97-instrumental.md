# Отчёт: infra#97 — починен инструментал из студии (POST /jobs music: model+instrumental=true больше не 400)

Дата: 14.11.2026. Стенд: fonotext-stand A (ssh fonotext-stand, юзер badai). Бранч: `fix/instrumental-97`.

## Что было сломано

POST `{type:music, params:{model:"ace-step-flash", instrumental:true}}` → 400
«params.lyrics обязателен для vocal» — режим «🎼 Инструментал» UI demo.briix.ru/studio/
не работал вообще (клиент студии всегда шлёт `params.model`).

**Корень регресса (одной строкой):** серверная валидация никогда не смотрела на
`params.instrumental` — vocal-маршрут выбирался только по факту наличия
`params.model` в VOCAL_MODELS, поэтому любая инструментал-заявка с явной моделью
падала в vocal-ветку с требованием lyrics.

## Когда сломалось (по bak-ам)

- Диффы `bff.py.bak-20261108` → `bak-112215` (09.11) → `bak-20261113` → текущий:
  **блок валидации POST /jobs не менялся ни в одном из них** (grep по
  vocal_model/instrumental/lyrics — пусто; правки 13.11 — только библиотека
  infra#77: list/delete/favorite/cover, плюс `deleted`-фильтры).
- Т.е. вокальная валидация «model ⇒ lyrics обязателен» живёт без изменений с 08.11
  (введение vocal-route, «решение владельца 08.11»). «Раньше 13.11 работало» —
  потому что клиент студии тогда не слал `model` в инструментал-режиме; сломалось
  на клиенте (studio.js начал слать model всегда), а серверного флага `instrumental`
  не существовало вовсе. Чинили по контракту issue — на сервере.

## Суть фикса (bff.py, 3 места)

1. `create_job` (~452): 
   `instrumental = params.get("instrumental") is True` → vocal-ветка выбирается
   только если `not instrumental`. Если при этом `model` валидный vocal — не 400,
   а `warning` в записи джобы: «params.model=... проигнорирован: instrumental=true
   маршрутизируется в MusicGen.». Невалидный model при instrumental тоже не 400
   (не проходит в vocal-ветку).
2. `executor` (~1170): `is_vocal` учитывает `not params.instrumental` — иначе джоба
   реально исполнялась бы vocal-воркером.
3. `get_job` (~549): `warning` отдаётся в ответе джобы.

Вокальная валидация не ослаблена: `model` без instrumental по-прежнему требует
lyrics (smoke b), язык/duration/бинарники — без изменений.

## Развёртывание

- Бэкап: `/home/badai/briix-media/media-bff/bff.py.bak-20261114-instr` (до правки).
- Правка залита scp, `python3 ast.parse` — ok, `systemctl --user restart media-bff`
  — unit active. MUSIC_BACKEND и юнит-конфиги не трогались.

## Смоук-гейт (токен из .env, в отчёт не включён)

- **(a) instrumental+model:** POST `{model:"ace-step-flash", instrumental:true}` →
  **202** `job-34af7f924f207669`; poll до **ready** за ~10.5 мин (queued 327 c —
  heavy-budget, генерация 304 c; MusicGen CPU). Готовый джоб:
  `provenance.model=musicgen-small`, `capability=instrumental`, `result_url` mp4
  (594 KB, checksum), **`warning` присутствует** (model проигнорирован).
- **(b) vocal жив:** POST `{model:"ace-step-flash", lyrics:"[Verse]..."}` → 202,
  через 8 c — **running**, `provenance.model=ace-step-flash`,
  `capability=song.vocal`; джоба отменена DELETE (мягкое удаление), CPU не жгли.
- **(c) /health:** `{"ok":true, backends:{image,music,text}:"ready"}`.

## Что осталось непроверенным

- Реальный UI-режим «Инструментал» в demo.briix.ru/studio/ в браузере не прогонялся
  (UI-файлы вне скоопа) — проверен контракт API curl'ом; клиент шлёт тот же payload.
- Готовый mp4 (smoke a) на слух не слушался — проверены размер/checksum/mime.
- `bak-112215`/`before-studio-*.bak` — даты чуть «косые» в ls (названия vs mtime);
  на вывод диффов это не влияет.
- Поведение `instrumental:true` с моделью, не входящей в VOCAL_MODELS (например
  опечатка) — сейчас молча игнорируется без warning (warning только для известных
  vocal-моделей); по контракту это допустимо, но можно ужесточить позже.

## Файлы

- Стенд A: `/home/badai/briix-media/media-bff/bff.py` (исправлен),
  `bff.py.bak-20261114-instr` (бэкап до правки).
- Репо briix: `tools/media-bff-config/bff.py` — свежий снимок (1 коммит с отчётом).
- PR: см. описание бранча `fix/instrumental-97` (не сливается — интеграция координатором).
