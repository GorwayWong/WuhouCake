import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function OrderDraftDiscard({ label, blocked, conflict, warning, discard, children, compact = false }: {
  label: string; blocked: boolean; conflict: boolean; warning: boolean; discard: () => boolean; children?: ReactNode; compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) back.current?.focus(); }, [confirming]);
  const cancel = () => { setConfirming(false); setFailed(false); requestAnimationFrame(() => trigger.current?.focus()); };
  if (!confirming) return <div className={compact ? 'draft-toolbar' : 'actions'}>{children}<button ref={trigger} type="button" className={compact ? 'text-button danger' : 'secondary'} disabled={blocked} onClick={() => setConfirming(true)}>{label}</button></div>;
  return <>{compact && children && <div className="draft-toolbar">{children}</div>}<div className="draft-discard-confirmation">
    <p>确定放弃草稿？已填写内容和未上传的图片将被清除。</p>
    {warning && <p className="notice">订单已创建或可能已经创建，请先核对工作台。删除本机草稿不会撤销订单。</p>}
    {failed && !conflict && <p className="notice error" role="alert">草稿未能删除，原内容已保留。请检查浏览器存储权限后重试。</p>}
    <div className="actions"><button type="button" className="danger-button" disabled={blocked} onClick={() => { if (!discard()) setFailed(true); }}>{failed && !conflict ? '重试删除' : '确认放弃'}</button><button ref={back} type="button" className="secondary" onClick={cancel}>返回</button></div>
  </div></>;
}
