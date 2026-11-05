import { Select } from './Select';
import { customOrderingMethod, orderingMethods } from './orderingMethod';
import type { OrderingMethodDraft } from './orderingMethod';

export function OrderingMethodInput({ value, custom, onChange, emptyLabel = '未填写', disabled, id, name = 'orderingMethod', invalid, describedBy }: {
  value: string; custom?: boolean; onChange: (draft: OrderingMethodDraft) => void;
  emptyLabel?: string; disabled?: boolean; id?: string; name?: string; invalid?: boolean; describedBy?: string;
}) {
  const other = customOrderingMethod({ orderingMethod: value, orderingMethodCustom: custom });
  return <div className="ordering-method-input">
    <Select label="下单方式" id={id} name={other ? undefined : name} disabled={disabled} value={other ? 'OTHER' : value.trim()}
      aria-invalid={invalid} aria-describedby={describedBy}
      onChange={method => onChange({ orderingMethod: method === 'OTHER' ? '' : method, orderingMethodCustom: method === 'OTHER' })}>
      <option value="">{emptyLabel}</option>{orderingMethods.map(method => <option key={method} value={method}>{method}</option>)}<option value="OTHER">其他</option>
    </Select>
    {other && <input id={id ? `${id}-custom` : undefined} name={name} aria-label="具体下单方式" disabled={disabled}
      value={value} required maxLength={80} placeholder="填写具体下单方式" aria-invalid={invalid} aria-describedby={describedBy}
      onChange={event => onChange({ orderingMethod: event.target.value, orderingMethodCustom: true })} />}
  </div>;
}
