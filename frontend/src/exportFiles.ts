import { ApiError, authenticatedFetch, creationResultUnknown, errorText } from './api.ts';
import { shiftDate, workbenchDate } from './dates.ts';
import type { ExportFilters } from './types.ts';
import { orderStatusNames } from './orderStates.ts';

export const exportOptions: Record<'status' | 'fulfillmentType' | 'paymentStatus', Record<string, string>> = {
  status: orderStatusNames,
  fulfillmentType: { DELIVERY: '配送', PICKUP: '自提' },
  paymentStatus: { UNPAID: '未付款', PAID: '已付款' },
};
export interface ExportDraft { from: string; through: string; status: string; fulfillmentType: string; paymentStatus: string }
export type ExportRequest = { orderId: string; orderNo: string } | { filters: ExportFilters };

export function exportFilters(draft: ExportDraft): { filters?: ExportFilters; error?: string } {
  if (!workbenchDate(`#/?date=${draft.from}`) || !workbenchDate(`#/?date=${draft.through}`)) return { error: '请填写有效的开始和结束日期。' };
  if (draft.from > draft.through) return { error: '结束日期不能早于开始日期。' };
  const to = shiftDate(draft.through, 1);
  if ((Date.parse(to) - Date.parse(draft.from)) / 86400000 > 42) return { error: '一次最多导出 42 天，请缩小日期范围。' };
  const filters: ExportFilters = { from: draft.from, to };
  for (const key of ['status', 'fulfillmentType', 'paymentStatus'] as const) {
    if (draft[key] && !exportOptions[key][draft[key]]) return { error: '筛选条件无效，请重新选择。' };
    if (draft[key]) filters[key] = draft[key];
  }
  return { filters };
}

export function exportFilename(disposition: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '')?.[1];
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition || '');
  let filename = plain?.[1] || plain?.[2]?.trim() || fallback;
  if (encoded) { try { filename = decodeURIComponent(encoded.trim()); } catch { filename = fallback; } }
  filename = filename.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_');
  return filename.endsWith(fallback.slice(fallback.lastIndexOf('.'))) ? filename : fallback;
}

export async function fetchOrderExport(request: ExportRequest, signal: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const single = 'orderId' in request;
  const response = await authenticatedFetch(single ? `/orders/${request.orderId}/exports/xlsx` : '/orders/exports/zip', {
    method: 'POST', signal,
    headers: single ? undefined : { 'Content-Type': 'application/json' },
    body: single ? undefined : JSON.stringify(request.filters),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(response.status, error?.code || `HTTP_${response.status}`);
  }
  const expected = single ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/zip';
  if (response.headers.get('Content-Type')?.split(';')[0].trim() !== expected) throw new ApiError(502, 'INVALID_EXPORT_RESPONSE');
  const blob = await response.blob();
  if (!blob.size) throw new ApiError(502, 'INVALID_EXPORT_RESPONSE');
  const fallback = single ? `订单-${request.orderNo}.xlsx` : `orders-${request.filters.from.replaceAll('-', '')}-${shiftDate(request.filters.to, -1).replaceAll('-', '')}.zip`;
  return { blob, filename: exportFilename(response.headers.get('Content-Disposition'), fallback) };
}

export function saveExportFile(file: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  try {
    link.href = url; link.download = file.filename; document.body.append(link); link.click();
  } finally {
    link.remove();
    // 给浏览器接管下载留出时间，随后释放二进制，不将文件留在查询缓存中。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function exportFailureText(error: unknown): string {
  return creationResultUnknown(error) ? '未确认收到完整导出文件。请先核对浏览器下载记录，再决定是否重试。' : errorText(error);
}

export function exportActivitySummary(details: Record<string, unknown>): string[] {
  const lines = [details.mode === 'BATCH' ? '筛选批量 ZIP · 每张订单一份 XLSX' : '单订单 XLSX'];
  const filters = details.filters;
  if (filters && typeof filters === 'object') {
    const filter = filters as Record<string, unknown>;
    if (typeof filter.from === 'string' && typeof filter.to === 'string' && workbenchDate(`#/?date=${filter.from}`) && workbenchDate(`#/?date=${filter.to}`)) lines.push(`收货日期：${filter.from} 至 ${shiftDate(filter.to, -1)}（含首尾）`);
    lines.push(`订单状态：${exportOptions.status[String(filter.status)] || '全部'}；交接：${exportOptions.fulfillmentType[String(filter.fulfillmentType)] || '全部'}；付款：${exportOptions.paymentStatus[String(filter.paymentStatus)] || '全部'}`);
  }
  if (typeof details.snapshotVersion === 'number') lines.push(`导出时订单版本：${details.snapshotVersion}`);
  if (Array.isArray(details.imageIds)) lines.push(`参考图片：${details.imageIds.length} 张`);
  lines.push('文件已生成并发起下载，是否保存请核对浏览器下载记录。');
  return lines;
}
