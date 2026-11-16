import { useQuery } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CaretDown, CaretUp, Plus } from '@phosphor-icons/react';
import { readQuery } from './api';
import { businessDate, calendarRange, today, weekStart, workbenchDate } from './dates';
import type { Account, CalendarOrder, Workbench } from './types';
import { ErrorNotice, Loading } from './ui';
import { allCalendarFilters, calendarStatusOptions, matchesCalendarFilters } from './calendarFilters';
import type { CalendarFilters } from './calendarFilters';
import { exportOptions } from './exportFiles';
import { DateInput } from './DateInput';
import { Select } from './Select';
import { calendarHref, overdueOrderCount, compareCalendarOrders, jumpCalendarDate, selectCalendarDate, shiftCalendarPeriod, toggleCalendarMode } from './calendarView';
import type { CalendarView, CreatedOrderFocus } from './calendarView';
import { OrderTimeline, resetTimelineGroups } from './OrderTimeline';
import { orderAccess } from './access';
import { useReturnScroll } from './returnScroll';
import { DayShippingSummary } from './DayShippingSummary';
import { DayPreparationSummary } from './DayPreparationSummary';
import { ProductionReminders } from './ProductionReminders';
import { visibleCalendarFilters } from './shippingPayment';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
function MonthDayCell({ date, orders, view, onSelect }: { date: string; orders: CalendarOrder[]; view: CalendarView; onSelect: (date: string) => void }) {
  const first = orders[0];
  const overdue = overdueOrderCount(date, orders, today());
  return <button type="button" className={`date-block ${overdue ? 'has-overdue' : ''} ${date === view.date ? 'selected' : ''} ${view.mode === 'month' && date.slice(0, 7) !== view.month ? 'outside-month' : ''}`}
    aria-label={`${date}${date === today() ? ' 今天' : ''}，${orders.length} 笔订单${overdue ? `，未完成 ${overdue} 单` : ''}`}
    aria-pressed={date === view.date} aria-current={date === today() ? 'date' : undefined}
    aria-expanded={view.mode === 'month' ? view.expanded && date === view.date : undefined}
    aria-controls={view.mode === 'month' ? `month-orders-${weekStart(date)}` : undefined} onClick={() => onSelect(date)}>
    <span className="date-select"><span>{Number(date.slice(8))}</span>{date === today() && <small>今</small>}</span>
    {overdue > 0 && <span className="date-overdue">未完成 {overdue} 单</span>}
    {view.mode === 'month' ? first && <span className="month-day-summary"><strong>{first.items[0]?.name || '订单'}</strong><span>{first.customerPhoneLast4}</span>{orders.length > 1 && <span className="month-more" aria-label={`还有 ${orders.length - 1} 笔订单`}>…</span>}</span>
      : <span className={`day-order-dot ${orders.length ? 'has-orders' : ''}`} aria-hidden="true" />}
  </button>;
}
export function Calendar({ account, view, onViewChange, filters, onFiltersChange, createdOrder, onCreatedOrderLocated }: {
  account: Account;
  view: CalendarView; onViewChange: (view: CalendarView) => void; filters: CalendarFilters;
  onFiltersChange: (filters: CalendarFilters) => void;
  createdOrder?: CreatedOrderFocus; onCreatedOrderLocated?: (orderId: string) => void;
}) {
  const { date: selected, mode } = view;
  const access = orderAccess(account);
  const effectiveFilters = visibleCalendarFilters(filters, access.amounts);
  const range = calendarRange(mode === 'month' ? `${view.month}-01` : selected, mode);
  const calendar = useQuery({ queryKey: ['calendar', range.from, range.to], queryFn: ({ signal }) => readQuery<CalendarOrder[]>(`/orders/calendar?from=${range.from}&to=${range.to}`, signal) });
  const workbench = useQuery({ queryKey: ['workbench', selected], queryFn: ({ signal }) => readQuery<Workbench>(`/orders/workbench?date=${selected}&includeMetrics=false`, signal), enabled: mode === 'week' || view.expanded });
  useReturnScroll(calendarHref(view), Boolean(calendar.data) && (!(mode === 'week' || view.expanded) || Boolean(workbench.data)), false, Boolean(createdOrder));
  const scrolledOrder = useRef<string | null>(null);
  const showCreatedOrder = useCallback((element: HTMLAnchorElement) => {
    if (!createdOrder || createdOrder.located || scrolledOrder.current === createdOrder.orderId) return;
    scrolledOrder.current = createdOrder.orderId;
    element.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    onCreatedOrderLocated?.(createdOrder.orderId);
  }, [createdOrder, onCreatedOrderLocated]);
  const statuses = calendarStatusOptions();
  const daily = (workbench.data?.pendingOrders || []).filter(order => !order.deletion && !order.deleted && matchesCalendarFilters(order, effectiveFilters));
  const ordersByDay = new Map<string, CalendarOrder[]>();
  for (const order of [...(calendar.data || [])].sort(compareCalendarOrders)) {
    const orders = ordersByDay.get(order.calendarDate) || [];
    orders.push(order); ordersByDay.set(order.calendarDate, orders);
  }
  const weeks = Array.from({ length: range.dates.length / 7 }, (_, index) => range.dates.slice(index * 7, index * 7 + 7));
  const calendarElement = useRef<HTMLDivElement>(null);
  const workbenchElement = useRef<HTMLDivElement>(null);
  const [reservedHeight, setReservedHeight] = useState<number | undefined>();
  const [resetVersion, setResetVersion] = useState(0);
  const [collapsedWeekDate, setCollapsedWeekDate] = useState<string | null>(null);
  const previousDate = useRef(selected);
  useLayoutEffect(() => {
    if (previousDate.current === selected) return;
    previousDate.current = selected;
    resetTimelineGroups(account.accountId, selected);
    setResetVersion(value => value + 1); setCollapsedWeekDate(null);
  }, [selected, account.accountId]);
  const scrollAnchor = useRef<{ date: string; top: number } | null>(null);
  const resetDay = (date: string) => { resetTimelineGroups(account.accountId, date); setResetVersion(value => value + 1); setCollapsedWeekDate(null); };
  const selectDate = (date: string) => {
    const row = calendarElement.current?.querySelector<HTMLElement>(`[data-week="${weekStart(date)}"]`);
    if (row) {
      scrollAnchor.current = { date, top: row.getBoundingClientRect().top };
      setReservedHeight(workbenchElement.current?.getBoundingClientRect().height);
    }
    resetDay(date); onViewChange(selectCalendarDate(view, date));
  };
  const jumpDate = (date: string) => {
    resetDay(date); scrollAnchor.current = { date, top: 16 };
    setReservedHeight(workbenchElement.current?.getBoundingClientRect().height);
    onViewChange(jumpCalendarDate(view, date));
  };
  const collapseMonthPanel = () => {
    calendarElement.current?.querySelector<HTMLButtonElement>('.date-block.selected')?.focus({ preventScroll: true });
    selectDate(selected);
  };
  useEffect(() => {
    const cancel = () => { scrollAnchor.current = null; setReservedHeight(undefined); };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchmove', cancel, { passive: true });
    const key = (event: KeyboardEvent) => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) cancel(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('wheel', cancel); window.removeEventListener('touchmove', cancel); window.removeEventListener('keydown', key); };
  }, []);
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (!anchor || anchor.date !== view.date) return;
    const ready = !(mode === 'week' || view.expanded) || !workbench.isPending;
    if (ready && reservedHeight !== undefined) { setReservedHeight(undefined); return; }
    const row = calendarElement.current?.querySelector<HTMLElement>(`[data-week="${weekStart(anchor.date)}"]`);
    if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
    if (ready) scrollAnchor.current = null;
  }, [view, mode, workbench.isPending, workbench.data, calendar.data, reservedHeight, resetVersion]);
  const changeFilters = (next: CalendarFilters) => { resetDay(selected); onFiltersChange(next); };
  const filtersControl = <div className="calendar-filters" aria-label="订单筛选"><span className="calendar-date-help">按取货日期显示订单</span>
    {((access.amounts ? ['status', 'paymentStatus'] : ['status']) as (keyof CalendarFilters)[]).map(key => <label className="calendar-filter" key={key}>{key === 'status' ? '订单状态' : '付款状态'}<Select label={key === 'status' ? '订单状态' : '付款状态'} value={effectiveFilters[key]} onChange={value => changeFilters({ ...filters, [key]: value })}><option value="">全部</option>{(key === 'status' ? statuses : Object.entries(exportOptions.paymentStatus)).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>)}
    {(effectiveFilters.status || effectiveFilters.paymentStatus) && <button type="button" className="text-button" onClick={() => changeFilters({ ...allCalendarFilters })}>清除筛选</button>}
  </div>;
  const timeline = <>
    <ErrorNotice error={workbench.error} retry={() => void workbench.refetch()} />
    {workbench.error && workbench.data && <p className="notice" role="status">订单刷新失败，以下为上次读取的内容，请重试更新。</p>}
    {workbench.isPending && !workbench.error ? <Loading /> : workbench.data ? <OrderTimeline key={`${selected}:${mode}:${effectiveFilters.status}:${resetVersion}`} orders={daily} view={view} account={account} status={effectiveFilters.status} createdOrderId={createdOrder?.orderId} onCreatedOrderVisible={showCreatedOrder} /> : null}
  </>;
  return <div className="calendar-workbench" ref={workbenchElement} style={{ minHeight: reservedHeight }}>
    {createdOrder && <div className="notice created-order-notice" role="status">订单 #{createdOrder.orderNo} 已创建，{createdOrder.located ? '已定位到' : '正在定位到'}{businessDate(createdOrder.date)}</div>}
    <div className="page-heading workbench-heading"><div className="workbench-heading-actions"><button type="button" className="secondary compact" onClick={() => jumpDate(today())}>回到今天</button>{access.entry && <a className="primary" href="#/orders/new"><Plus />新建订单</a>}</div></div>
    {access.productionView && <ProductionReminders account={account} view={view} />}
    <section className={`panel calendar-panel ${mode}`} aria-label={mode === 'week' ? '周历' : '月历'}>
      <div className="calendar-toolbar"><label className="date-jump"><span className="sr-only">跳转日期</span><DateInput label="跳转日期" value={selected} onChange={value => { if (value && workbenchDate(`#/?date=${value}`)) jumpDate(value); }} /></label><div className="period-actions"><button type="button" className="icon-button" aria-label={mode === 'week' ? '上一周' : '上个月'} onClick={() => onViewChange(shiftCalendarPeriod(view, -1))}><ArrowLeft /></button><button type="button" className="icon-button" aria-label={mode === 'week' ? '下一周' : '下个月'} onClick={() => onViewChange(shiftCalendarPeriod(view, 1))}><ArrowRight /></button></div></div>
      <ErrorNotice error={calendar.error} retry={() => void calendar.refetch()} />
      {calendar.error && calendar.data && <p className="notice" role="status">刷新失败，当前显示上次数据。</p>}
      <div className="calendar-scroll" ref={calendarElement}><div className="calendar-weekdays">{weekdays.map(day => <span key={day}>周{day}</span>)}</div><div className="calendar-weeks">{weeks.map(week => <Fragment key={week[0]}>
        <div className="calendar-grid" data-week={week[0]}>{week.map(date => <MonthDayCell key={date} date={date} orders={ordersByDay.get(date) || []} view={view} onSelect={selectDate} />)}</div>
        {mode === 'month' && <section id={`month-orders-${week[0]}`} className="month-expanded" aria-label={`${selected} 当日订单`} hidden={!view.expanded || !week.includes(selected)}>
          {view.expanded && week.includes(selected) && <><div className="section-heading"><h2>{businessDate(selected)} 订单 <span>{workbench.data ? daily.length : '—'}</span></h2><button type="button" className="text-button" onClick={collapseMonthPanel} aria-expanded="true" aria-controls={`month-orders-${week[0]}`}><CaretUp />收起</button></div>{filtersControl}{timeline}</>}
        </section>}
      </Fragment>)}</div></div>
      <button type="button" className="calendar-toggle" onClick={() => onViewChange(toggleCalendarMode(view))}>{mode === 'week' ? '展开本月日历' : '切换周历工作台'}{mode === 'week' ? <CaretDown /> : <CaretUp />}</button>
    </section>
    {mode === 'month' && !view.expanded && <div className="calendar-filter-bar">{filtersControl}</div>}
    {mode === 'week' && <>
      <div className="section-heading"><h2>{businessDate(selected)} 订单 <span>{workbench.data ? daily.length : '—'}</span></h2><button type="button" className="text-button" aria-expanded={collapsedWeekDate !== selected} aria-controls="week-day-orders" onClick={() => setCollapsedWeekDate(collapsedWeekDate === selected ? null : selected)}>{collapsedWeekDate === selected ? <CaretDown /> : <CaretUp />}{collapsedWeekDate === selected ? '展开当日订单' : '收起当日订单'}</button></div>
      <div id="week-day-orders" hidden={collapsedWeekDate === selected}>{filtersControl}{timeline}</div>
    </>}
    {(mode === 'week' || view.expanded) && <details className="panel daily-statistics">
      <summary>当日统计</summary>
      {!access.productionView && <DayShippingSummary date={selected} canReadAmounts={access.amounts} orders={workbench.data?.pendingOrders} />}
      <DayPreparationSummary date={selected} />
    </details>}
  </div>;
}
