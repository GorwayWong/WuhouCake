import type { Item } from './types.ts';

export function itemRequirement(attributes: Item['attributes']): string {
  const value = attributes.requirements ?? attributes.otherRequirements;
  return typeof value === 'string' ? value.trim() : '';
}
