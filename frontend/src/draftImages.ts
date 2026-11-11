import { randomUUID } from './uuid.ts';
import { imageFileError } from './imagePreview.ts';
import type { OrderDraftRecord } from './orderDraftStorage.ts';
import type { Detail } from './types.ts';

export interface DraftImage { id: string; name: string; type: string; size: number }
export interface ImageScope { accountId: string; requestId: string }
export interface StoredImage extends DraftImage {
  key: string; accountId: string; requestId: string; itemId: string; file: Blob; orderId?: string; error?: string;
}
export type QueuedImage = Omit<StoredImage, 'file'>;
class LocalImageError extends Error {}
export function localImageError(error: unknown): string {
  if (error instanceof LocalImageError) return error.message;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '本机存储空间不足，图片尚未保存。请释放空间后重试。';
  return '本机图片无法保存或读取，请检查浏览器存储权限后重试。';
}
const key = (scope: ImageScope, itemId: string, id: string) => JSON.stringify([scope.accountId, scope.requestId, itemId, id]);
let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wuhou-order-images', 1);
    request.onupgradeneeded = () => {
      const files = request.result.createObjectStore('files', { keyPath: 'key' });
      files.createIndex('draft', ['accountId', 'requestId']);
      files.createIndex('order', ['accountId', 'orderId']);
      request.result.createObjectStore('transfers', { keyPath: 'key' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new LocalImageError('图片存储正在升级，请关闭其他录单标签页后重试。')); };
  });
  return database;
}
async function write(stores: string[], action: (tx: IDBTransaction) => void) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new LocalImageError('图片保存未完成，请重试。'));
    try { action(tx); } catch (error) { tx.abort(); reject(error); }
  });
}
async function read<T>(store: string, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function saveDraftImages(scope: ImageScope, itemId: string, files: File[], orderId?: string): Promise<DraftImage[]> {
  return saveDraftImageBatch(scope, files.map(file => ({ itemId, file })), orderId);
}
export async function saveDraftImageBatch(scope: ImageScope, entries: { itemId: string; file: File }[], orderId?: string): Promise<DraftImage[]> {
  const records: StoredImage[] = [];
  for (const { itemId, file } of entries) {
    const problem = imageFileError(file); if (problem) throw new LocalImageError(`${file.name}：${problem}`);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new LocalImageError(`${file.name}：图片内容损坏或无法读取。`); }
    const tooLarge = bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 24_000_000;
    bitmap.close(); if (tooLarge) throw new LocalImageError(`${file.name}：图片边长不得超过 8192 像素，总像素不得超过 2400 万。`);
    const id = randomUUID();
    records.push({ id, name: file.name, type: file.type, size: file.size, key: key(scope, itemId, id), ...scope, itemId, file, orderId });
  }
  if (records.length) await write(['files'], tx => { for (const record of records) tx.objectStore('files').add(record); });
  return records.map(({ id, name, type, size }) => ({ id, name, type, size }));
}
export function readDraftImage(scope: ImageScope, itemId: string, id: string) {
  return read<StoredImage | undefined>('files', store => store.get(key(scope, itemId, id)));
}
export async function removeDraftImage(scope: ImageScope, itemId: string, id: string) {
  await write(['files'], tx => {
    const store = tx.objectStore('files'), request = store.get(key(scope, itemId, id));
    request.onsuccess = () => { if (request.result && !request.result.orderId) store.delete(request.result.key); };
  });
}
export async function removeDraftImages(scope: ImageScope) {
  await write(['files'], tx => {
    const store = tx.objectStore('files'), request = store.index('draft').getAll([scope.accountId, scope.requestId]);
    request.onsuccess = () => { for (const row of request.result as StoredImage[]) if (!row.orderId) store.delete(row.key); };
  });
}
export async function requireDraftImages(record: ImageScope & Pick<OrderDraftRecord, 'value'>) {
  for (const item of record.value.items) for (const image of item.images || []) {
    if (!await readDraftImage(record, item.key, image.id)) throw new LocalImageError(`商品「${item.name || '未命名商品'}」的图片「${image.name}」在本机缺失，请移除后重新选择。`);
  }
}
export async function promoteDraftImages(record: OrderDraftRecord, order: Detail) {
  const items = new Set(order.items.map(item => item.itemId));
  const referenced = record.value.items.flatMap(item => (item.images || []).map(image => ({ itemId: item.key, image })));
  if (referenced.some(row => !items.has(row.itemId))) throw new LocalImageError('订单商品标识与图片草稿不一致，草稿已保留，请核对订单。');
  let missing = false;
  try {
    await write(['files', 'transfers'], tx => {
      const store = tx.objectStore('files');
      for (const { itemId, image } of referenced) {
        const request = store.get(key(record, itemId, image.id));
        request.onsuccess = () => {
          if (!request.result) { missing = true; tx.abort(); return; }
          store.put({ ...request.result, orderId: order.orderId });
        };
      }
      tx.objectStore('transfers').put({ key: JSON.stringify([record.accountId, record.requestId]), orderId: order.orderId });
    });
  } catch (error) { if (missing) throw new LocalImageError('部分图片在本机缺失，订单已创建，草稿已保留，请重新选择图片。'); throw error; }
}
export async function transferredOrder(scope: ImageScope): Promise<string | undefined> {
  return (await read<{ orderId: string } | undefined>('transfers', store => store.get(JSON.stringify([scope.accountId, scope.requestId]))))?.orderId;
}
export async function imageQueue(accountId: string, orderId: string): Promise<StoredImage[]> {
  return read<StoredImage[]>('files', store => store.index('order').getAll([accountId, orderId]));
}
export async function imageQueueMetadata(accountId: string, orderId: string): Promise<QueuedImage[]> {
  return (await imageQueue(accountId, orderId)).map(({ file: _file, ...metadata }) => metadata);
}
export async function updateQueuedImage(image: StoredImage, error?: string) {
  await write(['files'], tx => {
    const store = tx.objectStore('files');
    // A late response must not resurrect a file removed in another tab.
    const request = store.get(image.key);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, error }); };
  });
}
export async function removeQueuedImage(image: Pick<StoredImage, 'key'>) { await write(['files'], tx => { tx.objectStore('files').delete(image.key); }); }
export async function forgetImageTransfer(scope: ImageScope) {
  await write(['transfers'], tx => { tx.objectStore('transfers').delete(JSON.stringify([scope.accountId, scope.requestId])); });
}

export async function editImageQueue(accountId: string, orderId: string): Promise<QueuedImage[]> {
  const rows = await read<StoredImage[]>('files', store => store.getAll());
  return rows.filter(row => row.accountId === accountId && !row.orderId && row.requestId.startsWith(`edit:${orderId}:`))
    .map(({ file: _file, ...row }) => row);
}
export async function validateEditImages(scope: ImageScope, order: Detail, expected: QueuedImage[]) {
  if (!expected.length) return;
  const rows = await Promise.all(expected.map(image => readDraftImage(scope, image.itemId, image.id)));
  if (rows.some((row, index) => !row?.file || row.file.size !== expected[index].size))
    throw new LocalImageError('暂存图片缺失，请重新选择或移除缺失图片后保存。');
  if (expected.some(image => !order.items.some(item => item.itemId === image.itemId)))
    throw new LocalImageError('图片对应商品已移除，请移除这张暂存图片。');
}
export async function commitEditImages(scope: ImageScope, order: Detail, expected: QueuedImage[]) {
  if (!expected.length) return;
  await write(['files'], tx => {
    const store = tx.objectStore('files'), request = store.index('draft').getAll([scope.accountId, scope.requestId]);
    request.onsuccess = () => {
      const rows = request.result as StoredImage[];
      if (expected.some(image => !rows.some(row => row.id === image.id && row.itemId === image.itemId && row.file?.size === image.size)) ||
          expected.some(image => !order.items.some(item => item.itemId === image.itemId)) || order.deletion || order.deleted) { tx.abort(); return; }
      for (const image of expected) {
        const row = rows.find(row => row.id === image.id && row.itemId === image.itemId)!;
        store.put({ ...row, orderId: order.orderId });
      }
    };
  });
}

export async function removeEditImage(scope: ImageScope, image: QueuedImage) {
  if (image.accountId !== scope.accountId || image.requestId !== scope.requestId || image.orderId)
    throw new LocalImageError('只能移除本次编辑的暂存图片。');
  await write(['files'], tx => {
    const store = tx.objectStore('files'), request = store.get(key(scope, image.itemId, image.id));
    request.onsuccess = () => {
      const row = request.result as StoredImage | undefined;
      if (row && !row.orderId && row.accountId === scope.accountId && row.requestId === scope.requestId) store.delete(row.key);
    };
  });
}
