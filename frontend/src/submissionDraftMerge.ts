import { specificationFields } from './orderForm.ts';
import type { SubmissionDraft, SubmissionItemDraft } from './customerSubmission.ts';

export type ReviewChoice = 'local' | 'remote';
type Conflict = { id: string; label: string; local: string; remote: string; copyOnly?: boolean };

const fieldLabels = new Map<string, string>(specificationFields);

function itemValue(item?: SubmissionItemDraft) {
  if (!item) return null;
  const { name, productType, quantity, unitPrice, memberPrice, attributes, imageIds } = item;
  return [name, productType, quantity, unitPrice, memberPrice, imageIds ?? [], Object.entries(attributes).filter(([, value]) => value).sort(([left], [right]) => left.localeCompare(right))];
}

function itemText(item?: SubmissionItemDraft): string {
  if (!item) return '已移除';
  return [item.name, item.productType === 'CAKE' ? '蛋糕' : '其他商品', `数量：${item.quantity}`, ...(item.imageIds?.length ? [`参考图片：${item.imageIds.length} 张`] : []),
    ...(item.unitPrice ? [`原价：${item.unitPrice}`] : []), ...(item.memberPrice ? [`会员价：${item.memberPrice}`] : []),
    ...specificationFields.flatMap(([key, label]) => item.attributes[key] ? [`${label}：${item.attributes[key]}`] : []),
    ...Object.entries(item.attributes).flatMap(([key, value]) => value && !fieldLabels.has(key) ? [`${key}：${value}`] : [])].join('\n');
}

export function submissionDraftText(draft: SubmissionDraft): string {
  return [
    `联系电话：${draft.phone}`, `会员手机：${draft.memberPhone}`,
    `交接：${draft.fulfillmentType === 'DELIVERY' ? '配送上门' : '门店自提'}`, `地址：${draft.address}`,
    `取货：${draft.requestedReceiveAt}`, `出品：${draft.plannedFinishAt}`, `金额：${draft.totalAmount}`,
    ...draft.items.map(itemText),
  ].join('\n');
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeSubmissionDraft(base: SubmissionDraft, local: SubmissionDraft, remote: SubmissionDraft,
    stableItemIds: boolean, choices: Record<string, ReviewChoice | undefined> = {}, forceItemReview = false) {
  const value = { ...remote };
  const conflicts: Conflict[] = [];
  const choose = (id: string, label: string, before: unknown, mine: unknown, theirs: unknown,
      localText: string, remoteText: string, copyOnly = false) => {
    if (!copyOnly) {
      if (equal(before, mine) || equal(mine, theirs)) return false;
      if (equal(before, theirs)) return true;
    }
    conflicts.push({ id, label, local: localText, remote: remoteText, copyOnly });
    return !copyOnly && choices[id] === 'local';
  };
  for (const [key, label] of [['phone', '联系电话'], ['memberPhone', '会员手机'],
    ['totalAmount', '整单金额'], ['creditedEmployeeId', '归属员工']] as const) {
    if (choose(key, label, base[key], local[key], remote[key], local[key], remote[key])) value[key] = local[key];
  }
  const handoff = (draft: SubmissionDraft) => {
    const { fulfillmentType, address, requestedReceiveAt, plannedHandoffAt, plannedFinishAt, finishTimeMode } = draft;
    return { fulfillmentType, address, requestedReceiveAt, plannedHandoffAt, plannedFinishAt, finishTimeMode };
  };
  const handoffText = (draft: SubmissionDraft) => [
    draft.fulfillmentType === 'DELIVERY' ? '配送上门' : '门店自提', draft.address, `取货：${draft.requestedReceiveAt}`,
    `出品：${draft.plannedFinishAt || '待定'}`,
  ].filter(Boolean).join('\n');
  if (choose('handoff', '交接与时间', handoff(base), handoff(local), handoff(remote), handoffText(local), handoffText(remote))) {
    const originalTime = local.requestedReceiveAt === remote.requestedReceiveAt ? remote.originalTime : undefined;
    Object.assign(value, handoff(local), { originalTime });
  }

  let copiedItems: string | undefined;
  if (!stableItemIds || forceItemReview) {
    const mine = local.items.map(itemValue);
    const theirs = remote.items.map(itemValue);
    if (forceItemReview || (!equal(base.items.map(itemValue), mine) && !equal(mine, theirs))) {
      copiedItems = local.items.map(itemText).join('\n\n');
      choose('legacy-items', '历史商品', null, mine, theirs, copiedItems, remote.items.map(itemText).join('\n\n'), true);
    }
  } else {
    const before = new Map(base.items.map(item => [item.key, item]));
    const mine = new Map(local.items.map(item => [item.key, item]));
    const theirs = new Map(remote.items.map(item => [item.key, item]));
    const keys = new Set([...theirs.keys(), ...mine.keys(), ...before.keys()]);
    value.items = Array.from(keys).flatMap(key => {
      const original = before.get(key), localItem = mine.get(key), remoteItem = theirs.get(key);
      const useLocal = choose(`item:${key}`, original?.name ?? remoteItem?.name ?? localItem?.name ?? '商品',
        itemValue(original), itemValue(localItem), itemValue(remoteItem), itemText(localItem), itemText(remoteItem));
      const selected = useLocal ? localItem : remoteItem;
      return selected ? [selected] : [];
    });
  }
  return { value, conflicts, copiedItems };
}
