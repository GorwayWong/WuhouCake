import { useLayoutEffect } from 'react';
const positions = new Map<string, number>();
export function useReturnScroll(key: string, ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    const target = positions.get(key) || 0;
    let restoring = true;
    const restore = () => {
      window.scrollTo(0, target);
      if (document.documentElement.scrollHeight - window.innerHeight >= target) {
        restoring = false;
        observer.disconnect();
      }
    };
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    restore();
    const save = () => { if (!restoring) positions.set(key, window.scrollY); };
    window.addEventListener('scroll', save, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('scroll', save); };
  }, [key, ready]);
}
