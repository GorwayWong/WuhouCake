import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api, errorText } from './api';
import type { OrderDraft } from './orderForm';
import type { RecognitionAssist, RecognitionDraft, RecognitionField } from './types';
import { RecognitionLifecycle, applyRecognition, candidateEdits, currentValue, pristineItem, recognitionLabels, recognitionLimit,
  undoRecognition, recognitionRowKey, mergeModelFields } from './recognition';

type UndoStep = { before: OrderDraft; after: OrderDraft };
export function OrderRecognition({ draft, initialDraft, getDraft, manualFields, onChange, busy, onDirtyChange }: {
  draft: OrderDraft; onChange: (value: OrderDraft) => void; busy: boolean; onDirtyChange: (dirty: boolean) => void;
  initialDraft: OrderDraft; getDraft: () => OrderDraft; manualFields: ReadonlySet<string>;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<RecognitionDraft | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editedFields, setEditedFields] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [parsing, setParsing] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [assistNotice, setAssistNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [undo, setUndo] = useState<UndoStep[]>([]);
  const lifecycle = useRef(new RecognitionLifecycle());
  const parsedText = useRef('');
  const parseBusy = useRef(false), assistBusy = useRef(false);
  useEffect(() => { onDirtyChange(Boolean(text.trim() || result || undo.length)); }, [text, result, undo, onDirtyChange]);
  useEffect(() => () => { lifecycle.current.cancel(); onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => { if (busy) { lifecycle.current.cancel(); parseBusy.current = false; assistBusy.current = false; setParsing(false); setAssisting(false); } }, [busy]);
  const rowKey = recognitionRowKey;
  const read = (next: RecognitionDraft) => {
    const prepared = candidateEdits(next);
    setEdits(prepared.values); setEditedFields(new Set()); setErrors(prepared.errors); setResult(next); return prepared;
  };
  const parse = async () => {
    if (busy || parseBusy.current || !text.trim() || text.length > recognitionLimit) return;
    const request = lifecycle.current.begin(); parseBusy.current = true; assistBusy.current = false;
    setParsing(true); setAssisting(false); setConsent(false); setAssistNotice(''); setFailure(null); setNotice(''); setResult(null);
    try {
      const next = await api<RecognitionDraft>('/orders/recognition/parse', { method: 'POST', body: { text }, signal: request.signal });
      if (!lifecycle.current.accepts(request)) return;
      const prepared = read(next), current = getDraft();
      const blankOrder = current.items.length === 1 && pristineItem(current.items[0]) && ![...manualFields].some(field => field.startsWith(current.items[0].key + '.'));
      const initialTargets = Object.fromEntries(next.items.map((item, i) => [item.id,
        parsedText.current === text && targets[item.id] && current.items.some(x => x.key === targets[item.id]) ? targets[item.id]
          : blankOrder ? i === 0 ? current.items[0].key : 'new' : 'choose']));
      parsedText.current = text;
      const filled = applyRecognition(current, initialDraft, next, prepared.values, initialTargets, manualFields);
      setTargets(filled.targets); setErrors({ ...prepared.errors, ...filled.errors });
      if (filled.applied || filled.cleared) { onChange(filled.draft); setUndo([{ before: structuredClone(current), after: structuredClone(filled.draft) }]); }
      setReviewOpen(filled.skipped > 0 || next.issues.length > 0 || [...Object.values(next.fields), ...next.items.flatMap(item => Object.values(item.fields))].some(field => field.needsReview));
      setNotice('已填入 ' + filled.applied + ' 个明确字段。' + (filled.cleared ? '原文日期未明确，已清空初始日期，请人工填写。' : '') + (filled.skipped ? '已有手动内容已保留，冲突可逐项选择。' : '未提供或不确定的内容留空，请在下方补充。'));
    } catch (error) { if (lifecycle.current.accepts(request)) setFailure(error); }
    finally { if (lifecycle.current.accepts(request)) { parseBusy.current = false; setParsing(false); } }
  };
  const assist = async () => {
    if (!result || !consent || !result.assistAvailable || busy || assistBusy.current) return;
    const request = lifecycle.current.request(), rules = result, originalEdits = { ...edits };
    assistBusy.current = true; setAssisting(true); setAssistNotice('');
    try {
      const response = await api<RecognitionAssist>('/orders/recognition/assist', { method: 'POST', body: { text, allowExternalProcessing: true }, signal: request.signal });
      if (!lifecycle.current.accepts(request)) return;
      const merged = mergeModelFields(rules, response.suggestions), prepared = candidateEdits(merged);
      setResult(merged); setEdits(current => {
        const values = { ...prepared.values };
        for (const key of Object.keys(current)) if (current[key] !== originalEdits[key]) values[key] = current[key];
        return values;
      });
      setReviewOpen(true);
      setErrors(current => ({ ...prepared.errors, ...current }));
      setAssistNotice((response.suggestions.length ? 'AI建议仅显示为待确认候选，没有自动改动录单内容。' : '未采用AI建议，规则结果及录单内容保持。') + response.issues.join('；'));
    } catch (error) {
      if (lifecycle.current.accepts(request)) setAssistNotice('AI补充暂不可用，规则结果和录单内容保持。' + errorText(error));
    } finally { if (lifecycle.current.accepts(request)) { assistBusy.current = false; setAssisting(false); } }
  };
  const apply = (only?: { field: string; candidate: RecognitionField; itemId?: string }) => {
    if (!result || busy) return;
    const current = getDraft(), filled = applyRecognition(current, initialDraft, result, edits, targets, manualFields, only);
    setErrors(filled.errors);
    if (filled.applied || filled.cleared) { onChange(filled.draft); setTargets(filled.targets); setUndo(steps => [...steps, { before: structuredClone(current), after: structuredClone(filled.draft) }]); }
    setNotice('已应用 ' + filled.applied + ' 个字段。' + (filled.cleared ? '未确认的初始日期已清空。' : '') + (filled.skipped ? filled.skipped + ' 个字段已保留原值，请逐项选择。' : '仍可在下方表单修改；正式创建会继续校验。'));
  };
  const row = (field: string, candidate: RecognitionField, itemId?: string) => {
    const key = rowKey(field, itemId), value = edits[key] || '';
    const target = itemId ? targets[itemId] || 'new' : undefined;
    const current = target === 'new' ? '' : currentValue(draft, field, target);
    const conflict = Boolean(value && current && value !== current);
    const input = { id: 'recognition-' + key, value, disabled: busy, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setEdits(values => ({ ...values, [key]: event.target.value })); setEditedFields(values => new Set([...values, key])); setErrors(values => { const next = { ...values }; delete next[key]; return next; });
    } };
    return <div className="recognition-field" key={key}>
      <div className="recognition-field-title"><label htmlFor={input.id}>{recognitionLabels[field] || field}</label><span className={'recognition-source ' + (candidate.source || 'missing').toLowerCase()}>{editedFields.has(key) ? '人工修改 · 待采用' : candidate.source === 'DEFAULT' ? '系统默认 · 客户未明示' : candidate.source === 'MODEL' ? 'AI建议 · 待确认' : candidate.needsReview ? '规则候选 · 待确认' : candidate.value === null ? '待填写' : '规则识别'}</span></div>
      <div className="recognition-value">{field === 'fulfillmentType' ? <select {...input}><option value="">待填写</option><option value="DELIVERY">配送</option><option value="PICKUP">自提</option></select> : ['address', 'requirements', 'message'].includes(field) ? <textarea {...input} rows={2} placeholder="待填写" /> : <input {...input} placeholder="待填写" inputMode={field.endsWith('Cents') ? 'decimal' : undefined} />}
        <button type="button" className="secondary compact" disabled={busy || !value.trim() || target === 'choose'} onClick={() => apply({ field, candidate, itemId })}>{conflict ? '改用此值' : candidate.needsReview ? '确认采用' : '采用'}</button></div>
      {conflict && <p className="form-help">当前录单：{current}。仅点击“改用此值”才会替换此字段。</p>}
      {candidate.issues.map((issue, i) => <p className="field-error" key={i}>{issue}</p>)}{errors[key] && <p className="field-error" role="alert">{errors[key]}</p>}
      {candidate.evidence.length > 0 && <details className="recognition-evidence"><summary>{editedFields.has(key) ? '原始识别依据（供对照）' : '原文依据'}</summary>{candidate.evidence.map((quote, i) => <p key={i}>{quote}</p>)}</details>}
    </div>;
  };
  return <details className="panel recognition-panel"><summary><strong>客户下单信息识别</strong><span>可选 · 随时可手工录单</span></summary>
    <div className="recognition-content"><p className="form-help">粘贴后点击一次，将明确字段填入下方录单表单，不确定的留空。已有手动内容会保留。订购须知不作为本单事实；识别不会创建订单或确认付款。</p>
      <label htmlFor="recognition-text">客户下单原文<textarea id="recognition-text" value={text} rows={6} autoComplete="off" disabled={busy} onChange={event => {
        lifecycle.current.cancel(); parseBusy.current = false; assistBusy.current = false; setParsing(false); setAssisting(false); setConsent(false); setAssistNotice(''); setResult(null); setFailure(null); setText(event.target.value); setNotice('');
      }} placeholder="粘贴微信、短信中的订单文字" /></label>
      <p className={text.length > recognitionLimit ? 'field-error' : 'form-help'} aria-live="polite">{text.length} / {recognitionLimit} 字符{text.length > recognitionLimit && '，已超限，请缩短原文后重试；内容没有被截断。'}</p>
      <div className="actions"><button type="button" className="secondary" disabled={busy || parsing || !text.trim() || text.length > recognitionLimit} onClick={() => void parse()}>{parsing ? '正在规则识别…' : '识别并填充'}</button>
        {Boolean(parsing || result || failure) && <button type="button" className="text-button" disabled={busy} onClick={() => { lifecycle.current.cancel(); parseBusy.current = false; assistBusy.current = false; setParsing(false); setAssisting(false); setResult(null); setFailure(null); setNotice('识别已取消，现有录单内容保持。'); }}>取消识别</button>}
        {undo.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={() => {
          const restored = [...undo].reverse().reduce((value, step) => undoRecognition(value, step.before, step.after), getDraft());
          onChange(restored); setUndo([]); setNotice('已撤销识别填充；之后的手动修改已保留。');
        }}>撤销识别填充</button>}</div>
      {failure != null && <p className="notice error" role="alert">识别暂不可用，原文及录单内容已保留。{errorText(failure)} 可继续在下方手工录单。</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {result && <details className="recognition-results" open={reviewOpen} onToggle={event => setReviewOpen(event.currentTarget.open)}><summary>字段对照与待确认项</summary><div className="section-heading"><h2>识别候选</h2><button type="button" className="secondary" disabled={busy} onClick={() => apply()}>应用全部可用候选</button></div>
        <p className="form-help">批量应用会跳过待确认项和冲突字段。空值保留待填写，商品名称、数量和交接时刻不会补造。</p>
        {result.fragments.length > 0 && <details className="recognition-assist"><summary>可选：补充未理解的商品语义</summary>
          <p className="form-help">手工录单不需要AI。仅下列商品片段及归属会发送至阿里百炼，不重复发送已解析的姓名、电话或地址。请核对片段仍可能包含的个人信息；第三方可能按服务协议保留调用数据。</p>
          {result.fragments.map((fragment, i) => <p className="recognition-quote" key={i}>{fragment.text}</p>)}
          {result.assistAvailable ? <><label className="recognition-consent"><input type="checkbox" checked={consent} disabled={busy || assisting} onChange={event => setConsent(event.target.checked)} />我确认允许发送上述片段进行本次AI补充</label>
            <button type="button" className="secondary" disabled={busy || assisting || !consent} onClick={() => void assist()}>{assisting ? '正在补充，不影响手工填写…' : '补充这些片段'}</button></> : <p className="form-help">AI补充未启用或配置不完整，请继续手工填写。</p>}
          {assistNotice && <p className="notice" role="status">{assistNotice}</p>}
        </details>}
        {result.issues.map((issue, i) => <p key={i} className="field-error">{issue}</p>)}
        <details className="recognition-group" open><summary>客户与交接</summary>{Object.entries(result.fields).map(([field, candidate]) => row(field, candidate))}</details>
        {result.items.map((item, i) => <details className="recognition-group" key={item.id} open><summary>商品候选 {i + 1}</summary>
          <label>填入哪个商品<select value={targets[item.id] || 'new'} disabled={busy} onChange={event => setTargets(values => ({ ...values, [item.id]: event.target.value }))}>
            <option value="choose">请选择，避免与手工商品串项</option><option value="new">作为新商品添加</option>{draft.items.map((existing, index) => <option key={existing.key} value={existing.key}>商品 {index + 1} · {existing.name || '尚未命名'}</option>)}
          </select></label>{Object.entries(item.fields).map(([field, candidate]) => row(field, candidate, item.id))}</details>)}
        {result.unmappedText.length > 0 && <details className="recognition-evidence"><summary>未映射内容 · 请人工核对</summary>{result.unmappedText.map((line, i) => <p key={i}>{line}</p>)}</details>}
      </details>}
    </div>
  </details>;
}
