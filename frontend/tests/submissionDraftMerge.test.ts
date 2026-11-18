import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftFromSubmission } from '../src/customerSubmission.ts';
import type { Submission } from '../src/customerSubmission.ts';
import { newItem } from '../src/orderForm.ts';
import { mergeSubmissionDraft } from '../src/submissionDraftMerge.ts';

function basis() {
  const content = { phone: '13800000000', memberPhone: null, fulfillmentType: 'PICKUP' as const,
    address: null, requestedReceiveAt: '2026-11-17T12:00:00Z', items: [
      { itemId: 'one', name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '6' } },
      { itemId: 'two', name: '饼干', productType: 'OTHER', quantity: 1, attributes: { specification: '一盒' } },
    ] };
  return draftFromSubmission({ original: content, reviewed: {
    content, totalAmountCents: 12000, creditedEmployeeId: 'staff', plannedHandoffAt: content.requestedReceiveAt, prices: [],
  }} as unknown as Submission);
}

test('客服合并独立字段、独立商品和两边追加项，保持稳定 ID', () => {
  const base = basis();
  const local = { ...base, phone: '13900000000', items: [{ ...base.items[0], quantity: '2' }, base.items[1],
    { ...newItem(), key: 'added-local', name: '本地追加' }] };
  const remote = { ...base, totalAmount: '130.00', items: [base.items[0], { ...base.items[1], name: '同事修改' },
    { ...newItem(), key: 'added-remote', name: '同事追加' }] };
  const merged = mergeSubmissionDraft(base, local, remote, true);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.value.phone, local.phone);
  assert.equal(merged.value.totalAmount, remote.totalAmount);
  assert.deepEqual(merged.value.items.map(item => [item.key, item.name, item.quantity]), [
    ['one', '蛋糕', '2'], ['two', '同事修改', '1'], ['added-remote', '同事追加', '1'], ['added-local', '本地追加', '1'],
  ]);
});

test('重叠的联系电话、交接和商品删除需明确选择', () => {
  const base = basis();
  const local = { ...base, phone: '13700000000', address: '本地地址', items: [base.items[1]] };
  const remote = { ...base, phone: '13900000000', address: '同事地址', items: [{ ...base.items[0], quantity: '4' }, base.items[1]] };
  const choices = { phone: 'local', handoff: 'remote', 'item:one': 'remote' } as const;
  const merged = mergeSubmissionDraft(base, local, remote, true, choices);
  assert.deepEqual(merged.conflicts.map(conflict => conflict.id), ['phone', 'handoff', 'item:one']);
  assert.equal(merged.value.phone, local.phone);
  assert.equal(merged.value.address, remote.address);
  assert.equal(merged.value.items[0].quantity, '4');
});

test('历史商品 ID 不可靠时保留输入供复制，采用服务端商品与报价关联', () => {
  const base = basis();
  const local = { ...base, items: [{ ...base.items[0], name: '本地编辑的历史蛋糕', attributes: { size: '6', '旧规格': '夹层要求' } }, base.items[1]] };
  const remote = { ...base, items: [{ ...base.items[0], key: 'server-id', unitPrice: '90.00' }, base.items[1]] };
  const merged = mergeSubmissionDraft(base, local, remote, false, { 'legacy-items': 'local' });
  assert.equal(merged.conflicts[0].copyOnly, true);
  assert.match(merged.copiedItems!, /本地编辑的历史蛋糕/);
  assert.match(merged.copiedItems!, /旧规格：夹层要求/);
  assert.equal(merged.value.items[0].key, 'server-id');
  assert.equal(merged.value.items[0].unitPrice, '90.00');
});
