export const productTypes: Readonly<Record<string, string>> = {
  CAKE: '蛋糕', OTHER: '其他',
};

export function normalizeProductType(value: string): string {
  const type = value.trim().toUpperCase();
  return ['DONUT', 'CUPCAKE', 'TEA_BREAK', 'BREAD', 'COOKIE', 'SNACK', 'DRINK', 'READY_BAKERY'].includes(type) ? 'OTHER' : type;
}
export function isCake(type: string | null | undefined): boolean { return normalizeProductType(type || '') === 'CAKE'; }

export function productTypeLabel(value: string | null | undefined): string {
  if (!value) return '未分类';
  return productTypes[normalizeProductType(value)] || value;
}
