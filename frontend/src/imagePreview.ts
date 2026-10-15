import { fetchOrderImage } from './api.ts';

export function imageFileError(file: File): string {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return '仅支持 JPG/PNG 图片，暂不支持 HEIC/WebP。';
  if (file.size === 0) return '图片为空，请重新选择。';
  return file.size > 5 * 1024 * 1024 ? '单张图片不能超过 5 MiB。' : '';
}

// 每个可见图片拥有独立资源；订单切换和移除时终止读取并释放对象 URL。
export function loadImagePreview(orderId: string, imageId: string, ready: (url: string) => void, failed: (error: unknown) => void): () => void {
  const request = new AbortController();
  let url: string | undefined;
  void fetchOrderImage(orderId, imageId, request.signal).then(blob => {
    if (request.signal.aborted) return;
    url = URL.createObjectURL(blob);
    ready(url);
  }).catch(error => { if (!request.signal.aborted) failed(error); });
  return () => { request.abort(); if (url) URL.revokeObjectURL(url); };
}
