export function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function workbenchDate(hash: string): string | null {
  const date = /^#\/\?date=(\d{4}-\d{2}-\d{2})$/.exec(hash)?.[1];
  return date && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && shiftDate(date, 0) === date ? date : null;
}
export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
export function calendarRange(selected: string, mode: 'week' | 'month') {
  const from = weekStart(mode === 'week' ? selected : `${selected.slice(0, 7)}-01`);
  const count = mode === 'week' ? 7 : 42;
  return { from, to: shiftDate(from, count), dates: Array.from({ length: count }, (_, i) => shiftDate(from, i)) };
}
export function shiftMonth(date: string, delta: number): string {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + delta);
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(Number(date.slice(8)), last));
  return value.toISOString().slice(0, 10);
}
export function time(value: string | null, full = false): string {
  if (!value) return '未填写';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', ...(full ? { year: 'numeric', month: '2-digit', day: '2-digit' } as const : {}),
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

/** 业务日期按上海时区显示；省略年份不改变原日期值。 */
export function businessDate(value: string | null | undefined, now = new Date()): string {
  if (!value) return '未填写';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00+08:00` : value);
  if (!Number.isFinite(date.getTime())) return '未填写';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now);
  return `${part('year') === year ? '' : `${part('year')}/`}${part('month')}/${part('day')}`;
}

export function businessTime(value: string | null | undefined, now = new Date()): string {
  const date = businessDate(value, now);
  return date === '未填写' ? date : `${date} ${time(value!)}`;
}
