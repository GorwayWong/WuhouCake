import { PackageDialog } from './PackageDialog';

export type DraftLeaveGuard = (leave: () => void, stay: () => void) => boolean;

export function RestoreCreationDraft({ restore, startFresh, cancel, busy = false, error = '' }: {
  restore: () => void; startFresh: () => void; cancel: () => void; busy?: boolean; error?: string;
}) {
  return <PackageDialog title="继续填写草稿？" busy={busy} onCancel={cancel}>
    <p>上次保存的草稿还在。你也可以重新填写，原草稿会保留。</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions">
      <button type="button" className="secondary" disabled={busy} onClick={cancel}>取消</button>
      <button type="button" className="secondary" disabled={busy} onClick={startFresh}>重新填写</button>
      <button type="button" className="primary" disabled={busy} onClick={restore}>{busy ? '正在读取…' : '继续填写'}</button>
    </div>
  </PackageDialog>;
}

export function SaveCreationDraft({ hasSaved, busy, error, stay, discard, save }: {
  hasSaved: boolean; busy: boolean; error: string; stay: () => void; discard: () => void; save: () => void;
}) {
  return <PackageDialog title="保存草稿？" busy={busy} onCancel={stay}>
    <p>{hasSaved ? '保存会替换上次的草稿。' : '保存后，下次可以在此浏览器继续填写。'}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions">
      <button type="button" className="secondary" disabled={busy} onClick={stay}>继续填写</button>
      <button type="button" className="secondary" disabled={busy} onClick={discard}>不保存并退出</button>
      <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '正在保存…' : '保存草稿并退出'}</button>
    </div>
  </PackageDialog>;
}
