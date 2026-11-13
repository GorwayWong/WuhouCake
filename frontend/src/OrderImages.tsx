import { readEditManifest, writeEditManifest } from './editImageSession';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, Plus, Trash, X } from '@phosphor-icons/react';
import { api, errorText, uploadOrderImage, readQuery } from './api';
import { time } from './dates';
import { loadImagePreview } from './imagePreview';
import { editImageQueue, validateEditImages, commitEditImages, removeDraftImages, removeEditImage, imageQueue, imageQueueMetadata, localImageError, readDraftImage, removeQueuedImage, saveDraftImages, updateQueuedImage } from './draftImages';
import type { ImageScope, QueuedImage } from './draftImages';
import { synchronize } from './realtime';
import type { Detail, OrderImage } from './types';
import { ErrorNotice } from './ui';

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

function QueuedImageTile({ image, busy, retry, remove }: { image: QueuedImage; busy: boolean; retry?: () => void; remove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false, url = '';
    void readDraftImage(image, image.itemId, image.id).then(row => {
      if (!cancelled && row) { url = URL.createObjectURL(row.file); setUrl(url); }
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [image.key]);
  return <li className="reference-image">{url && <img className="draft-image-thumbnail" src={url} alt={image.name} />}<div className="image-caption"><span className="image-filename">{image.name}</span><span role="status">{image.error || '等待上传'}</span><div className="actions">{retry && <button type="button" className="text-button" disabled={busy} onClick={retry}>重试上传</button>}<button type="button" className="text-button danger" disabled={busy} onClick={remove}>{retry ? '移除待上传图片' : '移除暂存图片'}</button></div></div></li>;
}

export interface EditImageActions { hasImages: () => boolean; validate: () => Promise<void>; commit: (order: Detail) => Promise<void>; discard: () => Promise<void> }
export function OrderImages({ order, itemId, accountId, canUpload, canDelete, blocked, onDraftChange, onWritingChange, productionView = false, compact = false, ownerSession, editSession, editActions, recover }: {
  ownerSession?: string; recover?: (session: string) => void; editSession?: string; editActions?: { current: EditImageActions | null };
  compact?: boolean; productionView?: boolean; order: Detail; itemId?: string; accountId: string; canUpload: boolean; canDelete: boolean;
  blocked: boolean; onDraftChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void;
}) {
  const client = useQueryClient(), id = order.orderId;
  const query = useQuery({ queryKey: ['order', id, 'images'], queryFn: ({ signal }) => readQuery<OrderImage[]>(`/orders/${id}/images`, signal) });
  const localKey = ['local-order-images', accountId, id];
  const local = useQuery({ queryKey: localKey, queryFn: () => imageQueueMetadata(accountId, id), enabled: Boolean(accountId), staleTime: 0 });
  const stagedKey = ['edit-order-images', accountId, id];
  const staged = useQuery({ queryKey: stagedKey, queryFn: () => editImageQueue(accountId, id), enabled: Boolean(accountId), staleTime: 0 });
  const scope: ImageScope | undefined = ownerSession ? { accountId, requestId: `edit:${id}:${ownerSession}` } : undefined;
  const [expected, setExpected] = useState<QueuedImage[]>([]);
  const [manifestError, setManifestError] = useState('');
  useEffect(() => {
    try { setExpected(scope ? readEditManifest(scope) : []); setManifestError(''); }
    catch { setManifestError('未能读取待上传的图片，请重新选择。'); }
  }, [accountId, id, ownerSession]);
  const remember = (rows: QueuedImage[]) => {
    setExpected(rows);
    if (scope) writeEditManifest(scope, rows);
  };
  const selected = expected;
  if (editActions) editActions.current = {
    hasImages: () => selected.length > 0,
    validate: async () => {
      try {
        if (manifestError) throw new Error(manifestError);
        if (scope) await validateEditImages(scope, order, selected);
      } catch (failure) { setError(manifestError || localImageError(failure)); throw failure; }
    },
    commit: async latest => {
      if (!scope || !selected.length) return;
      await commitEditImages(scope, latest, selected);
      remember([]);
      await client.invalidateQueries({ queryKey: stagedKey });
      await client.invalidateQueries({ queryKey: localKey });
      await upload((await imageQueue(accountId, id)).filter(row => row.requestId === scope.requestId), true);
    },
    discard: async () => {
      if (!selected.length && !manifestError) return;
      try {
        if (manifestError) throw new Error(manifestError);
        if (scope) await removeDraftImages(scope);
        remember([]); setError(''); await client.invalidateQueries({ queryKey: stagedKey });
      } catch (failure) { setError('暂存图片未能清理，编辑内容已保留，请重试取消。'); throw failure; }
    },
  };
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), alive = useRef(true);
  const attempted = useRef(new Set<string>());
  const product = itemId ? order.items.find(item => item.itemId === itemId) : order.items[0];
  const currentImages = (query.data || []).filter(image => image.itemId === product?.itemId);
  const currentQueue = (local.data || []).filter(image => image.itemId === product?.itemId);
  const currentStaged = selected.filter(row => row.itemId === product?.itemId);
  const history = (query.data || []).filter(image => !image.itemId || !order.items.some(item => item.itemId === image.itemId));
  const orphanQueue = (local.data || []).filter(image => !order.items.some(item => item.itemId === image.itemId));
  const busy = blocked || saving;
  const count = currentImages.length + currentQueue.length + selected.filter(row => row.itemId === product?.itemId).length;
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); onWritingChange(false); }; }, [onWritingChange]);
  useEffect(() => { onDraftChange(Boolean(expected.length)); }, [expected, onDraftChange]);
  async function refresh() {
    await Promise.all([client.invalidateQueries({ queryKey: localKey }), synchronize(client, id)]);
  }
  async function upload(rows: QueuedImage[], savingEdit = false) {
    if (active.current || !savingEdit && (blocked || editSession) || !canUpload || !rows.length) return;
    const controller = new AbortController(); active.current = controller; setSaving(true); onWritingChange(true); setError('');
    let failed = false;
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
          failed = true;
          await updateQueuedImage(existing, failure instanceof Error && failure.message.startsWith('对应商品') ? failure.message : errorText(failure));
        }
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request(`wuhou:images:${accountId}:${id}`, { signal: controller.signal }, run);
      else await run();
      if (alive.current && !controller.signal.aborted) setNotice(failed ? '' : '图片已上传。');
    } catch (failure) { if (alive.current && !controller.signal.aborted) setError(localImageError(failure)); }
    finally {
      try { if (alive.current) await refresh(); }
      finally { if (active.current === controller) { active.current = null; if (alive.current) { setSaving(false); onWritingChange(false); } } }
    }
  }
  useEffect(() => {
    const pending = (local.data || []).filter(image => !image.error && !attempted.current.has(image.key));
    if (pending.length && !busy && !editSession && canUpload) void upload(pending);
  }, [local.data, busy, canUpload, editSession]);
  async function select(files: File[]) {
    if (!ownerSession || manifestError || !product || busy || !canUpload || !files.length || !query.data || !local.data || !staged.data) return;
    if (count + files.length > 5) { setError(`每个商品最多 5 张图片，还可添加 ${Math.max(0, 5 - count)} 张。`); return; }
    setSaving(true); onWritingChange(true); setError('');
    try {
      const saved = await saveDraftImages((editSession ? scope : undefined) || { accountId, requestId: `order:${id}` }, product.itemId, files, editSession ? undefined : id);
      if (editSession && scope) remember([...expected, ...saved.map(image => ({ ...image, ...scope, itemId: product.itemId, key: JSON.stringify([scope.accountId, scope.requestId, product.itemId, image.id]) }))]);
      await client.invalidateQueries({ queryKey: stagedKey });
      await client.invalidateQueries({ queryKey: localKey });
    } catch (failure) { setError(localImageError(failure)); }
    finally { if (alive.current) { setSaving(false); onWritingChange(false); if (input.current) input.current.value = ''; } }
  }
  async function remove(image: OrderImage) {
    if (busy || editSession || !canDelete || !window.confirm(`移除参考图片「${image.filename}」？历史记录会保留。`)) return;
    setSaving(true); onWritingChange(true); setError('');
    try { await api(`/orders/${id}/images/${image.imageId}`, { method: 'DELETE' }); setNotice('参考图片已移除。'); }
    catch (failure) { setError(errorText(failure)); }
    finally { try { await refresh(); } finally { if (alive.current) { setSaving(false); onWritingChange(false); } } }
  }
  async function removeLocal(image: QueuedImage) {
    if (saving || active.current || image.accountId !== accountId || (image.requestId.startsWith(`edit:${id}:`) && image.requestId !== scope?.requestId) || (editSession && image.orderId)) return;
    try { if (!image.orderId && scope) await removeEditImage(scope, image); else await removeQueuedImage(image); if (!image.orderId) remember(expected.filter(row => row.key !== image.key)); setError(''); await client.invalidateQueries({ queryKey: localKey }); await client.invalidateQueries({ queryKey: stagedKey }); }
    catch { setError('本机待上传图片未能移除，请重试。'); }
  }
  return <section id="order-reference-images" tabIndex={-1} className={`${compact ? '' : 'panel '}reference-images`} aria-labelledby="reference-images-title">
    <div className="section-heading"><h2 id="reference-images-title"><Images />{compact ? '图片' : productionView ? '款式图片' : '参考图片'}</h2><div className="item-heading-actions"><span className="muted">{currentImages.length} / 5 张{currentQueue.length > 0 && ` · ${currentQueue.length} 张待上传`}{currentStaged.length > 0 && ` · ${currentStaged.length} 张待保存`}</span>{canUpload && <button type="button" className="secondary compact" disabled={busy || !ownerSession || Boolean(manifestError) || !product || count >= 5 || !query.data || !local.data || !staged.data} onClick={() => input.current?.click()}><Plus />添加图片</button>}</div></div>
    <p className="form-help">{product ? `商品 ${order.items.indexOf(product) + 1} · ${product.name}` : '暂无商品'} · 每商品最多 5 张，JPG / PNG，每张不超过 5 MiB。</p>
    <input className="sr-only" tabIndex={-1} aria-label="选择当前商品图片" ref={input} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" disabled={busy || !canUpload} onChange={event => void select(Array.from(event.target.files || []))} />
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {local.error && <p className="notice error" role="alert">本机待上传图片无法读取。<button type="button" className="text-button" onClick={() => void local.refetch()}>重试读取</button></p>}
    {editSession && currentStaged.length > 0 && <p className="form-help">保存修改后上传图片。</p>}
    {manifestError && <p className="notice error" role="alert">{manifestError}</p>}
    {staged.error && <p className="notice error" role="alert">编辑图片暂存无法读取，请重试。<button type="button" onClick={() => void staged.refetch()}>重试读取</button></p>}
    {selected.filter(row => order.items.some(item => item.itemId === row.itemId) && (!editSession || row.itemId === product?.itemId)).map(row => <div key={row.key} className="staged-edit-image">
      <ul className="staged-image-list"><QueuedImageTile image={{ ...row, error: row.requestId === scope?.requestId ? '待保存：保存修改后上传' : '发现上次编辑暂存的图片，请先核对订单资料' }} busy={busy} remove={() => void removeLocal(row)} /></ul>
      {!editSession && recover && <button type="button" className="secondary" disabled={busy} onClick={() => recover(row.requestId.slice(`edit:${id}:`.length))}>继续编辑并恢复图片</button>}
      {(!editSession || row.requestId !== scope?.requestId) && <button type="button" className="secondary" disabled={busy || Boolean(editSession) || !canUpload} onClick={async () => {
        setSaving(true); onWritingChange(true);
        try { const latest = await api<Detail>(`/orders/${id}`); await commitEditImages(row, latest, selected); remember([]); setError(''); await client.invalidateQueries({ queryKey: stagedKey }); await client.invalidateQueries({ queryKey: localKey }); }
        catch (failure) { setError(localImageError(failure)); }
        finally { setSaving(false); onWritingChange(false); }
      }}>继续上传图片</button>}
    </div>)}
    {query.isPending || currentImages.length + currentQueue.length === 0 ? (
      <div className="image-preview-empty">
        <p className="image-placeholder" role={query.isPending ? 'status' : undefined}>
          {query.isPending ? '正在读取图片…' : currentStaged.length ? '以上图片尚未保存。' : '该商品暂无款式图片。'}
        </p>
      </div>
    ) : <ul className="image-grid">{currentImages.map(image => <ImageTile key={image.imageId} image={image} scope={product?.name || '商品图片'} blocked={busy || Boolean(editSession) || !canDelete} productionView={productionView} remove={() => void remove(image)} />)}{currentQueue.map(image => {
      const sameEdit = Boolean(editSession && image.requestId === scope?.requestId);
      return <QueuedImageTile key={image.key} image={image} busy={busy || Boolean(editSession && !sameEdit) || !canUpload}
        retry={() => void upload([image], sameEdit)} remove={() => void removeLocal(image)} />;
    })}</ul>}
    {currentImages.length >= 5 && <p className="form-help">该商品已达上限，移除到 5 张以下可继续添加。历史图片保留。</p>}
    {history.length > 0 && <div className="historical-images"><h3>历史图片</h3><p className="form-help">未关联商品或原商品已移除的图片。</p><ul className="image-grid">{history.map(image => <ImageTile key={image.imageId} image={image} scope={image.itemId ? '已移除商品' : '整单历史图片'} blocked={busy || Boolean(editSession) || !canDelete} productionView={productionView} remove={() => void remove(image)} />)}</ul></div>}
    {orphanQueue.length > 0 && <div className="notice error"><p>以下待上传图片的商品已移除，请核对后移除本机图片。</p><ul className="image-grid">{orphanQueue.map(image => <QueuedImageTile key={image.key} image={image} busy={busy} retry={() => void upload([image])} remove={() => void removeLocal(image)} />)}</ul></div>}
    {selected.filter(row => !order.items.some(item => item.itemId === row.itemId)).map(row => <div key={row.key} className="notice error"><p>暂存图片对应的商品已移除，请移除这张本机图片。</p><QueuedImageTile image={row} busy={busy} remove={() => void removeLocal(row)} /></div>)}
    {saving && <p className="form-help" role="status">正在保存图片，请稍候…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {currentQueue.some(row => row.error) && <p className="notice error" role="alert">{!editSession && '资料已保存，'}仍有图片上传未完成，请重试失败图片。</p>}
    <div aria-live="polite">{notice && <p className="form-help">{notice}</p>}</div>
  </section>;
}
