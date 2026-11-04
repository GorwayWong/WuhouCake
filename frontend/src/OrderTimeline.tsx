import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretRight, CaretDown, CaretUp } from '@phosphor-icons/react';
import { time } from './dates';
import { groupOrdersByTime, timelinePartitions, latestOrderNote } from './calendarView';
import type { CalendarView } from './calendarView';
import type { Account, PendingOrder } from './types';
import { calendarOrderHref } from './routes';
import { Empty, Payment, Status } from './ui';
import { orderAccess } from './access';
import { ProductionThumbnail } from './ProductionView';

function OrderSummaryCard({ order, view, account, newlyCreated, onCreatedOrderVisible }: { order: PendingOrder; view: CalendarView; account: Account; newlyCreated: boolean; onCreatedOrderVisible?: (element: HTMLAnchorElement) => void }) {
  const access = orderAccess(account);
  const card = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => { if (newlyCreated && card.current) onCreatedOrderVisible?.(card.current); }, [newlyCreated, onCreatedOrderVisible]);
  const note = latestOrderNote(order);
  const handoffDate = order.plannedHandoffAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(order.plannedHandoffAt)) : null;
  return <a ref={card} data-order-id={order.orderId} className={`order-summary-card compact-order-card ${access.productionView ? 'production-card' : ''}${newlyCreated ? ' is-new-order' : ''}`} href={calendarOrderHref(view, order.orderId)}>
    {newlyCreated && <span className="created-order-badge">刚刚创建</span>}
    <div className="order-summary-title">{access.productionView && <ProductionThumbnail orderId={order.orderId} />}<div className="order-summary-caption"><h3>{order.items[0]?.name || `订单 #${order.orderNo}`}</h3><span>{order.items.length} 项 · {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件{order.items.length > 1 ? ` · 另有 ${order.items.length - 1} 项` : ''}</span></div><CaretRight aria-hidden="true" /></div>
    <p className="order-summary-receive-time">客户期望收货时间：{order.requestedReceiveAt ? time(order.requestedReceiveAt, true) : `${order.calendarDate} · 时刻待定`}</p>
    <div className="order-summary-meta"><span>{access.customer ? order.customer?.phone : '制作订单'}</span>{access.productionView ? <span>计划出品时间：{order.plannedFinishAt ? time(order.plannedFinishAt, true) : '未安排'}</span> : <span>{order.plannedHandoffAt ? `到店取货时间：${time(order.plannedHandoffAt, handoffDate !== order.calendarDate)}` : '到店取货时间待定'} {order.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</span>}<span className="order-summary-number">#{order.orderNo}</span></div>
    <div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div>
    {note?.content.trim() && <p className="order-summary-note-preview"><span>备注：</span>{note.content}</p>}
  </a>;
}
const rememberedGroups = new Map<string, Record<string, boolean>>();
export function resetTimelineGroups(accountId: string, date: string) {
  for (const key of rememberedGroups.keys()) if (key.startsWith(`${accountId}:${date}:`)) rememberedGroups.delete(key);
}
export function OrderTimeline({ orders, view, account, status = '', createdOrderId, onCreatedOrderVisible }: { orders: PendingOrder[]; view: CalendarView; account: Account; status?: string; createdOrderId?: string; onCreatedOrderVisible?: (element: HTMLAnchorElement) => void }) {
  const access = orderAccess(account);
  const memoryKey = `${account.accountId}:${view.date}:${view.mode}:${status}`;
  const [opened, setOpened] = useState<Record<string, boolean>>(() => rememberedGroups.get(memoryKey) || {});
  const headings = useRef<Record<string, HTMLButtonElement | null>>({});
  const timedOrders = access.productionView ? orders.map(order => ({ ...order, plannedHandoffAt: order.plannedFinishAt })) : orders;
  const revealedOrder = useRef<string | null>(null);
  useEffect(() => {
    if (!createdOrderId || revealedOrder.current === createdOrderId) return;
    const partition = timelinePartitions(orders, status).find(partition => partition.orders.some(order => order.orderId === createdOrderId));
    if (!partition) return;
    revealedOrder.current = createdOrderId;
    setOpened(current => {
      const next = { ...current, [partition.id]: true }; rememberedGroups.set(memoryKey, next); return next;
    });
  }, [createdOrderId, orders, status, memoryKey]);
  if (!orders.length) return <Empty>{view.date} 没有符合条件的订单，请检查日期及当前筛选。</Empty>;
  const basis = access.productionView ? '计划出品时间' : '到店取货时间';
  const slotLabel = access.productionView ? '出品时段' : '取货时段';
  const pendingLabel = access.productionView ? '出品待定' : '取货待定';
  const toggle = (id: string, open: boolean, fromBottom = false) => {
    const next = { ...opened, [id]: open }; setOpened(next); rememberedGroups.set(memoryKey, next);
    if (fromBottom) { headings.current[id]?.focus({ preventScroll: true }); headings.current[id]?.scrollIntoView({ block: 'start' }); }
  };
  return <div className="order-timeline">
    <div className="timeline-heading"><strong>{slotLabel}</strong><p>按{basis}每 30 分钟分组，准确时间见订单卡片</p></div>
    {timelinePartitions(timedOrders, status).map(partition => {
      const expanded = opened[partition.id] ?? partition.expanded;
      const contentId = `timeline-${view.date}-${partition.id}`;
      return <section className="order-partition" key={partition.id}>
        <h3><button type="button" className="timeline-partition-toggle" ref={element => { headings.current[partition.id] = element; }} aria-expanded={expanded} aria-controls={contentId} onClick={() => toggle(partition.id, !expanded)}>
          <span>{partition.label} <span>{partition.orders.length} 单</span></span><span>{expanded ? <CaretUp /> : <CaretDown />}{expanded ? '收起' : '展开'}</span>
        </button></h3>
        <div id={contentId} hidden={!expanded}>{expanded && <>{groupOrdersByTime(partition.orders).map(group => <section className={`timeline-group${group.date ? '' : ' is-unscheduled'}`} key={group.key} aria-label={group.date ? `${group.date} ${slotLabel} ${group.time} 至${group.endsNextDay ? '次日 ' : ' '}${group.endTime}` : pendingLabel}>
          <div className="timeline-time">{group.date ? <>
            {group.date !== view.date && <span className="timeline-date">{group.date}</span>}
            <span className="timeline-start">{group.time}</span><span className="timeline-end">至{group.endsNextDay ? '次日' : ''} {group.endTime}</span>
          </> : <span className="timeline-pending">{pendingLabel}</span>}</div>
          <div className="timeline-orders">{group.orders.map(order => <OrderSummaryCard key={order.orderId} order={order} view={view} account={account} newlyCreated={order.orderId === createdOrderId} onCreatedOrderVisible={onCreatedOrderVisible} />)}</div>
        </section>)}{partition.orders.length > 3 && <button type="button" className="text-button timeline-collapse-bottom" onClick={() => toggle(partition.id, false, true)}><CaretUp />收起{partition.label}订单</button>}</>}</div>
      </section>;
    })}
  </div>;
}
