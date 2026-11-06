# PROJECT.md — AI Social Media Automation Platform
> Единый источник правды для агента-сборщика сервиса.
> Принцип продукта: **Paste a link → get content.**
> Версия: 1.0 · Статус: готов к реализации

---

## 0. КАК ЧИТАТЬ ЭТОТ ФАЙЛ (инструкция агенту-сборщику)

- Это спецификация MVP. Реализуй модули в порядке раздела `12. BUILD ORDER`.
- Для каждого модуля есть: требования (FR), модель данных, API-контракт, критерии приёмки (AC).
- Если требование неоднозначно — выбирай простейшую реализацию, НЕ блокируйся, помечай `// TODO: confirm`.
- Соблюдай раздел `3. ARCHITECTURE` и `4. TECH STACK`.
- ОБЯЗАТЕЛЬНО реализуй абстрактный слой `AIProvider` (раздел 9) — через него идут ВСЕ вызовы моделей.
- Пиши тесты к каждому модулю (раздел `11. TESTING`).
- Не хардкодь ключи/токены — только из ENV/secret store.

---

## 1. ПРОДУКТ

**Что это:** SaaS, который по ссылке на сайт компании:
1. анализирует бренд (Brand DNA),
2. генерирует контент-план (50+ постов),
3. создаёт посты (текст + изображение) под 12 платформ,
4. публикует по расписанию (ручной режим / автопилот),
5. ведёт рекламу (FB/IG Ads),
6. собирает аналитику и дообучается на решениях approve/reject,
7. обрабатывает ответы/комментарии (inbox).

**ЦА (B2B, SMB без маркетолога):** подрядчики, застройщики, клиники, отели, тур-компании, проф. услуги, SaaS, e-commerce.

**Обязательные продуктовые свойства:**
- Онбординг ≤ 2 минуты.
- Превью контента показывается **до оплаты**.
- Подписка от **$79/мес**, отмена в любой момент.

---

## 2. SCOPE

### В MVP (строим сейчас)
- Brand DNA, контент-план, генерация текста+изображений, Designer, очередь одобрения, публикация (4 канала на старте), scheduler, биллинг Stripe, базовая аналитика.

### Пострелиз (НЕ в MVP, заложить расширяемость)
- Полные 12 каналов, Ads-модуль, inbox-ответы, локализация, мульти-бренд, fine-tune своей модели.

### Каналы MVP (приоритет)
1. Facebook Pages
2. Instagram (через FB Graph API)
3. LinkedIn
4. X (Twitter)
> TikTok и остальные — пострелиз.

---

## 3. ARCHITECTURE

```
Frontend SPA
   │ REST/JSON + WebSocket (realtime статусы генерации/публикации)
API Gateway / BFF
   ├── Brand Service       (краулинг, Brand DNA)
   ├── Content Service     (план, генерация текста/изображений)
   ├── Designer Service    (слои, удаление фона)
   ├── Publisher Service   (OAuth, scheduler, публикация)
   ├── Analytics Service   (метрики, feedback-loop)
   └── Billing Service     (Stripe)
Message Broker + Workers   (генерация, публикация — асинхронно)
Data: PostgreSQL · Vector DB · S3-совместимое хранилище · KMS/Secret store
External: AIProvider (LLM + Image + CV) · Social APIs · Stripe
```

**Принципы:**
- Все тяжёлые операции (генерация, публикация) — асинхронные, через очередь, с идемпотентностью и retry+backoff, dead-letter queue.
- Статусы долгих задач отдаются во фронт по WebSocket.
- Каждый сервис — отдельный модуль/package; на старте допускается монорепо + модульный монолит, разбиваемый на сервисы позже.

---

## 4. TECH STACK (рекомендация, можно заменить эквивалентом)

| Слой | Выбор | Примечание |
|------|-------|-----------|
| Backend | Node.js (NestJS) **или** Python (FastAPI) | выбрать один, не смешивать |
| Frontend | React + TypeScript + Vite | SPA |
| UI | Tailwind + компонентная библиотека | |
| Canvas/Designer | Fabric.js или Konva | послойный редактор |
| DB | PostgreSQL | основная |
| Vector DB | pgvector (в той же Postgres) | embeddings Brand DNA/контента |
| Очереди | BullMQ (Redis) или RabbitMQ | воркеры |
| Хранилище | S3-совместимое (AWS S3 / R2 / MinIO) | медиа |
| Секреты | AWS KMS / Vault / зашифрованные ENV | OAuth-токены |
| Платежи | Stripe | подписки |
| Деплой | Docker + CI/CD | |
| Наблюдаемость | структурные логи + трейсинг + алерты | |

---

## 5. ИНФРАСТРУКТУРА ИИ (стратегия)

**MVP = Схема 2 (только API-провайдеры).** Причина: минимальный старт, лучшее качество, нет MLOps-нагрузки.
Заложить миграцию на **Схему 3 (комбинированную)** при приближении к ~1000 клиентов: вынос генерации изображений и удаления фона на свой GPU.

Поэтому ВСЕ вызовы моделей идут через абстракцию `AIProvider` (раздел 9) — смена схемы = конфигурация, не переписывание.

**Задачи → модели (MVP):**
| Задача | Класс модели | Приоритет качества |
|--------|-------------|---------------------|
| Brand DNA анализ | топовый reasoning LLM | высокое |
| Контент-план | LLM | среднее |
| Caption (массово) | дешёвый LLM | низкое |
| Чат-правки | LLM | среднее |
| Генерация изображений | text-to-image API | среднее |
| Удаление фона | CV segmentation API | низкое |

---

## 6. МОДЕЛЬ ДАННЫХ (ядро)

```sql
-- Пользователи и организации
User(id, email, password_hash|oauth, created_at)
Organization(id, owner_user_id, name, plan, stripe_customer_id, created_at)
Membership(id, user_id, org_id, role) -- role: owner|editor|viewer

-- Бренд
Brand(id, org_id, source_url, status, created_at)
BrandDNA(id, brand_id, version,
         palette_json, fonts_json, logo_url,
         tone_of_voice, archetype, audience_json,
         usp_json, industry, competitors_json,
         created_at)  -- версионируется

-- Контент
ContentPlan(id, brand_id, status, created_at)
Post(id, brand_id, plan_id, title, status,
     scheduled_at, mode,  -- mode: manual|autopilot
     created_at)
     -- status: idea|draft|approved|scheduled|published|failed|rejected
PostVariant(id, post_id, platform, caption, hashtags_json,
            image_url, layers_json, native_preview_json)
     -- platform: facebook|instagram|linkedin|x|...

-- Обучение / обратная связь
Feedback(id, post_id, user_id, decision, reason, created_at)
     -- decision: approve|reject

-- Публикация
SocialAccount(id, org_id, platform, external_id,
              access_token_encrypted, refresh_token_encrypted,
              expires_at, status)
PublishJob(id, post_variant_id, social_account_id, status,
           attempts, external_post_id, error, scheduled_at)
     -- status: queued|running|success|failed|dead

-- Аналитика
Metric(id, post_variant_id, platform, impressions, engagement,
       clicks, conversions, collected_at)

-- Inbox (пострелиз, таблицу завести сразу)
InboxItem(id, social_account_id, external_id, type, text,
          author, suggested_reply, status, created_at)

-- Биллинг
Subscription(id, org_id, stripe_subscription_id, plan,
             status, current_period_end)
```

---

## 7. ФУНКЦИОНАЛЬНЫЕ ТРЕБОВАНИЯ (FR) ПО МОДУЛЯМ

### Модуль A — Brand DNA
- FR-A1 Принять URL, валидировать, краулить ключевые страницы (home, about, services, products).
- FR-A2 Извлечь визуал: палитра (из CSS/изображений), шрифты, логотип.
- FR-A3 Извлечь текст: tone of voice, УТП, ключевые сообщения.
- FR-A4 Определить отрасль и конкурентов.
- FR-A5 Собрать `BrandDNA` (версионируемый объект) + embeddings в vector DB.
- FR-A6 Сгенерировать 3–5 превью-постов **до регистрации/оплаты**.
- **AC:** превью готово ≤ 2 мин; палитра и tone соответствуют сайту; объект BrandDNA заполнен полностью.

### Модуль B — Контент-движок
- FR-B1 Генерировать план ≥ 50 постов (темы + даты + платформы + форматы).
- FR-B2 Генерировать caption под платформу с учётом BrandDNA.
- FR-B3 Генерировать изображение в стиле бренда.
- FR-B4 Нативное форматирование (длина, хэштеги, эмодзи, CTA) по платформе.
- FR-B5 Чат-интерфейс правок на естественном языке.
- FR-B6 Превью «как будет выглядеть» на каждой платформе.
- **AC:** 1 запрос → caption+image+preview для всех выбранных платформ; правка через чат меняет вариант без пересоздания с нуля.

### Модуль C — Designer
- FR-C1 Разложить пост на слои (`layers_json`).
- FR-C2 Canvas: перемещение/resize/замена/удаление слоёв.
- FR-C3 Удаление фона в 1 клик (CV API).
- FR-C4 Редактирование текста/шрифта/цвета вручную.
- **AC:** изменения сохраняются в `PostVariant.layers_json` и ре-рендерятся в итоговое изображение.

### Модуль D — Публикация
- FR-D1 OAuth-подключение соцсетей, токены в зашифрованном хранилище.
- FR-D2 Scheduler публикаций.
- FR-D3 Режимы: manual (одобрение каждого поста) / autopilot.
- FR-D4 Идемпотентная публикация, retry с backoff, DLQ, уведомления о сбоях.
- **AC:** пост реально публикуется в подключённый аккаунт; при сбое — повтор и статус `failed` с причиной.

### Модуль E — Очередь одобрения и обучение
- FR-E1 Очередь идей (status=idea) для approve/reject.
- FR-E2 Каждое решение пишется в `Feedback` и влияет на будущие генерации (через контекст/промпт/ранжирование).
- **AC:** reject с причиной уменьшает долю похожих предложений.

### Модуль F — Аналитика
- FR-F1 ETL метрик из соцсетей в `Metric`.
- FR-F2 Дашборд: охваты, вовлечённость, клики, конверсии.
- **AC:** метрики обновляются по расписанию; дашборд показывает динамику.

### Модуль G — Биллинг
- FR-G1 Подписка Stripe от $79/мес, отмена в любой момент.
- FR-G2 Превью доступно до оплаты; публикация — только с активной подпиской.
- **AC:** webhook Stripe меняет `Subscription.status`; отмена не блокирует доступ до конца периода.

### Модуль H — Платформа
- FR-H1 Auth (email/OAuth), организации, роли (owner/editor/viewer).
- FR-H2 Хранилище медиа (S3), секреты (KMS).
- FR-H3 Логи/трейсинг/алерты.

### Нефункциональные (NFR)
- NFR-1 Первое превью ≤ 2 мин.
- NFR-2 Асинхронность тяжёлых задач через очередь.
- NFR-3 Идемпотентность публикаций, retry+backoff, DLQ.
- NFR-4 Шифрование OAuth-токенов, GDPR.
- NFR-5 Контроль стоимости ИИ: кэш, лимиты токенов, выбор модели по задаче.

---

## 8. USE CASES (сценарии, с критериями приёмки)

| ID | Сценарий | Критерий приёмки |
|----|----------|-------------------|
| UC-1 | Вставил ссылку → Brand DNA + превью | ≤ 2 мин, до оплаты |
| UC-2 | Генерация плана 50+ постов | темы релевантны отрасли |
| UC-3 | Пост через чат («хочу пост про скидку 20%») | caption+image+preview всех платформ |
| UC-4 | Редактирование в Designer | послойно, удаление фона в 1 клик |
| UC-5 | Approve/reject из очереди | решения дообучают систему |
| UC-6 | Публикация / автопилот | retry при сбое, уведомления |
| UC-7 | Рекламная кампания (пострелиз) | креатив+запуск+оптимизация по бюджету |
| UC-8 | Аналитика | дашборд метрик + рекомендации |
| UC-9 | Inbox ответы (пострелиз) | ответ в tone of voice бренда |
| UC-10 | Биллинг и отмена | от $79/мес, отмена без штрафов |

---

## 9. AIProvider — ОБЯЗАТЕЛЬНЫЙ АБСТРАКТНЫЙ СЛОЙ

Все вызовы моделей идут ТОЛЬКО через этот интерфейс. Это позволяет менять провайдера и мигрировать с API на свой GPU без переписывания бизнес-логики.

```ts
interface AIProvider {
  // Текст
  generateText(params: {
    task: 'brand_dna' | 'content_plan' | 'caption' | 'chat_edit' | 'inbox_reply';
    prompt: string;
    context?: object;      // BrandDNA и пр.
    maxTokens?: number;
  }): Promise<{ text: string; usage: Usage }>;

  // Изображения
  generateImage(params: {
    prompt: string;
    brandStyle?: object;   // палитра/шрифты
    size?: string;
  }): Promise<{ url: string; usage: Usage }>;

  // CV
  removeBackground(params: { imageUrl: string }): Promise<{ url: string }>;
}
```

**Требования к реализации:**
- Роутер провайдеров с fallback (если провайдер A недоступен → провайдер B).
- Конфигурация `task → provider → model` вынесена в конфиг (не в код).
- Кэширование повторяющихся запросов.
- Учёт `usage` (токены/картинки) для контроля расходов.
- Таймауты, ретраи, лимиты.

---

## 10. API-КОНТРАКТЫ (ключевые эндпоинты MVP)

```
POST /api/brands                     { url }                → { brandId, status }
GET  /api/brands/:id                                        → { brandDNA, status }
GET  /api/brands/:id/preview                               → { previews[] }   // до оплаты

POST /api/brands/:id/plan                                   → { planId, posts[] }
POST /api/posts/:id/generate         { platforms[] }        → { variants[] }
POST /api/posts/:id/chat-edit        { message }            → { variant }
PUT  /api/variants/:id/layers        { layers_json }        → { variant }
POST /api/variants/:id/remove-bg                            → { image_url }

POST /api/posts/:id/approve          { decision, reason }   → { ok }

POST /api/social/connect             { platform }           → { oauthUrl }
GET  /api/social/callback            (oauth)                → redirect
POST /api/posts/:id/schedule         { scheduled_at, mode } → { publishJobId }

GET  /api/analytics/overview                                → { metrics }

POST /api/billing/checkout                                  → { stripeUrl }
POST /api/billing/webhook            (stripe)               → 200
```

Все эндпоинты (кроме preview и публичного онбординга) — за авторизацией; доступ ограничен ролью и организацией.

---

## 11. TESTING (минимум к MVP)

- **Unit:** экстракторы Brand DNA, форматтеры платформ, слой AIProvider (с моками).
- **Integration:** онбординг-флоу (url→DNA→preview), генерация варианта, schedule→publish (мок соцсети).
- **E2E (happy path):** регистрация → подключение соцсети → генерация → одобрение → публикация.
- **Contract tests:** на каждый коннектор соцсети.
- **Нагрузочный smoke:** очередь генерации под параллельной нагрузкой.
- Критерий готовности модуля: его AC выполнены + тесты зелёные.

---

## 12. BUILD ORDER (порядок реализации для агента)

> Строй строго по порядку. Каждая фаза заканчивается рабочим deliverable.

**Фаза 0 — Фундамент**
- Репозиторий, Docker, CI/CD, конфиг ENV/secret store.
- Auth, Organization, Membership, роли.
- Скелет сервисов, брокер очередей, подключение Postgres+pgvector+S3.
- Каркас `AIProvider` с одним провайдером.
- *Deliverable:* приложение деплоится, пользователь регистрируется.

**Фаза 1 — Brand DNA + превью (ключевая демка)**
- Краулер, экстракторы (A1–A5), сборка BrandDNA + embeddings.
- Генерация 3–5 превью (A6), онбординг-UI, превью до оплаты.
- *Deliverable:* вставил ссылку → BrandDNA + превью ≤ 2 мин.

**Фаза 2 — Контент-движок**
- План 50+ постов (B1), caption+image (B2–B3), форматирование+preview (B4,B6).
- Контент-календарь (frontend), очередь идей approve/reject (E1).
- *Deliverable:* готовый план с контентом, одобрение работает.

**Фаза 3 — Designer**
- Слои (C1), canvas-редактор (C2), удаление фона (C3), ручные правки (C4), чат-правки (B5).
- *Deliverable:* посты редактируются послойно.

**Фаза 4 — Публикация + биллинг → MVP**
- OAuth-коннекторы (FB, IG, LinkedIn, X), scheduler, режимы, retry/DLQ (D1–D4).
- Stripe-подписка + webhook (G1–G2).
- *Deliverable:* реальная публикация + монетизация. **Это MVP-релиз.**

**Фаза 5 — Аналитика + обучение**
- ETL метрик (F1), дашборд (F2), feedback-loop влияет на генерацию (E2).
- *Deliverable:* полный цикл create → publish → analyze → improve.

**Пострелиз:** 12 каналов, Ads (E), inbox-ответы (UC-9), локализация, мульти-бренд, миграция на Схему 3 (свой GPU для изображений/фона), fine-tune LLM под caption.

---

## 13. РИСКИ И ПРАВИЛА

| Риск | Правило для агента |
|------|--------------------|
| Доступ к API соцсетей (гл. риск) | Коннекторы — за интерфейсом; на старте включить мок-режим, чтобы не блокировать разработку |
| Галлюцинации ИИ | Фактчек по контенту сайта; human-in-the-loop перед автопилотом; стоп-слова/гайдрейлы |
| «LLM-wrapper» восприятие | Вкладывать качество в Designer, аналитику, автопилот — не только в генерацию |
| Стоимость ИИ | Кэш, лимиты токенов, выбор модели по задаче, учёт usage |
| Безопасность | Токены только зашифрованы; никаких секретов в коде/логах |

---

## 14. ГЛОССАРИЙ

- **Brand DNA** — структурированный профиль бренда (визуал + голос + ЦА + позиционирование), версионируемый.
- **PostVariant** — версия поста под конкретную платформу.
- **Autopilot** — режим публикации без ручного одобрения.
- **Feedback-loop** — влияние approve/reject на будущие генерации.
- **AIProvider** — абстрактный слой доступа к моделям.

---

## 15. DEFINITION OF DONE (MVP)

- [ ] Онбординг по ссылке даёт BrandDNA + превью ≤ 2 мин.
- [ ] Генерируется план 50+ постов с контентом под 4 платформы.
- [ ] Designer: послойное редактирование + удаление фона.
- [ ] Очередь одобрения влияет на генерацию.
- [ ] Реальная публикация в 4 канала с retry/DLQ.
- [ ] Stripe-подписка от $79/мес с превью до оплаты.
- [ ] Базовый дашборд аналитики.
- [ ] Все вызовы моделей идут через AIProvider.
- [ ] Тесты (unit/integration/e2e happy path) зелёные.
- [ ] Секреты зашифрованы, логи без чувствительных данных.

---
КОНЕЦ ФАЙЛА