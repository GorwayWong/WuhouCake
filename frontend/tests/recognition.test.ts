import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeItemDraft, createOrderRequest, newDraft, newItem } from '../src/orderForm.ts';
import type { RecognitionDraft, RecognitionField } from '../src/types.ts';
import { RecognitionLifecycle, applyRecognition, emptyRecognitionItem, mergeModelFields, recognitionValue,
  setCandidate, undoRecognition, validateCandidate, retainRecognitionFeedback, formFeedback, feedbackKey, orderEntryRecognition } from '../src/recognition.ts';
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
const apply = (draft = newDraft('2026-10-16'), result = candidate()) => applyRecognition(draft, newDraft('2026-10-16'), result, new Set());

test('蛋糕识别不带入单价或价格错误，其他商品按类型优先处理单价，不推算整单金额', () => {
  const cake = candidate(); cake.items[0].fields.unitPriceCents = field('非法金额'); cake.items[0].fields.memberPriceCents = field('10000');
  const ignored = apply(newDraft('2026-10-16'), cake);
  assert.equal(ignored.draft.items[0].unitPrice, ''); assert.equal(ignored.draft.items[0].memberPrice, '');
  assert.equal(Object.values(ignored.feedback).some(mark => ['unitPriceCents', 'memberPriceCents'].includes(mark.field)), false);
  assert.equal(ignored.draft.totalAmount, '');
  const drink = candidate(); drink.items[0].fields = { unitPriceCents: field('1029'), memberPriceCents: field('0'), name: field('饮品'), quantity: field('2'), productType: field('DRINK') };
  const priced = apply(newDraft('2026-10-16'), drink).draft;
  assert.equal(priced.items[0].unitPrice, '10.29'); assert.equal(priced.items[0].memberPrice, '0.00'); assert.equal(priced.totalAmount, '');
});

test('识别默认奶油在品类切换时清除，手工确认后的奶油保留', () => {
  const draft = newDraft('2026-11-04'), key = draft.items[0].key;
  const filled = setCandidate(draft, 'flavor', cakeDefaults.flavor, key, 'DEFAULT').items[0];
  assert.ok(filled.defaultSpecifications?.includes('flavor'));
  assert.equal(changeItemDraft(filled, { productType: 'BREAD' }).attributes.flavor, '');
  const manual = changeItemDraft(filled, { attributes: { ...filled.attributes, flavor: '巧克力奶油' } }, 'flavor');
  assert.equal(changeItemDraft(manual, { productType: 'BREAD' }).attributes.flavor, '巧克力奶油');
});

test('新建页识别将自提写入地址，仅有取货时间时带入收货时间，并保留手工地址和日期', () => {
  const result = candidate();
  result.fields.fulfillmentType = field('PICKUP');
  result.fields.requestedReceiveDate = field(null);
  result.fields.plannedHandoffAt = field('2027-01-02T10:30');
  const normalized = orderEntryRecognition(result, new Set());
  assert.equal(normalized.fields.address.value, '自提');
  assert.equal(normalized.fields.requestedReceiveAt.value, '2027-01-02T10:30');
  assert.equal('plannedHandoffAt' in normalized.fields, false);
  assert.equal('fulfillmentType' in normalized.fields, false);
  const manual = orderEntryRecognition(result, new Set(['address', 'requestedReceiveDate']));
  assert.equal('address' in manual.fields, false);
  assert.equal('requestedReceiveAt' in manual.fields, false);
  result.fields.requestedReceiveAt = field('2027-01-02T11:30');
  assert.equal(orderEntryRecognition(result, new Set()).fields.requestedReceiveAt.value, '2027-01-02T10:30');
});

test('一次填入明确及疑义字段，默认来源明确，不造名称、数量和时刻', () => {
  const result = candidate(); result.items[0].fields.filling.needsReview = true;
  const filled = apply(undefined, result);
  assert.equal(filled.draft.phone, '13800000012'); assert.equal(filled.draft.requestedReceiveAt, '2026-09-30');
  const item = filled.draft.items[0];
  assert.equal(item.name, ''); assert.equal(item.quantity, ''); assert.equal(filled.draft.plannedHandoffAt, '');
  assert.equal(item.attributes.filling, '芒果、脆啵啵、奥利奥');
  assert.equal(filled.feedback[feedbackKey('filling', item.key)].needsReview, true);
  assert.equal(filled.feedback[feedbackKey('base', item.key)].source, 'DEFAULT');
  const invalid = createOrderRequest(filled.draft);
  assert(invalid.errors['items.0.name'] && invalid.errors['items.0.quantity']);
});
test('有效值覆盖手工内容，缺失字段保留，金额按元写入并计数覆盖', () => {
  const initial = newDraft('2026-10-16'), current = structuredClone(initial), result = candidate();
  current.phone = '13900000013'; current.address = '旧地址'; current.buyerName = '原订购人'; current.totalAmount = '100';
  result.fields.totalAmountCents = field('169900'); result.fields.phone.needsReview = true;
  const filled = applyRecognition(current, initial, result, new Set(['phone', 'address', 'totalAmountCents']));
  assert.equal(filled.draft.phone, '13800000012'); assert.equal(filled.draft.address, '合成市验收路1号');
  assert.equal(filled.draft.buyerName, current.buyerName); assert.equal(filled.draft.totalAmount, '1699.00');
  assert(filled.overwritten >= 3);
});
test('多商品替换整个列表，重复识别不追加；无效值不妨碍其他字段', () => {
  const current = newDraft('2026-10-16'); current.items[0].name = '原蛋糕'; current.items.push(newItem());
  const result = candidate(); result.items.push({ id: 'item-2', fields: { name: field('曲奇'), productType: field('COOKIE'), quantity: field('6'), unitPriceCents: field('100.001') } });
  const filled = apply(current, result);
  assert.equal(filled.replacedItems, true); assert.equal(filled.draft.items.length, 2);
  assert(!filled.draft.items.some(item => current.items.some(old => old.key === item.key)));
  assert.equal(filled.draft.items[1].quantity, '6'); assert.equal(filled.draft.items[1].unitPrice, '');
  assert(filled.feedback[feedbackKey('unitPriceCents', filled.draft.items[1].key)].error);
  assert.equal(apply(filled.draft, result).draft.items.length, 2);
});
test('没有有效商品内容时保留已有商品，不因空标题或无效数量清空商品', () => {
  const current = newDraft('2026-10-16'); current.items[0].name = '手工蛋糕';
  const result = candidate(); result.items = [{ id: 'item-1', fields: { productType: field('CAKE'), quantity: field('0') } }];
  const filled = apply(current, result);
  assert.deepEqual(filled.draft.items, current.items);
  assert(filled.feedback[feedbackKey('quantity', current.items[0].key)].error);
  result.items = []; assert.deepEqual(apply(current, result).draft.items, current.items);
});
test('撤销替换恢复原商品，新带入商品经手改则整体保留，主动删除的商品不复活', () => {
  const before = newDraft('2026-10-16'); before.items[0].name = '原蛋糕';
  const after = apply(before).draft;
  assert.deepEqual(undoRecognition(after, before, after), before);
  const current = structuredClone(after); current.phone = '13900000014'; current.items[0].name = '手工命名';
  const restored = undoRecognition(current, before, after);
  assert.equal(restored.phone, '13900000014'); assert.equal(restored.address, before.address);
  assert.equal(restored.items[0].name, '原蛋糕'); assert.deepEqual(restored.items[1], current.items[0]);
  current.items = [];
  assert(!undoRecognition(current, before, after).items.some(item => item.key === after.items[0].key));
});
test('字段强调按商品key跟踪，手工改值及删除移除标记，索引变化不串项', () => {
  const filled = apply(), current = structuredClone(filled.draft), key = current.items[0].key;
  current.items.unshift(newItem()); current.phone = '13900000001';
  const retained = retainRecognitionFeedback(current, filled.feedback), mapped = formFeedback(current, retained);
  assert.equal(retained[feedbackKey('phone')], undefined);
  assert.equal(mapped['items.0.size'], undefined); assert.equal(mapped['items.1.size'].itemKey, key);
  current.items = current.items.filter(item => item.key !== key);
  assert(!Object.values(retainRecognitionFeedback(current, retained)).some(mark => mark.itemKey === key));
});
test('撤销将收货日期与时刻作为整体，保留用户只修改时刻后的完整日期时间', () => {
  const before = newDraft('2026-11-01'), result = candidate();
  result.fields.requestedReceiveDate = field('2026-11-03'); result.fields.requestedReceiveAt = field('2026-11-03T18:30');
  const after = apply(before, result).draft;
  const current = { ...after, requestedReceiveAt: '2026-11-03T19:30' };
  const restored = undoRecognition(current, before, after);
  assert.equal(restored.requestedReceiveDate, '2026-11-03'); assert.equal(restored.requestedReceiveAt, '2026-11-03T19:30');
});
test('AI补充只写入模型字段，不替换商品、不重放规则，撤销保留后续手工修改', () => {
  const initial = newDraft('2026-10-16'), rules = candidate(), first = apply(initial, rules);
  const current = structuredClone(first.draft); current.phone = '13900000013'; current.items[0].name = '人工名称';
  const merged = mergeModelFields(rules, [{ itemId: 'item-1', field: 'flavor', candidate: field('动物奶油', 'MODEL') }]);
  const filled = applyRecognition(current, initial, merged, new Set(), { supplement: true, targets: first.targets });
  assert.deepEqual(filled.draft.items.map(item => item.key), current.items.map(item => item.key));
  assert.equal(filled.draft.phone, current.phone); assert.equal(filled.draft.items[0].name, '人工名称');
  assert.equal(filled.draft.items[0].attributes.flavor, '动物奶油');
  assert.equal(filled.feedback[feedbackKey('flavor', current.items[0].key)].needsReview, true);
  const edited = structuredClone(filled.draft); edited.items[0].attributes.flavor = '手改奶油';
  assert.equal(undoRecognition(edited, current, filled.draft).items[0].attributes.flavor, '手改奶油');
});
test('缺失日期清空未手改初始日期，保留手动日期；非订单不修改草稿', () => {
  const initial = newDraft('2026-10-16'), result = candidate(); result.fields.requestedReceiveDate = field(null, 'RULE', true);
  const filled = apply(initial, result); assert.equal(filled.draft.requestedReceiveDate, ''); assert.equal(filled.cleared, 1);
  assert(filled.feedback[feedbackKey('requestedReceiveAt')].error);
  const manual = { ...initial, requestedReceiveAt: '2026-10-16T18:30' };
  assert.equal(applyRecognition(manual, initial, result, new Set(['requestedReceiveAt'])).draft.requestedReceiveAt, manual.requestedReceiveAt);
  const unrelated: RecognitionDraft = { fields: { requestedReceiveDate: field(null) }, items: [], issues: ['非订单'], fragments: [], unmappedText: [], assistAvailable: false };
  assert.deepEqual(apply(initial, unrelated).draft, initial);
});
test('完整时刻优先于日期，不依赖返回字段顺序；未知商品类型留空', () => {
  const result = candidate(); result.fields = { requestedReceiveAt: field('2026-11-03T18:30'), requestedReceiveDate: field('2026-11-03') };
  result.items[0].fields.productType = field('UNKNOWN');
  const filled = apply(undefined, result);
  assert.equal(filled.draft.requestedReceiveAt, '2026-11-03T18:30'); assert.equal(filled.draft.items[0].productType, '');
  assert(filled.feedback[feedbackKey('productType', filled.draft.items[0].key)].error);
});
test('模型冲突保留规则，重复模型建议冲突不以最后一条覆盖', () => {
  const rules = candidate(), result = mergeModelFields(rules, [
    { itemId: 'item-1', field: 'filling', candidate: field('草莓', 'MODEL') },
    { itemId: 'item-1', field: 'flavor', candidate: field('动物奶油', 'MODEL') },
    { itemId: 'item-1', field: 'flavor', candidate: field('植物奶油', 'MODEL') },
  ]);
  assert.equal(result.items[0].fields.filling.value, rules.items[0].fields.filling.value);
  assert.equal(result.items[0].fields.flavor.value, null); assert.equal(result.issues.length, 2);
});
test('取消、下一轮和卸载使迟到响应失效', () => {
  const lifecycle = new RecognitionLifecycle(), first = lifecycle.begin(), assist = lifecycle.request(), second = lifecycle.begin();
  assert(first.signal.aborted && assist.signal.aborted); assert(!lifecycle.accepts(first)); assert(lifecycle.accepts(second));
  lifecycle.cancel(); assert(!lifecycle.accepts(second));
});
test('保留金额、字段白名单和规格校验，未知类型由正常表单补齐', () => {
  assert.equal(recognitionValue('unitPriceCents', '19929'), '199.29'); assert.equal(recognitionValue('totalAmountCents', '0'), '0.00');
  assert.throws(() => validateCandidate('paymentStatus', 'PAID')); assert.throws(() => validateCandidate('quantity', '0'));
  assert.throws(() => setCandidate(newDraft('2026-10-16'), 'paymentStatus', 'PAID'));
  assert.equal(normalizeSize('08.00寸'), '8'); assert.throws(() => normalizeSize('4寸-6寸'));
  const item = emptyRecognitionItem(); assert.equal(changeItemDraft(item, { productType: 'COOKIE' }).requiresTypeConfirmation, false);
  const cake = newItem(); assert.equal(cake.attributes.base, cakeDefaults.base);
  assert.equal(changeItemDraft(cake, { productType: 'CUPCAKE' }).attributes.base, '');
});
