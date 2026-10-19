import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, authenticatedFetch } from './api';
import { today } from './dates';
import { EmployeeSelect } from './EmployeeSelect';
import { exportOptions, saveExportFile } from './exportFiles';
import { defaultManagementDraft, exactYuan, managementQuery, orderPageSize, orderPagination } from './management';
import { DateInput } from './DateInput';
import { Select } from './Select';
import type { ManagementDraft, ManagementView } from './management';
import { Empty, ErrorNotice, Loading, Payment, Status } from './ui';

interface ReportRow { orderId: string; orderNo: string; receiveDate: string; status: string; paymentStatus: string;
  customerName: string | null; phone: string; employeeNumber: string | null; employeeName: string | null;
  totalAmountCents: string | null; matchingQuantity: number; cakeQuantity: number; products: string }
interface SizeSummary { size: string | null; orderCount: number; cakeQuantity: number }
interface EmployeeSummary { employeeId: string | null; employeeNumber: string | null; employeeName: string | null; orderCount: number;
  matchingQuantity: number; cakeQuantity: number; totalAmountCents: string; paidAmountCents: string; unpaidAmountCents: string; missingAmountOrders: number }
interface Report { items: ReportRow[]; totals: { orderCount: number; matchingQuantity: number; cakeQuantity: number; unclassifiedCakeQuantity: number; totalAmountCents: string;
  paidAmountCents: string; unpaidAmountCents: string; missingAmountOrders: number }; sizes: SizeSummary[]; employees: EmployeeSummary[]; page: number; size: number }
function OrderPagination({ total, page, busy, onPage, bottom = false }: {
  total: number; page: number; busy: boolean; onPage: (page: number) => void; bottom?: boolean;
}) {
  const state = orderPagination(total, page);
  return <nav className="order-pagination" aria-label={bottom ? '订单明细分页（下方）' : '订单明细分页（上方）'}>
    <span className="page-range" aria-live="polite">共 {state.total} 单{state.total > 0 && ` · 第 ${state.from}–${state.through} 单`}</span>
    {!bottom && <span className="page-size">每页 {orderPageSize} 条</span>}
    <div className="page-buttons"><button type="button" className="secondary" disabled={busy || state.current === 1} onClick={() => onPage(state.current - 1)}>上一页</button>
      {state.pages.map((entry, index) => entry === 'gap' ? <span className="page-gap" aria-hidden="true" key={`gap-${index}`}>…</span> : <button type="button" className="page-button" aria-label={`第 ${entry} 页`} aria-current={entry === state.current ? 'page' : undefined} disabled={busy || entry === state.current} key={entry} onClick={() => onPage(entry)}>{entry}</button>)}
      <button type="button" className="secondary" disabled={busy || state.current === state.last} onClick={() => onPage(state.current + 1)}>下一页</button></div>
    <span className="page-count">第 {state.current} / {state.last} 页</span>
  </nav>;
}
export function AdminOrders({ initialView, onViewChange, onOpenOrder, onWritingChange }: {
  initialView?: ManagementView | null; onViewChange: (view: ManagementView) => void; onOpenOrder: (id: string) => void; onWritingChange: (pending: boolean) => void;
}) {
  const [draft, setDraft] = useState<ManagementDraft>(() => initialView?.draft || defaultManagementDraft(today()));
  const [applied, setApplied] = useState(initialView?.applied || draft);
  const [page, setPage] = useState(initialView?.page || 1);
  const [validation, setValidation] = useState('');
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); onWritingChange(false); }, [onWritingChange]);
  const params = managementQuery(applied);
  const query = useQuery({ queryKey: ['management-orders', params, page, orderPageSize], queryFn: ({ signal }) => api<Report>(`/admin/orders?${params}&page=${page}&size=${orderPageSize}`, { signal }) });
  const pagination = orderPagination(query.data?.totals.orderCount || 0, page);
  const outsidePage = Boolean(query.data && page > pagination.last);
  useEffect(() => { if (outsidePage) setPage(pagination.last); }, [outsidePage, pagination.last]);
  useEffect(() => { onViewChange({ draft, applied, page }); }, [draft, applied, page, onViewChange]);
  const openOrder = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (busy) { event.preventDefault(); return; }
    onViewChange({ draft, applied, page }); onOpenOrder(id);
  };
  const change = <K extends keyof ManagementDraft>(key: K, value: ManagementDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); setValidation(''); };
  const modified = JSON.stringify(draft) !== JSON.stringify(applied);
  const drill = (changes: Partial<ManagementDraft>) => { const next = { ...applied, ...changes }; setDraft(next); setApplied(next); setPage(1); setNotice('已按所选分组筛选明细。'); };
  const preset = (period: 'today' | 'month' | 'receive') => {
    const date = today(), next = defaultManagementDraft(date);
    if (period === 'today') next.from = date;
    if (period === 'receive') next.dateBasis = 'RECEIVE';
    setDraft(next); setApplied(next); setPage(1); setValidation(''); setNotice('');
    if (managementQuery(next) === params && page === 1) void query.refetch();
  };
  async function download() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onWritingChange(true); setDownloadError(null); setNotice('');
    try {
      const response = await authenticatedFetch(`/admin/orders/export?${params}`, { signal: controller.signal });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new ApiError(response.status, body?.code || `HTTP_${response.status}`); }
      if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new ApiError(502, 'INVALID_EXPORT_RESPONSE');
      const blob = await response.blob(); if (!blob.size) throw new ApiError(502, 'INVALID_EXPORT_RESPONSE');
      if (!controller.signal.aborted) { saveExportFile({ blob, filename: `订单经营明细-${applied.from}-${applied.through}.xlsx` }); setNotice('经营明细已交给浏览器下载，请在下载记录中确认保存。'); }
    } catch (error) { if (!controller.signal.aborted) setDownloadError(error); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
  }
  return <div className="management-page"><div className="page-heading"><div><h1>订单查询与统计</h1></div></div>
    <div className="actions" aria-label="快捷查询"><button type="button" className="secondary" disabled={busy} onClick={() => preset('today')}>今天录入</button><button type="button" className="secondary" disabled={busy} onClick={() => preset('month')}>本月录入</button><button type="button" className="secondary" disabled={busy} onClick={() => preset('receive')}>本月收货（截至今天）</button></div>
    <section className="panel"><form onSubmit={event => { event.preventDefault(); try { managementQuery(draft); setApplied({ ...draft }); setPage(1); setValidation(''); setNotice(''); if (!modified) void query.refetch(); } catch (error) { setValidation((error as Error).message); } }}>
      <fieldset className="export-filters" disabled={busy}>
        <label>日期口径<Select label="日期口径" disabled={busy} value={draft.dateBasis} onChange={value => change('dateBasis', value)}><option value="RECEIVE">收货日期</option><option value="CREATED">录单日期（北京时间）</option></Select></label>
        <label>开始日期<DateInput label="开始日期" disabled={busy} required value={draft.from} onChange={value => change('from', value)} /></label>
        <label>结束日期（含当天）<DateInput label="结束日期（含当天）" disabled={busy} required value={draft.through} onChange={value => change('through', value)} /></label>
        {(['status', 'paymentStatus', 'fulfillmentType'] as const).map(key => <label key={key}>{{ status: '订单状态', paymentStatus: '付款状态', fulfillmentType: '交接方式' }[key]}<Select label={{ status: '订单状态', paymentStatus: '付款状态', fulfillmentType: '交接方式' }[key]} disabled={busy} value={draft[key]} onChange={value => change(key, value)}><option value="">全部</option>{Object.entries(exportOptions[key]).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</Select></label>)}
        <label>蛋糕尺寸（寸）<input inputMode="decimal" value={draft.sizeInches} placeholder="例如 8 或 6.5" onChange={e => { if (/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(e.target.value)) change('sizeInches', e.target.value); else setValidation('尺寸只能填写数字，最多两位小数。'); }} /></label>
        <label>下单员工<EmployeeSelect includeArchived disabled={busy || draft.unassigned} value={draft.creditedEmployeeId} emptyLabel="全部员工" onChange={v => change('creditedEmployeeId', v)} /></label>
        <label>订单号／客户／电话<input value={draft.keyword} maxLength={100} onChange={e => change('keyword', e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={draft.unassigned} onChange={e => change('unassigned', e.target.checked)} />仅未归属订单</label>
        <label className="check-label"><input type="checkbox" checked={draft.includeCancelled} onChange={e => change('includeCancelled', e.target.checked)} />包含已取消订单</label>
      </fieldset>
      {validation && <p role="alert" className="field-error">{validation}</p>}
      <div className="actions"><button className="primary" disabled={busy}>查询</button><button type="button" className="secondary" disabled={busy} onClick={() => { const next = { ...draft, status: '', paymentStatus: '', fulfillmentType: '', sizeInches: '', creditedEmployeeId: '', unassigned: false, includeCancelled: false, keyword: '' }; setDraft(next); setValidation(''); }}>清空其他筛选</button><button type="button" className="secondary" disabled={busy || query.isFetching || Boolean(query.error) || modified} onClick={() => void download()}>{busy ? '正在生成…' : '导出统计与明细 XLSX'}</button></div>
    </form></section>
    {modified && <p className="notice" role="status">条件已修改。点击“查询”后更新结果与导出条件。</p>}
    <ErrorNotice error={query.error} retry={() => void query.refetch()} /><ErrorNotice error={downloadError} />{notice && <p className="notice success" role="status">{notice}</p>}
    {query.isPending || outsidePage ? <Loading /> : query.data && <><dl className="report-totals"><div><dt>匹配订单</dt><dd>{query.data.totals.orderCount} 单</dd></div><div><dt>匹配商品</dt><dd>{query.data.totals.matchingQuantity} 件</dd></div><div><dt>其中蛋糕</dt><dd>{query.data.totals.cakeQuantity} 个</dd></div><div><dt>匹配订单约定总额</dt><dd>¥{exactYuan(query.data.totals.totalAmountCents)}</dd></div></dl>
      <p className="report-range">{applied.from} 至 {applied.through} · {applied.dateBasis === 'CREATED' ? '录单日期' : '收货日期'}</p>
      <div className="report-payment-summary"><span>已付款约定 <strong>¥{exactYuan(query.data.totals.paidAmountCents)}</strong></span><span>未付款约定 <strong>¥{exactYuan(query.data.totals.unpaidAmountCents)}</strong></span>{query.data.totals.missingAmountOrders > 0 && <span>未报价 {query.data.totals.missingAmountOrders} 单</span>}</div>
      <details className="help-details"><summary>统计口径</summary><p>金额为整单约定金额，不等于实收；尺寸筛选不拆分整单金额。同一订单可出现在多个尺寸组。默认不含取消单，最多查询 366 天。</p></details>
      <section className="panel report-group"><h2>蛋糕尺寸统计</h2>{query.data.totals.unclassifiedCakeQuantity > 0 && <p className="form-help">尺寸待核对 {query.data.totals.unclassifiedCakeQuantity} 个</p>}
        {!query.data.sizes.length ? <p className="muted">当前范围内没有蛋糕商品。</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label="蛋糕尺寸统计，可左右滚动"><table className="management-table"><thead><tr><th>尺寸（寸）</th><th>蛋糕数量</th><th>涉及订单</th><th>查看</th></tr></thead><tbody>{query.data.sizes.map(r => <tr key={r.size ?? 'unknown'}><td>{r.size ?? '尺寸待核对'}</td><td>{r.cakeQuantity} 个</td><td>{r.orderCount} 单</td><td>{r.size && <button type="button" className="text-button" disabled={busy || modified} onClick={() => drill({ sizeInches: r.size! })}>查看 {r.size} 寸明细</button>}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel report-group"><h2>员工业绩汇总</h2>
        {!query.data.employees.length ? <p className="muted">当前范围内没有员工业绩。</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label="员工业绩汇总，可左右滚动"><table className="management-table"><thead><tr><th>下单员工</th><th>订单／商品</th><th>已填写约定金额</th><th>标记已付款</th><th>标记未付款</th><th>未填金额</th><th>查看</th></tr></thead><tbody>{query.data.employees.map(r => <tr key={r.employeeId ?? 'unassigned'}><td>{r.employeeName ?? '未归属'}<small>{r.employeeNumber}</small></td><td>{r.orderCount} 单 · {r.matchingQuantity} 件<small>其中蛋糕 {r.cakeQuantity} 个</small></td><td>¥{exactYuan(r.totalAmountCents)}</td><td>¥{exactYuan(r.paidAmountCents)}</td><td>¥{exactYuan(r.unpaidAmountCents)}</td><td>{r.missingAmountOrders} 单</td><td><button type="button" className="text-button" disabled={busy || modified} onClick={() => drill({ creditedEmployeeId: r.employeeId ?? '', unassigned: r.employeeId === null })}>查看员工明细</button></td></tr>)}</tbody></table></div>}
      </section>
      <h2>订单明细</h2>
      <OrderPagination total={query.data.totals.orderCount} page={page} busy={busy || query.isFetching} onPage={setPage} />
      {query.data.items.length > 0 && <p className="form-help table-help">可左右滑动表格，查看完整订单明细。</p>}
      {!query.data.items.length ? <Empty>没有符合条件的订单，可调整日期或筛选条件。</Empty> : <div className="panel table-scroll" tabIndex={0} role="region" aria-label="订单明细，可左右滚动"><table className="management-table"><thead><tr><th>订单／收货日期</th><th>匹配商品</th><th>状态／付款</th><th>客户</th><th>下单员工</th><th>约定金额</th><th>操作</th></tr></thead><tbody>{query.data.items.map(r => <tr key={r.orderId}><td><a className="order-result-link" href={`#/orders/${r.orderId}`} aria-disabled={busy} onClick={event => openOrder(event, r.orderId)}>#{r.orderNo}</a><small>{r.receiveDate}</small></td><td>{r.products}<small>匹配 {r.matchingQuantity} 件，其中蛋糕 {r.cakeQuantity} 个</small></td><td><Status order={{ ...r, currentStageCode: null }} /><Payment status={r.paymentStatus} /></td><td>{r.customerName || '未填写'}<small>{r.phone}</small></td><td>{r.employeeName || '未归属'}<small>{r.employeeNumber}</small></td><td>{r.totalAmountCents == null ? '未填写' : `¥${exactYuan(r.totalAmountCents)}`}</td><td><a className="text-button order-detail-link" href={`#/orders/${r.orderId}`} aria-disabled={busy} onClick={event => openOrder(event, r.orderId)}>查看详情<ArrowRight /></a></td></tr>)}</tbody></table></div>}
      {query.data.items.length > 0 && <OrderPagination total={query.data.totals.orderCount} page={page} busy={busy || query.isFetching} onPage={setPage} bottom />}
    </>}
  </div>;
}
