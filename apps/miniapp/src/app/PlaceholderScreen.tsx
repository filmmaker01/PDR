import { EmptyState } from '@pdr/ui';

export function PlaceholderScreen({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">{title}</h1>
      <EmptyState title="Раздел в разработке" description={hint} />
    </div>
  );
}
