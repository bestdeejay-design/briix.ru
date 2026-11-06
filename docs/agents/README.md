# docs/agents/ — рабочий канон команды в briix (снимок хаба)

> Это **снимок канона** `bestdeejay-design/agents`, принятый в briix по
> [docs/ADOPTION.md хаба](https://github.com/bestdeejay-design/agents/blob/main/docs/ADOPTION.md)
> с проектной конкретизацией. Проектный слой briix — корневой [AGENTS.md](../../AGENTS.md);
> его правила сохранены и не перекрываются этим каталогом.

## Версия и источник (ADOPTION §2)

| Поле | Значение |
|---|---|
| Источник | `bestdeejay-design/agents` (хаб канона), ветка `main` |
| Версия канона | вариант C (утверждён владельцем 03.11.2026) + Workflow v2 (ADR-0002 от 06.11.2026) |
| Коммит снимка | `f793de3ecb69eb3e7d7bb973290ffb9e949567e4` (f793de3) |
| Дата внедрения | 07.11.2026 |
| Внедрил | arena-сессия briix (координатор/PM по делегированию владельца от 07.11.2026 — [decisions/2026-11-07-owner-role-delegation.md](decisions/2026-11-07-owner-role-delegation.md)) |
| Порядок обновления | при обновлении — сверить закреплённый коммит с текущим `main` хаба, различия и локальные правки сравнить явно (ADOPTION §4); истина при расхождении — в хабе |

## Состав снимка и порядок чтения (холодный старт)

1. [PROTOCOL.md](PROTOCOL.md) — общие правила: роли, границы, коммуникация, верифицированный вывод.
2. Свой регламент: [AGENT_RULES.md](AGENT_RULES.md) — исполнитель · [COORDINATOR_RULES.md](COORDINATOR_RULES.md) — координатор.
3. [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) — шпаргалка: labels, state-машины, маркеры сигналов.
4. [BRIIX-PROJECT.md](BRIIX-PROJECT.md) — **проектная конкретизация**: роли в briix, уровни окружений, регресс, размеры, форма поставки. Читается после регламентов, до первой правки.
5. [decisions/](decisions/) — проектные решения по внедрению канона в briix.

## Карта ссылок (ADOPTION §2: «адаптируй ссылки и проверь их»)

Файлы снимка скопированы дословно; ссылки внутри делятся на три класса:

- **Резолвятся локально** — ссылки между четырьмя регламентами (`./AGENT_RULES.md`, `./COORDINATOR_RULES.md`, `./KNOWLEDGE_BASE.md`) и на этот README.
- **Ссылки в хаб** (не резолвятся в briix: `../agents/*`, `../skills/*`, `scripts/*`, `./STATUS.md`, `./EXAMPLES.md`, `./PROJECTS-BLUEPRINT.md`, `./create-labels.sh`, `./docs/EVIDENCE_RESEARCH.md` и т.п.) — читать в клоне хаба (`~/Projects/agents`) или по базе `https://github.com/bestdeejay-design/agents/blob/main/...`. Это норма снимка, а не поломка: раскладка хаба в briix не копировалась.
- **Исправлены адресно** (вели бы на неверный локальный файл): в шапках трёх регламентов `(./README.md)` и в COORDINATOR_RULES §3.1 `(../agents/README.md)` заменены на абсолютные URL хаба. Полный список — в отчёте внедрения `audits/task-canon-adoption-2026-11-07.md`.

## Статус внедрения (честно, по COORDINATOR_RULES §12)

| Уровень лестницы принуждения | Статус в briix |
|---|---|
| 0. Текст (регламенты) | ✅ установлен (этот каталог + вход в корневом AGENTS.md) |
| 1. Протокол (labels + маркеры) | ⚠️ частично: issues briix уже ведут словарём варианта C (`status:*`, `size:*`, `phase:*`, `to:*`, `agent:*`, `priority:*`); полный набор ядра и скрипт `create-labels.sh` не развёрнуты |
| 1.5. CI/Actions (preflight, guard-main, bus-hygiene) | ❌ не установлен — задача [infra#36](https://github.com/bestdeejay-design/infra/issues/36) |
| 2. Ветка (ruleset: ревью не-автором, dismiss stale approvals) | ❌ не установлен — задача [infra#36](https://github.com/bestdeejay-design/infra/issues/36) |
| 3. Окружение (production-гейт) | ❌ не установлен; production = push в `main` → авто-деплой GitHub Pages |

До включения уровня 2 честный статус briix — **«гейты на дисциплине»** (COORDINATOR_RULES §12);
в сводках называть именно так.

## Известные несовместимости внедрения (ADOPTION §1.3)

1. **Правило 5 briix («docs/ — канон продукта, только читай») vs раскладка ADOPTION (регламенты в docs/).**
   Разрешено владельцем 07.11.2026: каталог `docs/agents/` — процессный слой, канон продукта
   (`docs/BRIIX.md` и соседние файлы) не тронут и остаётся read-only.
2. **briix AGENTS.md (~180 строк) ≠ лимит хаба ≤60 строк.** Сохранён как проектный слой
   (ADOPTION §2: «согласованно объедини их, сохранив проектные требования»); канонический
   вход добавлен секцией, файл не сжимался.
3. **Форма поставки.** Письмо о поставке в briix — файл в `audits/` (Правило 3 briix),
   это проектная форма `📬 DELIVERED`; узел без записи в issues ретранслирует координатор.
4. **Пушки в main = деплой.** main briix = production (GitHub Pages, авто-билд). Пока
   правила ветки уровня 2 не включены, прямой пуш в main — легальный, но беззащитный
   канал: задача на защиту передана в INFRA.
