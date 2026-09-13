# 02. Архитектура, стек, структура проекта, окружения

## Общая схема

```
┌─────────────────────────┐   ┌──────────────────────────┐
│ Telegram Mini App       │   │ Веб-админка              │
│ (React + Vite)          │   │ (React + Vite)           │
└───────────┬─────────────┘   └────────────┬─────────────┘
            │ HTTPS, JSON, Bearer session  │
            ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│ API (NestJS, модульный монолит)                          │
│  auth · users · workspaces · access · learning · reviews │
│  exams · crm · files · club · notifications · audit      │
│  export · admin                                          │
└──────┬───────────────┬──────────────┬───────────────┬────┘
       │               │              │               │
       ▼               ▼              ▼               ▼
┌────────────┐  ┌────────────┐  ┌───────────┐  ┌──────────────┐
│ PostgreSQL │  │ S3-хранил. │  │ Видео-    │  │ Telegram     │
│ + pg-boss  │  │ (приватное)│  │ платформа │  │ Bot API      │
└─────▲──────┘  └────────────┘  └───────────┘  └──────▲───────┘
      │                                                │
┌─────┴──────────────────────────────────────────┐     │
│ Worker (тот же код, отдельный процесс)          │─────┘
│  уведомления · клуб · сроки доступов · экспорт  │
│  обработка фото · повторы Telegram · бэкапы     │
└─────────────────────────────────────────────────┘
```

Telegram-бот работает в режиме **webhook** внутри API-процесса (эндпоинт `/telegram/webhook/:secret`). Все исходящие обращения к Telegram, которые не обязаны быть синхронными (уведомления, удаление из клуба), уходят через очередь в worker с повторами.

## Стек

| Компонент | Выбор | Обоснование |
|-----------|-------|-------------|
| Язык | TypeScript везде (backend, оба фронтенда, shared) | Один язык, общие типы и схемы валидации |
| Backend | NestJS 10+, REST | Модули = предметные области; DI, guards, interceptors для прав и аудита |
| БД | PostgreSQL 16 | Транзакции, ограничения, оконные функции для аналитики, exclusion constraints для календаря |
| ORM/миграции | Prisma (schema + migrate) + сырой SQL там, где Prisma не выражает (exclusion constraint, частичные индексы, аналитика) | Управляемые миграции, типобезопасный клиент |
| Очередь | pg-boss (очередь поверх PostgreSQL) | Нет отдельного брокера; повторы, отложенные задачи, cron-задачи, одна транзакция с бизнес-данными |
| Валидация | zod в `packages/shared`, используется и на сервере (pipe), и на клиенте (формы) | Одна схема на два конца |
| Файлы | Приватный S3-совместимый bucket (MinIO в dev, любой S3 в prod), presigned URL | Клиент грузит напрямую в хранилище, API только выдаёт подписанные ссылки |
| Видео | Внешняя видеоплатформа с приватными видео и подписанными/ограниченными по времени ссылками воспроизведения, за адаптером `VideoProvider` | Не делаем своё транскодирование; доступ к плееру выдаёт наш сервер |
| Telegram | grammY (Bot API клиент + webhook), `@telegram-apps/sdk-react` на фронте | Типизированные API, поддержка Mini Apps |
| Frontend | React 18, Vite, TypeScript, react-router, TanStack Query, react-hook-form + zod | Стандартный современный стек |
| UI Mini App | Компоненты на CSS-переменных темы Telegram (`--tg-theme-*`), собственный небольшой набор в `packages/ui` | Нативный вид в Telegram, тёмная/светлая тема автоматически |
| UI админки | Mantine (таблицы, формы, модалки, уведомления) | Быстро собирать «десктопные» экраны |
| Тесты | Vitest (unit), Jest+Supertest или Vitest (integration с реальной PostgreSQL в Docker), Playwright (e2e) | См. `11-testing-quality.md` |
| Сборка/деплой | pnpm workspaces, Docker multi-stage, docker compose на staging/production, Caddy как reverse proxy с автоматическим TLS, GitHub Actions | Воспроизводимость без Kubernetes |
| Логи/мониторинг | pino (JSON-логи) → stdout, Sentry для ошибок API/фронтов, healthcheck-эндпоинты, простой uptime-мониторинг | Достаточно для пилота и первых продаж |

Что намеренно не используется: микросервисы, Kubernetes, отдельный брокер сообщений, собственная обработка видео, GraphQL, отдельная аналитическая БД.

## Структура монорепозитория

```
pdr/
├── apps/
│   ├── api/                      # NestJS: HTTP API + Telegram webhook
│   │   ├── src/
│   │   │   ├── main.ts           # bootstrap HTTP
│   │   │   ├── worker.ts         # bootstrap worker (тот же AppModule без HTTP)
│   │   │   ├── app.module.ts
│   │   │   ├── common/           # guards, interceptors, filters, decorators, pagination, errors
│   │   │   ├── config/           # env-схема (zod), типизированный ConfigService
│   │   │   ├── infra/
│   │   │   │   ├── prisma/       # PrismaService, транзакционный контекст
│   │   │   │   ├── storage/      # S3 клиент, presign
│   │   │   │   ├── video/        # VideoProvider интерфейс + адаптер(ы)
│   │   │   │   ├── telegram/     # grammY bot, webhook, отправка
│   │   │   │   └── jobs/         # pg-boss: регистрация очередей и обработчиков
│   │   │   └── modules/
│   │   │       ├── auth/         # initData, Login Widget, сессии, refresh, logout
│   │   │       ├── users/        # профиль, platform_roles
│   │   │       ├── access/       # access_grants, проверка продуктовых доступов
│   │   │       ├── workspaces/   # мастерские, участники, приглашения, настройки
│   │   │       ├── learning/
│   │   │       │   ├── catalog/  # курсы, версии, этапы, уроки, материалы (админ)
│   │   │       │   ├── cohorts/  # группы, зачисления, кураторы, режим открытия
│   │   │       │   ├── progress/ # прогресс уроков, позиция видео, доступ к этапам
│   │   │       │   ├── assignments/ # задания, сдачи, проверки
│   │   │       │   └── exams/    # экзамены, вопросы, попытки, ответы
│   │   │       ├── crm/
│   │   │       │   ├── clients/
│   │   │       │   ├── vehicles/
│   │   │       │   ├── orders/   # заказы, статусы, история, фото заказа
│   │   │       │   ├── appointments/
│   │   │       │   ├── estimates/# сметы, позиции, прайс
│   │   │       │   ├── payments/
│   │   │       │   └── analytics/
│   │   │       ├── files/        # files, presign upload/download, привязки, миниатюры
│   │   │       ├── club/         # членство, заявки, удаление
│   │   │       ├── notifications/# шаблоны, отправка, лог, настройки пользователя
│   │   │       ├── audit/        # журнал действий
│   │   │       ├── export/       # CSV-экспорт (CRM и обучение)
│   │   │       └── admin/        # агрегирующие админ-эндпоинты (дашборд, поиск)
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── test/                 # integration и security-тесты
│   ├── miniapp/                  # React: Mini App (Обучение / Мастерская / Профиль)
│   │   └── src/
│   │       ├── app/              # роутер, провайдеры, инициализация Telegram SDK
│   │       ├── features/
│   │       │   ├── learning/     # курс, этап, урок, задание, экзамен, результаты
│   │       │   ├── crm/          # сегодня, календарь, заказы, клиенты, авто, смета, оплаты, сотрудники, аналитика
│   │       │   ├── club/
│   │       │   └── profile/
│   │       ├── entities/         # api-hooks по сущностям (TanStack Query)
│   │       └── shared/           # api-клиент, ui-примитивы, утилиты (деньги, даты, tz)
│   └── admin/                    # React: веб-админка платформы
│       └── src/
│           ├── app/
│           ├── features/
│           │   ├── students/     # ученики, карточка прогресса
│           │   ├── cohorts/
│           │   ├── course/       # редактор курса: версии, этапы, уроки, материалы, задания, экзамены
│           │   ├── reviews/      # очередь проверок (кураторы и админ)
│           │   ├── access/       # выдача/продление/отзыв доступов
│           │   ├── workspaces/   # список мастерских, участники (без данных CRM)
│           │   ├── club/
│           │   ├── users/        # пользователи, роли платформы
│           │   └── audit/
│           └── shared/
├── packages/
│   ├── shared/                   # zod-схемы DTO, enums, permissions-таблица, утилиты денег/дат, типы API
│   ├── api-client/               # типизированный клиент к REST (генерация из OpenAPI + обёртка)
│   └── ui/                       # общие React-компоненты (Mini App-стиль)
├── infra/
│   ├── docker/                   # Dockerfile.api, Dockerfile.web, compose.*.yml
│   ├── caddy/                    # Caddyfile для staging/production
│   ├── backup/                   # скрипт pg_dump → S3, restore.sh, retention
│   └── scripts/                  # migrate, seed, create-admin, rotate-keys
├── docs/
├── .github/workflows/            # ci.yml (lint, typecheck, test, build), deploy-staging.yml, deploy-prod.yml
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example
└── turbo.json                    # опционально, для кеширования сборок
```

Принципы структуры:

- **Модуль владеет своими таблицами.** Другие модули обращаются к нему через его сервис, а не напрямую к Prisma-моделям чужого модуля. Исключения только для чтения в `analytics` и `export`.
- **`packages/shared` — единственный источник enum'ов и DTO.** Статусы заказа, роли, типы доступов, коды ошибок описаны один раз.
- **Worker = тот же `AppModule`**, поднятый без HTTP-слоя, с зарегистрированными обработчиками pg-boss. Это гарантирует одинаковую бизнес-логику в API и фоновых задачах.

## Конфигурация и окружения

Окружения: `local` (docker compose: postgres, minio, api, worker, miniapp, admin, tunnel для Telegram), `staging`, `production`. У staging **отдельный бот, отдельная группа клуба, отдельный bucket и отдельный аккаунт видеоплатформы** — Telegram привязывает Mini App и webhook к конкретному боту.

Переменные окружения валидируются zod-схемой при старте; неполная конфигурация = процесс не стартует.

| Группа | Переменные |
|--------|------------|
| Общие | `NODE_ENV`, `APP_ENV` (local/staging/production), `PUBLIC_API_URL`, `MINIAPP_URL`, `ADMIN_URL` |
| БД | `DATABASE_URL` |
| Сессии | `SESSION_JWT_SECRET` (подпись access-токена), `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL` (30d) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CLUB_CHAT_ID`, `TELEGRAM_INITDATA_MAX_AGE_SEC` (300), `TELEGRAM_LOGIN_MAX_AGE_SEC` (300) |
| Хранилище | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PRESIGN_UPLOAD_TTL` (600), `S3_PRESIGN_DOWNLOAD_TTL` (300), `FILE_MAX_SIZE_IMAGE`, `FILE_MAX_SIZE_VIDEO` |
| Видео | `VIDEO_PROVIDER` (kinescope/bunny/...), `VIDEO_API_KEY`, `VIDEO_PLAYBACK_TTL` |
| Ошибки | `SENTRY_DSN` |
| Бэкапы | `BACKUP_S3_BUCKET`, `BACKUP_RETENTION_DAYS` |

Секреты не хранятся в репозитории; в GitHub Actions — через Environments (staging/production) с ручным подтверждением деплоя в production.

## Развёртывание

- **Сборка**: Docker multi-stage. `api` образ содержит скомпилированный Nest + Prisma client + миграции; запускается как `node dist/main.js` (API) или `node dist/worker.js` (worker). `miniapp` и `admin` собираются в статику и раздаются Caddy.
- **Миграции**: `prisma migrate deploy` выполняется отдельным шагом деплоя **до** переключения на новую версию API. Миграции пишутся обратно совместимыми (добавление колонок с default, удаление в следующей версии), чтобы старый API мог работать во время выката.
- **Reverse proxy**: Caddy с автоматическим TLS (Telegram требует HTTPS для Mini App и webhook). Домены: `app.<domain>` (Mini App), `admin.<domain>`, `api.<domain>`.
- **Процессы на сервере** (docker compose): `postgres`, `api` (1–2 реплики), `worker` (1), `caddy`, `backup` (cron-контейнер). MinIO только в local; в staging/production внешний S3.
- **Health**: `GET /health` (liveness), `GET /health/ready` (БД + S3 + очередь). Worker пишет heartbeat в таблицу `worker_heartbeats`; админка показывает, жив ли worker и размер очереди.

## Резервное копирование и восстановление

- `pg_dump --format=custom` каждые сутки (и перед каждым деплоем в production) → S3 bucket для бэкапов с версионированием и retention 30 дней; еженедельные копии хранятся 6 месяцев.
- Файлы в основном bucket: включено версионирование объектов и защита от удаления (retention) на 30 дней; кросс-регион/кросс-провайдер копия по расписанию.
- `infra/backup/restore.sh` восстанавливает дамп в чистую БД staging; процедура **прогоняется перед пилотом и затем ежемесячно** (см. чеклист в `11-testing-quality.md`).
- Экспорт CSV мастерской (владелец) и обучения (админ) — самостоятельная функция, не замена бэкапов.

## Наблюдаемость

- Каждый запрос получает `request_id` (заголовок `X-Request-Id`), он же попадает в логи, аудит и в ответ об ошибке.
- Ошибки API и фронтендов уходят в Sentry с `user_id`, `workspace_id`, `request_id`.
- Метрики, достаточные для пилота: время ответа по эндпоинтам (pino + простой экспорт), очередь pg-boss (размер, ошибки), ошибки Telegram API по типам.

---

## Технические решения, принятые при реализации

| Решение | Причина |
|---------|---------|
| `@pdr/shared` собирается в двух форматах (CommonJS и ESM) | NestJS компилируется в CommonJS, Vite-фронтенды используют ESM; один пакет обслуживает оба без обёрток |
| Драйвер хранилища `local` наряду с `s3` | В окружениях разработки и CI без Docker (а значит, без MinIO) файловый слой работает поверх файловой системы. Интерфейс `StorageProvider` один, поведение presign эмулируется через подписанные ссылки нашего API. На staging и production `STORAGE_DRIVER=local` запрещён проверкой конфигурации |
| `MockVideoProvider` рядом с `KinescopeProvider` | Разработка и тесты не зависят от доступа к аккаунту Kinescope. На staging и production `VIDEO_PROVIDER=mock` запрещён проверкой конфигурации |
| Тесты NestJS собираются через SWC (`unplugin-swc`) | esbuild не генерирует метаданные декораторов, без которых не работает внедрение зависимостей |
| Обработчики фоновых задач находятся через `DiscoveryService` | Модуль объявляет наследника `JobHandler`, worker сам подписывает его на очередь и расписание — не нужен общий реестр, который легко забыть обновить |
| Ошибка «не найдено» и «нет доступа к чужому объекту» — обе 404 | Не раскрывает существование идентификаторов в другой мастерской |
| `no-irregular-whitespace` разрешён в строках и регулярных выражениях | Нормализация телефонов обрабатывает неразрывный пробел из ввода пользователя |
