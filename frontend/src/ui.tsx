import { CalendarBlank, Clock, Truck, CheckCircle, XCircle, Circle, Stack, Cake } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Item, OrderStatus } from './types';
import { time } from './dates';
import { exactYuan } from './money';
import { errorText } from './api';
import { productTypeLabel } from './productTypes';
import { visibleSpecification } from './specificationText';
import { displayedStatusCode, fulfillmentStatusName } from './orderStates';
export { statusNames } from './orderStates';

export function statusLabel(order: OrderStatus) {
  return fulfillmentStatusName(displayedStatusCode(order), order.fulfillment?.type ?? order.fulfillmentType);
}
export function Status({ order }: { order: OrderStatus }) {
  const status = displayedStatusCode(order);
  const Icon = status === 'COMPLETED' ? CheckCircle : ['CANCELLED', 'DELETED'].includes(status) ? XCircle
    : status === 'WAITING_DELIVERY' ? Truck : status === 'LAYER' ? Stack
    : ['CAKE_BASE', 'FROSTING', 'DECORATING'].includes(status) ? Cake : Clock;
  return <span className={`badge status-${status.toLowerCase()}`}><Icon size={15} />{statusLabel(order)}</span>;
}
export function Payment({ status }: { status: string | null }) {
  if (status == null) return null;
  return <span className={`badge payment-${status.toLowerCase()}`}><Circle size={11} weight={status === 'PAID' ? 'fill' : 'regular'} />{status === 'PAID' ? '已付款' : '未付款'}</span>;
}
export function Brand() { return <a className="brand" href="#" aria-label="午逅 Story 工作台"><img src="/brand.jpg" alt="午逅 Story" /></a>; }
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <div className="notice error" role="alert">{errorText(error)}{retry && <button className="text-button" onClick={retry}>重试</button>}</div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty"><CalendarBlank size={32} /><p>{children}</p></div>; }
export function Loading() { return <div className="loading" role="status">正在读取最新数据…</div>; }
const attributeNames: Record<string, string> = { specification: '规格', size: '尺寸', flavor: '奶油', filling: '夹馅', base: '内胚', cakeBase: '内胚', message: '祝福语', greeting: '祝福语', requirements: '其他要求', otherRequirements: '其他要求' };
export function valueText(value: unknown): string {
  if (value == null) return '未填写';
  if (Array.isArray(value)) return value.map(valueText).join('、');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${attributeNames[key] || key}：${valueText(item)}`).join('；');
  return String(value);
}
export function money(cents: number | null) { return cents == null ? '未填写' : `¥${exactYuan(cents)}`; }
export function itemSpecification(item: Pick<Item, 'attributes'>) {
  return valueText(visibleSpecification(item.attributes.specification) ?? '').trim();
}
export function ItemPriceFields({ item, itemSum }: { item: Item; itemSum: boolean }) {
  const suffix = itemSum ? '' : '（仅供参考）';
  return <>
    {item.unitPriceCents != null && <div><dt>{itemSum ? '原单价' : '原商品单价'}</dt><dd>{money(item.unitPriceCents)}{suffix}</dd></div>}
    {item.memberPriceCents != null && <div><dt>{itemSum ? '会员单价' : '原会员单价'}</dt><dd>{money(item.memberPriceCents)}{suffix}</dd></div>}
  </>;
}
export function Product({ item, prices = false, itemSum = false, children, actions, completion }: { item: Item; prices?: boolean; itemSum?: boolean; children?: ReactNode; actions?: ReactNode; completion?: ReactNode }) {
  const specification = itemSpecification(item);
  return <section className="product" aria-label={`商品 ${item.name}`}>
    <div className="product-heading-row"><div className="product-heading"><span className="product-mark"><Cake size={24} /></span><div className="product-title"><h3>{item.name}</h3><span className="muted">{productTypeLabel(item.productType || 'CAKE')} · 数量 {item.quantity}</span></div></div>{completion}</div>
    {actions}
    {children || <dl className="attributes">{Object.entries(item.attributes || {}).filter(([key]) => key !== 'specification').map(([key, value]) => <div key={key}><dt>{attributeNames[key] || key}</dt><dd className="product-spec-text">{valueText(value)}</dd></div>)}
      {specification && <div><dt>商品说明</dt><dd className="product-spec-text">{specification}</dd></div>}
      {prices && <ItemPriceFields item={item} itemSum={itemSum} />}
    </dl>}
    <RecentProductNotes item={item} />
  </section>;
}

export function RecentProductNotes({ item }: { item: Item }) {
  if (item.recentNotes.length === 0) return null;
  return <div className="recent-notes"><h4>{item.name}的最近备注 <span>{item.recentNotes.length}</span></h4>
    <ul>{item.recentNotes.map(note => <li key={note.id}><div className="note-meta"><strong>{note.actorNameSnapshot}</strong><time dateTime={note.createdAt}>{time(note.createdAt, true)}</time></div><p>{note.content}</p></li>)}</ul>
  </div>;
}
