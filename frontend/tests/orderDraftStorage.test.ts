import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftConflict, OrderDraftSlot, decodeOrderDraft, draftStorageKey, freshOrderDraft, hasDraftContent } from '../src/orderDraftStorage.ts';
import { createOrderRequest, newItem } from '../src/orderForm.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('下单方式其他选项的未完成输入可恢复，非法选择状态拒绝恢复', () => {
  const db = storage(), slot = new OrderDraftSlot('alice', () => db), record = freshOrderDraft('alice', '2026-11-05');
  record.value = { ...record.value, orderingMethod: '', orderingMethodCustom: true };
  const saved = slot.write(record);
  assert.equal(slot.read().record?.value.orderingMethodCustom, true);
  assert.ok(createOrderRequest(slot.read().record!.value).errors.orderingMethod);
  const malformed = JSON.parse(JSON.stringify(saved)); malformed.value.orderingMethodCustom = 'OTHER';
  assert.equal(decodeOrderDraft(JSON.stringify(malformed), 'alice'), null);
});
test('旧蛋糕草稿恢复独立报价并保留结果待确认载荷', () => {
  const db = storage(), slot = new OrderDraftSlot('alice', () => db), record = freshOrderDraft('alice', '2026-11-04');
  record.value = structuredClone(record.value); record.value.items[0].name = '旧蛋糕'; record.value.phone = '13800000000'; record.value.address = '自提';
  record.value.items[0].unitPrice = '120'; record.value.items[0].memberPrice = '未完成';
  record.pending = createOrderRequest(record.value).request!;
  delete record.pending.items[0].referenceUnitPriceCents;
  record.pending.items[0].unitPriceCents = 12000;
  record.value.items[0].attributes.specification = '轻拿轻放\n原会员单价：0 元（仅供参考）';
  const saved = slot.write(record), before = db.getItem(draftStorageKey('alice'));
  const restored = slot.read().record!;
  assert.equal(restored.value.items[0].unitPrice, '120.00'); assert.equal(restored.value.items[0].memberPrice, '0.00');
  assert.equal(restored.value.items[0].attributes.specification, '轻拿轻放');
  const item = createOrderRequest(restored.value).request!.items[0];
  assert.equal(item.referenceUnitPriceCents, 12000);
  assert.equal(item.referenceMemberPriceCents, 0);
  assert.equal(item.attributes.specification, '轻拿轻放');
  assert.deepEqual(restored.pending, saved.pending); assert.equal(restored.pending!.items[0].unitPriceCents, 12000);
  assert.equal(db.getItem(draftStorageKey('alice')), before);
});
test('草稿保存商品图片引用和已创建订单，不序列化文件，并兼容奶油默认来源', () => {
  const slot = new OrderDraftSlot('alice', () => storage());
  const record = freshOrderDraft('alice', '2026-11-04');
  record.value = structuredClone(record.value);
  record.value.items[0].images = [{ id: crypto.randomUUID(), name: 'cake.png', type: 'image/png', size: 100 }];
  record.value.items[0].defaultSpecifications = ['base', 'filling', 'flavor'];
  record.createdOrderId = crypto.randomUUID();
  const saved = slot.write(record);
  assert.deepEqual(decodeOrderDraft(JSON.stringify(saved), 'alice'), saved);
  assert.equal(decodeOrderDraft(JSON.stringify(saved), 'bob'), null);
  assert.equal(hasDraftContent(saved), true);
  const tooMany = structuredClone(saved);
  tooMany.value.items[0].images = Array.from({ length: 6 }, () => ({ id: crypto.randomUUID(), name: 'x.png', type: 'image/png', size: 1 }));
  assert.equal(decodeOrderDraft(JSON.stringify(tooMany), 'alice'), null);
});
test('空白默认表单不算草稿，原文或部分输入即算有效内容', () => {
  const record = freshOrderDraft('alice', '2026-11-04');
  assert.equal(hasDraftContent(record), false);
  assert.equal(hasDraftContent({ ...record, editor: { ...record.editor, text: '客户微信原文' } }), true);
  assert.equal(hasDraftContent({ ...record, value: { ...record.value, totalAmount: '199.' } }), true);
});
test('刷新恢复完整输入、稳定商品标识、识别标记和手工修改保护', () => {
  const db = storage(), slot = new OrderDraftSlot('alice', () => db);
  const record = freshOrderDraft('alice', '2026-11-04');
  record.value = { ...record.value, customerName: '王女士', totalAmount: '199.', items: [...record.value.items, newItem()] };
  record.editor = { ...record.editor, text: '明天下午送到公司，祝生日快乐 🎂', open: true, selectedItemKey: record.value.items[1].key, scrollY: 850,
    manualFields: ['customerName', `${record.value.items[1].key}.unitPriceCents`],
    feedback: { phone: { field: 'phone', value: '', source: 'RULE', needsReview: true, error: '请补充联系电话' } } };
  const saved = slot.write(record);
  assert.deepEqual(new OrderDraftSlot('alice', () => db).read(), { record: saved, invalid: false });
  assert.equal(saved.requestId, record.requestId);
  assert.equal(decodeOrderDraft(JSON.stringify(saved), 'bob'), null);
});
test('账号各自存储，清除草稿不会移除其他员工或其他应用数据', () => {
  const db = storage(), alice = new OrderDraftSlot('alice', () => db), bob = new OrderDraftSlot('bob', () => db);
  db.setItem('unrelated', 'keep');
  alice.write(freshOrderDraft('alice', '2026-11-04')); bob.write(freshOrderDraft('bob', '2026-11-04'));
  alice.remove();
  assert.equal(db.getItem(draftStorageKey('alice')), null);
  assert.ok(bob.read().record);
  assert.equal(db.getItem('unrelated'), 'keep');
});
test('损坏、未知版本及无效嵌套结构只报告不可恢复，不自动删除', () => {
  const db = storage(), slot = new OrderDraftSlot('alice', () => db);
  const saved = slot.write(freshOrderDraft('alice', '2026-11-04'));
  for (const raw of ['{', JSON.stringify({ ...saved, version: 2 }), JSON.stringify({ ...saved, value: { ...saved.value, items: [{}] } }),
    JSON.stringify({ ...saved, editor: { ...saved.editor, feedback: { phone: {} } } }), JSON.stringify({ ...saved, pending: {} })]) {
    db.setItem(draftStorageKey('alice'), raw);
    assert.deepEqual(slot.read(), { record: null, invalid: true });
    assert.equal(db.getItem(draftStorageKey('alice')), raw);
  }
});
test('旧标签页不能覆盖、删除新版本；其他标签页清除后也不能复活旧草稿', () => {
  const db = storage(), first = new OrderDraftSlot('alice', () => db), second = new OrderDraftSlot('alice', () => db);
  const saved = first.write(freshOrderDraft('alice', '2026-11-04'));
  second.read();
  first.write({ ...saved, editor: { ...saved.editor, text: '最新原文' } });
  assert.throws(() => second.write(saved), DraftConflict);
  assert.throws(() => second.remove(), DraftConflict);
  const latest = second.read().record!;
  second.remove();
  assert.throws(() => first.write(latest), DraftConflict);
});
test('存储拒绝读写或空间不足时抛出失败，保留之前的成功快照', () => {
  const db = storage(); let full = false;
  const slot = new OrderDraftSlot('alice', () => ({ ...db, setItem: (key, value) => { if (full) throw new Error('quota'); db.setItem(key, value); } }));
  const saved = slot.write(freshOrderDraft('alice', '2026-11-04'));
  full = true;
  assert.throws(() => slot.write({ ...saved, editor: { ...saved.editor, text: '尚未落盘' } }), /quota/);
  assert.deepEqual(slot.read().record, saved);
  assert.throws(() => new OrderDraftSlot('alice', () => { throw new Error('denied'); }).read(), /denied/);
});
test('结果待确认的原始载荷和幂等标识跨重载保持不变', () => {
  const db = storage(), slot = new OrderDraftSlot('alice', () => db), record = freshOrderDraft('alice', '2026-11-04');
  record.value = structuredClone(record.value);
  record.value.phone = '13800000000'; record.value.address = '自提'; record.value.items[0].name = '生日蛋糕';
  const request = createOrderRequest(record.value).request!;
  assert.ok(request);
  const saved = slot.write({ ...record, pending: request });
  const restored = new OrderDraftSlot('alice', () => db).read().record!;
  assert.equal(restored.requestId, record.requestId);
  assert.deepEqual(restored.pending, request);
  assert.equal(hasDraftContent(restored), true);
  const editable = slot.write({ ...saved, pending: undefined });
  assert.equal(editable.pending, undefined);
  slot.remove();
  assert.equal(new OrderDraftSlot('alice', () => db).read().record, null);
});
