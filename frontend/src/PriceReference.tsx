import { itemTotals } from './itemPricing';
import type { PriceItem } from './itemPricing';
import { exactYuan } from './money';
import { draftQuantity, draftQuoteCents } from './orderForm';
import { money } from './ui';

type DraftPriceItem = { name: string; quantity: string; unitPrice: string; memberPrice: string };

function quantityReference(value: string): number {
  try { return draftQuantity(value); }
  catch { return NaN; }
}

export function draftPriceItems(items: DraftPriceItem[]): PriceItem[] {
  return items.filter(item => item.name.trim()).map(item => ({
    quantity: quantityReference(item.quantity),
    unitPriceCents: draftQuoteCents(item.unitPrice),
    memberPriceCents: draftQuoteCents(item.memberPrice),
  }));
}

export function PriceAmountHint({ items, kind, amount }: {
  items: PriceItem[]; kind: 'original' | 'member'; amount: number | null;
}) {
  if (!items.length) return null;
  let reference: number | null;
  try {
    const totals = itemTotals(items);
    reference = kind === 'original' ? totals.original : totals.total;
  } catch { return null; }
  return <span className="form-help">商品{kind === 'original' ? '原价' : '会员价'}合计 {money(reference)}
    {reference !== null && amount !== null && reference !== amount && ' · 将采用填写金额'}</span>;
}

export function PriceReference({ items, original, member, useTotals, inlineAmounts = false }: {
  items: PriceItem[]; original: number | null; member: number | null;
  inlineAmounts?: boolean;
  useTotals?: (original: string | undefined, member: string | undefined) => void;
}) {
  if (!items.length) return null;
  let totals;
  try { totals = itemTotals(items); }
  catch { return <p className="form-help">请核对商品价格和数量，暂时无法计算商品合计。</p>; }

  const missingOriginal = items.filter(item => item.unitPriceCents == null).length;
  const memberFallback = items.filter(item => item.memberPriceCents == null && item.unitPriceCents != null).length;
  const availableTotals = totals.original !== null || totals.member !== null;
  const mismatch = (reference: number | null, entered: number | null) =>
    reference !== null && entered !== null && reference !== entered;
  const originalMismatch = mismatch(totals.original, original);
  const memberMismatch = mismatch(totals.total, member ?? original);

  return <div className="price-reference">
    {!inlineAmounts && <p className="form-help">商品原价合计 {money(totals.original)} · 商品会员价合计 {money(totals.total)}</p>}
    {!inlineAmounts && originalMismatch && <p className="form-help">填写的原价 {money(original)} 与商品原价合计不同，将采用您填写的金额。</p>}
    {memberMismatch && (member !== null ? !inlineAmounts : !originalMismatch || inlineAmounts) && <p className="form-help">
      {member !== null ? `填写的会员价 ${money(member)} 与商品会员价合计不同，将采用您填写的金额。` : '未填写整单会员价，成交时采用原价，与商品会员价合计不同。'}
    </p>}
    {missingOriginal > 0 && <p className="form-help">{missingOriginal} 项商品未填原单价，暂时算不出完整的商品原价合计。</p>}
    {memberFallback > 0 && <p className="form-help">{memberFallback} 项商品未填会员单价，计算商品会员价合计时采用原单价。</p>}
    {totals.unpriced > 0 && <p className="form-help">{totals.unpriced} 项商品没有报价，暂时算不出完整的商品会员价合计。</p>}
    {useTotals && availableTotals && <button type="button" className="text-button"
      onClick={() => useTotals(totals.original === null ? undefined : exactYuan(totals.original),
        totals.total === null ? undefined : totals.member === null ? '' : exactYuan(totals.member))}>采用商品合计</button>}
  </div>;
}
