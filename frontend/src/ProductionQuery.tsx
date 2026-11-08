import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { DateInput } from './DateInput';
import { businessDate, shiftDate, businessTime } from './dates';
import { orderStatusNames, productionStatuses } from './orderStates';
import { productionPreset, productionQueryHref, validProductionRange } from './productionQueryRoute';
import type { ProductionQueryRoute } from './productionQueryRoute';
import { orderHref } from './routes';
import { Select } from './Select';
import { Empty, ErrorNotice, Loading } from './ui';

interface ProductionSummary {
  total: number;
  unscheduled: number;
  days: { date: string; orderCount: number }[];
}
interface ProductionPage {
  page: number;
  total: number;
  orders: {
    orderId: string;
    orderNo: string;
    itemName: string | null;
    status: string;
    plannedFinishAt: string | null;
    pickupAt: string | null;
    pickupDate: string;
  }[];
}

export function ProductionQuery({ route }: { route: ProductionQueryRoute }) {
  const { from, through, stage, bucket, page } = route;
  const [draft, setDraft] = useState({ from, through, stage });
  const [invalidRange, setInvalidRange] = useState(false);
  const detailsSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (bucket) detailsSection.current?.focus();
  }, [bucket, page]);
  const summaryParams = new URLSearchParams({ from, to: shiftDate(through, 1) });
  const detailParams = new URLSearchParams({ page: String(page) });
  if (bucket === 'unscheduled') detailParams.set('unscheduled', 'true');
  else if (bucket) detailParams.set('date', bucket);
  if (stage) {
    summaryParams.set('stage', stage);
    detailParams.set('stage', stage);
  }
  const summary = useQuery({ queryKey: ['workbench', 'production-summary', from, through, stage],
    queryFn: ({ signal }) => api<ProductionSummary>(`/orders/workbench/production-summary?${summaryParams}`, { signal }) });
  const detail = useQuery({ queryKey: ['workbench', 'production-orders', bucket, stage, page], enabled: Boolean(bucket),
    queryFn: ({ signal }) => api<ProductionPage>(`/orders/workbench/production-orders?${detailParams}`, { signal }) });
  const detailPage = detail.data?.page;
  useEffect(() => {
    if (bucket && detailPage != null && detailPage !== page) {
      window.location.replace(productionQueryHref({ from, through, stage, bucket, page: detailPage }));
    }
  }, [bucket, detailPage, from, page, stage, through]);

  function apply(next: typeof draft) {
    const valid = validProductionRange(next.from, next.through);
    setInvalidRange(!valid);
    if (!valid) return;
    const href = productionQueryHref({ ...next, bucket: '', page: 1 });
    if (window.location.hash === href) void summary.refetch();
    else window.location.hash = href;
  }

  const buckets = summary.data ? [...summary.data.days, { date: 'unscheduled', orderCount: summary.data.unscheduled }] : [];
  return <div className="production-query">
    <div className="page-heading"><h1>待制作查询</h1></div>
    <form className="panel production-query-filters" onSubmit={event => { event.preventDefault(); apply(draft); }}>
      <div className="actions">
        {([7, 30] as const).map(days => <button key={days} type="button" className="secondary" onClick={() => {
          const next = { ...productionPreset(days), stage: draft.stage };
          setDraft(next);
          apply(next);
        }}>未来 {days} 天</button>)}
      </div>
      <div className="production-query-range">
        <label>开始日期<DateInput label="开始日期" value={draft.from} onChange={value => setDraft(current => ({ ...current, from: value }))} required /></label>
        <label>结束日期（含当天）<DateInput label="结束日期（含当天）" value={draft.through} onChange={value => setDraft(current => ({ ...current, through: value }))} required /></label>
      </div>
      <label>制作工序<Select label="制作工序" value={draft.stage} onChange={value => setDraft(current => ({ ...current, stage: value }))}>
        <option value="">全部工序</option>
        {productionStatuses.map(status => <option key={status} value={status}>{orderStatusNames[status]}</option>)}
      </Select></label>
      {invalidRange && <p className="notice error" role="alert">请选择有效的起止日期，范围最多 42 天。</p>}
      <button type="submit" className="primary">查询</button>
    </form>

    <section className="panel" aria-labelledby="production-count-heading">
      <h2 id="production-count-heading">按出品日统计</h2>
      <p className="form-help">按北京时间和整单计数。出品待定汇总全部未排期订单，单列展示。</p>
      <ErrorNotice error={summary.error} retry={() => void summary.refetch()} />
      {summary.isPending ? <Loading /> : summary.data && <>
        <p className="production-query-total">区间待制作 <strong>{summary.data.total}</strong> 笔</p>
        <ul className="production-query-days">{buckets.map(({ date, orderCount }) => <li key={date}>
          <a href={productionQueryHref({ ...route, bucket: date, page: 1 })}
            aria-current={bucket === date ? 'true' : undefined} className="production-query-day">
            <span>{date === 'unscheduled' ? '出品待定' : businessDate(date)}</span><strong>{orderCount} 笔</strong>
          </a>
        </li>)}</ul>
      </>}
    </section>

    {bucket && <section className="panel" aria-labelledby="production-detail-heading" tabIndex={-1} ref={detailsSection}>
      <h2 id="production-detail-heading">{bucket === 'unscheduled' ? '出品待定' : businessDate(bucket)}订单明细</h2>
      <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
      {detail.isPending ? <Loading /> : detail.data && (detail.data.total === 0 ? <Empty>暂无匹配订单。</Empty> : <>
        <p>共 {detail.data.total} 笔订单</p>
        <ul className="production-query-orders">{detail.data.orders.map(order => <li key={order.orderId}>
          <a href={orderHref(order.orderId, productionQueryHref({ ...route, page: detail.data.page }))}>
            <strong>{order.itemName || '未填写商品名称'}</strong><span>#{order.orderNo} · {orderStatusNames[order.status]}</span>
          </a>
          <dl>
            <div><dt>出品</dt><dd>{order.plannedFinishAt ? businessTime(order.plannedFinishAt) : '待定'}</dd></div>
            <div><dt>取货</dt><dd>{order.pickupAt ? businessTime(order.pickupAt) : `${businessDate(order.pickupDate)} · 时刻待定`}</dd></div>
          </dl>
        </li>)}</ul>
        <nav className="pagination" aria-label="待制作订单分页">
          {detail.data.page > 1 && <a href={productionQueryHref({ ...route, page: detail.data.page - 1 })}>上一页</a>}
          <span>第 {detail.data.page} / {Math.ceil(detail.data.total / 20)} 页</span>
          {detail.data.page * 20 < detail.data.total && <a href={productionQueryHref({ ...route, page: detail.data.page + 1 })}>下一页</a>}
        </nav>
      </>)}
    </section>}
  </div>;
}
