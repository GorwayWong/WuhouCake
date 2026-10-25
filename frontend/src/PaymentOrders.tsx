import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { api } from './api';
import { ErrorNotice, Loading } from './ui';
import { exactYuan } from './management';
import { time } from './dates';
import { displayedStatusCode, statusNames } from './orderStates';
import { orderHref } from './routes';
import { paymentKinds, paymentListHref } from './paymentListRoute';
import type { PaymentListRoute } from './paymentListRoute';
import { useReturnScroll } from './returnScroll';

interface PaymentOrder { orderId: string; orderNo: string; createdAt: string | null; calendarDate: string; paidAt: string | null; amountCents: string | null; paymentStatus: string; status: string; currentStageCode: string | null }
interface PaymentPage { page: number; total: number; orders: PaymentOrder[] }
export function PaymentOrders({ route }: { route: PaymentListRoute }) {
  const { date, kind, page, from } = route;
  const href = paymentListHref(date, kind, from, page);
  const query = useQuery({ queryKey: ['workbench', 'payment-orders', date, kind, page],
    queryFn: ({ signal }) => api<PaymentPage>(`/orders/workbench/payment-orders?date=${date}&kind=${kind}&page=${page}`, { signal }) });
  useEffect(() => {
    if (query.data && query.data.page !== page) window.location.replace(paymentListHref(date, kind, from, query.data.page));
  }, [query.data, date, kind, page, from]);
  useReturnScroll(href, Boolean(query.data));
  return <section className="panel">
    <a className="back-link" href={from}><ArrowLeft />返回工作台</a>
    <h1>{date} {paymentKinds[kind]}</h1>
    <p className="form-help">{kind === 'RECEIPT' ? '按付款时间，不限收货日期，含已取消订单。' : '按收货日期，不含已取消订单。'}金额为订单总额。</p>
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {query.isPending ? <Loading /> : query.data && <>
      <p>共 {query.data.total} 笔订单</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="付款订单明细，可左右滚动">
        <table className="management-table"><thead><tr><th>订单号</th><th>下单时间</th><th>客户收货日期</th><th>付款时间</th><th>订单总金额</th><th>付款状态</th><th>订单状态</th></tr></thead>
          <tbody>{query.data.orders.map(o => <tr key={o.orderId}><td><a href={orderHref(o.orderId, href)}>{o.orderNo}</a></td><td>{o.createdAt ? time(o.createdAt, true) : '—'}</td><td>{o.calendarDate}</td><td>{o.paidAt ? time(o.paidAt, true) : '未记录'}</td><td>{o.amountCents === null ? '未填写金额' : `¥${exactYuan(o.amountCents)}`}</td><td>{o.paymentStatus === 'PAID' ? '已付款' : '未付款'}</td><td>{statusNames[displayedStatusCode(o)]}</td></tr>)}</tbody>
        </table>
      </div>
      {!query.data.total && <p>暂无匹配订单。</p>}
      <nav className="pagination" aria-label="付款订单分页">
        {page > 1 && <a className="text-button" href={paymentListHref(date, kind, from, page - 1)}>上一页</a>}
        <span>第 {query.data.page} / {Math.max(1, Math.ceil(query.data.total / 10))} 页</span>
        {page * 10 < query.data.total && <a className="text-button" href={paymentListHref(date, kind, from, page + 1)}>下一页</a>}
      </nav>
    </>}
  </section>;
}
