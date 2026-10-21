import { MarkedImage } from '@pdr/ui';
import type { OrderPhoto } from './types';

/**
 * Миниатюра сохранённого снимка с разметкой зоны ремонта поверх.
 *
 * Сервер отдаёт миниатюру оригинала и векторную разметку отдельно: оригинал
 * не перезаписывается. Здесь они сводятся на экране, поэтому отмеченная зона
 * видна в списке так же, как в редакторе.
 */
export function PhotoThumb({ photo, radius = 8 }: { photo: OrderPhoto; radius?: number }) {
  if (!photo.thumbUrl) return <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />;
  return (
    <MarkedImage
      src={photo.thumbUrl}
      markup={photo.annotation}
      alt={photo.caption ?? ''}
      style={{ width: '100%', aspectRatio: '1', borderRadius: radius }}
    />
  );
}
