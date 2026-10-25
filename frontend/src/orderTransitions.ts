import type { Detail } from './types.ts';

interface PreviousStep {
  path: 'production-actions' | 'fulfillment-actions' | 'restart';
  action?: string;
  label: string;
  resetItems: boolean;
  permissions: string[];
}

export function previousOrderStep(order: Pick<Detail, 'status' | 'currentStageCode' | 'fulfillment'>): PreviousStep | null {
  if (order.status === 'CANCELLED') return { path: 'restart', label: '恢复至待制作', resetItems: true, permissions: ['ORDER_CANCEL', 'ORDER_PRODUCTION_UPDATE'] };
  if (order.status === 'PROCESSING') {
    const targets: Record<string, string> = { OTHER_DONE: '已抹面', FROSTING_DONE: '已夹层', LAYER_DONE: '生胚中', '': '待制作' };
    const target = targets[order.currentStageCode || ''];
    return target ? { path: 'production-actions', action: 'ROLLBACK_PRODUCTION', label: `退回${target}`, resetItems: !order.currentStageCode, permissions: ['ORDER_PRODUCTION_UPDATE'] } : null;
  }
  if (['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(order.status)) return { path: 'production-actions', action: 'REOPEN_PRODUCTION', label: '退回其他已确认', resetItems: false, permissions: ['ORDER_PRODUCTION_UPDATE'] };
  if (order.status === 'DELIVERING' || order.status === 'COMPLETED') {
    const target = order.status === 'DELIVERING' ? '待配送' : order.fulfillment.type === 'DELIVERY' ? '配送中' : '待自提';
    return { path: 'fulfillment-actions', action: 'ROLLBACK_FULFILLMENT', label: `退回${target}`, resetItems: false, permissions: ['ORDER_FULFILLMENT_UPDATE'] };
  }
  return null;
}
