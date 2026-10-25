import { groupCakeBases } from './cakeBaseSummary';
import { Fragment } from 'react';
import { paymentListHref } from './paymentListRoute';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ErrorNotice, Loading } from './ui';
import { exactYuan } from './management';

interface ReceiptSummary { date: string; orderCount: number; amountCents: string; missingAmountOrderCount: number }
interface CakeBaseSummary { date: string; items: { size: string | null; flavor: string; quantity: number }[] }
export function DayPreparationSummary({ date, canReadAmounts }: { date: string; canReadAmounts: boolean }) {
  const receipt = useQuery({ queryKey: ['workbench', 'receipt-summary', date], enabled: canReadAmounts,
    queryFn: ({ signal }) => api<ReceiptSummary>(`/orders/workbench/receipt-summary?date=${date}`, { signal }) });
  const bases = useQuery({ queryKey: ['workbench', 'cake-bases', date],
    queryFn: ({ signal }) => api<CakeBaseSummary>(`/orders/workbench/cake-bases?date=${date}`, { signal }) });
  return <div className="preparation-summaries">
    {canReadAmounts && <section className="panel receipt-summary" aria-label="按付款时间统计"><div className="section-heading"><h2>{Number(date.slice(5, 7))}月{Number(date.slice(8))}日付款订单</h2><span className="summary-date-basis">按付款时间</span></div>
      <ErrorNotice error={receipt.error} retry={() => void receipt.refetch()} />{receipt.isPending ? <Loading /> : !receipt.error && receipt.data && <><span className="receipt-amount-label">订单总额</span><strong className="receipt-amount">¥{exactYuan(receipt.data.amountCents)}</strong><p>{receipt.data.orderCount} 笔</p><a className="text-button" href={paymentListHref(date, 'RECEIPT', window.location.hash)}>查看明细</a>{receipt.data.orderCount === 0 && <p className="receipt-empty">当天暂无付款订单。</p>}{receipt.data.missingAmountOrderCount > 0 && <p className="form-help">{receipt.data.missingAmountOrderCount} 笔未报价，未计金额</p>}</>}
      <p className="summary-source-note">不限收货日期，含已取消订单</p>
    </section>}
    <section className="panel" aria-label="蛋糕胚统计"><h2>{date} 蛋糕胚统计</h2><ErrorNotice error={bases.error} retry={() => void bases.refetch()} />
      {bases.isPending ? <Loading /> : !bases.error && bases.data && (bases.data.items.length ? <table className="payment-summary-table"><thead><tr><th>尺寸</th><th>蛋糕胚口味</th><th>数量</th></tr></thead><tbody>{groupCakeBases(bases.data.items).map(group => <Fragment key={group.size ?? 'unknown'}><tr className="cake-base-subtotal"><th scope="rowgroup">{group.size === null ? '尺寸未填写' : `${group.size} 寸`}</th><td>合计</td><td><strong>{group.quantity} 个</strong></td></tr>{group.flavors.map(row => <tr key={row.flavor}><td>{group.size === null ? '尺寸未填写' : `${group.size} 寸`}</td><td>{row.flavor}</td><td>{row.quantity} 个</td></tr>)}</Fragment>)}</tbody></table> : <p>当天暂无蛋糕胚。</p>)}
    </section>
  </div>;
}
