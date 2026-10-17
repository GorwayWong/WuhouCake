import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, Plus, Trash, X } from '@phosphor-icons/react';
import { api, creationResultUnknown, errorText, uploadOrderImage } from './api';
import { time } from './dates';
import { imageFileError, loadImagePreview } from './imagePreview';
import { synchronize } from './realtime';
import type { Detail, OrderImage } from './types';
import { ErrorNotice, Loading } from './ui';

type ImageAction = { type: 'upload'; file: File; itemId: string } | { type: 'remove'; imageId: string };

function ImageTile({ image, scope, blocked, remove }: { image: OrderImage; scope: string; blocked: boolean; remove: () => void }) {
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
    <div className="image-caption"><strong className="image-scope">{scope}</strong><span className="image-filename" title={image.filename}>{image.filename}</span><span>{image.uploaderNameSnapshot} · <time dateTime={image.uploadedAt}>{time(image.uploadedAt, true)}</time></span><button className="text-button danger" disabled={blocked} aria-label={`移除图片：${image.filename}`} onClick={remove}><Trash />移除</button></div>
    <dialog ref={dialog} className="image-dialog" aria-label={`参考图片：${image.filename}`} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="image-dialog-heading"><div><strong>{scope}</strong><p>{image.filename} · {image.uploaderNameSnapshot} · {time(image.uploadedAt, true)}</p></div><button className="icon-button" aria-label="关闭大图" onClick={() => dialog.current?.close()}><X size={24} /></button></div>
      {url && <img src={url} alt={image.filename} />}
    </dialog>
  </li>;
}

export function OrderImages({ order, blocked, onDraftChange, onWritingChange }: {
  order: Detail; blocked: boolean; onDraftChange: (dirty: boolean) => void; onWritingChange: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const id = order.orderId;
  const query = useQuery({ queryKey: ['order', id, 'images'], queryFn: ({ signal }) => api<OrderImage[]>(`/orders/${id}/images`, { signal }) });
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [itemId, setItemId] = useState('');
  const [preview, setPreview] = useState('');
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; type: ImageAction['type'] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => {
    if (active.current) { active.current.abort(); active.current = null; onWritingChange(false); }
  }, [onWritingChange]);
  useEffect(() => { onDraftChange(adding); return () => onDraftChange(false); }, [adding, onDraftChange]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const clear = () => { setFile(null); setItemId(''); setAdding(false); setValidation(''); if (input.current) input.current.value = ''; };
  async function submit(action: ImageAction) {
    if (blocked || active.current) return;
    const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setSaving(true); setFailure(null); setNotice(''); onWritingChange(true);
    try {
      if (action.type === 'upload') await uploadOrderImage(id, action.file, action.itemId, controller.signal);
      else await api(`/orders/${id}/images/${action.imageId}`, { method: 'DELETE', signal: controller.signal });
      if (!current()) return;
      if (action.type === 'upload') clear();
      setNotice(action.type === 'upload' ? '参考图片已添加。' : '参考图片已移除。');
    } catch (error) { if (current()) setFailure({ error, type: action.type }); }
    finally {
      if (current()) {
        try { await synchronize(client, id); }
        finally { if (current()) { active.current = null; setSaving(false); onWritingChange(false); } }
      }
    }
  }
  const busy = blocked || saving;
  const full = (query.data?.length || 0) >= 8;
  const invalidItem = Boolean(itemId && !order.items.some(item => item.itemId === itemId));
  return <section className="panel reference-images" aria-labelledby="reference-images-title">
    <div className="section-heading"><h2 id="reference-images-title"><Images />参考图片</h2><div className="item-heading-actions"><span className="muted">{query.data?.length ?? '—'} / 8 张</span>{!adding && <button className="secondary compact" disabled={busy || full || !query.data} onClick={() => { setFailure(null); setNotice(''); setAdding(true); }}><Plus />添加图片</button>}</div></div>
    {adding && <p className="form-help">JPG / PNG · 每张不超过 5 MB</p>}
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    {query.isPending ? <Loading /> : query.data?.length === 0 ? null : <ul className="image-grid">{query.data?.map(image => <ImageTile key={`${id}/${image.imageId}`} image={image} scope={image.itemId ? order.items.find(item => item.itemId === image.itemId)?.name || '历史商品图片' : '整张订单'} blocked={busy || adding} remove={() => { if (window.confirm(`移除参考图片「${image.filename}」？历史记录会保留。`)) submit({ type: 'remove', imageId: image.imageId }); }} />)}</ul>}
    {full && <p className="form-help">已达 8 张上限，可移除误传图片后再添加。</p>}
    {adding && <form className="image-upload" onSubmit={event => { event.preventDefault(); if (file && !imageFileError(file) && !invalidItem && !full) submit({ type: 'upload', file, itemId }); }}>
      <fieldset disabled={busy}><legend>添加参考图片</legend>
        <label>图片文件<input ref={input} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => { const selected = event.target.files?.[0] || null; const error = selected ? imageFileError(selected) : ''; setValidation(error); setFile(error ? null : selected); }} /></label>
        <label>图片归属<select value={itemId} onChange={event => setItemId(event.target.value)}><option value="">整张订单</option>{order.items.map((item, index) => <option key={item.itemId} value={item.itemId}>商品 {index + 1} · {item.name}</option>)}{invalidItem && <option value={itemId}>已移除的商品，请重新选择</option>}</select></label>
        {preview && <div className="image-local-preview"><img src={preview} alt="待上传图片预览" /><span>{file?.name}</span></div>}
        {validation && <p className="field-error" role="alert">{validation}</p>}{invalidItem && <p className="field-error">该商品已移除，请重新选择图片归属。</p>}
        <div className="actions"><button className="primary" disabled={busy || !file || invalidItem || full}>{saving ? '正在保存…' : '确认上传'}</button><button type="button" className="secondary" onClick={() => { clear(); setFailure(null); }} disabled={busy}>取消</button></div>
      </fieldset>
    </form>}
    {failure && <div className="notice error" role="alert">{failure.type === 'upload' && creationResultUnknown(failure.error) ? '上传结果暂时无法确认，图片选择已保留。请先刷新图片列表，核对图片和上传记录后再决定是否重新上传，避免重复。' : errorText(failure.error)}<button className="text-button" disabled={busy || query.isFetching} onClick={() => void query.refetch()}>刷新图片列表</button></div>}
    <div aria-live="polite">{notice && <p className="form-help">{notice}</p>}</div>
  </section>;
}
