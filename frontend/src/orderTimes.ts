export type FinishTimeMode = 'AUTO' | 'MANUAL';
export interface TimeDraft {
  requestedReceiveAt: string; plannedFinishAt: string; finishTimeMode?: FinishTimeMode;
}

export const finishLeadTimeMessage = '出品时间须比取货时间至少提前 1 小时。';

export function finishTooLate(pickup: string | null | undefined, finish: string | null | undefined): boolean {
  return Boolean(pickup && finish && Date.parse(pickup) - Date.parse(finish) < 3600000);
}

export function pickupTimeLabel(type: string) {
  return type === 'PICKUP' ? '到店自提时间' : '配送员取货时间';
}

/** Local store times are interpreted in Beijing, independent of the browser timezone. */
export function defaultFinishTime(pickup: string): string {
  if (pickup.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(pickup)) return '';
  const instant = Date.parse(pickup + ':00+08:00');
  if (!Number.isFinite(instant) || new Date(instant + 8 * 3600000).toISOString().slice(0, 16) !== pickup) return '';
  return new Date(instant + 7 * 3600000).toISOString().slice(0, 16);
}
export function finishMode(draft: TimeDraft): FinishTimeMode {
  return draft.finishTimeMode ?? (draft.plannedFinishAt ? 'MANUAL' : 'AUTO');
}
export function changePickupTime<T extends TimeDraft>(draft: T, value: string): T {
  return { ...draft, requestedReceiveAt: value, finishTimeMode: finishMode(draft),
    ...(finishMode(draft) === 'AUTO' ? { plannedFinishAt: defaultFinishTime(value) } : {}) };
}
export function changeFinishTime<T extends TimeDraft>(draft: T, value: string): T {
  return { ...draft, plannedFinishAt: value, finishTimeMode: 'MANUAL' };
}
export function restoreAutomaticFinish<T extends TimeDraft>(draft: T): T {
  return { ...draft, finishTimeMode: 'AUTO', plannedFinishAt: defaultFinishTime(draft.requestedReceiveAt) };
}
export function pickupInstant(plan: { plannedHandoffAt?: string | null; requestedReceiveAt?: string | null }): string | null {
  return plan.plannedHandoffAt || plan.requestedReceiveAt || null;
}
export function pickupDate(plan: { plannedHandoffAt?: string | null; requestedReceiveAt?: string | null; requestedReceiveDate: string }): string {
  const instant = pickupInstant(plan);
  return instant ? new Date(Date.parse(instant) + 8 * 3600000).toISOString().slice(0, 10) : plan.requestedReceiveDate;
}
export function hasLegacyTimeConflict(plan: { plannedHandoffAt?: string | null; requestedReceiveAt?: string | null }): boolean {
  return Boolean(plan.plannedHandoffAt && plan.requestedReceiveAt && Date.parse(plan.plannedHandoffAt) !== Date.parse(plan.requestedReceiveAt));
}
