import defaults from '../../WuhouCake-order/src/main/resources/order/cake-defaults.json' with { type: 'json' };

export const cakeDefaults = defaults as Readonly<{ base: string; filling: string; flavor: string }>;
export type CakeDefaultField = keyof typeof cakeDefaults;
export function isCakeDefaultField(field: string): field is CakeDefaultField { return Object.hasOwn(cakeDefaults, field); }
