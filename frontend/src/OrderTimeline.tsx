import { CaretRight } from '@phosphor-icons/react';
import { time } from './dates';
import { groupOrdersByTime, latestOrderNote, isUnfinishedOrder } from './calendarView';
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
    <p className="order-summary-receive-time">客户期望收货时间：{order.requestedReceiveAt ? time(order.requestedReceiveAt, true) : `${order.calendarDate} · 时刻待定`}</p>
    <div className="order-summary-meta"><span>{access.customer ? order.customer?.phone : '制作订单'}</span>{access.productionView ? <span>计划出品时间：{order.plannedFinishAt ? time(order.plannedFinishAt, true) : '未安排'}</span> : <span>{order.plannedHandoffAt ? `到店取货时间：${time(order.plannedHandoffAt, handoffDate !== order.calendarDate)}` : '到店取货时间待定'} {order.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</span>}<span className="order-summary-number">#{order.orderNo}</span></div>
    <div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div>
    <ul className="order-summary-products">{order.items.map(item => <li key={item.itemId}>{item.name} <span>×{item.quantity}</span>{access.productionView && <ProductionFields item={item} />}</li>)}</ul>
    {note && <p className="order-summary-note"><span>备注</span>{note?.content || '无'}</p>}
  </a>;
}
export function OrderTimeline({ orders, view, account }: { orders: PendingOrder[]; view: CalendarView; account: Account }) {
  const access = orderAccess(account);
  const timedOrders = access.productionView ? orders.map(order => ({ ...order, plannedHandoffAt: order.plannedFinishAt })) : orders;
  if (!orders.length) return <Empty>{view.date} 没有符合条件的订单，请检查日期及当前筛选。</Empty>;
  const basis = access.productionView ? '计划出品时间' : '到店取货时间';
  const slotLabel = access.productionView ? '出品时段' : '取货时段';
  const pendingLabel = access.productionView ? '出品待定' : '取货待定';
  const partitions = [{ label: '待处理订单', orders: timedOrders.filter(isUnfinishedOrder) }, { label: '已完成／已取消', orders: timedOrders.filter(order => !isUnfinishedOrder(order)) }].filter(group => group.orders.length);
  return <div className="order-timeline">
    <div className="timeline-heading"><strong>{slotLabel}</strong><p>按{basis}每 30 分钟分组，准确时间见订单卡片</p></div>
    {partitions.map(partition => <section className="order-partition" key={partition.label}><h3>{partition.label} <span>{partition.orders.length} 单</span></h3>{groupOrdersByTime(partition.orders).map(group => <section className={`timeline-group${group.date ? '' : ' is-unscheduled'}`} key={group.key} aria-label={group.date ? `${group.date} ${slotLabel} ${group.time} 至${group.endsNextDay ? '次日 ' : ' '}${group.endTime}` : pendingLabel}>
      <div className="timeline-time">{group.date ? <>
        {group.date !== view.date && <span className="timeline-date">{group.date}</span>}
        <span className="timeline-start">{group.time}</span><span className="timeline-end">至{group.endsNextDay ? '次日' : ''} {group.endTime}</span>
      </> : <span className="timeline-pending">{pendingLabel}</span>}</div>
      <div className="timeline-orders">{group.orders.map(order => <OrderSummaryCard key={order.orderId} order={order} view={view} account={account} />)}</div>
    </section>)}</section>)}
  </div>;
}
