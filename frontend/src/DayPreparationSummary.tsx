import { businessDate } from './dates';
import { groupCakeBases } from './cakeBaseSummary';
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readQuery } from './api';
import { ErrorNotice, Loading } from './ui';

interface CakeBaseSummary { date: string; items: { size: string | null; flavor: string; quantity: number }[] }
export function DayPreparationSummary({ date }: { date: string }) {
  const bases = useQuery({ queryKey: ['workbench', 'cake-bases', date],
    queryFn: ({ signal }) => readQuery<CakeBaseSummary>(`/orders/workbench/cake-bases?date=${date}`, signal) });
  return <div className="preparation-summaries">
    <section className="panel" aria-label="蛋糕胚统计"><h2>{businessDate(date)} 蛋糕胚统计</h2><ErrorNotice error={bases.error} retry={() => void bases.refetch()} />
      {bases.isPending ? <Loading /> : !bases.error && bases.data && (bases.data.items.length ? <table className="payment-summary-table"><thead><tr><th>尺寸</th><th>蛋糕胚口味</th><th>数量</th></tr></thead><tbody>{groupCakeBases(bases.data.items).map(group => <Fragment key={group.size ?? 'unknown'}><tr className="cake-base-subtotal"><th scope="rowgroup">{group.size === null ? '尺寸未填写' : `${group.size} 寸`}</th><td>合计</td><td><strong>{group.quantity} 个</strong></td></tr>{group.flavors.map(row => <tr key={row.flavor}><td>{group.size === null ? '尺寸未填写' : `${group.size} 寸`}</td><td>{row.flavor}</td><td>{row.quantity} 个</td></tr>)}</Fragment>)}</tbody></table> : <p>当天暂无蛋糕胚。</p>)}
    </section>
  </div>;
}
