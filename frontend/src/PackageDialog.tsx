import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function PackageDialog({ title, busy = false, onCancel, children }: {
  title: string; busy?: boolean; onCancel: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="draft-dialog package-dialog" aria-label={title}
    onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2>{title}</h2>{children}
  </dialog>;
}
