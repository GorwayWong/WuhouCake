import { defaultFinishTime, finishLeadTimeMessage, finishMode, restoreAutomaticFinish } from './orderTimes';
import type { TimeDraft } from './orderTimes';

export function FinishTimeHelp<T extends TimeDraft>({ draft, onChange, disabled, error }: {
  draft: T; onChange: (value: T) => void; disabled: boolean; error?: string;
}) {
  const latestFinish = defaultFinishTime(draft.requestedReceiveAt);
  const tooLate = Boolean(latestFinish && (draft.plannedFinishAt > latestFinish || error === finishLeadTimeMessage));
  return <span className="finish-time-help" aria-live="polite">
    {tooLate && !error && <span className="form-help finish-date-warning">{finishLeadTimeMessage}</span>}
    {!tooLate && <span className="form-help">默认提前 1 小时，可安排更早出品。</span>}
    {finishMode(draft) === 'MANUAL' && <button type="button" className="text-button" disabled={disabled}
      onClick={() => onChange(restoreAutomaticFinish(draft))}>{tooLate ? '设为提前 1 小时' : '恢复自动计算'}</button>}</span>;
}
