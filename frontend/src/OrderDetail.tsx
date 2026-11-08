import { useEditImageSession } from './editImageSession';
import type { EditImageActions } from './OrderImages';
import { OrderPaymentEditor } from './OrderPaymentEditor';
import { paymentMethods, paymentMethodLabel } from './orderPayment';
import { pickupInstant, pickupDate } from './orderTimes';
import { orderHref } from './routes';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cake, CheckCircle, Clock, NotePencil, ListBullets, Plus, Stack, Trash, Truck, XCircle } from '@phosphor-icons/react';
import { api, ApiError, creationResultUnknown } from './api';
import { synchronize } from './realtime';
import type { Account, Activity, Detail, Page } from './types';
import { CustomerOrderOrigin } from './CustomerSubmissions';
import { businessDate, businessTime, time } from './dates';
import { Empty, ErrorNotice, Loading, money, Payment, Product, RecentProductNotes, Status, statusLabel, statusNames, valueText } from './ui';
import { InformationEdit } from './InformationEdit';
import { FrontProductDetails, FrontProductSupplement } from './FrontProductDetails';
import { ItemEdit } from './ItemEdit';
import { canEditItems, canRemoveItem } from './orderForm';
import { OrderImages } from './OrderImages';
import { SingleOrderExport } from './OrderExports';
import { exportActivitySummary } from './exportFiles';
import { uniqueActivities } from './activities';
import { Select } from './Select';
import { hasPermissions, orderAccess } from './access';
import { historicalProductionFields, productionFields } from './productionFields';
import { orderRequirements } from './orderingRequirements';
import { nextProductionAction, previousOrderStep } from './orderTransitions';
import { historicalStatusNames, productionStatuses } from './orderStates';
import { selectItemAfterChange } from './orderItemView';

const actionNames: Record<string, string> = {
  COMPLETE_BASE: '完成出胚', COMPLETE_LAYER: '完成夹层', COMPLETE_FROSTING: '完成抹面', COMPLETE_DECORATION: '完成装饰',
  REOPEN_PRODUCTION: '退回装饰', ROLLBACK_PRODUCTION: '退回上一制作节点', ROLLBACK_FULFILLMENT: '退回上一交付节点',
  RESTART_CANCELLED: '恢复已取消订单至出胚', COMPLETE_DELIVERY: '确认送达', CONFIRM_PICKUP: '确认自提',
};
const historicalActionNames: Record<string, string> = {
  START_PRODUCTION: '开始制作', COMPLETE_LAYER: '确认整单夹层', COMPLETE_FROSTING: '确认整单抹面',
  COMPLETE_PRODUCTION: '整单制作完成', COMPLETE_OTHER: '确认“其他”完成', REOPEN_PRODUCTION: '退回其他已确认',
  RESTART_CANCELLED: '恢复已取消订单至待制作', START_DELIVERY: '开始配送', COMPLETE_DELIVERY: '完成配送',
};
const activityNames: Record<string, string> = { CREATED: '创建订单', ITEM_CHANGED: '修改商品', NOTE: '添加备注', PAYMENT_STATUS_CHANGED: '更新付款状态', ORDER_PRODUCTION_CHANGED: '更新整单制作', ORDER_FULFILLMENT_CHANGED: '更新交付状态', ORDER_CANCELLED: '取消订单', ORDER_DELETED: '删除订单', ORDER_INFORMATION_CHANGED: '修改订单信息', ITEM_ADDED: '添加商品', ITEM_REMOVED: '移除商品', IMAGE_ADDED: '添加参考图片', IMAGE_REMOVED: '移除参考图片', ORDER_EXPORTED: '导出订单' };
const fieldNames: Record<string, string> = { orderingMethod: '下单方式', status: '订单状态', currentStageCode: '制作阶段', paymentStatus: '付款状态', paidAt: '付款时间', customer: '客户', fulfillment: '交付', customerName: '客户姓名', phone: '联系电话', memberPhone: '会员手机', buyerName: '订购人姓名', creditedEmployeeId: '下单员工 ID', creditedEmployeeName: '下单员工', type: '方式', address: '地址', requestedReceiveDate: '取货日期', requestedReceiveAt: '原收货时间', plannedHandoffAt: '取货时间', plannedFinishAt: '出品时间', name: '商品名称', quantity: '数量', attributes: '商品要求', requirements: '下单备注（其他要求）', otherRequirements: '下单备注（其他要求）', totalAmountCents: '成交金额（分）', originalAmountCents: '原价（分）', memberAmountCents: '会员价（分）', paymentMethod: '支付方式', unitPriceCents: '单价（分）', memberPriceCents: '会员价（分）', productionStatus: '制作状态', productType: '商品类型' };
function changeValue(value: unknown, historical: boolean, field?: string): string {
  if (value === null) return '未填写';
  if (Array.isArray(value)) return value.map(item => changeValue(item, historical, field)).join('、');
  if (typeof value === 'string' && field === 'paymentMethod') return paymentMethods[value] || value;
  if (typeof value === 'string') return (historical && (field === 'status' || field === 'currentStageCode') ? historicalStatusNames[value] : undefined) || statusNames[value] || ({ PAID: '已付款', UNPAID: '未付款', DELIVERY: '配送', PICKUP: '自提', IN_PROGRESS: '制作中', NOT_STARTED: '未开始' } as Record<string, string>)[value] || value;
  if (typeof value === 'object' && value) return Object.entries(value).filter(([key]) => key !== 'creditedEmployeeId' || !Object.hasOwn(value, 'creditedEmployeeName')).map(([key, val]) => `${fieldNames[key] || key}：${key === 'paidAt' && typeof val === 'string' ? time(val, true) : changeValue(val, historical, key)}`).join('；');
  return valueText(value);
}
function activityDescription(activity: Activity) {
  const details = activity.details || {};
  if (activity.type === 'ORDER_EXPORTED') return <div className="export-activity">{exportActivitySummary(details).map(line => <p key={line}>{line}</p>)}</div>;
  const historical = details.workflowVersion !== 2;
  const action = typeof details.action === 'string' ? details.action : '';
  const text = (historical ? historicalActionNames[action] : undefined) || actionNames[action];
  const imageActivity = ['IMAGE_ADDED', 'IMAGE_REMOVED'].includes(activity.type);
  return <>{text && <p>{text}</p>}{activity.content && !imageActivity && <p>{activity.content}</p>}{typeof details.filename === 'string' && <p>{details.filename}</p>}{details.before != null && <p className="muted">原：{changeValue(details.before, historical)}</p>}{details.after != null && <p>现：{changeValue(details.after, historical)}</p>}</>;
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

const progressIcons = [Cake, Stack, Cake, Cake, Truck, CheckCircle];

function OrderProgress({ order }: { order: Detail }) {
  if (order.deletion || order.deleted) return <div className="progress-cancelled" role="status"><Trash size={25} />订单已删除，仅供查询，不可恢复。</div>;
  if (order.status === 'CANCELLED') return <div className="progress-cancelled" role="status"><XCircle size={25} />订单已取消，可恢复至出胚重新开始。</div>;
  const steps = [...productionStatuses, 'WAITING_DELIVERY', 'COMPLETED'];
  const current = steps.indexOf(order.status);
  return <ol className="order-progress" aria-label="整单状态进度">{steps.map((key, index) => {
    const Icon = progressIcons[index];
    const state = index === current ? 'current' : current >= 0 && index < current ? 'done' : 'pending';
    return <li key={key} className={`progress-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="progress-icon"><Icon size={22} aria-hidden="true" /></span><span className="progress-label">{statusNames[key]}</span>
      <small>{state === 'current' ? '当前' : <span className="sr-only">{state === 'done' ? '已通过' : '未到达'}</span>}</small>
    </li>;
  })}</ol>;
}

function ProductionOrderFields({ order, item }: { order: Detail; item?: Detail['items'][number] }) {
  const cake = !item?.productType || item.productType.toUpperCase() === 'CAKE';
  const fields = Object.fromEntries(item ? productionFields(item) : []);
  const historical = item ? historicalProductionFields(item) : [];
  return <dl className="production-order-fields">
    <div><dt>名称</dt><dd>{item?.name || '暂无商品'}</dd></div>
    <div className="detail-business-time"><dt>出品时间</dt><dd>{order.fulfillment.plannedFinishAt ? businessTime(order.fulfillment.plannedFinishAt) : '待定'}</dd></div>
    <div><dt>{cake ? '尺寸' : '规格'}</dt><dd>{fields[cake ? '尺寸' : '规格'] || '无'}</dd></div>
    <div><dt>数量</dt><dd>{item?.quantity ?? '无'}</dd></div>
    {cake && <>
      <div><dt>夹馅</dt><dd>{fields['夹心'] || '无'}</dd></div>
      <div><dt>奶油</dt><dd>{fields['奶油'] || '无'}</dd></div>
      <div className="wide"><dt>祝福语</dt><dd>{fields['祝福语'] || '无'}</dd></div>
    </>}
    <div className="wide"><dt>特殊要求</dt><dd>{fields['特殊要求'] || '无'}</dd></div>
    {cake && fields['蛋糕胚口味'] && fields['蛋糕胚口味'] !== '无' && <div className="wide"><dt>蛋糕胚口味</dt><dd>{fields['蛋糕胚口味']}</dd></div>}
    {historical.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}（历史）</dt><dd>{value}</dd></div>)}
  </dl>;
}

export function OrderDetail({ account, id, returnToCalendar, returnToOrders = false, onEditDirtyChange, onWritingChange }: { account?: Account; id: string; returnToOrders?: boolean; returnToCalendar?: string; onEditDirtyChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void }) {
  const client = useQueryClient();
  const access = orderAccess(account);
  const detail = useQuery({ queryKey: ['order', id, 'detail'], queryFn: ({ signal }) => api<Detail>(`/orders/${id}`, { signal }) });
  const [note, setNote] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const previousProducts = useRef<{ orderId: string; items: { key: string }[] }>({ orderId: id, items: [] });
  const productNavigation = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const items = (detail.data?.items || []).map(item => ({ key: item.itemId }));
    const sameOrder = previousProducts.current.orderId === id;
    const before = sameOrder ? previousProducts.current.items : [];
    setSelectedProductId(current => selectItemAfterChange(before, items, sameOrder ? current : '', false));
    previousProducts.current = { orderId: id, items };
  }, [id, detail.data?.items]);
  const [noteResultUnknown, setNoteResultUnknown] = useState(false);
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ kind: 'information' | 'item' | 'amount'; order: Detail; itemId?: string; reopened?: Detail } | null>(null);
  const imageActions = useRef<EditImageActions | null>(null);
  const { session: imageSession, ready: imageSessionReady } = useEditImageSession(account?.accountId || '', id);
  const [discardingImages, setDiscardingImages] = useState(false);
  const [imageDraft, setImageDraft] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [imageWriting, setImageWriting] = useState(false);
  const [exportWriting, setExportWriting] = useState(false);
  const imageDraftChange = useCallback((dirty: boolean) => setImageDraft(dirty), []);
  const editorDirtyChange = useCallback((dirty: boolean) => setEditorDirty(dirty), []);
  useEffect(() => { onEditDirtyChange(Boolean(note.trim()) || Boolean(deleteReason.trim()) || imageDraft || editorDirty); return () => onEditDirtyChange(false); }, [note, deleteReason, imageDraft, editorDirty, onEditDirtyChange]);
  const imageWritingChange = useCallback((pending: boolean) => { setImageWriting(pending); }, [onWritingChange]);
  const exportWritingChange = useCallback((pending: boolean) => { setExportWriting(pending); }, [onWritingChange]);
  const page = useRef<object | null>(null);
  useEffect(() => {
    page.current = {};
    return () => { page.current = null; onWritingChange(false); };
  }, [onWritingChange]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ path, body, method = 'POST' }: { path: string; body: unknown; method?: string }) => {
      if (['information', '', 'items', 'images-only'].includes(path)) await imageActions.current?.validate();
      if (path === 'images-only') return api<Detail>(`/orders/${id}`);
      if (path === 'notes') { await api(`/orders/${id}/${path}`, { method, body }); return null; }
      return api<Detail>(`/orders/${id}${path ? `/${path}` : ''}`, { method, body });
    },
    onMutate: () => {
      if (!page.current) throw new DOMException('Aborted', 'AbortError');
      setMessage('');
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
        if (variables.path === 'items') {
          const added = updated.items.find(item => !previous?.items.some(old => old.itemId === item.itemId));
          if (added) setSelectedProductId(added.itemId);
        }
      }
      const returnedToBase = previous?.version === (variables.body as { expectedVersion?: number }).expectedVersion && previous?.status !== 'CAKE_BASE' && updated?.status === 'CAKE_BASE';
      const action = (variables.body as { action?: string }).action;
      const informationChanges = (variables.body as { changes?: Record<string, unknown> }).changes;
      const amountOnly = variables.path === 'information' && informationChanges && Object.keys(informationChanges).every(key => ['totalAmountCents', 'originalAmountCents', 'memberAmountCents'].includes(key));
      const rollbackMessage = variables.path === 'restart' ? '订单已恢复至出胚，商品制作确认已重置，付款和历史记录保留。'
        : updated && ['ROLLBACK_PRODUCTION', 'REOPEN_PRODUCTION', 'ROLLBACK_FULFILLMENT'].includes(action || '') ? `订单已退回${statusLabel(updated)}。${updated.status === 'CAKE_BASE' ? '商品制作确认已重置。' : '商品制作勾选保留。'}` : '';
      setMessage(variables.path === 'images-only' ? '资料未改动，图片正在转入上传队列。' : variables.path === '' ? '商品已保存' : variables.path === 'items' ? `商品已添加。${returnedToBase ? '制作节点已重置，请重新确认。' : ''}` : variables.path.endsWith('/remove') ? '商品已移除' : variables.path.endsWith('/production-status') ? '商品制作状态已保存' : variables.path === 'notes' ? '备注已发布' : variables.path === 'information' ? amountOnly ? '金额已保存' : '订单资料已保存' : variables.path === 'payment-status' ? '付款状态已更新' : variables.path === 'cancel' ? '订单已取消' : rollbackMessage || `${actionNames[action || '']}已确认`);
      if (updated && variables.path === 'production-actions' && (variables.body as { action: string }).action === 'REOPEN_PRODUCTION') {
        setEditing(current => current?.kind === 'item' ? { ...current, reopened: updated } : current);
      }
      if (['information', '', 'items', 'images-only'].includes(variables.path)) {
        try { if (updated) await imageActions.current?.commit(updated); }
        catch { setMessage('资料已保存，但图片尚未进入上传队列。请核对资料后继续上传暂存图片。'); setEditing(null); return; }
        setEditing(null);
      }
      if (variables.path === 'notes') { setNote(''); setNoteResultUnknown(false); }
      if (variables.path === 'cancel') { setReason(''); setShowCancel(false); }
      if (variables.path === 'delete') { setDeleteReason(''); setShowDelete(false); setMessage('订单已删除，30 天内可在已删除订单中查询，不可恢复。'); }
      await synchronize(client, id);
    },
    onError: async (error, variables, context) => {
      if (context?.page === page.current) {
        setMessage(variables.path === 'images-only' ? '图片保存准备未完成，图片仍暂存，请重试保存。' : '');
        if (variables.path === 'notes' && creationResultUnknown(error)) setNoteResultUnknown(true);
        await synchronize(client, id);
      }
    },

  });
  useEffect(() => { onWritingChange(mutation.isPending || imageWriting || exportWriting || discardingImages); }, [mutation.isPending, imageWriting, exportWriting, discardingImages, onWritingChange]);
  const fromProduction = returnToCalendar?.startsWith('#/production-query');
  const returnHref = returnToOrders ? '#/admin/orders'
    : fromProduction || returnToCalendar?.startsWith('#/payment-orders?') ? returnToCalendar : null;
  const returnLabel = returnToOrders ? '返回查询结果' : fromProduction ? '返回待制作查询' : '返回付款订单列表';
  if (!account || detail.isPending) return <Loading />;
  if (!detail.data) return <>{returnHref && <a className="back-link" href={returnHref}><ArrowLeft />{returnLabel}</a>}<ErrorNotice error={detail.error} retry={() => void detail.refetch()} /></>;
  const order = detail.data;
  const unknownStatus = !Object.hasOwn(statusNames, order.status);
  const readOnly = unknownStatus || Boolean(order.deletion || order.deleted || detail.error instanceof ApiError && detail.error.code === 'ORDER_DELETED_FORBIDDEN');
  const removedDraft = editing?.kind === 'item' && editing.itemId && !order.items.some(item => item.itemId === editing.itemId) ? editing.order.items.find(item => item.itemId === editing.itemId) : undefined;
  const visibleItems = removedDraft ? [...order.items, removedDraft] : order.items;
  const displayedProductId = editing?.kind === 'item' && editing.itemId ? editing.itemId : selectedProductId;
  const productIndex = Math.max(0, visibleItems.findIndex(item => item.itemId === displayedProductId));
  const currentProduct = visibleItems[productIndex];
  const switchingProductsBlocked = mutation.isPending || Boolean(editing) || imageDraft || imageWriting || exportWriting;
  const switchProduct = (offset: number) => {
    const product = visibleItems[productIndex + offset];
    if (!product || switchingProductsBlocked) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelectedProductId(product.itemId);
    requestAnimationFrame(() => productNavigation.current?.scrollIntoView({ block: 'start' }));
  };
  const busy = discardingImages || mutation.isPending || Boolean(editing) || imageDraft || imageWriting || exportWriting;
  const blocked = busy || readOnly;
  const itemMutation = mutation.variables?.path === '' || mutation.variables?.path === 'items' || mutation.variables?.path.endsWith('/remove');
  const cancelEdit = async () => {
    if (mutation.isPending || imageWriting || discardingImages) return;
    setDiscardingImages(true);
    try { await imageActions.current?.discard(); setEditing(null); mutation.reset(); }
    catch { setMessage('暂存图片未能清理，编辑内容已保留，请重试取消。'); }
    finally { setDiscardingImages(false); }
  };
  const saveUnchanged = async () => { if (imageActions.current?.hasImages()) await mutation.mutateAsync({ path: 'images-only', body: {}, method: 'GET' }); else await cancelEdit(); };
  const itemEditor = editing?.kind === 'item' ? <ItemEdit initial={editing.order} itemId={editing.itemId} latest={order} reopened={editing.reopened} busy={mutation.isPending || imageWriting || discardingImages || readOnly} error={mutation.error} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'item' in request ? 'items' : '', method: 'item' in request ? 'POST' : 'PATCH', body: request })} onSaveUnchanged={saveUnchanged} onCancel={() => void cancelEdit()} /> : null;
  const itemsReady = order.items.every(item => item.productionStatus === 'COMPLETED');
  const production = nextProductionAction[order.status];
  const previous = readOnly ? null : previousOrderStep(order);
  const fulfillment = order.status === 'WAITING_DELIVERY'
    ? order.fulfillment.type === 'PICKUP' ? 'CONFIRM_PICKUP' : 'COMPLETE_DELIVERY'
    : null;
  const mutateAction = (action: string, path: string) => mutation.mutate({ path, body: { expectedVersion: order.version, action } });
  const moveBack = () => {
    if (!previous) return;
    const impact = previous.resetItems ? '全部商品的制作完成勾选将清空，制作阶段重置。' : '保留商品的制作完成勾选。';
    if (window.confirm(`${previous.label}？${impact}订单资料、付款和历史记录保留。`)) mutation.mutate({ path: previous.path, body: { expectedVersion: order.version, ...(previous.action ? { action: previous.action } : {}) } });
  };
  const frontDeskView = access.customer && access.business;
  const ProductView = frontDeskView ? FrontProductDetails : Product;
  const productNavigationView = currentProduct && <div className="item-card-navigation detail-item-navigation" ref={productNavigation} role="group" aria-label="商品切换">
        <button type="button" className="secondary icon-button" aria-label="上一个商品" disabled={switchingProductsBlocked || productIndex === 0} onClick={() => switchProduct(-1)}><ArrowLeft /></button>
        <div className="item-card-caption"><span aria-live="polite">第 {productIndex + 1} / {visibleItems.length} 个商品{removedDraft && currentProduct.itemId === removedDraft.itemId ? ' · 已移除' : ''}</span><strong>{currentProduct.name}</strong></div>
        <button type="button" className="secondary icon-button" aria-label="下一个商品" disabled={switchingProductsBlocked || productIndex >= visibleItems.length - 1} onClick={() => switchProduct(1)}><ArrowRight /></button>
      </div>;
  const checklist = <><div className="production-checklist-heading"><h3>商品备齐</h3><span>{order.items.filter(item => item.productionStatus === 'COMPLETED').length} / {order.items.length} 项完成</span><button type="button" className="text-button" onClick={() => { const images = document.getElementById('order-reference-images'); images?.scrollIntoView({ behavior: 'instant', block: 'start' }); images?.focus({ preventScroll: true }); }}>查看参考图</button></div>
      <ul className="production-checklist">{order.items.map(item => <li key={item.itemId}><label className={item.productionStatus === 'COMPLETED' ? 'is-complete' : ''}>{hasPermissions(account, 'ORDER_PRODUCTION_UPDATE') && <input type="checkbox" aria-label={`${item.name}制作完成`} checked={item.productionStatus === 'COMPLETED'} disabled={blocked || !productionStatuses.includes(order.status) || !hasPermissions(account, 'ORDER_PRODUCTION_UPDATE')} onChange={event => mutation.mutate({ path: `items/${item.itemId}/production-status`, method: 'PATCH', body: { expectedVersion: order.version, completed: event.target.checked } })} />}<span>{item.name}</span><strong>×{item.quantity}</strong><small>{item.productionStatus === 'COMPLETED' ? '已完成' : '待完成'}</small></label></li>)}</ul></>;
  const images = <OrderImages key={id} order={order} itemId={currentProduct?.itemId} accountId={account?.accountId || ''} canUpload={hasPermissions(account, 'ORDER_IMAGE_UPLOAD')} canDelete={hasPermissions(account, 'ORDER_IMAGE_DELETE')} productionView={access.productionView} compact={frontDeskView || access.productionView} ownerSession={imageSessionReady ? imageSession.current : undefined} editSession={editing ? imageSession.current : undefined} editActions={imageActions} recover={!readOnly && hasPermissions(account, 'ORDER_EDIT') ? session => { imageSession.current = session; setEditing({ kind: 'information', order }); mutation.reset(); } : undefined} blocked={mutation.isPending || discardingImages || Boolean(editing?.kind === 'item' && !editing.itemId) || exportWriting || readOnly} onDraftChange={imageDraftChange} onWritingChange={imageWritingChange} />;
  const paymentPanel = access.amounts && <section className="panel payment-panel"><div className="section-heading payment-heading"><h2>金额与付款</h2>{hasPermissions(account, 'ORDER_EDIT') && !editing && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'amount', order }); }}><NotePencil />修改金额</button>}</div>{editing?.kind === 'amount' && <div className="amount-editor"><InformationEdit amountOnly initial={editing.order} latest={order} busy={mutation.isPending || imageWriting || discardingImages || readOnly} error={mutation.variables?.path === 'information' ? mutation.error : null} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'information', method: 'PATCH', body: request })} onSaveUnchanged={saveUnchanged} onCancel={() => void cancelEdit()} /></div>}<div><dl className="order-quoted-prices"><div><dt>原价</dt><dd>{money(order.originalAmountCents ?? (order.memberAmountCents == null ? order.totalAmountCents : null))}</dd></div><div><dt>会员价</dt><dd>{money(order.memberAmountCents ?? null)}</dd></div></dl><p className="muted">成交金额</p><strong className="order-amount">{money(order.totalAmountCents)}</strong>{order.paymentStatus === 'PAID' && <p className="form-help">付款时间：{order.paidAt ? businessTime(order.paidAt) : '历史付款时间未记录'}</p>}</div>{access.amounts && <Payment status={order.paymentStatus} />}<p>支付方式：{paymentMethodLabel(order.paymentMethod, order.paymentStatus)}</p>{hasPermissions(account, 'ORDER_PAYMENT_UPDATE') && <OrderPaymentEditor key={order.version} order={order} disabled={blocked} save={paymentMethod => mutation.mutate({ path: 'payment-status', method: 'PATCH', body: { expectedVersion: order.version, paymentStatus: paymentMethod === 'UNPAID' ? 'UNPAID' : 'PAID', paymentMethod } })} />}</section>;
  return <div className={`detail-page ${access.productionView ? 'production-detail' : ''}`}>
    {returnHref && <a className="back-link" href={returnHref} aria-disabled={mutation.isPending || imageWriting || exportWriting} onClick={event => { if (mutation.isPending || imageWriting || exportWriting) event.preventDefault(); }}><ArrowLeft />{returnLabel}</a>}
    <div className="page-heading"><h1>订单 #{order.orderNo}</h1><div className="badges"><Status order={order} />{access.amounts && <Payment status={order.paymentStatus} />}</div></div>
    {access.customer && <CustomerOrderOrigin orderId={id} />}
    {order.deletion && <div className="notice" role="status"><p>已删除 · {time(order.deletion.deletedAt, true)} · {order.deletion.employeeName}</p><p>删除原因：{order.deletion.reason}</p><p>保留至 {time(order.deletion.expiresAt, true)}，到期永久清理；不参与工作台和经营统计。</p>{editing && <button type="button" className="secondary" onClick={() => { if (window.confirm('关闭未保存的编辑草稿？')) cancelEdit(); }}>关闭编辑草稿</button>}</div>}
    {readOnly && !order.deletion && <div className="notice" role="status">订单已删除，当前页面只保留原有资料和未保存输入，不可继续操作。{editing && <button type="button" className="secondary" onClick={() => { if (window.confirm('关闭未保存的编辑草稿？')) cancelEdit(); }}>关闭编辑草稿</button>}</div>}
    <ErrorNotice error={detail.error} retry={() => void detail.refetch()} />
    <div className="feedback" aria-live="polite">{message && (!itemMutation || canEditItems(order)) && <div className="notice success"><CheckCircle />{message}<button type="button" className="text-button" aria-label="关闭操作提示" onClick={() => setMessage('')}>关闭</button></div>}<ErrorNotice error={editing || (noteResultUnknown && mutation.variables?.path === 'notes') ? null : mutation.error} /></div>
    <div className="detail-summary">{unknownStatus && <p className="notice" role="alert">页面暂不识别此订单状态，订单仍可查看。请保存当前内容后刷新页面，更新前暂停业务操作。</p>}
    <section className="panel detail-status production-summary"><div className="section-heading"><h2><Clock />制作摘要</h2><span className="muted">{order.items.length} 项 · {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</span></div>
      <OrderProgress order={order} />
      <div className="actions">
        {previous && hasPermissions(account, ...previous.permissions) && <button className="secondary" disabled={mutation.isPending || imageDraft || imageWriting || exportWriting || Boolean(editing && !(previous.action === 'REOPEN_PRODUCTION' && editing.kind === 'item'))} onClick={moveBack}><ArrowLeft />{previous.label}</button>}
        {production && hasPermissions(account, 'ORDER_PRODUCTION_UPDATE') && <button className="primary" disabled={blocked || production === 'COMPLETE_DECORATION' && !itemsReady} onClick={() => mutateAction(production, 'production-actions')}>{actionNames[production]}<ArrowRight /></button>}
        {fulfillment && hasPermissions(account, 'ORDER_FULFILLMENT_UPDATE') && <button className="primary" disabled={blocked} onClick={() => mutateAction(fulfillment, 'fulfillment-actions')}>{actionNames[fulfillment]}<ArrowRight /></button>}
      </div>
      {!itemsReady && hasPermissions(account, 'ORDER_PRODUCTION_UPDATE') && production === 'COMPLETE_DECORATION' && <p className="form-help" role="status">还有 {order.items.filter(item => item.productionStatus !== 'COMPLETED').length} 项商品未完成</p>}
      {!frontDeskView && checklist}
      {access.history && <a className="text-button" href={orderHref(id, returnToCalendar, 'ORDER_PRODUCTION_CHANGED', true)}>制作记录<ArrowRight /></a>}
    </section>
    </div>
    {frontDeskView && <section className="panel front-order-information" aria-labelledby="front-order-information-title">
      <div className="section-heading"><h2 id="front-order-information-title">订单信息</h2>{!editing && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'information', order }); }}><NotePencil />编辑资料</button>}</div>
      {productNavigationView}
      {editing?.kind === 'information' ? <InformationEdit initial={editing.order} latest={order} busy={mutation.isPending || imageWriting || discardingImages || readOnly} error={mutation.variables?.path === 'information' ? mutation.error : null} onDirtyChange={editorDirtyChange} onSave={request => mutation.mutateAsync({ path: 'information', method: 'PATCH', body: request })} onSaveUnchanged={saveUnchanged} onCancel={() => void cancelEdit()} /> : <>
        <dl className="front-order-grid">
          <div><dt>名称</dt><dd>{currentProduct?.name || '暂无商品'}</dd></div>
          <div><dt>下单方式</dt><dd>{order.orderingMethod || '未填写'}</dd></div>
          <div className="detail-business-time"><dt>取货时间</dt><dd>{pickupInstant(order.fulfillment) ? businessTime(pickupInstant(order.fulfillment)!) : `${businessDate(pickupDate(order.fulfillment))} · 时刻待定`}</dd></div>
          <div className="detail-business-time"><dt>出品时间</dt><dd>{order.fulfillment.plannedFinishAt ? businessTime(order.fulfillment.plannedFinishAt) : '待定'}</dd></div>
          <div><dt>客户</dt><dd>{order.customer?.customerName || '未填写'}</dd></div>
          <div className="detail-contact-phone"><dt>电话</dt><dd>{order.customer?.phone ? <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a> : '未填写'}</dd></div>
          <div className="wide detail-contact-address"><dt>地址</dt><dd>{order.fulfillment.type === 'PICKUP' ? `门店自提${order.fulfillment.address ? ` · ${order.fulfillment.address}` : ''}` : order.fulfillment.address || '未填写'}</dd></div>
        </dl>
        <section className="front-order-requirements" aria-labelledby="front-requirements-title"><h3 id="front-requirements-title">特殊要求</h3><p>{orderRequirements(currentProduct ? [currentProduct] : [])[0]?.text || '无'}</p></section>
      </>}
      {images}
      <dl className="front-order-created"><div><dt>下单时间</dt><dd>{order.createdAt ? businessTime(order.createdAt) : '未填写'}</dd></div></dl>
    </section>}
    {access.productionView && <section className="panel production-order-information" aria-labelledby="production-order-information-title">
      <div className="section-heading"><h2 id="production-order-information-title">订单信息</h2></div>
      {visibleItems.length > 1 && productNavigationView}
      <ProductionOrderFields order={order} item={currentProduct} />
      {images}
      <dl className="production-order-fields production-order-contact">
        {access.ordering && <>
          <div><dt>下单人</dt><dd>{order.customer?.buyerName || '未填写'}</dd></div>
          <div><dt>订购方式</dt><dd>{order.orderingMethod || '未填写'}</dd></div>
        </>}
        <div><dt>交接方式</dt><dd>{order.fulfillment.type === 'PICKUP' ? '门店自提' : '配送上门'}</dd></div>
        <div className="detail-business-time"><dt>取货时间</dt><dd>{pickupInstant(order.fulfillment) ? businessTime(pickupInstant(order.fulfillment)!) : `${businessDate(pickupDate(order.fulfillment))} · 时刻待定`}</dd></div>
        {access.phone && <div><dt>客户手机号</dt><dd>{order.customer?.phone ? <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a> : '未填写'}</dd></div>}
      </dl>
    </section>}
    {!frontDeskView && !access.productionView && images}
    {!access.productionView &&
    <section className="panel order-products"><div className="section-heading"><h2>全部商品</h2><div className="item-heading-actions"><span className="muted">共 {order.items.length} 项</span>{access.entry && access.business && canEditItems(order) && <button className="secondary compact" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order }); }}><Plus />添加商品</button>}</div></div>
      {access.entry && access.business && order.status === 'WAITING_DELIVERY' && <p className="form-help">编辑商品前，请先退回装饰。</p>}
      {!frontDeskView && productNavigationView}
      <div className="products detail-products detail-product-card">{visibleItems.slice(productIndex, productIndex + 1).map(item => <ProductView key={item.itemId} item={item} prices={access.amounts} actions={access.entry && access.business && canEditItems(order) && editing?.itemId !== item.itemId && <div className="product-actions"><button className="text-button" disabled={blocked} onClick={() => { mutation.reset(); setMessage(''); setEditing({ kind: 'item', order, itemId: item.itemId }); }}>编辑</button><button className="text-button danger" disabled={blocked || !canRemoveItem(order, item.itemId)} title={order.items.length === 1 ? '至少保留一件有效商品' : undefined} onClick={() => { if (canRemoveItem(order, item.itemId) && window.confirm(`移除「${item.name}」？历史记录会保留，订单约定金额不变。`)) mutation.mutate({ path: `items/${item.itemId}/remove`, body: { expectedVersion: order.version } }); }}><Trash />移除</button></div>}>{editing?.kind === 'item' && editing.itemId === item.itemId ? itemEditor : null}</ProductView>)}</div>
      {visibleItems.length > 1 && <div className="item-card-footer" role="group" aria-label="商品底部切换">
        <button type="button" className="secondary" disabled={switchingProductsBlocked || productIndex === 0} onClick={() => switchProduct(-1)}><ArrowLeft />上一项</button>
        <span>{productIndex + 1} / {visibleItems.length}</span>
        <button type="button" className="secondary" disabled={switchingProductsBlocked || productIndex >= visibleItems.length - 1} onClick={() => switchProduct(1)}>下一项<ArrowRight /></button>
      </div>}
      {editing?.kind === 'item' && !editing.itemId && <div className="item-add"><h3>添加商品</h3>{itemEditor}</div>}
    </section>}
    {frontDeskView && paymentPanel}
    <details className="panel note-panel" aria-label="工作沟通备注"><summary>工作备注与沟通</summary><div className="section-heading"><h2><NotePencil />工作备注与沟通</h2><a className="text-button" href={orderHref(id, returnToCalendar, 'NOTE', true)}>全部备注<ArrowRight /></a></div>
    {noteResultUnknown && <div className="notice" role="alert"><p>发布结果未确认，输入已保留。请先核对备注记录，确认未保存后再重发。</p><button type="button" className="secondary compact" disabled={blocked} onClick={() => { setNoteResultUnknown(false); mutation.reset(); }}>已核对未保存，允许重发</button></div>}
    {hasPermissions(account, 'ORDER_NOTE_CREATE') && <form className="note-form" onSubmit={event => { event.preventDefault(); if (!blocked && !noteResultUnknown && note.trim() && (!itemId || order.items.some(item => item.itemId === itemId))) mutation.mutate({ path: 'notes', body: { itemId: itemId || null, content: note.trim() } }); }}>
      <label>备注对象<Select label="备注对象" value={itemId} onChange={setItemId} disabled={mutation.isPending || readOnly}><option value="">整张订单</option>{order.items.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}{itemId && !order.items.some(item => item.itemId === itemId) && <option value={itemId}>已移除的商品，请重新选择</option>}</Select></label>
      <label className="note-content">备注内容<textarea placeholder="记录制作、交接过程中的沟通信息" value={note} onChange={event => setNote(event.target.value)} required disabled={mutation.isPending || readOnly} rows={3} /></label>
      <button className="primary" disabled={blocked || noteResultUnknown || !note.trim() || Boolean(itemId && !order.items.some(item => item.itemId === itemId))}>发布备注<ArrowRight /></button>
    </form>}
      {access.productionView && currentProduct && <RecentProductNotes item={currentProduct} />}
      <ActivityFeed id={id} type="NOTE" items={order.items} preview />
    </details>
    {frontDeskView && <details className="panel order-supplement"><summary>补充资料</summary><dl className="info-grid supplementary-contact">
      <div><dt>下单员工（业绩归属）</dt><dd>{order.creditedEmployee ? `${order.creditedEmployee.nickname} · ${order.creditedEmployee.employeeNumber}` : '未归属'}</dd></div>
      <div><dt>会员手机</dt><dd>{order.customer?.memberPhone || '未填写'}</dd></div>
      <div><dt>订购人姓名</dt><dd>{order.customer?.buyerName || '未填写'}</dd></div>
      <div><dt>交接方式</dt><dd>{order.fulfillment.type === 'PICKUP' ? '门店自提' : '配送上门'}</dd></div>
    </dl>{checklist}{currentProduct && <FrontProductSupplement item={currentProduct} />}</details>}
    {access.export && <SingleOrderExport orderId={id} orderNo={order.orderNo} blocked={busy} onPendingChange={exportWritingChange} />}
    {order.status === 'CANCELLED' && <Empty>{access.history ? '订单已取消，历史记录保留。' : '订单已取消，制作资料保留。'}</Empty>}
    {!frontDeskView && paymentPanel}
    {access.history && <details className="panel operation-history" aria-label="操作记录"><summary>操作记录</summary><div className="section-heading"><h2><ListBullets />最近操作记录</h2><a className="text-button" href={orderHref(id, returnToCalendar, undefined, true)}>全部操作记录<ArrowRight /></a></div><ActivityFeed id={id} items={order.items} preview /></details>}
    {hasPermissions(account, 'ORDER_CANCEL') && !readOnly && !['COMPLETED', 'CANCELLED'].includes(order.status) && <section className="cancel-section"><button className="danger-button" disabled={blocked} onClick={() => setShowCancel(!showCancel)} aria-expanded={showCancel}>取消订单</button>{showCancel && <form onSubmit={event => { event.preventDefault(); if (!blocked) mutation.mutate({ path: 'cancel', body: { expectedVersion: order.version, reason: reason.trim() } }); }}><label>取消原因<input value={reason} onChange={event => setReason(event.target.value)} required disabled={mutation.isPending} /></label><button className="danger-button" disabled={blocked || !reason.trim()}>确认取消订单</button></form>}</section>}
    {access.delete && !readOnly && <section className="cancel-section"><button type="button" className="danger-button" disabled={blocked} aria-expanded={showDelete} onClick={() => setShowDelete(value => !value)}>删除订单</button>{showDelete && <form onSubmit={event => { event.preventDefault(); if (!blocked && deleteReason.trim() && window.confirm(`确认删除订单 #${order.orderNo}？将退出工作台和经营统计，30 天内仅可查询，不可恢复，到期永久清理。`)) mutation.mutate({ path: 'delete', body: { expectedVersion: order.version, reason: deleteReason.trim() } }); }}><label>删除原因<textarea value={deleteReason} maxLength={1000} required disabled={mutation.isPending} onChange={event => setDeleteReason(event.target.value)} /></label><button className="danger-button" disabled={blocked || !deleteReason.trim()}>确认删除订单</button></form>}</section>}
  </div>;
}
