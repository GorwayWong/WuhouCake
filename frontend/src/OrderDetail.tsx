import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cake, CheckCircle, Clock, NotePencil, ListBullets, Package, Stack, Truck, XCircle } from '@phosphor-icons/react';
import { api } from './api';
import { synchronize } from './realtime';
import type { Activity, Detail, Page } from './types';
import { time } from './dates';
import { Empty, ErrorNotice, Loading, money, Payment, Product, Status, statusNames, valueText } from './ui';

const actionNames: Record<string, string> = { START_PRODUCTION: '开始制作', COMPLETE_LAYER: '确认整单夹层', COMPLETE_FROSTING: '确认整单抹面', COMPLETE_PRODUCTION: '整单制作完成', REOPEN_PRODUCTION: '重新制作', START_DELIVERY: '开始配送', COMPLETE_DELIVERY: '完成配送', CONFIRM_PICKUP: '确认自提' };
const activityNames: Record<string, string> = { CREATED: '创建订单', ITEM_CHANGED: '修改商品', NOTE: '添加备注', PAYMENT_STATUS_CHANGED: '更新付款状态', ORDER_PRODUCTION_CHANGED: '更新整单制作', ORDER_FULFILLMENT_CHANGED: '更新交付状态', ORDER_CANCELLED: '取消订单', ORDER_INFORMATION_CHANGED: '修改订单信息', ITEM_ADDED: '添加商品', ITEM_REMOVED: '移除商品' };
const fieldNames: Record<string, string> = { status: '订单状态', currentStageCode: '制作阶段', paymentStatus: '付款状态', customer: '客户', fulfillment: '交付', customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '下单人', type: '方式', address: '地址', requestedReceiveDate: '收货日期', plannedHandoffAt: '交付时间', plannedFinishAt: '出品时间', name: '商品名称', quantity: '数量', attributes: '商品要求', totalAmountCents: '订单金额（分）', unitPriceCents: '单价（分）', memberPriceCents: '会员价（分）', productionStatus: '制作状态', productType: '商品类型' };
function changeValue(value: unknown): string {
  if (value === null) return '未填写';
  if (Array.isArray(value)) return value.map(changeValue).join('、');
  if (typeof value === 'string') return statusNames[value] || ({ PAID: '已付款', UNPAID: '未付款', DELIVERY: '配送', PICKUP: '自提' } as Record<string, string>)[value] || value;
  if (typeof value === 'object' && value) return Object.entries(value).map(([key, val]) => `${fieldNames[key] || key}：${changeValue(val)}`).join('；');
  return valueText(value);
}
function activityDescription(activity: Activity) {
  const details = activity.details || {};
  const text = typeof details.action === 'string' ? actionNames[details.action] : undefined;
  return <>{text && <p>{text}</p>}{activity.content && <p>{activity.content}</p>}{details.before != null && <p className="muted">原：{changeValue(details.before)}</p>}{details.after != null && <p>现：{changeValue(details.after)}</p>}</>;
}
function useActivities(id: string, type?: string) {
  return useInfiniteQuery({
    queryKey: ['order', id, 'activities', type || 'all'], initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => api<Page<Activity>>(`/orders/${id}/activities?page=${pageParam}&size=20${type ? `&type=${type}` : ''}`, { signal }),
    getNextPageParam: last => last.page * last.size < last.total ? last.page + 1 : undefined,
  });
}
function ActivityFeed({ id, type, items }: { id: string; type?: string; items: Detail['items'] }) {
  const query = useActivities(id, type);
  return <><ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending ? <Loading /> : <ol className="activity-feed">{query.data?.pages.flatMap(page => page.items).map(activity => <li key={activity.id}><span className="activity-dot" /><div><div className="note-meta"><strong>{activity.actorNameSnapshot}</strong><span>{activityNames[activity.type] || activity.type}</span><time dateTime={activity.createdAt}>{time(activity.createdAt, true)}</time></div><span className="scope">{activity.itemId ? items.find(item => item.itemId === activity.itemId)?.name || '历史商品' : '整张订单'}</span>{activityDescription(activity)}</div></li>)}</ol>}{query.data?.pages[0].total === 0 && <p className="muted">暂无记录</p>}{query.hasNextPage && <button className="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? '读取中…' : '加载更早记录'}</button>}</>;
}

function OrderProgress({ order }: { order: Detail }) {
  if (order.status === 'CANCELLED') return <div className="progress-cancelled" role="status"><XCircle size={25} />订单已取消，制作与交付流程已终止。</div>;
  const layerConfirmed = ['LAYER_DONE', 'FROSTING_DONE'].includes(order.currentStageCode || '');
  const frostingConfirmed = order.currentStageCode === 'FROSTING_DONE';
  const pickup = order.fulfillment.type === 'PICKUP';
  const steps = [
    { key: 'WAITING_PRODUCTION', label: '待制作', Icon: Clock },
    { key: 'PROCESSING', label: '制作中', Icon: Cake },
    { key: 'LAYER_DONE', label: layerConfirmed ? '已夹层' : '夹层', Icon: Stack, confirmed: layerConfirmed },
    { key: 'FROSTING_DONE', label: frostingConfirmed ? '已抹面' : '抹面', Icon: Cake, confirmed: frostingConfirmed },
    { key: pickup ? 'WAITING_PICKUP' : 'WAITING_DELIVERY', label: pickup ? '待自提' : '待配送', Icon: pickup ? Package : Truck },
    ...(!pickup ? [{ key: 'DELIVERING', label: '配送中', Icon: Truck }] : []),
    { key: 'COMPLETED', label: '已完成', Icon: CheckCircle },
  ];
  const current = steps.findIndex(step => step.key === (order.status === 'PROCESSING' ? order.currentStageCode || order.status : order.status));
  return <ol className="order-progress" aria-label="整单状态进度">{steps.map(({ key, label, Icon, ...step }, index) => {
    // 进度位置不能证明夹层或抹面已确认，制作完成允许跳过这两个记录。
    const state = index === current ? 'current' : index > current ? 'pending' : 'confirmed' in step && !step.confirmed ? 'unrecorded' : 'done';
    return <li key={key} className={`progress-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="progress-icon"><Icon size={22} aria-hidden="true" /></span><span className="progress-label">{label}</span>
      <small>{state === 'current' ? '当前' : state === 'unrecorded' ? '未记录' : <span className="sr-only">{state === 'done' ? '已完成' : '未到达'}</span>}</small>
    </li>;
  })}</ol>;
}

export function OrderDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['order', id, 'detail'], queryFn: ({ signal }) => api<Detail>(`/orders/${id}`, { signal }) });
  const [note, setNote] = useState('');
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [message, setMessage] = useState('');
  const mutation = useMutation({
    mutationFn: ({ path, body, method = 'POST' }: { path: string; body: unknown; method?: string }) => api(`/orders/${id}/${path}`, { method, body }),
    onSuccess: (_, variables) => {
      setMessage(variables.path === 'notes' ? '备注已发布' : '订单已更新');
      if (variables.path === 'notes') { setNote(''); }
      if (variables.path === 'cancel') { setReason(''); setShowCancel(false); }
      synchronize(client, id);
    },
    onError: () => { setMessage(''); synchronize(client, id); },
  });
  if (detail.isPending) return <Loading />;
  if (!detail.data) return <><a className="back-link" href="#"><ArrowLeft />返回工作台</a><ErrorNotice error={detail.error} retry={() => void detail.refetch()} /></>;
  const order = detail.data;
  const production = order.status === 'WAITING_PRODUCTION' ? ['START_PRODUCTION'] : order.status === 'PROCESSING'
    ? [...(!order.currentStageCode ? ['COMPLETE_LAYER'] : order.currentStageCode === 'LAYER_DONE' ? ['COMPLETE_FROSTING'] : []), 'COMPLETE_PRODUCTION']
    : ['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(order.status) ? ['REOPEN_PRODUCTION'] : [];
  const fulfillment = order.status === 'WAITING_DELIVERY' ? 'START_DELIVERY' : order.status === 'DELIVERING' ? 'COMPLETE_DELIVERY' : order.status === 'WAITING_PICKUP' ? 'CONFIRM_PICKUP' : null;
  const mutateAction = (action: string, path: string) => mutation.mutate({ path, body: { expectedVersion: order.version, action } });
  return <div className="detail-page">
    <a className="back-link" href="#"><ArrowLeft />返回工作台</a>
    <div className="page-heading"><div><p className="eyebrow">订单 #{order.orderNo}</p><h1>订单详情</h1></div><div className="badges"><Status order={order} /><Payment status={order.paymentStatus} /></div></div>
    <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    <section className="panel detail-status"><div className="section-heading"><h2><Clock />整单制作与交付</h2><span className="muted">{order.items.length} 件商品，统一确认</span></div>
      <OrderProgress order={order} />
      <div className="current-status"><Status order={order} /><span>{order.fulfillment.type === 'PICKUP' ? '门店自提' : '配送上门'} · {order.fulfillment.requestedReceiveDate} {time(order.fulfillment.plannedHandoffAt)}</span></div>
      <div className="actions">{production.map(action => <button key={action} className={action === 'REOPEN_PRODUCTION' ? 'secondary' : 'primary'} disabled={mutation.isPending} onClick={() => mutateAction(action, 'production-actions')}>{actionNames[action]}<ArrowRight /></button>)}{fulfillment && <button className="primary" disabled={mutation.isPending} onClick={() => mutateAction(fulfillment, 'fulfillment-actions')}>{actionNames[fulfillment]}<ArrowRight /></button>}</div>
      <details className="timeline"><summary>制作活动历史</summary><ActivityFeed id={id} type="ORDER_PRODUCTION_CHANGED" items={order.items} /></details>
    </section>
    <div className="detail-columns"><section className="panel"><h2>客户与交付</h2><dl className="info-grid">
      <div><dt>客户姓名</dt><dd>{order.customer.customerName || '未填写'}</dd></div><div><dt>联系电话</dt><dd><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a></dd></div>
      <div><dt>会员手机</dt><dd>{order.customer.memberPhone || '未填写'}</dd></div><div><dt>下单人</dt><dd>{order.customer.buyerName || '未填写'}</dd></div>
      <div><dt>收货日期</dt><dd>{order.fulfillment.requestedReceiveDate}</dd></div><div><dt>计划交付</dt><dd>{time(order.fulfillment.plannedHandoffAt, true)}</dd></div>
      <div><dt>计划出品</dt><dd>{time(order.fulfillment.plannedFinishAt, true)}</dd></div><div><dt>下单时间</dt><dd>{time(order.createdAt, true)}</dd></div>
      <div className="wide"><dt>{order.fulfillment.type === 'PICKUP' ? '交付方式' : '配送地址'}</dt><dd>{order.fulfillment.type === 'PICKUP' ? '门店自提' : order.fulfillment.address}</dd></div>
    </dl></section><section className="panel payment-panel"><h2>金额与付款</h2><p className="muted">订单金额</p><strong className="order-amount">{money(order.totalAmountCents)}</strong><Payment status={order.paymentStatus} /><button className="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: 'payment-status', method: 'PATCH', body: { expectedVersion: order.version, paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' } })}>{order.paymentStatus === 'PAID' ? '改为未付款' : '确认已付款'}</button></section></div>
    <section className="panel"><div className="section-heading"><h2>全部商品</h2><span className="muted">共 {order.items.length} 件</span></div><div className="products detail-products">{order.items.map(item => <Product key={item.itemId} item={item} prices />)}</div></section>
    <section className="panel"><h2><NotePencil />备注</h2><form className="note-form" onSubmit={event => { event.preventDefault(); if (note.trim()) mutation.mutate({ path: 'notes', body: { itemId: itemId || null, content: note.trim() } }); }}>
      <label>备注对象<select value={itemId} onChange={event => setItemId(event.target.value)} disabled={mutation.isPending}><option value="">整张订单</option>{order.items.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}{itemId && !order.items.some(item => item.itemId === itemId) && <option value={itemId}>已移除的商品，请重新选择</option>}</select></label>
      <label className="note-content">备注内容<textarea placeholder="记录客户的心意，或交接给下一位同事…" value={note} onChange={event => setNote(event.target.value)} required disabled={mutation.isPending} rows={3} /></label>
      <button className="primary" disabled={mutation.isPending || !note.trim() || Boolean(itemId && !order.items.some(item => item.itemId === itemId))}>发布备注<ArrowRight /></button>
    </form><ActivityFeed id={id} type="NOTE" items={order.items} /></section>
    <section className="panel"><h2><ListBullets />修改日志</h2><ActivityFeed id={id} items={order.items} /></section>
    <div className="feedback" aria-live="polite">{message && <div className="notice success"><CheckCircle />{message}<button type="button" className="text-button" aria-label="关闭操作提示" onClick={() => setMessage('')}>关闭</button></div>}<ErrorNotice error={mutation.error} /></div>
    {!['COMPLETED', 'CANCELLED'].includes(order.status) && <section className="cancel-section"><button className="text-button danger" onClick={() => setShowCancel(!showCancel)} aria-expanded={showCancel}>取消订单</button>{showCancel && <form onSubmit={event => { event.preventDefault(); mutation.mutate({ path: 'cancel', body: { expectedVersion: order.version, reason: reason.trim() } }); }}><label>取消原因<input value={reason} onChange={event => setReason(event.target.value)} required disabled={mutation.isPending} /></label><button className="danger-button" disabled={mutation.isPending || !reason.trim()}>确认取消订单</button></form>}</section>}
    {order.status === 'CANCELLED' && <Empty>订单已取消，仍可查看历史记录和记录备注。</Empty>}
  </div>;
}
