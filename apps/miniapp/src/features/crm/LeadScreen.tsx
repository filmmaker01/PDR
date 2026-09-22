import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { LEAD_STATUS_LABELS, requiresNextContact } from '@pdr/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Sheet,
  SkeletonList,
  Tabs,
  Textarea,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime, formatMinor, formatPhoneRu } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useAssessments, useLead, useWorkspace } from './api';
import { AssessmentSheet } from './AssessmentSheet';
import { DamagesTab } from './DamagesTab';
import { PhotosTab } from './PhotosTab';
import { LeadScheduleSheet } from './LeadScheduleSheet';
import { ScreenError } from './ScreenError';
import { LEAD_STATUS_TONES, type LeadStatus } from './types';

type Tab = 'about' | 'photos' | 'damages' | 'assessment';

/**
 * Карточка обращения.
 *
 * Здесь собирается весь путь клиента до заказа: контакт и машина, фотографии
 * с разметкой, отмеченные на схеме повреждения, предварительные оценки,
 * напоминание перезвонить и запись в календарь. Кнопка «Создать заказ»
 * переносит всё это дальше без повторного ввода.
 */
export function LeadScreen() {
  const { workspaceId = '', leadId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('about');
  const [statusSheet, setStatusSheet] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);
  const [comment, setComment] = useState('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const lead = useLead(workspaceId, leadId);
  const workspace = useWorkspace(workspaceId);
  const assessments = useAssessments(workspaceId, { leadId });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm'] });
  };

  const transition = useMutation({
    mutationFn: (input: { to: LeadStatus; comment?: string; nextContactAt?: string | null }) =>
      api.post(`/workspaces/${workspaceId}/leads/${leadId}/transition`, {
        to: input.to,
        comment: input.comment || null,
        nextContactAt: input.nextContactAt ? new Date(input.nextContactAt).toISOString() : null,
      }),
    onSuccess: async () => {
      haptic('success');
      setStatusSheet(false);
      setPendingStatus(null);
      setComment('');
      setNextContactAt('');
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось изменить статус');
    },
  });

  const convert = useMutation({
    mutationFn: () =>
      api.post<{ orderId: string; orderNumber: number; movedDamages: number; movedPhotos: number }>(
        `/workspaces/${workspaceId}/leads/${leadId}/convert`,
        {},
      ),
    onSuccess: async (result) => {
      haptic('success');
      await invalidate();
      navigate(`/workspace/${workspaceId}/orders/${result.orderId}`);
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать заказ');
    },
  });

  if (lead.isLoading) return <SkeletonList rows={4} />;
  if (lead.isError) {
    return (
      <ScreenError
        error={lead.error}
        onRetry={() => void lead.refetch()}
        backTo={`/workspace/${workspaceId}/leads`}
      />
    );
  }

  const data = lead.data!;
  const canEdit =
    (workspace.data?.access.active ?? false) &&
    (workspace.data?.permissions.includes('leads.write') ?? false) &&
    data.archivedAt === null;
  const converted = data.convertedOrder !== null;
  const latest = assessments.data?.items[0] ?? null;

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-row" style={{ marginBottom: 8 }}>
          <span className="pdr-grow">
            <span style={{ display: 'block', fontSize: 18, fontWeight: 700 }}>
              Обращение №{data.number}
            </span>
            <span className="pdr-hint">
              {[data.sourceLabel, data.channelLabel].filter(Boolean).join(' · ')}
            </span>
          </span>
          <Badge tone={LEAD_STATUS_TONES[data.status]}>{data.statusLabel}</Badge>
        </div>

        {data.estimateMinor !== null ? (
          <div className="pdr-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Badge tone="info">
              Предварительная оценка {formatMinor(data.estimateMinor, data.currency)}
            </Badge>
            {latest?.method === 'ai' && !latest.overridden ? (
              <Badge tone="warning">по фотографии</Badge>
            ) : null}
          </div>
        ) : null}

        {data.nextContactAt ? (
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            Перезвонить {formatDateTime(data.nextContactAt)}
          </div>
        ) : null}

        {converted ? (
          <Button
            block
            variant="secondary"
            style={{ marginTop: 12 }}
            onClick={() => navigate(`/workspace/${workspaceId}/orders/${data.convertedOrder!.id}`)}
          >
            Открыть заказ №{data.convertedOrder!.number}
          </Button>
        ) : null}

        {canEdit && !converted && data.allowedTransitions.length > 0 ? (
          <Button block style={{ marginTop: 12 }} onClick={() => setStatusSheet(true)}>
            Изменить статус
          </Button>
        ) : null}
      </Card>

      {canEdit ? (
        <Card>
          <div className="pdr-stack" style={{ gap: 8 }}>
            <Button block onClick={() => setAssessmentOpen(true)}>
              Сделать оценку
            </Button>
            <Button variant="secondary" block onClick={() => setScheduleOpen(true)}>
              Записать в календарь
            </Button>
            {!converted ? (
              <Button
                variant="secondary"
                block
                loading={convert.isPending}
                onClick={async () => {
                  const ok = await confirmDialog(
                    'Создать заказ? Повреждения, фотографии и оценки перейдут в него.',
                  );
                  if (ok) convert.mutate();
                }}
              >
                Создать заказ
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Tabs
        tabs={[
          { value: 'about', label: 'Обращение' },
          { value: 'photos', label: 'Фото' },
          { value: 'damages', label: 'Повреждения' },
          { value: 'assessment', label: 'Оценки' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {tab === 'about' ? (
        <>
          <Card>
            <div className="pdr-stack" style={{ gap: 10 }}>
              <div>
                <div className="pdr-hint">Клиент</div>
                {data.contact.clientId ? (
                  <button
                    type="button"
                    style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() =>
                      navigate(`/workspace/${workspaceId}/clients/${data.contact.clientId}`)
                    }
                  >
                    {data.contact.name ?? 'Без имени'}
                  </button>
                ) : (
                  <div style={{ fontWeight: 600 }}>{data.contact.name ?? 'Без имени'}</div>
                )}
                {data.contact.phone ? (
                  <div>
                    <a href={`tel:${data.contact.phone}`} style={{ color: 'var(--pdr-link)' }}>
                      {formatPhoneRu(data.contact.phone)}
                    </a>
                  </div>
                ) : null}
                {data.contact.extra ? <div className="pdr-hint">{data.contact.extra}</div> : null}
                {!data.contact.clientId ? (
                  <div className="pdr-hint">
                    Клиент появится в базе при записи в календарь или создании заказа.
                  </div>
                ) : null}
              </div>

              <div>
                <div className="pdr-hint">Автомобиль</div>
                <div style={{ fontWeight: 600 }}>
                  {[data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ') || 'Не указан'}
                  {data.vehicle.plate ? ` · ${data.vehicle.plate}` : ''}
                </div>
              </div>

              {data.assignee ? (
                <div>
                  <div className="pdr-hint">Ответственный</div>
                  <div style={{ fontWeight: 600 }}>{data.assignee.name}</div>
                </div>
              ) : null}
            </div>
          </Card>

          {data.comment ? (
            <Card>
              <div className="pdr-hint">Комментарий</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.comment}</div>
            </Card>
          ) : null}

          {data.rejectReason ? (
            <Card>
              <div className="pdr-hint">Причина отказа</div>
              <div>{data.rejectReason}</div>
            </Card>
          ) : null}

          <h2 className="pdr-subtitle">История</h2>
          <Card flat>
            <div className="pdr-list">
              {data.history.map((entry) => (
                <div key={entry.id} className="pdr-list__item pdr-list__item--static">
                  <span className="pdr-grow">
                    <span style={{ display: 'block' }}>
                      {entry.fromStatus ? `${LEAD_STATUS_LABELS[entry.fromStatus]} → ` : ''}
                      {LEAD_STATUS_LABELS[entry.toStatus]}
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
        <PhotosTab workspaceId={workspaceId} parent={{ leadId }} canEdit={canEdit} />
      ) : null}

      {tab === 'damages' ? (
        <DamagesTab
          workspaceId={workspaceId}
          parent={{ leadId }}
          canEdit={canEdit}
          currency={data.currency}
        />
      ) : null}

      {tab === 'assessment' ? (
        <div className="pdr-stack">
          {(assessments.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="Оценок ещё нет"
              description="Оцените вручную, по параметрам повреждения или по фотографии."
            />
          ) : (
            assessments.data!.items.map((assessment) => (
              <Card key={assessment.id}>
                <div className="pdr-row" style={{ marginBottom: 6 }}>
                  <span className="pdr-grow" style={{ fontWeight: 600 }}>
                    {assessment.methodLabel}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>
                    {formatMinor(assessment.totalMinor, assessment.currency)}
                  </span>
                </div>
                {assessment.method === 'ai' ? (
                  <div className="pdr-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    <Badge tone={assessment.overridden ? 'muted' : 'warning'}>
                      {assessment.overridden ? 'исправлена мастером' : 'предварительная'}
                    </Badge>
                    {assessment.ai?.model ? (
                      <Badge tone="muted">{assessment.ai.model}</Badge>
                    ) : null}
                  </div>
                ) : null}
                {assessment.baseMinor > 0 ? (
                  <div className="pdr-formula" style={{ marginBottom: 6 }}>
                    {assessment.formula}
                  </div>
                ) : null}
                {assessment.extrasMinor > 0 ? (
                  <div className="pdr-hint">
                    Арматурные работы: {formatMinor(assessment.extrasMinor, assessment.currency)}
                  </div>
                ) : null}
                {assessment.suggestedMinor !== assessment.totalMinor ? (
                  <div className="pdr-hint">
                    Расчёт по прайсу: {formatMinor(assessment.suggestedMinor, assessment.currency)}{' '}
                    · итог назначен мастером
                  </div>
                ) : null}
                {assessment.explanation ? (
                  <div className="pdr-hint">{assessment.explanation}</div>
                ) : null}
                {assessment.note ? <div style={{ marginTop: 6 }}>{assessment.note}</div> : null}
                <div className="pdr-hint" style={{ marginTop: 6 }}>
                  {assessment.createdBy ?? 'система'}, {formatDateTime(assessment.createdAt)}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}

      <AssessmentSheet
        open={assessmentOpen}
        onClose={() => setAssessmentOpen(false)}
        workspaceId={workspaceId}
        parent={{ leadId }}
        currency={data.currency}
      />

      <LeadScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        workspaceId={workspaceId}
        leadId={leadId}
      />

      <Sheet open={statusSheet} onClose={() => setStatusSheet(false)} title="Новый статус">
        <div className="pdr-stack">
          {pendingStatus === null ? (
            data.allowedTransitions.map((option) => (
              <Button
                key={option.status}
                variant={option.status === 'rejected' ? 'danger' : 'secondary'}
                block
                onClick={() => {
                  // Отказ требует причины, «перезвонить» — даты. Остальное
                  // переключается одним нажатием.
                  if (option.status === 'rejected' || requiresNextContact(option.status)) {
                    setPendingStatus(option.status);
                    return;
                  }
                  transition.mutate({ to: option.status });
                }}
              >
                {option.label}
              </Button>
            ))
          ) : (
            <>
              {pendingStatus === 'rejected' ? (
                <Field label="Причина отказа" hint="Обязательно: сохранится в истории">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Дорого, поехал в другой сервис"
                  />
                </Field>
              ) : (
                <Field label="Когда перезвонить" hint="Обязательно: иначе обращение потеряется">
                  <Input
                    type="datetime-local"
                    value={nextContactAt}
                    onChange={(e) => setNextContactAt(e.target.value)}
                  />
                </Field>
              )}
              <Button
                variant={pendingStatus === 'rejected' ? 'danger' : 'primary'}
                block
                disabled={
                  pendingStatus === 'rejected' ? comment.trim().length === 0 : !nextContactAt
                }
                loading={transition.isPending}
                onClick={() =>
                  transition.mutate({
                    to: pendingStatus,
                    comment,
                    nextContactAt: nextContactAt || null,
                  })
                }
              >
                {pendingStatus === 'rejected' ? 'Отказ' : 'Перезвонить'}
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
