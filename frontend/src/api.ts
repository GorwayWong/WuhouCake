import type { OrderImage, Token } from './types';
import type { SubmissionContent } from './customerSubmission.ts';
import { hasUnsafeMoneyNumber } from './money.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function creationResultUnknown(error: unknown): boolean {
  return Boolean(error) && !(error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408);
}
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return '网络连接失败，请检查连接后重试。';
  return ({
    READ_TIMEOUT: '读取超时，当前资料可能不是最新的，请重试',
    AUTHENTICATION_FAILED: '工号或密码有误，或登录已过期。',
    SESSION_CHANGED: '当前标签页的登录会话已变更，请重新登录。',
    CURRENT_PASSWORD_INCORRECT: '当前密码不正确，新密码尚未保存。请填写初始化或重置时使用的旧密码后重试。',
    CONCURRENT_MODIFICATION: '资料已更新，输入已保留。核对后再保存。',
    IDEMPOTENCY_KEY_CONFLICT: '本次录单标识已有其他提交，请先核对原订单，再从详情中修改。',
    OTHER_ITEMS_INCOMPLETE: '还有商品未勾选完成，请先逐项核对（含主蛋糕）。',
    INVALID_PRODUCTION_TRANSITION: '制作状态已变化，请核对最新状态后操作。',
    INVALID_FULFILLMENT_TRANSITION: '当前订单不能执行此交付操作，请核对最新状态。',
    ORDER_NOT_CANCELLABLE: '此订单当前不能取消。',
    ORDER_NOT_FOUND: '订单或商品不存在。',
    ORDER_DELETED: '订单已删除，输入已保留。保留期内只可查询，不可修改或恢复。',
    ORDER_DELETED_FORBIDDEN: '当前岗位不能查看已删除订单。',
    DELETED_REPORT_UNAVAILABLE: '已删除订单不参与经营统计，请导出逐单 Excel ZIP。',
    PACKAGE_NOT_FOUND: '套餐已删除或不存在，请重新选择。当前填写内容已保留。',
    PACKAGE_FORBIDDEN: '仅店长可以管理套餐。',
    PACKAGE_NAME_CONFLICT: '套餐名称已存在，请使用可区分的名称。',
    PACKAGE_CREATION_CONFLICT: '原创建请求已保存且内容发生变化，请在套餐列表核对，勿重复创建。',
    IMAGE_NOT_FOUND: '图片已移除或不存在，请刷新图片列表核对。',
    IMAGE_TOO_LARGE: '单张图片不能超过 5 MiB。',
    UNSUPPORTED_IMAGE_FORMAT: '仅支持 JPG/PNG 图片，暂不支持 HEIC/WebP。',
    INVALID_IMAGE: '图片为空或已损坏，请重新选择。',
    IMAGE_DIMENSIONS_EXCEEDED: '图片尺寸过大，请选择较小的 JPG/PNG 图片。',
    IMAGE_ITEM_REQUIRED: '请选择图片对应的商品。',
    ITEM_ID_CONFLICT: '商品标识已被使用，请重新打开录单草稿。',
    IMAGE_UPLOAD_REMOVED: '该图片已被移除，请核对后重新选择图片。',
    ORDER_IMAGE_LIMIT_EXCEEDED: '每个商品最多保留 5 张图片，请先移除误传图片。',
    EXPORT_EMPTY: '这些条件下没有订单，请调整日期或筛选条件。',
    EXPORT_LIMIT_EXCEEDED: '导出超过当前入口的日期限制或 100 张订单，请缩小范围或增加筛选条件。',
    EXPORT_FILE_TOO_LARGE: '导出文件过大，请缩小筛选范围；单张订单请联系管理员核对。',
    EXPORT_CONTENT_TOO_LARGE: '订单内容或记录过多，请缩小筛选范围；单张订单请联系管理员核对。',
    INVALID_EXPORT_RESPONSE: '未收到完整的导出文件，请核对下载记录后重试。',
    REPORT_LIMIT_EXCEEDED: '经营导出超过 10,000 单或内容上限，请缩小日期范围或增加筛选条件。',
    ACCOUNT_ARCHIVED: '该员工已归档，请刷新员工列表并重新选择。',
    NOT_FOUND: '员工不存在，请刷新后重试。',
    EMPLOYEE_NUMBER_CONFLICT: '该工号已存在，请使用其他工号。',
    SELF_ARCHIVE_FORBIDDEN: '不能归档当前登录账号。',
    LAST_ADMINISTRATOR: '必须至少保留一位在职超级管理员。',
    VALIDATION_FAILED: '填写内容不符合要求，请检查后重试。',
    UNSAFE_MONEY_AMOUNT: '金额超出可安全处理范围，请联系管理员核对。',
    FORBIDDEN: '当前账号不能执行此操作。',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
    PASSWORD_REUSE_FORBIDDEN: '新密码不能与当前密码相同。',
    SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试。',
    ENTRY_UNAVAILABLE: '填写入口已停用或失效，请联系发送二维码的客服。',
    SUBMISSION_NOT_FOUND: '填单不存在，请返回列表重新查看。',
    SUBMISSION_NOT_PENDING: '填单已确认或删除，请读取最新记录。',
    DUPLICATE_REVIEW_REQUIRED: '疑似重复记录尚未核实或已发生变化，请核对最新记录后再确认接单。',
    SUBMISSION_PRODUCT_TYPE_INVALID: '商品类型不支持，请选择蛋糕或其他。',
    SUBMISSION_QUANTITY_INVALID: '商品数量必须为正整数，请核对每一项商品。',
    SUBMISSION_CAKE_SIZE_REQUIRED: '蛋糕尺寸未填写，请补充蛋糕尺寸。',
    SUBMISSION_TOTAL_REQUIRED: '整单约定金额未填写，请填写并保存核对结果。',
    SUBMISSION_EMPLOYEE_REQUIRED: '尚未选择业绩归属员工，请选择后保存。',
    SUBMISSION_ITEM_ID_CONFLICT: '无法安全关联历史报价，输入已保留。请读取最新填单后重新核对商品。',
    SUBMISSION_PRICES_INVALID: '商品数量与报价行不一致，请重新读取并保存核对结果。',
    ORDER_FINISH_TOO_LATE: '出品时间须比取货时间至少提前 1 小时。',
    ORDER_QUOTE_INCOMPLETE: '商品报价未完整，请补齐单价后再登记付款。',
    ORDER_PAID_AMOUNT_LOCKED: '已登记付款，请先撤销付款登记再改价。',
    SUBMISSION_REVIEW_REQUIRED: '请先保存核对结果，再确认接单。',
    SUBMISSION_FORBIDDEN: '仅前台和管理人员可以处理客户填单。',
    SUBMISSION_TOO_LARGE: '填写内容过长，请精简商品需求后再提交。',
    SUBMISSION_THROTTLED: '提交过于频繁，请稍后再试。',
    SUBMISSION_TIMEOUT: '提交超时，暂未收到填单回执。',
    SUBMISSION_RECEIPT_INVALID: '未收到有效的填单回执。',
  } as Record<string, string>)[error.code] || (error.status === 429 ? '操作过于频繁，请稍后重试。' : `请求未完成（${error.code}），请核对后重试。`);
}
async function decode<T>(response: Response, started?: number): Promise<T> {
  const body = await response.json().catch(() => null);
  if (started !== undefined && started !== generation) throw new ApiError(401, 'AUTHENTICATION_FAILED');
  if (!response.ok || !body?.success) throw new ApiError(response.status, body?.code || `HTTP_${response.status}`);
  if (hasUnsafeMoneyNumber(body.data)) throw new ApiError(502, 'UNSAFE_MONEY_AMOUNT');
  return body.data;
}
async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const csrf = await decode<{ headerName: string }>(await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' }));
  const cookie = document.cookie.split('; ').find(value => value.startsWith('XSRF-TOKEN='));
  if (!cookie) throw new ApiError(403, 'CSRF_UNAVAILABLE');
  return decode<T>(await fetch(`/api/auth/${path}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', [csrf.headerName]: decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

type Session = { token: Token | null; loading: boolean; error: unknown };
let state: Session = { token: null, loading: true, error: null };
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshing: Promise<Token> | null = null;
const listeners = new Set<() => void>();
function publish(next: Session) { state = next; listeners.forEach(listener => listener()); }
function sessionClaims(accessToken: string) {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const { sub, sid, ver } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof sub !== 'string' || !sub || typeof sid !== 'string' || !sid || !Number.isSafeInteger(ver) || ver < 0) return null;
    return { sub, sid, ver };
  } catch { return null; }
}
function accept(token: Token) {
  clearTimeout(timer);
  publish({ token, loading: false, error: null });
  timer = setTimeout(() => { void refresh().catch(() => {}); }, Math.max(1000, (token.expiresIn - 60) * 1000));
}
export function forgetSession(error: ApiError | null = null) {
  generation++;
  clearTimeout(timer);
  refreshing = null;
  publish({ token: null, loading: false, error });
}
export function refresh(): Promise<Token> {
  if (state.error instanceof ApiError && state.error.code === 'SESSION_CHANGED') return Promise.reject(state.error);
  if (refreshing) return refreshing;
  const started = generation, previous = state.token;
  const pending = authPost<Token>('refresh').then(token => {
    if (started !== generation) throw new ApiError(401, 'AUTHENTICATION_FAILED');
    // The refresh cookie is shared across tabs. Only the server authorizes requests.
    const next = sessionClaims(token?.accessToken);
    const current = previous && sessionClaims(previous.accessToken);
    if (!next || (previous && (!current || next.sub !== current.sub || next.sid !== current.sid || next.ver !== current.ver))) {
      const failure = new ApiError(401, 'SESSION_CHANGED');
      forgetSession(failure);
      throw failure;
    }
    accept(token); return token;
  }).catch(error => {
    if (started === generation) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) forgetSession();
      else {
        publish({ ...state, loading: false, error });
        timer = setTimeout(() => { void refresh().catch(() => {}); }, 15000);
      }
    }
    throw error;
  }).finally(() => { if (refreshing === pending) refreshing = null; });
  refreshing = pending;
  return pending;
}
export const session = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => state,
  async login(employeeNumber: string, password: string) {
    const currentError = state.error;
    forgetSession(currentError instanceof ApiError && currentError.code === 'SESSION_CHANGED' ? currentError : null);
    const started = generation;
    const token = await authPost<Token>('login', { employeeNumber, password });
    if (!sessionClaims(token?.accessToken)) throw new ApiError(401, 'AUTHENTICATION_FAILED');
    if (started === generation) accept(token);
  },
  async logout() {
    // 保留失败会话，让用户能重试服务端撤销，避免误报已退出。
    await authPost('logout');
    forgetSession();
  },
};
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const started = generation;
  const requireSession = () => { if (started !== generation) throw new ApiError(401, 'AUTHENTICATION_FAILED'); };
  const before = state.token?.accessToken;
  if (!before) throw new ApiError(401, 'AUTHENTICATION_FAILED');
  const send = (token: string) => fetch(`/api${path}`, {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  let response = await send(before);
  requireSession();
  if (response.status === 401 && !init.signal?.aborted) {
    const token = state.token?.accessToken !== before && state.token ? state.token : await refresh();
    requireSession();
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    response = await send(token.accessToken);
    requireSession();
    if (response.status === 401) forgetSession();
  }
  return response;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const started = generation;
  const multipart = options.body instanceof FormData;
  const response = await authenticatedFetch(path, {
    method: options.method || 'GET', signal: options.signal,
    headers: { ...(options.body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: multipart ? options.body as FormData : options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return decode<T>(response, started);
}
/**
 * GET 读取 JSON，30 秒期限包含认证等待和响应体解析。
 * @param path API 相对路径。
 * @param signal 查询生命周期的取消信号。
 * @returns 当前会话的已解码数据。
 * @throws ApiError 超时或接口失败；调用方取消时保留其取消原因。
 */
export async function readQuery<T>(path: string, signal: AbortSignal): Promise<T> {
  const started = generation;
  const result = await withRequestDeadline(signal, 'READ_TIMEOUT', signal => api<T>(path, { signal }));
  if (started !== generation) throw new ApiError(401, 'AUTHENTICATION_FAILED');
  return result;
}
async function withRequestDeadline<T>(signal: AbortSignal, code: string, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = (reason: unknown) => { controller.abort(reason); rejectAbort(controller.signal.reason); };
  const cancel = () => abort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(() => abort(new ApiError(408, code)), 30_000);
  try {
    return await Promise.race([request(controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', cancel);
  }
}
export async function fetchPackageImage(path: string, signal: AbortSignal) {
  const response = await authenticatedFetch(path, { signal });
  if (!response.ok) return decode<never>(response);
  return response.blob();
}
export async function publicApi<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  return decode<T>(await fetch(`/api${path}`, {
    method: options.method || 'GET', credentials: 'omit', cache: 'no-store', signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
}
export function readPublicOrderEntry(token: string, signal: AbortSignal) {
  return withRequestDeadline(signal, 'READ_TIMEOUT', signal =>
    publicApi<{ ownerName: string }>(`/public/order-entries/${encodeURIComponent(token)}`, { signal }));
}
export async function submitPublicOrder(token: string, key: string, content: SubmissionContent, signal: AbortSignal) {
  const receipt = await withRequestDeadline(signal, 'SUBMISSION_TIMEOUT', signal =>
    publicApi<{ submissionId: string; submissionNo: string }>(`/public/order-entries/${encodeURIComponent(token)}/submissions`, {
      method: 'POST', body: content, headers: { 'Idempotency-Key': key }, signal,
    }));
  if (typeof receipt?.submissionId !== 'string'
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(receipt.submissionId)
      || receipt.submissionNo !== `F${receipt.submissionId}`)
    throw new ApiError(502, 'SUBMISSION_RECEIPT_INVALID');
  return receipt;
}
export async function uploadOrderImage(orderId: string, file: File, itemId: string, signal?: AbortSignal, requestId?: string): Promise<OrderImage> {
  const body = new FormData();
  body.append('file', file);
  if (itemId) body.append('itemId', itemId);
  return api<OrderImage>(`/orders/${orderId}/images`, { method: 'POST', body, signal, headers: requestId ? { 'Idempotency-Key': requestId } : undefined });
}
export async function fetchOrderImage(orderId: string, imageId: string, signal: AbortSignal): Promise<Blob> {
  const response = await authenticatedFetch(`/orders/${orderId}/images/${imageId}`, { signal });
  if (!response.ok) return decode<never>(response);
  return response.blob();
}
