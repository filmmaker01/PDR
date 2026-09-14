# 17. Аудит: шаблон Vibe против текущего PDR

**Статус: архитектурный справочник. План миграции заморожен** и не
выполняется до первого живого staging. Приоритет — запуск: защита видео,
боевой Telegram-бот и Mini App, клуб, публичный staging, реальные ключи
Kinescope, прогон в Telegram на iOS/Android/Desktop. К выборочному переносу
решений из Vibe возвращаемся после успешного живого staging.

Дата: 2026-09-14. Сравнивались `di-sukharev/vibe` (master, коммит `059d50e`,
2026-09-13) и `filmmaker01/PDR` (ветка `claude/sleepy-hamilton-atoayb`).
Код не менялся; это план.

## Главный ответ

**Целиком мигрировать не нужно.** Backend остаётся на NestJS, фронтенды — как
есть. Из Vibe переносятся четыре вещи: контракты API как общий пакет,
capability ledger, инфраструктура Yandex Cloud (управляемые ресурсы через
Terraform) и несколько точечных практик хранилища и тестов.

Почему не переписывать на Bun/Hono:

| | Vibe | PDR |
|---|---|---|
| Backend-модули | 3 (auth, users, uploads-аватар) | 16 модулей, 204 HTTP-обработчика, 22,5 тыс. строк |
| Prisma-модели / миграции | 5 / 4 | 53 / 27, с `EXCLUDE`-ограничением календаря на `btree_gist` |
| Фоновая работа | outbox + 3 расписания | pg-boss: 17 обработчиков, 11 расписаний, 9 мест постановки задач с задержкой, повторами и `singletonKey` |
| Тесты | контракты + auth/users/uploads | 24 интеграционных файла, 385 сценариев, включая изоляцию мастерских, F1–F10, защиту видео |
| Auth | email + пароль, cookie-refresh | Telegram initData, Login Widget, демо-вход, ротация refresh с обнаружением повторного использования |

Переписывание — это перенос всего правого столбца ради runtime, который
ничего не даёт продукту: Bun/Hono выигрывает на холодном старте serverless, а
serverless для PDR не подходит (см. «Yandex Cloud»). Стоимость — месяцы,
риск — потеря бизнес-логики и тестов. Выгоды, превосходящей это, нет.

## Решения по блокам

| Блок | Решение | Почему |
|---|---|---|
| Backend runtime (NestJS / Bun+Hono) | **KEEP** | См. выше |
| Prisma 6 → Prisma 7, PostgreSQL 16 → 18, UUIDv7 | **NOT NEEDED** | PDR не зависит от `uuidv7()`; обновление Prisma — отдельная плановая задача, не часть миграции |
| pg-boss → outbox + timer-контейнеры | **KEEP pg-boss** | Outbox Vibe — таблица + дренаж раз в минуту. PDR ставит задачи с задержкой (`startAfter`), дедупликацией (`singletonKey`) и повторами; уведомления, клуб, экспорт, обработка фото, Kinescope-polling — всё на этом |
| Worker как постоянный процесс | **KEEP** | Следствие предыдущего пункта |
| Shared API contracts (`packages/contracts`) | **ADOPT** | Главный архитектурный долг PDR: фронтенды описывают ответы API вручную — 3 файла `types.ts`, 691 строка. Zod-схемы ответов живут в 9 `dto`-каталогах API и до клиента не доходят |
| CHECKLIST.md / capability ledger | **ADOPT** | Дешёвый и полезный: фиксирует, что `included`, что `available` (Kinescope, Telegram, DRM — код есть, ключей нет), что `absent` (платежи, онлайн-запись) |
| AGENTS.md | **ADOPT** | В PDR нет ни `CLAUDE.md`, ни `AGENTS.md`; правила (динамический `import('@/…')`, репозитории CRM, стиль комментариев) живут только в ESLint и в головах |
| Private storage port + 2 драйвера | **KEEP** | В PDR уже есть порт, `local`/`s3`, multipart, magic bytes для image/video/pdf, квота на мастерскую — шире, чем у Vibe |
| Upload security | **KEEP + 3 точечных ADOPT** | Добавить `If-None-Match: *` (write-once ключ) в presigned PUT; один контрактный набор тестов, гоняемый по обоим драйверам; версионирование media-бакета с lifecycle 30 дней как «единственный undo» |
| Auth / security patterns | **KEEP** | Модели разные (Telegram vs пароль). Из Vibe полезно только `RATE_LIMIT_STORE=database` — и только когда API станет больше одного экземпляра; сейчас лимитер в памяти и это честно задокументировано |
| Testing architecture | **KEEP vitest + 2 ADOPT** | Разделение по имени файла `*.integration.test.ts` / `*.live.test.ts` (live для Kinescope/S3/Telegram с реальными ключами); проверка границ зависимостей (`architecture-check`) — в PDR через `eslint-plugin-import` `no-restricted-paths`, а не отдельный скрипт |
| Deployment / release process | **ADOPT принципы, не скрипт** | `scripts/infra.mjs` завязан на структуру Terraform-корней Vibe. Переносим правила: релиз только с запушенного коммита, immutable-образ по digest, миграция как gate перед переключением трафика, отказ от удаления stateful-ресурсов |
| Terraform | **ADOPT частично** | `infra/yandex/production/foundation.tf` + `storage.tf` + `secrets.tf` (сеть, Managed PG, Object Storage, Lockbox, сервисные аккаунты) — переносятся почти как есть. `runtime/` (Serverless Containers, API Gateway, timer-триггеры) — **NOT NEEDED** |
| Yandex Cloud вместо Render/Amvera | **ADOPT, но не в serverless-форме** | См. следующий раздел |
| Object Storage | **ADOPT** | S3-драйвер PDR уже работает с любым S3-совместимым endpoint (`S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`) |
| Managed PostgreSQL | **ADOPT** | Версию в Terraform сменить с `18` на `16`. `btree_gist` в Yandex Managed PostgreSQL поддерживается (подтверждено заказчиком), поэтому `EXCLUDE`-ограничение календаря переносится без изменений |
| Serverless / scheduled jobs | **NOT NEEDED** | pg-boss остаётся; расписания живут в коде обработчиков |
| CI/CD | **KEEP** | У Vibe GitHub Actions нет принципиально («все проверки локально»). В PDR есть `ci.yml` с PostgreSQL-сервисом, lint, typecheck, unit, integration, build — это лучше |
| `website` (Astro) | **NOT NEEDED** | Публичного сайта нет |
| `mobile` (Expo) | **NOT NEEDED** | Mini App — это web внутри Telegram |
| Email (Postbox / Resend) | **NOT NEEDED** | Уведомления идут через бота |
| shadcn / Tailwind / TanStack Router / React 19 | **NOT NEEDED** | Mini App стилизован под `--tg-theme-*`, админка на Mantine. Замена UI-слоя — редизайн, а не архитектура |
| Storybook, precompress статики | **NOT NEEDED** | Нет потребности; статику сжимает Caddy/nginx |

## Yandex Cloud: можно, но не по схеме Vibe

Схема Vibe для Yandex: API — Serverless Container за API Gateway, фоновые
задачи — по одному контейнеру на расписание с timer-триггером, PostgreSQL —
Managed, статика — Object Storage, медиа — приватный бакет.

Три вещи в PDR в эту схему не помещаются:

1. **Загрузка видео идёт через API потоком.** `PUT /v1/admin/videos/:id/content`
   принимает тело запроса и тем же потоком (`duplex: 'half'`) отдаёт его в
   Kinescope. Запрос живёт столько, сколько заливается файл в сотни мегабайт.
   В Terraform Vibe API-контейнер имеет `execution_timeout = "30s"` и
   `concurrency = 1`, плюс лимиты API Gateway на тело запроса. Загрузка отвалится.
2. **Worker — постоянный процесс.** pg-boss опрашивает очередь, держит
   расписания и heartbeat (`WorkerHeartbeat`, читается дашбордом админки).
   Serverless-контейнер между запросами не живёт.
3. **Kinescope опрашивается задачей с задержкой** (`startAfterSec`) до готовности
   видео — это семантика очереди, не cron.

Что подходит: Telegram webhook — обычный HTTPS, работает за любым ingress;
Kinescope и Mini App от хостинга не зависят; DRM/watermark — на стороне
плеера; S3-драйвер PDR совместим с Object Storage.

**Рекомендуемая форма на Yandex Cloud** — «own server» из Vibe, но на
инфраструктуре Yandex:

| Компонент | Где |
|---|---|
| PostgreSQL | Managed Service for PostgreSQL 16, без публичного IP |
| Файлы | приватный Object Storage бакет, версионирование, lifecycle 30 дней |
| Секреты | Lockbox |
| API + worker + Caddy | одна Compute VM с Docker, `infra/docker/compose.deploy.yml` — он уже есть |
| Mini App, админка | либо тот же Caddy на VM (проще), либо два публичных бакета Object Storage (как у Vibe) |
| Бэкапы | штатные бэкапы Managed PG + существующий `infra/backup` в Object Storage |

Это сохраняет всё: worker, потоковую загрузку, миграции при старте,
Telegram Mini App, Kinescope. Serverless-контейнеры можно рассмотреть позже
для одного API, когда загрузка видео уйдёт с API (прямой upload в Kinescope
по короткоживущему токену — есть ли такой режим у Kinescope, надо проверять
по их документации).

Против Amvera: Yandex даёт Terraform, Managed PG с бэкапами, Lockbox, Object
Storage и резидентность данных в РФ. Против Render: Render заблокирован и не
российский. Стоимость Yandex не оценивал — прайс недоступен из этой сессии.

## Итог

Выполнять не сейчас: раздел описывает целевое состояние, к которому
возвращаемся после живого staging.

### 1. Конечная архитектура PDR

```
Telegram Mini App (React 18, Vite)     Админка (React 18, Mantine)
            │                                   │
            └──────── @pdr/shared (zod-контракты запросов И ответов) ────────┘
                                    │
                     API NestJS 10 + Worker (pg-boss), один образ
                                    │
   Managed PostgreSQL 16 ── Object Storage (private) ── Kinescope ── Telegram Bot API
                     Yandex Cloud: VPC, Lockbox, Terraform
```

### 2. Что перенести из Vibe

1. `packages/contracts` → расширить `@pdr/shared`: схемы ответов, `ApiError`
   с закрытым перечнем кодов; фронтенды парсят ответы схемой, `types.ts` уходят.
2. `CHECKLIST.md` с capability ledger; `AGENTS.md` (наши правила).
3. Terraform: `infra/yandex/production/{foundation,storage,secrets}.tf`,
   bootstrap remote state, tfvars-примеры без секретов.
4. Хранилище: `If-None-Match: *`, контрактный тест по двум драйверам,
   версионирование бакета.
5. Тесты: категория `live`, проверка границ импортов.
6. Правила релиза: только запушенный коммит, digest-образ, миграция как gate.

### 3. Что оставить из PDR

NestJS, Prisma 6 + PostgreSQL 16 + сырой SQL для `EXCLUDE`, pg-boss с
обработчиками и расписаниями, оба фронтенда и `@pdr/ui`, Telegram-auth с
демо-входом, модуль файлов с multipart и magic bytes, защита видео
(`VideoViewSession`, watermark, DRM-переговоры), GitHub Actions CI,
`compose.deploy.yml` + Caddy, бэкапы, k6, QA-скрипты, вся документация
`docs/01–16`.

### 4. Объём

| Шаг | Оценка | Меняет код продукта? |
|---|---|---|
| CHECKLIST.md + AGENTS.md | 1 день | нет |
| Контракты ответов: сначала деньги и CRM (заказы, сметы, оплаты), потом обучение, потом остальное | 2–3 недели фоново, по модулю за раз | да, но только типы и парсинг — поведение не меняется |
| Terraform Yandex (foundation + storage + secrets + VM) | 3–5 дней + доступ к аккаунту | нет |
| Хранилище: write-once, контрактный тест, версионирование | 2–3 дня | минимально |
| Тесты: live-категория, границы импортов | 1–2 дня | нет |
| Релизный скрипт под Yandex (сборка, push в Container Registry, миграция, `compose up`) | 2–3 дня | нет |

Итого порядка 4–6 недель календарно при фоновой работе, без остановки
разработки функций.

### 5. Риски

- **Контракты**: при переносе схем ответов вскроются расхождения между тем,
  что API реально отдаёт, и тем, что фронтенд ожидал. Это не риск миграции, а
  её польза — но каждое расхождение надо разбирать, а не «подгонять схему».
- **Прайс и лимиты Yandex**: не проверены (сайт заблокирован прокси).
- **Соблазн переписать по пути**: Vibe красиво разложен по слоям
  transport/application/domain/infrastructure. Перекладывать существующие
  модули PDR под эту структуру — это и есть «переписывание ради шаблона».
  Новые модули можно писать по ней; старые не трогать.
- **Один VM** — единая точка отказа для API и worker. Для пилота приемлемо,
  для роста — второй экземпляр API и `RATE_LIMIT_STORE=database`.

### 6. Пошаговый план без потери функций и тестов

Каждый шаг — отдельная ветка от текущей, отдельное ревью, зелёный CI до слияния.

1. **Документы.** `CHECKLIST.md` (ledger по текущему состоянию), `AGENTS.md`.
   Ничего не ломает.
2. **Контракты, каркас.** В `@pdr/shared` — `ApiError` с перечнем кодов,
   общие схемы пагинации, `parse`-обёртка в `@pdr/api-client`
   (`request(path, schema)`). Старый `request<T>` остаётся, ничего не удаляется.
3. **Контракты, модуль за модулем.** Порядок: `crm/payments` → `crm/estimates`
   → `crm/orders` → `learning/progress` → остальное. На каждый модуль: схема
   ответа в shared, контроллер её импортирует (типизация ответа), фронтенд
   парсит схемой, `types.ts` этого модуля удаляется. Тесты API не меняются —
   они и есть проверка, что ответ соответствует схеме.
4. **Хранилище.** `If-None-Match: *` в `S3StorageProvider.presignUpload` и в
   `LocalStorageProvider`; общий набор тестов `storage-contract.spec.ts`,
   запускаемый для обоих; в `files.spec.ts` ничего не убирать.
5. **Тесты.** Конфиг `vitest.live.config.mts` для Kinescope/S3/Telegram с
   реальными ключами (не в CI); `no-restricted-paths` для границ модулей.
6. **Terraform.** `infra/yandex/` из Vibe: bootstrap, foundation (PG 16,
   VPC, SA), storage (media-бакет), secrets (Lockbox), плюс VM. Без
   `runtime/` и `migration/`. `terraform plan` на реальном аккаунте до `apply`.
7. **Релиз на Yandex.** Скрипт: `git archive` запушенного коммита → сборка
   образа → push в Container Registry → на VM `migrate` → `compose up` →
   smoke `/health/ready`. Amvera-конфиг остаётся, пока Yandex не проверен.
8. **Staging на Yandex, прогон F1–F10** по `docs/13-staging.md`. Только после
   этого — решение о production.

До подтверждения этого плана код не меняется.

## Источники

- `di-sukharev/vibe` `059d50e`: `README.md`, `CHECKLIST.md`, `AGENTS.md`,
  `docs/ARCHITECTURE.md`, `docs/STORAGE.md`, `docs/TESTING.md`,
  `docs/DEPLOYMENT.md`, `docs/YANDEX_CLOUD.md`, `docs/BACKGROUND_JOBS.md`,
  `infra/README.md`, `infra/yandex/runtime/containers.tf`
  (`execution_timeout = "30s"`, `concurrency = 1`),
  `infra/yandex/production/{foundation,storage}.tf` (`version = "18"`),
  `backend/src/{app,jobs,cron,scheduler}.ts`, `backend/src/storage/*`,
  `backend/src/modules/uploads/*`, `packages/contracts/src/*`,
  `webapp/src/platform/api/http-client.ts`, `webapp/playwright.config.ts`.
- PDR: `apps/api/src/infra/jobs/*`, `apps/api/src/modules/files/*`,
  `apps/api/src/modules/learning/catalog/admin-catalog.controller.ts:458`,
  `apps/api/src/infra/video/kinescope-video.provider.ts:77–94`,
  `apps/api/src/common/guards/rate-limit.guard.ts`, `apps/api/prisma/schema.prisma`,
  `apps/api/prisma/migrations/20260913132809_appointment_no_double_booking`,
  `.github/workflows/ci.yml`, `infra/docker/compose.deploy.yml`,
  `docs/02-architecture.md`, `docs/11-testing-quality.md`, `docs/14-deploy-staging.md`.
- Подсчёты сделаны по дереву репозиториев (`find`, `grep -c`) на дату аудита.
- Поддержка `btree_gist` в Yandex Managed PostgreSQL — со слов заказчика
  (документация Yandex из этой сессии недоступна).
