import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Sheet,
  SkeletonList,
  Tabs,
  Textarea,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime, formatMinor, formatPhoneRu } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useStickyState } from '@/shared/navigation';
import { useMembers, useOrder, useWorkspace } from './api';
import { AssessmentSheet } from './AssessmentSheet';
import { DamagesTab } from './DamagesTab';
import { DocumentsTab } from './DocumentsTab';
import { AppointmentSheet } from './AppointmentSheet';
import { EstimatesTab } from './EstimatesTab';
import { PaymentsTab } from './PaymentsTab';
import { PhotosTab } from './PhotosTab';
import { APPOINTMENT_STATUS_TONES, PAYMENT_LABELS, STATUS_TONES, type OrderStatus } from './types';

type Tab = 'work' | 'photos' | 'damages' | 'estimate' | 'payments' | 'documents';

export function OrderScreen() {
  const { workspaceId = '', orderId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useStickyState<Tab>(`order.${orderId}.tab`, 'work');
  const [statusSheet, setStatusSheet] = useState(false);
  const [appointmentSheet, setAppointmentSheet] = useState(false);
  const [assessmentSheet, setAssessmentSheet] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [comment, setComment] = useState('');

  const order = useOrder(workspaceId, orderId);
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm'] });
  };

  const transition = useMutation({
    mutationFn: (input: { to: OrderStatus; comment?: string }) =>
      api.post(`/workspaces/${workspaceId}/orders/${orderId}/transition`, input),
    onSuccess: async () => {
      haptic('success');
      setStatusSheet(false);
      setPendingStatus(null);
      setComment('');
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось изменить статус');
    },
  });

  const assign = useMutation({
    mutationFn: (assigneeMemberId: string) =>
      api.patch(`/workspaces/${workspaceId}/orders/${orderId}`, { assigneeMemberId }),
    onSuccess: invalidate,
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось назначить исполнителя'),
  });

  if (order.isLoading) return <SkeletonList rows={4} />;
  if (order.isError) {
    return (
      <div className="pdr-stack">
        <EmptyState
          title="Заказ недоступен"
          description={
            order.error instanceof ApiError
              ? order.error.message
              : 'Возможно, он в другой мастерской'
          }
        />
        <Button
          variant="secondary"
          block
          onClick={() => navigate(`/workspace/${workspaceId}/orders`)}
        >
          К списку заказов
        </Button>
      </div>
    );
  }

  const data = order.data!;
  const canEdit = workspace.data?.access.active ?? false;
  const canAssign = workspace.data?.permissions.includes('orders.assign') ?? false;
  // Остаток к оплате: считается из согласованной сметы и принятых денег.
  const remainingMinor = Math.max(0, (data.agreedTotalMinor ?? 0) - data.paidMinor);

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-row" style={{ marginBottom: 8 }}>
          <span className="pdr-grow">
            <span style={{ display: 'block', fontSize: 18, fontWeight: 700 }}>
              Заказ №{data.number}
            </span>
            <span className="pdr-hint">{data.title ?? 'Без описания'}</span>
          </span>
          <Badge tone={STATUS_TONES[data.status]}>{data.statusLabel}</Badge>
        </div>

        <div className="pdr-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Badge tone={data.paymentStatus === 'paid' ? 'success' : 'muted'}>
            {PAYMENT_LABELS[data.paymentStatus]}
          </Badge>
          {data.agreedTotalMinor !== null ? (
            <Badge tone="muted">
              {formatMinor(data.paidMinor, data.currency)} из{' '}
              {formatMinor(data.agreedTotalMinor, data.currency)}
            </Badge>
          ) : (
            <Badge tone="muted">Смета не согласована</Badge>
          )}
        </div>

        {canEdit ? (
          <div className="pdr-stack" style={{ gap: 8, marginTop: 12 }}>
            <Button block variant="secondary" onClick={() => setAssessmentSheet(true)}>
              Сделать оценку
            </Button>
            {data.allowedTransitions.length > 0 ? (
              <Button block onClick={() => setStatusSheet(true)}>
                Изменить статус
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Tabs
        tabs={[
          { value: 'work', label: 'Работа' },
          { value: 'photos', label: 'Фото' },
          { value: 'damages', label: 'Повреждения' },
          { value: 'estimate', label: 'Расчёт' },
          { value: 'payments', label: 'Оплаты' },
          { value: 'documents', label: 'Документы' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        wrap
      />

      {tab === 'work' ? (
        <>
          <Card>
            <div className="pdr-stack" style={{ gap: 10 }}>
              <div>
                <div className="pdr-hint">Клиент</div>
                <button
                  type="button"
                  style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => navigate(`/workspace/${workspaceId}/clients/${data.client.id}`)}
                >
                  {data.client.name}
                </button>
                {data.client.phone ? (
                  <div>
                    <a href={`tel:${data.client.phone}`} style={{ color: 'var(--pdr-link)' }}>
                      {formatPhoneRu(data.client.phone)}
                    </a>
                  </div>
                ) : null}
              </div>

              {data.vehicle ? (
                <div>
                  <div className="pdr-hint">Автомобиль</div>
                  <button
                    type="button"
                    style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() =>
                      navigate(`/workspace/${workspaceId}/vehicles/${data.vehicle!.id}`)
                    }
                  >
                    {data.vehicle.make} {data.vehicle.model}
                    {data.vehicle.plate ? ` · ${data.vehicle.plate}` : ''}
                  </button>
                </div>
              ) : null}

              <div>
                <div className="pdr-hint">Исполнитель</div>
                {canAssign && canEdit ? (
                  <select
                    className="pdr-select"
                    value={data.assignee?.id ?? ''}
                    onChange={(e) => assign.mutate(e.target.value)}
                  >
                    <option value="" disabled>
                      Не назначен
                    </option>
                    {(members.data ?? [])
                      .filter((m) => m.isActive)
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <div style={{ fontWeight: 600 }}>{data.assignee?.name ?? 'Не назначен'}</div>
                )}
              </div>
            </div>
          </Card>

          <h2 className="pdr-subtitle">Записи</h2>
          <Card flat>
            <div className="pdr-list">
              {data.appointments.length === 0 ? (
                <div className="pdr-list__item pdr-list__item--static">
                  <span className="pdr-hint">Заказ не записан в календарь</span>
                </div>
              ) : (
                data.appointments.map((appointment) => (
                  <div key={appointment.id} className="pdr-list__item pdr-list__item--static">
                    <span className="pdr-grow">
                      <span style={{ display: 'block', fontWeight: 500 }}>
                        {formatDateTime(appointment.startsAt, workspace.data?.timezone)} ·{' '}
                        {appointment.kindLabel}
                      </span>
                      <span className="pdr-hint">
                        {[
                          `${appointment.durationMin} мин`,
                          appointment.assignee?.name,
                          appointment.note,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                      {appointment.statusLabel}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
          {canEdit ? (
            <Button variant="secondary" block onClick={() => setAppointmentSheet(true)}>
              + Записать в календарь
            </Button>
          ) : null}

          {data.damageSummary ? (
            <Card>
              <div className="pdr-hint">Повреждения</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.damageSummary}</div>
            </Card>
          ) : null}

          {data.cancelReason ? (
            <Card>
              <div className="pdr-hint">Причина отмены</div>
              <div>{data.cancelReason}</div>
            </Card>
          ) : null}

          <NotesEditor
            workspaceId={workspaceId}
            orderId={orderId}
            initial={data.internalNotes ?? ''}
            disabled={!canEdit}
            onSaved={invalidate}
          />

          <h2 className="pdr-subtitle">История</h2>
          <Card flat>
            <div className="pdr-list">
              {data.history.map((entry) => (
                <div key={entry.id} className="pdr-list__item pdr-list__item--static">
                  <span className="pdr-grow">
                    <span style={{ display: 'block' }}>
                      {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                      {entry.toStatus}
                    </span>
                    <span className="pdr-hint">
                      {entry.changedBy}, {formatDateTime(entry.createdAt)}
                      {entry.comment ? ` · ${entry.comment}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'photos' ? (
        <PhotosTab workspaceId={workspaceId} parent={{ orderId }} canEdit={canEdit} />
      ) : null}
      {tab === 'damages' ? (
        <DamagesTab
          workspaceId={workspaceId}
          parent={{ orderId }}
          canEdit={canEdit}
          currency={data.currency}
        />
      ) : null}
      {tab === 'estimate' ? (
        <EstimatesTab workspaceId={workspaceId} orderId={orderId} canEdit={canEdit} />
      ) : null}
      {tab === 'payments' ? <PaymentsTab workspaceId={workspaceId} orderId={orderId} /> : null}
      {tab === 'documents' ? <DocumentsTab workspaceId={workspaceId} orderId={orderId} /> : null}

      <AssessmentSheet
        open={assessmentSheet}
        onClose={() => setAssessmentSheet(false)}
        workspaceId={workspaceId}
        parent={{ orderId }}
        currency={data.currency}
      />

      <AppointmentSheet
        open={appointmentSheet}
        onClose={() => setAppointmentSheet(false)}
        workspaceId={workspaceId}
        defaultDay={new Date().toISOString().slice(0, 10)}
        orderId={orderId}
        clientId={data.client.id}
      />

      <Sheet open={statusSheet} onClose={() => setStatusSheet(false)} title="Новый статус">
        <div className="pdr-stack">
          {pendingStatus === null ? (
            data.allowedTransitions.map((transitionTo) => (
              <Button
                key={transitionTo.status}
                variant={transitionTo.status === 'cancelled' ? 'danger' : 'secondary'}
                block
                onClick={async () => {
                  if (transitionTo.status === 'cancelled') {
                    setPendingStatus(transitionTo.status);
                    return;
                  }
                  if (!(await confirmDialog(`Перевести заказ в «${transitionTo.label}»?`))) return;

                  // При выдаче с остатком сразу предлагаем принять оплату:
                  // деньги проще взять, пока клиент стоит рядом.
                  if (transitionTo.status === 'delivered' && remainingMinor > 0) {
                    const takeNow = await confirmDialog(
                      `Не оплачено ${formatMinor(remainingMinor, data.currency)}. Принять оплату сейчас?`,
                    );
                    transition.mutate({ to: transitionTo.status });
                    if (takeNow) setTab('payments');
                    return;
                  }
                  transition.mutate({ to: transitionTo.status });
                }}
              >
                {transitionTo.label}
              </Button>
            ))
          ) : (
            <>
              <Field label="Причина отмены" hint="Обязательно: причина сохранится в истории">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Клиент отказался от ремонта"
                />
              </Field>
              <Button
                variant="danger"
                block
                disabled={comment.trim().length === 0}
                loading={transition.isPending}
                onClick={() => transition.mutate({ to: pendingStatus, comment })}
              >
                Отменить заказ
              </Button>
              <Button variant="secondary" block onClick={() => setPendingStatus(null)}>
                Назад
              </Button>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function NotesEditor({
  workspaceId,
  orderId,
  initial,
  disabled,
  onSaved,
}: {
  workspaceId: string;
  orderId: string;
  initial: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(initial);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/workspaces/${workspaceId}/orders/${orderId}`, { internalNotes: notes || null }),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <Field label="Заметки" hint="Видны только сотрудникам мастерской">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (!disabled && notes !== initial) save.mutate();
          }}
          rows={3}
          disabled={disabled}
          placeholder="Что важно помнить по этому заказу"
        />
      </Field>
    </Card>
  );
}
