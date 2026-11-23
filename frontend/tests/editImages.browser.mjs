import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { calendarDays, createOrderFixture, orderId, workbenchCards } from './orderBrowserFixture.mjs';
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
 await f.page.getByRole('link', { name: '新建订单', exact: true }).waitFor();
 await f.page.goto(base+'/#/orders/'+orderId);
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
  await context.route('**/api/orders/workbench/cards?**',r=>r.fulfill({json:{success:true,data:workbenchCards(r.request(), rows)}}));
  await context.route('**/api/orders/calendar/days?**',r=>r.fulfill({json:{success:true,data:calendarDays(rows)}}));
  await page.goto(base+'/#/?date='+date);await page.reload();
  await page.locator('.order-summary-card').first().waitFor();assert.equal(await page.locator('.order-summary-card').count(),2);
  await page.locator(`.order-summary-card[data-order-id="${orderId}"]`).click();
  await page.getByText('页面暂不识别此订单状态',{exact:false}).waitFor();
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

test('普通编辑取消不依赖图片存储', async () => {
 const {context,page}=await fixture();
 try {
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();
  await page.locator('#edit-customerName').fill('普通编辑');
  await page.evaluate(()=>{ IDBDatabase.prototype.transaction=function(){throw new DOMException('denied','SecurityError');}; });
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  await until(async()=>await page.locator('.information-form').count()===0);
 } finally {await context.close();}
});
test('双标签页及复制标签页不能访问原会话图片，刷新保留清单并发现缺文件', async () => {
 const {context,page,select,model}=await fixture();
 try {
  await page.getByRole('button',{name:'编辑资料',exact:true}).click(); await select(['private.png']);
  await page.getByText('待保存：保存修改后上传',{exact:true}).waitFor();
  const copy = await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
  const other=await context.newPage();
  await other.goto(base+'/#/orders/'+orderId);
  await other.evaluate(copy=>{for(const [k,v] of Object.entries(copy))sessionStorage.setItem(k,v);},copy);
  await other.reload();await other.getByRole('button',{name:'编辑资料',exact:true}).click();
  assert.equal(await other.getByText('private.png',{exact:true}).count(),0);
  await other.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  const rows=await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wuhou-order-images',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   return new Promise(resolve=>{const tx=db.transaction('files','readwrite'); const req=tx.objectStore('files').getAll();req.onsuccess=()=>{for(const row of req.result)tx.objectStore('files').delete(row.key);};tx.oncomplete=()=>resolve(req.result.map(r=>({size:r.file.size,name:r.name})));});
  });
  assert.equal(rows[0].size>0,true);
  await page.reload();await page.getByRole('button',{name:'继续编辑并恢复图片',exact:true}).click();
  await page.locator('.information-form').getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('暂存图片缺失，请重新选择或移除缺失图片后保存。',{exact:false}).waitFor();
  assert.equal(model.uploads.length,0);
  await page.getByRole('button',{name:'移除暂存图片',exact:true}).click();
  await page.locator('.information-form').getByRole('button',{name:'取消',exact:true}).click();
  await until(async()=>await page.locator('.information-form').count()===0);
 } finally {await context.close();}
});

for (const failure of ['503', 'network']) test(`退出${failure}保留草稿图片及真实文件`, async () => {
 const {context, page, select} = await createOrderFixture(browser, base);
 try {
  await select(['logout.png']);
  await context.route('**/api/auth/logout', route => failure === 'network' ? route.abort('failed')
    : route.fulfill({status: 503, json: {success: false, code: 'SERVICE_UNAVAILABLE'}}));
  await page.getByRole('button', {name: '退出登录', exact: true}).click();
  await page.getByRole('button', {name: '保存草稿并退出', exact: true}).click();
  await page.getByRole('button', {name: '退出登录', exact: true}).waitFor();
  await page.getByText('logout.png', {exact: true}).waitFor();
  const images = await page.evaluate(async () => {
   const { readCreationDraft } = await import('/src/creationDraftStorage.ts');
   const { images } = (await readCreationDraft('order:alice')).value;
   return images.map(({name, file}) => ({name, size: file.size}));
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'logout.png');
  assert.ok(images[0].size > 0);
 } finally { await context.close(); }
});

test('资料保存后转队列事务失败，保留图片并仅重试图片', async () => {
 const {context,page,model,select}=await fixture();let calls=0;
 try {
  await context.route(`**/api/orders/${orderId}/information`, async r=>{
   calls++;model.order.customer.customerName=r.request().postDataJSON().changes.customerName;model.order.version++;
   await page.evaluate(()=>{window.originalImageTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new DOMException('denied','SecurityError');return window.originalImageTransaction.call(this,stores,mode,...rest);};});
   return r.fulfill({json:{success:true,data:model.order}});
  });
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();
  await page.locator('#edit-customerName').fill('已保存资料');await select(['partial.png']);
  await page.getByText('待保存：保存修改后上传',{exact:true}).waitFor();
  await page.locator('.information-form').getByRole('button',{name:'保存修改',exact:true}).click();
  await page.locator('.feedback').getByText('资料已保存，部分图片未上传。请在图片区重试。').waitFor();
  assert.equal(model.uploads.length,0);
  await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.originalImageTransaction;});
  await page.getByRole('button',{name:'继续上传图片',exact:true}).click();
  await until(()=>model.images.length===1);assert.equal(calls,1);assert.equal(model.uploads.length,1);
 } finally {await context.close();}
});
test('退出成功但图片清理失败，登录页提示且文件仍保留', async () => {
 const {context, page, select, complete, saved} = await createOrderFixture(browser, base);
 try {
  await select(['cleanup.png']);
  await complete();
  await context.route('**/api/orders', route => route.fulfill({status: 400, json: {success: false, code: 'VALIDATION_FAILED'}}));
  await page.getByRole('button', {name: '创建订单', exact: true}).click();
  await page.getByText(/填写内容不符合要求/).waitFor();
  await until(async () => (await saved()) === null);
  await context.route('**/api/auth/logout', route => route.fulfill({json: {success: true, data: null}}));
  await page.evaluate(() => {
   const transaction = IDBDatabase.prototype.transaction;
   IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
    if (this.name === 'wuhou-order-images' && mode === 'readwrite') throw new DOMException('denied', 'SecurityError');
    return transaction.call(this, stores, mode, ...rest);
   };
  });
  await page.getByRole('button', {name: '退出登录', exact: true}).click();
  await page.getByRole('button', {name: '不保存并退出', exact: true}).click();
  await page.getByText(/本机临时图片未能清理/).waitFor();
  assert.equal(await saved(), null);
  const sizes = await page.evaluate(async () => {
   const db = await new Promise(resolve => { const request = indexedDB.open('wuhou-order-images', 1); request.onsuccess = () => resolve(request.result); });
   return new Promise(resolve => {
    const request = db.transaction('files').objectStore('files').getAll();
    request.onsuccess = () => resolve(request.result.map(row => row.file.size));
   });
  });
  assert.ok(sizes.some(size => size > 0));
 } finally { await context.close(); }
});
