import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cake, CheckCircle, Clock, NotePencil, ListBullets, Package, Plus, Stack, Trash, Truck, XCircle } from '@phosphor-icons/react';
import { api } from './api';
import { synchronize } from './realtime';
import type { Activity, Detail, Page } from './types';
import { time } from './dates';
import { Empty, ErrorNotice, Loading, money, Payment, Product, Status, statusNames, valueText } from './ui';
import { InformationEdit, InformationSummary } from './InformationEdit';
import { ItemEdit } from './ItemEdit';
import { canEditItems, canRemoveItem } from './orderForm';
import { OrderImages } from './OrderImages';
import { SingleOrderExport } from './OrderExports';
import { exportActivitySummary } from './exportFiles';

const actionNames: Record<string, string> = { START_PRODUCTION: '开始制作', COMPLETE_LAYER: '确认整单夹层', COMPLETE_FROSTING: '确认整单抹面', COMPLETE_PRODUCTION: '整单制作完成', REOPEN_PRODUCTION: '重新制作', START_DELIVERY: '开始配送', COMPLETE_DELIVERY: '完成配送', CONFIRM_PICKUP: '确认自提' };
const activityNames: Record<string, string> = { CREATED: '创建订单', ITEM_CHANGED: '修改商品', NOTE: '添加备注', PAYMENT_STATUS_CHANGED: '更新付款状态', ORDER_PRODUCTION_CHANGED: '更新整单制作', ORDER_FULFILLMENT_CHANGED: '更新交付状态', ORDER_CANCELLED: '取消订单', ORDER_INFORMATION_CHANGED: '修改订单信息', ITEM_ADDED: '添加商品', ITEM_REMOVED: '移除商品', IMAGE_ADDED: '添加参考图片', IMAGE_REMOVED: '移除参考图片', ORDER_EXPORTED: '导出订单' };
const fieldNames: Record<string, string> = { status: '订单状态', currentStageCode: '制作阶段', paymentStatus: '付款状态', customer: '客户', fulfillment: '交付', customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '客户侧下单人', creditedEmployeeId: '下单员工 ID', creditedEmployeeName: '下单员工', type: '方式', address: '地址', requestedReceiveDate: '收货日期', plannedHandoffAt: '交付时间', plannedFinishAt: '出品时间', name: '商品名称', quantity: '数量', attributes: '商品要求', totalAmountCents: '订单金额（分）', unitPriceCents: '单价（分）', memberPriceCents: '会员价（分）', productionStatus: '制作状态', productType: '商品类型' };
function changeValue(value: unknown): string {
  if (value === null) return '未填写';
  if (Array.isArray(value)) return value.map(changeValue).join('、');
  if (typeof value === 'string') return statusNames[value] || ({ PAID: '已付款', UNPAID: '未付款', DELIVERY: '配送', PICKUP: '自提' } as Record<string, string>)[value] || value;
  if (typeof value === 'object' && value) return Object.entries(value).filter(([key]) => key !== 'creditedEmployeeId' || !Object.hasOwn(value, 'creditedEmployeeName')).map(([key, val]) => `${fieldNames[key] || key}：${changeValue(val)}`).join('；');
  return valueText(value);
}
function activityDescription(activity: Activity) {
  const details = activity.details || {};
  if (activity.type === 'ORDER_EXPORTED') return <div className="export-activity">{exportActivitySummary(details).map(line => <p key={line}>{line}</p>)}</div>;
  const text = typeof details.action === 'string' ? actionNames[details.action] : undefined;
  const imageActivity = ['IMAGE_ADDED', 'IMAGE_REMOVED'].includes(activity.type);
  return <>{text && <p>{text}</p>}{activity.content && !imageActivity && <p>{activity.content}</p>}{typeof details.filename === 'string' && <p>{details.filename}</p>}{details.before != null && <p className="muted">原：{changeValue(details.before)}</p>}{details.after != null && <p>现：{changeValue(details.after)}</p>}</>;
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

export function OrderDetail({ id, onEditDirtyChange, onWritingChange }: { id: string; onEditDirtyChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['order', id, 'detail'], queryFn: ({ signal }) => api<Detail>(`/orders/${id}`, { signal }) });
  const [note, setNote] = useState('');
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ kind: 'information' | 'item'; order: Detail; itemId?: string; reopened?: Detail } | null>(null);
  const [imageDraft, setImageDraft] = useState(false);
  const [imageWriting, setImageWriting] = useState(false);
  const [exportWriting, setExportWriting] = useState(false);
  const imageDraftChange = useCallback((dirty: boolean) => { setImageDraft(dirty); onEditDirtyChange(dirty); }, [onEditDirtyChange]);
  const imageWritingChange = useCallback((pending: boolean) => { setImageWriting(pending); onWritingChange(pending); }, [onWritingChange]);
  const exportWritingChange = useCallback((pending: boolean) => { setExportWriting(pending); onWritingChange(pending); }, [onWritingChange]);
  const activities = useActivities(id);
  const page = useRef<object | null>(null);
  useEffect(() => {
    page.current = {};
    return () => { page.current = null; onWritingChange(false); };
  }, [onWritingChange]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ path, body, method = 'POST' }: { path: string; body: unknown; method?: string }) => {
      if (path === 'notes') { await api(`/orders/${id}/${path}`, { method, body }); return null; }
      return api<Detail>(`/orders/${id}${path ? `/${path}` : ''}`, { method, body });
    },
    onMutate: () => {
      if (!page.current) throw new DOMException('Aborted', 'AbortError');
      onWritingChange(true); setMessage('');
      return { page: page.current, previous: client.getQueryData<Detail>(['order', id, 'detail']) };
    },
    onSuccess: async (updated, variables, context) => {
      if (context?.page !== page.current) return;
      const previous = context.previous;
      if (updated) {
        await client.cancelQueries({ queryKey: ['order', id, 'detail'], exact: true });
        if (context.page !== page.current) return;
        client.setQueryData<Detail>(['order', id, 'detail'], current => current && current.version > updated.version ? current : updated);
      }
      const clearedStages = previous?.version === (variables.body as { expectedVersion?: number }).expectedVersion && ['LAYER_DONE', 'FROSTING_DONE'].includes(previous?.currentStageCode || '') && updated?.status === 'PROCESSING' && !updated.currentStageCode;
      setMessage(variables.path === '' ? '商品已保存，请制作同事复核最新规格与数量。' : variables.path === 'items' ? `商品已添加，请制作同事复核。${clearedStages ? '整单已确认制作节点已清空，请重新核对制作进度。' : ''}` : variables.path.endsWith('/remove') ? '商品已移除，历史记录已保留，请制作同事复核有效商品。' : variables.path === 'notes' ? '备注已发布' : variables.path === 'information' ? '订单资料已保存' : variables.path === 'payment-status' ? `付款状态已更新为${updated?.paymentStatus === 'PAID' ? '已付款' : '未付款'}` : variables.path === 'cancel' ? '订单已取消' : `${actionNames[(variables.body as { action: string }).action]}已确认`);
      if (updated && variables.path === 'production-actions' && (variables.body as { action: string }).action === 'REOPEN_PRODUCTION') {
        setEditing(current => current?.kind === 'item' ? { ...current, reopened: updated } : current);
      }
      if (['information', '', 'items'].includes(variables.path)) setEditing(null);
      if (variables.path === 'notes') { setNote(''); }
      if (variables.path === 'cancel') { setReason(''); setShowCancel(false); }
      await synchronize(client, id);
    },
    onError: async (_error, _variables, context) => { if (context?.page === page.current) { setMessage(''); await synchronize(client, id); } },
    onSettled: (_result, _error, _variables, context) => { if (context?.page === page.current) onWritingChange(false); },
  });
  if (detail.isPending) return <Loading />;
  if (!detail.data) return <><a className="back-link" href="#"><ArrowLeft />返回工作台</a><ErrorNotice error={detail.error} retry={() => void detail.refetch()} /></>;
  const order = detail.data;
  const removedDraft = editing?.kind === 'item' && editing.itemId && !order.items.some(item => item.itemId === editing.itemId) ? editing.order.items.find(item => item.itemId === editing.itemId) : undefined;
  const visibleItems = removedDraft ? [...order.items, removedDraft] : order.items;
  const blocked = mutation.isPending || Boolean(editing) || imageDraft || imageWriting || exportWriting;
  const itemChange = activities.data?.pages.flatMap(page => page.items).find(activity => ['ITEM_CHANGED', 'ITEM_ADDED', 'ITEM_REMOVED'].includes(activity.type));
  const itemMutation = mutation.variables?.path === '' || mutation.variables?.path === 'items' || mutation.variables?.path.endsWith('/remove');
  const cancelEdit = () => { if (!mutation.isPending) { setEditing(null); mutation.reset(); } };
  const itemEditor = editing?.kind === 'item' ? <ItemEdit initial={editing.order} itemId={editing.itemId} latest={order} reopened={editing.reopened} busy={mutation.isPending} error={mutation.error} onDirtyChange={onEditDirtyChange} onSave={request => mutation.mutateAsync({ path: 'item' in request ? 'items' : '', method: 'item' in request ? 'POST' : 'PATCH', body: request })} onCancel={cancelEdit} /> : null;
  const production = order.status === 'WAITING_PRODUCTION' ? ['START_PRODUCTION'] : order.status === 'PROCESSING'
    ? [...(!order.currentStageCode ? ['COMPLETE_LAYER'] : order.currentStageCode === 'LAYER_DONE' ? ['COMPLETE_FROSTING'] : []), 'COMPLETE_PRODUCTION']
    : ['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(order.status) ? ['REOPEN_PRODUCTION'] : [];
  const fulfillment = order.status === 'WAITING_DELIVERY' ? 'START_DELIVERY' : order.status === 'DELIVERING' ? 'COMPLETE_DELIVERY' : order.status === 'WAITING_PICKUP' ? 'CONFIRM_PICKUP' : null;
  const mutateAction = (action: string, path: string) => mutation.mutate({ path, body: { expectedVersion: order.version, action } });
  return <div className="detail-page">
    <a className="back-link" href="#" aria-disabled={mutation.isPending || imageWriting || exportWriting} onClick={event => { if (mutation.isPending || imageWriting || exportWriting) event.preventDefault(); }}><ArrowLeft />返回工作台</a>
    <div className="page-heading"><div><p className="eyebrow">订单 #{order.orderNo}</p><h1>订单详情</h1></div><div className="badges"><Status order={order} /><Payment status={order.paymentStatus} /></div></div>
    <SingleOrderExport orderId={id} orderNo={order.orderNo} blocked={blocked} onPendingChange={exportWritingChange} />
    <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    <div className="feedback" aria-live="polite">{message && (!itemMutation || canEditItems(order)) && <div className="notice success"><CheckCircle />{message}<button type="button" className="text-button" aria-label="关闭操作提示" onClick={() => setMessage('')}>关闭</button></div>}<ErrorNotice error={editing ? null : mutation.error} /></div>
    <div className="detail-columns detail-summary">
    <section className="panel detail-status"><div className="section-heading"><h2><Clock />整单制作与交付</h2><span className="muted">{order.items.length} 项商品，统一确认</span></div>
      <OrderProgress order={order} />
      <div className="current-status"><Status order={order} /><span>{order.fulfillment.type === 'PICKUP' ? '门店自提' : '配送上门'} · {order.fulfillment.requestedReceiveDate} {time(order.fulfillment.plannedHandoffAt)}</span></div>
      <div className="actions">{production.map(action => <button key={action} className={['REOPEN_PRODUCTION', 'COMPLETE_LAYER', 'COMPLETE_FROSTING'].includes(action) ? 'secondary' : 'primary'} disabled={mutation.isPending || imageDraft || imageWriting || exportWriting || Boolean(editing && !(action === 'REOPEN_PRODUCTION' && editing.kind === 'item'))} onClick={() => mutateAction(action, 'production-actions')}>{actionNames[action]}<ArrowRight /></button>)}{fulfillment && <button className="primary" disabled={blocked} onClick={() => mutateAction(fulfillment, 'fulfillment-actions')}>{actionNames[fulfillment]}<ArrowRight /></button>}</div>
      {order.status === 'PROCESSING' && <p className="form-help">夹层、抹面可按需记录；所有商品备齐后，可直接确认整单制作完成。</p>}
      <details className="timeline"><summary>制作活动历史</summary><ActivityFeed id={id} type="ORDER_PRODUCTION_CHANGED" items={order.items} /></details>
    </section>
    <section className="panel payment-panel"><h2>金额与付款</h2><div><p className="muted">订单金额</p><strong className="order-amount">{money(order.totalAmountCents)}</strong></div><Payment status={order.paymentStatus} /><button className="secondary" disabled={blocked} onClick={() => mutation.mutate({ path: 'payment-status', method: 'PATCH', body: { expectedVersion: order.version, paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' } })}>{order.paymentStatus === 'PAID' ? '改为未付款' : '确认已付款'}</button></section></div>
    <section className="panel"><div className="section-heading"><h2>客户与交付</h2>{!editing && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'information', order }); }}><NotePencil />编辑资料</button>}</div>
      {editing?.kind === 'information' ? <InformationEdit initial={editing.order} latest={order} busy={mutation.isPending} error={mutation.variables?.path === 'information' ? mutation.error : null} onDirtyChange={onEditDirtyChange} onSave={request => mutation.mutateAsync({ path: 'information', method: 'PATCH', body: request })} onCancel={cancelEdit} /> : <InformationSummary order={order} />}
    </section>
    <section className="panel"><div className="section-heading"><h2>全部商品</h2><div className="item-heading-actions"><span className="muted">共 {order.items.length} 项</span>{canEditItems(order) && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order }); }}><Plus />添加商品</button>}</div></div>
      {itemChange && canEditItems(order) && <p className="form-help" role="status">最近商品变更：{activityNames[itemChange.type]} · {time(itemChange.createdAt, true)}。制作同事请复核最新规格与数量，按整单进度继续制作。</p>}
      {['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(order.status) && <p className="form-help">需要修改商品时，请先在上方执行「重新制作」。</p>}
      <div className="products detail-products">{visibleItems.map(item => <Product key={item.itemId} item={item} prices actions={canEditItems(order) && editing?.itemId !== item.itemId && <div className="product-actions"><button className="text-button" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order, itemId: item.itemId }); }}>编辑</button><button className="text-button danger" disabled={blocked || !canRemoveItem(order, item.itemId)} title={order.items.length === 1 ? '至少保留一件有效商品' : undefined} onClick={() => { if (canRemoveItem(order, item.itemId) && window.confirm(`移除「${item.name}」？历史记录会保留，订单约定金额不变。`)) mutation.mutate({ path: `items/${item.itemId}/remove`, body: { expectedVersion: order.version } }); }}><Trash />移除</button></div>}>{editing?.kind === 'item' && editing.itemId === item.itemId ? itemEditor : null}</Product>)}</div>
      {editing?.kind === 'item' && !editing.itemId && <div className="item-add"><h3>添加商品</h3>{itemEditor}</div>}
    </section>
    <OrderImages key={id} order={order} blocked={mutation.isPending || Boolean(editing) || exportWriting} onDraftChange={imageDraftChange} onWritingChange={imageWritingChange} />
    <section className="panel"><h2><NotePencil />备注</h2><form className="note-form" onSubmit={event => { event.preventDefault(); if (!blocked && note.trim() && (!itemId || order.items.some(item => item.itemId === itemId))) mutation.mutate({ path: 'notes', body: { itemId: itemId || null, content: note.trim() } }); }}>
      <label>备注对象<select value={itemId} onChange={event => setItemId(event.target.value)} disabled={mutation.isPending}><option value="">整张订单</option>{order.items.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}{itemId && !order.items.some(item => item.itemId === itemId) && <option value={itemId}>已移除的商品，请重新选择</option>}</select></label>
      <label className="note-content">备注内容<textarea placeholder="记录客户的心意，或交接给下一位同事…" value={note} onChange={event => setNote(event.target.value)} required disabled={mutation.isPending} rows={3} /></label>
      <button className="primary" disabled={blocked || !note.trim() || Boolean(itemId && !order.items.some(item => item.itemId === itemId))}>发布备注<ArrowRight /></button>
    </form><ActivityFeed id={id} type="NOTE" items={order.items} /></section>
    <section className="panel"><div className="section-heading"><h2><ListBullets />修改日志</h2><button className="text-button" disabled={activities.isFetching} onClick={() => void activities.refetch()}>刷新日志</button></div><ActivityFeed id={id} items={order.items} /></section>
    {!['COMPLETED', 'CANCELLED'].includes(order.status) && <section className="cancel-section"><button className="text-button danger" disabled={blocked} onClick={() => setShowCancel(!showCancel)} aria-expanded={showCancel}>取消订单</button>{showCancel && <form onSubmit={event => { event.preventDefault(); if (!blocked) mutation.mutate({ path: 'cancel', body: { expectedVersion: order.version, reason: reason.trim() } }); }}><label>取消原因<input value={reason} onChange={event => setReason(event.target.value)} required disabled={mutation.isPending} /></label><button className="danger-button" disabled={blocked || !reason.trim()}>确认取消订单</button></form>}</section>}
    {order.status === 'CANCELLED' && <Empty>订单已取消，仍可查看历史记录和记录备注。</Empty>}
  </div>;
}
