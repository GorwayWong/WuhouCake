import { useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import type { OrderDraft } from './orderForm';
import type { RecognitionAssist, RecognitionDraft } from './types';
import { RecognitionLifecycle, applyRecognition, recognitionLimit, undoRecognition, mergeModelFields } from './recognition';
import type { RecognitionFeedbackMap } from './recognition';

type UndoStep = { before: OrderDraft; after: OrderDraft; feedback: RecognitionFeedbackMap };
export function OrderRecognition({ initialDraft, getDraft, getFeedback, manualFields, onChange, busy, onDirtyChange }: {
  onChange: (value: OrderDraft, feedback: RecognitionFeedbackMap, restore?: boolean) => void;
  busy: boolean; onDirtyChange: (dirty: boolean) => void;
  initialDraft: OrderDraft; getDraft: () => OrderDraft; getFeedback: () => RecognitionFeedbackMap; manualFields: ReadonlySet<string>;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<RecognitionDraft | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [parsing, setParsing] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [assistNotice, setAssistNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<UndoStep | null>(null);
  const lifecycle = useRef(new RecognitionLifecycle());
  const parseBusy = useRef(false), assistBusy = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => { onDirtyChange(Boolean(text.trim() || result || undo)); }, [text, result, undo, onDirtyChange]);
  useEffect(() => () => { lifecycle.current.cancel(); onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => { if (busy) { lifecycle.current.cancel(); parseBusy.current = false; assistBusy.current = false; setParsing(false); setAssisting(false); } }, [busy]);
  const fill = (next: RecognitionDraft, supplement = false) => {
    const current = getDraft(), previousFeedback = structuredClone(getFeedback());
    const filled = applyRecognition(current, initialDraft, next, manualFields, { supplement, targets });
    setTargets(filled.targets);
    if (JSON.stringify(current) !== JSON.stringify(filled.draft)) {
      setUndo({ before: structuredClone(current), after: structuredClone(filled.draft), feedback: previousFeedback });
    }
    onChange(filled.draft, filled.feedback);
    const invalid = Object.values(filled.feedback).filter(mark => mark.error).length;
    setNotice(`已填入 ${filled.applied} 项，覆盖 ${filled.overwritten} 项${filled.replacedItems ? '，已替换商品列表' : ''}${invalid ? '；标出的字段请补填' : ''}`);
    if (filled.applied || filled.replacedItems || filled.cleared) {
      if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) document.activeElement.blur();
      setOpen(false);
    }
  };
  const parse = async () => {
    if (busy || parseBusy.current || !text.trim() || text.length > recognitionLimit) return;
    const request = lifecycle.current.begin(); parseBusy.current = true; assistBusy.current = false;
    setParsing(true); setAssisting(false); setConsent(false); setAssistNotice(''); setFailure(null); setNotice(''); setResult(null);
    try {
      const next = await api<RecognitionDraft>('/orders/recognition/parse', { method: 'POST', body: { text }, signal: request.signal });
      if (!lifecycle.current.accepts(request)) return;
      setResult(next); fill(next);
    } catch (error) { if (lifecycle.current.accepts(request)) setFailure(error); }
    finally { if (lifecycle.current.accepts(request)) { parseBusy.current = false; setParsing(false); } }
  };
  const assist = async () => {
    if (!result || !consent || !result.assistAvailable || busy || assistBusy.current) return;
    const request = lifecycle.current.request(), rules = result;
    assistBusy.current = true; setAssisting(true); setAssistNotice('');
    try {
      const response = await api<RecognitionAssist>('/orders/recognition/assist', { method: 'POST', body: { text, allowExternalProcessing: true }, signal: request.signal });
      if (!lifecycle.current.accepts(request)) return;
      const merged = mergeModelFields(rules, response.suggestions);
      // 只应用本次补充，避免重放上一轮模型字段或替换商品列表。
      const changes = { ...merged, fields: {}, items: merged.items.map(item => ({ ...item, fields: Object.fromEntries(Object.entries(item.fields).filter(([field, candidate]) =>
        candidate.source === 'MODEL' && JSON.stringify(candidate) !== JSON.stringify(rules.items.find(original => original.id === item.id)?.fields[field])))})) };
      setResult(merged); fill(changes, true);
      setAssistNotice(response.issues.join('；') || (response.suggestions.length ? '补充内容已填入，请查看标记字段。' : '没有可填入的补充内容。'));
    } catch (error) {
      if (lifecycle.current.accepts(request)) setAssistNotice('AI补充暂不可用，可继续手工填写。' + errorText(error));
    } finally { if (lifecycle.current.accepts(request)) { assistBusy.current = false; setAssisting(false); } }
  };
  return <section className="recognition-section">
    <details ref={panel} className="panel recognition-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><strong>粘贴下单信息</strong><span>可选</span></summary>
      <div className="recognition-content">
        <label htmlFor="recognition-text">客户下单原文<textarea id="recognition-text" value={text} rows={5} autoComplete="off" disabled={busy} onChange={event => {
          lifecycle.current.cancel(); parseBusy.current = false; assistBusy.current = false; setParsing(false); setAssisting(false); setConsent(false); setAssistNotice(''); setResult(null); setFailure(null); setText(event.target.value);
        }} placeholder="粘贴微信、短信中的订单文字" /></label>
        <p className={text.length > recognitionLimit ? 'field-error' : 'form-help'} aria-live="polite">{text.length} / {recognitionLimit} 字符{text.length > recognitionLimit && '，请缩短后重试'}</p>
        <div className="actions"><button type="button" className="primary" disabled={busy || parsing || !text.trim() || text.length > recognitionLimit} onClick={() => void parse()}>{parsing ? '正在识别…' : '识别并填入'}</button>
          {parsing && <button type="button" className="text-button" disabled={busy} onClick={() => { lifecycle.current.cancel(); parseBusy.current = false; setParsing(false); }}>取消识别</button>}</div>
        {failure != null && <p className="notice error" role="alert">识别暂不可用，原文和表单已保留。{errorText(failure)}</p>}
      </div>
    </details>
    {(notice || undo) && <div className="recognition-receipt"><span role="status">{notice}</span>{undo && <button type="button" className="text-button" disabled={busy || parsing || assisting} onClick={() => {
      const restored = undoRecognition(getDraft(), undo.before, undo.after);
      onChange(restored, { ...getFeedback(), ...undo.feedback }, true); setUndo(null); setTargets({}); setResult(null); setConsent(false); setNotice('已撤销本次填入，手工修改保留。');
    }}>撤销本次填入</button>}</div>}
    {result && <>
      {(result.unmappedText.length > 0 || result.issues.length > 0) && <details className="recognition-evidence"><summary>未识别内容</summary>{[...result.issues, ...result.unmappedText].map((line, i) => <p key={i}>{line}</p>)}</details>}
      {result.fragments.length > 0 && <details className="recognition-assist"><summary>AI 补充（可选）</summary>
        <p className="form-help">将下列商品片段发送至阿里百炼补充识别；请核对其中的个人信息，第三方可能保留调用数据。</p>
        {result.fragments.map((fragment, i) => <p className="recognition-quote" key={i}>{fragment.text}</p>)}
        {result.assistAvailable ? <><label className="recognition-consent"><input type="checkbox" checked={consent} disabled={busy || assisting || parsing} onChange={event => setConsent(event.target.checked)} />允许发送这些片段进行本次补充</label>
          <button type="button" className="secondary" disabled={busy || assisting || parsing || !consent} onClick={() => void assist()}>{assisting ? '正在补充…' : '补充并填入'}</button></> : <p className="form-help">AI补充未启用，可直接在表单补填。</p>}
        {assistNotice && <p className="notice" role="status">{assistNotice}</p>}
      </details>}
    </>}
  </section>;
}
