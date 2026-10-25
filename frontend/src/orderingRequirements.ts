import type { Item } from './types.ts';

export function orderRequirements(items: Pick<Item, 'itemId' | 'name' | 'attributes'>[]) {
  return items.flatMap(item => {
    const value = item.attributes.requirements ?? item.attributes.otherRequirements;
    return typeof value === 'string' && value.trim() ? [{ itemId: item.itemId, name: item.name, text: value.trim() }] : [];
  });
}
