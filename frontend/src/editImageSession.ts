import { useEffect, useRef, useState } from 'react';
import { randomUUID } from './uuid';
import type { QueuedImage, ImageScope } from './draftImages';

const manifestKey = (scope: ImageScope) => `wuhou:edit-images:${scope.accountId}:${scope.requestId}`;
export function readEditManifest(scope: ImageScope): QueuedImage[] {
  const rows: unknown = JSON.parse(sessionStorage.getItem(manifestKey(scope)) || '[]');
  if (!Array.isArray(rows) || rows.some(row => !row || row.accountId !== scope.accountId || row.requestId !== scope.requestId ||
      typeof row.id !== 'string' || typeof row.itemId !== 'string' || typeof row.name !== 'string' || typeof row.size !== 'number' ||
      row.key !== JSON.stringify([scope.accountId, scope.requestId, row.itemId, row.id])))
    throw new Error('Invalid edit image manifest');
  return rows;
}
export function writeEditManifest(scope: ImageScope, images: QueuedImage[]) {
  if (images.length) sessionStorage.setItem(manifestKey(scope), JSON.stringify(images));
  else sessionStorage.removeItem(manifestKey(scope));
}

// A held Web Lock prevents a duplicated tab from inheriting the original tab's editing ownership.
export function useEditImageSession(accountId: string, orderId: string) {
  const session = useRef('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    const key = `wuhou:edit-session:${accountId}:${orderId}`;
    const claim = async () => {
      let candidate: string;
      try { candidate = sessionStorage.getItem(key) || randomUUID(); }
      catch { candidate = randomUUID(); }
      const activate = (value: string) => {
        if (disposed) return;
        session.current = value;
        try { sessionStorage.setItem(key, value); } catch { /* Text editing remains available without local storage. */ }
        setReady(true);
      };
      if (!navigator.locks) { activate(randomUUID()); return; }
      await navigator.locks.request(key + ':' + candidate, { ifAvailable: true }, async lock => {
        if (!lock) {
          candidate = randomUUID();
          await navigator.locks.request(key + ':' + candidate, async () => {
            if (disposed) return;
            activate(candidate); await new Promise<void>(resolve => { release = resolve; });
          });
        } else {
          if (disposed) return;
          activate(candidate); await new Promise<void>(resolve => { release = resolve; });
        }
      });
    };
    setReady(false); void claim().catch(() => {
      if (!disposed) { session.current = randomUUID(); setReady(true); }
    });
    return () => { disposed = true; release?.(); };
  }, [accountId, orderId]);
  return { session, ready };
}
