import type { Account } from './types.ts';

export function hasPermissions(account: Pick<Account, 'access'> | undefined, ...permissions: string[]): boolean {
  return permissions.every(permission => account?.access?.permissions.includes(permission));
}
export function orderAccess(account: Pick<Account, 'access'> | undefined) {
  const customer = hasPermissions(account, 'ORDER_CUSTOMER_READ');
  const amounts = hasPermissions(account, 'ORDER_AMOUNT_READ');
  const business = hasPermissions(account, 'ORDER_BUSINESS_DETAILS_READ');
  return {
    customer, amounts, business,
    phone: customer || hasPermissions(account, 'ORDER_PHONE_READ'),
    delete: hasPermissions(account, 'ORDER_DELETE'),
    deleted: hasPermissions(account, 'ORDER_DELETED_READ'),
    productionView: hasPermissions(account, 'ORDER_READ') && !business,
    history: hasPermissions(account, 'ORDER_READ', 'ORDER_ACTIVITY_READ', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ'),
    export: hasPermissions(account, 'ORDER_EXPORT', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ'),
    management: hasPermissions(account, 'ORDER_MANAGEMENT_READ', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ'),
    entry: hasPermissions(account, 'ORDER_CREATE', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ'),
    submissions: hasPermissions(account, 'CUSTOMER_SUBMISSION_PROCESS', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ'),
  };
}
