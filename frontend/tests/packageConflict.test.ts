import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePackageDraft } from '../src/packageConflict.ts';
import type { PackageDraftValues } from '../src/packageConflict.ts';
import { newPackageItem } from '../src/orderPackages.ts';

const row = (itemId: string, imageId: string | null = null) => ({ ...newPackageItem(), itemId, imageId, name: itemId });
const draft = (...items: ReturnType<typeof row>[]): PackageDraftValues => ({ name: '套餐', original: '100.00', member: '', items });

test('并发换图与改价改备注可合并，按最新顺序保留商品和各自图片', () => {
  const base = draft(row('a', 'a-old'), row('b', 'b-old'));
  const local = draft({ ...base.items[0], specification: '无糖', unitPrice: '5' }, base.items[1], row('local'));
  const remote = draft({ ...base.items[1], imageId: 'b-new' }, row('remote', 'new'), { ...base.items[0], imageId: 'a-new' });
  const merged = mergePackageDraft(base, local, remote, {});
  assert.equal(merged.resolved, true);
  assert.deepEqual(merged.values.items.map(item => [item.itemId, item.imageId]), [
    ['b', 'b-new'], ['remote', 'new'], ['a', 'a-new'], ['local', null],
  ]);
  assert.equal(merged.values.items[2].specification, '无糖');
  assert.equal(merged.values.items[2].unitPrice, '5');
});

test('双方换图和同字段修改需逐项选择，保留本地文件直到选择明确', () => {
  const base = draft(row('a', 'old'));
  const file = new File(['photo'], 'new.png', { type: 'image/png' });
  const local = draft({ ...base.items[0], imageId: 'mine', file, unitPrice: '5' });
  const remote = draft({ ...base.items[0], imageId: 'theirs', unitPrice: '9' });
  const pending = mergePackageDraft(base, local, remote, {});
  assert.equal(pending.resolved, false);
  assert.deepEqual(pending.conflicts.map(entry => entry.key), ['a:image', 'a:unitPrice']);
  const mine = mergePackageDraft(base, local, remote, { 'a:image': 'local', 'a:unitPrice': 'remote' });
  assert.equal(mine.resolved, true);
  assert.equal(mine.values.items[0].file, file);
  assert.equal(mine.values.items[0].unitPrice, '9');
  const theirs = mergePackageDraft(base, local, remote, { 'a:image': 'remote', 'a:unitPrice': 'local' });
  assert.equal(theirs.values.items[0].imageId, 'theirs');
  assert.equal(theirs.values.items[0].file, undefined);
  assert.equal(local.items[0].file, file);
  const removed = mergePackageDraft(base, local, draft({ ...remote.items[0], imageId: null }), { 'a:image': 'remote', 'a:unitPrice': 'local' });
  assert.equal(removed.values.items[0].imageId, null);
});

test('商品删除自动合并，删除与编辑冲突标出需换新标识的商品', () => {
  const base = draft(row('a', 'old'), row('b'), row('c'));
  const local = draft({ ...base.items[0], specification: '留下' }, base.items[1]);
  const remote = draft({ ...base.items[2], specification: '对方修改' });
  const pending = mergePackageDraft(base, local, remote, {});
  assert.equal(pending.resolved, false);
  assert.deepEqual(new Set(pending.conflicts.map(entry => entry.key)), new Set(['a:row', 'c:row']));
  const merged = mergePackageDraft(base, local, remote, { 'a:row': 'local', 'c:row': 'remote' });
  assert.equal(merged.resolved, true);
  assert.deepEqual(merged.values.items.map(item => item.itemId), ['c', 'a']);
  assert.deepEqual([...merged.restored], ['a']);
  assert.equal(merged.values.items[1].specification, '留下');
});
