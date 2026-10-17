import type { SelectHTMLAttributes } from 'react';
import { productTypes, productTypeLabel } from './productTypes';

export function ProductTypeSelect({ value, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value'> & { value: string }) {
  return <select {...props} value={value}>
    <option value="" disabled>请选择商品类型</option>
    {Object.entries(productTypes).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    {value && !Object.hasOwn(productTypes, value) && <option value={value}>{productTypeLabel(value)}（原类型）</option>}
  </select>;
}
