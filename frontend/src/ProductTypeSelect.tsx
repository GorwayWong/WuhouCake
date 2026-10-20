import { Select } from './Select';
import type { SelectProps } from './Select';
import { productTypes, productTypeLabel } from './productTypes';

export function ProductTypeSelect({ value, ...props }: Omit<SelectProps, 'label' | 'children'>) {
  return <Select {...props} label="商品类型" value={value}>
    <option value="" disabled>请选择商品类型</option>
    {Object.entries(productTypes).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    {value && !Object.hasOwn(productTypes, value) && <option value={value}>{productTypeLabel(value)}（原类型）</option>}
  </Select>;
}
