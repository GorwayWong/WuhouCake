import type { ReactNode } from 'react';
import type { Item } from './types';
import { isCake } from './productTypes';
import { ItemPriceFields, itemSpecification, valueText } from './ui';

const display = (value: unknown) => value == null || typeof value === 'string' && !value.trim() ? '未填写' : valueText(value);

export function FrontProductDetails({ item, prices = false, itemSum = false, children, actions, completion }: { item: Item; prices?: boolean; itemSum?: boolean; children?: ReactNode; actions?: ReactNode; completion?: ReactNode }) {
  const cake = isCake(item.productType), attributes = item.attributes || {};
  const specification = itemSpecification(item);
  return <section className="front-product-details" aria-label={`商品 ${item.name}`}>
    <div className="front-product-heading"><div><h3>商品名称</h3><div className="detail-product-name-row"><strong>{item.name}</strong>{completion}</div></div>{actions}</div>
    {children || <>
      <dl className="front-product-row front-product-pair">
        <div><dt>数量</dt><dd>{item.quantity}</dd></div>
        {cake && <div><dt>尺寸</dt><dd className="product-spec-text">{display(attributes.size)}</dd></div>}
        {!cake && specification && <div><dt>商品说明</dt><dd className="product-spec-text">{specification}</dd></div>}
      </dl>
      {cake && <dl className="front-product-row front-product-triple">
        <div><dt>内胚</dt><dd>{display(attributes.base ?? attributes.cakeBase)}</dd></div>
        <div><dt>夹馅</dt><dd>{display(attributes.filling)}</dd></div>
        <div><dt>奶油</dt><dd>{display(attributes.flavor)}</dd></div>
      </dl>}
      {cake && specification && <dl className="front-product-row"><div><dt>商品说明</dt><dd className="product-spec-text">{specification}</dd></div></dl>}
      {prices && (item.unitPriceCents != null || item.memberPriceCents != null) && (
        <dl className="front-product-row front-product-pair"><ItemPriceFields item={item} itemSum={itemSum} /></dl>
      )}
    </>}
  </section>;
}

export function ProductAdditionalFields({ item }: { item: Item }) {
  const cake = isCake(item.productType);
  const displayed = new Set(['requirements', 'otherRequirements', 'specification',
    ...(cake ? ['size', 'base', 'cakeBase', 'filling', 'flavor', 'message', 'greeting'] : [])]);
  const labels: Record<string, string> = {
    size: '历史尺寸', base: '历史内胚', cakeBase: '历史内胚', filling: '历史夹馅',
    flavor: '历史奶油', message: '历史祝福语', greeting: '历史祝福语',
  };
  const fields = Object.entries(item.attributes)
    .filter(([key, value]) => !displayed.has(key) && value != null && valueText(value).trim())
    .map(([key, value]) => ({ key, label: labels[key] || key, text: valueText(value) }));
  const greeting = item.attributes.message ?? item.attributes.greeting;
  if (cake && greeting != null && valueText(greeting).trim()) {
    fields.unshift({ key: 'greeting', label: '祝福语', text: valueText(greeting) });
  }
  if (!fields.length) return null;
  return <dl className="front-product-row">
    {fields.map(({ key, label, text }) => <div key={key}><dt>{label}</dt><dd>{text}</dd></div>)}
  </dl>;
}
