import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Images, Trash } from '@phosphor-icons/react';
import { localImageError, readDraftImage, removeDraftImage, saveDraftImages } from './draftImages';
import type { DraftImage, ImageScope } from './draftImages';
import { imagesPerItem } from './draftImageMetadata';

function DraftImageTile({ scope, itemId, image, disabled, remove }: {
  scope: ImageScope; itemId: string; image: DraftImage; disabled: boolean; remove: () => void;
}) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, preview = '';
    void readDraftImage(scope, itemId, image.id).then(row => {
      if (cancelled) return;
      if (!row) { setError('本机图片缺失，请移除后重新选择。'); return; }
      preview = URL.createObjectURL(row.file); setUrl(preview);
    }).catch(() => { if (!cancelled) setError('本机图片无法读取，请重试或重新选择。'); });
    return () => { cancelled = true; if (preview) URL.revokeObjectURL(preview); };
  }, [scope.accountId, scope.requestId, itemId, image.id]);
  return <li className="reference-image">{url ? <img className="draft-image-thumbnail" src={url} alt={image.name} /> : <div className="image-placeholder">{error || '正在读取图片…'}</div>}<div className="image-caption"><span className="image-filename">{image.name}</span><button type="button" className="text-button danger" disabled={disabled} onClick={remove} aria-label={`移除已选图片：${image.name}`}><Trash />移除</button></div></li>;
}
export function DraftItemImages({ scope, itemId, images, disabled, allowed, onChange, onBusyChange, before }: {
  scope: ImageScope; itemId: string; images: DraftImage[]; disabled: boolean; allowed: boolean;
  onChange: (images: DraftImage[]) => boolean; onBusyChange: (busy: boolean) => void; before: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), working = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (working.current) onBusyChange(false); }; }, []);
  async function select(files: File[]) {
    if (disabled || busy || !files.length) return;
    if (images.length + files.length > imagesPerItem) { setError(`每个商品最多 5 张图片，还可添加 ${Math.max(0, imagesPerItem - images.length)} 张。`); return; }
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const saved = await saveDraftImages(scope, itemId, files);
      if (!alive.current) { await Promise.all(saved.map(image => removeDraftImage(scope, itemId, image.id))); return; }
      if (!onChange([...images, ...saved])) setError('图片文件已存入本机，但草稿保存未完成，请处理草稿保存提示后重试。');
    } catch (failure) { if (alive.current) setError(localImageError(failure)); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); if (input.current) input.current.value = ''; } }
  }
  return <div className="draft-item-images">
    {images.length > 0 && <ul className="image-grid">{images.map(image => <DraftImageTile key={image.id} scope={scope} itemId={itemId} image={image} disabled={disabled || busy} remove={() => { onChange(images.filter(row => row.id !== image.id)); }} />)}</ul>}
    <div className="actions">{before}{allowed && <><button type="button" className="secondary" disabled={disabled || busy || images.length >= imagesPerItem} onClick={() => input.current?.click()}><Images />{busy ? '正在保存图片…' : '添加图片'}</button><span className="form-help" aria-live="polite">已选 {images.length} / 5 张</span><input className="sr-only" tabIndex={-1} aria-label="选择当前商品图片" ref={input} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" disabled={disabled || busy} onChange={event => void select(Array.from(event.target.files || []))} /></>}</div>
    {allowed && <p className="form-help">当前商品的参考图片 · JPG / PNG，每张不超过 5 MiB，随草稿保存在本机。</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
