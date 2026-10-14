import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { canEditItems, itemChangeRequest, itemDraft, itemInput, newItem, specificationFields, textSpecification } from './orderForm';
import type { Detail, ItemAddRequest, ItemChangeRequest } from './types';
import { ErrorNotice, Product, valueText } from './ui';

function Field({ name, label, error, children, wide = false }: { name: string; label: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label htmlFor={`item-${name}`} className={wide ? 'form-wide' : undefined}>{label}{children}{error && <span className="field-error" id={`item-${name}-error`}>{error}</span>}</label>;
}
export function ItemEdit({ initial, itemId, latest, busy, error, onSave, onCancel, onDirtyChange }: {
  initial: Detail; itemId?: string; latest: Detail; busy: boolean; error: unknown;
  onSave: (request: ItemChangeRequest | ItemAddRequest) => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const original = initial.items.find(item => item.itemId === itemId);
  const [initialDraft] = useState(() => original ? itemDraft(original) : newItem());
  const [draft, setDraft] = useState(initialDraft);
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const attemptedVersion = useRef(initial.version);
  const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (conflict && !baseline && latest.version > attemptedVersion.current) setBaseline(latest);
  }, [conflict, baseline, latest]);
  const current = latest.items.find(item => item.itemId === itemId);
  const unavailable = !canEditItems(latest) || Boolean(itemId && !current);
  const unknownAddition = !itemId && creationResultUnknown(error);
  const change = (next: typeof draft) => { setDraft(next); setErrors({}); };
  const props = (name: string) => ({ id: `item-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `item-${name}-error` : undefined });
  return <form className="item-form" ref={form} noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline || unavailable) return;
    const input = itemInput(draft);
    const result = itemId ? itemChangeRequest(initial, itemId, draft, baseline) : { request: input.item ? { expectedVersion: baseline.version, item: input.item } : null, errors: input.errors };
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      const first = form.current?.elements.namedItem(Object.keys(result.errors)[0]);
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    if (!result.request) { onCancel(); return; }
    attemptedVersion.current = result.request.expectedVersion;
    try { await onSave(result.request); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENT_MODIFICATION') { setConflict(true); setBaseline(null); }
    }
  }}>
    <fieldset className="create-fields" disabled={busy}>
      <div className="create-grid">
        {(['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const).map((name, index) => <Field key={name} name={name} label={{ name: '商品名称 *', productType: '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[name]} error={errors[name]} wide={name === 'name'}><input {...props(name)} autoFocus={index === 0} value={draft[name]} inputMode={name === 'quantity' ? 'numeric' : name.endsWith('Price') ? 'decimal' : undefined} maxLength={name === 'name' ? 128 : name === 'productType' ? 32 : undefined} required={name === 'name' || name === 'quantity'} placeholder={name.endsWith('Price') ? '未填写' : undefined} onChange={event => change({ ...draft, [name]: event.target.value })} /></Field>)}
        {specificationFields.map(([key, label]) => {
          const structured = !textSpecification(original?.attributes[key]) || !textSpecification((baseline || latest).items.find(item => item.itemId === itemId)?.attributes[key]);
          return <Field key={key} name={key} label={label} wide={key === 'requirements'}>{structured ? <span className="preserved-specification">{valueText(current?.attributes[key] ?? original?.attributes[key])}<small>此规格保留原值。</small></span> : key === 'requirements' ? <textarea {...props(key)} rows={2} value={draft.attributes[key]} onChange={event => change({ ...draft, attributes: { ...draft.attributes, [key]: event.target.value } })} /> : <input {...props(key)} value={draft.attributes[key]} onChange={event => change({ ...draft, attributes: { ...draft.attributes, [key]: event.target.value } })} />}</Field>;
        })}
      </div>
      <p className="form-help">商品报价与数量修改不改变订单约定总金额。制作同事需复核最新规格与数量。{!itemId && latest.status === 'PROCESSING' && '制作中追加商品会清空整单已确认制作节点。'}</p>
      <ErrorNotice error={unknownAddition ? null : error} />
      {unknownAddition && <p className="notice error" role="alert">追加结果暂时无法确认，商品可能已成功保存，输入已保留。请先核对上方最新商品列表及修改日志，确认是否已追加，再决定是否重新保存。</p>}
      {unavailable && <p className="notice" role="status">{itemId && !current ? '此商品已被同事移除，草稿已保留，请取消编辑并核对订单。' : ['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(latest.status) ? '订单已进入待交接，草稿已保留。请先执行上方「重新制作」，再核对订单并保存。' : '订单状态已变化，当前不能修改商品。草稿已保留，请取消编辑并核对状态。'}</p>}
      {conflict && <div className="information-review"><p className="notice" role="status">输入已保留。请核对下方最新商品与整单状态，再点击保存；只提交你改过的字段。{!baseline && '最新订单尚未读取，请先重试顶部的数据读取。'}</p><h3>最新订单（用于核对）</h3><p>{latest.items.length} 件商品 · {canEditItems(latest) ? '允许修改商品' : '当前不允许修改商品'}</p>{itemId ? current && <Product item={current} prices /> : latest.items.map(item => <Product key={item.itemId} item={item} prices />)}</div>}
      <div className="actions"><button className="primary" disabled={busy || !baseline || unavailable}>{busy ? '正在保存…' : '保存'}</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
