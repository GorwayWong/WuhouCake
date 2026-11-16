import { useEffect, useRef, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { exportFailureText, fetchOrderExport, saveExportFile } from './exportFiles';
import type { ExportRequest } from './exportFiles';

function useExportDownload(onPendingChange: (pending: boolean) => void) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => () => { active.current?.abort(); active.current = null; onPendingChange(false); }, [onPendingChange]);
  async function download(request: ExportRequest) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null); setNotice(''); onPendingChange(true);
    try {
      const file = await fetchOrderExport(request, controller.signal);
      if (!controller.signal.aborted) { saveExportFile(file); setNotice(`「${file.filename}」已交给浏览器下载，请在下载记录中确认保存。`); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      if (active.current === controller) { active.current = null; setBusy(false); onPendingChange(false); }
    }
  }
  return { busy, error, notice, download };
}

function ExportFeedback({ error, notice }: { error: unknown; notice: string }) {
  return <div aria-live="polite">{error ? <p className="notice error" role="alert">{exportFailureText(error)}</p> : notice && <p className="form-help" role="status">{notice}</p>}</div>;
}

export function SingleOrderExport({ orderId, orderNo, blocked, onPendingChange }: {
  orderId: string; orderNo: string; blocked: boolean; onPendingChange: (pending: boolean) => void;
}) {
  const state = useExportDownload(onPendingChange);
  return <div className="single-export"><button className="secondary" disabled={blocked || state.busy} onClick={() => { if (!blocked) void state.download({ orderId, orderNo }); }}><DownloadSimple />{state.busy ? '正在生成 XLSX…' : '下载 XLSX'}</button><ExportFeedback error={state.error} notice={state.notice} /></div>;
}
