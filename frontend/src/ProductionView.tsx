import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Item, OrderImage } from './types';
import { api } from './api';
import { loadImagePreview } from './imagePreview';
import { historicalProductionFields, productionFields } from './productionFields';

export function ProductionFields({ item, includeHistorical = false }: { item: Item; includeHistorical?: boolean }) {
  const historical = includeHistorical ? historicalProductionFields(item) : [];
  return <><dl className="production-fields">{productionFields(item).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{historical.length > 0 && <details><summary>历史规格</summary><dl className="production-fields">{historical.map(([label, value], index) => <div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}</>;
}

export function ProductionThumbnail({ orderId }: { orderId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const images = useQuery({ queryKey: ['order', orderId, 'images'], enabled: visible,
    queryFn: ({ signal }) => api<OrderImage[]>(`/orders/${orderId}/images`, { signal }) });
  const first = images.data?.[0];
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(''); setFailed(false);
    if (first) return loadImagePreview(orderId, first.imageId, setUrl, () => setFailed(true));
  }, [orderId, first?.imageId]);
  return <div ref={element} className="production-thumbnail">{url ? <img src={url} alt="订单款式参考" /> : <span>{images.isPending ? '读取款式图片…' : images.error || failed ? '图片暂不可用' : first ? '读取图片…' : '暂无款式图片'}</span>}</div>;
}
