import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from 'react-aria-components';
import { App } from './App';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PublicOrderEntry } from './PublicOrderEntry';
import { ApiError, refresh } from './api';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: {
  staleTime: 15000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
}, mutations: { retry: false } } });
function StaffApp() {
  useEffect(() => { void refresh().catch(() => {}); }, []);
  return <App />;
}
function Site() {
  const [hash, setHash] = useState(window.location.hash);
  const current = useRef(hash), guard = useRef<(() => boolean) | null>(null);
  const setGuard = useCallback((next: (() => boolean) | null) => { guard.current = next; }, []);
  useEffect(() => {
    const change = () => {
      const next = window.location.hash;
      if (next !== current.current && guard.current && !guard.current()) { window.history.replaceState(window.history.state, '', current.current); return; }
      current.current = next; setHash(next);
    };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  return hash.startsWith('#/fill/') ? <PublicOrderEntry key={hash} token={hash.slice('#/fill/'.length)} onLeaveGuard={setGuard} /> : <StaffApp />;
}
createRoot(document.getElementById('root')!).render(<I18nProvider locale="zh-CN"><QueryClientProvider client={client}><Site /></QueryClientProvider></I18nProvider>);
