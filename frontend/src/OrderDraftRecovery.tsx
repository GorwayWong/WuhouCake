import { useEffect, useRef } from 'react';
import { OrderDraftDiscard } from './OrderDraftDiscard';
import { X } from '@phosphor-icons/react';
import type { DraftCandidate } from './useOrderDraft';

export function OrderDraftRecovery({ candidate, accept, discard, dismiss, blocked }: {
  candidate: DraftCandidate; accept: () => void; discard: () => boolean; dismiss: () => void; blocked: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const record = candidate.record;
  return <dialog ref={dialog} className="draft-dialog" aria-labelledby="draft-recovery-title" aria-describedby="draft-recovery-description"
    onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div className="section-heading"><h2 id="draft-recovery-title">{candidate.invalid ? '草稿暂时无法恢复' : '发现未提交订单'}</h2><button type="button" className="icon-button" aria-label="关闭草稿恢复弹窗" onClick={dismiss}><X size={22} /></button></div>
    <p id="draft-recovery-description">{candidate.invalid ? '本机草稿数据损坏或版本不兼容。可关闭弹窗保留原数据，或明确放弃后新建订单。' : '是否继续填写上次未提交的订单？'}</p>
    {record && <dl className="draft-summary"><div><dt>保存时间</dt><dd>{record.updatedAt ? new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '当前页面暂存'}</dd></div><div><dt>客户</dt><dd>{[record.value.customerName, record.value.phone].filter(Boolean).join(' · ') || '尚未填写'}</dd></div><div><dt>取货日期</dt><dd>{record.value.requestedReceiveDate || '尚未填写'}</dd></div></dl>}
    {record?.createdOrderId ? <p className="notice error">订单已创建，仍有本机图片待处理。继续后可重试保存图片队列，或先<a href={`#/orders/${record.createdOrderId}`} onClick={dismiss}>查看订单详情</a>。</p> : record?.pending && <p className="notice error">订单可能已经创建，请先核对工作台。继续后可重试确认原订单。</p>}
    {blocked && <p className="notice error">其他标签页已修改草稿，请重新载入后再选择恢复。<button type="button" className="text-button" onClick={() => window.location.reload()}>重新载入</button></p>}
    <p className="form-help">“放弃并新建”会删除原草稿；关闭弹窗会返回工作台并保留草稿。</p>
    <OrderDraftDiscard label="放弃并新建" blocked={blocked} conflict={blocked} warning={Boolean(record?.pending || record?.createdOrderId)} discard={discard}>{record && <button type="button" className="primary" autoFocus disabled={blocked} onClick={accept}>继续填写</button>}</OrderDraftDiscard>
  </dialog>;
}
