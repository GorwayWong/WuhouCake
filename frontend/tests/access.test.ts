import test from 'node:test';
import assert from 'node:assert/strict';
import { orderAccess } from '../src/access.ts';

test('客户填单入口按服务端能力显示，六岗位和自定义权限不依赖旧岗位名', () => {
  const front = { access: { permissions: ['CUSTOMER_SUBMISSION_PROCESS', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_DELETE', 'ORDER_DELETED_READ'], uiCapabilities: [] } };
  assert.equal(orderAccess(front).submissions, true);
  assert.equal(orderAccess(front).delete, true);
  assert.equal(orderAccess(front).deleted, true);
  const production = { access: { permissions: ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'], uiCapabilities: [] } };
  assert.equal(orderAccess(production).phone, true);
  assert.equal(orderAccess(production).customer, false);
  assert.equal(orderAccess(production).submissions, false);
  assert.equal(orderAccess(production).delete, false);
});
