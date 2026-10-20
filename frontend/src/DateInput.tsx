import { useState } from 'react';
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput as Segments, DatePicker, DateSegment, Dialog, FieldError, Group, Heading, Popover, TimeField } from 'react-aria-components';
import { CalendarBlank, CaretLeft, CaretRight, Clock, X } from '@phosphor-icons/react';
import { today } from './dates';
import { completeDateTime, pickerDate, pickerText } from './dateControls';
import { parseDate, parseTime } from '@internationalized/date';

interface Props {
  label: string; id?: string; name?: string; type?: 'date' | 'datetime-local';
  value: string; onChange: (value: string, parts?: { date: string; time: string }) => void; required?: boolean; disabled?: boolean;
  resetTimeOnDateChange?: boolean;
  'aria-invalid'?: boolean; 'aria-describedby'?: string;
}
function closeOnEnter(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' && (event.target as HTMLElement).matches('[role="spinbutton"]')) { event.preventDefault(); (event.target as HTMLElement).blur(); }
}
function DateTimeInput({ value, onChange, label, name, id, required, disabled, resetTimeOnDateChange = false, ...aria }: Props) {
  const split = (source: string) => ({ source, date: source.slice(0, 10), time: source.slice(11, 16) });
  const [draft, setDraft] = useState(() => split(value));
  if (draft.source !== value) setDraft(split(value));
  const update = (patch: Partial<Pick<typeof draft, 'date' | 'time'>>) => {
    const next = { ...draft, ...patch };
    if (resetTimeOnDateChange && patch.date !== undefined && patch.date !== draft.date) next.time = '';
    const text = completeDateTime(next.date, next.time);
    setDraft({ ...next, source: text }); onChange(text, { date: next.date, time: next.time });
  };
  let clock = null;
  try { if (draft.time) clock = parseTime(draft.time); } catch { /* 无效输入保持待填写，交由表单校验。 */ }
  return <div className="date-time-field" data-field-name={name} data-control-label={label}>
    <DateInput label={`${label}日期`} id={id} value={draft.date} onChange={date => update({ date })} required={required} disabled={disabled} {...aria} />
    <TimeField className="time-field" aria-label={`${label}时刻`} value={clock} onChange={time => update({ time: time?.toString().slice(0, 5) || '' })}
      hourCycle={24} granularity="minute" shouldForceLeadingZeros isRequired={required} isDisabled={disabled} isInvalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']}>
      <Group className="date-control" onKeyDownCapture={closeOnEnter}><Segments className="date-segments">{segment => <DateSegment segment={segment} className="date-segment" />}</Segments><Clock aria-hidden="true" size={18} /></Group><FieldError className="field-error" />
    </TimeField>
    <input type="hidden" name={name} value={value} />
  </div>;
}
export function DateInput({ label, type = 'date', value, onChange, required, disabled, id, name, resetTimeOnDateChange, ...aria }: Props) {
  if (type === 'datetime-local') return <DateTimeInput label={label} value={value} onChange={onChange} required={required} disabled={disabled} id={id} name={name} resetTimeOnDateChange={resetTimeOnDateChange} {...aria} />;
  return <CalendarInput label={label} value={value} onChange={onChange} required={required} disabled={disabled} id={id} name={name} {...aria} />;
}
function CalendarInput({ label, value, onChange, required, disabled, id, name, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  return <DatePicker className="date-field" aria-label={label} name={name} data-field-name={name} data-control-label={label}
    value={pickerDate(value, false)} onChange={date => onChange(pickerText(date, false))} isRequired={required} isDisabled={disabled}
    isInvalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']} granularity="day"
    placeholderValue={parseDate(today())} shouldForceLeadingZeros firstDayOfWeek="mon"
    isOpen={open} onOpenChange={setOpen} shouldCloseOnSelect>{({ state }) => <>
    <Group className="date-control" onKeyDownCapture={event => { if (event.key === 'Enter' && (event.target as HTMLElement).matches('[role="spinbutton"]')) { event.preventDefault(); setOpen(false); (event.target as HTMLElement).blur(); } }}>
      <Segments className="date-segments">{segment => <DateSegment segment={segment} className="date-segment" />}</Segments>
      <Button id={id} className="date-open" aria-label={`选择${label}`}><CalendarBlank size={20} /></Button>
    </Group>
    <Popover className="control-popover date-popover" placement="bottom start" offset={6} containerPadding={12}>
      <Dialog aria-label={`选择${label}`}>
        <Calendar className="date-calendar" firstDayOfWeek="mon">
          <header><Button slot="previous" aria-label="上个月"><CaretLeft size={20} /></Button><Heading /><Button slot="next" aria-label="下个月"><CaretRight size={20} /></Button></header>
          <CalendarGrid weekdayStyle="short"><CalendarGridHeader>{day => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader><CalendarGridBody>{date => <CalendarCell date={date} />}</CalendarGridBody></CalendarGrid>
        </Calendar>
        <footer className="date-actions"><Button onPress={() => { state.setValue(null); onChange(''); setOpen(false); }}><X aria-hidden="true" size={16} />清空</Button><Button onPress={() => { state.setDateValue(parseDate(today())); setOpen(false); }}>今天</Button></footer>
      </Dialog>
    </Popover>
    <FieldError className="field-error" />
  </>}</DatePicker>;
}
