import { CalendarBlank, Clock, Package, Truck, CheckCircle, XCircle, Circle, Stack, Cake } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Item, OrderStatus } from './types';
import { time } from './dates';
import { errorText } from './api';

export const statusNames: Record<string, string> = {
  WAITING_PRODUCTION: '待制作', PROCESSING: '制作中', WAITING_DELIVERY: '待配送',
  WAITING_PICKUP: '待自提', DELIVERING: '配送中', COMPLETED: '已完成', CANCELLED: '已取消',
  LAYER_DONE: '已夹层', FROSTING_DONE: '已抹面',
};
export function statusLabel(order: OrderStatus) {
  return statusNames[order.status === 'PROCESSING' && order.currentStageCode ? order.currentStageCode : order.status] || order.status;
}
export function Status({ order }: { order: OrderStatus }) {
  const Icon = order.status === 'COMPLETED' ? CheckCircle : order.status === 'CANCELLED' ? XCircle
    : order.status === 'DELIVERING' || order.status === 'WAITING_DELIVERY' ? Truck
    : order.status === 'WAITING_PICKUP' ? Package : order.currentStageCode === 'LAYER_DONE' ? Stack
    : order.currentStageCode === 'FROSTING_DONE' ? Cake : Clock;
  return <span className={`badge status-${order.status.toLowerCase()}`}><Icon size={15} />{statusLabel(order)}</span>;
}
export function Payment({ status }: { status: string }) {
  return <span className={`badge payment-${status.toLowerCase()}`}><Circle size={11} weight={status === 'PAID' ? 'fill' : 'regular'} />{status === 'PAID' ? '已付款' : '未付款'}</span>;
}
export function Brand() { return <a className="brand" href="#" aria-label="午逅 Story 工作台"><img src="/brand.jpg" alt="午逅 Story" /></a>; }
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <div className="notice error" role="alert">{errorText(error)}{retry && <button className="text-button" onClick={retry}>重试</button>}</div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty"><CalendarBlank size={32} /><p>{children}</p></div>; }
export function Loading() { return <div className="loading" role="status">正在读取最新数据…</div>; }
const attributeNames: Record<string, string> = { size: '尺寸', flavor: '口味', filling: '夹馅', base: '内胚', cakeBase: '内胚', message: '祝福语', greeting: '祝福语', requirements: '其他要求', otherRequirements: '其他要求' };
export function valueText(value: unknown): string {
  if (value == null) return '未填写';
  if (Array.isArray(value)) return value.map(valueText).join('、');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${attributeNames[key] || key}：${valueText(item)}`).join('；');
  return String(value);
}
export function money(cents: number | null) { return cents == null ? '未填写' : `¥${(cents / 100).toFixed(2)}`; }
export function Product({ item, prices = false, children, actions }: { item: Item; prices?: boolean; children?: ReactNode; actions?: ReactNode }) {
  return <section className="product" aria-label={`商品 ${item.name}`}>
    <div className="product-heading"><span className="product-mark"><Cake size={24} /></span><div><h3>{item.name}</h3><span className="muted">{!item.productType || item.productType === 'CAKE' ? '定制蛋糕' : item.productType} · 数量 {item.quantity}</span></div></div>
    {actions}
    {children || <dl className="attributes">{Object.entries(item.attributes || {}).map(([key, value]) => <div key={key}><dt>{attributeNames[key] || key}</dt><dd>{valueText(value)}</dd></div>)}
      {prices && <><div><dt>单价</dt><dd>{money(item.unitPriceCents)}</dd></div><div><dt>会员单价</dt><dd>{money(item.memberPriceCents)}</dd></div></>}
    </dl>}
    <div className="recent-notes"><h4>最近备注 <span>{item.recentNotes.length}</span></h4>
      {item.recentNotes.length === 0 ? <p className="muted">还没有商品备注</p> : <ul>{item.recentNotes.map(note => <li key={note.id}><div className="note-meta"><strong>{note.actorNameSnapshot}</strong><time dateTime={note.createdAt}>{time(note.createdAt, true)}</time></div><p>{note.content}</p></li>)}</ul>}
    </div>
  </section>;
}
