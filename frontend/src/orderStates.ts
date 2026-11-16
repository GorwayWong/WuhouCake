export const productionStatuses: readonly string[] = ['CAKE_BASE', 'LAYER', 'FROSTING', 'DECORATING'];
export const orderStatusNames: Record<string, string> = {
  CAKE_BASE: '出胚', LAYER: '夹层', FROSTING: '抹面', DECORATING: '装饰',
  WAITING_DELIVERY: '待交接', COMPLETED: '已交接', CANCELLED: '已取消',
};
export const historicalStatusNames: Record<string, string> = {
  WAITING_PRODUCTION: '待制作', PROCESSING: '生胚中', WAITING_PICKUP: '待自提', DELIVERING: '配送中',
  LAYER_DONE: '已夹层', FROSTING_DONE: '已抹面', OTHER_DONE: '其他已确认', COMPLETED: '已完成',
};
export const statusNames: Record<string, string> = { ...orderStatusNames, DELETED: '已删除' };
export function fulfillmentStatusName(status: string, type?: string) {
  if (type === 'PICKUP') {
    if (status === 'WAITING_DELIVERY') return '待自提';
    if (status === 'COMPLETED') return '已自提';
  }
  if (type === 'DELIVERY') {
    if (status === 'WAITING_DELIVERY') return '待配送';
    if (status === 'COMPLETED') return '已送达';
  }
  return statusNames[status] || '状态待更新';
}
export function displayedStatusCode(order: { status: string; deletion?: unknown; deleted?: boolean }): string {
  return order.deletion || order.deleted ? 'DELETED' : order.status;
}
