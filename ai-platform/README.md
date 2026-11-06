# AI-платформа — этап конвейера (WORKFLOW ступени 3–6)

Штаб этапа — этот репозиторий (`bestdeejay-design/briix.ru`). Исходные доки арены — [ai-platform-docs/](../ai-platform-docs/) (черновик от 05.11.2026, не утверждён).

## Артефакты этапа

| Файл | Что |
|---|---|
| [AUDIT-2026-11-06.md](./AUDIT-2026-11-06.md) | перекрёстный аудит доков: противоречия, пробелы, топ-TBD |
| [SPEC-STARTER-KIT.md](./SPEC-STARTER-KIT.md) | спека стартового набора прототипа |
| [DECISIONS.md](./DECISIONS.md) | журнал решений этапа |

## Порядок работы

Задачи — issues этого репозитория с label `status:ready`, `size:S/M/L`, `area:*`. Цикл ARCA: READ → CONCLUSION → GATE → ACTION → DONE. Основной док-канон — `ai-platform-docs/`, правки продуктовых решений — через `ai-platform/DECISIONS.md` + PR в доки.

## Принцип из доков, который соблюдаем строго

Не переписывать существующий шлюз до аудита; TBD не считаются решениями; не выдумывать модели, тарифы и SLA (CURRENT_STATE.md, README доков).
