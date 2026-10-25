import { itemInput, newItem, moneyToCents } from './orderForm.ts';
import type { ItemDraft } from './orderForm.ts';
import { randomUUID } from './uuid.ts';
import { productTypes } from './productTypes.ts';
import { exactYuan } from './money.ts';

export interface SubmissionContent {
  phone: string; memberPhone: string | null; fulfillmentType: 'DELIVERY' | 'PICKUP'; address: string | null;
  requestedReceiveAt: string; items: { name: string; productType: string; quantity: number; attributes: Record<string, string> }[];
}
export interface SubmissionReview {
  content: SubmissionContent; prices: { unitPriceCents: number | null; memberPriceCents: number | null }[];
  totalAmountCents: number | null; creditedEmployeeId: string | null; plannedHandoffAt: string | null;
}
export interface Submission {
  id: string; entryId: string; ownerId: string; ownerName: string; version: number; status: 'PENDING' | 'CONFIRMED' | 'DELETED';
  original: SubmissionContent; reviewed: SubmissionReview | null; orderId: string | null; createdAt: string; updatedAt: string;
}
export interface SubmissionActivity {
  id: number; type: string; actorType: 'CUSTOMER' | 'EMPLOYEE'; actorId: string | null; actorName: string;
  details: Record<string, unknown>; createdAt: string;
}
export interface SubmissionDuplicate {
  kind: 'SUBMISSION' | 'ORDER'; id: string; version: number; status: string; orderNo: string | null; phone: string;
  requestedReceiveDate: string; requestedReceiveAt: string | null; items: { name: string; quantity: number }[];
  totalAmountCents: number | null; handledBy: string; createdAt: string; requiresAcknowledgement: boolean;
}
export interface SubmissionDetail { submission: Submission; duplicates: SubmissionDuplicate[]; duplicateCheckToken: string | null; activities: SubmissionActivity[] }
export interface EntryLink { ownerId: string; ownerName: string; url: string; enabled: boolean }
export interface SubmissionOrigin { submissionId: string; entryOwnerName: string; submittedAt: string; requestedReceiveAt: string }
export interface SubmissionDraft {
  phone: string; memberPhone: string; fulfillmentType: 'DELIVERY' | 'PICKUP'; address: string; requestedReceiveAt: string;
  items: ItemDraft[]; totalAmount: string; creditedEmployeeId: string; plannedHandoffAt: string;
}
export function localTime(instant: string | null): string {
  if (!instant) return '';
  return new Date(Date.parse(instant) + 8 * 3600000).toISOString().slice(0, 16);
}
export function newSubmissionDraft(): SubmissionDraft {
  return { phone: '', memberPhone: '', fulfillmentType: 'DELIVERY', address: '', requestedReceiveAt: '', items: [{ ...newItem(), name: '蛋糕' }], totalAmount: '', creditedEmployeeId: '', plannedHandoffAt: '' };
}
export function submissionDirty(draft: SubmissionDraft, initial: SubmissionDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(initial);
}
export function draftFromSubmission(submission: Submission): SubmissionDraft {
  const review = submission.reviewed, content = review?.content || submission.original;
  const amount = (value: number | null | undefined) => value == null ? '' : exactYuan(value);
  return { ...newSubmissionDraft(), ...content, memberPhone: content.memberPhone || '', address: content.address || '',
    requestedReceiveAt: localTime(content.requestedReceiveAt), totalAmount: amount(review?.totalAmountCents),
    creditedEmployeeId: review?.creditedEmployeeId || '', plannedHandoffAt: localTime(review?.plannedHandoffAt || null),
    items: content.items.map((item, i) => ({ ...newItem(), ...item, key: randomUUID(), quantity: String(item.quantity),
      attributes: { size: '', base: '', filling: '', flavor: '', message: '', requirements: '', specification: item.attributes.specification || (item.productType !== 'CAKE' ? item.attributes.filling || '' : ''), ...item.attributes },
      defaultSpecifications: [], unitPrice: amount(review?.prices[i]?.unitPriceCents), memberPrice: amount(review?.prices[i]?.memberPriceCents) })) };
}
export function submissionRequest(draft: SubmissionDraft, staff = false) {
  const errors: Record<string, string> = {};
  const phone = (value: string, field: string, required: boolean) => {
    const text = value.trim(); if (!text && !required) return null;
    const normalized = text.replace(/[ ()-]/g, '');
    if (text.length > 32 || !/^\+?[0-9 ()-]+$/.test(text) || !/^\+?[0-9]{6,15}$/.test(normalized)) errors[field] = '请填写 6–15 位电话号码，可带国际前缀 +、空格、括号或短横线。';
    return normalized;
  };
  const contactPhone = phone(draft.phone, 'phone', true) || '', memberPhone = phone(draft.memberPhone, 'memberPhone', false);
  if (draft.address.length > 2000 || draft.fulfillmentType === 'DELIVERY' && !draft.address.trim()) errors.address = '请填写配送地址，最多 2000 个字符。';
  const instant = (value: string, field: string, required: boolean) => {
    if (!value && !required) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + ':00+08:00'))) {
      errors[field] = '请填写完整的日期和具体时刻。'; return null;
    }
    const result = new Date(value + ':00+08:00').toISOString();
    if (localTime(result) !== value) { errors[field] = '请填写有效日期和时刻。'; return null; }
    return result;
  };
  const requestedReceiveAt = instant(draft.requestedReceiveAt, 'requestedReceiveAt', true) || '';
  if (!draft.items.length || draft.items.length > 30) errors.items = '请保留 1–30 项商品。';
  const items = draft.items.map((item, index) => {
    const result = itemInput(staff ? item : { ...item, unitPrice: '', memberPrice: '' });
    const type = item.productType.trim().toUpperCase();
    if (!Object.hasOwn(productTypes, type) && type !== 'OTHER') errors[`items.${index}.productType`] = '请选择蛋糕、面包、甜甜圈、纸杯蛋糕或饮品。';
    if (result.item) result.item.productType = type;
    Object.entries(result.errors).forEach(([key, value]) => { errors[`items.${index}.${key}`] = value; });
    if (item.productType === 'CAKE' && !item.attributes.size.trim()) errors[`items.${index}.size`] = '请填写蛋糕尺寸。';
    Object.entries(item.attributes).forEach(([key, value]) => { if (value.length > 2000) errors[`items.${index}.${key}`] = '最多填写 2000 个字符。'; });
    return result.item;
  });
  const content: SubmissionContent = { phone: contactPhone, memberPhone, fulfillmentType: draft.fulfillmentType,
    address: draft.address.trim() || null, requestedReceiveAt,
    items: items.filter(item => item !== null).map(item => ({ name: item.name, productType: item.productType || 'CAKE', quantity: item.quantity,
      attributes: item.attributes as Record<string, string> })) };
  let totalAmountCents: number | null = null;
  if (staff) { try { totalAmountCents = moneyToCents(draft.totalAmount); } catch (error) { errors.totalAmount = (error as Error).message; } }
  const review: SubmissionReview = { content, totalAmountCents, creditedEmployeeId: draft.creditedEmployeeId || null,
    prices: items.filter(item => item !== null).map(item => ({ unitPriceCents: item.unitPriceCents, memberPriceCents: item.memberPriceCents })),
    plannedHandoffAt: staff ? instant(draft.plannedHandoffAt, 'plannedHandoffAt', false) : null };
  return { content, review, errors };
}
