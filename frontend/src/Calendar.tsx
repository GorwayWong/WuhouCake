import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CaretDown, CaretUp, ClipboardText, ShoppingBag, Truck, Clock, MapPin, Phone, Plus } from '@phosphor-icons/react';
import { api } from './api';
import { calendarRange, shiftDate, shiftMonth, time, today } from './dates';
import type { CalendarOrder, Workbench } from './types';
import { Empty, ErrorNotice, Loading, Payment, Product, Status } from './ui';
import { BatchOrderExport } from './OrderExports';
import { calendarStatusOptions, readCalendarFilters, writeCalendarFilters, matchesCalendarFilters } from './calendarFilters';
import { statusNames } from './orderStates';
import { exportOptions } from './exportFiles';
import { DateInput } from './DateInput';
import { Select } from './Select';
import { calendarOrderHref } from './routes';

type Mode = 'week' | 'month';
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
function DateBlock({ date, orders, selected, month, onSelect }: { date: string; orders: CalendarOrder[]; selected: string; month: boolean; onSelect: (date: string) => void }) {
  return <div className={`date-block ${date === selected ? 'selected' : ''} ${date.slice(0, 7) !== selected.slice(0, 7) && month ? 'outside-month' : ''}`}>
    <button className="date-select" aria-label={`选择 ${date}`} aria-pressed={date === selected} onClick={() => onSelect(date)}><span>{Number(date.slice(8))}</span>{date === today() && <small>今</small>}</button>
    <div className="date-orders">{orders.map(order => <a href={calendarOrderHref(month, date, order.orderId)} onClick={event => { if (month && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(date); } }} className="calendar-order" key={order.orderId}>
      <strong>{order.items.map(item => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join('、')}</strong>
      <span className="calendar-number">#{order.orderNo}</span><Status order={order} /><Payment status={order.paymentStatus} />
    </a>)}{!orders.length && <span className="no-orders" aria-label="无订单">—</span>}</div>
  </div>;
}
export function Calendar({ accountId, selected, setSelected, mode, setMode, onWritingChange }: { accountId: string; selected: string; setSelected: (date: string) => void; mode: Mode; setMode: (mode: Mode) => void; onWritingChange: (pending: boolean) => void }) {
  const [filters, setFilters] = useState(() => { try { return readCalendarFilters(accountId, localStorage); } catch { return { status: '', paymentStatus: '' }; } });
  const changeFilter = (key: 'status' | 'paymentStatus', value: string) => { const next = { ...filters, [key]: value }; setFilters(next); try { writeCalendarFilters(accountId, next, localStorage); } catch { /* Storage access may be denied. */ } };
  const range = calendarRange(selected, mode);
  const calendar = useQuery({ queryKey: ['calendar', range.from, range.to], queryFn: ({ signal }) => api<CalendarOrder[]>(`/orders/calendar?from=${range.from}&to=${range.to}`, { signal }) });
  const workbench = useQuery({ queryKey: ['workbench', selected], queryFn: ({ signal }) => api<Workbench>(`/orders/workbench?date=${selected}`, { signal }), enabled: mode === 'week' });
  const calendarScroll = useRef<HTMLDivElement>(null);
  const statuses = calendarStatusOptions(calendar.data || []);
  useEffect(() => {
    if (!calendar.data || calendar.isFetching || calendar.error || !filters.status || calendarStatusOptions(calendar.data).some(([code]) => code === filters.status)) return;
    setFilters(current => { const next = { ...current, status: '' }; try { writeCalendarFilters(accountId, next, localStorage); } catch { /* Preference storage may be unavailable. */ } return next; });
  }, [calendar.data, calendar.isFetching, calendar.error, filters.status, accountId]);
  useEffect(() => {
    const container = calendarScroll.current, current = container?.querySelector<HTMLElement>('.date-block.selected');
    if (!container || !current) return;
    const reveal = () => {
      const bounds = container.getBoundingClientRect(), day = current.getBoundingClientRect();
      container.scrollTo({ left: container.scrollLeft + day.left - bounds.left - (container.clientWidth - day.width) / 2, behavior: 'auto' });
    };
    reveal(); window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [selected, mode, calendar.isPending, Boolean(calendar.data)]);
  const sorted = (calendar.data || []).filter(order => matchesCalendarFilters(order, filters)).sort((a, b) => (Date.parse(a.plannedHandoffAt) - Date.parse(b.plannedHandoffAt)) || a.orderNo.localeCompare(b.orderNo));
  const daily = (workbench.data?.pendingOrders || []).filter(order => matchesCalendarFilters(order, filters));
  const changePeriod = (delta: number) => setSelected(mode === 'week' ? shiftDate(selected, delta * 7) : shiftMonth(selected, delta));
  return <>
    <div className="page-heading workbench-heading"><div><h1>{mode === 'week' ? '日历工作台' : '月历工作台'}</h1></div><div className="workbench-heading-actions">{(['status', 'paymentStatus'] as const).map(key => <label className="calendar-filter" key={key}>{key === 'status' ? '订单状态' : '付款状态'}<Select label={key === 'status' ? '订单状态' : '付款状态'} value={filters[key]} onChange={value => changeFilter(key, value)}><option value="">全部</option>{(key === 'status' ? statuses : Object.entries(exportOptions.paymentStatus)).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>)}<button className="secondary compact" onClick={() => setSelected(today())}>回到今天</button><a className="primary" href="#/orders/new"><Plus />新建订单</a></div></div>
    <BatchOrderExport selected={selected} onPendingChange={onWritingChange} />
    {(filters.status || filters.paymentStatus) && <p className="filter-summary">已筛选：{statusNames[filters.status] || '全部状态'} · {exportOptions.paymentStatus[filters.paymentStatus] || '全部付款'}<button type="button" className="text-button" onClick={() => { const next = { status: '', paymentStatus: '' }; setFilters(next); try { writeCalendarFilters(accountId, next, localStorage); } catch { /* Storage access may be denied. */ } }}>清除筛选</button></p>}
    <section className={`panel calendar-panel ${mode}`} aria-label={mode === 'week' ? '周历' : '月历'}>
      <div className="calendar-toolbar"><div className="period"><h2>{selected.slice(0, 4)} 年 {Number(selected.slice(5, 7))} 月</h2><label className="date-jump"><span className="sr-only">跳转日期</span><DateInput label="跳转日期" value={selected} onChange={value => { if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) setSelected(value); }} /></label></div><div className="period-actions"><button className="icon-button" aria-label={mode === 'week' ? '上一周' : '上个月'} onClick={() => changePeriod(-1)}><ArrowLeft /></button><button className="icon-button" aria-label={mode === 'week' ? '下一周' : '下个月'} onClick={() => changePeriod(1)}><ArrowRight /></button></div></div>
      <ErrorNotice error={calendar.error} retry={() => void calendar.refetch()} />
      {calendar.error && calendar.data && <p className="notice" role="status">日历刷新失败，以下为上次读取的内容，请重试更新。</p>}
      {calendar.isPending ? <Loading /> : !calendar.data ? null : <div className="calendar-scroll" ref={calendarScroll}><div className="calendar-weekdays">{weekdays.map(day => <span key={day}>周{day}</span>)}</div><div className="calendar-grid">{range.dates.map(date => <DateBlock key={date} date={date} selected={selected} month={mode === 'month'} onSelect={date => { setSelected(date); if (mode === 'month') { setMode('week'); window.location.hash = `#/?date=${date}`; } }} orders={sorted.filter(order => order.calendarDate === date)} />)}</div></div>}
      <button className="calendar-toggle" onClick={() => setMode(mode === 'week' ? 'month' : 'week')}>{mode === 'week' ? '展开本月日历' : `收起月历 · 查看 ${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(8))} 日订单`}{mode === 'week' ? <CaretDown /> : <CaretUp />}</button>
    </section>
    {mode === 'week' && <>
      <section className="metrics" aria-label="所选日期统计">{[
        { label: '当日筛选订单', value: workbench.data ? daily.length : undefined, Icon: ClipboardText },
        { label: '其中未付款', value: workbench.data ? daily.filter(o => o.paymentStatus === 'UNPAID').length : undefined, Icon: ShoppingBag },
        { label: '其中待配送', value: workbench.data ? daily.filter(o => o.status === 'WAITING_DELIVERY').length : undefined, Icon: Truck },
      ].map(({ label, value, Icon }) => <div className="metric" key={label}><span className="metric-icon"><Icon size={25} /></span><div><span>{label}</span><strong>{value ?? '—'}</strong></div></div>)}</section>
      <div className="section-heading"><h2>{Number(selected.slice(5, 7))} 月 {Number(selected.slice(8))} 日订单 <span>{workbench.data ? daily.length : '—'}</span></h2><span className="muted">按取货时间排序</span></div>
      <ErrorNotice error={workbench.error} retry={() => void workbench.refetch()} />
      {workbench.isPending ? <Loading /> : !workbench.data ? null : daily.length === 0 ? <Empty>{selected} 没有符合条件的订单。请核对订单的收货日期，并检查右上角记忆的状态和付款筛选。</Empty> : <div className="order-list">{[...daily].sort((a, b) => (Date.parse(a.plannedHandoffAt) - Date.parse(b.plannedHandoffAt)) || a.orderNo.localeCompare(b.orderNo)).map(order => <article className="panel order-card" key={order.orderId}>
        <header><a className="order-link" href={`#/orders/${order.orderId}`}><span>订单</span> #{order.orderNo}<ArrowRight size={17} /></a><div className="badges"><Status order={order} /><Payment status={order.paymentStatus} /></div></header>
        <div className="products">{order.items.map(item => <Product key={item.itemId} item={item} />)}</div>
        <footer><span><Clock />{order.fulfillmentType === 'PICKUP' ? '自提' : '配送'} {time(order.plannedHandoffAt, true)}</span><span><Phone />{order.customer.phone}</span>{order.address && <span className="address"><MapPin />{order.address}</span>}<a className="text-button" href={`#/orders/${order.orderId}`}>查看订单详情 <ArrowRight /></a></footer>
      </article>)}</div>}
    </>}
  </>;
}
