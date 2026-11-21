export interface CakeBaseCount { size: string | null; flavor: string; quantity: number }
export function groupCakeBases(items: CakeBaseCount[]) {
  const groups = new Map<string | null, { size: string | null; quantity: number; flavors: CakeBaseCount[] }>();
  for (const item of items) {
    const { size } = item;
    const group = groups.get(size) || { size, quantity: 0, flavors: [] };
    group.quantity += item.quantity;
    group.flavors.push(item);
    groups.set(size, group);
  }
  return [...groups.values()];
}
