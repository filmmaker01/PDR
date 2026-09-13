import { describe, expect, it } from 'vitest';
import { detectFileType, matchesDeclared } from './file-type';

function ftypBuffer(major: string, compatible: string[] = []): Buffer {
  const size = 8 + 4 + 4 * compatible.length + 8;
  const buf = Buffer.alloc(Math.max(size, 32));
  buf.writeUInt32BE(size, 0);
  buf.write('ftyp', 4, 'latin1');
  buf.write(major, 8, 'latin1');
  buf.writeUInt32BE(0, 12);
  compatible.forEach((brand, i) => buf.write(brand, 16 + i * 4, 'latin1'));
  return buf;
}

describe('detectFileType', () => {
  it('распознаёт JPEG', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });
  it('распознаёт PNG', () => {
    expect(
      detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe('image/png');
  });
  it('распознаёт WebP', () => {
    const buf = Buffer.alloc(16);
    buf.write('RIFF', 0, 'latin1');
    buf.write('WEBP', 8, 'latin1');
    expect(detectFileType(buf)).toBe('image/webp');
  });
  it('распознаёт HEIC с айфона', () => {
    expect(detectFileType(ftypBuffer('heic', ['mif1', 'miaf']))).toBe('image/heic');
  });
  it('распознаёт mp4 и mov', () => {
    expect(detectFileType(ftypBuffer('isom', ['iso2', 'avc1', 'mp41']))).toBe('video/mp4');
    expect(detectFileType(ftypBuffer('qt  '))).toBe('video/quicktime');
  });
  it('распознаёт PDF', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });
  it('возвращает null для произвольных данных', () => {
    expect(detectFileType(Buffer.from('просто текст, не файл'))).toBeNull();
    expect(detectFileType(Buffer.alloc(4))).toBeNull();
  });
  it('не принимает исполняемый файл за картинку', () => {
    // ELF-заголовок
    expect(
      detectFileType(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])),
    ).toBeNull();
  });
});

describe('matchesDeclared', () => {
  it('совпадение точного типа', () => {
    expect(matchesDeclared('image/jpeg', 'image/jpeg')).toBe(true);
    expect(matchesDeclared('image/jpeg', 'image/jpg')).toBe(true);
  });
  it('heic и heif взаимозаменяемы', () => {
    expect(matchesDeclared('image/heif', 'image/heic')).toBe(true);
  });
  it('mov и mp4 взаимозаменяемы', () => {
    expect(matchesDeclared('video/mp4', 'video/quicktime')).toBe(true);
  });
  it('подмена типа отклоняется', () => {
    expect(matchesDeclared('application/pdf', 'image/jpeg')).toBe(false);
    expect(matchesDeclared(null, 'image/jpeg')).toBe(false);
  });
  it('учитывает параметры content-type', () => {
    expect(matchesDeclared('image/jpeg', 'image/jpeg; charset=binary')).toBe(true);
  });
});
