import { useRef } from 'react';
import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  type?: 'date' | 'datetime-local';
  onChange: (value: string) => void;
};

export function DateInput({ type = 'date', onChange, onKeyDown, onPointerDown, ...props }: Props) {
  const typing = useRef(false);
  return <input {...props} type={type} onPointerDown={event => { typing.current = false; onPointerDown?.(event); }} onKeyDown={event => {
    typing.current = true;
    onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === 'Enter' && event.currentTarget.value && event.currentTarget.validity.valid) {
      event.preventDefault(); event.currentTarget.blur();
    }
  }} onChange={event => {
    const input = event.currentTarget;
    onChange(input.value);
    // 鼠标或触屏选定后收起原生面板；键盘逐段输入时保持焦点。
    if (!typing.current && input.value && input.validity.valid) input.blur();
  }} />;
}
