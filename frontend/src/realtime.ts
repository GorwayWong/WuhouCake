import { createParser } from 'eventsource-parser';
import type { QueryClient, QueryFilters } from '@tanstack/react-query';
import { authenticatedFetch } from './api.ts';

export function synchronize(client: QueryClient, orderId?: string) {
  // 日历范围整体失效：通知不带原日期，迁日必须同时清除旧日期投影。
  return Promise.all([
    client.invalidateQueries({ queryKey: ['calendar'] }),
    client.invalidateQueries({ queryKey: ['workbench'] }),
    client.invalidateQueries({ queryKey: ['management-orders'] }),
    client.invalidateQueries({ queryKey: orderId ? ['order', orderId] : ['order'] }),
    ...(orderId ? [] : [synchronizePackages(client)]),
  ]);
}
export async function synchronizePackages(client: QueryClient, packageId?: string) {
  const lists: QueryFilters = { queryKey: ['order-packages'], predicate: query => query.queryKey[1] !== 'detail' };
  // 首次列表读取也必须取消，否则失效操作可能复用通知之前的旧请求。
  await Promise.all([
    client.cancelQueries(lists),
    client.cancelQueries({ queryKey: packageId ? ['order-packages', 'detail', packageId] : ['order-packages', 'detail'] }),
  ]);
  return client.invalidateQueries(lists);
}
export const changeLabels: Record<string, string> = { CREATED: '新订单', ITEM_CHANGED: '商品资料已更新', NOTE: '新增协作备注', PAYMENT_STATUS_CHANGED: '付款状态已更新',
  ORDER_PRODUCTION_CHANGED: '制作进度已更新', ORDER_FULFILLMENT_CHANGED: '交付状态已更新', ORDER_CANCELLED: '订单已取消', ORDER_INFORMATION_CHANGED: '订单资料已更新',
  ITEM_ADDED: '新增商品', ITEM_REMOVED: '商品已移除', IMAGE_ADDED: '新增参考图片', IMAGE_REMOVED: '参考图片已移除' };
export interface OrderUpdate { orderId: string; changeType: string; version: number; receivedAt: number; orderNo?: string }
export function collectUpdate(updates: OrderUpdate[], change: OrderUpdate): OrderUpdate[] {
  return [change, ...updates.filter(item => item.orderId !== change.orderId)].slice(0, 20);
}
export function receiveEvent(client: QueryClient, event: { event?: string; data: string }, notify?: (change: OrderUpdate) => void) {
  if (event.event === 'ready') synchronize(client);
  if (event.event === 'package.changed') {
    let packageId: string | undefined;
    try {
      const change = JSON.parse(event.data);
      if (typeof change?.packageId === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(change.packageId)) packageId = change.packageId;
    } catch { /* 无法识别目标时重新核对全部套餐读取。 */ }
    void synchronizePackages(client, packageId);
    return;
  }
  if (event.event !== 'order.changed') return;
  try {
    const change = JSON.parse(event.data);
    // 备注和图片变化不递增订单版本；所有合法通知都触发重新获取。
    synchronize(client, typeof change.orderId === 'string' ? change.orderId : undefined);
    if (/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(change.orderId) && Object.hasOwn(changeLabels, change.changeType)
        && Number.isSafeInteger(change.version) && change.version >= 0) {
      const detail = client.getQueryData<{ orderNo: string }>(['order', change.orderId, 'detail']);
      const orderNo = typeof change.orderNo === 'string' && /^[\p{L}\p{N}_-]{1,32}$/u.test(change.orderNo) ? change.orderNo : detail?.orderNo;
      notify?.({ orderId: change.orderId, changeType: change.changeType, version: change.version, receivedAt: Date.now(), orderNo });
    }
  } catch { synchronize(client); }
}
export type Connection = 'connecting' | 'live' | 'reconnecting';
export function connectOrders(client: QueryClient, status: (value: Connection) => void, notify?: (change: OrderUpdate) => void): () => void {
  let stopped = false;
  let active: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  async function connect() {
    if (stopped) return;
    active = new AbortController();
    status(attempts ? 'reconnecting' : 'connecting');
    let openedAt = 0;
    const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(() => active?.abort(), 45000); };
    touch();
    try {
      const response = await authenticatedFetch('/orders/stream', { signal: active.signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Stream unavailable');
      openedAt = Date.now();
      const parser = createParser({ onEvent: event => {
        if (stopped) return;
        if (event.event === 'ready') status('live');
        receiveEvent(client, event, notify);
      } });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          touch(); parser.feed(decoder.decode(value, { stream: true }));
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* 网络恢复后通过 ready 补齐未重放的消息。 */ }
    finally {
      clearTimeout(watchdog);
      if (!stopped) {
        // 短暂 ready 不代表网络稳定，至少跨过两次心跳再重置退避。
        if (openedAt && Date.now() - openedAt >= 30000) attempts = 0;
        status('reconnecting'); attempts++;
        retry = setTimeout(() => { void connect(); }, Math.min(30000, 1000 * 2 ** Math.min(attempts - 1, 5)) + Math.random() * 400);
      }
    }
  }
  function resume() {
    if (document.visibilityState !== 'hidden') { synchronize(client); active?.abort(); }
  }
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  void connect();
  return () => {
    stopped = true; clearTimeout(retry); clearTimeout(watchdog); active?.abort();
    window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume);
  };
}
