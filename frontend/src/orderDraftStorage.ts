import { newDraft, specificationFields } from './orderForm.ts';
import type { OrderDraft } from './orderForm.ts';
import type { RecognitionFeedbackMap } from './recognition.ts';
import type { CreateOrderRequest } from './types.ts';
import { randomUUID } from './uuid.ts';

export interface DraftEditor {
  text: string; open: boolean; selectedItemKey: string; scrollY: number;
  feedback: RecognitionFeedbackMap; manualFields: string[];
}
export interface OrderDraftRecord {
  version: 1; accountId: string; requestId: string; revision: string; updatedAt: string;
  initial: OrderDraft; value: OrderDraft; editor: DraftEditor; pending?: CreateOrderRequest;
}
export const draftStorageKey = (accountId: string) => `wuhou:order-draft:v1:${accountId}`;
export function freshOrderDraft(accountId: string, date: string): OrderDraftRecord {
  const value = newDraft(date);
  return { version: 1, accountId, requestId: randomUUID(), revision: '', updatedAt: '', initial: value, value,
    editor: { text: '', open: false, selectedItemKey: value.items[0].key, scrollY: 0, feedback: {}, manualFields: [] } };
}
export function hasDraftContent(record: OrderDraftRecord | null): boolean {
  return Boolean(record && (record.pending || record.editor.text.trim() || JSON.stringify(record.initial) !== JSON.stringify(record.value)));
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
function form(value: unknown): value is OrderDraft {
  if (!object(value) || !strings(value, ['customerName', 'phone', 'memberPhone', 'buyerName', 'address', 'requestedReceiveDate', 'requestedReceiveAt', 'plannedHandoffAt', 'plannedFinishAt', 'totalAmount'])
    || !['DELIVERY', 'PICKUP'].includes(String(value.fulfillmentType)) || value.creditedEmployeeId !== undefined && typeof value.creditedEmployeeId !== 'string'
    || !Array.isArray(value.items) || !value.items.length) return false;
  const keys = new Set<string>();
  return value.items.every(item => {
    if (!object(item) || !strings(item, ['key', 'name', 'productType', 'quantity', 'unitPrice', 'memberPrice']) || !item.key || keys.has(String(item.key))
      || !object(item.attributes) || !strings(item.attributes, specificationFields.map(([key]) => key))
      || item.defaultSpecifications !== undefined && (!Array.isArray(item.defaultSpecifications) || !item.defaultSpecifications.every(key => key === 'base' || key === 'filling'))
      || item.requiresTypeConfirmation !== undefined && typeof item.requiresTypeConfirmation !== 'boolean'
      || item.preservedAttributes !== undefined && !object(item.preservedAttributes)) return false;
    keys.add(String(item.key)); return true;
  });
}
function request(value: unknown): value is CreateOrderRequest {
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  const money = (v: unknown) => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  return object(value) && object(value.customer) && typeof value.customer.phone === 'string'
    && ['customerName', 'memberPhone', 'buyerName'].every(key => nullableString((value.customer as Record<string, unknown>)[key]))
    && (value.creditedEmployeeId === undefined || typeof value.creditedEmployeeId === 'string')
    && object(value.fulfillment) && ['DELIVERY', 'PICKUP'].includes(String(value.fulfillment.type))
    && typeof value.fulfillment.requestedReceiveDate === 'string'
    && ['address', 'plannedHandoffAt', 'plannedFinishAt'].every(key => nullableString((value.fulfillment as Record<string, unknown>)[key]))
    && (value.fulfillment.requestedReceiveAt === undefined || nullableString(value.fulfillment.requestedReceiveAt))
    && money(value.totalAmountCents) && Array.isArray(value.items) && value.items.length > 0
    && value.items.every(item => object(item) && typeof item.name === 'string' && nullableString(item.productType)
      && Number.isInteger(item.quantity) && Number(item.quantity) > 0 && money(item.unitPriceCents) && money(item.memberPriceCents) && object(item.attributes));
}
export function decodeOrderDraft(raw: string, accountId: string): OrderDraftRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || value.accountId !== accountId || !strings(value, ['requestId', 'revision', 'updatedAt'])
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value.requestId))
      || !value.revision || !Number.isFinite(Date.parse(String(value.updatedAt))) || !form(value.initial) || !form(value.value)
      || !object(value.editor) || !strings(value.editor, ['text', 'selectedItemKey']) || typeof value.editor.open !== 'boolean'
      || typeof value.editor.scrollY !== 'number' || !Number.isFinite(value.editor.scrollY) || value.editor.scrollY < 0
      || !Array.isArray(value.editor.manualFields) || !value.editor.manualFields.every(field => typeof field === 'string')
      || !object(value.editor.feedback) || !Object.values(value.editor.feedback).every(mark => object(mark) && strings(mark, ['field', 'value'])
        && (mark.itemKey === undefined || typeof mark.itemKey === 'string') && (mark.error === undefined || typeof mark.error === 'string')
        && [null, 'RULE', 'MODEL', 'DEFAULT'].includes(mark.source as string | null) && typeof mark.needsReview === 'boolean')
      || value.pending !== undefined && !request(value.pending)) return null;
    return value as unknown as OrderDraftRecord;
  } catch { return null; }
}

export class DraftConflict extends Error {}
/** Tracks the last observed snapshot so an old tab cannot silently replace a newer draft. */
export class OrderDraftSlot {
  private expected: string | null = null;
  readonly accountId: string;
  private storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  constructor(accountId: string, storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => localStorage) {
    this.accountId = accountId; this.storage = storage;
  }
  read() {
    this.expected = this.storage().getItem(draftStorageKey(this.accountId));
    const record = this.expected === null ? null : decodeOrderDraft(this.expected, this.accountId);
    return { record, invalid: this.expected !== null && !record };
  }
  check() {
    if (this.storage().getItem(draftStorageKey(this.accountId)) !== this.expected) throw new DraftConflict();
  }
  write(record: OrderDraftRecord) {
    this.check();
    if (record.accountId !== this.accountId) throw new DraftConflict();
    const next = { ...record, revision: randomUUID(), updatedAt: new Date().toISOString() };
    const raw = JSON.stringify(next);
    this.storage().setItem(draftStorageKey(this.accountId), raw);
    this.expected = raw;
    return next;
  }
  remove() {
    this.check(); this.storage().removeItem(draftStorageKey(this.accountId)); this.expected = null;
  }
}
