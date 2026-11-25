import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { isCancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, fetchPackageImage, readQuery } from './api';
import { Select } from './Select';
import { isEmptyPackageDraft, packageImagePath, packageSummary, previewPackage, samePackageContent } from './orderPackages';
import type { OrderPackage } from './orderPackages';
import type { OrderDraft } from './orderForm';
import { saveWorkingDraftImageBatch, removeDraftImage, localImageError } from './draftImages';
import type { ImageScope } from './draftImages';
import { money } from './ui';
import type { Page } from './types';

export function OrderPackagePicker({ draft, getDraft, onChange, disabled, imageScope, canUploadImages, onImageWritingChange, heading, actions }: {
  draft: OrderDraft; getDraft: () => OrderDraft; onChange: (draft: OrderDraft) => boolean; disabled: boolean;
  heading: ReactNode; actions: ReactNode;
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
  const [reviewError, setReviewError] = useState('');
  let preview: ReturnType<typeof previewPackage> | undefined, previewError = '';
  if (review) try { preview = previewPackage(draft, review); }
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
  function readDetail(id: string) {
    const key = ['order-packages', 'detail', id];
    readKey.current = key;
    return client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => readQuery<OrderPackage>(`/order-packages/${id}`, signal),
      staleTime: 0, gcTime: 0, networkMode: 'always', retry: false });
  }
  async function apply(value: OrderPackage, plan: ReturnType<typeof previewPackage>, before: OrderDraft, controller: AbortController) {
    if (plan.imageSources.size && !canUploadImages) throw new Error('当前岗位不能带入图片，请由可上传图片的员工录单。');
    const entries = await Promise.all([...plan.imageSources].map(async ([itemId, item]) => {
      const blob = await fetchPackageImage(packageImagePath(value.id, item), controller.signal);
      return { itemId, file: new File([blob], `${item.name}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type }) };
    }));
    if (controller.signal.aborted || latest.current.getDraft() !== before) throw new Error('草稿已有变化，请核对更新后的预览。');
    let images: Awaited<ReturnType<typeof saveWorkingDraftImageBatch>>;
    try { images = entries.length ? await saveWorkingDraftImageBatch(imageScope, entries) : []; }
    catch (failure) { throw new Error(localImageError(failure)); }
    const byItem = new Map(entries.map((entry, index) => [entry.itemId, images[index]]));
    const next = { ...plan.next, items: plan.next.items.map(item => byItem.has(item.key) ? { ...item, images: [byItem.get(item.key)!] } : item) };
    let applied = false;
    try {
      if (entries.length) {
        if (controller.signal.aborted || latest.current.getDraft() !== before)
          throw new Error('草稿已有变化，请核对更新后的预览。');
        const current = await readDetail(value.id);
        if (current.version !== value.version || !samePackageContent(current, value)) return current;
      }
      if (controller.signal.aborted || latest.current.getDraft() !== before || !latest.current.onChange(next))
        throw new Error('草稿已有变化或无法保存，请核对后重试。');
      applied = true;
    } finally {
      if (!applied) await Promise.allSettled(entries.map((entry, index) => removeDraftImage(imageScope, entry.itemId, images[index].id)));
    }
    setReview(null); setAdded(current => [...current, value.id]);
    setMessage(`已带入「${value.name}」的 ${value.items.length} 项商品。${!next.totalAmount.trim() && !next.memberAmount?.trim() ? '订单金额待补，可先录为未付。' : ''}`);
  }
  async function append() {
    if (!chosen || active.current || disabled) return;
    setReview(null);
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setMessage('');
    let writing = false;
    try {
      const value = await readDetail(chosen.id);
      if (controller.signal.aborted || latest.current.disabled) return;
      const before = latest.current.getDraft();
      const empty = isEmptyPackageDraft(before);
      const plan = previewPackage(before, value);
      if (empty && !plan.resetPayment) {
        writing = true; onImageWritingChange(true);
        const current = await apply(value, plan, before, controller);
        if (current && !controller.signal.aborted) {
          setMessage('套餐内容已更新，当前录单内容已保留，请核对后重新带入。');
          void query.refetch();
        }
      } else {
        setReviewError(''); setReview(value);
      }
    } catch (failure) { if (!controller.signal.aborted) {
      if (failure instanceof ApiError && failure.status === 404 && failure.code === 'PACKAGE_NOT_FOUND') {
        setSelected(''); setMessage('所选套餐已删除或不可用，已填写商品保持不变。');
        void query.refetch();
      } else if (isCancelledError(failure)) setMessage('套餐内容已更新，当前录单内容已保留，请核对后重新带入。');
      else { setError(failure instanceof ApiError ? failure : null); if (failure instanceof Error && !(failure instanceof ApiError)) setMessage(failure.message); void query.refetch(); }
    } }
    finally {
      if (writing) onImageWritingChange(false);
      if (active.current === controller) { active.current = null; readKey.current = null; setBusy(false); }
    }
  }
  async function confirm(useSuggestedPrice: boolean) {
    if (!review || !preview || active.current || disabled) return;
    const before = latest.current.getDraft();
    if (before !== draft) { setReviewError('草稿已变化，请核对更新后的预览。'); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onImageWritingChange(true); setReviewError('');
    try {
      const current = await readDetail(review.id);
      if (controller.signal.aborted) return;
      if (latest.current.getDraft() !== before) throw new Error('草稿已有变化，请核对更新后的预览。');
      if (current.version !== review.version || !samePackageContent(current, review)) {
        setReview(current); setReviewError('套餐已更新，请核对新版内容后再次确认。');
        return;
      }
      const updated = await apply(current, previewPackage(before, current, useSuggestedPrice), before, controller);
      if (updated && !controller.signal.aborted) {
        setReview(updated); setReviewError('套餐已更新，请核对新版内容后再次确认。');
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.status === 404 && failure.code === 'PACKAGE_NOT_FOUND') {
        setReview(null); setSelected(''); setMessage('所选套餐已删除或不可用，已填写商品保持不变。');
        void query.refetch();
      } else if (isCancelledError(failure)) {
        setReviewError('套餐读取已取消，请重新核对后确认。');
      } else {
        setReviewError(failure instanceof ApiError || !(failure instanceof Error) ? errorText(failure) : failure.message);
      }
    } finally {
      if (active.current === controller) { active.current = null; readKey.current = null; setBusy(false); onImageWritingChange(false); }
    }
  }
  return <div className="package-picker-section">
    <div className="section-heading order-create-products-heading">
      {heading}
      <button type="button" className="secondary package-toggle" aria-expanded={expanded} aria-controls={contentId} disabled={disabled || busy} onClick={() => setExpanded(value => !value)}>{expanded ? '收起套餐' : '导入套餐'}</button>
      {actions}
    </div>
    <div id={contentId} className="package-picker" hidden={!expanded}>
    <div className="package-actions"><label>搜索套餐<input value={keyword} placeholder="输入套餐名称" maxLength={80} disabled={disabled || busy} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSearch(keyword.trim()); setPage(1); setSelected(''); } }} /></label>
      <button type="button" className="secondary" disabled={disabled || busy} onClick={() => { setSearch(keyword.trim()); setPage(1); setSelected(''); void query.refetch(); }}>搜索</button>
      <label>选择套餐<Select label="选择套餐" value={selected} onChange={setSelected} disabled={disabled || busy || query.isPending}>
        <option value="">{query.isPending ? '正在读取…' : '选择套餐'}</option>{query.data?.items.map(value => <option key={value.id} value={value.id}>{value.name} · {value.items.length} 项</option>)}
      </Select></label><button type="button" className="secondary" disabled={disabled || busy || !chosen} onClick={() => void append()}>{busy ? '正在读取…' : added.includes(selected) ? '再添加一份' : '带入商品'}</button></div>
    {message && <p role="status">{message}</p>}{(error || query.error) && <p className="field-error" role="alert">{errorText(error || query.error)}</p>}
    {chosen && <p className="package-summary">{chosen.items.length} 项商品：{packageSummary(chosen)}</p>}
    {query.data && query.data.total > 20 && <div className="package-actions"><button type="button" className="text-button" disabled={disabled || busy || page === 1} onClick={() => { setPage(page - 1); setSelected(''); }}>上一页</button><span>第 {page} 页，共 {query.data.total} 个套餐</span><button type="button" className="text-button" disabled={disabled || busy || page * 20 >= query.data.total} onClick={() => { setPage(page + 1); setSelected(''); }}>下一页</button></div>}
    {query.data?.total === 0 && <p className="muted">{search ? '没有匹配的套餐。' : '暂无套餐，请联系店长维护。'}</p>}
    <p className="form-help">带入商品数量、报价和特殊要求。名称、类型、商品说明、特殊要求及报价一致时合并数量。</p>
    {review && <section className="panel package-inline-review" aria-label="确认带入套餐" aria-busy={busy}>
      <p>「{review.name}」将带入 {review.items.length} 项商品。请核对合并结果和整单金额。</p>
      {preview && <><ul className="package-merge-list">{preview.changes.map((change, index) => <li key={index}>
        <strong>{change.name}</strong>{change.requirements && <span className="product-spec-text">特殊要求：{change.requirements}</span>}
        <span>{change.previousQuantity ? `合并到商品 ${change.index + 1}：${change.previousQuantity} → ${change.count}` : `新增 × ${change.count}`} · {change.image}</span>
      </li>)}</ul>
      <dl className="package-amount-preview"><div><dt>订单原价</dt><dd>{money(preview.beforeOriginal)} → <strong>{money(preview.original)}</strong></dd></div>
        <div><dt>订单会员价</dt><dd>{money(preview.beforeMember)} → <strong>{money(preview.member)}</strong></dd></div></dl></>}
      {preview?.resetPayment && <p className="notice">采用建议金额后将改为未付，请核对收款。</p>}
      {(reviewError || previewError) && <p className="field-error" role="alert">{[reviewError, previewError].filter(Boolean).join(' ')}</p>}
      <div className="package-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => setReview(null)}>取消</button>
        <button type="button" className="primary" disabled={busy || disabled || !preview} onClick={() => void confirm(false)}>带入并保留金额</button>
        <button type="button" className="secondary" disabled={busy || disabled || !preview || preview.original === null && preview.member === null}
          onClick={() => void confirm(true)}>带入并采用建议金额</button>
      </div>
    </section>}
    </div>
  </div>;
}
