export function focusFormField(form: HTMLFormElement | null, name: string) {
  const control = Array.from(form?.querySelectorAll<HTMLElement>('[data-field-name]') || []).find(element => element.dataset.fieldName === name);
  const target = control?.querySelector<HTMLElement>('[role="spinbutton"][data-placeholder]') || control?.querySelector<HTMLElement>('[role="spinbutton"], button') || form?.elements.namedItem(name);
  if (target instanceof HTMLElement) target.focus();
}
