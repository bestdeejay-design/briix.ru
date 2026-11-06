# Публичный API: начальный контракт

**Статус:** проект контракта, не OpenAPI-файл. До реализации превратить в OpenAPI 3.1 schema и contract tests. «OpenAI-совместимый» означает только явно перечисленный набор поведения.

## 1. Базовые параметры

- Base URL: TBD (публичный домен не выбран).
- Versioning: `/v1` для совместимых endpoints; изменения только обратно совместимые либо через новую версию.
- Auth: `Authorization: Bearer <platform_api_key>`.
- Content type: JSON; UTF-8.
- Request ID: сервер добавляет/возвращает безопасный `x-request-id`.
- Не размещать ключи в URL или query parameters.

## 2. `GET /v1/models`

Возвращает только модели, доступные текущему ключу/workspace. Минимальный объект: `id`, `object`, `created` (если поддерживается контрактом), `owned_by` или provider attribution согласно политике. Дополнительные capabilities публиковать в документации/extension без нарушения клиентов, которые ожидают базовый формат.

Не раскрывать внутренние адреса, secret references, приватные route IDs или модели, выключенные администратором.

## 3. `POST /v1/chat/completions`

Поддерживаемый MVP request: `model`, `messages`, `stream`, `temperature`, `top_p`, `max_tokens`/выбранное имя лимита. Точный список и диапазоны должны быть описаны в OpenAPI и проверены по адаптерам. Невалидный или неподдерживаемый параметр не должен молча игнорироваться без документированного решения.

Response для non-stream: OpenAI-подобные `id`, `object`, `created`, `model`, `choices`, `usage`. `model` отражает фактически обслужившую публичную модель; при наличии отдельного route metadata расширение документируется. `usage` содержит источник подсчёта; estimated usage нельзя представлять как точный provider usage.

Streaming: SSE, документированные chunk-объекты и финальное завершение; проверить disconnect/cancel, backend error посреди потока, heartbeat/timeout и корректное закрытие соединения.

## 4. Ошибки

Единый JSON error envelope и устойчивые категории: invalid_request, authentication_error, permission_error, rate_limit_error, insufficient_quota, model_not_found/unavailable, upstream_timeout, internal_error. В ответе не раскрывать upstream secrets, tracebacks, внутренний hostname, stack или пользовательские данные. Ошибка включает безопасный request ID.

HTTP-коды, retryability и retry-after семантику зафиксировать в OpenAPI. Автоматический retry клиентом может привести к повторной генерации/начислению; описать безопасные правила. Определить поддержку `Idempotency-Key` до включения повторов.

## 5. Матрица совместимости

Для каждой пары adapter/model вести тестируемую матрицу:

| Возможность | Статус |
|---|---|
| basic chat messages | TBD |
| streaming SSE | TBD |
| system/developer roles | TBD |
| temperature/top_p | TBD |
| max output tokens | TBD |
| tool/function calls | TBD; MVP может не поддерживать |
| JSON/structured output | TBD; MVP может не поддерживать |
| usage fields | exact / estimated / unavailable |
| cancellation | TBD |

Публиковать ограничения по модели; не обещать глобальную поддержку функции, пока все модели/адаптеры её не реализуют.

## 6. Минимальный набор contract tests

- Auth success, missing/revoked/invalid key, cross-tenant denial.
- Models list filtered by workspace.
- Valid/invalid request; unknown/unavailable model.
- Non-stream response schema and usage source.
- SSE chunk ordering, final marker, client disconnect.
- Rate limit/quotas and safe `Retry-After`.
- Adapter timeout, malformed upstream response, backend unavailable.
- Request IDs and sensitive data redaction.
- Billing idempotency and behavior on partial stream/error.
- SDK compatibility smoke test for selected versions (версии TBD).
