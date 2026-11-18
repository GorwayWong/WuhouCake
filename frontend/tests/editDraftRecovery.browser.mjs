import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const detailUrl = `${base}/#/orders/${orderId}`;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });

async function fixture() {
  const result = await createOrderFixture(browser, base);
  const { page, model } = result;
  model.order = {
    orderId, orderNo: 'EDIT-RECOVERY', version: 0, status: 'CAKE_BASE', currentStageCode: null,
    paymentStatus: 'UNPAID', pricingMode: 'MANUAL', totalAmountCents: 1000, createdAt: '2026-11-04T08:00:00Z',
    customer: { customerName: '合成用户', phone: '13800000000', memberPhone: null, buyerName: null },
    fulfillment: { type: 'PICKUP', address: null, requestedReceiveDate: '2026-11-04', requestedReceiveAt: null, plannedFinishAt: null, plannedHandoffAt: null },
    items: [{ itemId: '10000000-0000-4000-8000-000000000002', productType: 'OTHER', name: '已有商品', quantity: 1,
      memberPriceCents: null, unitPriceCents: null, attributes: {}, recentNotes: [], productionStatus: 'NOT_STARTED' }],
  };
  await page.goto(detailUrl);
  await page.getByRole('button', { name: '编辑资料' }).waitFor();
  return result;
}

test('商品追加提交后断线，刷新恢复并用相同键及请求体确认', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    const attempts = [];
    await context.route(`**/api/orders/${orderId}/items`, async route => {
      const request = route.request();
      const key = request.headers()['idempotency-key'];
      const body = request.postDataJSON();
      attempts.push({ key, body });
      assert.ok(key);
      assert.ok(body.item.itemId);
      if (attempts.length === 1) {
        model.order = { ...model.order, version: 1, items: [...model.order.items, { ...body.item, recentNotes: [] }] };
        return route.abort('failed');
      }
      return route.fulfill({ status: 201, json: { success: true, data: model.order } });
    });
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('#item-name').fill('待确认商品');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '确认追加结果' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await page.locator('#item-name').inputValue(), '待确认商品');
    await page.getByRole('button', { name: '确认追加结果' }).click();
    await page.getByText(/商品已添加/).waitFor();
    assert.deepEqual(attempts, [attempts[0], attempts[0]]);
    assert.equal(model.order.items.filter(item => item.name === '待确认商品').length, 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('刷新后客户资料仍以旧快照计算差异，复核后不覆盖同事改动', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    let patch;
    await context.route(`**/api/orders/${orderId}/information`, async route => {
      patch = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: { ...model.order, version: 2 } } });
    });
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('本机草稿');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.order = { ...model.order, version: 1, customer: { ...model.order.customer, phone: '13900000000' } };
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await page.locator('#edit-customerName').inputValue(), '本机草稿');
    assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '核对后继续编辑' }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByText('订单资料已保存').waitFor();
    assert.deepEqual(patch, { expectedVersion: 1, changes: { customerName: '本机草稿' } });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('两个标签页并发编辑时，旧标签页不能覆盖本机草稿', async () => {
  const { context, page } = await fixture();
  try {
    const other = await context.newPage();
    await other.goto(detailUrl);
    for (const tab of [page, other]) {
      await tab.getByRole('button', { name: '编辑资料' }).click();
      await tab.locator('#edit-customerName').waitFor();
    }
    await page.locator('#edit-customerName').fill('第一个标签页');
    await page.getByText('草稿已保存在本机。').waitFor();
    await other.locator('#edit-customerName').fill('第二个标签页');
    await other.getByText(/另一个标签页已更新草稿/).waitFor();
    assert.equal(await other.locator('#edit-customerName').inputValue(), '第二个标签页');
    await other.reload();
    await other.getByRole('button', { name: '编辑资料' }).click();
    await other.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await other.locator('#edit-customerName').inputValue(), '第一个标签页');
  } finally { await context.close(); }
});

test('本机草稿按账号隔离，存储不可用时明确提示并保留当前输入', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('账号 A 的草稿');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.account = 'bob';
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).click();
    assert.equal(await page.locator('#edit-customerName').inputValue(), '合成用户');
    await context.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        if (name === 'wuhou-order-edits') throw new DOMException('synthetic storage denial', 'QuotaExceededError');
        return open(name, version);
      };
    });
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('此时输入仍在页面');
    await page.getByText('无法读写本机草稿，请保留当前页面。').waitFor();
    assert.equal(await page.locator('#edit-customerName').inputValue(), '此时输入仍在页面');
  } finally { await context.close(); }
});

test('整单金额草稿刷新后按原分值恢复并保存', async () => {
  const { context, page, model } = await fixture();
  try {
    model.order = { ...model.order, originalAmountCents: 1000, memberAmountCents: null };
    await page.reload();
    let patch;
    await context.route(`**/api/orders/${orderId}/information`, async route => {
      patch = route.request().postDataJSON();
      model.order = { ...model.order, version: 1, totalAmountCents: patch.changes.originalAmountCents, originalAmountCents: patch.changes.originalAmountCents };
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.getByRole('button', { name: '修改金额' }).click();
    await page.locator('#edit-totalAmount').fill('12.34');
    await page.getByText('草稿已保存在本机。').waitFor();
    await page.reload();
    await page.getByRole('button', { name: '修改金额' }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await page.locator('#edit-totalAmount').inputValue(), '12.34');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByText('金额已保存').waitFor();
    assert.deepEqual(patch, { expectedVersion: 0, changes: { originalAmountCents: 1234 } });
  } finally { await context.close(); }
});

test('较早的本机事务完成时仍等待最新草稿事务', async () => {
  const { context, page } = await fixture();
  try {
    await page.getByRole('button', { name: '编辑资料' }).click();
    const name = page.locator('#edit-customerName');
    await name.waitFor();
    await page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      let opening = 0;
      window.heldDraftOpens = [];
      indexedDB.open = (name, version) => {
        const request = open(name, version);
        if (name === 'wuhou-order-edits' && opening++ < 2) {
          Object.defineProperty(request, 'onsuccess', {
            set(handler) {
              request.addEventListener('success', event => {
                window.heldDraftOpens.push(() => handler.call(request, event));
              }, { once: true });
            },
          });
        }
        return request;
      };
    });
    await name.fill('较早输入');
    await page.waitForFunction(() => window.heldDraftOpens.length === 1);
    await name.fill('最新输入');
    await page.evaluate(() => window.heldDraftOpens[0]());
    await page.waitForFunction(() => window.heldDraftOpens.length === 2);
    assert.equal(await page.getByText('草稿已保存在本机。').count(), 0);
    await page.getByText('正在保存本机草稿…').waitFor();
    await page.evaluate(() => window.heldDraftOpens[1]());
    await page.getByText('草稿已保存在本机。').waitFor();
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await name.inputValue(), '最新输入');
  } finally { await context.close(); }
});

test('同事登记付款后可查看金额草稿，放弃时只删除该份草稿', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.getByRole('button', { name: '修改金额' }).click();
    await page.locator('#edit-totalAmount').fill('17.32');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.order = { ...model.order, version: 1, paymentStatus: 'PAID' };
    await page.reload();
    await page.getByText('查看本机草稿', { exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '修改金额' }).count(), 0);
    await page.getByRole('button', { name: '金额草稿' }).click();
    const content = page.getByRole('textbox', { name: '草稿内容' });
    assert.match(await content.inputValue(), /17\.32/);
    assert.equal(await content.evaluate(element => element.readOnly), true);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '放弃草稿' }).click();
    await page.getByText('查看本机草稿', { exact: true }).waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).waitFor();
    assert.equal(await page.getByText('查看本机草稿', { exact: true }).count(), 0);
  } finally { await context.close(); }
});

test('商品被移除后还能查看对应草稿，不写入其他商品', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.locator('.order-products').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-name').fill('被移除商品的改动');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.order = { ...model.order, version: 1,
      items: [{ ...model.order.items[0], itemId: '10000000-0000-4000-8000-000000000003', name: '仍在订单中的商品' }] };
    await page.reload();
    await page.getByText('查看本机草稿', { exact: true }).click();
    await page.getByRole('button', { name: '商品编辑草稿' }).click();
    assert.match(await page.getByRole('textbox', { name: '草稿内容' }).inputValue(), /被移除商品的改动/);
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
    assert.equal(model.order.items[0].name, '仍在订单中的商品');
  } finally { await context.close(); }
});

for (const committed of [true, false]) {
  test(`订单完成后的待确认追加只能查看，商品${committed ? '存在' : '未找到'}`, async () => {
    const { context, page, model } = await fixture();
    try {
      const attempts = [];
      await context.route(`**/api/orders/${orderId}/items`, async route => {
        const request = route.request();
        const body = request.postDataJSON();
        attempts.push({ body, key: request.headers()['idempotency-key'] });
        if (attempts.length === 1) {
          model.order = { ...model.order, status: 'COMPLETED', version: 1,
            items: committed ? [...model.order.items, { ...body.item, recentNotes: [] }] : model.order.items };
          return route.abort('failed');
        }
        if (!committed && attempts.length === 2) {
          assert.equal(body.expectedVersion, 0);
          return route.fulfill({ status: 409, json: { success: false, code: 'CONCURRENT_MODIFICATION' } });
        }
        if (!committed) model.order = { ...model.order, version: 3, items: [...model.order.items, { ...body.item, recentNotes: [] }] };
        return route.fulfill({ status: 201, json: { success: true, data: model.order } });
      });
      await page.getByRole('button', { name: '添加商品', exact: true }).click();
      await page.locator('#item-name').fill('断线时的蜡烛');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      const confirm = page.getByRole('button', { name: '确认追加结果' });
      await page.waitForFunction(() => document.querySelector('.item-form button.primary')?.matches(':disabled') &&
        document.querySelector('.item-form button.primary').textContent === '确认追加结果');
      const result = committed ? '原商品已保存在当前订单。' : '追加结果待确认。订单重新可编辑后可使用原请求确认。';
      await page.getByText(result, { exact: true }).waitFor();
      assert.equal(await confirm.isDisabled(), true);
      await page.reload();
      await page.getByText('查看本机草稿', { exact: true }).click();
      await page.getByRole('button', { name: '追加商品草稿' }).click();
      await page.getByText(result, { exact: true }).waitFor();
      assert.match(await page.getByRole('textbox', { name: '草稿内容' }).inputValue(), /断线时的蜡烛/);
      assert.equal(await confirm.count(), 0);
      assert.equal(attempts.length, 1);
      model.order = { ...model.order, status: 'CAKE_BASE', version: 2 };
      await page.reload();
      await page.getByRole('button', { name: '添加商品', exact: true }).click();
      await page.getByRole('button', { name: '恢复草稿' }).click();
      await confirm.click();
      if (!committed) {
        await page.getByRole('button', { name: '核对后继续编辑' }).click();
        await page.getByRole('button', { name: '保存', exact: true }).click();
      }
      await page.getByText(/商品已添加/).waitFor();
      assert.equal(attempts.length, committed ? 2 : 3);
      assert.deepEqual(attempts[1], attempts[0]);
      if (!committed) {
        assert.equal(attempts[2].body.expectedVersion, 2);
        assert.deepEqual(attempts[2].body.item, attempts[0].body.item);
      }
    } finally { await context.close(); }
  });
}

test('店长恢复订单后断线，读取原单确认恢复结果', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    model.permissions.push('ORDER_DELETE', 'ORDER_DELETED_READ');
    model.order = { ...model.order, version: 1, status: 'WAITING_DELIVERY',
      deletion: { deletedAt: '2024-11-01T00:00:00Z', deletedBy: 'store-manager', employeeName: '店长', reason: '误删', expiresAt: null } };
    await page.reload();
    let attempts = 0;
    await context.route(`**/api/orders/${orderId}/restore`, async route => {
      attempts++;
      assert.deepEqual(route.request().postDataJSON(), { expectedVersion: 1 });
      model.order = { ...model.order, version: 2, deletion: null };
      await route.abort('failed');
    });
    page.once('dialog', dialog => {
      assert.match(dialog.message(), /EDIT-RECOVERY.*待自提.*未付款/);
      return dialog.accept();
    });
    await page.getByRole('button', { name: '恢复订单', exact: true }).click();
    await page.locator('.feedback .notice.success').filter({ hasText: '订单已恢复。' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '恢复订单', exact: true }).count(), 0);
    assert.equal(attempts, 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('已删除订单刷新后仍能复制资料草稿，失去读取权限后不展示', async () => {
  const { context, page, model } = await fixture();
  try {
    model.permissions.push('ORDER_DELETED_READ');
    await page.reload();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('删除前仍在编辑');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.order = { ...model.order, version: 1, deletion: {
      deletedAt: '2026-11-17T01:00:00Z', deletedBy: 'manager', employeeName: '店长', reason: '合成删除', expiresAt: null,
    } };
    await page.reload();
    await page.getByText('查看本机草稿', { exact: true }).click();
    await page.getByRole('button', { name: '订单资料草稿', exact: true }).click();
    await page.getByRole('textbox', { name: '草稿内容' }).waitFor();
    assert.match(await page.getByRole('textbox', { name: '草稿内容' }).inputValue(), /删除前仍在编辑/);
    assert.equal(await page.getByRole('button', { name: '编辑资料' }).isDisabled(), true);
    await context.route(`**/api/orders/${orderId}`, route => route.fulfill({
      status: 403, json: { success: false, code: 'ORDER_DELETED_FORBIDDEN' },
    }));
    await page.reload();
    await page.getByText(/当前岗位|权限/).first().waitFor();
    assert.equal(await page.getByText('查看本机草稿', { exact: true }).count(), 0);
  } finally { await context.close(); }
});

test('本机暂存不可用时可继续追加，断线用同键确认', async () => {
  const { context, page, model } = await fixture();
  try {
    await context.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => {
        if (name === 'wuhou-order-edits') throw new DOMException('synthetic storage denial', 'QuotaExceededError');
        return open(name, version);
      };
    });
    const attempts = [];
    await context.route(`**/api/orders/${orderId}/items`, route => {
      const request = route.request(), body = request.postDataJSON();
      attempts.push({ key: request.headers()['idempotency-key'], body });
      if (attempts.length === 1) {
        model.order = { ...model.order, version: 1, items: [...model.order.items, { ...body.item, recentNotes: [] }] };
        return route.abort();
      }
      return route.fulfill({ status: 201, json: { success: true, data: model.order } });
    });
    await page.reload();
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('#item-name').fill('本页追加');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '确认追加结果' }).click();
    await page.getByText(/商品已添加/).waitFor();
    assert.deepEqual(attempts, [attempts[0], attempts[0]]);
    assert.equal(model.order.items.filter(item => item.name === '本页追加').length, 1);
  } finally { await context.close(); }
});

test('同事改成其他商品后，旧尺寸留作参考，独立名称修改仍可保存', async () => {
  const { context, page, model } = await fixture();
  try {
    const item = { ...model.order.items[0], productType: 'CAKE', attributes: { size: '6' } };
    model.order = { ...model.order, items: [item] };
    await page.reload();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-name').fill('本地改名');
    await page.locator('#item-size').fill('8');
    await page.getByText('草稿已保存在本机。').waitFor();
    model.order = { ...model.order, version: 1, items: [{ ...item, productType: 'OTHER', attributes: { specification: '尺寸：6' } }] };
    let patch;
    await context.route(`**/api/orders/${orderId}`, route => {
      if (route.request().method() === 'PATCH') {
        patch = route.request().postDataJSON();
        model.order = { ...model.order, version: 2, items: [{ ...model.order.items[0], ...patch.changes }] };
      }
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.reload();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    const save = page.getByRole('button', { name: '保存', exact: true });
    assert.equal(await save.isDisabled(), true);
    await page.getByRole('button', { name: '按最新分类继续', exact: true }).click();
    assert.match(await page.getByRole('textbox', { name: '分类核对前的规格' }).inputValue(), /尺寸：8/);
    assert.equal(await page.locator('#item-specification').inputValue(), '尺寸：6');
    await save.click();
    await page.getByText(/商品已保存/).waitFor();
    assert.deepEqual(patch, { expectedVersion: 1, itemId: item.itemId, changes: { name: '本地改名' } });
    assert.deepEqual(model.order.items[0].attributes, { specification: '尺寸：6' });
  } finally { await context.close(); }
});

test('关闭被远端删除锁定的编辑器保留暂存图片，恢复原单后可继续', async () => {
  const { context, page, model, select } = await fixture();
  try {
    model.permissions.push('ORDER_DELETE', 'ORDER_DELETED_READ');
    await page.reload();
    await page.clock.install();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('保留带图草稿');
    await page.getByText('草稿已保存在本机。').waitFor();
    await select(['locked.png']);
    await page.getByText('待保存：保存修改后上传').waitFor();
    model.order = { ...model.order, version: 1, deletion: {
      deletedAt: '2026-11-17T01:00:00Z', deletedBy: 'manager', employeeName: '店长', reason: '合成删除', expiresAt: null,
    } };
    await page.clock.fastForward(30_010);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '关闭编辑草稿', exact: true }).click();
    const staged = await page.evaluate(async ({ accountId, id }) =>
      (await import('/src/draftImages.ts')).editImageQueue(accountId, id), { accountId: model.account, id: orderId });
    assert.equal(staged.length, 1);
    await context.route(`**/api/orders/${orderId}/restore`, route => {
      model.order = { ...model.order, version: 2, deletion: null };
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '恢复订单', exact: true }).click();
    await page.getByRole('button', { name: '继续编辑并恢复图片' }).click();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    assert.equal(await page.locator('#edit-customerName').inputValue(), '保留带图草稿');
    assert.equal(model.uploads.length, 0);
  } finally { await context.close(); }
});

test('同页后台刷新被拒时隐藏已缓存的订单资料和编辑器', async () => {
  const { context, page } = await fixture();
  try {
    await page.getByRole('heading', { name: '订单 #EDIT-RECOVERY' }).waitFor();
    await page.getByRole('button', { name: '编辑资料' }).click();
    await page.locator('#edit-customerName').fill('仅本机保存');
    await page.getByText('草稿已保存在本机。').waitFor();
    await context.route(`**/api/orders/${orderId}`, route => route.fulfill({
      status: 403, json: { success: false, code: 'ORDER_DELETED_FORBIDDEN' },
    }));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByText(/当前岗位|权限/).first().waitFor();
    assert.equal(await page.getByRole('heading', { name: '订单 #EDIT-RECOVERY' }).count(), 0);
    assert.equal(await page.locator('#edit-customerName').count(), 0);
    assert.equal(await page.getByText('合成用户', { exact: true }).count(), 0);
  } finally { await context.close(); }
});
