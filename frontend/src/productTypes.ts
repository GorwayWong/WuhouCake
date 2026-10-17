export const productTypes: Readonly<Record<string, string>> = {
  CAKE: '蛋糕', DONUT: '甜甜圈', CUPCAKE: '纸杯蛋糕', OTHER: '其他茶歇',
};

export function productTypeLabel(value: string | null | undefined): string {
  if (!value) return '未分类';
  return productTypes[value.trim().toUpperCase()] || value;
}
