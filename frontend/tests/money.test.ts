import test from 'node:test';
import assert from 'node:assert/strict';
import { exactYuan, hasUnsafeMoneyNumber } from '../src/money.ts';
import { moneyToCents } from '../src/orderForm.ts';
import { ApiError, publicApi } from '../src/api.ts';

test('整数分格式化及回填不会因浮点除法损失一分钱', () => {
  for (const [cents, yuan] of [[0, '0.00'], [1, '0.01'], [10, '0.10'], [29, '0.29'], [12345, '123.45'],
    [9007199254740971, '90071992547409.71'], [9007199254740990, '90071992547409.90'],
    [Number.MAX_SAFE_INTEGER, '90071992547409.91']] as const) {
    assert.equal(exactYuan(cents), yuan);
    assert.equal(moneyToCents(exactYuan(cents)), cents);
  }
});
test('汇总金额字符串超出 Long 或 JavaScript 整数范围仍精确，不接受已失真的数字', () => {
  assert.equal(exactYuan('9223372036854782596'), '92233720368547825.96');
  assert.equal(exactYuan('123456789012345678901234567890'), '1234567890123456789012345678.90');
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 0.1, NaN, Infinity]) assert.throws(() => exactYuan(value));
});
test('接口中的失真金额在进入详情与编辑草稿前被识别，字符串汇总保留', () => {
  const invalid = JSON.parse('{"submission":{"reviewed":{"prices":[{"unitPriceCents":9223372036854775807}]}}}');
  assert.equal(hasUnsafeMoneyNumber(invalid), true);
  assert.equal(hasUnsafeMoneyNumber({ totalAmountCents: 0.5 }), true);
  assert.equal(hasUnsafeMoneyNumber({ totalAmountCents: Number.MAX_SAFE_INTEGER, items: [{ memberPriceCents: null }], amountCents: '9223372036854782596' }), false);
  assert.equal(hasUnsafeMoneyNumber({ attributes: { amountCents: 0.5 }, quantity: 2 }), false);
});
test('接口读取拒绝不安全金额，并正常返回精确的字符串汇总', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"success":true,"data":{"totalAmountCents":9223372036854775807}}', { status: 200 }));
  await assert.rejects(publicApi('/money-test'), (error: unknown) => error instanceof ApiError && error.code === 'UNSAFE_MONEY_AMOUNT');
  fetchMock.mock.mockImplementation(async () => new Response('{"success":true,"data":{"amountCents":"9223372036854782596"}}', { status: 200 }));
  assert.deepEqual(await publicApi('/money-test'), { amountCents: '9223372036854782596' });
});
