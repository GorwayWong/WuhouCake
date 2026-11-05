import { finishMode, restoreAutomaticFinish } from './orderTimes';
import type { TimeDraft } from './orderTimes';

export function FinishTimeHelp<T extends TimeDraft>({ draft, onChange, disabled }: {
  draft: T; onChange: (value: T) => void; disabled: boolean;
}) {
  return <span className="finish-time-help"><span className="form-help">默认取货前一小时，可手动调整。</span>
    {finishMode(draft) === 'MANUAL' && <button type="button" className="text-button" disabled={disabled}
      onClick={() => onChange(restoreAutomaticFinish(draft))}>恢复自动计算</button>}</span>;
}
