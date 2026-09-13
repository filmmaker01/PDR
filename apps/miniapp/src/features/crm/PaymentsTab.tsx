import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListItem,
  Sheet,
  SkeletonList,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime, formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import { useOrderPayments, useWorkspace } from './api';
import { PAYMENT_METHOD_OPTIONS, type PaymentKind, type PaymentMethod } from './types';

/** Вкладка «Оплаты»: остаток, журнал записей и приём денег. */
export function PaymentsTab({
  workspaceId,
  orderId,
  initialAmountMinor,
}: {
  workspaceId: string;
  orderId: string;
  /** Сумма, подставляемая в форму при открытии (остаток при выдаче). */
  initialAmountMinor?: number;
}) {
  const queryClient = useQueryClient();
  const payments = useOrderPayments(workspaceId, orderId);
  const workspace = useWorkspace(workspaceId);

  const [sheet, setSheet] = useState(false);
  const [kind, setKind] = useState<PaymentKind>('payment');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [correctsEntryId, setCorrectsEntryId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const canWrite =
    (workspace.data?.permissions.includes('payments.write_own') ?? false) ||
    (workspace.data?.permissions.includes('payments.write_all') ?? false);

  const add = useMutation({
    mutationFn: () => {
      const amountMinor = parseMajorToMinor(amount || '0');
      if (amountMinor === null || amountMinor <= 0) {
        throw new ApiError('validation_failed', 'Введите сумму числом', 422);
      }
      return api.post(
        `/workspaces/${workspaceId}/orders/${orderId}/payments`,
        { kind, amountMinor, method, note: note.trim() || null, correctsEntryId },
        { idempotencyKey },
      );
    },
    onSuccess: async () => {
      haptic('success');
      setSheet(false);
      setAmount('');
      setNote('');
      setCorrectsEntryId(null);
      setKind('payment');
      setIdempotencyKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось записать оплату');
    },
  });

  if (payments.isLoading) return <SkeletonList rows={3} />;
  const data = payments.data!;
  const currency = data.currency;

  const openSheet = (nextKind: PaymentKind, prefill?: number, entryId?: string): void => {
    setKind(nextKind);
    setAmount(prefill && prefill > 0 ? String(prefill / 100) : '');
    setCorrectsEntryId(entryId ?? null);
    setIdempotencyKey(crypto.randomUUID());
    setSheet(true);
  };

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-stack" style={{ gap: 6 }}>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Согласовано</span>
            <span>
              {data.agreedTotalMinor === null
                ? 'сметы нет'
                : formatMinor(data.agreedTotalMinor, currency)}
            </span>
          </div>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Получено</span>
            <span>{formatMinor(data.paidMinor, currency)}</span>
          </div>
          <div className="pdr-row">
            <span className="pdr-grow" style={{ fontWeight: 600 }}>
              {data.remainingMinor > 0 ? 'Осталось' : 'Остаток'}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>
              {formatMinor(Math.max(data.remainingMinor, 0), currency)}
            </span>
          </div>
        </div>
      </Card>

      {canWrite ? (
        <>
          <Button
            block
            onClick={() =>
              openSheet('payment', initialAmountMinor ?? Math.max(data.remainingMinor, 0))
            }
          >
            + Принять оплату
          </Button>
          <div className="pdr-row">
            <Button variant="secondary" block onClick={() => openSheet('refund')}>
              Возврат
            </Button>
            <Button variant="secondary" block onClick={() => openSheet('correction')}>
              Корректировка
            </Button>
          </div>
        </>
      ) : null}

      {data.entries.length === 0 ? (
        <EmptyState title="Оплат нет" description="Запишите предоплату или оплату при выдаче." />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {data.entries.map((entry) => (
              <ListItem
                key={entry.id}
                title={`${entry.purposeLabel} · ${formatMinor(entry.amountMinor, entry.currency)}`}
                subtitle={[
                  entry.methodLabel,
                  formatDateTime(entry.occurredAt),
                  entry.createdBy,
                  entry.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Badge tone={entry.kind === 'payment' ? 'success' : 'warning'}>
                    {entry.kind === 'payment' ? '+' : '−'}
                    {formatMinor(entry.amountMinor, entry.currency)}
                  </Badge>
                }
              />
            ))}
          </div>
        </Card>
      )}

      <div className="pdr-hint">
        Записи оплат не изменяются и не удаляются: ошибку исправляет корректировка, поэтому история
        денег остаётся полной.
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={
          kind === 'payment' ? 'Оплата' : kind === 'refund' ? 'Возврат клиенту' : 'Корректировка'
        }
      >
        <div className="pdr-stack">
          <Field label="Сумма">
            <Input
              value={amount}
              inputMode="decimal"
              placeholder="5000"
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          {kind === 'payment' ? (
            <Field label="Способ">
              <div className="pdr-chips">
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pdr-chip${method === option.value ? ' pdr-chip--active' : ''}`}
                    onClick={() => setMethod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          {kind !== 'payment' && data.entries.length > 0 ? (
            <Field label="Какую запись исправляем" hint="Необязательно, но помогает в истории">
              <select
                className="pdr-select"
                value={correctsEntryId ?? ''}
                onChange={(e) => setCorrectsEntryId(e.target.value || null)}
              >
                <option value="">Не указывать</option>
                {data.entries
                  .filter((entry) => entry.kind === 'payment')
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {formatMinor(entry.amountMinor, entry.currency)} ·{' '}
                      {formatDateTime(entry.occurredAt)}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}

          <Field label="Комментарий">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <Button block loading={add.isPending} onClick={() => add.mutate()}>
            Записать
          </Button>
          <Button variant="secondary" block onClick={() => setSheet(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
