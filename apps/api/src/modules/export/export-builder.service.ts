import { Inject, Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import type { ExportKind } from '@prisma/client';
import { damageTypeLabel, panelLabel } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { STORAGE_PROVIDER } from '@/infra/storage/storage.module';
import type { StorageProvider } from '@/infra/storage/storage.types';
import { buildCsv, minorToMajor, type CsvValue } from './csv';

export interface BuiltExport {
  body: Buffer;
  contentType: string;
  fileName: string;
  rowCount: number;
}

export interface ExportRequest {
  kind: ExportKind;
  workspaceId: string | null;
  params: Record<string, unknown>;
}

/**
 * Сборка выгрузок. Данные CRM всегда ограничены мастерской запроса:
 * экспорт — такой же доступ к данным, как чтение через API.
 */
@Injectable()
export class ExportBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async build(request: ExportRequest): Promise<BuiltExport> {
    switch (request.kind) {
      case 'crm_clients':
        return this.singleCsv('clients', await this.clientsCsv(this.requireWorkspace(request)));
      case 'crm_orders':
        return this.singleCsv('orders', await this.ordersCsv(this.requireWorkspace(request)));
      case 'crm_payments':
        return this.singleCsv('payments', await this.paymentsCsv(this.requireWorkspace(request)));
      case 'crm_full':
        return this.crmFull(this.requireWorkspace(request), request.params);
      case 'learning_students':
        return this.singleCsv('students', await this.studentsCsv(request.params));
      case 'learning_progress':
        return this.singleCsv('progress', await this.progressCsv(request.params));
      case 'audit':
        return this.singleCsv('audit', await this.auditCsv(request.params));
      default:
        throw AppError.validation('Неизвестный вид выгрузки');
    }
  }

  private requireWorkspace(request: ExportRequest): string {
    if (!request.workspaceId) throw AppError.validation('Для этой выгрузки нужна мастерская');
    return request.workspaceId;
  }

  private singleCsv(name: string, built: { csv: string; rows: number }): BuiltExport {
    return {
      body: Buffer.from(built.csv, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${name}.csv`,
      rowCount: built.rows,
    };
  }

  // ── CRM ───────────────────────────────────────────────────────────────────

  private async clientsCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const clients = await this.prisma.client.findMany({
      where: { workspaceId },
      include: { vehicles: true },
      orderBy: { createdAt: 'asc' },
    });

    const rows: CsvValue[][] = clients.map((client) => [
      client.id,
      client.name,
      client.phone,
      client.phoneExtra,
      client.telegramUsername,
      client.source,
      client.tags.join(', '),
      client.vehicles
        .map((v) => `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ''}`)
        .join('; '),
      client.notes,
      client.archivedAt,
      client.anonymizedAt !== null,
      client.createdAt,
    ]);

    return {
      csv: buildCsv(
        [
          'id',
          'имя',
          'телефон',
          'доп. телефон',
          'telegram',
          'источник',
          'метки',
          'автомобили',
          'заметки',
          'архив',
          'обезличен',
          'создан',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async vehiclesCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { workspaceId },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const rows: CsvValue[][] = vehicles.map((vehicle) => [
      vehicle.id,
      vehicle.client.name,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.color,
      vehicle.plate,
      vehicle.vin,
      vehicle.bodyType,
      vehicle.archivedAt,
    ]);

    return {
      csv: buildCsv(
        ['id', 'клиент', 'марка', 'модель', 'год', 'цвет', 'госномер', 'vin', 'кузов', 'архив'],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async ordersCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const orders = await this.prisma.order.findMany({
      where: { workspaceId },
      include: {
        client: { select: { name: true, phone: true } },
        vehicle: { select: { make: true, model: true, plate: true } },
        assignee: {
          select: { displayName: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { number: 'asc' },
    });

    const rows: CsvValue[][] = orders.map((order) => [
      order.number,
      order.status,
      order.client.name,
      order.client.phone,
      order.vehicle ? `${order.vehicle.make} ${order.vehicle.model}` : '',
      order.vehicle?.plate ?? '',
      order.assignee?.displayName ??
        [order.assignee?.user.firstName, order.assignee?.user.lastName].filter(Boolean).join(' '),
      order.title,
      order.damageSummary,
      minorToMajor(order.agreedTotalMinor),
      minorToMajor(order.paidMinor),
      minorToMajor(
        order.agreedTotalMinor === null ? null : order.agreedTotalMinor - order.paidMinor,
      ),
      order.paymentStatus,
      order.currency,
      order.scheduledStartAt,
      order.startedAt,
      order.readyAt,
      order.deliveredAt,
      order.cancelledAt,
      order.cancelReason,
      order.createdAt,
    ]);

    return {
      csv: buildCsv(
        [
          'номер',
          'статус',
          'клиент',
          'телефон',
          'автомобиль',
          'госномер',
          'исполнитель',
          'описание',
          'повреждения',
          'согласовано',
          'оплачено',
          'остаток',
          'статус оплаты',
          'валюта',
          'план',
          'начат',
          'готов',
          'выдан',
          'отменён',
          'причина отмены',
          'создан',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async paymentsCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const payments = await this.prisma.paymentEntry.findMany({
      where: { workspaceId },
      include: {
        order: { select: { number: true, client: { select: { name: true } } } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const rows: CsvValue[][] = payments.map((entry) => [
      entry.occurredAt,
      entry.order.number,
      entry.order.client.name,
      entry.kind,
      entry.purpose,
      entry.method,
      minorToMajor(entry.amountMinor),
      entry.currency,
      entry.note,
      [entry.createdBy?.firstName, entry.createdBy?.lastName].filter(Boolean).join(' '),
    ]);

    return {
      csv: buildCsv(
        [
          'дата',
          'заказ',
          'клиент',
          'вид',
          'назначение',
          'способ',
          'сумма',
          'валюта',
          'комментарий',
          'кто принял',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async estimatesCsv(
    workspaceId: string,
  ): Promise<{ estimates: { csv: string; rows: number }; items: { csv: string; rows: number } }> {
    const estimates = await this.prisma.estimate.findMany({
      where: { workspaceId },
      include: { order: { select: { number: true } }, items: { orderBy: { position: 'asc' } } },
      orderBy: [{ orderId: 'asc' }, { versionNo: 'asc' }],
    });

    const estimateRows: CsvValue[][] = estimates.map((estimate) => [
      estimate.order.number,
      estimate.versionNo,
      estimate.status,
      minorToMajor(estimate.subtotalMinor),
      estimate.discountKind,
      estimate.discountValue,
      minorToMajor(estimate.discountMinor),
      minorToMajor(estimate.totalMinor),
      estimate.currency,
      estimate.noteForClient,
      estimate.agreedAt,
      estimate.createdAt,
    ]);

    const itemRows: CsvValue[][] = estimates.flatMap((estimate) =>
      estimate.items.map((item) => [
        estimate.order.number,
        estimate.versionNo,
        item.position,
        item.kind,
        item.title,
        item.panelCode,
        item.damageType,
        item.sizeClass,
        item.quantity,
        item.material,
        item.accessDifficulty,
        item.onEdge,
        minorToMajor(item.unitPriceMinor),
        minorToMajor(item.lineTotalMinor),
        item.comment,
      ]),
    );

    return {
      estimates: {
        csv: buildCsv(
          [
            'заказ',
            'версия',
            'статус',
            'сумма работ',
            'вид скидки',
            'значение скидки',
            'скидка',
            'итого',
            'валюта',
            'комментарий клиенту',
            'согласована',
            'создана',
          ],
          estimateRows,
        ),
        rows: estimateRows.length,
      },
      items: {
        csv: buildCsv(
          [
            'заказ',
            'версия',
            'позиция',
            'вид',
            'наименование',
            'элемент',
            'повреждение',
            'размер',
            'количество',
            'материал',
            'доступ',
            'на ребре',
            'цена',
            'сумма',
            'комментарий',
          ],
          itemRows,
        ),
        rows: itemRows.length,
      },
    };
  }

  private async appointmentsCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const appointments = await this.prisma.appointment.findMany({
      where: { workspaceId },
      include: {
        client: { select: { name: true } },
        order: { select: { number: true } },
        assignee: {
          select: { displayName: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    const rows: CsvValue[][] = appointments.map((appointment) => [
      appointment.startsAt,
      appointment.endsAt,
      Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000),
      appointment.kind,
      appointment.status,
      appointment.client?.name ?? appointment.title,
      appointment.order?.number ?? '',
      appointment.assignee?.displayName ??
        [appointment.assignee?.user.firstName, appointment.assignee?.user.lastName]
          .filter(Boolean)
          .join(' '),
      appointment.note,
      appointment.cancelReason,
    ]);

    return {
      csv: buildCsv(
        [
          'начало',
          'конец',
          'минут',
          'тип',
          'статус',
          'клиент',
          'заказ',
          'исполнитель',
          'заметка',
          'причина отмены',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  /**
   * Обращения и повреждения.
   *
   * Обращение — такая же часть базы мастерской, как заказ, и в выгрузке «вся
   * база одним архивом» его отсутствие означало бы потерю половины воронки.
   * Повреждения отдельным файлом: они относятся и к обращениям, и к заказам.
   */
  private async leadsCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const leads = await this.prisma.lead.findMany({
      where: { workspaceId },
      include: {
        client: { select: { name: true, phone: true } },
        convertedOrder: { select: { number: true } },
        assignee: {
          select: { displayName: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { number: 'asc' },
    });

    const rows: CsvValue[][] = leads.map((lead) => [
      lead.number,
      lead.createdAt,
      lead.status,
      lead.source,
      lead.channel ?? '',
      lead.client?.name ?? lead.contactName,
      lead.client?.phone ?? lead.contactPhone,
      lead.contactExtra,
      [lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' '),
      lead.vehiclePlate,
      lead.estimateMinor === null ? '' : Number(lead.estimateMinor) / 100,
      lead.nextContactAt ?? '',
      lead.rejectReason,
      lead.convertedOrder?.number ?? '',
      lead.assignee?.displayName ??
        [lead.assignee?.user.firstName, lead.assignee?.user.lastName].filter(Boolean).join(' '),
      lead.comment,
    ]);

    return {
      csv: buildCsv(
        [
          'номер',
          'создано',
          'статус',
          'источник',
          'канал',
          'клиент',
          'телефон',
          'контакт',
          'автомобиль',
          'госномер',
          'предварительная оценка',
          'следующий контакт',
          'причина отказа',
          'заказ',
          'ответственный',
          'комментарий',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async damagesCsv(workspaceId: string): Promise<{ csv: string; rows: number }> {
    const damages = await this.prisma.damage.findMany({
      where: { workspaceId },
      include: {
        lead: { select: { number: true } },
        order: { select: { number: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const rows: CsvValue[][] = damages.map((damage) => [
      damage.lead?.number ?? '',
      damage.order?.number ?? '',
      panelLabel(damage.panelCode) ?? damage.panelCode,
      damageTypeLabel(damage.damageType) ?? '',
      damage.sizeClass,
      damage.widthMm === null ? '' : damage.widthMm / 10,
      damage.heightMm === null ? '' : damage.heightMm / 10,
      damage.quantity,
      damage.material ?? '',
      damage.accessDifficulty ?? '',
      damage.onEdge ? 'да' : 'нет',
      damage.priceMinor === null ? '' : Number(damage.priceMinor) / 100,
      damage.priceSource ?? '',
      damage.comment,
    ]);

    return {
      csv: buildCsv(
        [
          'обращение',
          'заказ',
          'элемент кузова',
          'тип повреждения',
          'размер',
          'ширина, см',
          'высота, см',
          'количество',
          'материал',
          'доступ',
          'на ребре',
          'стоимость',
          'источник цены',
          'комментарий',
        ],
        rows,
      ),
      rows: rows.length,
    };
  }

  /** Полная выгрузка мастерской одним архивом. */
  private async crmFull(
    workspaceId: string,
    params: Record<string, unknown>,
  ): Promise<BuiltExport> {
    const zip = new JSZip();
    const [clients, vehicles, orders, payments, appointments, estimates, leads, damages] =
      await Promise.all([
        this.clientsCsv(workspaceId),
        this.vehiclesCsv(workspaceId),
        this.ordersCsv(workspaceId),
        this.paymentsCsv(workspaceId),
        this.appointmentsCsv(workspaceId),
        this.estimatesCsv(workspaceId),
        this.leadsCsv(workspaceId),
        this.damagesCsv(workspaceId),
      ]);

    zip.file('clients.csv', clients.csv);
    zip.file('vehicles.csv', vehicles.csv);
    zip.file('orders.csv', orders.csv);
    zip.file('payments.csv', payments.csv);
    zip.file('appointments.csv', appointments.csv);
    zip.file('estimates.csv', estimates.estimates.csv);
    zip.file('estimate_items.csv', estimates.items.csv);
    zip.file('leads.csv', leads.csv);
    zip.file('damages.csv', damages.csv);
    zip.file(
      'README.txt',
      [
        'Выгрузка данных мастерской PDR.',
        'Файлы в формате CSV (разделитель «;», кодировка UTF-8 с BOM) открываются в Excel.',
        'Суммы указаны в основных единицах валюты.',
        '',
        `Дата выгрузки: ${new Date().toISOString()}`,
      ].join('\n'),
    );

    if (params.includePhotos === true) {
      await this.addPhotos(zip, workspaceId);
    }

    const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return {
      body,
      contentType: 'application/zip',
      fileName: 'crm-export.zip',
      rowCount: clients.rows + orders.rows + payments.rows + leads.rows,
    };
  }

  /**
   * Фотографии складываются по папкам заказов: так их можно смотреть без базы.
   * Снимки обращений, ещё не превратившихся в заказ, лежат отдельной папкой —
   * в выгрузке мастерской они тоже её данные.
   */
  private async addPhotos(zip: JSZip, workspaceId: string): Promise<void> {
    const photos = await this.prisma.orderPhoto.findMany({
      where: { workspaceId },
      include: {
        file: { select: { storageKey: true, mimeType: true, status: true } },
        order: { select: { number: true } },
        lead: { select: { number: true } },
      },
      orderBy: [{ orderId: 'asc' }, { position: 'asc' }],
      take: 2000,
    });

    for (const photo of photos) {
      if (photo.file.status !== 'ready') continue;
      const folder = photo.order
        ? `photos/order-${photo.order.number}`
        : `photos/lead-${photo.lead?.number ?? 'unknown'}`;
      try {
        const body = await this.storage.get(photo.file.storageKey);
        const ext = photo.file.mimeType.split('/')[1] ?? 'jpg';
        zip.file(`${folder}/${photo.category}-${photo.id}.${ext}`, body);
      } catch {
        // Пропавший объект не должен ронять всю выгрузку.
        zip.file(`${folder}/MISSING-${photo.id}.txt`, photo.file.storageKey);
      }
    }
  }

  // ── Обучение и аудит (администратор) ──────────────────────────────────────

  private async studentsCsv(
    params: Record<string, unknown>,
  ): Promise<{ csv: string; rows: number }> {
    const cohortId = typeof params.cohortId === 'string' ? params.cohortId : undefined;
    const enrollments = await this.prisma.enrollment.findMany({
      where: cohortId ? { cohortId } : {},
      include: {
        user: { select: { firstName: true, lastName: true, username: true, phone: true } },
        cohort: { select: { title: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rows: CsvValue[][] = enrollments.map((enrollment) => [
      [enrollment.user.firstName, enrollment.user.lastName].filter(Boolean).join(' '),
      enrollment.user.username,
      enrollment.user.phone,
      enrollment.cohort.title,
      enrollment.status,
      enrollment.startedAt,
      enrollment.completedAt,
      enrollment.createdAt,
    ]);

    return {
      csv: buildCsv(
        ['ученик', 'telegram', 'телефон', 'группа', 'статус', 'старт', 'завершение', 'зачислен'],
        rows,
      ),
      rows: rows.length,
    };
  }

  private async progressCsv(
    params: Record<string, unknown>,
  ): Promise<{ csv: string; rows: number }> {
    const cohortId = typeof params.cohortId === 'string' ? params.cohortId : undefined;
    const completions = await this.prisma.stageCompletion.findMany({
      where: cohortId ? { enrollment: { cohortId } } : {},
      include: {
        enrollment: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            cohort: { select: { title: true } },
          },
        },
      },
      orderBy: { completedAt: 'asc' },
    });

    const rows: CsvValue[][] = completions.map((completion) => [
      [completion.enrollment.user.firstName, completion.enrollment.user.lastName]
        .filter(Boolean)
        .join(' '),
      completion.enrollment.cohort.title,
      completion.stageKey,
      completion.completedAt,
    ]);

    return {
      csv: buildCsv(['ученик', 'группа', 'этап', 'завершён'], rows),
      rows: rows.length,
    };
  }

  private async auditCsv(params: Record<string, unknown>): Promise<{ csv: string; rows: number }> {
    const from = typeof params.from === 'string' ? new Date(params.from) : undefined;
    const to = typeof params.to === 'string' ? new Date(params.to) : undefined;

    const entries = await this.prisma.auditLog.findMany({
      where: {
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 50_000,
    });

    const rows: CsvValue[][] = entries.map((entry) => [
      entry.createdAt,
      entry.actorUserId,
      entry.actorRoleContext,
      entry.workspaceId,
      entry.entityType,
      entry.entityId,
      entry.action,
    ]);

    return {
      csv: buildCsv(['когда', 'кто', 'роль', 'мастерская', 'сущность', 'id', 'действие'], rows),
      rows: rows.length,
    };
  }
}
