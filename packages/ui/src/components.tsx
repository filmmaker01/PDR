import clsx from 'clsx';
import type {
  ButtonHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
  InputHTMLAttributes,
} from 'react';

export type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export function Badge({ tone = 'default', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={clsx('pdr-badge', tone !== 'default' && `pdr-badge--${tone}`)}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  block?: boolean;
  size?: 'md' | 'sm';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  block,
  size = 'md',
  loading,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'pdr-btn',
        variant !== 'primary' && `pdr-btn--${variant}`,
        block && 'pdr-btn--block',
        size === 'sm' && 'pdr-btn--sm',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="pdr-spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  flat,
  className,
}: {
  children: ReactNode;
  flat?: boolean;
  className?: string;
}) {
  return <div className={clsx('pdr-card', flat && 'pdr-card--flat', className)}>{children}</div>;
}

export function Spinner() {
  return <span className="pdr-spinner" role="status" aria-label="Загрузка" />;
}

export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}) {
  return <div className="pdr-skeleton" style={{ height, width }} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pdr-stack">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={56} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pdr-empty">
      <div className="pdr-empty__title">{title}</div>
      {description ? <div>{description}</div> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Не удалось загрузить"
      description={message}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        ) : null
      }
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="pdr-field">
      {label ? <label className="pdr-field__label">{label}</label> : null}
      {children}
      {error ? <span className="pdr-field__error">{error}</span> : null}
      {!error && hint ? <span className="pdr-hint">{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('pdr-input', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('pdr-textarea', props.className)} />;
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="pdr-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={clsx('pdr-chip', value === o.value && 'pdr-chip--active')}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pdr-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={clsx('pdr-tab', value === t.value && 'pdr-tab--active')}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="pdr-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pdr-sheet" role="dialog" aria-modal="true">
        <div className="pdr-sheet__handle" />
        {title ? (
          <h3 className="pdr-subtitle" style={{ marginBottom: 12 }}>
            {title}
          </h3>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ListItem({
  title,
  subtitle,
  right,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={clsx('pdr-list__item', !onClick && 'pdr-list__item--static')}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <span className="pdr-grow">
        <span className="pdr-truncate" style={{ display: 'block', fontWeight: 500 }}>
          {title}
        </span>
        {subtitle ? <span className="pdr-hint">{subtitle}</span> : null}
      </span>
      {right}
    </Tag>
  );
}
