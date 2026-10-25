import { useEffect, useRef, useState } from 'react';
import { Select } from './Select';
import { DownloadSimple, X } from '@phosphor-icons/react';
import { exportFailureText, exportFilters, exportOptions, fetchOrderExport, saveExportFile } from './exportFiles';
import type { ExportDraft, ExportRequest } from './exportFiles';
import { DateInput } from './DateInput';

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
  return { busy, error, notice, download, reset: () => { setError(null); setNotice(''); } };
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

export function BatchOrderExport({ selected, onPendingChange }: { selected: string; onPendingChange: (pending: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ExportDraft>({ from: selected, through: selected, status: '', fulfillmentType: '', paymentStatus: '' });
  const [validation, setValidation] = useState('');
  const state = useExportDownload(onPendingChange);
  const change = (key: keyof ExportDraft, value: string) => { setDraft(current => ({ ...current, [key]: value })); setValidation(''); };
  return <section className="batch-export" aria-label="筛选批量导出">
    {!open ? <button className="secondary compact" aria-expanded={false} onClick={() => { setDraft({ from: selected, through: selected, status: '', fulfillmentType: '', paymentStatus: '' }); setValidation(''); state.reset(); setOpen(true); }}><DownloadSimple />批量导出 ZIP</button> : <div className="panel export-panel">
      <div className="section-heading"><h2>筛选批量导出</h2><button className="icon-button" disabled={state.busy} aria-label="收起批量导出" onClick={() => setOpen(false)}><X size={22} /></button></div>
      <p className="form-help">按收货日期导出，每单一份 XLSX，最多 42 天、100 单。</p>
      <form onSubmit={event => { event.preventDefault(); if (state.busy) return; const result = exportFilters(draft); setValidation(result.error || ''); if (result.filters) void state.download({ filters: result.filters }); }}>
        <fieldset className="export-filters" disabled={state.busy}>
          <label>开始日期<DateInput label="开始日期" disabled={state.busy} value={draft.from} onChange={value => change('from', value)} required /></label>
          <label>结束日期（含当天）<DateInput label="结束日期（含当天）" disabled={state.busy} value={draft.through} onChange={value => change('through', value)} required /></label>
          {([['status', '订单状态'], ['fulfillmentType', '交接方式'], ['paymentStatus', '付款状态']] as const).map(([key, label]) => <label key={key}>{label}<Select label={label} disabled={state.busy} value={draft[key]} onChange={value => change(key, value)}><option value="">全部</option>{Object.entries(exportOptions[key]).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>)}
        </fieldset>
        {validation && <p className="field-error" role="alert">{validation}</p>}
        <div className="export-submit"><p className="form-help">不筛选状态时，含已完成和已取消订单。</p><button className="primary" disabled={state.busy}><DownloadSimple />{state.busy ? '正在生成 ZIP…' : '下载筛选结果 ZIP'}</button></div>
      </form>
      <ExportFeedback error={state.error} notice={state.notice} />
    </div>}
  </section>;
}
