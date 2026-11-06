# Стартовый набор прототипа AI-платформы — спека

**Статус:** утверждена координатором этапа, 2026-11-06. Основа: [AUDIT](./AUDIT-2026-11-06.md), доки [ai-platform-docs/](../ai-platform-docs/).

## 0. Определение прототипа

Прототип = **работающий вертикальный срез MVP на детерминированном mock-адаптере**, без реального inference. Цель: за один конвейер получить систему, где разработчик проходит путь «регистрация → workspace → ключ → запрос → usage» и код не выбрасывается — модули переносятся в продакшн-фазу как есть.

## 1. Форма и стек

- **Монорепозиторий** `bestdeejay-design/ai-platform` (создаётся первой задачей этапа), из этого репо ведутся только спеки/аудиты/доки.
- **Backend:** Node.js + TypeScript strict (конвенции из BRIIX-канона применимы: `no any` без причины, RFC 7807 — здесь свой error envelope из API.md §4). Framework — любой лёгкий (Fastify/Hono), выбирает исполнитель в CONCLUSION.
- **Frontend:** статический лендинг + кабинет (по UX.md §3–4: auth, overview, models, playground, projects, keys, usage).
- **БД:** SQLite/PostgreSQL — на выбор исполнителя; схема по сущностям ARCHITECTURE §4 (минимум: User, Session, Workspace, Membership, Project, ApiKey, Model, UsageEvent).
- **Прогон:** docker compose поднимает всё одной командой; seed: 1 mock-модель в каталоге.
- **Тесты:** contract tests из API.md §6 (минимальный набор) + smoke «запрос через mock-адаптер пишет UsageEvent».

## 2. Границы прототипа (реализуем)

1. Auth: email+пароль, Argon2id, email-верификация заглушкой SMTP (код в лог), сессии cookies HttpOnly/Secure/SameSite, logout/revoke (AUTH_SECURITY §2).
2. Workspace/Project/Membership + роли workspace_owner/developer (AUTH_SECURITY §3, deny-by-default).
3. ApiKey: выпуск (показ один раз), hash+prefix в БД, revoke, привязка к project, rate limit простой (AUTH_SECURITY §4).
4. Каталог моделей: 1 mock-модель + поле цены с source=manual (R4 аудита).
5. API: `GET /v1/models`, `POST /v1/chat/completions` (non-stream + SSE при поддержке адаптера), error envelope 9 категорий, `x-request-id`, опциональный `Idempotency-Key` (R3).
6. Mock-адаптер: детерминированный (фиксированный ответ на фиксированный вход), latency/токены считаем по правилам из API.md (usage source=estimated).
7. Playground-страница: запрос с редактированием параметров, секреты не рендерятся повторно (PRODUCT §4).
8. Usage: таблица событий (дата, project, model, статус, длительность, токены, стоимость-оценка) + страница `/app/usage` (UX §4).
9. Лендинг: продукт, quickstart, статус — по UX.md §2, без обещаний вне §3 PRODUCT.
10. Админ-минимум: включение/выключение модели, просмотр usage и ошибок (PRODUCT §4).

## 3. Вне прототипа (не реализуем, только hooks)

Веб-чат, реальный inference (ЦОД/Yandex Cloud), автобиллинг, BYOK, RAG, команды агентов, SLA/статус-страница прод-уровня.

## 4. Критерии приёмки прототипа

- `docker compose up` → система работает; quickstart из лендинга выполняется копипастой без правок.
- Curl-пример из доков: запрос с ключом → валидный OpenAI-совместимый ответ + запись в usage.
- Ключ отзывается → следующий запрос = `authentication_error`.
- Contract tests зелёные; приватные секреты и upstream-адреса не всплывают в ответах/логах (grep-проверка).
- Тексты интерфейса не обещают того, чего нет в MVP (сверка с PRODUCT §3).
