import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePackageDraft, decodePackageDraft } from '../src/packageDraftStorage.ts';
import type { PackageDraftRecord } from '../src/packageDraftStorage.ts';

test('套餐恢复保留七张图片、原幂等键、待核对状态及账号隔离', async () => {
  const files = Array.from({ length: 7 }, (_, i) => new File([`image-${i}`], `phone-${i}.jpg`, { type: 'image/jpeg', lastModified: 1000 + i }));
  const record: PackageDraftRecord = { accountId: 'account-a', tabId: 'tab-a', editing: 'new', name: '套餐', original: '', member: '', baseline: '', creationKey: 'original-key',
    items: files.map((file, i) => ({ itemId: `item-${i}`, imageId: `image-${i}`, name: `商品${i}`, quantity: '1', unitPrice: '10', memberPrice: '', specification: '', file })),
    pending: { method: 'POST', path: '/order-packages', key: 'original-key', body: { name: '套餐', items: [], originalAmountCents: null, memberAmountCents: null }, files: files.map((file, i) => ({ id: `image-${i}`, file })) } };
  const restored = decodePackageDraft(structuredClone(encodePackageDraft(record)), 'account-a', 'tab-a')!;
  assert.equal(restored.creationKey, 'original-key'); assert.equal(restored.pending?.key, 'original-key');
  for (let i = 0; i < 7; i++) {
    assert.equal(restored.items[i].file?.name, `phone-${i}.jpg`);
    assert.equal(await restored.items[i].file?.text(), `image-${i}`);
    assert.equal(await restored.pending?.files?.[i].file.text(), `image-${i}`);
  }
  assert.throws(() => decodePackageDraft(encodePackageDraft(record), 'account-b', 'tab-a'));
  assert.throws(() => decodePackageDraft(encodePackageDraft(record), 'account-a', 'tab-b'));
});
