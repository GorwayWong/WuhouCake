export interface PriceItem { quantity: number; unitPriceCents?: number | null; memberPriceCents?: number | null }
export function itemTotals(items: PriceItem[]) {
  let original = 0n, total = 0n, missingOriginal = !items.length, missingTotal = !items.length, hasMember = false, unpriced = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 2147483647) throw new Error('请核对商品数量。');
    for (const cents of [item.unitPriceCents, item.memberPriceCents])
      if (cents != null && (!Number.isSafeInteger(cents) || cents < 0)) throw new Error('请核对商品单价。');
    const regular = item.unitPriceCents ?? null, preferred = item.memberPriceCents ?? regular;
    const count = BigInt(item.quantity);
    hasMember ||= item.memberPriceCents != null;
    if (regular === null) missingOriginal = true; else original += BigInt(regular) * count;
    if (preferred == null) { missingTotal = true; unpriced++; } else total += BigInt(preferred) * count;
  }
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (original > max || total > max) throw new Error('累计金额过大，请核对商品单价和数量。');
  return { original: missingOriginal ? null : Number(original), member: hasMember && !missingTotal ? Number(total) : null,
    total: missingTotal ? null : Number(total), unpriced };
}
