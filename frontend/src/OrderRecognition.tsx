import { useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import type { OrderDraft } from './orderForm';
import type { RecognitionDraft } from './types';
import { RecognitionLifecycle, applyRecognition, orderEntryRecognition, recognitionLimit, undoRecognition } from './recognition';
import type { RecognitionFeedbackMap } from './recognition';

type UndoStep = { before: OrderDraft; after: OrderDraft; feedback: RecognitionFeedbackMap };
function validFields(value: RecognitionDraft['fields'] | null | undefined): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(field =>
    field && (field.value === null || typeof field.value === 'string') && typeof field.needsReview === 'boolean'
    && Array.isArray(field.issues) && field.issues.every(issue => typeof issue === 'string')));
}

export function OrderRecognition({ initialDraft, getDraft, getFeedback, manualFields, onChange, busy, text, open, onEditorChange }: {
  onChange: (value: OrderDraft, feedback: RecognitionFeedbackMap, restore?: boolean) => void;
  busy: boolean; text: string; open: boolean; onEditorChange: (changes: { text?: string; open?: boolean }) => void;
  initialDraft: OrderDraft; getDraft: () => OrderDraft; getFeedback: () => RecognitionFeedbackMap; manualFields: ReadonlySet<string>;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  const [parsing, setParsing] = useState(false);
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<UndoStep | null>(null);
  const lifecycle = useRef(new RecognitionLifecycle());
  const parseBusy = useRef(false);
  const processed = useRef(new Set<string>());
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => () => { lifecycle.current.cancel(); }, []);
  useEffect(() => { if (busy) { lifecycle.current.cancel(); parseBusy.current = false; setParsing(false); } }, [busy]);
  const fill = (next: RecognitionDraft) => {
    const current = getDraft(), previousFeedback = structuredClone(getFeedback());
    const filled = applyRecognition(current, initialDraft, orderEntryRecognition(next, manualFields), manualFields);
    if (JSON.stringify(current) !== JSON.stringify(filled.draft)) {
      setUndo({ before: structuredClone(current), after: structuredClone(filled.draft), feedback: previousFeedback });
    }
    onChange(filled.draft, filled.feedback);
    if (filled.applied || filled.replacedItems || filled.cleared) {
      if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) document.activeElement.blur();
      onEditorChange({ open: false });
    }
  };
  const parse = async () => {
    const key = text.replace(/\r\n?/g, '\n').trim();
    if (busy || parseBusy.current || !key || text.length > recognitionLimit || processed.current.has(key)) return;
    const request = lifecycle.current.begin();
    parseBusy.current = true;
    setParsing(true); setFailure(null); setNotice('');
    try {
      const next = await api<RecognitionDraft>('/orders/recognition/parse', { method: 'POST', body: { text }, signal: request.signal });
      if (!lifecycle.current.accepts(request)) return;
      if (!next || !validFields(next.fields) || !Array.isArray(next.items)
        || !next.items.every(item => item && typeof item.id === 'string' && validFields(item.fields))) {
        throw new Error('识别结果格式无效。');
      }
      fill(next);
      processed.current.add(key);
    } catch (error) { if (lifecycle.current.accepts(request)) setFailure(error); }
    finally { if (lifecycle.current.accepts(request)) { parseBusy.current = false; setParsing(false); } }
  };
  return <section className="recognition-section">
    <details ref={panel} className="panel recognition-panel" open={open} onToggle={event => { if (event.currentTarget.open !== open) onEditorChange({ open: event.currentTarget.open }); }}><summary><strong>粘贴下单信息</strong><span>可选</span></summary>
      <div className="recognition-content">
        <label htmlFor="recognition-text">客户下单原文<textarea id="recognition-text" value={text} rows={5} autoComplete="off" disabled={busy} onChange={event => {
          lifecycle.current.cancel(); parseBusy.current = false; setParsing(false); setFailure(null); onEditorChange({ text: event.target.value });
        }} placeholder="粘贴微信、短信中的订单文字" /></label>
        <p className={text.length > recognitionLimit ? 'field-error' : 'form-help'} aria-live="polite">{text.length} / {recognitionLimit} 字符{text.length > recognitionLimit && '，请缩短后重试'}</p>
        <div className="actions"><button type="button" className="primary" disabled={busy || parsing || !text.trim() || text.length > recognitionLimit} onClick={() => void parse()}>{parsing ? '正在识别…' : '识别并填入'}</button>
          {parsing && <button type="button" className="text-button" disabled={busy} onClick={() => { lifecycle.current.cancel(); parseBusy.current = false; setParsing(false); }}>取消识别</button>}</div>
        {failure != null && <p className="notice error" role="alert">识别暂不可用，原文和表单已保留。{errorText(failure)}</p>}
      </div>
    </details>
    {(notice || undo) && <div className="recognition-receipt">{notice && <span role="status">{notice}</span>}{undo && <button type="button" className="text-button" disabled={busy || parsing} onClick={() => {
      const restored = undoRecognition(getDraft(), undo.before, undo.after);
      onChange(restored, { ...getFeedback(), ...undo.feedback }, true); setUndo(null); setNotice('已撤销本次填入，手工修改保留。');
    }}>撤销本次填入</button>}</div>}
  </section>;
}
