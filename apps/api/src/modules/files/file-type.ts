/**
 * Определение реального типа файла по сигнатуре (magic bytes).
 * Заявленный клиентом Content-Type не является доказательством: файл может
 * называться картинкой и содержать что угодно.
 *
 * Набор типов ограничен тем, что продукт принимает, поэтому собственная
 * реализация предсказуемее и не тянет ESM-зависимость в CommonJS-сборку.
 */

export type DetectedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/heic'
  | 'image/heif'
  | 'video/mp4'
  | 'video/quicktime'
  | 'application/pdf'
  | null;

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Бренды ISO BMFF (ftyp) для HEIC/HEIF и видео. */
function readFtypBrands(buf: Buffer): { major: string; compatible: string[] } | null {
  if (buf.length < 16) return null;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const boxSize = buf.readUInt32BE(0);
  const major = buf.toString('latin1', 8, 12);
  const compatible: string[] = [];
  const end = Math.min(boxSize > 0 ? boxSize : buf.length, buf.length);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    compatible.push(buf.toString('latin1', offset, offset + 4));
  }
  return { major, compatible };
}

export function detectFileType(buf: Buffer): DetectedType {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    buf.length >= 12 &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  const ftyp = readFtypBrands(buf);
  if (ftyp) {
    const brands = [ftyp.major, ...ftyp.compatible];
    if (brands.some((b) => b === 'heic' || b === 'heix' || b === 'hevc' || b === 'hevx')) {
      return 'image/heic';
    }
    if (brands.some((b) => b === 'mif1' || b === 'msf1' || b === 'heim' || b === 'heis')) {
      return 'image/heif';
    }
    if (ftyp.major === 'qt  ') return 'video/quicktime';
    if (
      brands.some((b) =>
        ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'iso5', 'iso6'].includes(b),
      )
    ) {
      return 'video/mp4';
    }
  }
  return null;
}

/** Эквивалентные типы: HEIC определяется по-разному, mov и mp4 близки. */
const EQUIVALENT: Record<string, string[]> = {
  'image/heic': ['image/heic', 'image/heif'],
  'image/heif': ['image/heic', 'image/heif'],
  'image/jpg': ['image/jpeg'],
  'image/jpeg': ['image/jpeg'],
  'video/quicktime': ['video/quicktime', 'video/mp4'],
  'video/mp4': ['video/mp4', 'video/quicktime'],
};

export function matchesDeclared(detected: DetectedType, declared: string): boolean {
  if (!detected) return false;
  const normalizedDeclared = declared.toLowerCase().split(';')[0]?.trim() ?? '';
  const allowed = EQUIVALENT[normalizedDeclared] ?? [normalizedDeclared];
  return allowed.includes(detected);
}

export function isImage(type: DetectedType | string | null): boolean {
  return typeof type === 'string' && type.startsWith('image/');
}

export function isVideo(type: DetectedType | string | null): boolean {
  return typeof type === 'string' && type.startsWith('video/');
}
