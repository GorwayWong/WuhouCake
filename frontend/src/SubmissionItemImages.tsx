import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import { errorText, fetchPackageImage, uploadSubmissionImage } from './api';
import { imageFileError, loadBlobPreview, whenImageVisible } from './imagePreview';
import { randomUUID } from './uuid';

export interface SubmissionImageScope {
  base: string;
  publicImage?: boolean;
  allowUpload?: boolean;
}

export function useSubmissionImagePending() {
  const [pending, setPending] = useState<string[]>([]);
  const markPending = useCallback((item: string, active: boolean) => {
    setPending(current => active ? current.includes(item) ? current : [...current, item] : current.filter(id => id !== item));
  }, []);
  return { pending: pending.length > 0, markPending };
}

export function SubmissionImageTile({ scope, item, image, label, action }: {
  scope: SubmissionImageScope; item: string; image: string; label: string; action?: { label: string; run: () => void };
}) {
  const path = `${scope.base}/items/${item}/images/${image}`;
  const publicImage = Boolean(scope.publicImage);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const tile = useRef<HTMLLIElement>(null);
  useEffect(() => {
    setUrl(''); setError(null);
    return whenImageVisible(tile.current, () => loadBlobPreview(signal => fetchPackageImage(path, signal, publicImage), setUrl, setError));
  }, [path, publicImage, attempt]);
  return <li className="reference-image" ref={tile}>
    {url ? <button type="button" className="image-thumbnail" onClick={() => dialog.current?.showModal()} aria-label={`查看${label}`}><img src={url} alt={label} /></button>
      : <div className="image-placeholder">{error ? <><span>图片读取失败</span><button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>重试读取</button></> : '正在读取图片…'}</div>}
    <div className="image-caption"><span>{label}</span>{action && <button type="button" className="text-button" onClick={action.run}>{action.label}</button>}</div>
    <dialog ref={dialog} className="image-dialog" aria-label={label} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="image-dialog-heading"><strong>{label}</strong><button type="button" className="icon-button" aria-label="关闭大图" onClick={() => dialog.current?.close()}><X /></button></div>
      {url && <img src={url} alt={label} />}
    </dialog>
  </li>;
}

export function SubmissionItemImages({ scope, item, selected, originals, setSelected, markPending }: {
  scope: SubmissionImageScope; item: string; selected: string[]; originals: string[];
  setSelected: (update: (current: string[]) => string[]) => void;
  markPending: (item: string, active: boolean) => void;
}) {
  const [upload, setUpload] = useState<{ file: File; id: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const update = useRef(setSelected);
  update.current = setSelected;
  useEffect(() => () => { request.current?.abort(); markPending(item, false); }, [item, markPending]);
  async function send(file: File, id: string) {
    if (request.current || selected.length >= 5) return;
    const issue = imageFileError(file);
    if (issue) { setError(issue); return; }
    const controller = new AbortController();
    request.current = controller;
    markPending(item, true);
    setUpload({ file, id }); setBusy(true); setError('');
    try {
      const saved = await uploadSubmissionImage(`${scope.base}/items/${item}/images/${id}`, file, controller.signal, Boolean(scope.publicImage));
      if (controller.signal.aborted) return;
      if (saved !== id) throw new Error('上传结果未确认，请重试。');
      update.current(current => [...current, id]);
      markPending(item, false); setUpload(undefined);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorText(failure));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const supplements = selected.filter(id => !originals.includes(id));
  const images = [...originals, ...supplements];
  return <div className="submission-item-images">
    <div className="actions">
      <strong>参考图片</strong><span className="muted">{selected.length} / 5 张</span>
      {scope.allowUpload !== false && <button type="button" className="secondary compact" disabled={Boolean(upload) || selected.length >= 5} onClick={() => input.current?.click()}><Plus />添加图片</button>}
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void send(file, randomUUID());
      }} />
    </div>
    {images.length > 0 && <ul className="image-grid">{images.map((id, index) => {
      const original = originals.includes(id), included = selected.includes(id);
      const label = scope.publicImage ? `图片 ${index + 1}`
        : original ? `顾客原图 ${index + 1}${included ? '' : '（不采用）'}` : `客服补图 ${index - originals.length + 1}`;
      const action = busy || !included && selected.length >= 5 ? undefined : {
        label: included ? original ? '不采用' : '移除' : '重新选用',
        run: () => {
          setError('');
          update.current(current => included ? current.filter(value => value !== id) : [...current, id]);
        },
      };
      return <SubmissionImageTile key={id} scope={scope} item={item} image={id} label={label} action={action} />;
    })}</ul>}
    {scope.allowUpload !== false && <p className="form-help">JPG / PNG，每张不超过 5 MiB。</p>}
    {busy && <p role="status">正在上传 {upload?.file.name}…</p>}
    {error && <p className="field-error" role="alert">{upload && `${upload.file.name}：`}{error}</p>}
    {upload && !busy && <div className="actions">
      <button type="button" className="text-button" disabled={selected.length >= 5} onClick={() => void send(upload.file, upload.id)}>重试上传</button>
      <button type="button" className="text-button" onClick={() => { setUpload(undefined); setError(''); markPending(item, false); }}>移除未上传图片</button>
    </div>}
  </div>;
}
