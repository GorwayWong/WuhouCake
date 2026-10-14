import { createParser } from 'eventsource-parser';
import type { QueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from './api.ts';

export function synchronize(client: QueryClient, orderId?: string) {
  // 日历范围整体失效：通知不带原日期，迁日必须同时清除旧日期投影。
  return Promise.all([
    client.invalidateQueries({ queryKey: ['calendar'] }),
    client.invalidateQueries({ queryKey: ['workbench'] }),
    client.invalidateQueries({ queryKey: orderId ? ['order', orderId] : ['order'] }),
  ]);
}
export function receiveEvent(client: QueryClient, event: { event?: string; data: string }) {
  if (event.event === 'ready') synchronize(client);
  if (event.event !== 'order.changed') return;
  try {
    const change = JSON.parse(event.data);
    // NOTE 不递增订单版本；所有合法通知都触发重新获取。
    synchronize(client, typeof change.orderId === 'string' ? change.orderId : undefined);
  } catch { synchronize(client); }
}
export type Connection = 'connecting' | 'live' | 'reconnecting';
export function connectOrders(client: QueryClient, status: (value: Connection) => void): () => void {
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
        receiveEvent(client, event);
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
