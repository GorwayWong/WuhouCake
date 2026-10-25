import { orderHref } from './routes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cake, CheckCircle, Clock, NotePencil, ListBullets, Package, Plus, Stack, Trash, Truck, XCircle } from '@phosphor-icons/react';
import { api, ApiError, creationResultUnknown } from './api';
import { synchronize } from './realtime';
import type { Account, Activity, Detail, Page } from './types';
import { CustomerOrderOrigin } from './CustomerSubmissions';
import { time } from './dates';
import { Empty, ErrorNotice, Loading, money, Payment, Product, Status, statusLabel, statusNames, valueText } from './ui';
import { InformationEdit, InformationSummary } from './InformationEdit';
import { ItemEdit } from './ItemEdit';
import { canEditItems, canRemoveItem } from './orderForm';
import { OrderImages } from './OrderImages';
import { SingleOrderExport } from './OrderExports';
import { exportActivitySummary } from './exportFiles';
import { uniqueActivities } from './activities';
import { Select } from './Select';
import { hasPermissions, orderAccess } from './access';
import { ProductionFields } from './ProductionView';
import { OrderRequirements } from './OrderRequirements';
import { previousOrderStep } from './orderTransitions';

const actionNames: Record<string, string> = { START_PRODUCTION: '开始制作', COMPLETE_LAYER: '确认整单夹层', COMPLETE_FROSTING: '确认整单抹面', COMPLETE_PRODUCTION: '整单制作完成', COMPLETE_OTHER: '确认“其他”完成', REOPEN_PRODUCTION: '退回其他已确认', ROLLBACK_PRODUCTION: '退回上一制作节点', ROLLBACK_FULFILLMENT: '退回上一交付节点', RESTART_CANCELLED: '恢复已取消订单至待制作', START_DELIVERY: '开始配送', COMPLETE_DELIVERY: '完成配送', CONFIRM_PICKUP: '确认自提' };
const activityNames: Record<string, string> = { CREATED: '创建订单', ITEM_CHANGED: '修改商品', NOTE: '添加备注', PAYMENT_STATUS_CHANGED: '更新付款状态', ORDER_PRODUCTION_CHANGED: '更新整单制作', ORDER_FULFILLMENT_CHANGED: '更新交付状态', ORDER_CANCELLED: '取消订单', ORDER_DELETED: '删除订单', ORDER_INFORMATION_CHANGED: '修改订单信息', ITEM_ADDED: '添加商品', ITEM_REMOVED: '移除商品', IMAGE_ADDED: '添加参考图片', IMAGE_REMOVED: '移除参考图片', ORDER_EXPORTED: '导出订单' };
const fieldNames: Record<string, string> = { status: '订单状态', currentStageCode: '制作阶段', paymentStatus: '付款状态', paidAt: '付款时间', customer: '客户', fulfillment: '交付', customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '客户订购人', creditedEmployeeId: '下单员工 ID', creditedEmployeeName: '下单员工', type: '方式', address: '地址', requestedReceiveDate: '收货日期', requestedReceiveAt: '期望收货时间', plannedHandoffAt: '取货时间', plannedFinishAt: '计划出品时间', name: '商品名称', quantity: '数量', attributes: '商品要求', requirements: '下单备注（其他要求）', otherRequirements: '下单备注（其他要求）', totalAmountCents: '订单金额（分）', unitPriceCents: '单价（分）', memberPriceCents: '会员价（分）', productionStatus: '制作状态', productType: '商品类型' };
function changeValue(value: unknown): string {
  if (value === null) return '未填写';
  if (Array.isArray(value)) return value.map(changeValue).join('、');
  if (typeof value === 'string') return statusNames[value] || ({ PAID: '已付款', UNPAID: '未付款', DELIVERY: '配送', PICKUP: '自提', IN_PROGRESS: '制作中', NOT_STARTED: '未开始' } as Record<string, string>)[value] || value;
  if (typeof value === 'object' && value) return Object.entries(value).filter(([key]) => key !== 'creditedEmployeeId' || !Object.hasOwn(value, 'creditedEmployeeName')).map(([key, val]) => `${fieldNames[key] || key}：${key === 'paidAt' && typeof val === 'string' ? time(val, true) : changeValue(val)}`).join('；');
  return valueText(value);
}
function activityDescription(activity: Activity) {
  const details = activity.details || {};
  if (activity.type === 'ORDER_EXPORTED') return <div className="export-activity">{exportActivitySummary(details).map(line => <p key={line}>{line}</p>)}</div>;
  const text = typeof details.action === 'string' ? actionNames[details.action] : undefined;
  const imageActivity = ['IMAGE_ADDED', 'IMAGE_REMOVED'].includes(activity.type);
  return <>{text && <p>{text}</p>}{activity.content && !imageActivity && <p>{activity.content}</p>}{typeof details.filename === 'string' && <p>{details.filename}</p>}{details.before != null && <p className="muted">原：{changeValue(details.before)}</p>}{details.after != null && <p>现：{changeValue(details.after)}</p>}</>;
}
function useActivities(id: string, type?: string, size = 20) {
  return useInfiniteQuery({
    queryKey: ['order', id, 'activities', type || 'all', size], initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => api<Page<Activity>>(`/orders/${id}/${type === 'NOTE' ? 'notes' : 'activities'}?page=${pageParam}&size=${size}${type && type !== 'NOTE' ? `&type=${type}` : ''}`, { signal }),
    getNextPageParam: last => last.page * last.size < last.total ? last.page + 1 : undefined,
  });
}
function ActivityFeed({ id, type, items, preview = false }: { id: string; type?: string; items: Detail['items']; preview?: boolean }) {
  const query = useActivities(id, type, preview ? 3 : 20);
  return <><ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending ? <Loading /> : <ol className="activity-feed">{uniqueActivities(query.data?.pages || []).map(activity => <li key={activity.id}><span className="activity-dot" /><div><div className="note-meta"><strong>{activity.actorNameSnapshot}</strong><span>{activityNames[activity.type] || activity.type}</span><time dateTime={activity.createdAt}>{time(activity.createdAt, true)}</time></div><span className="scope">{activity.itemId ? items.find(item => item.itemId === activity.itemId)?.name || '历史商品' : '整张订单'}</span>{activityDescription(activity)}</div></li>)}</ol>}{query.data?.pages[0].total === 0 && <p className="muted">暂无记录</p>}{!preview && query.hasNextPage && <button className="secondary" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? '读取中…' : '加载更早记录'}</button>}</>;
}

export function OrderHistory({ account, id, initialType, returnToCalendar }: { account?: Account; id: string; initialType?: string; returnToCalendar?: string }) {
  const access = orderAccess(account);
  const [type, setType] = useState(initialType && Object.hasOwn(activityNames, initialType) ? initialType : '');
  const detail = useQuery({ queryKey: ['order', id, 'detail'], queryFn: ({ signal }) => api<Detail>(`/orders/${id}`, { signal }) });
  return <div className="history-page"><a className="back-link" href={orderHref(id, returnToCalendar)}><ArrowLeft />返回订单详情</a>
    <div className="page-heading"><div><h1>订单记录</h1>{detail.data && <p className="muted">#{detail.data.orderNo}</p>}</div></div>
    <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    <section className="panel">{access.history && <div className="history-toolbar"><label>记录类型<Select label="记录类型" value={type} onChange={setType}><option value="">全部记录</option>{Object.entries(activityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>}
      <ActivityFeed id={id} type={access.history ? type || undefined : 'NOTE'} items={detail.data?.items || []} />
    </section></div>;
}

function ProductionBrief({ order }: { order: Detail }) {
  return <section className="panel production-brief" aria-label="客户与交付">
    <h2>客户与交付</h2><dl className="info-grid">
      <div><dt>客户手机号</dt><dd>{order.customer?.phone ? <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a> : '未填写'}</dd></div>
      <div><dt>收货日期</dt><dd>{order.fulfillment.requestedReceiveDate}</dd></div>
      <div><dt>期望收货时间</dt><dd>{order.fulfillment.requestedReceiveAt ? time(order.fulfillment.requestedReceiveAt, true) : '未填写'}</dd></div>
      <div><dt>取货时间</dt><dd>{order.fulfillment.plannedHandoffAt ? time(order.fulfillment.plannedHandoffAt, true) : '未填写'}</dd></div>
      <div><dt>计划出品时间</dt><dd>{order.fulfillment.plannedFinishAt ? time(order.fulfillment.plannedFinishAt, true) : '未填写'}</dd></div>
    </dl>
  </section>;
}

function OrderProgress({ order }: { order: Detail }) {
  if (order.deletion || order.deleted) return <div className="progress-cancelled" role="status"><Trash size={25} />订单已删除，仅供查询，不可恢复。</div>;
  if (order.status === 'CANCELLED') return <div className="progress-cancelled" role="status"><XCircle size={25} />订单已取消，可恢复至待制作重新开始。</div>;
  const layerConfirmed = ['LAYER_DONE', 'FROSTING_DONE', 'OTHER_DONE'].includes(order.currentStageCode || '');
  const frostingConfirmed = ['FROSTING_DONE', 'OTHER_DONE'].includes(order.currentStageCode || '');
  const pickup = order.fulfillment.type === 'PICKUP';
  const steps = [
    { key: 'WAITING_PRODUCTION', label: '待制作', Icon: Clock },
    { key: 'PROCESSING', label: '生胚中', Icon: Cake },
    { key: 'LAYER_DONE', label: layerConfirmed ? '已夹层' : '夹层', Icon: Stack, confirmed: layerConfirmed },
    { key: 'FROSTING_DONE', label: frostingConfirmed ? '已抹面' : '抹面', Icon: Cake, confirmed: frostingConfirmed },
    { key: 'OTHER_DONE', label: order.currentStageCode === 'OTHER_DONE' ? '其他已确认' : '其他', Icon: CheckCircle, confirmed: order.currentStageCode === 'OTHER_DONE' },
    { key: pickup ? 'WAITING_PICKUP' : 'WAITING_DELIVERY', label: pickup ? '待自提' : '待配送', Icon: pickup ? Package : Truck },
    ...(!pickup ? [{ key: 'DELIVERING', label: '配送中', Icon: Truck }] : []),
    { key: 'COMPLETED', label: '已完成', Icon: CheckCircle },
  ];
  const current = steps.findIndex(step => step.key === (order.status === 'PROCESSING' ? order.currentStageCode || order.status : order.status));
  return <ol className="order-progress" aria-label="整单状态进度">{steps.map(({ key, label, Icon, ...step }, index) => {
    // 历史完成单可能未记录制作节点，不能仅凭进度位置推定已确认。
    const state = index === current ? 'current' : index > current ? 'pending' : 'confirmed' in step && !step.confirmed ? 'unrecorded' : 'done';
    return <li key={key} className={`progress-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="progress-icon"><Icon size={22} aria-hidden="true" /></span><span className="progress-label">{label}</span>
      <small>{state === 'current' ? '当前' : state === 'unrecorded' ? '未记录' : <span className="sr-only">{state === 'done' ? '已完成' : '未到达'}</span>}</small>
    </li>;
  })}</ol>;
}

export function OrderDetail({ account, id, returnToCalendar, returnToOrders = false, onEditDirtyChange, onWritingChange }: { account?: Account; id: string; returnToOrders?: boolean; returnToCalendar?: string; onEditDirtyChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void }) {
  const client = useQueryClient();
  const access = orderAccess(account);
  const detail = useQuery({ queryKey: ['order', id, 'detail'], queryFn: ({ signal }) => api<Detail>(`/orders/${id}`, { signal }) });
  const [note, setNote] = useState('');
  const [noteResultUnknown, setNoteResultUnknown] = useState(false);
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ kind: 'information' | 'item' | 'amount'; order: Detail; itemId?: string; reopened?: Detail } | null>(null);
  const [imageDraft, setImageDraft] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [imageWriting, setImageWriting] = useState(false);
  const [exportWriting, setExportWriting] = useState(false);
  const imageDraftChange = useCallback((dirty: boolean) => setImageDraft(dirty), []);
  const editorDirtyChange = useCallback((dirty: boolean) => setEditorDirty(dirty), []);
  useEffect(() => { onEditDirtyChange(Boolean(note.trim()) || Boolean(deleteReason.trim()) || imageDraft || editorDirty); return () => onEditDirtyChange(false); }, [note, deleteReason, imageDraft, editorDirty, onEditDirtyChange]);
  const imageWritingChange = useCallback((pending: boolean) => { setImageWriting(pending); onWritingChange(pending); }, [onWritingChange]);
  const exportWritingChange = useCallback((pending: boolean) => { setExportWriting(pending); onWritingChange(pending); }, [onWritingChange]);
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
        client.setQueryData<Detail>(['order', id, 'detail'], current => current && current.version > updated.version ? current
          : current?.deleted && !updated.deletion ? { ...updated, deleted: true } : updated);
      }
      const clearedStages = previous?.version === (variables.body as { expectedVersion?: number }).expectedVersion && ['LAYER_DONE', 'FROSTING_DONE', 'OTHER_DONE'].includes(previous?.currentStageCode || '') && updated?.status === 'PROCESSING' && !updated.currentStageCode;
      const action = (variables.body as { action?: string }).action;
      const informationChanges = (variables.body as { changes?: Record<string, unknown> }).changes;
      const amountOnly = variables.path === 'information' && informationChanges && Object.keys(informationChanges).length === 1 && Object.hasOwn(informationChanges, 'totalAmountCents');
      const rollbackMessage = variables.path === 'restart' ? '订单已恢复至待制作，商品制作确认已重置，付款和历史记录保留。'
        : updated && ['ROLLBACK_PRODUCTION', 'REOPEN_PRODUCTION', 'ROLLBACK_FULFILLMENT'].includes(action || '') ? `订单已退回${statusLabel(updated)}。${updated.status === 'WAITING_PRODUCTION' ? '商品制作确认已重置。' : '商品制作勾选保留。'}` : '';
      setMessage(variables.path === '' ? '商品已保存' : variables.path === 'items' ? `商品已添加。${clearedStages ? '制作节点已重置，请重新确认。' : ''}` : variables.path.endsWith('/remove') ? '商品已移除' : variables.path.endsWith('/production-status') ? '商品制作状态已保存' : variables.path === 'notes' ? '备注已发布' : variables.path === 'information' ? amountOnly ? '金额已保存' : '订单资料已保存' : variables.path === 'payment-status' ? '付款状态已更新' : variables.path === 'cancel' ? '订单已取消' : rollbackMessage || `${actionNames[action || '']}已确认`);
      if (updated && variables.path === 'production-actions' && (variables.body as { action: string }).action === 'REOPEN_PRODUCTION') {
        setEditing(current => current?.kind === 'item' ? { ...current, reopened: updated } : current);
      }
      if (['information', '', 'items'].includes(variables.path)) setEditing(null);
      if (variables.path === 'notes') { setNote(''); setNoteResultUnknown(false); }
      if (variables.path === 'cancel') { setReason(''); setShowCancel(false); }
      if (variables.path === 'delete') { setDeleteReason(''); setShowDelete(false); setMessage('订单已删除，30 天内可在已删除订单中查询，不可恢复。'); }
      await synchronize(client, id);
    },
    onError: async (error, variables, context) => {
      if (context?.page === page.current) {
        setMessage('');
        if (variables.path === 'notes' && creationResultUnknown(error)) setNoteResultUnknown(true);
        await synchronize(client, id);
      }
    },
    onSettled: (_result, _error, _variables, context) => { if (context?.page === page.current) onWritingChange(false); },
  });
  if (!account || detail.isPending) return <Loading />;
  if (!detail.data) return <><a className="back-link" href={returnToOrders ? '#/admin/orders' : returnToCalendar || '#'}><ArrowLeft />{returnToOrders ? '返回查询结果' : returnToCalendar?.startsWith('#/payment-orders?') ? '返回付款订单列表' : '返回工作台'}</a><ErrorNotice error={detail.error} retry={() => void detail.refetch()} /></>;
  const order = detail.data;
  const readOnly = Boolean(order.deletion || order.deleted || detail.error instanceof ApiError && detail.error.code === 'ORDER_DELETED_FORBIDDEN');
  const removedDraft = editing?.kind === 'item' && editing.itemId && !order.items.some(item => item.itemId === editing.itemId) ? editing.order.items.find(item => item.itemId === editing.itemId) : undefined;
  const visibleItems = removedDraft ? [...order.items, removedDraft] : order.items;
  const busy = mutation.isPending || Boolean(editing) || imageDraft || imageWriting || exportWriting;
  const blocked = busy || readOnly;
  const itemMutation = mutation.variables?.path === '' || mutation.variables?.path === 'items' || mutation.variables?.path.endsWith('/remove');
  const cancelEdit = () => { if (!mutation.isPending) { setEditing(null); mutation.reset(); } };
  const itemEditor = editing?.kind === 'item' ? <ItemEdit initial={editing.order} itemId={editing.itemId} latest={order} reopened={editing.reopened} busy={mutation.isPending || readOnly} error={mutation.error} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'item' in request ? 'items' : '', method: 'item' in request ? 'POST' : 'PATCH', body: request })} onCancel={cancelEdit} /> : null;
  const otherReady = order.items.every(item => item.productionStatus === 'COMPLETED');
  const production = order.status === 'WAITING_PRODUCTION' ? ['START_PRODUCTION'] : order.status === 'PROCESSING'
    ? !order.currentStageCode ? ['COMPLETE_LAYER'] : order.currentStageCode === 'LAYER_DONE' ? ['COMPLETE_FROSTING'] : order.currentStageCode === 'FROSTING_DONE' ? ['COMPLETE_OTHER'] : order.currentStageCode === 'OTHER_DONE' ? ['COMPLETE_PRODUCTION'] : []
    : [];
  const previous = readOnly ? null : previousOrderStep(order);
  const fulfillment = order.status === 'WAITING_DELIVERY' ? 'START_DELIVERY' : order.status === 'DELIVERING' ? 'COMPLETE_DELIVERY' : order.status === 'WAITING_PICKUP' ? 'CONFIRM_PICKUP' : null;
  const mutateAction = (action: string, path: string) => mutation.mutate({ path, body: { expectedVersion: order.version, action } });
  const moveBack = () => {
    if (!previous) return;
    const impact = previous.resetItems ? '全部商品的制作完成勾选将清空，制作阶段重置。' : '保留商品的制作完成勾选。';
    if (window.confirm(`${previous.label}？${impact}订单资料、付款和历史记录保留。`)) mutation.mutate({ path: previous.path, body: { expectedVersion: order.version, ...(previous.action ? { action: previous.action } : {}) } });
  };
  return <div className={`detail-page ${access.productionView ? 'production-detail' : ''}`}>
    <a className="back-link" href={returnToOrders ? '#/admin/orders' : returnToCalendar || `#/?date=${order.fulfillment.requestedReceiveDate}`} aria-disabled={mutation.isPending || imageWriting || exportWriting} onClick={event => { if (mutation.isPending || imageWriting || exportWriting) event.preventDefault(); }}><ArrowLeft />{returnToOrders ? '返回查询结果' : returnToCalendar?.startsWith('#/payment-orders?') ? '返回付款订单列表' : returnToCalendar ? '返回工作台' : `返回 ${order.fulfillment.requestedReceiveDate} 工作台`}</a>
    <div className="page-heading"><h1>订单 #{order.orderNo}</h1><div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div></div>
    {access.customer && <CustomerOrderOrigin orderId={id} />}
    {order.deletion && <div className="notice" role="status"><p>已删除 · {time(order.deletion.deletedAt, true)} · {order.deletion.employeeName}</p><p>删除原因：{order.deletion.reason}</p><p>保留至 {time(order.deletion.expiresAt, true)}，到期永久清理；不参与工作台和经营统计。</p>{editing && <button type="button" className="secondary" onClick={() => { if (window.confirm('关闭未保存的编辑草稿？')) cancelEdit(); }}>关闭编辑草稿</button>}</div>}
    {readOnly && !order.deletion && <div className="notice" role="status">订单已删除，当前页面只保留原有资料和未保存输入，不可继续操作。{editing && <button type="button" className="secondary" onClick={() => { if (window.confirm('关闭未保存的编辑草稿？')) cancelEdit(); }}>关闭编辑草稿</button>}</div>}
    {access.export && <SingleOrderExport orderId={id} orderNo={order.orderNo} blocked={busy} onPendingChange={exportWritingChange} />}
    <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    <div className="feedback" aria-live="polite">{message && (!itemMutation || canEditItems(order)) && <div className="notice success"><CheckCircle />{message}<button type="button" className="text-button" aria-label="关闭操作提示" onClick={() => setMessage('')}>关闭</button></div>}<ErrorNotice error={editing || (noteResultUnknown && mutation.variables?.path === 'notes') ? null : mutation.error} /></div>
    <div className="detail-summary">
    <section className="panel detail-status"><div className="section-heading"><h2><Clock />整单制作与交付</h2><span className="muted">{order.items.length} 项商品</span></div>
      <OrderProgress order={order} />
      <div className="current-status"><Status order={order} /><span>{access.productionView ? `计划出品：${order.fulfillment.plannedFinishAt ? time(order.fulfillment.plannedFinishAt, true) : '未安排'}` : `${order.fulfillment.type === 'PICKUP' ? '门店自提' : '配送上门'} · ${order.fulfillment.requestedReceiveDate} ${time(order.fulfillment.plannedHandoffAt)}`}</span></div>
      <div className="actions">{previous && hasPermissions(account, ...previous.permissions) && <button className="secondary" disabled={mutation.isPending || imageDraft || imageWriting || exportWriting || Boolean(editing && !(previous.action === 'REOPEN_PRODUCTION' && editing.kind === 'item'))} onClick={moveBack}><ArrowLeft />{previous.label}</button>}{(hasPermissions(account, 'ORDER_PRODUCTION_UPDATE') ? production : []).map(action => <button key={action} className={['COMPLETE_LAYER', 'COMPLETE_FROSTING'].includes(action) ? 'secondary' : 'primary'} disabled={['COMPLETE_OTHER', 'COMPLETE_PRODUCTION'].includes(action) && !otherReady || blocked} onClick={() => mutateAction(action, 'production-actions')}>{actionNames[action]}<ArrowRight /></button>)}{fulfillment && hasPermissions(account, 'ORDER_FULFILLMENT_UPDATE') && <button className="primary" disabled={blocked} onClick={() => mutateAction(fulfillment, 'fulfillment-actions')}>{actionNames[fulfillment]}<ArrowRight /></button>}</div>
      {!otherReady && hasPermissions(account, 'ORDER_PRODUCTION_UPDATE') && production.some(action => ['COMPLETE_OTHER', 'COMPLETE_PRODUCTION'].includes(action)) && <p className="form-help" role="status">还有 {order.items.filter(item => item.productionStatus !== 'COMPLETED').length} 项商品未完成</p>}
      {access.history && <a className="text-button" href={orderHref(id, returnToCalendar, 'ORDER_PRODUCTION_CHANGED', true)}>制作记录<ArrowRight /></a>}
    </section>
    </div>
    {access.customer && access.business && <section className="panel"><div className="section-heading"><h2>客户与交付</h2>{!editing && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'information', order }); }}><NotePencil />编辑资料</button>}</div>
      {editing?.kind === 'information' ? <InformationEdit initial={editing.order} latest={order} busy={mutation.isPending || readOnly} error={mutation.variables?.path === 'information' ? mutation.error : null} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'information', method: 'PATCH', body: request })} onCancel={cancelEdit} /> : <InformationSummary order={order} />}
    </section>}
    {access.productionView && access.phone && <ProductionBrief order={order} />}
    <OrderRequirements items={order.items} />
    <OrderImages key={id} order={order} productionView={access.productionView} blocked={mutation.isPending || Boolean(editing) || exportWriting || readOnly} onDraftChange={imageDraftChange} onWritingChange={imageWritingChange} />
    <section className="panel"><div className="section-heading"><h2>全部商品</h2><div className="item-heading-actions"><span className="muted">共 {order.items.length} 项</span>{access.entry && access.business && canEditItems(order) && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order }); }}><Plus />添加商品</button>}</div></div>
      {access.entry && access.business && ['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(order.status) && <p className="form-help">编辑商品前，请先退回“其他已确认”。</p>}
      <div className="products detail-products">{visibleItems.map(item => <Product key={item.itemId} item={item} prices={access.amounts} completion={order.items.some(active => active.itemId === item.itemId) && <label className={`product-completion${item.productionStatus === 'COMPLETED' ? ' is-complete' : ''}`}><input type="checkbox" aria-label={`${item.name}制作完成`} checked={item.productionStatus === 'COMPLETED'} disabled={blocked || order.status !== 'PROCESSING' || !hasPermissions(account, 'ORDER_PRODUCTION_UPDATE')} onChange={event => mutation.mutate({ path: `items/${item.itemId}/production-status`, method: 'PATCH', body: { expectedVersion: order.version, completed: event.target.checked } })} /><span>制作完成</span></label>} actions={access.entry && access.business && canEditItems(order) && editing?.itemId !== item.itemId && <div className="product-actions"><button className="text-button" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order, itemId: item.itemId }); }}>编辑</button><button className="text-button danger" disabled={blocked || !canRemoveItem(order, item.itemId)} title={order.items.length === 1 ? '至少保留一件有效商品' : undefined} onClick={() => { if (canRemoveItem(order, item.itemId) && window.confirm(`移除「${item.name}」？历史记录会保留，订单约定金额不变。`)) mutation.mutate({ path: `items/${item.itemId}/remove`, body: { expectedVersion: order.version } }); }}><Trash />移除</button></div>}>{access.productionView ? <ProductionFields item={item} /> : editing?.kind === 'item' && editing.itemId === item.itemId ? itemEditor : null}</Product>)}</div>
      {editing?.kind === 'item' && !editing.itemId && <div className="item-add"><h3>添加商品</h3>{itemEditor}</div>}
    </section>
    <details className="panel note-panel" aria-label="工作沟通备注"><summary>工作备注与沟通</summary><div className="section-heading"><h2><NotePencil />工作沟通备注</h2><a className="text-button" href={orderHref(id, returnToCalendar, 'NOTE', true)}>全部备注<ArrowRight /></a></div>
    {noteResultUnknown && <div className="notice" role="alert"><p>发布结果未确认，输入已保留。请先核对备注记录，确认未保存后再重发。</p><button type="button" className="secondary compact" disabled={blocked} onClick={() => { setNoteResultUnknown(false); mutation.reset(); }}>已核对未保存，允许重发</button></div>}
    {hasPermissions(account, 'ORDER_NOTE_CREATE') && <form className="note-form" onSubmit={event => { event.preventDefault(); if (!blocked && !noteResultUnknown && note.trim() && (!itemId || order.items.some(item => item.itemId === itemId))) mutation.mutate({ path: 'notes', body: { itemId: itemId || null, content: note.trim() } }); }}>
      <label>备注对象<Select label="备注对象" value={itemId} onChange={setItemId} disabled={mutation.isPending || readOnly}><option value="">整张订单</option>{order.items.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}{itemId && !order.items.some(item => item.itemId === itemId) && <option value={itemId}>已移除的商品，请重新选择</option>}</Select></label>
      <label className="note-content">备注内容<textarea placeholder="记录制作、交接过程中的沟通信息" value={note} onChange={event => setNote(event.target.value)} required disabled={mutation.isPending || readOnly} rows={3} /></label>
      <button className="primary" disabled={blocked || noteResultUnknown || !note.trim() || Boolean(itemId && !order.items.some(item => item.itemId === itemId))}>发布备注<ArrowRight /></button>
    </form>}<ActivityFeed id={id} type="NOTE" items={order.items} preview /></details>
    {order.status === 'CANCELLED' && <Empty>{access.history ? '订单已取消，历史记录保留。' : '订单已取消，制作资料保留。'}</Empty>}
    {access.amounts && <section className="panel payment-panel"><div className="section-heading payment-heading"><h2>金额与付款</h2>{hasPermissions(account, 'ORDER_EDIT') && !editing && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'amount', order }); }}><NotePencil />修改金额</button>}</div>{editing?.kind === 'amount' && <div className="amount-editor"><InformationEdit amountOnly initial={editing.order} latest={order} busy={mutation.isPending || readOnly} error={mutation.variables?.path === 'information' ? mutation.error : null} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'information', method: 'PATCH', body: request })} onCancel={cancelEdit} /></div>}<div><p className="muted">订单金额</p><strong className="order-amount">{money(order.totalAmountCents)}</strong>{order.paymentStatus === 'PAID' && <p className="form-help">付款时间：{order.paidAt ? time(order.paidAt, true) : '历史付款时间未记录'}</p>}</div>{access.amounts && <Payment status={order.paymentStatus} />}<button className="secondary" disabled={blocked} onClick={() => mutation.mutate({ path: 'payment-status', method: 'PATCH', body: { expectedVersion: order.version, paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' } })}>{order.paymentStatus === 'PAID' ? '改为未付款' : '确认已付款'}</button></section>}
    {access.history && <details className="panel operation-history" aria-label="操作记录"><summary>操作记录</summary><div className="section-heading"><h2><ListBullets />最近操作记录</h2><a className="text-button" href={orderHref(id, returnToCalendar, undefined, true)}>全部操作记录<ArrowRight /></a></div><ActivityFeed id={id} items={order.items} preview /></details>}
    {hasPermissions(account, 'ORDER_CANCEL') && !readOnly && !['COMPLETED', 'CANCELLED'].includes(order.status) && <section className="cancel-section"><button className="danger-button" disabled={blocked} onClick={() => setShowCancel(!showCancel)} aria-expanded={showCancel}>取消订单</button>{showCancel && <form onSubmit={event => { event.preventDefault(); if (!blocked) mutation.mutate({ path: 'cancel', body: { expectedVersion: order.version, reason: reason.trim() } }); }}><label>取消原因<input value={reason} onChange={event => setReason(event.target.value)} required disabled={mutation.isPending} /></label><button className="danger-button" disabled={blocked || !reason.trim()}>确认取消订单</button></form>}</section>}
    {access.delete && !readOnly && <section className="cancel-section"><button type="button" className="danger-button" disabled={blocked} aria-expanded={showDelete} onClick={() => setShowDelete(value => !value)}>删除订单</button>{showDelete && <form onSubmit={event => { event.preventDefault(); if (!blocked && deleteReason.trim() && window.confirm(`确认删除订单 #${order.orderNo}？将退出工作台和经营统计，30 天内仅可查询，不可恢复，到期永久清理。`)) mutation.mutate({ path: 'delete', body: { expectedVersion: order.version, reason: deleteReason.trim() } }); }}><label>删除原因<textarea value={deleteReason} maxLength={1000} required disabled={mutation.isPending} onChange={event => setDeleteReason(event.target.value)} /></label><button className="danger-button" disabled={blocked || !deleteReason.trim()}>确认删除订单</button></form>}</section>}
  </div>;
}
