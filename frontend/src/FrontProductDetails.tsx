import type { ReactNode } from 'react';
import type { Item } from './types';
import { hasUnitPrices } from './productTypes';
import { money, valueText } from './ui';
import { time } from './dates';

const display = (value: unknown) => value == null || typeof value === 'string' && !value.trim() ? '未填写' : valueText(value);

export function FrontProductDetails({ item, prices = false, children, actions }: { item: Item; prices?: boolean; children?: ReactNode; actions?: ReactNode }) {
  const cake = !hasUnitPrices(item.productType), attributes = item.attributes || {};
  return <section className="front-product-details" aria-label={`商品 ${item.name}`}>
    <div className="front-product-heading"><div><h3>商品名称</h3><strong>{item.name}</strong></div>{actions}</div>
    {children || <>
      <dl className="front-product-row front-product-pair">
        <div><dt>数量</dt><dd>{item.quantity}</dd></div>
        <div><dt>规格</dt><dd>{display(cake ? attributes.size : attributes.specification)}</dd></div>
      </dl>
      {cake && <dl className="front-product-row front-product-triple">
        <div><dt>内胚</dt><dd>{display(attributes.base ?? attributes.cakeBase)}</dd></div>
        <div><dt>夹馅</dt><dd>{display(attributes.filling)}</dd></div>
        <div><dt>奶油</dt><dd>{display(attributes.flavor)}</dd></div>
      </dl>}
      {prices && !cake && <dl className="front-product-row front-product-pair front-product-prices">
        <div><dt>价格</dt><dd>{money(item.unitPriceCents)}</dd></div>
        <div><dt>会员价</dt><dd>{money(item.memberPriceCents)}</dd></div>
      </dl>}
    </>}
  </section>;
}

export function FrontProductSupplement({ item }: { item: Item }) {
  const cake = !hasUnitPrices(item.productType);
  const displayed = new Set(['requirements', 'otherRequirements', 'message', 'greeting', ...(cake ? ['size', 'base', 'cakeBase', 'filling', 'flavor'] : ['specification'])]);
  const labels: Record<string, string> = { size: '历史尺寸', base: '历史内胚', cakeBase: '历史内胚', filling: '历史夹馅', flavor: '历史奶油', specification: '历史规格' };
  return <section className="front-product-supplement" aria-label="当前商品补充资料"><h3>{item.name}</h3>
    <dl className="info-grid"><div className="wide"><dt>祝福语</dt><dd>{display(item.attributes.message ?? item.attributes.greeting)}</dd></div>
      {Object.entries(item.attributes).filter(([key]) => !displayed.has(key)).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{display(value)}</dd></div>)}
    </dl>
    {item.recentNotes.length > 0 && <div className="recent-notes"><h4>最近商品备注</h4><ul>{item.recentNotes.map(note => <li key={note.id}><div className="note-meta"><strong>{note.actorNameSnapshot}</strong><time dateTime={note.createdAt}>{time(note.createdAt, true)}</time></div><p>{note.content}</p></li>)}</ul></div>}
  </section>;
}
