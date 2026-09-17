import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LEAD_STATUS_LABELS } from '@pdr/shared';
import { Badge, Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { formatDateTime, formatMinor, formatPhoneRu } from '@/shared/format';
import { useLeads, useLeadsSummary } from './api';
import { ScreenError } from './ScreenError';
import { LEAD_STATUS_TONES, type LeadListItem, type LeadStatus } from './types';

const FILTERS: { value: LeadStatus | 'all' | 'due'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'due', label: 'Пора звонить' },
  { value: 'new', label: LEAD_STATUS_LABELS.new },
  { value: 'estimated', label: LEAD_STATUS_LABELS.estimated },
  { value: 'awaiting_decision', label: LEAD_STATUS_LABELS.awaiting_decision },
  { value: 'callback', label: LEAD_STATUS_LABELS.callback },
  { value: 'scheduled', label: LEAD_STATUS_LABELS.scheduled },
  { value: 'rejected', label: LEAD_STATUS_LABELS.rejected },
];

/** Подпись обращения в списке: кто и на какой машине. */
function title(lead: LeadListItem): string {
  const who = lead.contact.name?.trim() || lead.contact.phone || 'Без имени';
  return `№${lead.number} · ${who}`;
}

export function LeadsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<LeadStatus | 'all' | 'due'>('all');
  const [search, setSearch] = useState('');

  const summary = useLeadsSummary(workspaceId);
  const leads = useLeads(workspaceId, {
    status: filter === 'all' || filter === 'due' ? undefined : [filter],
    due: filter === 'due',
    q: search,
  });

  if (leads.isError) {
    return (
      <ScreenError
        error={leads.error}
        onRetry={() => void leads.refetch()}
        backTo={`/workspace/${workspaceId}/today`}
      />
    );
  }

  const items = leads.data?.items ?? [];

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Обращения</h1>

      <Button block onClick={() => navigate(`/workspace/${workspaceId}/leads/new`)}>
        + Новое обращение
      </Button>

      {summary.data ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow">
              <span style={{ display: 'block', fontSize: 22, fontWeight: 700 }}>
                {summary.data.total}
              </span>
              <span className="pdr-hint">
                {[
                  `${summary.data.byStatus.new ?? 0} новые`,
                  `${summary.data.byStatus.estimated ?? 0} оценены`,
                  `${summary.data.byStatus.callback ?? 0} перезвонить`,
                ].join(' · ')}
              </span>
            </span>
            {summary.data.due > 0 ? (
              <Badge tone="warning">{summary.data.due} просрочено</Badge>
            ) : null}
          </div>
        </Card>
      ) : null}

      <input
        className="pdr-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Имя, телефон, номер или машина"
      />

      <div className="pdr-chips">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`pdr-chip${filter === option.value ? ' pdr-chip--active' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {leads.isLoading ? (
        <SkeletonList rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Обращений нет"
          description="Заведите обращение, когда клиент написал, позвонил или приехал."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {items.map((lead) => (
              <ListItem
                key={lead.id}
                title={title(lead)}
                subtitle={[
                  lead.contact.phone ? formatPhoneRu(lead.contact.phone) : lead.contact.extra,
                  [lead.vehicle.make, lead.vehicle.model].filter(Boolean).join(' ') || null,
                  lead.channelLabel,
                  lead.estimateMinor !== null
                    ? `оценка ${formatMinor(lead.estimateMinor, lead.currency)}`
                    : null,
                  lead.nextContactAt ? `перезвонить ${formatDateTime(lead.nextContactAt)}` : null,
                  lead.convertedOrder ? `заказ №${lead.convertedOrder.number}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Badge tone={LEAD_STATUS_TONES[lead.status]}>{lead.statusLabel}</Badge>}
                onClick={() => navigate(`/workspace/${workspaceId}/leads/${lead.id}`)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
