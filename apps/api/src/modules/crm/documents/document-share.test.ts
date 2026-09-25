import { describe, expect, it } from 'vitest';
import { signDocumentShare, verifyDocumentShare } from './document-share';

const SECRET = 'x'.repeat(40);
const claims = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  orderId: '22222222-2222-4222-8222-222222222222',
  kind: 'work_order',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('ссылка на документ для клиента', () => {
  it('подписанная ссылка читается обратно', () => {
    expect(verifyDocumentShare(signDocumentShare(claims, SECRET), SECRET)).toEqual(claims);
  });

  it('подменённый заказ или вид документа не проходит проверку', () => {
    const token = signDocumentShare(claims, SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ w: claims.workspaceId, o: 'другой', k: claims.kind, e: claims.exp }),
    ).toString('base64url');
    expect(verifyDocumentShare(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('чужой секрет, истёкший срок и мусор отклоняются', () => {
    expect(verifyDocumentShare(signDocumentShare(claims, SECRET), 'y'.repeat(40))).toBeNull();
    const expired = signDocumentShare({ ...claims, exp: claims.exp - 7200 }, SECRET);
    expect(verifyDocumentShare(expired, SECRET)).toBeNull();
    expect(verifyDocumentShare('abc', SECRET)).toBeNull();
    expect(verifyDocumentShare('a.b.c', SECRET)).toBeNull();
  });
});
