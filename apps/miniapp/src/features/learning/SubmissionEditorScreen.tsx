import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Button,
  Card,
  Field,
  MediaUploader,
  SkeletonList,
  Textarea,
  useUploadQueue,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';

interface SubmissionDetails {
  id: string;
  assignmentKey: string;
  attemptNo: number;
  status: string;
  text: string | null;
  files: { fileId: string; mimeType: string; thumbUrl: string | null }[];
}

interface AssignmentBrief {
  key: string;
  title: string;
  stageKey: string;
  instructions: string;
  requiredMedia: { min_photos?: number; min_videos?: number; text_required?: boolean };
  maxVideoSec: number | null;
  attempts: { id: string; attemptNo: number; files: { fileId: string }[] }[];
}

export function SubmissionEditorScreen() {
  const { enrollmentId = '', submissionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [textLoaded, setTextLoaded] = useState(false);

  const submission = useQuery({
    queryKey: ['learning', 'submission', submissionId],
    queryFn: () => api.get<SubmissionDetails>(`/learning/submissions/${submissionId}`),
  });

  const assignment = useQuery({
    queryKey: ['learning', 'assignment', enrollmentId, submission.data?.assignmentKey],
    enabled: Boolean(submission.data?.assignmentKey),
    queryFn: () =>
      api.get<AssignmentBrief>(
        `/learning/enrollments/${enrollmentId}/assignments/${submission.data!.assignmentKey}`,
      ),
  });

  useEffect(() => {
    if (submission.data && !textLoaded) {
      setText(submission.data.text ?? '');
      setTextLoaded(true);
    }
  }, [submission.data, textLoaded]);

  const transport = useMemo(() => createUploadTransport({ scope: 'submission' }), []);

  const uploads = useUploadQueue({
    transport,
    onUploaded: async (fileId) => {
      await api.post(`/learning/submissions/${submissionId}/files`, { fileId });
      await queryClient.invalidateQueries({ queryKey: ['learning', 'submission', submissionId] });
    },
  });

  const saveText = useMutation({
    mutationFn: () => api.patch(`/learning/submissions/${submissionId}`, { text: text || null }),
  });

  const detach = useMutation({
    mutationFn: (fileId: string) =>
      api.delete(`/learning/submissions/${submissionId}/files/${fileId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['learning', 'submission', submissionId] }),
  });

  const copyPrevious = useMutation({
    mutationFn: (sourceSubmissionId: string) =>
      api.post<{ copied: number }>(`/learning/submissions/${submissionId}/copy-files`, {
        sourceSubmissionId,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['learning', 'submission', submissionId] });
      await alertDialog(`Перенесено файлов: ${result.copied}`);
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      await saveText.mutateAsync();
      return api.post(`/learning/submissions/${submissionId}/submit`, undefined, {
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      navigate(`/learning/${enrollmentId}/assignments/${submission.data!.assignmentKey}`, {
        replace: true,
      });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось отправить работу');
    },
  });

  if (submission.isLoading || assignment.isLoading) return <SkeletonList rows={3} />;

  const data = submission.data!;
  const brief = assignment.data;
  const required = brief?.requiredMedia ?? {};

  const attachedPhotos = data.files.filter((f) => f.mimeType.startsWith('image/')).length;
  const attachedVideos = data.files.filter((f) => f.mimeType.startsWith('video/')).length;
  const previousAttempt = brief?.attempts.find((a) => a.id !== submissionId && a.files.length > 0);

  const missing: string[] = [];
  if ((required.min_photos ?? 0) > attachedPhotos) {
    missing.push(`ещё ${required.min_photos! - attachedPhotos} фото`);
  }
  if ((required.min_videos ?? 0) > attachedVideos) {
    missing.push(`ещё ${required.min_videos! - attachedVideos} видео`);
  }
  if (required.text_required && text.trim().length === 0) missing.push('описание');

  const ready = missing.length === 0 && !uploads.pending;

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{brief?.title ?? 'Работа'}</h1>
        <div className="pdr-hint">Попытка {data.attemptNo}</div>
      </div>

      {brief ? (
        <Card>
          <div className="pdr-hint" style={{ whiteSpace: 'pre-wrap' }}>
            {brief.instructions}
          </div>
        </Card>
      ) : null}

      {data.files.length > 0 ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Приложено</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
              gap: 8,
            }}
          >
            {data.files.map((file) => (
              <div key={file.fileId} style={{ position: 'relative' }}>
                {file.thumbUrl ? (
                  <img
                    src={file.thumbUrl}
                    alt=""
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: 8,
                    }}
                  />
                ) : (
                  <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                )}
                <button
                  type="button"
                  className="pdr-uploader__remove"
                  aria-label="Убрать"
                  onClick={() => detach.mutate(file.fileId)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <MediaUploader
          items={uploads.items}
          onAdd={uploads.add}
          onRetry={uploads.retry}
          onRemove={uploads.remove}
          accept="image/*,video/mp4,video/quicktime"
          capture
          label="Добавить"
          hint={
            missing.length > 0
              ? `Для отправки нужно: ${missing.join(', ')}`
              : 'Всё необходимое приложено'
          }
        />
      </Card>

      {previousAttempt ? (
        <Button
          variant="secondary"
          block
          loading={copyPrevious.isPending}
          onClick={async () => {
            if (await confirmDialog('Перенести файлы из предыдущей попытки?')) {
              copyPrevious.mutate(previousAttempt.id);
            }
          }}
        >
          Перенести файлы из попытки {previousAttempt.attemptNo}
        </Button>
      ) : null}

      <Card>
        <Field
          label="Описание работы"
          hint={
            required.text_required
              ? 'Обязательно: что делали, каким инструментом, что было сложным'
              : 'Необязательно, но помогает куратору'
          }
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => saveText.mutate()}
            rows={5}
            placeholder="Выправил вмятину крючком снизу, сложным был доступ через технологическое отверстие…"
          />
        </Field>
      </Card>

      <Button block disabled={!ready} loading={submit.isPending} onClick={() => submit.mutate()}>
        {uploads.pending ? 'Дождитесь загрузки файлов' : 'Отправить на проверку'}
      </Button>

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/learning/${enrollmentId}/assignments/${data.assignmentKey}`)}
      >
        Назад
      </Button>
    </div>
  );
}
