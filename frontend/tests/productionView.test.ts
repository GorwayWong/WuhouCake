import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermissions, orderAccess } from '../src/access.ts';
import { productionFields } from '../src/productionFields.ts';

test('制作视图依有效能力，兼岗恢复信息，不按岗位名称猜测授权', () => {
  const chef = { access: { permissions: ['ORDER_READ', 'ORDER_PRODUCTION_UPDATE', 'ORDER_NOTE_CREATE'], uiCapabilities: [] } };
  assert.equal(orderAccess(chef).productionView, true);
  assert.equal(orderAccess(chef).amounts, false); assert.equal(orderAccess(chef).customer, false);
  assert.equal(orderAccess(chef).history, false); assert.equal(orderAccess(chef).export, false);
  assert.equal(hasPermissions(chef, 'ORDER_PRODUCTION_UPDATE'), true);
  const dual = { access: { permissions: [...chef.access.permissions, 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ'], uiCapabilities: [] } };
  assert.equal(orderAccess(dual).productionView, false); assert.equal(orderAccess(dual).amounts, true);
  assert.equal(hasPermissions(undefined, 'ORDER_READ'), false);
});

test('制作参数逐行稳定排列，奶油不误用为蛋糕胚口味，缺失备注显示无', () => {
  const fields = productionFields({ attributes: { cakeBase: '抹茶', size: '8', flavor: '动物奶油', filling: '芒果', requirements: '', price: 100, phone: '13900000000' } });
  assert.deepEqual(fields, [['蛋糕胚口味', '抹茶'], ['尺寸', '8'], ['奶油', '动物奶油'], ['夹心', '芒果'], ['祝福语', '无'], ['特殊要求', '无']]);
  assert.equal(fields.some(([name]) => name === 'price' || name === 'phone'), false);
});
