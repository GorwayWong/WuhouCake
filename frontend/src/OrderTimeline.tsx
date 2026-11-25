import { pickupInstant, pickupTimeLabel } from './orderTimes';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretRight, CaretDown, CaretUp } from '@phosphor-icons/react';
import { businessDate, businessTime, calendarCardTime } from './dates';
import { groupOrdersByTime, timelinePartitions, latestOrderNote } from './calendarView';
import type { CalendarView } from './calendarView';
import { deliveryCalendarFilter } from './calendarFilters';
import { orderStatusTone } from './orderStates';
import type { Account, PendingOrder, WorkbenchCard } from './types';
import { calendarOrderHref } from './routes';
import { Empty, Payment, Status } from './ui';
import { orderAccess } from './access';
import { productionCardFields } from './productionFields';
import { ProductionThumbnail } from './ProductionView';

export function OrderSummaryCard({ order, view, account, newlyCreated = false, showFinishTime = false, readyForDelivery = false, onCreatedOrderVisible }: {
  order: PendingOrder | WorkbenchCard; view: CalendarView; account: Account; newlyCreated?: boolean; showFinishTime?: boolean; readyForDelivery?: boolean;
  onCreatedOrderVisible?: (element: HTMLAnchorElement) => void;
}) {
  const access = orderAccess(account);
  const card = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => { if (newlyCreated && card.current) onCreatedOrderVisible?.(card.current); }, [newlyCreated, onCreatedOrderVisible]);
  const first = 'firstItem' in order ? order.firstItem : order.items[0];
  const itemCount = 'itemCount' in order ? order.itemCount : order.items.length;
  const quantity = 'quantity' in order ? order.quantity : order.items.reduce((sum, item) => sum + item.quantity, 0);
  const note = 'firstItem' in order ? order.latestNote : latestOrderNote(order)?.content;

  const phone = access.phone && 'firstItem' in order ? order.customerPhone?.trim() : null;
  const calendarCard = 'firstItem' in order;
  const showAddress = calendarCard && access.customer && order.fulfillmentType === 'DELIVERY';
  const pickup = calendarCard ? order.plannedHandoffAt : pickupInstant(order);
  return <a ref={card} data-order-id={order.orderId} className={`order-summary-card compact-order-card ${access.productionView ? 'production-card' : ''}${newlyCreated ? ' is-new-order' : ''}${readyForDelivery ? ' is-ready-for-delivery' : ''}`} data-order-tone={readyForDelivery ? orderStatusTone(order.status, order.fulfillmentType) : undefined} href={calendarOrderHref(view, order.orderId)}>
    {newlyCreated && <span className="created-order-badge">刚刚创建</span>}
    <div className="order-summary-title">{access.productionView && <ProductionThumbnail orderId={order.orderId} itemId={first?.itemId} />}<div className="order-summary-caption"><div className="order-summary-heading"><h3>{first?.name || `订单 #${order.orderNo}`}{!access.productionView && itemCount > 1 && <span className="order-summary-more"> · 另有 {itemCount - 1} 项</span>}</h3>{phone && <span className="order-summary-phone" aria-label={`联系电话 ${phone}`}>{phone}</span>}</div>{access.productionView && <span>{itemCount} 项 · {quantity} 件{itemCount > 1 ? ` · 另有 ${itemCount - 1} 项` : ''}</span>}</div><CaretRight aria-hidden="true" /></div>
    {showAddress && <p className="calendar-address-preview">{order.deliveryAddressPreview?.trim()
      ? `配送地址　${order.deliveryAddressPreview.trim()}` : '配送地址未填写'}</p>}
    {access.productionView ? <>
      <dl className="production-card-specifications">{productionCardFields(first ?? undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="order-summary-meta"><span className="order-summary-number">#{order.orderNo}</span>
        {showFinishTime && <span>出品 {businessTime(order.plannedFinishAt)}</span>}
      </div>
    </> : <dl className="front-card-times">
      <div><dt>{pickupTimeLabel(order.fulfillmentType)}</dt><dd>{calendarCard ? calendarCardTime(pickup, view.date) : pickup ? businessTime(pickup) : `${businessDate(order.calendarDate)} · 时刻待定`}</dd></div>
      <div><dt>出品时间</dt><dd>{calendarCard ? calendarCardTime(order.plannedFinishAt, view.date) : order.plannedFinishAt ? businessTime(order.plannedFinishAt) : '待定'}</dd></div>
    </dl>}
    <div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div>
    {note?.trim() && <p className="order-summary-note-preview"><span>备注：</span>{note}</p>}
  </a>;
}
const rememberedGroups = new Map<string, Record<string, boolean>>();
export function resetTimelineGroups(accountId: string, date: string) {
  for (const key of rememberedGroups.keys()) if (key.startsWith(`${accountId}:${date}:`)) rememberedGroups.delete(key);
}
export function OrderTimeline({ orders, counts, view, account, status = '', createdOrderId, onCreatedOrderVisible }: { orders: WorkbenchCard[]; counts: Record<string, number>; view: CalendarView; account: Account; status?: string; createdOrderId?: string; onCreatedOrderVisible?: (element: HTMLAnchorElement) => void }) {
  const access = orderAccess(account);
  const deliveryView = status === deliveryCalendarFilter;
  const sortByFinishTime = access.productionView && !deliveryView;
  const memoryKey = `${account.accountId}:${view.date}:${view.mode}:${status}`;
  const [opened, setOpened] = useState<Record<string, boolean>>(() => rememberedGroups.get(memoryKey) || {});
  const headings = useRef<Record<string, HTMLButtonElement | null>>({});
  const originalOrders = new Map(orders.map(order => [order.orderId, order]));
  const timedOrders = sortByFinishTime ? orders.map(order => ({ ...order, plannedHandoffAt: order.plannedFinishAt })) : orders;
  const revealedOrder = useRef<string | null>(null);
  useEffect(() => {
    if (deliveryView || !createdOrderId || revealedOrder.current === createdOrderId) return;
    const partition = timelinePartitions(orders, status).find(partition => partition.orders.some(order => order.orderId === createdOrderId));
    if (!partition) return;
    revealedOrder.current = createdOrderId;
    setOpened(current => {
      const next = { ...current, [partition.id]: true }; rememberedGroups.set(memoryKey, next); return next;
    });
  }, [createdOrderId, deliveryView, orders, status, memoryKey]);
  if (!orders.length) return <Empty>{businessDate(view.date)} 没有符合条件的订单，请检查日期及当前筛选。</Empty>;
  const slotLabel = deliveryView ? '配送时间' : sortByFinishTime ? '出品时间' : '取货时段';
  const pendingLabel = deliveryView ? '配送时间待定' : sortByFinishTime ? '出品待定' : '取货待定';
  const exactTime = deliveryView || sortByFinishTime;
  const toggle = (id: string, open: boolean, fromBottom = false) => {
    const next = { ...opened, [id]: open }; setOpened(next); rememberedGroups.set(memoryKey, next);
    if (fromBottom) { headings.current[id]?.focus({ preventScroll: true }); headings.current[id]?.scrollIntoView({ block: 'start' }); }
  };
  return <div className="order-timeline">
    {timelinePartitions(timedOrders, status, counts).map(partition => {
      const expanded = opened[partition.id] ?? partition.expanded;
      const contentId = `timeline-${view.date}-${partition.id}`;
      const renderTimeGroups = () => groupOrdersByTime(partition.orders, exactTime ? 'minute' : 'half-hour').map(group => <section className={`timeline-group${group.date ? '' : ' is-unscheduled'}`} key={group.key} aria-label={group.date ? `${group.date} ${slotLabel} ${group.time}${exactTime ? '' : ` 至${group.endsNextDay ? '次日 ' : ' '}${group.endTime}`}` : pendingLabel}>
          <div className="timeline-time">{group.date ? <>
            {group.date !== view.date && <span className="timeline-date">{businessDate(group.date)}</span>}
            <span className="timeline-start">{group.time}</span>{!exactTime && <span className="timeline-end">至{group.endsNextDay ? '次日' : ''} {group.endTime}</span>}
          </> : <span className="timeline-pending">{pendingLabel}</span>}</div>
          <div className="timeline-orders">{group.orders.map(order => <OrderSummaryCard key={order.orderId} order={originalOrders.get(order.orderId)!} view={view} account={account}
            readyForDelivery={deliveryView && order.status === 'WAITING_DELIVERY'} newlyCreated={order.orderId === createdOrderId} onCreatedOrderVisible={onCreatedOrderVisible} />)}</div>
        </section>);
      if (deliveryView) {
        if (!partition.orders.length) return null;
        return <section className="order-partition" key={partition.id}>
          {partition.id === 'completed' && <h3 className="timeline-delivered-separator" data-order-tone={orderStatusTone('COMPLETED')}>已送达</h3>}
          {renderTimeGroups()}
        </section>;
      }
      return <section className="order-partition" key={partition.id}>
        <h3><button type="button" className="timeline-partition-toggle" ref={element => { headings.current[partition.id] = element; }} aria-expanded={expanded} aria-controls={contentId} onClick={() => toggle(partition.id, !expanded)}>
          <span data-order-tone={partition.id === 'completed' ? 'success' : partition.id === 'cancelled' || partition.id === 'unknown' ? partition.id : undefined}>{partition.label} <span>{counts[partition.id] ?? partition.orders.length} 单</span></span><span>{expanded ? <CaretUp /> : <CaretDown />}{expanded ? '收起' : '展开'}</span>
        </button></h3>
        <div id={contentId} hidden={!expanded}>{partition.id === 'unknown' && <p className="notice">页面可能已更新，请保存当前内容后刷新；以下订单仍可查看。</p>}{expanded && <>{renderTimeGroups()}{partition.orders.length > 3 && <button type="button" className="text-button timeline-collapse-bottom" onClick={() => toggle(partition.id, false)}><CaretUp />收起{partition.label}订单</button>}</>}</div>
      </section>;
    })}
  </div>;
}
