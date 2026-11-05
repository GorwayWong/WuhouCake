import { useState } from 'react';
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput as Segments, DatePicker, DateSegment, Dialog, FieldError, Group, Heading, Popover } from 'react-aria-components';
import { CalendarBlank, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { today } from './dates';
import { completeDateTime, pickerDate, pickerText } from './dateControls';
import { parseDate } from '@internationalized/date';
import { Select } from './Select';

const businessHours = Array.from({ length: 16 }, (_, index) => String(index + 7).padStart(2, '0'));

interface Props {
  label: string; id?: string; name?: string; type?: 'date' | 'datetime-local';
  value: string; onChange: (value: string, parts?: { date: string; time: string }) => void; required?: boolean; disabled?: boolean;
  resetTimeOnDateChange?: boolean; timeOptional?: boolean;
  dateDisplay?: 'full' | 'month-day'; showTimeHint?: boolean; compactTime?: boolean;
  'aria-invalid'?: boolean; 'aria-describedby'?: string;
}
function DateTimeInput({ value, onChange, label, name, id, required, disabled, resetTimeOnDateChange = false, timeOptional = false, dateDisplay, showTimeHint = true, compactTime = false, ...aria }: Props) {
  const split = (source: string) => {
    const [date = '', time = ''] = source.split('T'), [hour = '', minute = ''] = time.split(':');
    return { source, date, hour, minute };
  };
  const [draft, setDraft] = useState(() => split(value));
  if (draft.source !== value) setDraft(split(value));
  const update = (patch: Partial<Pick<typeof draft, 'date' | 'hour' | 'minute'>>) => {
    const next = { ...draft, ...patch };
    if (patch.date === '') { next.hour = ''; next.minute = ''; }
    if (resetTimeOnDateChange && patch.date !== undefined && patch.date !== draft.date) { next.hour = ''; next.minute = ''; }
    if (next.hour && !next.minute) next.minute = '00';
    const time = next.hour && next.minute ? `${next.hour}:${next.minute}` : '';
    const text = completeDateTime(next.date, time) || (timeOptional && !next.hour && !next.minute ? next.date : '') || (next.date || next.hour || next.minute ? `${next.date}T${next.hour}:${next.minute}` : '');
    setDraft({ ...next, source: text }); onChange(text, { date: next.date, time });
  };
  return <div className="date-time-field" data-field-name={name} data-control-label={label}>
    <DateInput label={`${label}日期`} id={id} value={draft.date} dateDisplay={dateDisplay} onChange={date => update({ date })} required={required} disabled={disabled} {...aria} />
    <div className="time-field" role="group" aria-label={`${label}时刻`}>
      <Select label={`${label}小时`} value={draft.hour} onChange={hour => update({ hour })} required={required && !timeOptional} disabled={disabled} {...aria}>
        <option value="">小时</option>{draft.hour && !businessHours.includes(draft.hour) && <option value={draft.hour} disabled>{draft.hour}{compactTime ? '（原值）' : ' 时（原值）'}</option>}{businessHours.map(hour => <option key={hour} value={hour}>{hour}{!compactTime && ' 时'}</option>)}
      </Select>
      <Select label={`${label}分钟`} value={draft.minute} onChange={minute => update({ minute })} required={required && !timeOptional} disabled={disabled} {...aria}>
        <option value="">分钟</option>{Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map(minute => <option key={minute} value={minute}>{minute}{!compactTime && ' 分'}</option>)}
      </Select>
    </div>
    {timeOptional && (showTimeHint || draft.hour || draft.minute) && <div className="optional-time-help">{showTimeHint && <span>{!draft.hour && !draft.minute ? '时刻待定' : '时刻选填'}</span>}{(draft.hour || draft.minute) && <button type="button" className="text-button" disabled={disabled} onClick={() => update({ hour: '', minute: '' })}>清除时刻</button>}</div>}
    <input type="hidden" name={name} value={value} />
  </div>;
}
export function DateInput({ label, type = 'date', value, onChange, required, disabled, id, name, resetTimeOnDateChange, timeOptional, dateDisplay, showTimeHint, compactTime, ...aria }: Props) {
  if (type === 'datetime-local') return <DateTimeInput label={label} value={value} onChange={onChange} required={required} disabled={disabled} id={id} name={name} timeOptional={timeOptional} resetTimeOnDateChange={resetTimeOnDateChange} dateDisplay={dateDisplay} showTimeHint={showTimeHint} compactTime={compactTime} {...aria} />;
  return <CalendarInput label={label} value={value} onChange={onChange} required={required} disabled={disabled} id={id} name={name} dateDisplay={dateDisplay} {...aria} />;
}
function CalendarInput({ label, value, onChange, required, disabled, id, name, dateDisplay, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const date = pickerDate(value, false);
  return <DatePicker className="date-field" aria-label={label} name={name} data-field-name={name} data-control-label={label}
    value={date} onChange={date => onChange(pickerText(date, false))} isRequired={required} isDisabled={disabled}
    isInvalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']} granularity="day"
    placeholderValue={parseDate(today())} shouldForceLeadingZeros firstDayOfWeek="mon"
    isOpen={open} onOpenChange={setOpen} shouldCloseOnSelect>{({ state }) => <>
    <Group className="date-control" onKeyDownCapture={event => { if (event.key === 'Enter' && (event.target as HTMLElement).matches('[role="spinbutton"]')) { event.preventDefault(); setOpen(false); (event.target as HTMLElement).blur(); } }}>
      {dateDisplay === 'month-day' ? <button type="button" className="date-month-day" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={date ? `${label}，${value}` : `选择${label}`} onClick={() => setOpen(true)}>{date ? `${date.month}月${date.day}日` : '选择日期'}</button> : <Segments className="date-segments">{segment => <DateSegment segment={segment} className="date-segment" />}</Segments>}
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
