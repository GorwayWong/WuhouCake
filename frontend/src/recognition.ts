import type { OrderDraft, ItemDraft } from './orderForm.ts';
import { moneyToCents, storeTime, validDate, newItem } from './orderForm.ts';
import { normalizeSize } from './productRules.ts';
import { normalizeProductType, productTypes } from './productTypes.ts';
import { randomUUID } from './uuid.ts';
import type { RecognitionDraft, RecognitionField } from './types.ts';

export const recognitionLimit = 12000;
export const recognitionLabels: Record<string, string> = {
  customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '订购人姓名',
  fulfillmentType: '交接方式', address: '配送地址', requestedReceiveDate: '客户收货日期', requestedReceiveAt: '客户收货时间',
  plannedHandoffAt: '到店取货时间', plannedFinishAt: '计划出品时间', totalAmountCents: '约定总金额（元）',
  name: '商品名称', productType: '商品类型', quantity: '数量', specification: '规格', size: '尺寸', flavor: '奶油', base: '内胚',
  filling: '夹馅', message: '祝福语', requirements: '其他要求', unitPriceCents: '商品单价（元）', memberPriceCents: '会员单价（元）',
};
const rootFields = new Set(['customerName', 'phone', 'memberPhone', 'buyerName', 'fulfillmentType', 'address', 'requestedReceiveDate', 'requestedReceiveAt', 'plannedHandoffAt', 'plannedFinishAt', 'totalAmountCents']);
const specificationKeys = new Set(['specification', 'size', 'flavor', 'base', 'filling', 'message', 'requirements']);
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
  if (field === 'productType') {
    const type = normalizeProductType(text);
    if (!Object.hasOwn(productTypes, type)) throw new Error('请选择商品类型。');
    return type;
  }
  if (field === 'size') return normalizeSize(text);
  if (field === 'quantity' && (!/^\d+$/.test(text) || BigInt(text) < 1n || BigInt(text) > 2147483647n)) throw new Error('数量需要有效正整数。');
  if (field === 'requestedReceiveDate' && !validDate(text)) throw new Error('需要带年份的有效收货日期。');
  if (field === 'requestedReceiveAt' || field === 'plannedHandoffAt' || field === 'plannedFinishAt') storeTime(text);
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
  } else if (rootFields.has(field)) {
    Object.assign(next, { [key]: text });
    if (field === 'requestedReceiveDate') next.requestedReceiveAt = text;
    if (field === 'requestedReceiveAt') next.requestedReceiveDate = text.slice(0, 10);
  }
  else throw new Error('不支持的订单字段。');
  return next;
}
export function emptyRecognitionItem(key: string = randomUUID()): ItemDraft {
  return { key, name: '', productType: '', quantity: '', unitPrice: '', memberPrice: '',
    attributes: { size: '', flavor: '', base: '', filling: '', message: '', requirements: '', specification: '' }, defaultSpecifications: [], requiresTypeConfirmation: true };
}
/** Undo only unchanged values written by this fill, preserving later manual edits/removals. */
export function undoRecognition(current: OrderDraft, before: OrderDraft, after: OrderDraft): OrderDraft {
  const result = structuredClone(current);
  if (result.requestedReceiveDate === after.requestedReceiveDate && result.requestedReceiveAt === after.requestedReceiveAt) {
    result.requestedReceiveDate = before.requestedReceiveDate;
    result.requestedReceiveAt = before.requestedReceiveAt;
  }
  for (const field of rootFields) {
    if (field === 'requestedReceiveDate' || field === 'requestedReceiveAt') continue;
    const key = (moneyFields[field] || field) as Exclude<keyof OrderDraft, 'items'>;
    if (before[key] !== after[key] && result[key] === after[key]) Object.assign(result, { [key]: before[key] });
  }
  result.items = result.items.flatMap(item => {
    const written = after.items.find(x => x.key === item.key), original = before.items.find(x => x.key === item.key);
    if (!written) return [item];
    if (!original) return JSON.stringify(item) === JSON.stringify(written) ? [] : [item];
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
  const replaced = before.items.filter(item => !after.items.some(written => written.key === item.key));
  result.items.unshift(...structuredClone(replaced));
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
export interface RecognitionFeedback {
  field: string; itemKey?: string; value: string; source: RecognitionField['source']; needsReview: boolean; error?: string;
}
export type RecognitionFeedbackMap = Record<string, RecognitionFeedback>;
export function feedbackKey(field: string, itemKey?: string): string {
  return recognitionRowKey(field === 'requestedReceiveDate' ? 'requestedReceiveAt' : field, itemKey);
}
export function retainRecognitionFeedback(draft: OrderDraft, feedback: RecognitionFeedbackMap): RecognitionFeedbackMap {
  return Object.fromEntries(Object.entries(feedback).filter(([, mark]) =>
    (!mark.itemKey || draft.items.some(item => item.key === mark.itemKey)) && currentValue(draft, mark.field, mark.itemKey) === mark.value));
}
export function formFeedback(draft: OrderDraft, feedback: RecognitionFeedbackMap): RecognitionFeedbackMap {
  return Object.fromEntries(Object.values(feedback).flatMap(mark => {
    const field = moneyFields[mark.field] || mark.field;
    const index = mark.itemKey ? draft.items.findIndex(item => item.key === mark.itemKey) : -1;
    if (mark.itemKey && index < 0) return [];
    return [[mark.itemKey ? `items.${index}.${field}` : field, mark]];
  }));
}
export function applyRecognition(draft: OrderDraft, initial: OrderDraft, result: RecognitionDraft,
  manualFields: ReadonlySet<string>, options: { supplement?: boolean; targets?: Record<string, string> } = {}) {
  let next = structuredClone(draft), cleared = 0;
  const feedback: RecognitionFeedbackMap = {}, targets: Record<string, string> = options.supplement ? { ...options.targets } : {};
  const validContent = (fields: Record<string, RecognitionField>) => Object.entries(fields).some(([field, candidate]) => {
    if (field === 'productType' || candidate.source === 'DEFAULT' || !candidate.value?.trim()) return false;
    try { validateCandidate(field, recognitionValue(field, candidate.value)); return true; } catch { return false; }
  });
  const products = result.items.filter(item => validContent(item.fields));
  const replacedItems = !options.supplement && products.length > 0;
  if (replacedItems) {
    next.items = products.map(item => { const empty = emptyRecognitionItem(); targets[item.id] = empty.key; return empty; });
  }
  const write = (field: string, candidate: RecognitionField, itemKey?: string, onlyErrors = false) => {
    if (!candidate.value?.trim()) return;
    const displayField = field === 'requestedReceiveDate' ? 'requestedReceiveAt' : field;
    try {
      const value = validateCandidate(field, recognitionValue(field, candidate.value));
      if (onlyErrors) return;
      next = setCandidate(next, field, value, itemKey, candidate.source);
      feedback[feedbackKey(field, itemKey)] = { field: displayField, itemKey, value: currentValue(next, displayField, itemKey),
        source: candidate.source, needsReview: candidate.needsReview || candidate.source === 'MODEL' };
    } catch (error) {
      feedback[feedbackKey(field, itemKey)] = { field: displayField, itemKey, value: currentValue(next, displayField, itemKey),
        source: candidate.source, needsReview: false, error: (error as Error).message };
    }
  };
  if (!options.supplement) {
    const recognizable = products.length > 0 || Object.values(result.fields).some(field => field.source === 'RULE');
    if (recognizable && !result.fields.requestedReceiveDate?.value && !result.fields.requestedReceiveAt?.value
      && !manualFields.has('requestedReceiveDate') && !manualFields.has('requestedReceiveAt')
      && next.requestedReceiveDate === initial.requestedReceiveDate && next.requestedReceiveAt === initial.requestedReceiveAt) {
      next.requestedReceiveDate = ''; next.requestedReceiveAt = ''; cleared = 1;
      feedback[feedbackKey('requestedReceiveAt')] = { field: 'requestedReceiveAt', value: '', source: null, needsReview: false, error: '请补填客户收货日期。' };
    }
    // 日期先于完整时刻写入，避免服务端字段顺序影响最终值。
    const fields = Object.entries(result.fields).sort(([a], [b]) => Number(a === 'requestedReceiveAt') - Number(b === 'requestedReceiveAt'));
    fields.forEach(([field, candidate]) => write(field, candidate));
  }
  for (const [index, item] of result.items.entries()) {
    const onlyErrors = !options.supplement && !replacedItems;
    const itemKey = onlyErrors ? next.items[index]?.key : targets[item.id];
    if (!itemKey || !next.items.some(existing => existing.key === itemKey)) continue;
    Object.entries(item.fields).forEach(([field, candidate]) => {
      if (!options.supplement || candidate.source === 'MODEL') write(field, candidate, itemKey, onlyErrors);
    });
  }
  const changed = Object.values(feedback).filter(mark => !mark.error && currentValue(draft, mark.field, mark.itemKey) !== mark.value);
  const applied = changed.length, overwritten = changed.filter(mark => currentValue(draft, mark.field, mark.itemKey)).length;
  return { draft: next, targets, applied, overwritten, cleared, feedback, replacedItems };
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
