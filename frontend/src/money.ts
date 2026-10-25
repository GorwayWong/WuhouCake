/** Formats integer cents without converting through a floating-point yuan value. */
export function exactYuan(cents: string | number): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) throw new Error('金额超出安全范围，请核对。');
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/** Rejects numeric money outside the browser's exact integer range before it reaches forms. */
export function hasUnsafeMoneyNumber(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeMoneyNumber);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => {
    if (['totalAmountCents', 'unitPriceCents', 'memberPriceCents', 'amountCents', 'paidAmountCents', 'unpaidAmountCents'].includes(key)
        && typeof child === 'number' && !Number.isSafeInteger(child)) return true;
    return key !== 'attributes' && hasUnsafeMoneyNumber(child);
  });
}
