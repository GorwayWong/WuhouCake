import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { CakeDefaultHint } from './CakeDefaultHint';
import { productFormLabels, productFormRows } from './productFormLayout';
import type { ProductFormField } from './productFormLayout';
import { isCake } from './productTypes';

export function ProductFieldLabel({ field, required = false, template = false }: { field: ProductFormField; required?: boolean; template?: boolean }) {
  return <>{productFormLabels[field]}{required && ' *'}<CakeDefaultHint field={field} template={template} /></>;
}
export function ProductFormFields({ type, prices = false, rows, renderField }: {
  type: string; prices?: boolean; rows?: ProductFormField[][]; renderField: (field: ProductFormField) => ReactNode;
}) {
  return <div className={`create-grid product-form-fields ${isCake(type) ? 'product-form-fields--cake' : 'product-form-fields--simple'}`}>
    {(rows || productFormRows(type, prices)).map(row => <div key={row.join(',')} data-product-row={row.join(',')} className={`product-field-row${row.length === 2 ? ' product-field-pair' : ''}`}>
      {row.map(field => <Fragment key={field}>{renderField(field)}</Fragment>)}
    </div>)}
  </div>;
}
