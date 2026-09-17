import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  createPublishedCourse,
  createReadySubmissionFile,
  createUser,
  createWorkspace,
  enrollStudent,
  type TestUser,
} from './helpers/factories';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { ClubService } from '@/modules/club/club.service';
import { ExportService } from '@/modules/export/export.service';

/**
 * Сквозные сценарии F1–F10 из docs/07-user-flows.md на уровне API.
 *
 * Проверка на реальных устройствах (Telegram iOS/Android/Desktop) остаётся
 * ручной: она про клиент Telegram, а не про наш сервер. Здесь каждый сценарий
 * проходит целиком тем же путём, которым его проходит интерфейс.
 */
describe('сквозные сценарии F1–F10', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let curator: TestUser;
  let student: TestUser;
  let master: TestUser;
  let employee: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'], firstName: 'Админ' });
    curator = await createUser(ctx, { platformRoles: ['curator'], firstName: 'Куратор' });
    student = await createUser(ctx, { firstName: 'Ученик' });
    master = await createUser(ctx, { firstName: 'Мастер' });
    employee = await createUser(ctx, { firstName: 'Сотрудник' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('F1: первый вход показывает, что доступно пользователю', async () => {
    const empty = await http()
      .get('/v1/me')
      .set(...master.authHeader)
      .expect(200);
    expect(empty.body.enrollments ?? []).toHaveLength(0);
    expect(empty.body.workspaces ?? []).toHaveLength(0);

    const ws = await createWorkspace(ctx, { ownerUserId: master.id, name: 'Мастерская' });
    const course = await createPublishedCourse(ctx, { adminId: admin.id });
    await enrollStudent(ctx, {
      cohortId: course.cohortId,
      courseId: course.courseId,
      userId: master.id,
      grantedById: admin.id,
    });

    const full = await http()
      .get('/v1/me')
      .set(...master.authHeader)
      .expect(200);
    expect(full.body.workspaces.map((w: { id: string }) => w.id)).toContain(ws.id);
    expect(full.body.enrollments.length).toBe(1);
  });

  it('F2 и F3: ученик сдаёт работу, куратор возвращает и принимает, этап засчитывается', async () => {
    const course = await createPublishedCourse(ctx, {
      adminId: admin.id,
      stages: [
        {
          key: 'stage-1',
          title: 'База',
          unlockDaysOffset: 0,
          lessons: ['light'],
          assignments: [{ key: 'practice-1', title: 'Первая вмятина', minPhotos: 1 }],
        },
        { key: 'stage-2', title: 'Сложное', unlockDaysOffset: 0, lessons: ['hail'] },
      ],
    });
    const enrollmentId = await enrollStudent(ctx, {
      cohortId: course.cohortId,
      courseId: course.courseId,
      userId: student.id,
      grantedById: admin.id,
    });
    await ctx.prisma.cohortCurator.create({
      data: { cohortId: course.cohortId, userId: curator.id },
    });

    // Урок пройден.
    await http()
      .post(`/v1/learning/enrollments/${enrollmentId}/lessons/light/complete`)
      .set(...student.authHeader)
      .expect(201);

    // Работа сдана.
    const submit = async (): Promise<string> => {
      const draft = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      const submissionId = draft.body.submissionId;
      const fileId = await createReadySubmissionFile(ctx, student.id);
      await http()
        .post(`/v1/learning/submissions/${submissionId}/files`)
        .set(...student.authHeader)
        .send({ fileId })
        .expect(201);
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);
      return submissionId;
    };

    const first = await submit();

    // Куратор берёт в работу и возвращает.
    await http()
      .post(`/v1/curator/submissions/${first}/claim`)
      .set(...curator.authHeader)
      .expect(204);
    await http()
      .post(`/v1/curator/submissions/${first}/review`)
      .set(...curator.authHeader)
      .send({ decision: 'returned', comment: 'Виден след от крючка, переделайте' })
      .expect(204);

    const returned = await ctx.prisma.submission.findUniqueOrThrow({ where: { id: first } });
    expect(returned.status).toBe('returned');
    expect(
      await ctx.prisma.notification.count({
        where: { userId: student.id, type: 'review_result' },
      }),
    ).toBe(1);

    // Пересдача принимается, этап закрывается.
    const second = await submit();
    await http()
      .post(`/v1/curator/submissions/${second}/claim`)
      .set(...curator.authHeader)
      .expect(204);
    await http()
      .post(`/v1/curator/submissions/${second}/review`)
      .set(...curator.authHeader)
      .send({ decision: 'accepted', comment: 'Принято' })
      .expect(204);

    const map = await http()
      .get(`/v1/learning/enrollments/${enrollmentId}`)
      .set(...student.authHeader)
      .expect(200);
    const stage1 = map.body.stages.find((s: { key: string }) => s.key === 'stage-1');
    expect(stage1.access.status).toBe('completed');
  });

  it('F4: заказ проходит путь от записи до выдачи с долгом и доплатой', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: master.id, name: 'Кузовной цех' });
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    // Запись и заказ одной операцией.
    const order = await http()
      .post(`/v1/workspaces/${ws.id}/orders`)
      .set(...master.authHeader)
      .send({
        newClient: { name: 'Иван Петров', phone: '89991234567' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град на капоте',
        appointment: { startsAtLocal: `${day}T10:00`, durationMin: 120, kind: 'inspection' },
      })
      .expect(201);

    // Смета: набор, отправка, согласование.
    const estimate = await http()
      .post(`/v1/workspaces/${ws.id}/orders/${order.body.id}/estimates`)
      .set(...master.authHeader)
      .send({})
      .expect(201);
    await http()
      .put(`/v1/workspaces/${ws.id}/estimates/${estimate.body.id}/items`)
      .set(...master.authHeader)
      .send({
        items: [
          {
            panelCode: 'hood',
            damageType: 'hail',
            quantity: 12,
            sizeClass: 'S',
            unitPriceMinor: 90000,
          },
        ],
      })
      .expect(200);
    await http()
      .post(`/v1/workspaces/${ws.id}/estimates/${estimate.body.id}/send`)
      .set(...master.authHeader)
      .expect(201);

    const afterSend = await http()
      .get(`/v1/workspaces/${ws.id}/orders/${order.body.id}`)
      .set(...master.authHeader)
      .expect(200);
    expect(afterSend.body.status).toBe('pending_approval');

    await http()
      .post(`/v1/workspaces/${ws.id}/estimates/${estimate.body.id}/agree`)
      .set(...master.authHeader)
      .expect(201);

    // Предоплата.
    await http()
      .post(`/v1/workspaces/${ws.id}/orders/${order.body.id}/payments`)
      .set(...master.authHeader)
      .send({ amountMinor: 300000, method: 'cash' })
      .expect(201);

    // Работа и выдача с долгом.
    for (const to of ['in_progress', 'ready', 'delivered']) {
      await http()
        .post(`/v1/workspaces/${ws.id}/orders/${order.body.id}/transition`)
        .set(...master.authHeader)
        .send({ to })
        .expect(201);
    }

    const beforeFinal = await http()
      .get(`/v1/workspaces/${ws.id}/orders/${order.body.id}/payments`)
      .set(...master.authHeader)
      .expect(200);
    expect(beforeFinal.body.remainingMinor).toBe(780000);

    // Доплата закрывает остаток.
    const final = await http()
      .post(`/v1/workspaces/${ws.id}/orders/${order.body.id}/payments`)
      .set(...master.authHeader)
      .send({ amountMinor: 780000, purpose: 'final' })
      .expect(201);
    expect(final.body.paymentStatus).toBe('paid');

    const afterFinal = await http()
      .get(`/v1/workspaces/${ws.id}/orders/${order.body.id}/payments`)
      .set(...master.authHeader)
      .expect(200);
    expect(afterFinal.body.remainingMinor).toBe(0);
  });

  it('F5: владелец приглашает сотрудника и назначает ему заказ', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: master.id, name: 'Кузовной цех' });

    const invitation = await http()
      .post(`/v1/workspaces/${ws.id}/invitations`)
      .set(...master.authHeader)
      .send({ role: 'employee', expiresInDays: 7 })
      .expect(201);
    expect(invitation.body.deepLink).toContain('startapp=');

    const token = invitation.body.deepLink.split('inv_')[1];
    await http()
      .post('/v1/invitations/accept')
      .set(...employee.authHeader)
      .send({ token })
      .expect(201);

    const members = await http()
      .get(`/v1/workspaces/${ws.id}/members`)
      .set(...master.authHeader)
      .expect(200);
    const employeeMember = members.body.find((m: { userId: string }) => m.userId === employee.id);
    expect(employeeMember).toBeTruthy();

    const order = await http()
      .post(`/v1/workspaces/${ws.id}/orders`)
      .set(...master.authHeader)
      .send({ newClient: { name: 'Клиент' }, title: 'Дверь' })
      .expect(201);

    await http()
      .patch(`/v1/workspaces/${ws.id}/orders/${order.body.id}`)
      .set(...master.authHeader)
      .send({ assigneeMemberId: employeeMember.id })
      .expect(200);

    expect(
      await ctx.prisma.notification.count({
        where: { userId: employee.id, type: 'order_assigned' },
      }),
    ).toBe(1);

    // Сотрудник видит назначенный заказ.
    const visible = await http()
      .get(`/v1/workspaces/${ws.id}/orders/${order.body.id}`)
      .set(...employee.authHeader)
      .expect(200);
    expect(visible.body.assignee.id).toBe(employeeMember.id);
  });

  it('F6: администратор выдаёт, продлевает и отзывает доступ', async () => {
    const granted = await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'club', userId: master.id, reason: 'Оплата 001' })
      .expect(201);

    const status = await http()
      .get('/v1/club/status')
      .set(...master.authHeader)
      .expect(200);
    expect(status.body.hasAccess).toBe(true);

    await http()
      .post(`/v1/admin/access-grants/${granted.body.id}/extend`)
      .set(...admin.authHeader)
      .send({
        validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        reason: 'Продление',
      })
      .expect(201);

    await http()
      .post(`/v1/admin/access-grants/${granted.body.id}/revoke`)
      .set(...admin.authHeader)
      .send({ reason: 'Возврат оплаты' })
      .expect(201);

    const revoked = await http()
      .get('/v1/club/status')
      .set(...master.authHeader)
      .expect(200);
    expect(revoked.body.hasAccess).toBe(false);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: master.id, type: 'access_revoked' },
      }),
    ).toBe(1);
  });

  it('F7: вступление в клуб, исключение и возвращение после продления', async () => {
    const telegram = ctx.app.get(TelegramService);
    vi.spyOn(telegram, 'approveChatJoinRequest').mockResolvedValue({ ok: true, messageId: 1 });
    vi.spyOn(telegram, 'declineChatJoinRequest').mockResolvedValue({ ok: true, messageId: 1 });
    vi.spyOn(telegram, 'banChatMember').mockResolvedValue({ ok: true, messageId: 1 });
    vi.spyOn(telegram, 'unbanChatMember').mockResolvedValue({ ok: true, messageId: 1 });
    const club = ctx.app.get(ClubService);

    // Без доступа заявка отклоняется.
    await club.processJoinRequest(master.id, String(master.telegramUserId));
    expect(
      (await ctx.prisma.clubMembership.findUniqueOrThrow({ where: { userId: master.id } }))
        .telegramStatus,
    ).toBe('declined');

    // С доступом — одобряется.
    const grant = await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'club', userId: master.id, reason: 'Оплата' })
      .expect(201);
    await club.processJoinRequest(master.id, String(master.telegramUserId));
    expect(
      (await ctx.prisma.clubMembership.findUniqueOrThrow({ where: { userId: master.id } }))
        .telegramStatus,
    ).toBe('member');

    // Отзыв исключает.
    await http()
      .post(`/v1/admin/access-grants/${grant.body.id}/revoke`)
      .set(...admin.authHeader)
      .send({ reason: 'Не продлил' })
      .expect(201);
    await club.removeMember(master.id, 'access_revoked');
    expect(
      (await ctx.prisma.clubMembership.findUniqueOrThrow({ where: { userId: master.id } }))
        .telegramStatus,
    ).toBe('removed');

    // Продление возвращает возможность вступить.
    await ctx.prisma.accessGrant.update({
      where: { id: grant.body.id },
      data: { status: 'active', validUntil: new Date(Date.now() + 30 * 86_400_000) },
    });
    await club.processJoinRequest(master.id, String(master.telegramUserId));
    expect(
      (await ctx.prisma.clubMembership.findUniqueOrThrow({ where: { userId: master.id } }))
        .telegramStatus,
    ).toBe('member');

    vi.restoreAllMocks();
  });

  it('F8: в админку пускает только пользователя с ролью платформы', async () => {
    await http()
      .get('/v1/admin/dashboard')
      .set(...admin.authHeader)
      .expect(200);

    await http()
      .get('/v1/admin/dashboard')
      .set(...master.authHeader)
      .expect(403);

    // Куратор видит очередь проверок, но не управление доступами.
    await http()
      .get('/v1/curator/review-queue')
      .set(...curator.authHeader)
      .expect(200);
    await http()
      .get('/v1/admin/access-grants')
      .set(...curator.authHeader)
      .expect(403);
  });

  it('F9: повторы не создают дублей, а блокировка бота не ломает операцию', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: master.id, name: 'Кузовной цех' });
    const key = '33333333-4444-5555-6666-777777777777';

    const body = { newClient: { name: 'Иван' }, title: 'Крыло' };
    const first = await http()
      .post(`/v1/workspaces/${ws.id}/orders`)
      .set(...master.authHeader)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await http()
      .post(`/v1/workspaces/${ws.id}/orders`)
      .set(...master.authHeader)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(await ctx.prisma.order.count({ where: { workspaceId: ws.id } })).toBe(1);

    // Бот заблокирован: уведомление помечается пропущенным, операция завершена.
    const telegram = ctx.app.get(TelegramService);
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({
      ok: false,
      kind: 'blocked',
      error: 'bot was blocked by the user',
    });

    const employeeMemberId = await (async () => {
      const invitation = await http()
        .post(`/v1/workspaces/${ws.id}/invitations`)
        .set(...master.authHeader)
        .send({ role: 'employee', expiresInDays: 7 })
        .expect(201);
      await http()
        .post('/v1/invitations/accept')
        .set(...employee.authHeader)
        .send({ token: invitation.body.deepLink.split('inv_')[1] })
        .expect(201);
      const members = await http()
        .get(`/v1/workspaces/${ws.id}/members`)
        .set(...master.authHeader)
        .expect(200);
      return members.body.find((m: { userId: string }) => m.userId === employee.id).id;
    })();

    await http()
      .patch(`/v1/workspaces/${ws.id}/orders/${first.body.id}`)
      .set(...master.authHeader)
      .send({ assigneeMemberId: employeeMemberId })
      .expect(200);

    const updated = await ctx.prisma.order.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(updated.assigneeMemberId).toBe(employeeMemberId);
    vi.restoreAllMocks();
  });

  it('F10: владелец выгружает базу и удаляет персональные данные клиента', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: master.id, name: 'Кузовной цех' });
    const order = await http()
      .post(`/v1/workspaces/${ws.id}/orders`)
      .set(...master.authHeader)
      .send({
        newClient: { name: 'Иван Петров', phone: '89991234567' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град',
      })
      .expect(201);

    const requested = await http()
      .post(`/v1/workspaces/${ws.id}/exports`)
      .set(...master.authHeader)
      .send({ kind: 'crm_full' })
      .expect(201);
    await ctx.app.get(ExportService).run(requested.body.id);

    const ready = await http()
      .get(`/v1/workspaces/${ws.id}/exports/${requested.body.id}`)
      .set(...master.authHeader)
      .expect(200);
    expect(ready.body.ready).toBe(true);

    const created = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    await http()
      .post(`/v1/workspaces/${ws.id}/clients/${created.clientId}/anonymize`)
      .set(...master.authHeader)
      .expect(201);

    const client = await ctx.prisma.client.findUniqueOrThrow({ where: { id: created.clientId } });
    expect(client.phone).toBeNull();
    expect(client.anonymizedAt).not.toBeNull();
    // Заказ и его сумма остаются: это финансовая запись.
    expect(await ctx.prisma.order.count({ where: { workspaceId: ws.id } })).toBe(1);
  });
});
