import { useNavigate } from 'react-router-dom';
import { ApiError } from '@pdr/api-client';
import { Button, Card, ErrorState } from '@pdr/ui';

/**
 * Единая реакция раздела мастерской на неудачную загрузку.
 *
 * Без неё экран остаётся в скелетоне или выглядит пустым, и человек не
 * понимает, чего не хватает: прав, связи или данных. Раздел, закрытый ролью,
 * сервер отдаёт как «не найдено» — здесь это переводится в понятную фразу.
 */
export function ScreenError({
  error,
  onRetry,
  backTo,
}: {
  error: unknown;
  onRetry?: () => void;
  backTo?: string;
}) {
  const navigate = useNavigate();
  const apiError = error instanceof ApiError ? error : null;
  const denied =
    apiError?.code === 'not_found' ||
    apiError?.code === 'forbidden' ||
    apiError?.code === 'workspace_access_required' ||
    apiError?.code === 'product_access_required';

  const back = backTo ? (
    <Button variant="secondary" block onClick={() => navigate(backTo)}>
      Назад
    </Button>
  ) : null;

  if (denied) {
    const title = 'Раздел недоступен';
    // Сервер намеренно отвечает обезличенно; повторять его текст под тем же
    // заголовком бессмысленно — вместо этого объясняем причину.
    const hint =
      apiError && apiError.message !== title
        ? apiError.message
        : 'У вашей роли нет прав на этот раздел мастерской. Доступ открывает владелец.';
    return (
      <div className="pdr-stack">
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
          <div className="pdr-hint">{hint}</div>
        </Card>
        {back}
      </div>
    );
  }

  return (
    <div className="pdr-stack">
      <ErrorState
        message={apiError?.message ?? 'Проверьте связь и попробуйте ещё раз'}
        onRetry={onRetry}
      />
      {back}
    </div>
  );
}
