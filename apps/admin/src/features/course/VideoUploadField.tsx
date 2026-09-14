import { useEffect, useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, Progress, Select, Stack, Text } from '@mantine/core';
import { api, tokenStore } from '@/shared/api';
import { useApiQuery } from '@/shared/query';
import type { VideoAssetRow } from './types';

const KEY = ['admin', 'videos'];
const POLL_INTERVAL_MS = 4000;

type Phase = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed';

const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  uploading: 'Загружаем файл',
  processing: 'Видеоплатформа обрабатывает запись',
  ready: 'Видео готово',
  failed: 'Не удалось обработать видео',
};

/**
 * Выбор или загрузка видео для урока.
 *
 * Преподаватель не должен ходить в кабинет видеоплатформы: файл уходит через
 * наш сервер, который единственный знает ключ доступа к ней. Здесь же видно
 * все состояния — загрузка, обработка, ошибка, — иначе непонятно, почему урок
 * ещё нельзя показывать.
 */
export function VideoUploadField({
  value,
  onChange,
  label = 'Видео',
  disabled,
}: {
  value: string | null;
  onChange: (videoAssetId: string | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const videos = useApiQuery<VideoAssetRow[]>(KEY, '/admin/videos');
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  /** Ожидание обработки: платформа готовит файл не мгновенно. */
  function watchProcessing(videoId: string) {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await api.get<{ status: Phase; error: string | null }>(
          `/admin/videos/${videoId}`,
        );
        if (status.status === 'ready' || status.status === 'failed') {
          window.clearInterval(pollRef.current!);
          pollRef.current = null;
          setPhase(status.status);
          if (status.status === 'failed') setError(status.error ?? 'Ошибка обработки');
          else await videos.refetch();
        }
      } catch {
        /* следующая попытка через интервал */
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Загрузка идёт XMLHttpRequest, а не fetch: только он даёт прогресс
   * отправки, а без прогресса загрузка файла на сотни мегабайт выглядит
   * как зависшая страница.
   */
  function uploadFile(file: File) {
    setError(null);
    setPercent(0);
    setPhase('uploading');

    void (async () => {
      try {
        const created = await api.post<{ id: string }>('/admin/videos', {
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
        });
        setPendingId(created.id);
        onChange(created.id);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `${api.baseUrl}/admin/videos/${created.id}/content`);
          const token = tokenStore.getAccessToken();
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(parseError(xhr.responseText)));
          xhr.onerror = () => reject(new Error('Сеть недоступна'));
          xhr.send(file);
        });

        setPhase('processing');
        watchProcessing(created.id);
        await videos.refetch();
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? e.message : 'Не удалось загрузить файл');
      }
    })();
  }

  const options = (videos.data ?? []).map((v) => ({
    value: v.id,
    label: `${v.title}${v.status === 'ready' ? '' : ` (${STATUS_LABEL[v.status] ?? v.status})`}`,
  }));

  return (
    <Stack gap="xs">
      <Select
        label={label}
        placeholder="Выберите загруженное или загрузите новое"
        searchable
        clearable
        disabled={disabled}
        value={value}
        onChange={onChange}
        data={options}
      />

      <Group gap="sm">
        <FileButton onChange={(file) => file && uploadFile(file)} accept="video/*">
          {(props) => (
            <Button
              {...props}
              variant="light"
              size="xs"
              disabled={disabled || phase === 'uploading'}
            >
              Загрузить видео
            </Button>
          )}
        </FileButton>
        {phase !== 'idle' ? (
          <Text size="xs" c={phase === 'failed' ? 'red' : 'dimmed'}>
            {PHASE_TEXT[phase]}
          </Text>
        ) : null}
      </Group>

      {phase === 'uploading' ? <Progress value={percent} size="sm" /> : null}
      {phase === 'processing' ? <Progress value={100} size="sm" animated /> : null}
      {error ? (
        <Alert color="red" p="xs">
          <Text size="xs">{error}</Text>
        </Alert>
      ) : null}
      {phase === 'ready' && pendingId ? (
        <Alert color="green" p="xs">
          <Text size="xs">Видео обработано и привязано к уроку.</Text>
        </Alert>
      ) : null}
    </Stack>
  );
}

const STATUS_LABEL: Record<string, string> = {
  uploading: 'ожидает файл',
  processing: 'обрабатывается',
  failed: 'ошибка',
};

function parseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? 'Не удалось загрузить файл';
  } catch {
    return 'Не удалось загрузить файл';
  }
}
