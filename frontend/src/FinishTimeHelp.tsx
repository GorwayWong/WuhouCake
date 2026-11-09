import { validDate } from './orderForm';
import { finishMode, restoreAutomaticFinish } from './orderTimes';
import type { TimeDraft } from './orderTimes';

export function FinishTimeHelp<T extends TimeDraft>({ draft, onChange, disabled }: {
  draft: T; onChange: (value: T) => void; disabled: boolean;
}) {
  const pickupDate = draft.requestedReceiveAt.split('T', 1)[0];
  const finishDate = draft.plannedFinishAt.split('T', 1)[0];
  const differentDates = pickupDate !== finishDate && validDate(pickupDate) && validDate(finishDate);
  return <span className="finish-time-help" aria-live="polite">
    {differentDates && <span className="form-help finish-date-warning">出品和取货不在同一天，请核对。</span>}
    <span className="form-help">默认取货前一小时，可手动调整。</span>
    {finishMode(draft) === 'MANUAL' && <button type="button" className="text-button" disabled={disabled}
      onClick={() => onChange(restoreAutomaticFinish(draft))}>恢复自动计算</button>}</span>;
}
