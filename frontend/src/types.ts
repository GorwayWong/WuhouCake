export interface Token { accessToken: string; tokenType: string; expiresIn: number; passwordChangeRequired: boolean }
export interface Account { accountId: string; employeeNumber: string; nickname: string; jobRoles: string[] }
export interface Customer { customerName: string | null; phone: string; memberPhone: string | null; buyerName: string | null }
export interface Fulfillment { type: string; address: string | null; requestedReceiveDate: string; plannedHandoffAt: string; plannedFinishAt: string | null }
export interface Note { id: number; itemId: string | null; actorNameSnapshot: string; createdAt: string; content: string }
export interface Activity extends Note { orderId: string; type: string; details: Record<string, unknown> }
export interface Item {
  itemId: string; name: string; quantity: number; productType: string | null;
  unitPriceCents: number | null; memberPriceCents: number | null; attributes: Record<string, unknown>;
  recentNotes: Note[];
  productionStatus?: string; currentStageCode?: string | null;
}
export interface OrderStatus { status: string; currentStageCode: string | null; paymentStatus: string }
export interface CalendarOrder extends OrderStatus {
  orderId: string; orderNo: string; calendarDate: string; fulfillmentType: string;
  plannedHandoffAt: string; items: Pick<Item, 'itemId' | 'name' | 'quantity'>[];
}
export interface PendingOrder extends CalendarOrder { customer: Customer; address: string | null; plannedFinishAt: string | null; items: Item[] }
export interface Workbench { date: string; metrics: { totalOrders: number; createdOnDate: number; deliveryDueOnDate: number }; pendingOrders: PendingOrder[] }
export interface Detail extends OrderStatus {
  orderId: string; orderNo: string; version: number; customer: Customer; fulfillment: Fulfillment;
  totalAmountCents: number | null; createdAt: string; updatedAt: string; items: Item[];
}
export interface CreateOrderRequest {
  customer: Customer;
  fulfillment: Omit<Fulfillment, 'type'> & { type: 'DELIVERY' | 'PICKUP' };
  items: Pick<Item, 'name' | 'productType' | 'quantity' | 'unitPriceCents' | 'memberPriceCents' | 'attributes'>[];
  totalAmountCents: number | null;
}
export type InformationChanges = Partial<Customer & Omit<Fulfillment, 'type'> & {
  fulfillmentType: 'DELIVERY' | 'PICKUP'; totalAmountCents: number | null;
}>;
export interface InformationRequest { expectedVersion: number; changes: InformationChanges }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
