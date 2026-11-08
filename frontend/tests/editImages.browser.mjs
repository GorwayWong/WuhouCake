import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({headless:true,channel:'chrome'}); });
after(async () => { await browser?.close(); });
async function until(fn) { for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('timeout'); }
async function fixture() {
 const f=await createOrderFixture(browser,base);
 f.model.permissions.push('ORDER_BUSINESS_DETAILS_READ','ORDER_EDIT'); await f.page.reload();
 await f.complete(); await f.page.getByRole('button',{name:'创建订单',exact:true}).click();
 await until(()=>Boolean(f.model.order));await f.page.goto(base+'/#/orders/'+orderId);
 await f.page.getByRole('button',{name:'编辑资料',exact:true}).waitFor();return f;
}
test('选图暂存，取消不上传；资料失败保留，成功后部分图片失败仅重试图片',async()=>{
 const {context,page,model,select,errors}=await fixture();let calls=0,fail=true;
 try {
  await context.route(`**/api/orders/${orderId}/information`,r=>{
   calls++;if(fail)return r.fulfill({status:503,json:{success:false,code:'SERVICE_UNAVAILABLE'}});
   const input=r.request().postDataJSON();model.order.customer.customerName=input.changes.customerName;model.order.version++;
   return r.fulfill({json:{success:true,data:model.order}});
  });
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();await select(['cancel.png']);
  await page.getByText('待保存：保存修改后上传',{exact:true}).waitFor();assert.equal(model.uploads.length,0);
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  await until(async()=>await page.locator('.information-form').count()===0);assert.equal(model.uploads.length,0);
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();await page.locator('#edit-customerName').fill('更正客户');
  await select(['good.png','retry.png']);await until(async()=>await page.getByText('待保存：保存修改后上传',{exact:true}).count()===2);
  if(process.env.EDIT_SCREENSHOT_DIR){await page.locator('#order-reference-images').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.EDIT_SCREENSHOT_DIR+'/edit-images-staged.png'});}
  await page.locator('.information-form').getByRole('button',{name:'保存修改',exact:true}).click();await until(()=>calls===1);
  assert.equal(model.uploads.length,0);assert.equal(await page.locator('#edit-customerName').inputValue(),'更正客户');
  fail=false;model.failNames.add('retry.png');
  await page.locator('.information-form').getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('资料已保存，仍有图片上传未完成，请重试失败图片。',{exact:true}).waitFor();assert.equal(model.images.length,1);
  model.failNames.clear();await page.getByRole('button',{name:'重试上传',exact:true}).click();await until(()=>model.images.length===2);
  assert.equal(calls,2);assert.equal(model.uploads.filter(r=>r.name==='good.png').length,1);assert.equal(model.order.customer.customerName,'更正客户');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('仅加图可以保存，重载暂存不自动上传且可取消恢复',async()=>{
 const {context,page,model,select,errors}=await fixture();
 try{
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();await select(['recover.png']);
  await page.getByText('待保存：保存修改后上传',{exact:true}).waitFor();await page.reload();
  await page.getByRole('button',{name:'继续编辑并恢复图片',exact:true}).click();assert.equal(model.uploads.length,0);
  await page.locator('.information-form').getByRole('button',{name:'保存修改',exact:true}).click();await until(()=>model.images.length===1);
  assert.equal(model.order.version,0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('未知状态仍显示两张订单卡片，详情只读',async()=>{
 const {context,page,model}=await fixture();
 try{
  model.order.status='FUTURE_STAGE';const date=model.order.fulfillment.requestedReceiveDate;
  const rows=[{...model.order,calendarDate:date,plannedHandoffAt:null,plannedFinishAt:null,fulfillmentType:'PICKUP'}, {...model.order,orderId:'30000000-0000-4000-8000-000000000003',calendarDate:date,plannedHandoffAt:null,plannedFinishAt:null,fulfillmentType:'PICKUP'}];
  await context.route('**/api/orders/workbench?**',r=>r.fulfill({json:{success:true,data:{pendingOrders:rows,metrics:null}}}));
  await context.route('**/api/orders/calendar?**',r=>r.fulfill({json:{success:true,data:rows}}));
  await page.goto(base+'/#/?date='+date);await page.locator('.order-summary-card').first().waitFor();assert.equal(await page.locator('.order-summary-card').count(),2);
  await page.locator('.order-summary-card').first().click();await page.reload();await page.getByText('页面暂不识别此订单状态',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'编辑资料',exact:true}).isDisabled(),true);
 }finally{await context.close();}
});

test('取消清理失败保留暂存与编辑，重试取消才清理完成',async()=>{
 const {context,page,model,select}=await fixture();
 try{
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();await select(['cancel-failure.png']);
  await page.getByText('待保存：保存修改后上传',{exact:true}).waitFor();
  await page.evaluate(()=>{window.originalImageTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new DOMException('denied','SecurityError');return window.originalImageTransaction.call(this,stores,mode,...rest);};});
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('#order-reference-images').getByText('暂存图片未能清理，编辑内容已保留，请重试取消。',{exact:true}).waitFor();
  assert.equal(await page.locator('.information-form').count(),1);assert.equal(model.uploads.length,0);
  await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.originalImageTransaction;});
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();await until(async()=>await page.locator('.information-form').count()===0);
  assert.equal(await page.getByText('待保存：保存修改后上传',{exact:true}).count(),0);
 }finally{await context.close();}
});
