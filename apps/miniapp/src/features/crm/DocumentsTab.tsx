import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Button, Card, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { alertDialog, haptic } from '@/shared/telegram';
import { useOrderDocuments } from './api';

/**
 * Документы заказа: акт осмотра, заказ-наряд, акт выполненных работ.
 *
 * Собираются из того, что уже введено в заказе, поэтому ничего заполнять не
 * нужно — только открыть и распечатать. Печать идёт через просмотр PDF:
 * в Telegram WebView собственного диалога печати нет, а системный просмотр
 * умеет и печать, и отправку клиенту.
 */
export function DocumentsTab({
  workspaceId,
  orderId,
}: {
  workspaceId: string;
  orderId: string;
}) {
  const documents = useOrderDocuments(workspaceId);

  const open = useMutation({
    mutationFn: async (input: { kind: string; download: boolean; title: string }) => {
      const blob = await api.getBlob(
        `/workspaces/${workspaceId}/orders/${orderId}/documents/${input.kind}/pdf${
          input.download ? '?download=true' : ''
        }`,
      );
      const url = URL.createObjectURL(blob);
      if (input.download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${input.title}.pdf`;
        link.click();
      } else {
        window.open(url, '_blank');
      }
      // Ссылку освобождаем позже: просмотрщик успевает её открыть.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      haptic('success');
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сформировать документ');
    },
  });

  if (documents.isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="pdr-stack">
      <div className="pdr-hint">
        Документы формируются из данных заказа: клиент, автомобиль, повреждения, работы и суммы.
        Основание — согласованная смета, а пока её нет — последняя оценка.
      </div>

      {(documents.data?.items ?? []).map((item) => (
        <Card key={item.kind}>
          <div style={{ fontWeight: 600 }}>{item.title}</div>
          <div className="pdr-hint" style={{ marginBottom: 10 }}>
            {item.description}
          </div>
          <div className="pdr-row" style={{ gap: 8 }}>
            <Button
              className="pdr-grow"
              loading={open.isPending && open.variables?.kind === item.kind && !open.variables.download}
              onClick={() => open.mutate({ kind: item.kind, download: false, title: item.title })}
            >
              Открыть и распечатать
            </Button>
            <Button
              variant="secondary"
              loading={open.isPending && open.variables?.kind === item.kind && open.variables.download}
              onClick={() => open.mutate({ kind: item.kind, download: true, title: item.title })}
            >
              Скачать
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
