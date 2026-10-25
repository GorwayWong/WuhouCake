export const productTypes: Readonly<Record<string, string>> = {
  CAKE: '蛋糕', TEA_BREAK: '茶歇', COOKIE: '饼干', SNACK: '小吃', DRINK: '饮品', READY_BAKERY: '现货面包甜点',
};

export function normalizeProductType(value: string): string {
  const type = value.trim().toUpperCase();
  return ({ DONUT: 'TEA_BREAK', CUPCAKE: 'TEA_BREAK', OTHER: 'TEA_BREAK', BREAD: 'READY_BAKERY' } as Record<string, string>)[type] || type;
}

export function productTypeLabel(value: string | null | undefined): string {
  if (!value) return '未分类';
  return productTypes[normalizeProductType(value)] || value;
}
