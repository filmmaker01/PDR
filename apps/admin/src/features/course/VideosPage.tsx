import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';
import type { VideoAssetRow } from './types';
import { VideoUploadField } from './VideoUploadField';

const KEY = ['admin', 'videos'];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploading: { label: 'ожидает файл', color: 'yellow' },
  processing: { label: 'обрабатывается', color: 'blue' },
  ready: { label: 'готово', color: 'green' },
  failed: { label: 'ошибка', color: 'red' },
};

export function VideosPage() {
  const [opened, { open, close }] = useDisclosure(false);
  const videos = useApiQuery<VideoAssetRow[]>(KEY, '/admin/videos');
  const remove = useApiMutation((id: string) => api.delete(`/admin/videos/${id}`), {
    invalidate: [KEY],
    successMessage: 'Видео удалено',
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Видео</Title>
        <Button onClick={open}>Загрузить видео</Button>
      </Group>

      <Alert color="gray">
        Видео хранится в Kinescope приватно. Ссылку на воспроизведение выдаёт наш сервер и только
        после проверки того, что этап открыт и доступ к курсу действует.
      </Alert>

      <Card withBorder p={0}>
        {videos.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Название</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Длительность</Table.Th>
                <Table.Th>Загружено</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(videos.data ?? []).map((video) => {
                const status = STATUS_LABELS[video.status] ?? {
                  label: video.status,
                  color: 'gray',
                };
                return (
                  <Table.Tr key={video.id}>
                    <Table.Td>{video.title}</Table.Td>
                    <Table.Td>
                      <Badge color={status.color} variant="light">
                        {status.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {video.durationSec
                        ? `${Math.floor(video.durationSec / 60)} мин ${video.durationSec % 60} с`
                        : '—'}
                    </Table.Td>
                    <Table.Td>{formatDate(video.createdAt)}</Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        onClick={() => remove.mutate(video.id)}
                      >
                        Удалить
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <UploadModal opened={opened} onClose={close} />
    </Stack>
  );
}

function UploadModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [videoId, setVideoId] = useState<string | null>(null);

  return (
    <Modal
      opened={opened}
      onClose={() => {
        onClose();
        setVideoId(null);
      }}
      title="Загрузка видео"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Файл уходит через наш сервер: ключ видеоплатформы не попадает в браузер, а заходить в её
          кабинет не нужно.
        </Text>
        <VideoUploadField value={videoId} onChange={setVideoId} label="Файл или уже загруженное" />
      </Stack>
    </Modal>
  );
}
