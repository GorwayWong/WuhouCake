import { useEffect, useId, useRef, useState } from 'react';
import { isCancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, fetchPackageImage } from './api';
import { Select } from './Select';
import { isEmptyPackageDraft, packageImagePath, packageSummary, previewPackage } from './orderPackages';
import type { OrderPackage } from './orderPackages';
import type { OrderDraft } from './orderForm';
import { saveDraftImageBatch, removeDraftImage, localImageError } from './draftImages';
import type { ImageScope } from './draftImages';
import { money } from './ui';
import { PackageDialog } from './PackageDialog';
import type { Page } from './types';

export function OrderPackagePicker({ draft, getDraft, onChange, disabled, imageScope, canUploadImages, onImageWritingChange }: {
  draft: OrderDraft; getDraft: () => OrderDraft; onChange: (draft: OrderDraft) => boolean; disabled: boolean;
  imageScope: ImageScope; canUploadImages: boolean; onImageWritingChange: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams({ keyword: search, page: String(page), size: '20' });
  const query = useQuery({ queryKey: ['order-packages', params.toString()], queryFn: ({ signal }) => api<Page<OrderPackage>>(`/order-packages?${params}`, { signal }), refetchOnMount: 'always', enabled: expanded });
  const [selected, setSelected] = useState(''), [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState<unknown>(null);
  const chosen = query.data?.items.find(value => value.id === selected);
  const latest = useRef({ getDraft, onChange, disabled }); latest.current = { getDraft, onChange, disabled };
  const [review, setReview] = useState<OrderPackage | null>(null);
  const [missingOrder, setMissingOrder] = useState(''), [missingPackage, setMissingPackage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const needOrderPrice = !isEmptyPackageDraft(draft) && !draft.totalAmount.trim();
  let preview: ReturnType<typeof previewPackage> | undefined, previewError = '';
  if (review) try { preview = previewPackage(draft, review, missingOrder, missingPackage); }
  catch (failure) { previewError = (failure as Error).message; }
  const active = useRef<AbortController | null>(null);
  const readKey = useRef<readonly string[] | null>(null);
  useEffect(() => () => { active.current?.abort(); if (readKey.current) void client.cancelQueries({ queryKey: readKey.current, exact: true }); }, [client]);
  useEffect(() => {
    if (!query.isSuccess || query.isFetching) return;
    const last = Math.max(1, Math.ceil(query.data.total / query.data.size));
    if (page > last) { setPage(last); setSelected(''); }
    else if (selected && !query.data.items.some(value => value.id === selected)) { setSelected(''); setMessage('所选套餐已更新或已移出当前列表，请重新选择。已填写商品保持不变。'); }
  }, [query.data, query.isSuccess, query.isFetching, page, selected]);
  async function apply(value: OrderPackage, plan: ReturnType<typeof previewPackage>, before: OrderDraft, controller: AbortController) {
    if (plan.imageSources.size && !canUploadImages) throw new Error('当前岗位不能带入图片，请由可上传图片的员工录单。');
    const entries = await Promise.all([...plan.imageSources].map(async ([itemId, item]) => {
      const blob = await fetchPackageImage(packageImagePath(value.id, item), controller.signal);
      return { itemId, file: new File([blob], `${item.name}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type }) };
    }));
    if (controller.signal.aborted || latest.current.getDraft() !== before) throw new Error('草稿已有变化，请核对更新后的预览。');
    let images: Awaited<ReturnType<typeof saveDraftImageBatch>>;
    try { images = await saveDraftImageBatch(imageScope, entries); }
    catch (failure) { throw new Error(localImageError(failure)); }
    const byItem = new Map(entries.map((entry, index) => [entry.itemId, images[index]]));
    const next = { ...plan.next, items: plan.next.items.map(item => byItem.has(item.key) ? { ...item, images: [byItem.get(item.key)!] } : item) };
    let applied = false;
    try {
      if (controller.signal.aborted || latest.current.getDraft() !== before || !latest.current.onChange(next))
        throw new Error('草稿已有变化或无法保存，请核对后重试。');
      applied = true;
    } finally {
      if (!applied) await Promise.all(entries.map((entry, index) => removeDraftImage(imageScope, entry.itemId, images[index].id)));
    }
    setReview(null); setAdded(current => [...current, value.id]);
    setMessage(`已带入「${value.name}」，请核对商品和整单金额。`);
  }
  async function append() {
    if (!chosen || active.current || disabled) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setMessage('');
    const key = ['order-packages', 'detail', chosen.id]; readKey.current = key;
    let writing = false;
    try {
      const value = await client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => api<OrderPackage>(`/order-packages/${chosen.id}`, { signal }), staleTime: 0, gcTime: 0 });
      if (controller.signal.aborted || latest.current.disabled) return;
      const before = latest.current.getDraft();
      if (isEmptyPackageDraft(before) && value.originalAmountCents !== null) {
        writing = true; onImageWritingChange(true);
        await apply(value, previewPackage(before, value), before, controller);
      } else {
        setMissingOrder(''); setMissingPackage(''); setReviewError(''); setReview(value);
      }
    } catch (failure) { if (!controller.signal.aborted) {
      if (isCancelledError(failure)) setMessage('套餐内容已更新，当前录单内容已保留，请核对后重新带入。');
      else { setError(failure instanceof ApiError ? failure : null); if (failure instanceof Error && !(failure instanceof ApiError)) setMessage(failure.message); void query.refetch(); }
    } }
    finally {
      if (writing) onImageWritingChange(false);
      if (active.current === controller) { active.current = null; readKey.current = null; setBusy(false); }
    }
  }
  async function confirm() {
    if (!review || !preview || active.current || disabled) return;
    const before = latest.current.getDraft();
    if (before !== draft) { setReviewError('草稿已变化，请核对更新后的预览。'); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onImageWritingChange(true); setReviewError('');
    try { await apply(review, preview, before, controller); }
    catch (failure) { if (!controller.signal.aborted) setReviewError(failure instanceof ApiError || !(failure instanceof Error) ? errorText(failure) : failure.message); }
    finally { active.current = null; setBusy(false); onImageWritingChange(false); }
  }
  return <div className="package-picker-section">
    <button type="button" className="text-button package-toggle" aria-expanded={expanded} aria-controls={contentId} disabled={disabled || busy} onClick={() => setExpanded(value => !value)}>{expanded ? '收起套餐' : '使用套餐'}</button>
    <div id={contentId} className="package-picker" hidden={!expanded}>
    <div className="package-actions"><label>搜索套餐<input value={keyword} placeholder="输入套餐名称" maxLength={80} disabled={disabled || busy} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSearch(keyword.trim()); setPage(1); setSelected(''); } }} /></label>
      <button type="button" className="secondary" disabled={disabled || busy} onClick={() => { setSearch(keyword.trim()); setPage(1); setSelected(''); void query.refetch(); }}>搜索</button>
      <label>选择套餐<Select label="选择套餐" value={selected} onChange={setSelected} disabled={disabled || busy || query.isPending}>
        <option value="">{query.isPending ? '正在读取…' : '选择套餐'}</option>{query.data?.items.map(value => <option key={value.id} value={value.id}>{value.name} · {value.items.length} 项</option>)}
      </Select></label><button type="button" className="secondary" disabled={disabled || busy || !chosen} onClick={() => void append()}>{busy ? '正在读取…' : added.includes(selected) ? '再添加一份' : '带入商品'}</button></div>
    {chosen && <p className="package-summary">{chosen.items.length} 项商品：{packageSummary(chosen)}</p>}
    {query.data && query.data.total > 20 && <div className="package-actions"><button type="button" className="text-button" disabled={disabled || busy || page === 1} onClick={() => { setPage(page - 1); setSelected(''); }}>上一页</button><span>第 {page} 页，共 {query.data.total} 个套餐</span><button type="button" className="text-button" disabled={disabled || busy || page * 20 >= query.data.total} onClick={() => { setPage(page + 1); setSelected(''); }}>下一页</button></div>}
    {query.data?.total === 0 && <p className="muted">{search ? '没有匹配的套餐。' : '暂无套餐，请联系店长维护。'}</p>}
    <p className="form-help">带入时累加整单金额。同名且同规格的其他商品会合并数量。</p>
    {message && <p role="status">{message}</p>}{(error || query.error) && <p className="field-error" role="alert">{errorText(error || query.error)}</p>}
    </div>
    {review && <PackageDialog title="确认带入套餐" busy={busy} onCancel={() => setReview(null)}>
      <p>「{review.name}」将带入 {review.items.length} 项商品。请核对合并结果和整单金额。</p>
      {needOrderPrice && <label className="package-price-input">当前订单原价（元）<input inputMode="decimal" value={missingOrder} disabled={busy} onChange={e => setMissingOrder(e.target.value)} /></label>}
      {review.originalAmountCents === null && <label className="package-price-input">此套餐原价（元）<input inputMode="decimal" value={missingPackage} disabled={busy} onChange={e => setMissingPackage(e.target.value)} /></label>}
      {preview && <><ul className="package-merge-list">{preview.changes.map((change, index) => <li key={index}>
        <strong>{change.name}</strong>{change.specification && <span className="product-spec-text">{change.specification}</span>}
        <span>{change.previousQuantity ? `合并到商品 ${change.index + 1}：${change.previousQuantity} → ${change.count}` : `新增 × ${change.count}`} · {change.image}</span>
      </li>)}</ul>
      <dl className="package-amount-preview"><div><dt>订单原价</dt><dd>{money(preview.beforeOriginal)} → <strong>{money(preview.original)}</strong></dd></div>
        <div><dt>订单会员价</dt><dd>{money(preview.beforeMember)} → <strong>{money(preview.member)}</strong></dd></div></dl></>}
      {(reviewError || previewError) && <p className="field-error" role="alert">{reviewError || previewError}</p>}
      <div className="package-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setReview(null)}>取消</button>
        <button type="button" className="primary" disabled={busy || disabled || !preview} onClick={() => void confirm()}>{busy ? '正在带入…' : '确认带入'}</button></div>
    </PackageDialog>}
  </div>;
}
