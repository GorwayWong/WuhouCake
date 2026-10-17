import defaults from '../../WuhouCake-order/src/main/resources/order/cake-defaults.json' with { type: 'json' };

export const cakeDefaults = defaults as Readonly<{ base: string; filling: string }>;
export function numericSize(value: string): string {
  const text = value.trim();
  if (!/^[0-9]{1,9}(?:\.[0-9]{1,2})?$/.test(text)) throw new Error('尺寸请填大于零的数字，最多两位小数，不带“寸”。');
  return normalizeSize(text);
}
export function normalizeSize(value: string): string {
  const text = value.trim().replace(/(?:英寸|寸)$/, '').trim();
  if (!/^[0-9]{1,9}(?:\.[0-9]{1,2})?$/.test(text)) throw new Error('尺寸需要单个正数，最多两位小数、九位整数。');
  const [integer, fraction = ''] = text.split('.');
  const whole = BigInt(integer).toString(), decimal = fraction.replace(/0+$/, '');
  if (whole === '0' && !decimal) throw new Error('尺寸必须大于零。');
  return decimal ? whole + '.' + decimal : whole;
}
