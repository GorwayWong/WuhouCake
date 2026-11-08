import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VERSION_TEST_URL||'http://127.0.0.1:5196';let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:'chrome'});});after(async()=>{await browser?.close();});
test('生产版本更新提示不刷新未保存资料，取消后可安全刷新',async()=>{
 const {context,page,model,complete}=await createOrderFixture(browser,base);
 try{
  model.permissions.push('ORDER_BUSINESS_DETAILS_READ','ORDER_EDIT');await page.reload();await complete();
  await page.getByRole('button',{name:'创建订单',exact:true}).click();
  await page.waitForFunction(()=>location.hash!=='#/orders/new');
  await page.goto(base+'/#/orders/'+orderId);await page.getByRole('button',{name:'编辑资料',exact:true}).click();
  await page.locator('#edit-customerName').fill('尚未保存');
  await context.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:'<script type="module" src="/assets/updated-version.js"></script>'}));
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('系统已更新，保存后刷新。',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'刷新页面',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('#edit-customerName').inputValue(),'尚未保存');
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新页面'&&!b.disabled));
  const loaded=page.waitForEvent('load');await page.getByRole('button',{name:'刷新页面',exact:true}).click();await loaded;
  await page.getByRole('button',{name:'编辑资料',exact:true}).waitFor();
 }finally{await context.close();}
});
