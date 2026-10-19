export const orderStatusNames: Record<string, string> = {
  WAITING_PRODUCTION: '待制作', PROCESSING: '制作中', WAITING_DELIVERY: '待配送', WAITING_PICKUP: '待自提',
  DELIVERING: '配送中', COMPLETED: '已完成', CANCELLED: '已取消',
};
export const productionStageNames: Record<string, string> = { LAYER_DONE: '已夹层', FROSTING_DONE: '已抹面' };
export const statusNames = { ...orderStatusNames, ...productionStageNames };
export function displayedStatusCode(order: { status: string; currentStageCode?: string | null }): string {
  return order.status === 'PROCESSING' && order.currentStageCode && Object.hasOwn(productionStageNames, order.currentStageCode) ? order.currentStageCode : order.status;
}
