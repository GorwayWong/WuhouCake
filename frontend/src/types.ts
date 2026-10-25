export interface Token { accessToken: string; tokenType: string; expiresIn: number; passwordChangeRequired: boolean }
export interface EmployeeAccess { permissions: string[]; uiCapabilities: string[] }
export interface Account { accountId: string; employeeNumber: string; nickname: string; jobRoles: string[]; systemRole?: string; access?: EmployeeAccess }
export interface PaymentGroup { orderCount: number; amountCents: string; missingAmountOrderCount: number }
export interface PaymentSummary { date: string; totalOrderCount: number; waitingDeliveryOrderCount: number; paid: PaymentGroup; unpaid: PaymentGroup; paidWithoutDateOrderCount: number }
export interface EmployeeOption { accountId: string; employeeNumber: string; nickname: string; status: string }
export interface EmployeeAccount extends Account { status: string; version: number; passwordChangeRequired: boolean; createdAt: string }
export interface Customer { customerName: string | null; phone: string; memberPhone: string | null; buyerName: string | null }
export interface Fulfillment { type: string; address: string | null; requestedReceiveDate: string; requestedReceiveAt?: string | null; plannedHandoffAt: string | null; plannedFinishAt: string | null }
export interface Note { id: number; itemId: string | null; actorNameSnapshot: string; createdAt: string; content: string }
export interface Activity extends Note { orderId: string; type: string; details: Record<string, unknown> }
export interface OrderImage {
  imageId: string; orderId: string; itemId: string | null; contentType: string; filename: string; size: number;
  width: number; height: number; uploadedBy: string; uploaderNameSnapshot: string; uploadedAt: string;
}
export interface ExportFilters { from: string; to: string; status?: string; fulfillmentType?: string; paymentStatus?: string }
export interface Item {
  itemId: string; name: string; quantity: number; productType: string | null;
  unitPriceCents: number | null; memberPriceCents: number | null; attributes: Record<string, unknown>;
  recentNotes: Note[];
  productionStatus?: string; currentStageCode?: string | null;
}
export interface OrderStatus { status: string; currentStageCode: string | null; paymentStatus: string | null; deletion?: unknown; deleted?: boolean }
export interface CalendarOrder extends OrderStatus {
  orderId: string; orderNo: string; calendarDate: string; fulfillmentType: string;
  plannedHandoffAt: string | null; customerPhoneLast4: string | null; items: Pick<Item, 'itemId' | 'name' | 'quantity'>[];
}
export interface PendingOrder extends Omit<CalendarOrder, 'customerPhoneLast4'> { customer: Customer | null; address: string | null; plannedFinishAt: string | null; items: Item[]; latestNote?: Note | null }
export interface Workbench { date: string; metrics: { totalOrders: number; createdOnDate: number; deliveryDueOnDate: number } | null; pendingOrders: PendingOrder[] }
export interface Detail extends OrderStatus {
  deletion?: { deletedAt: string; deletedBy: string; employeeName: string; reason: string; expiresAt: string } | null;
  createdBy?: string | null; creditedEmployee?: { accountId: string; employeeNumber: string; nickname: string } | null;
  orderId: string; orderNo: string; version: number; customer: Customer | null; fulfillment: Fulfillment;
  totalAmountCents: number | null; paidAt?: string | null; createdAt: string | null; updatedAt: string; items: Item[];
}
export interface CreateOrderRequest {
  creditedEmployeeId?: string;
  customer: Customer;
  fulfillment: Omit<Fulfillment, 'type'> & { type: 'DELIVERY' | 'PICKUP' };
  items: Pick<Item, 'name' | 'productType' | 'quantity' | 'unitPriceCents' | 'memberPriceCents' | 'attributes'>[];
  totalAmountCents: number | null;
}
export type InformationChanges = Partial<Customer & Omit<Fulfillment, 'type'> & {
  fulfillmentType: 'DELIVERY' | 'PICKUP'; totalAmountCents: number | null; creditedEmployeeId: string;
}>;
export interface InformationRequest { expectedVersion: number; changes: InformationChanges }
export type ItemInput = CreateOrderRequest['items'][number];
export interface ItemChangeRequest { expectedVersion: number; itemId: string; changes: Partial<ItemInput> }
export interface ItemAddRequest { expectedVersion: number; item: ItemInput }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
export interface RecognitionField {
  value: string | null; source: 'RULE' | 'MODEL' | 'DEFAULT' | null;
  evidence: string[]; needsReview: boolean; issues: string[];
}
export interface RecognitionItem { id: string; fields: Record<string, RecognitionField> }
export interface RecognitionDraft {
  fields: Record<string, RecognitionField>; items: RecognitionItem[]; issues: string[];
  fragments: { itemId: string | null; text: string }[]; unmappedText: string[]; assistAvailable: boolean;
}
export interface RecognitionAssist {
  status: string; suggestions: { itemId: string; field: string; candidate: RecognitionField }[]; issues: string[];
}
