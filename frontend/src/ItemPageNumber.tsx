import { useEffect, useRef, useState } from 'react';

export function ItemPageNumber({ current, total, disabled, onJump }: {
  current: number; total: number; disabled: boolean; onJump: (index: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(null), [current, total]);
  const value = draft ?? String(current);
  const target = Number(value);
  const valid = /^\d+$/.test(value) && target >= 1 && target <= total;
  const canJump = valid && target !== current;
  const range = `商品序号（1–${total}）`;

  function jump() {
    if (disabled || !canJump) return;
    onJump(target - 1);
    setDraft(null);
    input.current?.focus({ preventScroll: true });
  }

  return <div className="item-page-number">
    <span className="sr-only" aria-live="polite">第 {current} / {total} 个商品</span>
    <span aria-hidden="true">第</span>
    <input ref={input} type="text" inputMode="numeric" autoComplete="off" aria-label={range} title={range}
      disabled={disabled || total === 1} value={value} aria-invalid={Boolean(value) && !valid || undefined}
      onFocus={event => event.currentTarget.select()}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          jump();
        }
        if (event.key === 'Escape') setDraft(null);
      }} />
    <span aria-hidden="true">/ {total} 个商品</span>
    {canJump && !disabled && <button type="button" className="secondary item-page-jump" onClick={jump}>跳转</button>}
  </div>;
}
