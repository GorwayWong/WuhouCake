import type { OrderImage, Token } from './types';

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
    AUTHENTICATION_FAILED: '工号或密码有误，或登录已过期。',
    CURRENT_PASSWORD_INCORRECT: '当前密码不正确，新密码尚未保存。请填写初始化或重置时使用的旧密码后重试。',
    CONCURRENT_MODIFICATION: '资料已被其他同事更新，请核对最新内容后重试；未保存输入已保留。',
    IDEMPOTENCY_KEY_CONFLICT: '本次录单标识已有其他提交，请先核对原订单，再从详情中修改。',
    INVALID_PRODUCTION_TRANSITION: '制作状态已变化，请核对最新状态后操作。',
    INVALID_FULFILLMENT_TRANSITION: '当前订单不能执行此交付操作，请核对最新状态。',
    ORDER_NOT_CANCELLABLE: '此订单当前不能取消。',
    ORDER_NOT_FOUND: '订单或商品不存在。',
    IMAGE_NOT_FOUND: '图片已移除或不存在，请刷新图片列表核对。',
    IMAGE_TOO_LARGE: '单张图片不能超过 5 MiB。',
    UNSUPPORTED_IMAGE_FORMAT: '仅支持 JPG/PNG 图片，暂不支持 HEIC/WebP。',
    INVALID_IMAGE: '图片为空或已损坏，请重新选择。',
    IMAGE_DIMENSIONS_EXCEEDED: '图片尺寸过大，请选择较小的 JPG/PNG 图片。',
    ORDER_IMAGE_LIMIT_EXCEEDED: '每张订单最多保留 8 张图片，请先移除误传图片。',
    EXPORT_EMPTY: '这些条件下没有订单，请调整日期或筛选条件。',
    EXPORT_LIMIT_EXCEEDED: '导出超过 42 天或 100 张订单，请缩小日期范围或增加筛选条件。',
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
    FORBIDDEN: '当前账号不能执行此操作。',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
    PASSWORD_REUSE_FORBIDDEN: '新密码不能与当前密码相同。',
    SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试。',
    ENTRY_UNAVAILABLE: '填写入口已停用或失效，请联系发送二维码的客服。',
    SUBMISSION_NOT_FOUND: '填单不存在，请返回列表重新查看。',
    SUBMISSION_NOT_PENDING: '填单已确认或删除，请读取最新记录。',
    NEWER_SUBMISSION_EXISTS: '同手机号、同收货日期有更新填单，请刷新并核对后确认。',
    SUBMISSION_FORBIDDEN: '仅前台和管理人员可以处理客户填单。',
    SUBMISSION_TOO_LARGE: '填写内容过长，请精简商品需求后再提交。',
    SUBMISSION_THROTTLED: '提交过于频繁，请稍后再试。',
  } as Record<string, string>)[error.code] || (error.status === 429 ? '操作过于频繁，请稍后重试。' : `请求未完成（${error.code}），请核对后重试。`);
}
async function decode<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new ApiError(response.status, body?.code || `HTTP_${response.status}`);
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
function accept(token: Token) {
  clearTimeout(timer);
  publish({ token, loading: false, error: null });
  timer = setTimeout(() => { void refresh().catch(() => {}); }, Math.max(1000, (token.expiresIn - 60) * 1000));
}
export function forgetSession() {
  generation++;
  clearTimeout(timer);
  refreshing = null;
  publish({ token: null, loading: false, error: null });
}
export function refresh(): Promise<Token> {
  if (refreshing) return refreshing;
  const started = generation;
  const pending = authPost<Token>('refresh').then(token => {
    if (started !== generation) throw new ApiError(401, 'AUTHENTICATION_FAILED');
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
    forgetSession();
    const started = generation;
    const token = await authPost<Token>('login', { employeeNumber, password });
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
  return decode<T>(await authenticatedFetch(path, {
    method: options.method || 'GET', signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
}
export async function publicApi<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  return decode<T>(await fetch(`/api${path}`, {
    method: options.method || 'GET', credentials: 'omit', cache: 'no-store', signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
}
export async function uploadOrderImage(orderId: string, file: File, itemId: string, signal?: AbortSignal): Promise<OrderImage> {
  const body = new FormData();
  body.append('file', file);
  if (itemId) body.append('itemId', itemId);
  return decode<OrderImage>(await authenticatedFetch(`/orders/${orderId}/images`, { method: 'POST', body, signal }));
}
export async function fetchOrderImage(orderId: string, imageId: string, signal: AbortSignal): Promise<Blob> {
  const response = await authenticatedFetch(`/orders/${orderId}/images/${imageId}`, { signal });
  if (!response.ok) return decode<never>(response);
  return response.blob();
}
