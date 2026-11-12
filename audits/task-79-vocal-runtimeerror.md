# task-79 — RuntimeError воркера vocal (ace-step-flash), стенд fonotext-stand A

Дата: 13.11.2026. Исполнитель: executor-саб (координатор briix). Issue: bestdeejay-design/infra#79.

## Что сделано

1. Воспроизведено: POST /jobs type=music params.model=ace-step-flash, lyrics "[Verse]\nтест\n[Chorus]\nпроверка", duration 10 → `{"status":"error","error":"Ошибка воркера (RuntimeError).","stages":["writing-lyrics"]}` — воспроизвёл через лог (3 идентичных падения, последнее 02:20:13 13.11, job-1923f661a5f55152).
2. Причина по логу bff (полный «traceback» воркера — stderr этапа, bff пишет хвост 300 байт в `logs/bff.log`):

   ```
   vocal stage writing-lyrics failed rc=255: ssh: connect to host 10.10.0.98 port 22: No route to host
   failed job-...: RuntimeError
   ```

   rc=255 — это код самого ssh, до запуска ace-lm дело не дошло.
3. Диагноз: юнит media-bff (`~/.config/systemd/user/media-bff.service.d/hardening.conf`) держал `Environment=MUSIC_BACKEND=gpu-b` — vocal-пайплайн исполнялся по ssh на GPU-стенде B (badai@10.10.0.98). Хост B мёртв: ping 10.10.0.98 — 100% packet loss, `ssh badai@10.10.0.98` — «No route to host». GPU-окно по комментарию в bff.py — «до 10:00 МСК» (решение владельца 08.11); деградация наступила после выключения стенда B, не после чистки 09.11. Локальный (cpu-a) путь на A цел: `acestep/acestep.cpp/build/ace-lm|ace-synth` исполнимы, все GGUF в `acestep/acestep.cpp/models/` на месте (1.7B-Q8_0 flash, 4B-Q8_0 pro, turbo synth, vae).
4. Фикс: в дроп-ине юнита `MUSIC_BACKEND=gpu-b` → `cpu-a`; бэкапы: `hardening.conf.bak-20261113` и (создан по ошибке, безвреден) `media-bff.service.bak-20261113`. Затем `systemctl --user daemon-reload && systemctl --user restart media-bff`; юнит active, env подтверждён: `MUSIC_BACKEND=cpu-a THREAD_BUDGET=8 TEXT_BUDGET=4`. Docker/xray/fonotext не трогал, токены в отчёт не выносились (брали из `.env` на стенде, использовали только в curl на стенде).

## Верификация — 3 прогона подряд (flash, duration 10, с самого стенда A)

1. job-b30d60c4609cbb8e — status **ready**, wall 291111 ms, result_url `/files/job-b30d60c4609cbb8e`, mime audio/mp4, size 695208, checksum 996a06d4…
2. job-5abf3bf2216c5e87 — status **ready**, wall 284509 ms, result_url `/files/job-5abf3bf2216c5e87`, mime audio/mp4, size 568384, checksum 56fff544…
3. job-5087d1c04ea9c1d6 — status **ready**, wall 286661 ms, result_url `/files/job-5087d1c04ea9c1d6`, mime audio/mp4, size 770305; файл скачан с bff: HTTP 200, `file` → «ISO Media, … AAC-LC (.M4A)».

Стадии честные: writing-lyrics → synthesizing → album-cover. В bff.log после фикса новых «vocal stage failed» нет.

## Откат

`cp hardening.conf.bak-20261113 hardening.conf && systemctl --user daemon-reload && systemctl --user restart media-bff` (вернёт gpu-b; осмысленно только когда стенд B снова поднят).

## Непроверенное / вне зоны

- ace-step-pro на cpu-a не прогонял (4B на CPU заметно дольше; путь идентичен flash).
- CPU wall ~285–291 c на 10-сек трек — медленнее упомянутых в задании ~111 c (вероятно, та цифра была для другого профиля/этапа; на результат не влияет).
- GPU-стенд B (10.10.0.98) — вне зоны: не проверял, почему недоступен (выключен по расписанию GPU-окна или упал). Рецепт для владельца: поднять B → вернуть `MUSIC_BACKEND=gpu-b` в дроп-ин + daemon-reload + restart, тогда wall вернётся к ~30 c.
- Аудио-содержимое треков на слух не оценивал (проверены только статус/формат/размер/контент-type).
