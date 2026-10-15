import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CaretDown, CaretUp, ClipboardText, ShoppingBag, Truck, Clock, MapPin, Phone, Plus } from '@phosphor-icons/react';
import { api } from './api';
import { calendarRange, shiftDate, shiftMonth, time, today } from './dates';
import type { CalendarOrder, Workbench } from './types';
import { Empty, ErrorNotice, Loading, Payment, Product, Status } from './ui';
import { BatchOrderExport } from './OrderExports';

type Mode = 'week' | 'month';
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
function DateBlock({ date, orders, selected, month, onSelect }: { date: string; orders: CalendarOrder[]; selected: string; month: boolean; onSelect: (date: string) => void }) {
  return <div className={`date-block ${date === selected ? 'selected' : ''} ${date.slice(0, 7) !== selected.slice(0, 7) && month ? 'outside-month' : ''}`}>
    <button className="date-select" aria-label={`选择 ${date}`} aria-pressed={date === selected} onClick={() => onSelect(date)}><span>{Number(date.slice(8))}</span>{date === today() && <small>今</small>}</button>
    <div className="date-orders">{orders.map(order => <a href={`#/orders/${order.orderId}`} className="calendar-order" key={order.orderId}>
      <strong>{order.items.map(item => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join('、')}</strong>
      <span className="calendar-number">#{order.orderNo}</span><Status order={order} /><Payment status={order.paymentStatus} />
    </a>)}{!orders.length && <span className="no-orders" aria-label="无订单">—</span>}</div>
  </div>;
}
export function Calendar({ selected, setSelected, mode, setMode, onWritingChange }: { selected: string; setSelected: (date: string) => void; mode: Mode; setMode: (mode: Mode) => void; onWritingChange: (pending: boolean) => void }) {
  const range = calendarRange(selected, mode);
  const calendar = useQuery({ queryKey: ['calendar', range.from, range.to], queryFn: ({ signal }) => api<CalendarOrder[]>(`/orders/calendar?from=${range.from}&to=${range.to}`, { signal }) });
  const workbench = useQuery({ queryKey: ['workbench', selected], queryFn: ({ signal }) => api<Workbench>(`/orders/workbench?date=${selected}`, { signal }), enabled: mode === 'week' });
  const sorted = [...(calendar.data || [])].sort((a, b) => (Date.parse(a.plannedHandoffAt) - Date.parse(b.plannedHandoffAt)) || a.orderNo.localeCompare(b.orderNo));
  const changePeriod = (delta: number) => setSelected(mode === 'week' ? shiftDate(selected, delta * 7) : shiftMonth(selected, delta));
  return <>
    <div className="page-heading workbench-heading"><div><p className="eyebrow">每一份心意，都准时抵达</p><h1>{mode === 'week' ? '日历工作台' : '月历工作台'}</h1></div><div className="workbench-heading-actions"><button className="secondary compact" onClick={() => setSelected(today())}>回到今天</button><a className="primary" href="#/orders/new"><Plus />新建订单</a></div></div>
    <BatchOrderExport selected={selected} onPendingChange={onWritingChange} />
    <section className={`panel calendar-panel ${mode}`} aria-label={mode === 'week' ? '周历' : '月历'}>
      <div className="calendar-toolbar"><div className="period"><h2>{selected.slice(0, 4)} 年 {Number(selected.slice(5, 7))} 月</h2><label className="date-jump"><span className="sr-only">跳转日期</span><input type="date" value={selected} onChange={event => { if (event.target.value && /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setSelected(event.target.value); }} /></label></div><div className="period-actions"><button className="icon-button" aria-label={mode === 'week' ? '上一周' : '上个月'} onClick={() => changePeriod(-1)}><ArrowLeft /></button><button className="icon-button" aria-label={mode === 'week' ? '下一周' : '下个月'} onClick={() => changePeriod(1)}><ArrowRight /></button></div></div>
      <ErrorNotice error={calendar.error} retry={() => void calendar.refetch()} />
      {calendar.isPending ? <Loading /> : <div className="calendar-scroll"><div className="calendar-weekdays">{weekdays.map(day => <span key={day}>周{day}</span>)}</div><div className="calendar-grid">{range.dates.map(date => <DateBlock key={date} date={date} selected={selected} month={mode === 'month'} onSelect={setSelected} orders={sorted.filter(order => order.calendarDate === date)} />)}</div></div>}
      <button className="calendar-toggle" onClick={() => setMode(mode === 'week' ? 'month' : 'week')}>{mode === 'week' ? '展开本月日历' : `收起月历 · 查看 ${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(8))} 日订单`}{mode === 'week' ? <CaretDown /> : <CaretUp />}</button>
    </section>
    {mode === 'week' && <>
      <section className="metrics" aria-label="所选日期统计">{[
        { label: '总订单', value: workbench.data?.metrics.totalOrders, Icon: ClipboardText },
        { label: '当日新下单', value: workbench.data?.metrics.createdOnDate, Icon: ShoppingBag },
        { label: '当日需配送', value: workbench.data?.metrics.deliveryDueOnDate, Icon: Truck },
      ].map(({ label, value, Icon }) => <div className="metric" key={label}><span className="metric-icon"><Icon size={25} /></span><div><span>{label}</span><strong>{value ?? '—'}</strong></div></div>)}</section>
      <div className="section-heading"><h2>{Number(selected.slice(5, 7))} 月 {Number(selected.slice(8))} 日待办 <span>{workbench.data?.pendingOrders.length ?? '—'}</span></h2><span className="muted">按交付时间排序</span></div>
      <ErrorNotice error={workbench.error} retry={() => void workbench.refetch()} />
      {workbench.isPending ? <Loading /> : workbench.data?.pendingOrders.length === 0 ? <Empty>这一天的待办都安排好了</Empty> : <div className="order-list">{[...(workbench.data?.pendingOrders || [])].sort((a, b) => (Date.parse(a.plannedHandoffAt) - Date.parse(b.plannedHandoffAt)) || a.orderNo.localeCompare(b.orderNo)).map(order => <article className="panel order-card" key={order.orderId}>
        <header><a className="order-link" href={`#/orders/${order.orderId}`}><span>订单</span> #{order.orderNo}<ArrowRight size={17} /></a><div className="badges"><Status order={order} /><Payment status={order.paymentStatus} /></div></header>
        <div className="products">{order.items.map(item => <Product key={item.itemId} item={item} />)}</div>
        <footer><span><Clock />{order.fulfillmentType === 'PICKUP' ? '自提' : '配送'} {time(order.plannedHandoffAt, true)}</span><span><Phone />{order.customer.phone}</span>{order.address && <span className="address"><MapPin />{order.address}</span>}<a className="text-button" href={`#/orders/${order.orderId}`}>查看订单详情 <ArrowRight /></a></footer>
      </article>)}</div>}
    </>}
  </>;
}
