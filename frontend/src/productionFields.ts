import { hasUnitPrices } from './productTypes.ts';
import type { Item } from './types.ts';

function text(value: unknown): string {
  if (value == null || typeof value === 'string' && !value.trim()) return '无';
  if (Array.isArray(value)) return value.map(text).join('、');
  return typeof value === 'object' ? Object.entries(value).map(([key, value]) => `${key}：${text(value)}`).join('；') : String(value);
}
export function historicalProductionFields(item: Pick<Item, 'attributes' | 'productType'>): [string, string][] {
  if (item.productType?.toUpperCase() === 'CAKE') return [];
  const labels: Record<string, string> = { size: '尺寸', base: '内胚', cakeBase: '内胚', flavor: '奶油', filling: '夹馅', message: '祝福语', greeting: '祝福语' };
  return Object.entries(item.attributes || {}).filter(([key, value]) => Object.hasOwn(labels, key) && text(value) !== '无')
    .map(([key, value]) => [labels[key] || key, text(value)]);
}
export function productionFields(item: Pick<Item, 'attributes'> & Partial<Pick<Item, 'productType'>>): [string, string][] {
  const attributes = item.attributes || {};
  if (item.productType && item.productType.toUpperCase() !== 'CAKE') return ([['规格', text(attributes.specification)], ['特殊要求', text(attributes.requirements ?? attributes.otherRequirements)]] as [string, string][]).filter(([, value]) => value !== '无');
  return [
    ['蛋糕胚口味', text(attributes.base ?? attributes.cakeBase)],
    ['尺寸', text(attributes.size)],
    ['奶油', text(attributes.flavor)],
    ['夹心', text(attributes.filling)],
    ['祝福语', text(attributes.message ?? attributes.greeting)],
    ['特殊要求', text(attributes.requirements ?? attributes.otherRequirements)],
  ];
}

export function productionCardFields(item: Pick<Item, 'attributes' | 'productType'> | undefined): [string, string][] {
  if (!item) return [];
  const attributes = item.attributes || {};
  const display = (value: unknown, missing: string) => value == null || typeof value === 'string' && !value.trim() ? missing : text(value) || missing;
  if (hasUnitPrices(item.productType)) return [['规格', display(attributes.specification, '规格待确认')]];
  const size = display(attributes.size, '尺寸待确认');
  return [['尺寸', /^\d+(?:\.\d+)?$/.test(size) ? `${size} 寸` : size],
    ['蛋糕胚', display(attributes.base ?? attributes.cakeBase, '蛋糕胚待确认')]];
}
