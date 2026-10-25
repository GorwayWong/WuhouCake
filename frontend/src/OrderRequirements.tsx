import { NotePencil } from '@phosphor-icons/react';
import type { Item } from './types';
import { orderRequirements } from './orderingRequirements';

export function OrderRequirements({ items, compact = false }: { items: Item[]; compact?: boolean }) {
  const requirements = orderRequirements(items);
  if (!requirements.length) return null;
  return <section className={`${compact ? '' : 'panel '}order-requirements`} aria-label="下单备注与特殊要求">
    <h2><NotePencil aria-hidden="true" />下单备注与特殊要求</h2>
    <dl>{requirements.map(item => <div key={item.itemId}><dt>{item.name}</dt><dd>{item.text}</dd></div>)}</dl>
  </section>;
}
