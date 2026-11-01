import type { ItemDraft } from './orderForm.ts';
import { moneyToCents } from './orderForm.ts';

export function selectItemAfterChange(before: Pick<ItemDraft, 'key'>[], after: Pick<ItemDraft, 'key'>[], selected: string,
  preferAdded = true): string {
  const added = after.find(item => !before.some(old => old.key === item.key));
  if (preferAdded && added) return added.key;
  if (after.some(item => item.key === selected)) return selected;
  if (added) return added.key;
  const index = Math.max(0, before.findIndex(item => item.key === selected));
  return after[Math.min(index, after.length - 1)]?.key || '';
}

export function itemKeyForField(items: Pick<ItemDraft, 'key'>[], field: string): string | undefined {
  const match = /^items\.(\d+)\./.exec(field);
  return match ? items[Number(match[1])]?.key : undefined;
}

export interface PriceSummary {
  cents: bigint;
  included: number;
  missing: number;
  invalid: number;
}
export function summarizeItemPrices(items: Pick<ItemDraft, 'quantity' | 'unitPrice' | 'memberPrice'>[]) {
  const sum = (field: 'unitPrice' | 'memberPrice'): PriceSummary => {
    const result: PriceSummary = { cents: 0n, included: 0, missing: 0, invalid: 0 };
    for (const item of items) {
      const price = item[field].trim();
      if (!price) result.missing++;
      try {
        if (!/^\d+$/.test(item.quantity)) throw new Error('数量未完成');
        const quantity = BigInt(item.quantity);
        if (quantity < 1n || quantity > 2147483647n) throw new Error('数量无效');
        if (!price) continue;
        result.cents += BigInt(moneyToCents(price)!) * quantity;
        result.included++;
      } catch { result.invalid++; }
    }
    return result;
  };
  return { regular: sum('unitPrice'), member: sum('memberPrice') };
}
