import { useLayoutEffect, useRef } from 'react';
const positions = new Map<string, number>();
export function useReturnScroll(key: string, ready: boolean, restoreOnKeyChange = true) {
  const entryKey = useRef(key);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!restoreOnKeyChange && key !== entryKey.current) restored.current = true;
    if (!ready && (restoreOnKeyChange || !restored.current)) return;
    const shouldRestore = ready && (restoreOnKeyChange || !restored.current);
    const target = positions.get(key) || 0;
    let restoring = shouldRestore;
    const observer = new ResizeObserver(() => restore());
    const save = () => { if (!restoring) positions.set(key, window.scrollY); };
    const stop = () => { restoring = false; observer.disconnect(); save(); };
    const restore = () => {
      window.scrollTo(0, target);
      if (document.documentElement.scrollHeight - window.innerHeight >= target) stop();
    };
    if (shouldRestore) {
      restored.current = true;
      observer.observe(document.body); restore();
    }
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      observer.disconnect(); window.removeEventListener('scroll', save);
      window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); window.removeEventListener('keydown', stop);
    };
  }, [key, ready, restoreOnKeyChange]);
}
