import { Badge, Card } from '@pdr/ui';
import type { CourseMap } from './types';

type Stage = CourseMap['stages'][number];

function Requirement({
  label,
  counts,
}: {
  label: string;
  counts: { done: number; total: number };
}) {
  if (counts.total === 0) return null;
  const done = counts.done >= counts.total;
  return (
    <span className="pdr-hint">
      {label}: {counts.done}/{counts.total}
      {done ? ' ✓' : ''}
    </span>
  );
}

export function StageCard({
  index,
  stage,
  onOpen,
}: {
  index: number;
  stage: Stage;
  onOpen: () => void;
}) {
  const locked = stage.access.status === 'locked';
  const completed = stage.access.status === 'completed';

  return (
    <Card>
      <button
        type="button"
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          cursor: locked ? 'default' : 'pointer',
          opacity: locked ? 0.75 : 1,
        }}
        onClick={() => {
          if (!locked) onOpen();
        }}
      >
        <div className="pdr-row" style={{ marginBottom: 6 }}>
          <span className="pdr-grow" style={{ fontWeight: 600 }}>
            Этап {index}. {stage.title}
          </span>
          {completed ? (
            <Badge tone="success">Пройден</Badge>
          ) : locked ? (
            <Badge tone="muted">Закрыт</Badge>
          ) : (
            <Badge tone="info">Открыт</Badge>
          )}
        </div>

        {stage.description ? (
          <div className="pdr-hint" style={{ marginBottom: 8 }}>
            {stage.description}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: locked ? 8 : 0 }}>
          <Requirement label="Уроки" counts={stage.progress.lessons} />
          <Requirement label="Практика" counts={stage.progress.assignments} />
          <Requirement label="Экзамены" counts={stage.progress.exams} />
        </div>

        {/* Ученик должен видеть все причины сразу, а не узнавать их по одной. */}
        {locked && stage.access.status === 'locked' ? (
          <div className="pdr-stack" style={{ gap: 4 }}>
            {stage.access.reasons.map((reason) => (
              <div
                key={reason.code}
                className="pdr-hint"
                style={{ color: 'var(--pdr-text)', opacity: 0.8 }}
              >
                • {reason.message}
              </div>
            ))}
          </div>
        ) : null}
      </button>
    </Card>
  );
}
