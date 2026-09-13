# 03. Схема базы данных (PostgreSQL)

## Общие соглашения

- Первичные ключи — `uuid` (генерация `gen_random_uuid()`), кроме таблиц pg-boss.
- У всех бизнес-таблиц: `created_at timestamptz not null default now()`, `updated_at timestamptz not null` (обновляется триггером или Prisma `@updatedAt`).
- Мягкое удаление/архив — `archived_at timestamptz null`; физическое удаление только для черновиков и через процедуру удаления персональных данных.
- Деньги — `bigint` в минимальных единицах валюты (`*_minor`), валюта — `char(3)` ISO 4217.
- Время — `timestamptz` (хранится в UTC). Часовой пояс мастерской — `workspaces.timezone` (IANA), используется при отображении и при расчёте «сегодня».
- Все CRM-таблицы содержат `workspace_id` с FK и входят в составные индексы, начинающиеся с `workspace_id`.
- Enum'ы — PostgreSQL `enum` типы (через Prisma enum); значения продублированы в `packages/shared`.
- Проверочные ограничения (`check`) и exclusion constraints пишутся сырым SQL в миграциях Prisma.

Ниже таблицы сгруппированы по областям. Нотация: `column type [constraints]`; `→` означает FK.

---

## 1. Пользователи, сессии, роли платформы

```sql
users
  id                uuid pk
  telegram_user_id  bigint not null unique
  first_name        text not null
  last_name         text null
  username          text null            -- справочно, может меняться
  language_code     text null
  photo_url         text null            -- справочно
  phone             text null            -- вводится/шарится отдельно, E.164
  email             text null
  is_bot_blocked    boolean not null default false   -- бот не может писать (403 от Telegram)
  bot_write_allowed boolean not null default false   -- пользователь запустил бота / дал write access
  is_banned         boolean not null default false
  last_seen_at      timestamptz null
  created_at, updated_at

sessions
  id                uuid pk
  user_id           uuid → users not null
  refresh_token_hash text not null unique   -- sha256 от opaque-токена
  kind              enum session_kind (miniapp, web)
  user_agent        text null
  ip                inet null
  created_at        timestamptz
  last_used_at      timestamptz
  expires_at        timestamptz not null
  revoked_at        timestamptz null
  revoke_reason     text null
  index (user_id), partial index (expires_at) where revoked_at is null

platform_roles
  user_id           uuid → users
  role              enum platform_role (admin, curator)
  granted_by        uuid → users null
  created_at
  pk (user_id, role)

web_login_requests           -- вход в админку через Telegram Login Widget/бот
  id                uuid pk
  code              text not null unique      -- одноразовый код (для варианта через бота)
  status            enum (pending, confirmed, expired, used)
  user_id           uuid → users null
  created_at, expires_at, confirmed_at

idempotency_keys
  key               text not null
  user_id           uuid → users not null
  request_hash      text not null
  response_status   int not null
  response_body     jsonb not null
  created_at        timestamptz not null
  pk (user_id, key)
  -- чистится worker'ом старше 24 часов
```

---

## 2. Мастерские и участники

```sql
workspaces
  id                uuid pk
  name              text not null
  timezone          text not null default 'Europe/Moscow'   -- IANA
  currency          char(3) not null default 'RUB'
  phone             text null
  address           text null
  settings          jsonb not null default '{}'   -- рабочие часы, длительность записи по умолчанию, шаблоны и т.п.
  order_seq         int not null default 0        -- счётчик номеров заказов
  created_by        uuid → users
  archived_at       timestamptz null
  created_at, updated_at

workspace_members
  id                uuid pk
  workspace_id      uuid → workspaces not null
  user_id           uuid → users not null
  role              enum workspace_role (owner, employee)
  display_name      text null          -- как показывать в календаре
  color             text null          -- цвет исполнителя в календаре
  is_active         boolean not null default true   -- деактивированный сотрудник не входит, но история сохраняется
  joined_at         timestamptz not null
  left_at           timestamptz null
  unique (workspace_id, user_id)
  index (user_id)

workspace_invitations
  id                uuid pk
  workspace_id      uuid → workspaces not null
  role              enum workspace_role not null
  token_hash        text not null unique   -- ссылка вида t.me/bot?startapp=inv_<token>
  invited_phone     text null              -- необязательное ограничение: принять может только этот телефон
  created_by        uuid → users not null
  expires_at        timestamptz not null
  accepted_by       uuid → users null
  accepted_at       timestamptz null
  revoked_at        timestamptz null
  index (workspace_id)
```

Инварианты: у мастерской ровно один активный `owner` (частичный уникальный индекс `(workspace_id) where role='owner' and is_active`). Передача владения — отдельная операция в транзакции.

---

## 3. Продуктовые доступы

```sql
access_grants
  id                uuid pk
  product           enum product (course, crm, club)
  subject_type      enum grant_subject (user, workspace)
  user_id           uuid → users null        -- для course, club
  workspace_id      uuid → workspaces null   -- для crm
  course_id         uuid → courses null      -- для course
  status            enum grant_status (active, expired, revoked, suspended)
  valid_from        timestamptz not null
  valid_until       timestamptz null         -- null = бессрочно
  source            enum grant_source (manual, promo, migration, payment)
  external_ref      text null                -- номер платежа/договора
  reason            text null                -- причина выдачи/отзыва, показывается админу
  granted_by        uuid → users
  revoked_by        uuid → users null
  revoked_at        timestamptz null
  created_at, updated_at
  check ((subject_type='user' and user_id is not null and workspace_id is null)
      or (subject_type='workspace' and workspace_id is not null and user_id is null))
  check (product <> 'course' or course_id is not null)
  index (user_id, product, status), index (workspace_id, product, status), index (valid_until) where status='active'
```

Правило «действующий доступ»: `status='active' and valid_from <= now() and (valid_until is null or valid_until > now())`. Worker раз в час переводит просроченные в `expired` и запускает следствия (клуб → удаление). Одновременно может существовать несколько грантов на один продукт (продление создаёт новый грант с новым сроком или продлевает текущий — принято: **продление изменяет `valid_until` текущего активного гранта и пишет аудит**; новый грант создаётся, если активного нет).

---

## 4. Курс: структура и версии

Опубликованная программа фиксируется версией. Администратор редактирует **черновик** (`course_versions.status='draft'`), публикация превращает его в неизменяемую версию, а новый черновик создаётся копией. Группа (cohort) привязана к версии.

```sql
courses
  id                uuid pk
  slug              text not null unique
  title             text not null
  description       text null
  is_active         boolean not null default true
  created_at, updated_at

course_versions
  id                uuid pk
  course_id         uuid → courses not null
  version_no        int not null
  status            enum version_status (draft, published, archived)
  published_at      timestamptz null
  published_by      uuid → users null
  changelog         text null
  unique (course_id, version_no)
  partial unique (course_id) where status='draft'   -- один черновик на курс

stages
  id                uuid pk
  course_version_id uuid → course_versions not null
  key               text not null       -- стабильный ключ между версиями (например 'stage-1')
  position          int not null
  title             text not null
  description       text null
  cover_file_id     uuid → files null
  unlock_days_offset int not null default 0   -- дни от старта (режим interval): 0 / 30 / 60
  requires_previous_stage boolean not null default true
  completion_rule   jsonb not null default '{"required_lessons":true,"required_assignments":true,"required_exams":true}'
  unique (course_version_id, key), unique (course_version_id, position)

lessons
  id                uuid pk
  stage_id          uuid → stages not null
  key               text not null       -- стабильный ключ между версиями
  position          int not null
  title             text not null
  description       text null           -- markdown
  is_required       boolean not null default true
  video_asset_id    uuid → video_assets null
  min_watch_percent int not null default 0   -- вспомогательный показатель, 0 = не учитывается
  estimated_minutes int null
  unique (stage_id, key), unique (stage_id, position)

lesson_materials
  id                uuid pk
  lesson_id         uuid → lessons not null
  position          int not null
  kind              enum material_kind (file, link, text)
  title             text not null
  file_id           uuid → files null
  url               text null
  body              text null
  unique (lesson_id, position)

video_assets                 -- ссылки на видео во внешней платформе
  id                uuid pk
  provider          text not null           -- 'kinescope' | 'bunny' | ...
  provider_video_id text not null
  title             text not null
  duration_sec      int null
  status            enum video_status (uploading, processing, ready, failed)
  uploaded_by       uuid → users
  created_at, updated_at
  unique (provider, provider_video_id)
```

Публикация версии копирует `stages`, `lessons`, `lesson_materials`, `assignments`, `exams`, `questions`, `question_options` в новую `course_version` с сохранением `key`. Перенос группы на новую версию сопоставляет прогресс по `key` (см. `04-backend.md`).

---

## 5. Группы, зачисления, прогресс

```sql
cohorts
  id                uuid pk
  course_id         uuid → courses not null
  course_version_id uuid → course_versions not null   -- только published
  title             text not null            -- «Поток 3, ноябрь 2026»
  unlock_mode       enum unlock_mode (interval, dates)
  starts_at         timestamptz not null     -- старт группы (для режима dates и как default старта ученика)
  stage_dates       jsonb null               -- {"stage-2":"2026-12-01T00:00:00Z", ...} для режима dates
  is_active         boolean not null default true
  created_at, updated_at

cohort_curators
  cohort_id         uuid → cohorts
  user_id           uuid → users             -- должен иметь platform_role curator
  pk (cohort_id, user_id)

enrollments
  id                uuid pk
  cohort_id         uuid → cohorts not null
  user_id           uuid → users not null
  access_grant_id   uuid → access_grants not null   -- доступ к курсу
  started_at        timestamptz not null      -- индивидуальный старт (режим interval); по умолчанию = cohort.starts_at или дата зачисления
  status            enum enrollment_status (active, completed, paused, withdrawn)
  completed_at      timestamptz null
  created_at, updated_at
  unique (cohort_id, user_id)
  index (user_id)

lesson_progress
  id                uuid pk
  enrollment_id     uuid → enrollments not null
  lesson_key        text not null             -- key, а не lesson_id: переживает смену версии
  watch_position_sec int not null default 0
  watch_percent     int not null default 0    -- максимально достигнутый
  completed_at      timestamptz null          -- ученик отметил / автоматически по правилу
  first_opened_at   timestamptz null
  last_opened_at    timestamptz null
  unique (enrollment_id, lesson_key)

stage_overrides
  id                uuid pk
  enrollment_id     uuid → enrollments not null
  stage_key         text not null
  action            enum override_action (unlock, lock)
  reason            text not null
  created_by        uuid → users not null
  created_at        timestamptz
  expires_at        timestamptz null          -- временное открытие
  index (enrollment_id, stage_key)
  -- действует последний по created_at

stage_completions     -- материализованный факт завершения этапа (обновляется сервисом прогресса)
  enrollment_id     uuid → enrollments
  stage_key         text
  completed_at      timestamptz not null
  pk (enrollment_id, stage_key)
```

---

## 6. Практика: задания, сдачи, проверки

```sql
assignments
  id                uuid pk
  stage_id          uuid → stages not null
  lesson_id         uuid → lessons null       -- задание к уроку или к этапу в целом
  key               text not null
  position          int not null
  title             text not null
  instructions      text not null             -- markdown
  is_required       boolean not null default true
  required_media    jsonb not null default '{"min_photos":1,"min_videos":0,"text_required":false}'
  max_video_sec     int null
  unique (stage_id, key)

submissions
  id                uuid pk
  enrollment_id     uuid → enrollments not null
  assignment_key    text not null
  attempt_no        int not null
  status            enum submission_status (draft, submitted, in_review, accepted, returned)
  text              text null
  submitted_at      timestamptz null
  reviewed_at       timestamptz null
  created_at, updated_at
  unique (enrollment_id, assignment_key, attempt_no)
  index (status, submitted_at)   -- очередь проверок
  -- одновременно не более одной сдачи в статусах submitted/in_review на задание:
  partial unique (enrollment_id, assignment_key) where status in ('submitted','in_review')

submission_files
  submission_id     uuid → submissions
  file_id           uuid → files
  position          int not null
  pk (submission_id, file_id)

reviews
  id                uuid pk
  submission_id     uuid → submissions not null
  reviewer_id       uuid → users not null
  decision          enum review_decision (accepted, returned)
  comment           text not null
  rubric            jsonb null                -- опциональные критерии {"light":4,"tool":5,...}
  created_at        timestamptz
  index (submission_id)

review_comments        -- переписка по сдаче (уточняющие вопросы куратора / ответы ученика)
  id                uuid pk
  submission_id     uuid → submissions not null
  author_id         uuid → users not null
  body              text not null
  created_at
  index (submission_id, created_at)
```

---

## 7. Экзамены и тесты

```sql
exams
  id                uuid pk
  stage_id          uuid → stages not null
  key               text not null
  position          int not null
  title             text not null
  kind              enum exam_kind (test, practical)
  description       text null
  passing_score     int not null              -- проценты для test; для practical порог оценки куратора (например 60 из 100)
  max_attempts      int null                  -- null = не ограничено
  time_limit_sec    int null                  -- только test
  cooldown_hours    int not null default 0    -- пауза между попытками
  shuffle_questions boolean not null default true
  questions_per_attempt int null              -- выборка из банка; null = все
  show_explanations boolean not null default true   -- показывать разбор после попытки
  is_required       boolean not null default true
  unique (stage_id, key)

questions
  id                uuid pk
  exam_id           uuid → exams not null
  position          int not null
  kind              enum question_kind (single, multiple, boolean, short_text)
  body              text not null             -- markdown, может ссылаться на изображение
  image_file_id     uuid → files null
  explanation       text null                 -- показывается после попытки
  points            int not null default 1
  unique (exam_id, position)

question_options
  id                uuid pk
  question_id       uuid → questions not null
  position          int not null
  body              text not null
  is_correct        boolean not null
  -- для short_text: accepted_answers jsonb в questions вместо options

exam_attempts
  id                uuid pk
  enrollment_id     uuid → enrollments not null
  exam_key          text not null
  exam_id           uuid → exams not null     -- конкретная версия экзамена, по которой шла попытка
  attempt_no        int not null
  status            enum attempt_status (in_progress, submitted, graded, expired, cancelled)
  started_at        timestamptz not null
  deadline_at       timestamptz null
  submitted_at      timestamptz null
  graded_at         timestamptz null
  score             int null                  -- набранные баллы (test: авто; practical: куратор)
  max_score         int null
  percent           int null
  passed            boolean null
  grader_id         uuid → users null         -- practical
  grader_comment    text null
  question_order    jsonb null                -- зафиксированный порядок/выборка вопросов
  unique (enrollment_id, exam_key, attempt_no)
  partial unique (enrollment_id, exam_key) where status='in_progress'

attempt_answers
  id                uuid pk
  attempt_id        uuid → exam_attempts not null
  question_id       uuid → questions not null
  selected_option_ids uuid[] null
  text_answer       text null
  is_correct        boolean null
  points_awarded    int null
  answered_at       timestamptz
  unique (attempt_id, question_id)

attempt_files          -- вложения практического экзамена
  attempt_id        uuid → exam_attempts
  file_id           uuid → files
  position          int
  pk (attempt_id, file_id)
```

---

## 8. CRM: клиенты и автомобили

```sql
clients
  id                uuid pk
  workspace_id      uuid → workspaces not null
  name              text not null
  phone             text null                 -- E.164, нормализуется
  phone_extra       text null
  telegram_username text null
  telegram_user_id  bigint null               -- на будущее (онлайн-запись)
  source            text null                 -- откуда пришёл
  notes             text null
  tags              text[] not null default '{}'
  archived_at       timestamptz null
  anonymized_at     timestamptz null          -- процедура удаления ПДн
  created_by        uuid → users
  created_at, updated_at
  index (workspace_id, phone), index (workspace_id, lower(name)), gin index on tsvector(name, phone, notes) per workspace

vehicles
  id                uuid pk
  workspace_id      uuid → workspaces not null
  client_id         uuid → clients not null
  make              text not null
  model             text not null
  year              int null
  color             text null
  plate             text null                 -- нормализованный номер
  vin               text null                 -- необязателен; check length 17 если заполнен
  body_type         text null
  notes             text null
  archived_at       timestamptz null
  created_at, updated_at
  index (workspace_id, plate), index (workspace_id, client_id)
  -- FK-инвариант: clients.workspace_id = vehicles.workspace_id (составной FK (workspace_id, client_id) → clients(workspace_id, id))
```

Все CRM-таблицы, ссылающиеся друг на друга, используют **составные внешние ключи с `workspace_id`** (`(workspace_id, client_id) → clients(workspace_id, id)`), чтобы связь не могла пересечь мастерские даже при ошибке в коде. Для этого у `clients`, `vehicles`, `orders`, `estimates`, `workspace_members` есть `unique (workspace_id, id)`.

---

## 9. CRM: заказы, записи, история статусов

```sql
orders
  id                uuid pk
  workspace_id      uuid → workspaces not null
  number            int not null              -- из workspaces.order_seq, уникален внутри мастерской
  client_id         uuid not null             -- (workspace_id, client_id) → clients
  vehicle_id        uuid null                 -- (workspace_id, vehicle_id) → vehicles
  assignee_member_id uuid null                -- (workspace_id, assignee_member_id) → workspace_members
  status            enum order_status (new, pending_approval, scheduled, in_progress, ready, delivered, cancelled)
  payment_status    enum payment_status (unpaid, partial, paid, overpaid)   -- денормализовано, пересчитывается в транзакции с оплатой
  agreed_estimate_id uuid null                -- (workspace_id, id) → estimates; согласованная версия
  agreed_total_minor bigint null              -- копия итога согласованной сметы
  paid_minor        bigint not null default 0 -- поступления минус возвраты
  currency          char(3) not null
  title             text null                 -- краткое описание («Капот, град»)
  damage_summary    text null
  internal_notes    text null
  client_notes      text null                 -- что показывать/обещали клиенту
  scheduled_start_at timestamptz null         -- копия первичной записи для быстрых списков
  started_at        timestamptz null
  ready_at          timestamptz null
  delivered_at      timestamptz null
  cancelled_at      timestamptz null
  cancel_reason     text null
  archived_at       timestamptz null
  created_by        uuid → users
  created_at, updated_at
  unique (workspace_id, number)
  index (workspace_id, status), index (workspace_id, assignee_member_id, status), index (workspace_id, client_id), index (workspace_id, vehicle_id)

order_status_history
  id                uuid pk
  workspace_id      uuid not null
  order_id          uuid → orders not null
  from_status       enum order_status null
  to_status         enum order_status not null
  changed_by        uuid → users not null
  comment           text null
  created_at        timestamptz
  index (order_id, created_at)

appointments
  id                uuid pk
  workspace_id      uuid → workspaces not null
  order_id          uuid null                 -- (workspace_id, order_id) → orders; запись может быть без заказа (первичный осмотр)
  client_id         uuid null
  assignee_member_id uuid null
  starts_at         timestamptz not null
  ends_at           timestamptz not null
  kind              enum appointment_kind (inspection, repair, delivery, other)
  status            enum appointment_status (planned, confirmed, done, cancelled, no_show)
  allow_overlap     boolean not null default false   -- подтверждённое владельцем пересечение
  title             text null                 -- кого ждём, если заказа ещё нет
  note              text null
  cancel_reason     text null                 -- причина отмены или неявки
  created_by        uuid → users
  created_at, updated_at
  check (ends_at > starts_at)
  index (workspace_id, starts_at), index (workspace_id, assignee_member_id, starts_at)
  index (workspace_id, order_id), index (status, starts_at)   -- последний нужен задаче напоминаний
  -- защита от двойного бронирования (сырой SQL в миграции, требует btree_gist):
  -- exclude using gist (workspace_id with =, assignee_member_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  --   where (status in ('planned','confirmed') and allow_overlap = false and assignee_member_id is not null)
  -- границы полуоткрытые: запись 10:00–11:00 и следующая с 11:00 не конфликтуют

order_photos
  id                uuid pk
  workspace_id      uuid not null
  order_id          uuid → orders not null
  file_id           uuid → files not null
  category          enum photo_category (before, during, after, document)
  estimate_item_id  uuid → estimate_items null   -- привязка к повреждению
  caption           text null
  position          int not null
  created_by        uuid → users
  created_at
  unique (order_id, file_id)
  index (order_id, category, position)
```

---

## 10. CRM: сметы, позиции, прайс

```sql
price_list_items                -- прайс мастерской (справочник для быстрого выбора)
  id                uuid pk
  workspace_id      uuid → workspaces not null
  kind              enum estimate_item_kind (damage, disassembly, extra)
  title             text not null
  panel_code        text null
  damage_type       text null
  size_class        text null                 -- 'S' (до 2 см), 'M', 'L', 'XL' — справочник мастерской
  unit_price_minor  bigint not null
  unit              enum price_unit (per_item, per_dent, per_hour)
  is_active         boolean not null default true
  position          int not null
  index (workspace_id, is_active)

estimates
  id                uuid pk
  workspace_id      uuid → workspaces not null
  order_id          uuid not null             -- (workspace_id, order_id) → orders
  version_no        int not null
  status            enum estimate_status (draft, sent, agreed, rejected, superseded)
  currency          char(3) not null
  subtotal_minor    bigint not null default 0
  discount_kind     enum discount_kind (none, percent, fixed)
  discount_value    int not null default 0    -- проценты (0–100) или сумма в minor
  discount_minor    bigint not null default 0 -- рассчитанная скидка
  total_minor       bigint not null default 0 -- subtotal - discount
  note_for_client   text null
  internal_note     text null
  agreed_at         timestamptz null
  agreed_by         uuid → users null
  created_by        uuid → users
  created_at, updated_at
  unique (order_id, version_no)
  unique (workspace_id, id)
  -- ровно одна agreed-смета на заказ: partial unique (order_id) where status='agreed'

estimate_items
  id                uuid pk
  workspace_id      uuid not null
  estimate_id       uuid → estimates not null
  position          int not null
  kind              enum estimate_item_kind (damage, disassembly, extra)
  title             text not null             -- «Капот — град, 12 шт, S»
  panel_code        text null                 -- hood, roof, door_fl, ... (справочник в shared)
  damage_type       text null                 -- dent, hail, crease, ...
  size_class        text null
  quantity          int not null default 1
  material          enum material (steel, aluminum, other) null
  access_difficulty enum access_difficulty (easy, medium, hard) null
  on_edge           boolean not null default false
  unit_price_minor  bigint not null
  line_total_minor  bigint not null           -- quantity * unit_price (или фиксированная сумма позиции)
  price_list_item_id uuid → price_list_items null
  comment           text null
  index (estimate_id, position)
```

Позиции согласованной сметы **не редактируются**: изменение = новая версия (`superseded` для старой). Изменение прайса не трогает старые сметы — цена копируется в позицию.

---

## 11. CRM: оплаты

```sql
payment_entries
  id                uuid pk
  workspace_id      uuid → workspaces not null
  order_id          uuid not null             -- (workspace_id, order_id) → orders
  kind              enum payment_kind (payment, refund, correction)
  amount_minor      bigint not null           -- всегда > 0; знак определяется kind
  currency          char(3) not null
  method            enum payment_method (cash, card, transfer, sbp, other)
  purpose           enum payment_purpose (prepayment, payment, final, refund, correction)
  occurred_at       timestamptz not null      -- когда получены деньги
  note              text null
  corrects_entry_id uuid → payment_entries null   -- для correction/refund: какую запись исправляет
  created_by        uuid → users not null
  created_at        timestamptz
  check (amount_minor > 0)
  index (workspace_id, occurred_at), index (order_id)
```

Записи оплат **никогда не обновляются и не удаляются**. Ошибка исправляется записью `correction` (уменьшает) или новой `payment`. `orders.paid_minor = sum(payment) - sum(refund) - sum(correction)`, `payment_status` пересчитывается в той же транзакции.

---

## 12. Файлы

```sql
files
  id                uuid pk
  owner_user_id     uuid → users not null     -- кто загрузил
  workspace_id      uuid → workspaces null    -- для CRM-файлов; null для учебных
  scope             enum file_scope (order_photo, submission, exam_attempt, lesson_material, avatar, export, course_cover)
  storage_key       text not null unique      -- <scope>/<workspace or user>/<uuid>.<ext>
  bucket            text not null
  mime_type         text not null
  size_bytes        bigint not null
  original_name     text null
  status            enum file_status (pending, uploaded, processing, ready, failed, deleted)
  width, height     int null
  duration_sec      int null
  variants          jsonb not null default '{}'   -- {"thumb":"<key>","preview":"<key>"}
  checksum_sha256   text null
  created_at, updated_at
  deleted_at        timestamptz null
  index (workspace_id, scope), index (owner_user_id, scope), partial index (status, created_at) where status='pending'
```

Привязка файла к сущности — через таблицы `order_photos`, `submission_files`, `attempt_files`, `lesson_materials`. Файл без привязки в статусе `pending`/`uploaded` старше 24 часов удаляется worker'ом.

---

## 13. Клуб, уведомления, аудит, экспорт, задания

```sql
club_memberships
  id                uuid pk
  user_id           uuid → users not null unique
  access_grant_id   uuid → access_grants null   -- текущий действующий грант клуба
  chat_id           bigint not null
  telegram_status   enum club_status (none, invited, join_requested, approved, member, left, removed, declined)
  join_request_at   timestamptz null
  joined_at         timestamptz null
  removed_at        timestamptz null
  last_error        text null
  updated_at

club_events
  id                uuid pk
  user_id           uuid → users
  event             text not null             -- join_request, approved, declined, removed, rejoined, error
  payload           jsonb
  created_at

notification_preferences
  user_id           uuid → users pk
  review_results    boolean not null default true
  stage_unlocked    boolean not null default true
  appointment_reminders boolean not null default true
  order_assigned    boolean not null default true
  reminder_lead_minutes int not null default 60
  updated_at

notifications
  id                uuid pk
  user_id           uuid → users not null
  type              text not null             -- review_result, stage_unlocked, appointment_reminder, order_assigned, access_expiring, ...
  payload           jsonb not null
  dedupe_key        text null unique          -- защита от повторной отправки (например reminder:<appointment_id>:60)
  status            enum notification_status (queued, sent, failed, skipped)
  telegram_message_id bigint null
  error             text null
  scheduled_at      timestamptz not null
  sent_at           timestamptz null
  created_at
  index (user_id, created_at), index (status, scheduled_at)

audit_log
  id                bigserial pk
  request_id        text null
  actor_user_id     uuid → users null         -- null = система/worker
  actor_role_context text null                -- 'admin' | 'curator' | 'workspace:owner' | ...
  workspace_id      uuid null
  entity_type       text not null             -- 'order', 'payment_entry', 'access_grant', ...
  entity_id         uuid null
  action            text not null             -- 'create', 'update', 'status_change', 'revoke', ...
  before            jsonb null
  after             jsonb null
  ip                inet null
  user_agent        text null
  created_at        timestamptz not null
  index (workspace_id, created_at), index (entity_type, entity_id), index (actor_user_id, created_at)
  -- партиционирование по месяцам при росте; в 1.0 — одна таблица

exports
  id                uuid pk
  requested_by      uuid → users not null
  workspace_id      uuid → workspaces null
  kind              enum export_kind (crm_full, crm_clients, crm_orders, crm_payments, learning_students, learning_progress, audit)
  status            enum export_status (queued, running, done, failed)
  params            jsonb not null default '{}'
  file_id           uuid → files null
  error             text null
  created_at, finished_at

worker_heartbeats
  worker_id         text pk
  last_beat_at      timestamptz not null
  version           text

-- pg-boss создаёт свои таблицы в схеме pgboss (job, archive, schedule, ...)
```

---

## 14. Сводка связей

```
users ─┬─ sessions
       ├─ platform_roles
       ├─ workspace_members ── workspaces ─┬─ clients ── vehicles
       │                                   ├─ orders ─┬─ appointments
       │                                   │          ├─ order_status_history
       │                                   │          ├─ order_photos ── files
       │                                   │          ├─ estimates ── estimate_items
       │                                   │          └─ payment_entries
       │                                   ├─ price_list_items
       │                                   ├─ workspace_invitations
       │                                   └─ access_grants (crm)
       ├─ access_grants (course, club)
       ├─ enrollments ── cohorts ── course_versions ── courses
       │      ├─ lesson_progress          └─ stages ─┬─ lessons ── lesson_materials, video_assets
       │      ├─ stage_overrides                     ├─ assignments
       │      ├─ stage_completions                   └─ exams ── questions ── question_options
       │      ├─ submissions ── submission_files, reviews, review_comments
       │      └─ exam_attempts ── attempt_answers, attempt_files
       ├─ club_memberships, club_events
       ├─ notifications, notification_preferences
       └─ audit_log, exports
```

## 15. Правила данных (инварианты, проверяемые кодом и БД)

| Правило | Где обеспечивается |
|---------|--------------------|
| CRM-связи не пересекают мастерские | составные FK с `workspace_id`; репозиторный слой требует `workspace_id` |
| Один owner на мастерскую | частичный уникальный индекс |
| Переходы статусов заказа только по разрешённой таблице | сервис `OrderStateMachine` + история |
| Одна согласованная смета на заказ | частичный уникальный индекс + транзакция при согласовании |
| Оплаты неизменяемы | нет UPDATE/DELETE эндпоинтов; роль БД приложения без UPDATE на таблицу (`revoke update, delete on payment_entries`) |
| Нет двойного бронирования | exclusion constraint + проверка в сервисе для понятного сообщения |
| Одна сдача «на проверке» на задание | частичный уникальный индекс |
| Одна активная попытка экзамена | частичный уникальный индекс |
| Повторный запрос не создаёт дубль | `idempotency_keys` + уникальные индексы |
| Прогресс переживает смену версии курса | `lesson_key`/`assignment_key`/`exam_key`/`stage_key` вместо id |
| Деньги без плавающей точки | `bigint` minor units, расчёт скидок с округлением half-up в одном месте (`packages/shared/money.ts`) |
