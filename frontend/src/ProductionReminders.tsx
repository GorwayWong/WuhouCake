import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { readQuery } from './api';
import type { CalendarView } from './calendarView';
import type { Account, PendingOrder } from './types';
import { OrderSummaryCard } from './OrderTimeline';
import { Empty, ErrorNotice, Loading } from './ui';

const groups = [['today', '今日出品'], ['overdue', '逾期未完成']] as const;
type Group = (typeof groups)[number][0];
type OpenGroups = Partial<Record<Group, number>>;
interface Counts { date: string; today: number; overdue: number }
interface ReminderPage { date: string; page: number; total: number; orders: PendingOrder[] }
const remembered = new Map<string, OpenGroups>();
const refreshInterval = 60_000;
const pageSize = 20;

function ReminderOrders({ group, page, account, view, onPage }: {
  group: Group; page: number; account: Account; view: CalendarView; onPage: (page: number) => void;
}) {
  const query = useQuery({
    queryKey: ['workbench', 'production-reminder-orders', account.accountId, group, page], gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => readQuery<ReminderPage>(`/orders/workbench/production-reminder-orders?group=${group}&page=${page}`, signal),
    refetchInterval: refreshInterval,
  });
  const actualPage = query.data?.page;
  const canCorrectPage = query.isFetchedAfterMount && query.isSuccess && !query.isFetching;
  useEffect(() => {
    if (canCorrectPage && actualPage != null && actualPage !== page) onPage(actualPage);
  }, [canCorrectPage, actualPage, page, onPage]);
  const result = actualPage === page ? query.data : undefined;
  const lastPage = result ? Math.ceil(result.total / pageSize) : 0;
  return <div className="reminder-orders" aria-busy={query.isFetching}>
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {(query.isPending || (!result && !query.isError)) && <Loading />}
    {result && (result.orders.length ? result.orders.map(order =>
      <OrderSummaryCard key={order.orderId} order={order} view={view} account={account} showFinishTime />)
      : <Empty>{group === 'today' ? '今天没有待出品的订单。' : '暂无逾期订单。'}</Empty>)}
    {result && lastPage > 1 && <div className="actions reminder-pages" aria-label="制作提醒分页">
      <button type="button" className="secondary compact" disabled={query.isFetching || result.page === 1} onClick={() => onPage(result.page - 1)}>上一页</button>
      <span>第 {result.page} / {lastPage} 页</span>
      <button type="button" className="secondary compact" disabled={query.isFetching || result.page === lastPage} onClick={() => onPage(result.page + 1)}>下一页</button>
    </div>}
  </div>;
}

export function ProductionReminders({ account, view }: { account: Account; view: CalendarView }) {
  const [opened, setOpened] = useState<OpenGroups>(() => remembered.get(account.accountId) || {});
  const counts = useQuery({
    queryKey: ['workbench', 'production-reminders', account.accountId],
    queryFn: ({ signal }) => readQuery<Counts>('/orders/workbench/production-reminders', signal),
    refetchInterval: refreshInterval,
  });
  function setGroup(group: Group, page?: number) {
    const next = { ...opened, [group]: page };
    remembered.set(account.accountId, next);
    setOpened(next);
  }
  return <section className="panel production-reminders" aria-label="制作提醒">
    <ErrorNotice error={counts.error} retry={() => void counts.refetch()} />
    {groups.map(([group, label]) => {
      const page = opened[group];
      const count = counts.data?.[group];
      const contentId = `production-reminder-${group}`;
      return <div key={group}>
        <button type="button" className={`secondary reminder-toggle${group === 'overdue' && count ? ' reminder-overdue' : ''}`}
          aria-expanded={Boolean(page)} aria-controls={contentId} onClick={() => setGroup(group, page ? undefined : 1)}>
          <strong>{label}</strong><span>{count === undefined ? '—' : `${count} 单`}{page ? <CaretUp /> : <CaretDown />}</span>
        </button>
        <div id={contentId} hidden={!page}>
          {page && <ReminderOrders group={group} page={page} account={account} view={view} onPage={value => setGroup(group, value)} />}
        </div>
      </div>;
    })}
  </section>;
}
