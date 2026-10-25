import type { Item } from './types.ts';

function text(value: unknown): string {
  if (value == null || typeof value === 'string' && !value.trim()) return '无';
  if (Array.isArray(value)) return value.map(text).join('、');
  return typeof value === 'object' ? Object.entries(value).map(([key, value]) => `${key}：${text(value)}`).join('；') : String(value);
}
export function productionFields(item: Pick<Item, 'attributes'> & Partial<Pick<Item, 'productType'>>): [string, string][] {
  const attributes = item.attributes || {};
  if (item.productType && item.productType.toUpperCase() !== 'CAKE') return [['规格', text(attributes.specification ?? attributes.filling ?? attributes.size)], ['其他要求', text(attributes.requirements ?? attributes.otherRequirements)]];
  return [
    ['蛋糕胚口味', text(attributes.base ?? attributes.cakeBase)],
    ['尺寸', text(attributes.size)],
    ['奶油', text(attributes.flavor)],
    ['夹心', text(attributes.filling)],
    ['祝福语', text(attributes.message ?? attributes.greeting)],
    ['特殊要求', text(attributes.requirements ?? attributes.otherRequirements)],
  ];
}
