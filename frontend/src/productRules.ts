import defaults from '../../WuhouCake-order/src/main/resources/order/cake-defaults.json' with { type: 'json' };

export const cakeDefaults = defaults as Readonly<{ base: string; filling: string }>;
export function normalizeSize(value: string): string {
  const text = value.trim().replace(/(?:英寸|寸)$/, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 32) throw new Error('尺寸需要单个明确的正数。');
  const [integer, fraction = ''] = text.split('.');
  const whole = BigInt(integer).toString(), decimal = fraction.replace(/0+$/, '');
  if (whole === '0' && !decimal) throw new Error('尺寸必须大于零。');
  return decimal ? whole + '.' + decimal : whole;
}
