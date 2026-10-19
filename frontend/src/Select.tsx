import { Children, isValidElement } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Button, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue } from 'react-aria-components';
import { CaretDown, Check } from '@phosphor-icons/react';

export type SelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'name' | 'disabled' | 'required' | 'autoFocus' | 'aria-invalid' | 'aria-describedby'> & {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode;
};
function optionText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('');
}
export function Select({ label, value, onChange, children, disabled, required, id, name, autoFocus, ...aria }: SelectProps) {
  const options = Children.toArray(children).filter(isValidElement<{ value: string; disabled?: boolean; children: ReactNode }>);
  return <AriaSelect className="choice-field" aria-label={label} value={value} onChange={key => onChange(key == null ? '' : String(key))}
    name={name} isDisabled={disabled} isRequired={required} autoFocus={autoFocus} isInvalid={Boolean(aria['aria-invalid'] && aria['aria-invalid'] !== 'false')} aria-describedby={aria['aria-describedby']} data-field-name={name} data-control-label={label}>
    <Button id={id} className="choice-trigger"><SelectValue /><CaretDown aria-hidden="true" size={18} /></Button>
    <Popover className="control-popover select-popover" placement="bottom start" offset={6} containerPadding={12}>
      <ListBox className="choice-list" aria-label={label}>{options.map(option => <ListBoxItem className="choice-option" key={option.props.value} id={option.props.value} textValue={optionText(option.props.children)} isDisabled={option.props.disabled}>
        {({ isSelected }) => <><span>{option.props.children}</span>{isSelected && <Check aria-hidden="true" size={18} weight="bold" />}</>}
      </ListBoxItem>)}</ListBox>
    </Popover>
  </AriaSelect>;
}
