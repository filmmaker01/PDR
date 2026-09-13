# 05. REST API

## Соглашения

- База: `https://api.<domain>/v1`. JSON. Авторизация: `Authorization: Bearer <access-token>`.
- Идентификаторы — UUID. Даты — ISO 8601 в UTC; поля местного времени (календарь) дополнительно возвращаются как `*_local` в часовом поясе мастерской.
- Деньги — целые числа в minor units + `currency`.
- Списки: cursor-пагинация `?cursor=&limit=` (по умолчанию 50, максимум 200), ответ `{ items, nextCursor }`. Фильтры и сортировка — query-параметры, описанные для каждого списка.
- Мутирующие запросы создания принимают `Idempotency-Key`.
- Ошибки: `{ error: { code, message, details?, requestId } }`. Коды HTTP: 400 (формат), 401 (нет/просрочена сессия), 403 (нет права при известном объекте — только для платформенных ресурсов), 404 (не найдено или чужое), 409 (конфликт состояния), 422 (валидация), 429.
- OpenAPI генерируется из Nest (`@nestjs/swagger`) и публикуется на `/docs` в staging; из него генерируется `packages/api-client`.
- Версионирование: путь `/v1`; несовместимые изменения — `/v2` с параллельной поддержкой.

Обозначения ролей в колонке «Кто»: `A` — администратор платформы, `C` — куратор (в рамках своих групп), `S` — ученик (в рамках своего зачисления), `O` — владелец мастерской, `E` — сотрудник, `*` — любой авторизованный.

---

## Auth

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| POST | `/auth/telegram/miniapp` | — | `{ initData }` → `{ accessToken, refreshToken, user, startAction? }` |
| POST | `/auth/telegram/widget` | — | данные Login Widget → сессия `web` (только platform_roles) |
| POST | `/auth/web/request` | — | создать запрос входа через бота → `{ code, deepLink, expiresAt }` |
| GET | `/auth/web/status/:code` | — | `{ status }`; при `confirmed` возвращает сессию один раз |
| POST | `/auth/refresh` | — | `{ refreshToken }` → новая пара |
| POST | `/auth/logout` | * | отзыв текущей сессии |
| POST | `/auth/logout-all` | * | отзыв всех сессий |
| GET | `/auth/sessions` | * | список активных сессий пользователя |

## Me / профиль

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/me` | * | профиль, platform_roles, memberships (мастерские с ролями и статусом CRM-доступа), enrollments (курсы, группы), products (действующие доступы и сроки), club status, notification prefs |
| PATCH | `/me` | * | телефон, email, язык |
| PATCH | `/me/notifications` | * | настройки уведомлений |
| POST | `/me/bot-write-allowed` | * | клиент сообщает, что `requestWriteAccess` дал согласие (сервер всё равно узнает по факту отправки) |

---

## Обучение — ученик

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/learning/enrollments` | S | мои зачисления |
| GET | `/learning/enrollments/:id` | S | карта курса: этапы с `StageAccess`, прогресс по каждому, сводка |
| GET | `/learning/enrollments/:id/stages/:stageKey` | S | этап: уроки (с прогрессом), задания (с последней сдачей), экзамены (с попытками); 404/`locked` с причинами, если закрыт |
| GET | `/learning/enrollments/:id/lessons/:lessonKey` | S | урок: описание, материалы, `video: { playbackUrl | embedToken, expiresAt }` — выдаётся только при открытом этапе |
| PUT | `/learning/enrollments/:id/lessons/:lessonKey/progress` | S | `{ positionSec, percent }` (throttle 10 с на клиенте) |
| POST | `/learning/enrollments/:id/lessons/:lessonKey/complete` | S | отметить пройденным (проверка `min_watch_percent`) |
| GET | `/learning/enrollments/:id/lessons/:lessonKey/materials/:materialId/download` | S | подписанная ссылка на файл материала |
| GET | `/learning/enrollments/:id/assignments/:assignmentKey` | S | задание, история сдач и проверок |
| POST | `/learning/enrollments/:id/assignments/:assignmentKey/submissions` | S | создать черновик сдачи → `{ submissionId, attemptNo }` |
| PATCH | `/learning/submissions/:id` | S | текст, порядок файлов (только `draft`/`returned`→новая сдача) |
| POST | `/learning/submissions/:id/files` | S | привязать загруженный файл `{ fileId }` |
| DELETE | `/learning/submissions/:id/files/:fileId` | S | |
| POST | `/learning/submissions/:id/submit` | S | `draft → submitted` (Idempotency-Key) |
| GET | `/learning/submissions/:id` | S, C, A | сдача с проверками и комментариями |
| POST | `/learning/submissions/:id/comments` | S, C, A | комментарий |
| GET | `/learning/enrollments/:id/exams/:examKey` | S | экзамен: правила, попытки, доступность (`canStart`, `nextAttemptAt`) |
| POST | `/learning/enrollments/:id/exams/:examKey/attempts` | S | старт попытки (Idempotency-Key) → вопросы без правильных ответов, `deadlineAt` |
| GET | `/learning/attempts/:id` | S | состояние попытки |
| PUT | `/learning/attempts/:id/answers/:questionId` | S | сохранить ответ |
| POST | `/learning/attempts/:id/files` | S | вложение практического экзамена |
| POST | `/learning/attempts/:id/submit` | S | завершить; для `test` — сразу результат с разбором |
| GET | `/learning/attempts/:id/result` | S | результат, разбор (после `graded`) |

## Обучение — куратор

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/curator/cohorts` | C | мои группы со счётчиками (ожидают проверки, ученики) |
| GET | `/curator/cohorts/:id/students` | C | ученики группы с прогрессом по этапам |
| GET | `/curator/students/:enrollmentId` | C | карточка прогресса ученика |
| GET | `/curator/review-queue` | C | очередь: `?cohortId&stageKey&assignmentKey&status&sort` |
| POST | `/curator/submissions/:id/claim` | C | `submitted → in_review` |
| POST | `/curator/submissions/:id/release` | C | вернуть в очередь |
| POST | `/curator/submissions/:id/review` | C | `{ decision: accepted|returned, comment, rubric? }` |
| GET | `/curator/exam-queue` | C | практические попытки на оценку |
| POST | `/curator/attempts/:id/grade` | C | `{ score, comment }` |

## Администрирование обучения

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET/POST | `/admin/courses` | A | курсы |
| GET/PATCH | `/admin/courses/:id` | A | |
| GET | `/admin/courses/:id/versions` | A | версии |
| GET | `/admin/course-versions/:id` | A | полная структура версии (этапы → уроки, материалы, задания, экзамены) |
| POST | `/admin/courses/:id/draft` | A | создать черновик из последней published |
| POST | `/admin/course-versions/:id/publish` | A | валидация + публикация |
| POST/PATCH/DELETE | `/admin/course-versions/:id/stages[/:stageId]` | A | только draft |
| POST | `/admin/course-versions/:id/stages/reorder` | A | `{ order: [stageId...] }` |
| POST/PATCH/DELETE | `/admin/stages/:id/lessons[/:lessonId]` | A | |
| POST | `/admin/stages/:id/lessons/reorder` | A | |
| POST/PATCH/DELETE | `/admin/lessons/:id/materials[/:materialId]` | A | |
| POST/PATCH/DELETE | `/admin/stages/:id/assignments[/:assignmentId]` | A | |
| POST/PATCH/DELETE | `/admin/stages/:id/exams[/:examId]` | A | |
| POST/PATCH/DELETE | `/admin/exams/:id/questions[/:questionId]` | A | вопрос с вариантами в одном payload |
| POST | `/admin/exams/:id/questions/import` | A | импорт вопросов из CSV/JSON |
| POST | `/admin/videos` | A | начать загрузку видео → `{ videoAssetId, uploadUrl | providerUploadInstructions }` |
| GET | `/admin/videos/:id` | A | статус обработки |
| GET/POST | `/admin/cohorts` | A | группы |
| GET/PATCH | `/admin/cohorts/:id` | A | режим открытия, даты этапов, кураторы |
| POST | `/admin/cohorts/:id/curators` / DELETE `.../:userId` | A | назначить/снять куратора |
| POST | `/admin/cohorts/:id/migrate-version` | A | `{ courseVersionId, dryRun }` → отчёт / выполнение |
| GET | `/admin/cohorts/:id/students` | A | ученики группы с прогрессом |
| POST | `/admin/cohorts/:id/enrollments` | A | зачислить `{ userId, startedAt?, grantValidUntil? }` — создаёт грант курса и зачисление |
| GET | `/admin/students` | A | все ученики: поиск, фильтры по группе, статусу, этапу |
| GET | `/admin/enrollments/:id` | A | карточка прогресса: этапы, уроки, сдачи, попытки, overrides |
| PATCH | `/admin/enrollments/:id` | A | статус (paused/withdrawn/active), `startedAt`, перевод в другую группу |
| POST | `/admin/enrollments/:id/stage-overrides` | A | `{ stageKey, action, reason, expiresAt? }` |
| DELETE | `/admin/stage-overrides/:id` | A | |
| GET | `/admin/review-queue` | A | как у куратора, по всем группам |
| POST | `/admin/submissions/:id/review` | A | |
| POST | `/admin/attempts/:id/grade` | A | |
| POST | `/admin/attempts/:id/cancel` | A | аннулировать попытку с причиной |

## Администрирование платформы

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/admin/dashboard` | A | счётчики: ученики, очередь проверок, истекающие доступы, ошибки клуба, состояние worker |
| GET | `/admin/users` | A | поиск по имени/username/telegram id/телефону |
| GET | `/admin/users/:id` | A | профиль, роли, зачисления, мастерские (названия и роли, без данных CRM), гранты, клуб, сессии |
| POST/DELETE | `/admin/users/:id/platform-roles` | A | назначить/снять admin/curator |
| POST | `/admin/users/:id/ban` / `/unban` | A | |
| POST | `/admin/users/:id/revoke-sessions` | A | |
| GET | `/admin/access-grants` | A | фильтры: продукт, статус, истекающие до даты, пользователь, мастерская |
| POST | `/admin/access-grants` | A | выдать `{ product, userId|workspaceId, courseId?, validFrom, validUntil, reason, externalRef? }` |
| POST | `/admin/access-grants/:id/extend` | A | `{ validUntil, reason }` |
| POST | `/admin/access-grants/:id/revoke` | A | `{ reason }` — немедленные следствия (клуб, CRM read-only) |
| POST | `/admin/access-grants/:id/suspend` / `/resume` | A | |
| GET | `/admin/workspaces` | A | список мастерских: название, владелец, участники, статус CRM-доступа, счётчики (без содержимого CRM) |
| POST | `/admin/workspaces` | A | создать мастерскую для владельца `{ name, ownerUserId, timezone, currency }` |
| PATCH | `/admin/workspaces/:id` | A | название, архив |
| GET | `/admin/club/members` | A | членства и статусы, ошибки |
| POST | `/admin/club/members/:userId/resync` | A | повторить операцию |
| GET | `/admin/audit` | A | платформенный журнал: фильтры по актору, сущности, периоду |
| POST | `/admin/exports` | A | `{ kind, params }` |
| GET | `/admin/exports[/:id]` | A | статус, ссылка |
| GET | `/admin/jobs` | A | состояние очередей, неудачные задачи; POST `/admin/jobs/:id/retry` |

---

## Мастерская (CRM)

Все пути под `/workspaces/:workspaceId/...`; guard проверяет членство и действующий CRM-доступ (при истёкшем — только GET и экспорт).

### Мастерская и сотрудники

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id` | O, E | настройки, доступ, участники (сотрудник видит список) |
| PATCH | `/workspaces/:id` | O | название, часовой пояс, рабочие часы, настройки прав сотрудников |
| GET | `/workspaces/:id/members` | O, E | |
| PATCH | `/workspaces/:id/members/:memberId` | O | display_name, color, is_active |
| POST | `/workspaces/:id/members/:memberId/transfer-ownership` | O | передача владения (подтверждение кодом в боте) |
| POST | `/workspaces/:id/invitations` | O | `{ role, phone?, expiresInDays }` → `{ deepLink }` |
| GET | `/workspaces/:id/invitations` | O | активные приглашения |
| DELETE | `/workspaces/:id/invitations/:invId` | O | отозвать |
| POST | `/invitations/accept` | * | `{ token }` — принять приглашение (из `startAction`) |
| GET | `/workspaces/:id/today` | O, E | сводка «Сегодня»: записи на сегодня, активные заказы, задолженность (сотрудник — только свои) |

### Клиенты и автомобили

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id/clients` | O, E | `?q=` (имя/телефон/номер авто), `?archived=` |
| POST | `/workspaces/:id/clients` | O, E | |
| GET | `/workspaces/:id/clients/:clientId` | O, E | клиент, автомобили, история заказов, долг |
| PATCH | `/workspaces/:id/clients/:clientId` | O, E | |
| POST | `/workspaces/:id/clients/:clientId/archive` / `/unarchive` | O | |
| POST | `/workspaces/:id/clients/:clientId/anonymize` | O | удаление ПДн: имя → «Клиент #N», телефон/заметки очищаются, заказы и оплаты остаются |
| POST | `/workspaces/:id/clients/:clientId/merge` | O | объединить дубли `{ intoClientId }` |
| GET/POST | `/workspaces/:id/clients/:clientId/vehicles` | O, E | |
| GET/PATCH | `/workspaces/:id/vehicles/:vehicleId` | O, E | автомобиль, история ремонтов |
| POST | `/workspaces/:id/vehicles/:vehicleId/archive` | O | |

### Заказы

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id/orders` | O, E | `?status[]=&assigneeMemberId=&paymentStatus=&q=&from=&to=&sort=` (сотрудник: по умолчанию свои, может видеть все — настройка `employees_see_all_orders`) |
| POST | `/workspaces/:id/orders` | O, E | `{ clientId | newClient, vehicleId | newVehicle, title, assigneeMemberId?, appointment? }` — создание заказа вместе с клиентом/авто/записью в одной транзакции |
| GET | `/workspaces/:id/orders/:orderId` | O, E | карточка: клиент, авто, исполнитель, статус, история, записи, сметы (все версии), согласованная, фото по категориям, оплаты, остаток |
| PATCH | `/workspaces/:id/orders/:orderId` | O, E | title, damage_summary, заметки, vehicle, assignee (сотрудник — не может переназначить) |
| POST | `/workspaces/:id/orders/:orderId/transition` | O, E | `{ to, comment? }` |
| POST | `/workspaces/:id/orders/:orderId/archive` | O | |
| GET | `/workspaces/:id/orders/:orderId/history` | O, E | |
| GET | `/workspaces/:id/orders/:orderId/photos` | O, E | по категориям, с URL миниатюр (подписанные, короткоживущие) |
| POST | `/workspaces/:id/orders/:orderId/photos` | O, E | `{ fileId, category, estimateItemId?, caption? }` |
| PATCH/DELETE | `/workspaces/:id/orders/:orderId/photos/:photoId` | O, E | категория, подпись, порядок / удалить |
| GET | `/workspaces/:id/orders/:orderId/photos/:photoId/download` | O, E | подписанная ссылка на оригинал |

### Календарь

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id/appointments` | O, E | `?from=&to=&assigneeMemberId=` (обязательный диапазон ≤ 62 дней) |
| POST | `/workspaces/:id/appointments` | O, E | `{ orderId?, clientId?, assigneeMemberId, startsAtLocal, durationMin, kind, note, allowOverlap? }` → 409 `overlap` с конфликтами |
| PATCH | `/workspaces/:id/appointments/:apptId` | O, E | перенос, смена исполнителя, длительность |
| POST | `/workspaces/:id/appointments/:apptId/status` | O, E | confirmed / done / cancelled / no_show |
| GET | `/workspaces/:id/appointments/availability` | O, E | свободные слоты исполнителя на день по рабочим часам |

### Сметы и прайс

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET/POST/PATCH/DELETE | `/workspaces/:id/price-list[/:itemId]` | O (E — только GET) | прайс |
| POST | `/workspaces/:id/orders/:orderId/estimates` | O, E | новая смета (draft), опционально из предыдущей версии |
| GET | `/workspaces/:id/estimates/:estimateId` | O, E | |
| PATCH | `/workspaces/:id/estimates/:estimateId` | O, E | скидка, заметки (только draft/sent) |
| PUT | `/workspaces/:id/estimates/:estimateId/items` | O, E | полная замена списка позиций (draft/sent); сервер пересчитывает итоги |
| POST | `/workspaces/:id/estimates/:estimateId/send` | O, E | `draft → sent` (отправлена клиенту устно/мессенджером; фиксируется факт) |
| POST | `/workspaces/:id/estimates/:estimateId/agree` | O, E* | согласовать (Idempotency-Key) |
| POST | `/workspaces/:id/estimates/:estimateId/reject` | O, E | |
| POST | `/workspaces/:id/estimates/:estimateId/new-version` | O, E | копия в draft |
| GET | `/workspaces/:id/estimates/:estimateId/pdf` | O, E | печатная форма сметы (HTML→PDF на сервере) для отправки клиенту |

### Оплаты

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id/orders/:orderId/payments` | O, E | записи и остаток |
| POST | `/workspaces/:id/orders/:orderId/payments` | O, E* | `{ kind, amountMinor, method, purpose, occurredAt, note, correctsEntryId? }` (Idempotency-Key) |
| GET | `/workspaces/:id/payments` | O | журнал оплат за период, фильтры по методу/сотруднику |
| GET | `/workspaces/:id/debts` | O, E | заказы с задолженностью |

`E*` — если разрешено настройками мастерской.

### Аналитика и экспорт

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/workspaces/:id/analytics/summary` | O | `?from=&to=&assigneeMemberId=` → показатели из `04-backend.md` |
| GET | `/workspaces/:id/analytics/series` | O | те же показатели по дням/неделям для графиков |
| GET | `/workspaces/:id/analytics/employees` | O | заказы/поступления по исполнителям |
| GET | `/workspaces/:id/audit` | O | журнал действий мастерской |
| POST | `/workspaces/:id/exports` | O | `{ kind, includePhotos? }` |
| GET | `/workspaces/:id/exports[/:exportId]` | O | статус, ссылка |

---

## Файлы

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| POST | `/files/presign-upload` | * | `{ scope, workspaceId?, mimeType, sizeBytes, originalName }` → проверка права на scope и лимитов → `{ fileId, uploadUrl, headers, expiresAt }` (multipart для видео > 50 МБ: `{ uploadId, partUrls[] }`) |
| POST | `/files/:id/complete` | * | подтверждение загрузки (`{ parts? }` для multipart) → статус `uploaded`, задача `files.process` |
| GET | `/files/:id` | владелец контекста | метаданные, статус обработки |
| GET | `/files/:id/url?variant=thumb|original` | владелец контекста | подписанная ссылка (TTL 5 минут) после проверки доступа по привязке файла |
| DELETE | `/files/:id` | владелец контекста | только непривязанные или через владельца сущности |

Проверка доступа к файлу: по `scope` и привязке — `order_photo` → участник мастерской заказа; `submission` → ученик-автор, куратор группы, админ; `lesson_material` → зачисленный с открытым этапом, куратор, админ; `export` → заказавший.

## Клуб

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| GET | `/club` | * | статус доступа, статус членства, `canJoin`, `inviteLink` (только при действующем гранте) |
| POST | `/club/join-link` | * | сгенерировать/вернуть ссылку с заявкой (`creates_join_request=true`) |
| POST | `/club/leave` | * | (опционально) пометить выход |

## Telegram

| Метод | Путь | Кто | Описание |
|-------|------|-----|----------|
| POST | `/telegram/webhook/:secret` | Telegram | входящие обновления (проверяется `secret` в пути и заголовок `X-Telegram-Bot-Api-Secret-Token`) |

## Служебные

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health`, `/health/ready` | liveness/readiness |
| GET | `/docs` | OpenAPI (staging/local) |

---

## Реализация редактора курса (этап 5)

- Структура курса живёт внутри **версии**. Редактируется только версия со статусом `draft`; любая попытка изменить опубликованную отвечает `409 version_immutable`. Так правка материалов не может повлиять на идущие группы.
- Публикация проходит через `validateForPublish`, который возвращает **список** проблем, а не первую ошибку: администратор видит в одном окне все причины, по которым курс не готов. Проверяются пустые этапы, обязательные уроки без видео, необработанное видео, тесты без вопросов, вопросы без правильных ответов, несколько правильных ответов в вопросе с одним выбором, выборка больше банка вопросов, пороги вне диапазона.
- После успешной публикации автоматически создаётся следующий черновик — полная копия опубликованной версии с сохранением ключей (`stage-1`, `light`, `practice-1`). Именно ключи, а не идентификаторы, связывают прогресс ученика со структурой, поэтому смена версии не обнуляет пройденное.
- Порядок элементов меняется в два прохода внутри транзакции (сначала во временный отрицательный диапазон), иначе уникальный индекс по `(родитель, позиция)` не пропустит перестановку.
- Вопрос сохраняется вместе с вариантами одним запросом; замена существующего вопроса сохраняет его позицию в тесте.
- Видео: адаптер `VideoProvider` с реализацией Kinescope и заглушкой для разработки. Запись создаётся до загрузки файла, статус опрашивается фоновой задачей. Видео, использованное в уроке, нельзя удалить, пока его не отвяжут.
- Ссылку на воспроизведение выдаёт наш сервер и только после проверки доступа — сам файл в Kinescope приватен.

## Реализация календаря (этап 10)

- `GET /workspaces/:id/appointments` требует диапазон (`from`, `to`) не длиннее 62 дней и отдаёт записи, **пересекающие** его, вместе с `timezone` мастерской и локальным временем каждой записи (`startsAtLocal`, `endsAtLocal`).
- `POST` и `PATCH` принимают время в локальном формате `YYYY-MM-DDTHH:mm` и длительность в минутах: клиент не собирает UTC и не может ошибиться на смещении.
- Конфликт отвечает `409 overlap` с `details.conflicts` (время, клиент, номер заказа) и `details.canOverride`. Повтор с `allowOverlap: true` проходит только у владельца.
- `GET /workspaces/:id/appointments/availability?day=&assigneeMemberId=&durationMin=&stepMin=` возвращает свободные слоты по рабочим часам мастерской, занятые интервалы и длительность по умолчанию.
- `POST /workspaces/:id/orders` принимает `appointment` и создаёт заказ вместе с записью в одной транзакции; карточка заказа отдаёт его записи в поле `appointments`.
