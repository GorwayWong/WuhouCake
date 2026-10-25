import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermissions, orderAccess } from '../src/access.ts';
import { historicalProductionFields, productionFields } from '../src/productionFields.ts';

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

test('非蛋糕制作简表保留历史规格入口，排除价格和客户资料', () => {
  const item = { productType: 'TEA_BREAK', attributes: { specification: '六只装', flavor: '动物奶油', filling: '香草', requirements: '分装', price: 100, phone: '13900000000' } };
  assert.deepEqual(productionFields(item), [['规格', '六只装'], ['特殊要求', '分装']]);
  assert.deepEqual(historicalProductionFields(item), [['奶油', '动物奶油'], ['夹馅', '香草']]);
});

test('制作参数逐行稳定排列，奶油不误用为蛋糕胚口味，缺失备注显示无', () => {
  const fields = productionFields({ attributes: { cakeBase: '抹茶', size: '8', flavor: '动物奶油', filling: '芒果', requirements: '', price: 100, phone: '13900000000' } });
  assert.deepEqual(fields, [['蛋糕胚口味', '抹茶'], ['尺寸', '8'], ['奶油', '动物奶油'], ['夹心', '芒果'], ['祝福语', '无'], ['特殊要求', '无']]);
  assert.equal(fields.some(([name]) => name === 'price' || name === 'phone'), false);
});
