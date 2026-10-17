import { Bell } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { changeLabels } from './realtime';
import type { OrderUpdate } from './realtime';

export function OrderUpdates({ updates, clear, dismiss, currentOrderId }: { updates: OrderUpdate[]; clear: () => void; dismiss: (id: string) => void; currentOrderId?: string }) {
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (requestedId && requestedId === currentOrderId) {
      dismiss(requestedId); setRequestedId(null);
      if (panel.current) panel.current.open = false;
    }
  }, [requestedId, currentOrderId, dismiss]);
  return <details ref={panel} className="order-updates"><summary aria-label={`订单更新，${updates.length} 张订单待查看`}><Bell size={20} /><span>订单更新{updates.length > 0 && ` ${updates.length}`}</span></summary>
    <div className="updates-popover"><div className="section-heading"><strong>最近订单更新</strong>{updates.length > 0 && <button type="button" className="text-button" onClick={clear}>全部已读</button>}</div>
      {!updates.length ? <p className="muted">暂无待查看的更新。</p> : <ul>{updates.map(update => <li key={update.orderId}><a href={`#/orders/${update.orderId}`} onClick={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) setRequestedId(update.orderId); }}>
        <strong>{update.orderNo ? `#${update.orderNo} · ` : ''}{changeLabels[update.changeType]}</strong><span>查看订单 <time dateTime={new Date(update.receivedAt).toISOString()}>{new Date(update.receivedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></span>
      </a></li>)}</ul>}
    </div>
  </details>;
}
