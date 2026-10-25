import type { Item } from './types.ts';

export function orderRequirements(items: Pick<Item, 'itemId' | 'name' | 'attributes'>[]) {
  return items.map(item => {
    const value = item.attributes.requirements ?? item.attributes.otherRequirements;
    return { itemId: item.itemId, name: item.name, text: typeof value === 'string' && value.trim() ? value.trim() : '无' };
  });
}
