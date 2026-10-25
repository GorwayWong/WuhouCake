import { CaretRight } from '@phosphor-icons/react';
import { time } from './dates';
import { groupOrdersByTime, latestOrderNote } from './calendarView';
import type { CalendarView } from './calendarView';
import type { Account, PendingOrder } from './types';
import { calendarOrderHref } from './routes';
import { Empty, Payment, Status } from './ui';
import { orderAccess } from './access';
import { ProductionFields, ProductionThumbnail } from './ProductionView';

function OrderSummaryCard({ order, view, account }: { order: PendingOrder; view: CalendarView; account: Account }) {
  const access = orderAccess(account);
  const note = latestOrderNote(order);
  const handoffDate = order.plannedHandoffAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(order.plannedHandoffAt)) : null;
  return <a className={`order-summary-card ${access.productionView ? 'production-card' : ''}`} href={calendarOrderHref(view, order.orderId)}>
    {access.productionView && <ProductionThumbnail orderId={order.orderId} />}
    <div className="order-summary-title"><h3>{order.items[0]?.name || `订单 #${order.orderNo}`}</h3><CaretRight aria-hidden="true" /></div>
    <div className="order-summary-meta"><span>{access.customer ? order.customer?.phone : '制作订单'}</span>{access.productionView ? <span>计划出品：{order.plannedFinishAt ? time(order.plannedFinishAt, true) : '未安排'}</span> : <span>{order.plannedHandoffAt ? time(order.plannedHandoffAt, handoffDate !== order.calendarDate) : '时间待定'} {order.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</span>}<span className="order-summary-number">#{order.orderNo}</span></div>
    <div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div>
    <ul className="order-summary-products">{order.items.map(item => <li key={item.itemId}>{item.name} <span>×{item.quantity}</span>{access.productionView && <ProductionFields item={item} />}</li>)}</ul>
    {(note || access.productionView) && <p className="order-summary-note"><span>备注</span>{note?.content || '无'}</p>}
  </a>;
}
export function OrderTimeline({ orders, view, account }: { orders: PendingOrder[]; view: CalendarView; account: Account }) {
  const access = orderAccess(account);
  const timedOrders = access.productionView ? orders.map(order => ({ ...order, plannedHandoffAt: order.plannedFinishAt })) : orders;
  if (!orders.length) return <Empty>{view.date} 没有符合条件的订单，请检查日期及当前筛选。</Empty>;
  return <div className="order-timeline">{groupOrdersByTime(timedOrders).map(group => <section className="timeline-group" key={group.key} aria-label={`${group.time} 出货订单`}>
    <div className="timeline-time">{group.time}</div><div className="timeline-orders">{group.orders.map(order => <OrderSummaryCard key={order.orderId} order={order} view={view} account={account} />)}</div>
  </section>)}</div>;
}
