import type { ItemDraft } from './orderForm.ts';

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
