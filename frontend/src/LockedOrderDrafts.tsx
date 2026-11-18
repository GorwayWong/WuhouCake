import { useEffect, useState } from 'react';
import { EditDraftRecovery, editDraftKey, listLockedDraftKeys } from './EditDraftRecovery';
import type { DraftAccess, EditDraftWriter } from './EditDraftRecovery';
import type { InformationEditDraft } from './InformationEdit';
import type { ItemEditDraft } from './ItemEdit';
import { canEditItems, specificationFields } from './orderForm';
import { productTypeLabel } from './productTypes';
import type { Detail } from './types';

function informationText(value: InformationEditDraft['value'], access: DraftAccess) {
  const [customer, amounts, phone, ordering] = access;
  return [
    ...(customer ? [`客户：${value.customerName ?? ''}`, `会员手机：${value.memberPhone ?? ''}`, `交接方式：${value.fulfillmentType === 'DELIVERY' ? '配送上门' : '门店自提'}`,
      `地址：${value.address ?? ''}`, `取货时间：${value.requestedReceiveAt || value.requestedReceiveDate || ''}`, `出品时间：${value.plannedFinishAt ?? ''}`] : []),
    ...(phone ? [`联系电话：${value.phone ?? ''}`] : []),
    ...(ordering ? [`订购人：${value.buyerName ?? ''}`, `下单方式：${value.orderingMethod ?? ''}`] : []),
    ...(value.creditedEmployeeId ? [`业绩归属员工 ID：${value.creditedEmployeeId}`] : []),
    ...(amounts ? [`原价：${value.totalAmount ?? ''}`, `会员价：${value.memberAmount ?? ''}`] : []),
  ].join('\n');
}

function DraftContent({ text, status, writer, onDiscard }: {
  text: string; status?: string; writer: EditDraftWriter<unknown>; onDiscard: () => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  return <>
    {status && <p role="status">{status}</p>}
    <textarea aria-label="草稿内容" readOnly rows={5} value={text} />
    <div className="actions">
      <button type="button" className="text-button" disabled={discarding} onClick={async () => {
        if (!window.confirm('放弃这份本机草稿？')) return;
        setDiscarding(true);
        if (await writer.clear()) onDiscard();
        else setDiscarding(false);
      }}>放弃草稿</button>
    </div>
  </>;
}

export function LockedOrderDrafts({ accountId, order, access, canViewItems }: {
  accountId: string; order: Detail; access: DraftAccess; canViewItems: boolean;
}) {
  const [customer, amounts, phone, ordering] = access;
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof listLockedDraftKeys>>>([]);
  const [openKey, setOpenKey] = useState('');
  const orderId = order.orderId;

  useEffect(() => {
    let active = true;
    setOpenKey('');
    void listLockedDraftKeys(accountId, orderId, [customer, amounts, phone, ordering])
      .then(found => { if (active) setKeys(found); })
      .catch(() => { if (active) setKeys([]); });
    return () => { active = false; };
  }, [accountId, orderId, customer, amounts, phone, ordering]);

  const deleted = Boolean(order.deletion);
  const editableItems = canEditItems(order);
  const locked = keys.filter(({ key, kind, itemId }) => {
    if (key !== editDraftKey(accountId, orderId, kind, itemId ?? undefined, access)) return false;
    if (kind === 'information') return deleted && customer && canViewItems;
    if (kind === 'amount') return amounts && (deleted || order.paymentStatus === 'PAID' || order.pricingMode === 'ITEM_SUM');
    return canViewItems && (!editableItems || (itemId !== null && !order.items.some(item => item.itemId === itemId)));
  });
  if (!locked.length) return null;

  return <details className="panel">
    <summary>查看本机草稿</summary>
    <p className="form-help">订单或商品状态已变化，以下草稿可查看和复制。</p>
    {locked.map(({ key, kind, itemId }) => {
      const title = kind === 'information' ? '订单资料草稿' : kind === 'amount' ? '金额草稿' : itemId ? '商品编辑草稿' : '追加商品草稿';
      if (key !== openKey) return <div className="actions" key={key}>
        <button type="button" className="secondary" onClick={() => setOpenKey(key)}>{title}</button>
      </div>;

      const close = () => setOpenKey('');
      const remove = () => { setKeys(current => current.filter(draft => draft.key !== key)); close(); };
      const missing = <p role="status">这份草稿已找不到，请刷新订单后核对。</p>;
      return <section key={key}>
        <h3>{title}</h3>
        {kind !== 'item'
          ? <EditDraftRecovery<InformationEditDraft> scope={key} openStored onClose={close}>
            {(draft, writer) => draft ? <DraftContent
              text={informationText(draft.value, kind === 'amount' ? [false, amounts, false, false] : access)}
              writer={writer} onDiscard={remove} /> : missing}
          </EditDraftRecovery>
          : <EditDraftRecovery<ItemEditDraft> scope={key} openStored onClose={close}>
            {(draft, writer) => {
              if (!draft) return missing;
              const { value, pending } = draft;
              const fields = [`商品名称：${value.name}`, `商品类型：${productTypeLabel(value.productType)}`, `数量：${value.quantity}`];
              if (amounts) fields.push(`原价：${value.unitPrice}`, `会员价：${value.memberPrice}`);
              for (const [field, label] of specificationFields) {
                if (value.attributes[field]) fields.push(`${label}：${value.attributes[field]}`);
              }
              if (draft.previousSpecification) fields.push('分类核对前的规格', draft.previousSpecification);
              const status = pending && (order.items.some(item => item.itemId === pending.request.item.itemId)
                ? '原商品已保存在当前订单。'
                : '追加结果待确认。订单重新可编辑后可使用原请求确认。');
              return <DraftContent text={fields.join('\n')} status={status} writer={writer} onDiscard={remove} />;
            }}
          </EditDraftRecovery>}
        <button type="button" className="text-button" onClick={close}>收起草稿</button>
      </section>;
    })}
  </details>;
}
