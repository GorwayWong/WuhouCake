import { validDate } from './orderForm.ts';
import { numericSize } from './productRules.ts';
import { shiftDate } from './dates.ts';
import { exportOptions } from './exportFiles.ts';

export interface ManagementDraft { from: string; through: string; status: string; paymentStatus: string; fulfillmentType: string;
  sizeInches: string; creditedEmployeeId: string; unassigned: boolean; includeCancelled: boolean; keyword: string; dateBasis: string }
export interface ManagementView { draft: ManagementDraft; applied: ManagementDraft; page: number }
export const orderPageSize = 10;
export function orderPagination(total: number, page: number) {
  const count = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const size = orderPageSize;
  const last = Math.max(1, Math.ceil(count / size));
  const current = Math.max(1, Math.min(Number.isSafeInteger(page) ? page : 1, last));
  let pages: (number | 'gap')[];
  if (last <= 7) pages = Array.from({ length: last }, (_, index) => index + 1);
  else if (current <= 4) pages = [1, 2, 3, 4, 5, 'gap', last];
  else if (current >= last - 3) pages = [1, 'gap', last - 4, last - 3, last - 2, last - 1, last];
  else pages = [1, 'gap', current - 1, current, current + 1, 'gap', last];
  return { total: count, size, last, current, from: count ? (current - 1) * size + 1 : 0, through: Math.min(current * size, count), pages };
}
export function defaultManagementDraft(date: string): ManagementDraft {
  return { from: date.slice(0, 8) + '01', through: date, status: '', paymentStatus: '', fulfillmentType: '',
    sizeInches: '', creditedEmployeeId: '', unassigned: false, includeCancelled: false, keyword: '', dateBasis: 'CREATED' };
}
export function managementQuery(draft: ManagementDraft): string {
  if (!validDate(draft.from) || !validDate(draft.through) || draft.from > draft.through) throw new Error('请填写有效的开始和结束日期，结束日期不能早于开始日期。');
  const to = shiftDate(draft.through, 1);
  if ((Date.parse(to) - Date.parse(draft.from)) / 86400000 > 366) throw new Error('一次最多查询 366 天，请缩小日期范围。');
  const query = new URLSearchParams({ from: draft.from, to, includeCancelled: String(draft.includeCancelled), unassigned: String(draft.unassigned) });
  if (!['RECEIVE', 'CREATED'].includes(draft.dateBasis)) throw new Error('请选择有效的日期口径。');
  query.set('dateBasis', draft.dateBasis);
  for (const key of ['status', 'paymentStatus', 'fulfillmentType'] as const) if (draft[key]) {
    if (!Object.hasOwn(exportOptions[key], draft[key])) throw new Error('筛选条件无效，请重新选择。');
    query.set(key, draft[key]);
  }
  if (draft.sizeInches.trim()) query.set('sizeInches', numericSize(draft.sizeInches));
  if (draft.creditedEmployeeId && !draft.unassigned) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(draft.creditedEmployeeId)) throw new Error('请选择有效的员工。');
    query.set('creditedEmployeeId', draft.creditedEmployeeId);
  }
  if (draft.keyword.trim()) query.set('keyword', draft.keyword.trim());
  return query.toString();
}
export function exactYuan(cents: string): string {
  const value = BigInt(cents); return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
