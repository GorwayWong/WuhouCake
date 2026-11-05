import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, Plus, Trash, X } from '@phosphor-icons/react';
import { api, errorText, uploadOrderImage } from './api';
import { time } from './dates';
import { loadImagePreview } from './imagePreview';
import { imageQueue, imageQueueMetadata, localImageError, readDraftImage, removeQueuedImage, saveDraftImages, updateQueuedImage } from './draftImages';
import type { QueuedImage } from './draftImages';
import { synchronize } from './realtime';
import type { Detail, OrderImage } from './types';
import { ErrorNotice, Loading } from './ui';

function ImageTile({ image, scope, blocked, remove, productionView }: { image: OrderImage; scope: string; blocked: boolean; remove: () => void; productionView?: boolean }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setUrl(''); setError(null);
    return loadImagePreview(image.orderId, image.imageId, setUrl, setError);
  }, [image.orderId, image.imageId, attempt]);
  return <li className="reference-image">
    {url ? <button className="image-thumbnail" aria-label={`查看大图：${image.filename}`} onClick={() => dialog.current?.showModal()}><img src={url} alt={image.filename} /></button> : <div className="image-placeholder">{error ? <><span>{errorText(error)}</span><button className="text-button" onClick={() => setAttempt(value => value + 1)}>重试读取</button></> : '正在读取图片…'}</div>}
    <div className="image-caption"><strong className="image-scope">{scope}</strong><span className="image-filename" title={image.filename}>{image.filename}</span>{!productionView && <span>{image.uploaderNameSnapshot} · <time dateTime={image.uploadedAt}>{time(image.uploadedAt, true)}</time></span>}<button className="text-button danger" disabled={blocked} aria-label={`移除图片：${image.filename}`} onClick={remove}><Trash />移除</button></div>
    <dialog ref={dialog} className="image-dialog" aria-label={`参考图片：${image.filename}`} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="image-dialog-heading"><div><strong>{scope}</strong><p>{image.filename}{!productionView && ` · ${image.uploaderNameSnapshot} · ${time(image.uploadedAt, true)}`}</p></div><button className="icon-button" aria-label="关闭大图" onClick={() => dialog.current?.close()}><X size={24} /></button></div>
      {url && <img src={url} alt={image.filename} />}
    </dialog>
  </li>;
}

function QueuedImageTile({ image, busy, retry, remove }: { image: QueuedImage; busy: boolean; retry: () => void; remove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false, url = '';
    void readDraftImage(image, image.itemId, image.id).then(row => {
      if (!cancelled && row) { url = URL.createObjectURL(row.file); setUrl(url); }
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [image.key]);
  return <li className="reference-image">{url && <img className="draft-image-thumbnail" src={url} alt={image.name} />}<div className="image-caption"><span className="image-filename">{image.name}</span><span role="status">{image.error || '等待上传'}</span><div className="actions"><button type="button" className="text-button" disabled={busy} onClick={retry}>重试上传</button><button type="button" className="text-button danger" disabled={busy} onClick={remove}>移除待上传图片</button></div></div></li>;
}

export function OrderImages({ order, itemId, accountId, canUpload, canDelete, blocked, onDraftChange, onWritingChange, productionView = false, compact = false }: {
  compact?: boolean; productionView?: boolean; order: Detail; itemId?: string; accountId: string; canUpload: boolean; canDelete: boolean;
  blocked: boolean; onDraftChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void;
}) {
  const client = useQueryClient(), id = order.orderId;
  const query = useQuery({ queryKey: ['order', id, 'images'], queryFn: ({ signal }) => api<OrderImage[]>(`/orders/${id}/images`, { signal }) });
  const localKey = ['local-order-images', accountId, id];
  const local = useQuery({ queryKey: localKey, queryFn: () => imageQueueMetadata(accountId, id), enabled: Boolean(accountId), staleTime: 0 });
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), alive = useRef(true);
  const attempted = useRef(new Set<string>());
  const product = order.items.find(item => item.itemId === itemId) || order.items[0];
  const currentImages = (query.data || []).filter(image => image.itemId === product?.itemId);
  const currentQueue = (local.data || []).filter(image => image.itemId === product?.itemId);
  const history = (query.data || []).filter(image => !image.itemId || !order.items.some(item => item.itemId === image.itemId));
  const orphanQueue = (local.data || []).filter(image => !order.items.some(item => item.itemId === image.itemId));
  const busy = blocked || saving;
  const count = currentImages.length + currentQueue.length;
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); onWritingChange(false); }; }, [onWritingChange]);
  useEffect(() => { onDraftChange(false); }, [onDraftChange]);
  async function refresh() {
    await Promise.all([client.invalidateQueries({ queryKey: localKey }), synchronize(client, id)]);
  }
  async function upload(rows: QueuedImage[]) {
    if (active.current || blocked || !canUpload || !rows.length) return;
    const controller = new AbortController(); active.current = controller; setSaving(true); onWritingChange(true); setError('');
    const run = async () => {
      for (const row of rows) {
        if (controller.signal.aborted) return;
        attempted.current.add(row.key);
        const existing = (await imageQueue(accountId, id)).find(image => image.key === row.key);
        if (!existing) continue;
        try {
          if (!order.items.some(item => item.itemId === existing.itemId)) throw new Error('对应商品已移除，请移除此待上传图片。');
          await uploadOrderImage(id, new File([existing.file], existing.name, { type: existing.type }), existing.itemId, controller.signal, existing.id);
          await removeQueuedImage(existing);
        } catch (failure) {
          if (controller.signal.aborted) return;
          await updateQueuedImage(existing, failure instanceof Error && failure.message.startsWith('对应商品') ? failure.message : errorText(failure));
        }
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request(`wuhou:images:${accountId}:${id}`, { signal: controller.signal }, run);
      else await run();
      if (alive.current && !controller.signal.aborted) setNotice('图片队列已处理，请核对上传结果。');
    } catch (failure) { if (alive.current && !controller.signal.aborted) setError(localImageError(failure)); }
    finally {
      try { if (alive.current) await refresh(); }
      finally { if (active.current === controller) { active.current = null; if (alive.current) { setSaving(false); onWritingChange(false); } } }
    }
  }
  useEffect(() => {
    const pending = (local.data || []).filter(image => !image.error && !attempted.current.has(image.key));
    if (pending.length && !busy && canUpload) void upload(pending);
  }, [local.data, busy, canUpload]);
  async function select(files: File[]) {
    if (!product || busy || !canUpload || !files.length || !query.data || !local.data) return;
    if (count + files.length > 5) { setError(`每个商品最多 5 张图片，还可添加 ${Math.max(0, 5 - count)} 张。`); return; }
    setSaving(true); onWritingChange(true); setError('');
    try {
      await saveDraftImages({ accountId, requestId: `order:${id}` }, product.itemId, files, id);
      await client.invalidateQueries({ queryKey: localKey });
    } catch (failure) { setError(localImageError(failure)); }
    finally { if (alive.current) { setSaving(false); onWritingChange(false); if (input.current) input.current.value = ''; } }
  }
  async function remove(image: OrderImage) {
    if (busy || !canDelete || !window.confirm(`移除参考图片「${image.filename}」？历史记录会保留。`)) return;
    setSaving(true); onWritingChange(true); setError('');
    try { await api(`/orders/${id}/images/${image.imageId}`, { method: 'DELETE' }); setNotice('参考图片已移除。'); }
    catch (failure) { setError(errorText(failure)); }
    finally { try { await refresh(); } finally { if (alive.current) { setSaving(false); onWritingChange(false); } } }
  }
  async function removeLocal(image: QueuedImage) {
    if (saving || active.current) return;
    try { await removeQueuedImage(image); await client.invalidateQueries({ queryKey: localKey }); }
    catch { setError('本机待上传图片未能移除，请重试。'); }
  }
  return <section id="order-reference-images" tabIndex={-1} className={`${compact ? '' : 'panel '}reference-images`} aria-labelledby="reference-images-title">
    <div className="section-heading"><h2 id="reference-images-title"><Images />{compact ? '图片' : productionView ? '款式图片' : '参考图片'}</h2><div className="item-heading-actions"><span className="muted">{currentImages.length} / 5 张{currentQueue.length > 0 && ` · ${currentQueue.length} 张待上传`}</span>{canUpload && <button type="button" className="secondary compact" disabled={busy || !product || count >= 5 || !query.data || !local.data} onClick={() => input.current?.click()}><Plus />添加图片</button>}</div></div>
    <p className="form-help">{product ? `商品 ${order.items.indexOf(product) + 1} · ${product.name}` : '暂无商品'} · 每商品最多 5 张，JPG / PNG，每张不超过 5 MiB。</p>
    <input className="sr-only" tabIndex={-1} aria-label="选择当前商品图片" ref={input} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" disabled={busy || !canUpload} onChange={event => void select(Array.from(event.target.files || []))} />
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {local.error && <p className="notice error" role="alert">本机待上传图片无法读取。<button type="button" className="text-button" onClick={() => void local.refetch()}>重试读取</button></p>}
    {query.isPending ? <Loading /> : currentImages.length + currentQueue.length === 0 ? <p className="form-help">该商品暂无款式图片。</p> : <ul className="image-grid">{currentImages.map(image => <ImageTile key={image.imageId} image={image} scope={product?.name || '商品图片'} blocked={busy || !canDelete} productionView={productionView} remove={() => void remove(image)} />)}{currentQueue.map(image => <QueuedImageTile key={image.key} image={image} busy={busy || !canUpload} retry={() => void upload([image])} remove={() => void removeLocal(image)} />)}</ul>}
    {currentImages.length >= 5 && <p className="form-help">该商品已达上限，移除到 5 张以下可继续添加。历史图片保留。</p>}
    {history.length > 0 && <div className="historical-images"><h3>历史图片</h3><p className="form-help">未关联商品或原商品已移除的图片。</p><ul className="image-grid">{history.map(image => <ImageTile key={image.imageId} image={image} scope={image.itemId ? '已移除商品' : '整单历史图片'} blocked={busy || !canDelete} productionView={productionView} remove={() => void remove(image)} />)}</ul></div>}
    {orphanQueue.length > 0 && <div className="notice error"><p>以下待上传图片的商品已移除，请核对后移除本机图片。</p><ul className="image-grid">{orphanQueue.map(image => <QueuedImageTile key={image.key} image={image} busy={busy} retry={() => void upload([image])} remove={() => void removeLocal(image)} />)}</ul></div>}
    {saving && <p className="form-help" role="status">正在保存图片，请稍候…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div aria-live="polite">{notice && <p className="form-help">{notice}</p>}</div>
  </section>;
}
