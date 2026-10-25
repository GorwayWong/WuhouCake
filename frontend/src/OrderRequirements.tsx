import { NotePencil } from '@phosphor-icons/react';
import type { Item } from './types';
import { orderRequirements } from './orderingRequirements';

export function OrderRequirements({ items }: { items: Item[] }) {
  const requirements = orderRequirements(items);
  return <section className="panel order-requirements" aria-label="下单备注与特殊要求">
    <h2><NotePencil aria-hidden="true" />下单备注与特殊要求</h2>
    {requirements.length ? <dl>{requirements.map(item => <div key={item.itemId}><dt>{item.name}</dt><dd>{item.text}</dd></div>)}</dl> : <p className="requirement-empty">无</p>}
  </section>;
}
