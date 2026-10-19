import { parseDate, parseDateTime } from '@internationalized/date';
import type { DateValue } from 'react-aria-components';

export function pickerDate(value: string | undefined, withTime: boolean): DateValue | null {
  if (!value) return null;
  try { return withTime ? parseDateTime(value) : parseDate(value); } catch { return null; }
}
export function pickerText(value: DateValue | null, withTime: boolean): string {
  return value ? value.toString().slice(0, withTime ? 16 : 10) : '';
}
export function completeDateTime(date: string, time: string): string {
  return date && /^\d{2}:\d{2}$/.test(time) && pickerDate(`${date}T${time}`, true) ? `${date}T${time}` : '';
}
