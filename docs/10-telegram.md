# 10. Telegram-интеграция

## Компоненты

| Компонент | Назначение |
|-----------|-----------|
| Бот (grammY, webhook) | вход в Mini App, `/start` с параметрами (приглашения, deep-links, подтверждение веб-входа), уведомления, обработка заявок в клуб, удаление из клуба |
| Mini App | `initData` для авторизации, `start_param`, `requestWriteAccess`, `requestContact`, `MainButton/BackButton`, тема, `openTelegramLink` для share |
| Login Widget | вход в веб-админку |
| Закрытая группа/супергруппа | клуб; бот — администратор с правами приглашать/одобрять и исключать |

Отдельные боты, группы и домены для staging и production.

## Настройка бота (BotFather / Bot API)

- `/newbot`, `/setmenubutton` → Web App URL Mini App (`https://app.<domain>`), `/setdomain` → домен админки (для Login Widget), `/setcommands` (`/start`, `/app`, `/help`).
- `setWebhook(url=https://api.<domain>/v1/telegram/webhook/<secret>, secret_token=..., allowed_updates=[message, callback_query, chat_join_request, chat_member, my_chat_member])`.
- Бот добавлен в группу клуба как администратор с `can_invite_users` (для одобрения заявок) и `can_restrict_members` (для исключения). Ссылка-приглашение создаётся ботом: `createChatInviteLink(chat_id, creates_join_request=true, name='club')`.

## Проверка initData (Mini App)

Алгоритм на сервере (`auth/telegram/init-data.ts`):

1. Разобрать `initData` как query string. Извлечь `hash`. Отклонить, если `hash` или `auth_date` отсутствуют.
2. `data_check_string` = все пары `key=value` (кроме `hash`), отсортированные по `key`, соединённые `\n`.
3. `secret_key = HMAC_SHA256(message=BOT_TOKEN, key="WebAppData")`.
4. `expected = hex(HMAC_SHA256(message=data_check_string, key=secret_key))`; сравнить с `hash` через `timingSafeEqual`.
5. `now - auth_date ≤ TELEGRAM_INITDATA_MAX_AGE_SEC` (300 с). Mini App при долгой работе повторно берёт свежий `initData` только при перезапуске, поэтому наша собственная сессия (refresh-токен) обязательна — initData используется лишь для входа.
6. Из `user` — `id`, `first_name`, `last_name`, `username`, `language_code`, `allows_write_to_pm`, `photo_url`; `start_param` → `startAction`.

`initDataUnsafe`, любые `telegram_user_id` из тела запроса — не доказательство личности и не используются.

## Проверка данных Login Widget (веб-админка)

`data_check_string` из полей `id, first_name, last_name, username, photo_url, auth_date` (все присутствующие, кроме `hash`), отсортированных по ключу; `secret_key = SHA256(BOT_TOKEN)`; `hash == hex(HMAC_SHA256(data_check_string, secret_key))`; `auth_date` не старше `TELEGRAM_LOGIN_MAX_AGE_SEC`. Обратите внимание: ключ для виджета — `SHA256(token)`, для Mini App — `HMAC("WebAppData", token)`; это два разных алгоритма.

## Сценарии бота

| Входящее | Обработка |
|----------|-----------|
| `/start` | приветствие + кнопка «Открыть приложение» (`web_app`); `bot_write_allowed=true` для пользователя (он написал боту первым) |
| `/start login_<code>` | найти `web_login_requests` по коду (pending, не истёк) → сообщение «Подтвердить вход в админку?» с inline-кнопками → callback → `confirmed` с `user_id` |
| `/start inv_<token>` | ответ с кнопкой открыть Mini App с `startapp=inv_<token>` (принятие идёт в Mini App, где есть сессия) |
| `chat_join_request` (chat = клуб) | задача `club.approve` (см. `04-backend.md`) |
| `chat_member` (клуб): пользователь вышел/удалён вручную | обновить `club_memberships.telegram_status` |
| `my_chat_member`: бота удалили из группы / лишили прав | алерт админу в дашборд |
| любое другое сообщение | подсказка открыть приложение |

Бот **не** является интерфейсом продукта: все действия делаются в Mini App. Это упрощает поддержку и не дублирует логику.

## Уведомления

Отправляются через очередь `notifications.send` методом `sendMessage` (HTML-разметка) с inline-кнопкой «Открыть» (`web_app` или `url` с `startapp=`), ведущей на нужный экран:

| Тип | Кому | Триггер | Deep-link |
|-----|------|---------|-----------|
| `review_result` | ученик | решение куратора | сдача |
| `submission_comment` | ученик / куратор | новый комментарий | сдача |
| `exam_graded` | ученик | оценка практического экзамена | результат |
| `stage_unlocked` | ученик | этап стал доступен (по выполнению или по дате) | этап |
| `access_expiring` | пользователь / владелец | за 7 и 1 день | профиль / настройки |
| `access_revoked` | пользователь / владелец | отзыв | профиль |
| `club_removed` | пользователь | исключение из клуба | клуб |
| `appointment_reminder` | исполнитель | за N минут до записи | заказ / календарь |
| `order_assigned` | сотрудник | назначение | заказ |
| `invitation_accepted` | владелец | сотрудник принял приглашение | сотрудники |
| `export_ready` | заказавший | готов экспорт | экспорт |
| `review_queue_digest` | куратор | ежедневно утром, если очередь непуста (по настройке) | очередь |

Правила: отправка только пользователям с `bot_write_allowed=true` и `is_bot_blocked=false`; 403 «bot was blocked» → `is_bot_blocked=true`, дальнейшие отправки `skipped` до следующего `/start`; 429 → пауза по `retry_after`; ошибка уведомления никогда не откатывает бизнес-операцию (постановка в очередь — в транзакции, отправка — отдельно). Пользователь управляет типами в настройках.

## Клуб — детали

- Ссылка одна на группу, с заявкой (`creates_join_request`). Её можно пересылать — без действующего гранта заявка будет отклонена, и это не создаёт риска.
- Одобрение: `approveChatJoinRequest(chat_id, user_id)`; отклонение: `declineChatJoinRequest`. Отклонённому пользователю бот отправляет сообщение (если может) «Для вступления нужен действующий доступ к клубу».
- Исключение: `banChatMember(chat_id, user_id)` затем `unbanChatMember(chat_id, user_id, only_if_banned=true)` — пользователь удалён, но сможет подать заявку снова после продления. Задача повторяется при ошибках сети/429; при 400 (пользователь уже не участник) — статус синхронизируется без ошибки.
- Ежедневная сверка через `getChatMember` для всех `member` в нашей базе (пользователей, вступивших мимо бота, Bot API перечислить не позволяет — поэтому отчёт строится от нашей базы и от событий `chat_member`).
- Администратор видит в админке: статус каждого членства, ошибки, кнопки «Повторить», «Одобрить вручную», «Исключить вручную».

## Ограничения Telegram, учтённые в дизайне

- Бот пишет пользователю только после того, как тот запустил бота или разрешил `requestWriteAccess` в Mini App → баннер в приложении и `bot_write_allowed`.
- Телефон не приходит из авторизации → `requestContact` в Mini App (нужен для приглашений с ограничением по номеру и для профиля), или ручной ввод.
- `username` может измениться → используется только для отображения и поиска; идентификатор — `telegram_user_id`.
- Mini App WebView на iOS ограничивает автозапуск видео со звуком и фоновые загрузки → плеер стартует по тапу, загрузки идут пока приложение открыто, при сворачивании очередь возобновляется.
- Продажа цифровых товаров и услуг внутри Telegram обязана использовать Telegram Stars → в 1.0 продажи идут вне Telegram с ручной выдачей доступа; модуль `billing` со Stars — следующий этап.

---

## Реализация (этап 1)

- `apps/api/src/infra/telegram/init-data.ts` — чистые функции проверки (`verifyInitData`, `verifyLoginWidget`) и подписи (`signInitData`, `signLoginWidget` — для тестов и локальной разработки). Покрыты 14 модульными тестами, включая подмену поля при сохранённом `hash` и попытку проверить данные виджета алгоритмом Mini App.
- Сессия: access-токен — компактный JWT (HS256) на 15 минут, содержит только `sub`, `sid`, `kind`; refresh — непрозрачные 32 байта, в базе хранится sha256. Роли и доступы в токен не попадают, поэтому отзыв и бан действуют с первого следующего запроса.
- Ротация refresh: старая сессия помечается `replacedById`. Повторное использование обменянного токена трактуется как компрометация и отзывает **все** сессии пользователя.
- `SessionGuard` подключён глобально: новый маршрут закрыт по умолчанию, открывается явным `@Public()`.
- Вебхук проверяет секрет дважды (в пути и в заголовке `X-Telegram-Bot-Api-Secret-Token`), сравнение — константное по времени. Повторная доставка одного `update_id` отбрасывается таблицей `telegram_updates`.
- Ограничение частоты — `RateLimitGuard` в памяти процесса: 30 входов из Mini App в минуту с адреса, 20 через виджет, 10 запросов кода. При горизонтальном масштабировании счётчик переносится в PostgreSQL.
