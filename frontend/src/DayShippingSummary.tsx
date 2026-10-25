import { paymentListHref } from './paymentListRoute';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { PaymentSummary, PendingOrder } from './types';
import { ErrorNotice } from './ui';
import { dailyOperationalCounts, paymentSummaryKey, summaryAmount } from './shippingPayment';

export function DayShippingSummary({ date, canReadAmounts, orders }: { date: string; canReadAmounts: boolean; orders?: PendingOrder[] }) {
  const query = useQuery({ queryKey: paymentSummaryKey(date), enabled: canReadAmounts,
    queryFn: ({ signal }) => api<PaymentSummary>(`/orders/workbench/payment-summary?date=${date}`, { signal }) });
  const denied = query.error instanceof ApiError && query.error.status === 403;
  const summary = canReadAmounts && !denied ? query.data : undefined;
  const counts = canReadAmounts ? summary : orders ? dailyOperationalCounts(orders) : undefined;
  return <section className="panel shipping-summary" aria-label={`${date} 出货汇总`} aria-busy={canReadAmounts && query.isFetching}>
    <div className="section-heading"><h2>{Number(date.slice(5, 7))}月{Number(date.slice(8))}日出货汇总</h2><span className="summary-date-basis">按出货日</span></div>
    <dl className="shipping-counts"><div><dt>当日出货订单</dt><dd>{counts?.totalOrderCount ?? '—'} <span>笔</span></dd></div><div><dt>待配送</dt><dd>{counts?.waitingDeliveryOrderCount ?? '—'} <span>笔</span></dd></div></dl>
    {canReadAmounts && <><ErrorNotice error={query.error} retry={denied ? undefined : () => void query.refetch()} />
      {query.error && summary && <p className="notice" role="status">刷新失败，当前显示上次数据。</p>}
      {query.isPending && !query.error ? <div className="summary-skeleton" role="status">正在读取出货付款汇总…</div> : summary && <>
        <table className="payment-summary-table"><caption className="sr-only">所选出货日付款情况，金额为已填写订单金额合计</caption><thead><tr><th scope="col">当前付款状态</th><th scope="col">订单数</th><th scope="col">出货订单金额</th></tr></thead><tbody>
          {([['已付款', summary.paid], ['未付款', summary.unpaid]] as const).map(([label, group]) => <tr key={label}><th scope="row">{label}</th><td>{group.orderCount} 笔</td><td><strong>{summaryAmount(group)}</strong> <a className="text-button" href={paymentListHref(date, label === '已付款' ? 'SHIPPING_PAID' : 'SHIPPING_UNPAID', window.location.hash)}>查看明细</a>{group.missingAmountOrderCount > 0 && <small>{group.missingAmountOrderCount} 笔未报价，未计金额</small>}</td></tr>)}
        </tbody></table>{summary.totalOrderCount === 0 && <p className="form-help">当天暂无出货订单。</p>}
        {summary.paidWithoutDateOrderCount > 0 && <p className="summary-data-warning" role="note"><strong>付款日期待核对</strong>{summary.paidWithoutDateOrderCount} 笔已付款订单缺少付款时间，未计入当日付款订单。</p>}
      </>}
    </>}
    <p className="summary-source-note">全天出货订单，不含取消</p>
  </section>;
}
