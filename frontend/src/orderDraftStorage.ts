import { paymentMethods } from './orderPayment.ts';
import { newDraft, specificationFields, migrateOrderDraft } from './orderForm.ts';
import type { OrderDraft } from './orderForm.ts';
import type { RecognitionFeedbackMap } from './recognition.ts';
import type { CreateOrderRequest } from './types.ts';
import { randomUUID } from './uuid.ts';
import { validDraftImages } from './draftImageMetadata.ts';
import { protectMigratedDraftImages } from './draftImages.ts';
import { readCreationDraft, updateCreationDraft } from './creationDraftStorage.ts';
import type { SavedCreationDraft } from './creationDraftStorage.ts';

export interface DraftEditor {
  text: string; open: boolean; selectedItemKey: string; scrollY: number;
  feedback: RecognitionFeedbackMap; manualFields: string[];
}
export interface DuplicateOrderMatch {
  count: number;
  orderNos: string[];
  token: string;
}
type DuplicateOrderDraft = { state: 'REQUIRED'; request: CreateOrderRequest; match: DuplicateOrderMatch } | { state: 'EDITING' };

export interface OrderDraftRecord {
  version: 1; accountId: string; requestId: string; revision: string; updatedAt: string;
  initial: OrderDraft; value: OrderDraft; editor: DraftEditor; pending?: CreateOrderRequest;
  pendingDuplicateCheck?: string;
  duplicateReview?: DuplicateOrderDraft;
  createdOrderId?: string;
  imageStorageUsed?: boolean;
  savedRevision?: string;
  idempotencyKey?: string;
}
export interface DraftCandidate {
  record: OrderDraftRecord | null;
  invalid: boolean;
  migrationDeferred?: boolean;
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
    || value.pricingMode !== undefined && !['MANUAL', 'ITEM_SUM'].includes(String(value.pricingMode))
    || value.memberAmount !== undefined && typeof value.memberAmount !== 'string'
    || value.paymentMethod !== undefined && (typeof value.paymentMethod !== 'string' || !Object.hasOwn(paymentMethods, value.paymentMethod))
    || value.orderingMethod !== undefined && typeof value.orderingMethod !== 'string'
    || value.orderingMethodCustom !== undefined && typeof value.orderingMethodCustom !== 'boolean'
    || value.explicitFulfillment !== undefined && value.explicitFulfillment !== true
    || value.finishTimeMode !== undefined && !['AUTO', 'MANUAL'].includes(String(value.finishTimeMode))
    || !['DELIVERY', 'PICKUP'].includes(String(value.fulfillmentType)) || value.creditedEmployeeId !== undefined && typeof value.creditedEmployeeId !== 'string'
    || !Array.isArray(value.items) || !value.items.length) return false;
  const keys = new Set<string>();
  return value.items.every(item => {
    if (!object(item) || !strings(item, ['key', 'name', 'productType', 'quantity', 'unitPrice', 'memberPrice']) || !item.key || keys.has(String(item.key))
      || !object(item.attributes) || !strings(item.attributes, specificationFields.map(([key]) => key))
      || item.defaultSpecifications !== undefined && (!Array.isArray(item.defaultSpecifications) || !item.defaultSpecifications.every(key => key === 'base' || key === 'filling' || key === 'flavor'))
      || item.images !== undefined && !validDraftImages(item.images)
      || item.requiresTypeConfirmation !== undefined && typeof item.requiresTypeConfirmation !== 'boolean'
      || item.preservedAttributes !== undefined && !object(item.preservedAttributes)) return false;
    keys.add(String(item.key)); return true;
  });
}
function duplicateCheckToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2500 && /^[#,0-9a-f]+\.[0-9a-f]{64}$/.test(value);
}

export function duplicateOrderMatch(value: unknown): DuplicateOrderMatch | undefined {
  if (!object(value) || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count <= 0
    || !Array.isArray(value.orderNos) || !value.orderNos.every(no => typeof no === 'string')
    || !duplicateCheckToken(value.token)) return undefined;
  return { count: value.count, orderNos: value.orderNos, token: value.token };
}

function request(value: unknown): value is CreateOrderRequest {
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  const money = (v: unknown) => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  return object(value) && object(value.customer) && typeof value.customer.phone === 'string'
    && ['customerName', 'memberPhone', 'buyerName'].every(key => nullableString((value.customer as Record<string, unknown>)[key]))
    && (value.orderingMethod === undefined || nullableString(value.orderingMethod))
    && (value.creditedEmployeeId === undefined || typeof value.creditedEmployeeId === 'string')
    && object(value.fulfillment) && ['DELIVERY', 'PICKUP'].includes(String(value.fulfillment.type))
    && typeof value.fulfillment.requestedReceiveDate === 'string'
    && ['address', 'plannedHandoffAt', 'plannedFinishAt'].every(key => nullableString((value.fulfillment as Record<string, unknown>)[key]))
    && (value.fulfillment.requestedReceiveAt === undefined || nullableString(value.fulfillment.requestedReceiveAt))
    && (value.pricingMode === undefined || ['MANUAL', 'ITEM_SUM'].includes(String(value.pricingMode)))
    && money(value.totalAmountCents)
    && (value.originalAmountCents === undefined || money(value.originalAmountCents))
    && (value.memberAmountCents === undefined || money(value.memberAmountCents))
    && (value.paymentMethod === undefined || typeof value.paymentMethod === 'string' && Object.hasOwn(paymentMethods, value.paymentMethod)) && Array.isArray(value.items) && value.items.length > 0
    && value.items.every(item => object(item) && (item.itemId === undefined || typeof item.itemId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.itemId)) && typeof item.name === 'string' && nullableString(item.productType)
      && Number.isInteger(item.quantity) && Number(item.quantity) > 0 && money(item.unitPriceCents) && money(item.memberPriceCents) && (item.referenceUnitPriceCents === undefined || money(item.referenceUnitPriceCents)) && (item.referenceMemberPriceCents === undefined || money(item.referenceMemberPriceCents)) && object(item.attributes));
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
      || value.pending !== undefined && !request(value.pending)
      || value.pendingDuplicateCheck !== undefined && (!value.pending || !duplicateCheckToken(value.pendingDuplicateCheck))
      || value.duplicateReview !== undefined && (value.pending !== undefined || value.createdOrderId !== undefined
        || !object(value.duplicateReview) || value.duplicateReview.state !== 'EDITING'
          && (value.duplicateReview.state !== 'REQUIRED' || !request(value.duplicateReview.request)
            || !duplicateOrderMatch(value.duplicateReview.match)))
      || value.createdOrderId !== undefined && (typeof value.createdOrderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.createdOrderId))
      || value.savedRevision !== undefined && typeof value.savedRevision !== 'string'
      || value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.idempotencyKey))
      || value.imageStorageUsed !== undefined && typeof value.imageStorageUsed !== 'boolean') return null;
    const record = value as unknown as OrderDraftRecord;
    const restore = (draft: OrderDraft): OrderDraft => {
      const migrated = migrateOrderDraft(draft);
      if (migrated.explicitFulfillment) return migrated;
      const pickup = migrated.address.trim() === '自提';
      return { ...migrated, explicitFulfillment: true, fulfillmentType: pickup ? 'PICKUP' : 'DELIVERY',
        address: pickup ? '' : migrated.address };
    };
    return { ...record, initial: restore(record.initial), value: restore(record.value) };
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
    return decodeSnapshot(this.expected, this.accountId);
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

type PendingDraft = { record: OrderDraftRecord; legacyRaw?: string };
const pendingKey = (accountId: string) => `order-pending:${accountId}`;
const isPending = (record: OrderDraftRecord | null) => Boolean(record?.pending || record?.createdOrderId || record?.duplicateReview);
const decodeSnapshot = (raw: string | null, accountId: string) => {
  const record = raw === null ? null : decodeOrderDraft(raw, accountId);
  return { record, invalid: raw !== null && !record };
};

export async function readPendingOrderDraft(accountId: string) {
  return (await readCreationDraft<PendingDraft>(pendingKey(accountId)))?.value.record ?? null;
}

export class OrderSubmissionSlot {
  readonly legacy: OrderDraftSlot;
  readonly accountId: string;
  constructor(accountId: string) {
    this.accountId = accountId;
    this.legacy = new OrderDraftSlot(accountId);
  }

  private legacyRaw() {
    return localStorage.getItem(draftStorageKey(this.accountId));
  }

  private removeLegacy(raw: string | undefined) {
    if (raw !== undefined && this.legacyRaw() === raw) localStorage.removeItem(draftStorageKey(this.accountId));
  }

  private async finishMigration(stored: SavedCreationDraft<PendingDraft>, protectedRequestId?: string) {
    const { record, legacyRaw } = stored.value;
    if (legacyRaw !== undefined && record.requestId !== protectedRequestId) {
      const legacy = decodeOrderDraft(legacyRaw, this.accountId);
      if (legacy?.requestId === record.requestId && isPending(legacy)) await protectMigratedDraftImages(record);
    }
    try { this.removeLegacy(legacyRaw); }
    catch { /* The committed copy stays available. Cleanup is retried before releasing the slot. */ }
  }

  private async recovered(stored: SavedCreationDraft<PendingDraft>, protectedRequestId?: string) {
    const candidate = decodeSnapshot(JSON.stringify(stored.value.record), this.accountId);
    if (candidate.invalid) return candidate;
    try { await this.finishMigration(stored, protectedRequestId); }
    catch { return { ...candidate, migrationDeferred: true }; }
    return candidate;
  }

  async read(): Promise<DraftCandidate> {
    const key = pendingKey(this.accountId);
    let stored: SavedCreationDraft<PendingDraft> | null;
    try {
      stored = await readCreationDraft<PendingDraft>(key);
    } catch (failure) {
      const legacy = this.legacy.read();
      if (isPending(legacy.record)) return { ...legacy, migrationDeferred: true };
      throw failure;
    }
    if (stored) return this.recovered(stored);
    const legacy = this.legacy.read();
    if (!legacy.record || !isPending(legacy.record)) return legacy;
    try {
      await protectMigratedDraftImages(legacy.record);
      const migrated = await updateCreationDraft<PendingDraft>(key, current => {
        if (current) return current;
        const raw = this.legacyRaw();
        const { record } = decodeSnapshot(raw, this.accountId);
        return raw !== null && record && isPending(record)
          ? { revision: record.revision, value: { record, legacyRaw: raw } } : null;
      });
      return migrated ? this.recovered(migrated, legacy.record.requestId) : this.legacy.read();
    } catch {
      const committed = await readCreationDraft<PendingDraft>(key).catch(() => null);
      if (committed) return this.recovered(committed);
      const latest = this.legacy.read();
      return { ...latest, migrationDeferred: isPending(latest.record) };
    }
  }

  async write(record: OrderDraftRecord, expectedRevision?: string) {
    if (record.accountId !== this.accountId) throw new DraftConflict();
    const saved = await updateCreationDraft<PendingDraft>(pendingKey(this.accountId), current => {
      const legacyRaw = current ? current.value.legacyRaw : this.legacyRaw() ?? undefined;
      const previous = decodeSnapshot(current ? JSON.stringify(current.value.record) : legacyRaw ?? null, this.accountId);
      if (previous.invalid || isPending(previous.record) && previous.record?.requestId !== record.requestId) throw new DraftConflict();
      const matching = previous.record?.requestId === record.requestId ? previous.record : null;
      if (expectedRevision !== undefined ? matching?.revision !== expectedRevision : Boolean(matching?.duplicateReview))
        throw new DraftConflict();
      const pending = expectedRevision === undefined ? matching?.pending : undefined;
      const next = { ...record, pending: pending ?? record.pending,
        pendingDuplicateCheck: pending ? matching?.pendingDuplicateCheck : record.pendingDuplicateCheck, createdOrderId: matching?.createdOrderId ?? record.createdOrderId,
        revision: randomUUID(), updatedAt: new Date().toISOString() };
      return { revision: next.revision, value: { record: next, legacyRaw } };
    });
    await this.finishMigration(saved!);
    return saved!.value.record;
  }

  async remove(record: OrderDraftRecord | null, discard: boolean) {
    let legacyToRemove: string | undefined;
    await updateCreationDraft<PendingDraft>(pendingKey(this.accountId), current => {
      const raw = current ? JSON.stringify(current.value.record) : this.legacyRaw();
      const stored = decodeSnapshot(raw, this.accountId);
      if (stored.invalid && !(discard && !record) || stored.record &&
          (record?.requestId !== stored.record.requestId || discard && record.revision !== stored.record.revision)) throw new DraftConflict();
      // Remove the migration backup while the durable copy still exists.
      if (current) this.removeLegacy(current.value.legacyRaw);
      else legacyToRemove = raw ?? undefined;
      return null;
    });
    this.removeLegacy(legacyToRemove);
  }
}
