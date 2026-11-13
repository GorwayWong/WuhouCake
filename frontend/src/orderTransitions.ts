import { fulfillmentStatusName, orderStatusNames } from './orderStates.ts';

interface PreviousStep {
  path: 'production-actions' | 'fulfillment-actions' | 'restart';
  action?: string;
  label: string;
  resetItems: boolean;
  permissions: string[];
}

export const nextProductionAction: Record<string, string> = {
  CAKE_BASE: 'COMPLETE_BASE', LAYER: 'COMPLETE_LAYER', FROSTING: 'COMPLETE_FROSTING', DECORATING: 'COMPLETE_DECORATION',
};

const previousProductionStatus: Record<string, string> = { LAYER: 'CAKE_BASE', FROSTING: 'LAYER', DECORATING: 'FROSTING' };

export function previousOrderStep(order: { status: string; fulfillment?: { type: string } }): PreviousStep | null {
  if (order.status === 'CANCELLED') return { path: 'restart', label: '恢复至出胚', resetItems: true, permissions: ['ORDER_CANCEL', 'ORDER_PRODUCTION_UPDATE'] };
  const target = previousProductionStatus[order.status];
  if (target) return { path: 'production-actions', action: 'ROLLBACK_PRODUCTION', label: `退回${orderStatusNames[target]}`, resetItems: target === 'CAKE_BASE', permissions: ['ORDER_PRODUCTION_UPDATE'] };
  if (order.status === 'WAITING_DELIVERY') return { path: 'production-actions', action: 'REOPEN_PRODUCTION', label: '退回装饰', resetItems: false, permissions: ['ORDER_PRODUCTION_UPDATE'] };
  if (order.status === 'COMPLETED') return { path: 'fulfillment-actions', action: 'ROLLBACK_FULFILLMENT', label: `退回${fulfillmentStatusName('WAITING_DELIVERY', order.fulfillment?.type)}`, resetItems: false, permissions: ['ORDER_FULFILLMENT_UPDATE'] };
  return null;
}
