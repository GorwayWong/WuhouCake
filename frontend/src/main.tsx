import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from 'react-aria-components';
import { App } from './App';
import { ApiError, refresh } from './api';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: {
  staleTime: 15000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
}, mutations: { retry: false } } });
void refresh().catch(() => {});
createRoot(document.getElementById('root')!).render(<I18nProvider locale="zh-CN"><QueryClientProvider client={client}><App /></QueryClientProvider></I18nProvider>);
