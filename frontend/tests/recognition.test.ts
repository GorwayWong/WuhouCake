import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeItemDraft, createOrderRequest, newDraft, newItem } from '../src/orderForm.ts';
import type { RecognitionDraft, RecognitionField } from '../src/types.ts';
import { RecognitionLifecycle, applyRecognition, candidateEdits, emptyRecognitionItem, mergeModelFields, recognitionValue,
  setCandidate, undoRecognition, validateCandidate } from '../src/recognition.ts';
import { cakeDefaults, normalizeSize } from '../src/productRules.ts';

const field = (value: string | null, source: RecognitionField['source'] = value == null ? null : 'RULE', needsReview = false): RecognitionField =>
  ({ value, source, evidence: source === 'RULE' ? ['合成原文依据'] : [], needsReview, issues: [] });
const candidate = (): RecognitionDraft => ({
  fields: { phone: field('13800000012'), memberPhone: field('13800000012'), requestedReceiveDate: field('2026-09-30'),
    address: field('合成市验收路1号'), plannedHandoffAt: field(null), totalAmountCents: field(null) },
  items: [{ id: 'item-1', fields: { name: field(null), quantity: field(null), productType: field('CAKE'), size: field('8'),
    base: field(cakeDefaults.base, 'DEFAULT'), filling: field('芒果、脆啵啵、奥利奥'), flavor: field(null), message: field(null), requirements: field(null) } }],
  issues: [], fragments: [], unmappedText: [], assistAvailable: false,
});
test('单按钮填明确字段；不造名称、数量、时刻，默认来源明确，原创建校验继续生效', () => {
  const initial = newDraft('2026-10-16'), result = candidate();
  const filled = applyRecognition(initial, initial, result, candidateEdits(result).values, { 'item-1': initial.items[0].key }, new Set());
  assert.equal(filled.draft.phone, '13800000012'); assert.equal(filled.draft.memberPhone, '13800000012');
  assert.equal(filled.draft.requestedReceiveDate, '2026-09-30'); assert.equal(filled.draft.plannedHandoffAt, '');
  assert.equal(filled.draft.items.length, 1); assert.equal(filled.draft.items[0].name, ''); assert.equal(filled.draft.items[0].quantity, '');
  assert.equal(filled.draft.items[0].attributes.size, '8'); assert.equal(filled.draft.items[0].attributes.flavor, '');
  assert.equal(filled.draft.items[0].attributes.filling, '芒果、脆啵啵、奥利奥');
  assert.equal(filled.draft.totalAmount, '');
  const invalid = createOrderRequest(filled.draft);
  assert(invalid.errors['items.0.name'] && invalid.errors['items.0.quantity'] && invalid.errors.plannedHandoffAt);
  filled.draft.items[0].name = '人工补充蛋糕'; filled.draft.items[0].quantity = '1'; filled.draft.plannedHandoffAt = '2026-09-30T15:00';
  assert.ok(createOrderRequest(filled.draft).request);
});
test('请求期间人工输入含显式清空均保留，逐字段明确选择才替换', () => {
  const initial = newDraft('2026-10-16'), current = structuredClone(initial), result = candidate();
  current.phone = '13900000013'; current.address = ''; current.requestedReceiveDate = '2026-10-17';
  const edits = candidateEdits(result).values, manual = new Set(['phone', 'address', 'requestedReceiveDate']);
  const filled = applyRecognition(current, initial, result, edits, { 'item-1': 'new' }, manual);
  assert.equal(filled.draft.phone, current.phone); assert.equal(filled.draft.address, '');
  assert.equal(filled.draft.requestedReceiveDate, current.requestedReceiveDate);
  const chosen = applyRecognition(filled.draft, initial, result, edits, filled.targets, manual, { field: 'phone', candidate: result.fields.phone });
  assert.equal(chosen.draft.phone, '13800000012');
});
test('多商品候选分别绑定，不修改已有手工商品，无效字段不妨碍其他填充', () => {
  const initial = newDraft('2026-10-16'), current = structuredClone(initial); current.items[0].name = '已有手工蛋糕';
  const result = candidate(); result.items.push({ id: 'item-2', fields: { name: field('杯子蛋糕'), productType: field('CUPCAKE'), quantity: field('6'), unitPriceCents: field('100.001') } });
  const prepared = candidateEdits(result), filled = applyRecognition(current, initial, result, prepared.values, { 'item-1': 'new', 'item-2': 'new' }, new Set());
  assert.equal(filled.draft.items[0].name, '已有手工蛋糕'); assert.equal(filled.draft.items.length, 3);
  assert.equal(filled.draft.items[1].attributes.size, '8'); assert.equal(filled.draft.items[2].quantity, '6');
  assert.equal(filled.draft.items[2].unitPrice, ''); assert(prepared.errors['item-2.unitPriceCents']);
  assert.equal(filled.draft.items[2].attributes.base, '');
});
test('撤销只还原识别写入且未再编辑的值，不复活员工移除的商品', () => {
  const before = newDraft('2026-10-16'), result = candidate();
  const after = applyRecognition(before, before, result, candidateEdits(result).values, { 'item-1': 'new' }, new Set()).draft;
  const current = structuredClone(after); current.phone = '13900000014'; current.items[1].name = '之后人工起名';
  const restored = undoRecognition(current, before, after);
  assert.equal(restored.phone, '13900000014'); assert.equal(restored.address, before.address);
  assert.equal(restored.items[1].name, '之后人工起名'); assert.equal(restored.items[1].attributes.size, '');
  current.items = current.items.filter(x => x.key !== before.items[0].key);
  assert(!undoRecognition(current, before, after).items.some(x => x.key === before.items[0].key));
});
test('模型与规则冲突保留规则，模型建议始终待确认且不自动填表', () => {
  const rules = candidate(), model = mergeModelFields(rules, [
    { itemId: 'item-1', field: 'filling', candidate: field('草莓', 'MODEL') },
    { itemId: 'item-1', field: 'flavor', candidate: field('动物奶油', 'MODEL') },
    { itemId: 'other', field: 'name', candidate: field('串单', 'MODEL') },
  ]);
  assert.equal(model.items[0].fields.filling.value, rules.items[0].fields.filling.value);
  assert.equal(model.items[0].fields.flavor.source, 'MODEL'); assert.equal(model.items[0].fields.flavor.needsReview, true);
  assert.equal(model.issues.length, 2);
  const initial = newDraft('2026-10-16'), filled = applyRecognition(initial, initial, model, candidateEdits(model).values, { 'item-1': initial.items[0].key }, new Set());
  assert.equal(filled.draft.items[0].attributes.flavor, '');
});
test('两轮、取消与卸载均使旧信号失效；迟到响应不能写入下一轮', async () => {
  const lifecycle = new RecognitionLifecycle(), first = lifecycle.begin(), assist = lifecycle.request();
  const second = lifecycle.begin();
  assert(first.signal.aborted && assist.signal.aborted); assert.equal(lifecycle.accepts(first), false);
  assert.equal(lifecycle.accepts(second), true); lifecycle.cancel(); assert.equal(lifecycle.accepts(second), false);
});
test('蛋糕默认值共用单一资源，非蛋糕移除自动默认，明确手工规格保留', () => {
  const cake = newItem(); assert.equal(cake.attributes.base, cakeDefaults.base);
  const cupcake = changeItemDraft(cake, { productType: 'CUPCAKE' }); assert.equal(cupcake.attributes.base, ''); assert.equal(cupcake.attributes.filling, '');
  const explicit = changeItemDraft(cake, { attributes: { ...cake.attributes, base: '原味' } }, 'base');
  assert.equal(changeItemDraft(explicit, { productType: 'DONUT' }).attributes.base, '原味');
  assert.equal(normalizeSize('08.00寸'), '8'); assert.throws(() => normalizeSize('4寸-6寸'));
  for (const size of ['8.123寸', '1234567890寸', '-8寸', '4寸高']) assert.throws(() => normalizeSize(size));
});
test('候选金额和字段白名单验证不影响其他字段，也不能引入付款状态', () => {
  assert.equal(recognitionValue('unitPriceCents', '19929'), '199.29'); assert.equal(recognitionValue('totalAmountCents', '0'), '0.00');
  assert.throws(() => validateCandidate('paymentStatus', 'PAID')); assert.throws(() => validateCandidate('quantity', '0'));
  const draft = newDraft('2026-10-16'); draft.items.push(emptyRecognitionItem());
  assert.throws(() => setCandidate(draft, 'paymentStatus', 'PAID'));
  assert.equal('paymentStatus' in draft, false);
});
test('重复识别、撤销和再识别不受对象键顺序影响，明确夹馅始终优先于默认', () => {
  const initial = newDraft('2026-10-16'), result = candidate(), edits = candidateEdits(result).values;
  const first = applyRecognition(initial, initial, result, edits, { 'item-1': initial.items[0].key }, new Set());
  const manual = structuredClone(first.draft); manual.phone = '13900000013';
  const second = applyRecognition(manual, initial, result, edits, first.targets, new Set(['phone']));
  const undone = undoRecognition(second.draft, initial, first.draft);
  const refilled = applyRecognition(undone, initial, result, edits, first.targets, new Set(['phone']));
  const edited = changeItemDraft(refilled.draft.items[0], { name: '人工补充蛋糕', quantity: '1' });
  assert.equal(edited.attributes.filling, '芒果、脆啵啵、奥利奥');
  assert.equal(refilled.draft.items[0].quantity, '');
  assert.equal(refilled.draft.phone, '13900000013');
  const clean = undoRecognition(first.draft, initial, first.draft);
  assert.equal(JSON.stringify(clean), JSON.stringify(initial));
});
test('重复模型建议冲突时恢复原候选，不能以最后一条替代', () => {
  const initial = candidate();
  const result = mergeModelFields(initial, [
    { itemId: 'item-1', field: 'flavor', candidate: field('动物奶油', 'MODEL') },
    { itemId: 'item-1', field: 'flavor', candidate: field('植物奶油', 'MODEL') },
  ]);
  assert.equal(result.items[0].fields.flavor.value, null); assert.equal(result.issues.length, 1);
});
test('缺失或冲突日期清空未手改初始日期，手动日期保留，非订单不修改草稿', () => {
  const initial = newDraft('2026-10-16'), result = candidate();
  result.fields.requestedReceiveDate = field(null, 'RULE', true);
  let filled = applyRecognition(initial, initial, result, candidateEdits(result).values, { 'item-1': initial.items[0].key }, new Set());
  assert.equal(filled.draft.requestedReceiveDate, ''); assert.equal(filled.cleared, 1);
  const manual = structuredClone(initial); manual.requestedReceiveDate = '2026-10-17';
  filled = applyRecognition(manual, initial, result, candidateEdits(result).values, { 'item-1': 'choose' }, new Set(['requestedReceiveDate']));
  assert.equal(filled.draft.requestedReceiveDate, '2026-10-17');
  const unrelated: RecognitionDraft = { fields: { requestedReceiveDate: field(null) }, items: [], issues: ['非订单'], fragments: [], unmappedText: [], assistAvailable: false };
  assert.deepEqual(applyRecognition(initial, initial, unrelated, candidateEdits(unrelated).values, {}, new Set()).draft, initial);
});
test('识别未知商品类型不能静默回落CAKE，手工确认后沿用原创建接口', () => {
  const draft = newDraft('2026-10-16'); draft.phone = '13800000001'; draft.fulfillmentType = 'PICKUP'; draft.plannedHandoffAt = '2026-10-16T15:00';
  const item = emptyRecognitionItem(); item.name = '合成曲奇'; item.quantity = '6'; draft.items = [item];
  assert.ok(createOrderRequest(draft).errors['items.0.productType']);
  draft.items[0] = changeItemDraft(item, { productType: 'COOKIE' });
  const request = createOrderRequest(draft).request!;
  assert.equal(request.items[0].productType, 'COOKIE'); assert.equal('requiresTypeConfirmation' in request.items[0], false);
});
