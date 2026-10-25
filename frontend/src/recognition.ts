import type { OrderDraft, ItemDraft } from './orderForm.ts';
import { moneyToCents, storeTime, validDate, newItem } from './orderForm.ts';
import { normalizeSize } from './productRules.ts';
import { randomUUID } from './uuid.ts';
import type { RecognitionDraft, RecognitionField } from './types.ts';

export const recognitionLimit = 12000;
export const recognitionLabels: Record<string, string> = {
  customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '客户订购人',
  fulfillmentType: '交接方式', address: '配送地址', requestedReceiveDate: '收货日期',
  plannedHandoffAt: '取货时间', plannedFinishAt: '计划出品时间', totalAmountCents: '约定总金额（元）',
  name: '商品名称', productType: '商品类型', quantity: '数量', size: '尺寸', flavor: '奶油', base: '内胚',
  filling: '夹馅', message: '祝福语', requirements: '其他要求', unitPriceCents: '商品单价（元）', memberPriceCents: '会员单价（元）',
};
const rootFields = new Set(['customerName', 'phone', 'memberPhone', 'buyerName', 'fulfillmentType', 'address', 'requestedReceiveDate', 'plannedHandoffAt', 'plannedFinishAt', 'totalAmountCents']);
const specificationKeys = new Set(['size', 'flavor', 'base', 'filling', 'message', 'requirements']);
const moneyFields: Record<string, string> = { totalAmountCents: 'totalAmount', unitPriceCents: 'unitPrice', memberPriceCents: 'memberPrice' };
export function recognitionValue(field: string, value: string | null): string {
  if (value == null) return '';
  if (!moneyFields[field]) return value;
  if (!/^\d+$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('识别金额无效，请手工填写。');
  const cents = BigInt(value);
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}
export function validateCandidate(field: string, value: string): string {
  if (!Object.hasOwn(recognitionLabels, field)) throw new Error('不支持的字段。');
  const text = value.trim();
  if (!text) throw new Error('该字段待填写。');
  if (moneyFields[field]) { moneyToCents(text); return text; }
  if (field === 'size') return normalizeSize(text);
  if (field === 'quantity' && (!/^\d+$/.test(text) || BigInt(text) < 1n || BigInt(text) > 2147483647n)) throw new Error('数量需要有效正整数。');
  if (field === 'requestedReceiveDate' && !validDate(text)) throw new Error('需要带年份的有效收货日期。');
  if (field === 'plannedHandoffAt' || field === 'plannedFinishAt') storeTime(text);
  if (field === 'fulfillmentType' && text !== 'DELIVERY' && text !== 'PICKUP') throw new Error('请选择 DELIVERY 或 PICKUP。');
  const maximum = field === 'customerName' || field === 'buyerName' ? 80 : field === 'phone' || field === 'memberPhone' || field === 'productType' ? 32 : field === 'name' ? 128 : 12000;
  if (text.length > maximum) throw new Error('字段过长，请手工核对。');
  return text;
}
export function currentValue(draft: OrderDraft, field: string, itemKey?: string): string {
  const key = moneyFields[field] || field;
  if (itemKey !== undefined) {
    const item = draft.items.find(x => x.key === itemKey);
    return !item ? '' : specificationKeys.has(key) ? item.attributes[key as keyof ItemDraft['attributes']] : String(item[key as keyof ItemDraft] ?? '');
  }
  return rootFields.has(field) ? String(draft[key as keyof OrderDraft] ?? '') : '';
}
export function setCandidate(draft: OrderDraft, field: string, value: string, itemKey?: string, source?: RecognitionField['source']): OrderDraft {
  const text = validateCandidate(field, value), next = structuredClone(draft), key = moneyFields[field] || field;
  if (itemKey !== undefined) {
    const item = next.items.find(x => x.key === itemKey);
    if (!item) throw new Error('目标商品已经被移除，请重新选择。');
    if (specificationKeys.has(key)) {
      item.attributes[key as keyof ItemDraft['attributes']] = text;
      item.defaultSpecifications = (item.defaultSpecifications || []).filter(x => x !== key);
      if (source === 'DEFAULT' && (key === 'base' || key === 'filling')) item.defaultSpecifications.push(key);
    } else if (['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'].includes(key)) {
      Object.assign(item, { [key]: text }); if (key === 'productType') item.requiresTypeConfirmation = false;
    }
    else throw new Error('不支持的商品字段。');
  } else if (rootFields.has(field)) Object.assign(next, { [key]: text });
  else throw new Error('不支持的订单字段。');
  return next;
}
export function pristineItem(item: ItemDraft): boolean {
  const initial = newItem();
  return !item.requiresTypeConfirmation && ['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'].every(key => item[key as keyof ItemDraft] === initial[key as keyof ItemDraft])
    && (Object.keys(initial.attributes) as (keyof ItemDraft['attributes'])[]).every(key => item.attributes[key] === initial.attributes[key])
    && item.defaultSpecifications?.length === initial.defaultSpecifications?.length
    && initial.defaultSpecifications!.every(key => item.defaultSpecifications?.includes(key));
}
export function emptyRecognitionItem(key: string = randomUUID()): ItemDraft {
  return { key, name: '', productType: '', quantity: '', unitPrice: '', memberPrice: '',
    attributes: { size: '', flavor: '', base: '', filling: '', message: '', requirements: '', specification: '' }, defaultSpecifications: [], requiresTypeConfirmation: true };
}
/** Undo only unchanged values written by this fill, preserving later manual edits/removals. */
export function undoRecognition(current: OrderDraft, before: OrderDraft, after: OrderDraft): OrderDraft {
  const result = structuredClone(current);
  for (const field of rootFields) {
    const key = (moneyFields[field] || field) as Exclude<keyof OrderDraft, 'items'>;
    if (before[key] !== after[key] && result[key] === after[key]) Object.assign(result, { [key]: before[key] });
  }
  result.items = result.items.flatMap(item => {
    const written = after.items.find(x => x.key === item.key), original = before.items.find(x => x.key === item.key);
    if (!written) return [item];
    if (!original && JSON.stringify(item) === JSON.stringify(written)) return [];
    const baseline = original || emptyRecognitionItem(item.key);
    for (const field of ['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const)
      if (baseline[field] !== written[field] && item[field] === written[field]) item[field] = baseline[field];
    for (const field of Object.keys(item.attributes) as (keyof ItemDraft['attributes'])[])
      if (baseline.attributes[field] !== written.attributes[field] && item.attributes[field] === written.attributes[field]) item.attributes[field] = baseline.attributes[field];
    if ((Object.keys(baseline.attributes) as (keyof ItemDraft['attributes'])[]).every(key => item.attributes[key] === baseline.attributes[key]))
      item.attributes = { ...baseline.attributes };
    if (JSON.stringify(item.defaultSpecifications) === JSON.stringify(written.defaultSpecifications)) item.defaultSpecifications = baseline.defaultSpecifications;
    if (item.requiresTypeConfirmation === written.requiresTypeConfirmation) {
      if (baseline.requiresTypeConfirmation === undefined) delete item.requiresTypeConfirmation;
      else item.requiresTypeConfirmation = baseline.requiresTypeConfirmation;
    }
    return [item];
  });
  if (!result.items.length) result.items.push(newItem());
  return result;
}
export function mergeModelFields(rules: RecognitionDraft, suggestions: { itemId: string; field: string; candidate: RecognitionField }[]): RecognitionDraft {
  const result = structuredClone(rules);
  const seen = new Map<string, string | null>(), conflicts = new Set<string>();
  for (const suggestion of suggestions) {
    const item = result.items.find(x => x.id === suggestion.itemId), original = item?.fields[suggestion.field];
    if (!item || !original) { result.issues.push('模型建议的商品或字段归属无效，已忽略。'); continue; }
    if (original.source === 'RULE' && original.value !== null) {
      if (original.value !== suggestion.candidate.value) result.issues.push('模型与规则候选冲突，保留规则值，请人工核对。');
      continue;
    }
    const key = suggestion.itemId + '.' + suggestion.field;
    if (conflicts.has(key)) continue;
    if (seen.has(key) && seen.get(key) !== suggestion.candidate.value) {
      const initial = rules.items.find(x => x.id === suggestion.itemId)!.fields[suggestion.field];
      item.fields[suggestion.field] = structuredClone(initial); conflicts.add(key);
      result.issues.push('同一字段的AI建议互相冲突，已保留原候选，请人工填写。'); continue;
    }
    seen.set(key, suggestion.candidate.value);
    item.fields[suggestion.field] = { ...suggestion.candidate, source: 'MODEL', needsReview: true };
  }
  return result;
}
export const recognitionRowKey = (field: string, itemId?: string) => (itemId || 'order') + '.' + field;
export function candidateEdits(result: RecognitionDraft): { values: Record<string, string>; errors: Record<string, string> } {
  const values: Record<string, string> = {}, errors: Record<string, string> = {};
  const read = (field: string, candidate: RecognitionField, id?: string) => {
    const key = recognitionRowKey(field, id);
    try { values[key] = recognitionValue(field, candidate.value); }
    catch (error) { values[key] = ''; errors[key] = (error as Error).message; }
  };
  Object.entries(result.fields).forEach(([field, candidate]) => read(field, candidate));
  result.items.forEach(item => Object.entries(item.fields).forEach(([field, candidate]) => read(field, candidate, item.id)));
  return { values, errors };
}
export function applyRecognition(draft: OrderDraft, initial: OrderDraft, result: RecognitionDraft,
  edits: Record<string, string>, targets: Record<string, string>, manualFields: ReadonlySet<string>,
  only?: { field: string; candidate: RecognitionField; itemId?: string }) {
  let next = structuredClone(draft), applied = 0, skipped = 0, cleared = 0;
  const recognizable = result.items.length > 0 || Object.values(result.fields).some(field => field.source === 'RULE');
  const bound = { ...targets }, errors: Record<string, string> = {};
  const pristine = (key: string) => next.items.some(x => x.key === key && pristineItem(x))
    && ![...manualFields].some(field => field.startsWith(key + '.'));
  const itemKey = (id: string) => {
    let key = bound[id] || 'new';
    if (key === 'new') { const item = emptyRecognitionItem(); key = item.key; next.items.push(item); bound[id] = key; }
    else {
      const index = next.items.findIndex(x => x.key === key);
      if (index < 0) throw new Error('目标商品已移除，请重新选择。');
      if (pristine(key)) next.items[index] = emptyRecognitionItem(key);
    }
    return key;
  };
  const write = (field: string, candidate: RecognitionField, id?: string) => {
    const value = edits[recognitionRowKey(field, id)] ?? '';
    if (!only && !id && field === 'requestedReceiveDate' && candidate.value === null && !value.trim() && recognizable) {
      if (next.requestedReceiveDate && !manualFields.has(field) && next.requestedReceiveDate === initial.requestedReceiveDate) {
        next.requestedReceiveDate = ''; cleared++;
      } else if (next.requestedReceiveDate) skipped++;
      return;
    }
    if (!value.trim() || (!only && candidate.needsReview)) return;
    const selected = id ? bound[id] || 'new' : undefined;
    if (selected === 'choose') { skipped++; return; }
    const current = selected === 'new' ? '' : currentValue(next, field, selected);
    if (current === value && !(selected && selected !== 'new' && pristine(selected))) return;
    const manual = manualFields.has(id ? selected + '.' + field : field);
    const untouchedDefault = id ? selected !== 'new' && pristine(selected!) : current === currentValue(initial, field);
    if (!only && (manual || (current && current !== value && !untouchedDefault))) { skipped++; return; }
    try {
      validateCandidate(field, value);
      const source = candidate.source === 'DEFAULT' && value !== candidate.value ? null : candidate.source;
      next = setCandidate(next, field, value, id ? itemKey(id) : undefined, source); applied++;
    } catch (error) { errors[recognitionRowKey(field, id)] = (error as Error).message; }
  };
  if (only) write(only.field, only.candidate, only.itemId);
  else {
    Object.entries(result.fields).forEach(([field, candidate]) => write(field, candidate));
    result.items.forEach(item => Object.entries(item.fields).forEach(([field, candidate]) => write(field, candidate, item.id)));
  }
  return { draft: next, targets: bound, applied, skipped, cleared, errors };
}
export class RecognitionLifecycle {
  private generation = 0;
  private controllers: AbortController[] = [];
  begin(): { generation: number; signal: AbortSignal } {
    this.cancel(); return this.request();
  }
  request(): { generation: number; signal: AbortSignal } {
    const controller = new AbortController(); this.controllers.push(controller);
    return { generation: this.generation, signal: controller.signal };
  }
  accepts(request: { generation: number; signal: AbortSignal }): boolean { return request.generation === this.generation && !request.signal.aborted; }
  cancel() { this.generation++; this.controllers.forEach(x => x.abort()); this.controllers = []; }
}
