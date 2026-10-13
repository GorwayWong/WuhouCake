import type { Token } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return '网络连接失败，请检查连接后重试。';
  return ({
    AUTHENTICATION_FAILED: '工号或密码有误，或登录已过期。',
    CONCURRENT_MODIFICATION: '其他同事已更新此订单。已获取最新数据，请核对后再次操作；未发布的内容已保留。',
    INVALID_PRODUCTION_TRANSITION: '制作状态已变化，请核对最新状态后操作。',
    INVALID_FULFILLMENT_TRANSITION: '当前订单不能执行此交付操作，请核对最新状态。',
    ORDER_NOT_CANCELLABLE: '此订单当前不能取消。',
    ORDER_NOT_FOUND: '订单或商品不存在。',
    VALIDATION_FAILED: '填写内容不符合要求，请检查后重试。',
    FORBIDDEN: '当前账号不能执行此操作。',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
    PASSWORD_REUSE_FORBIDDEN: '新密码不能与当前密码相同。',
    SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试。',
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
  const before = state.token?.accessToken;
  if (!before) throw new ApiError(401, 'AUTHENTICATION_FAILED');
  const send = (token: string) => fetch(`/api${path}`, {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  let response = await send(before);
  if (response.status === 401 && !init.signal?.aborted) {
    const token = state.token?.accessToken !== before && state.token ? state.token : await refresh();
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    response = await send(token.accessToken);
    if (response.status === 401) forgetSession();
  }
  return response;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  return decode<T>(await authenticatedFetch(path, {
    method: options.method || 'GET', signal: options.signal,
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
}
