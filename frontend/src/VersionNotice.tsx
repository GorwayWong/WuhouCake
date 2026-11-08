/// <reference types="vite/client" />
import { useEffect, useState } from 'react';

export function entryScripts(html: string, origin: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .map(script => new URL(script.getAttribute('src')!, origin).href).sort().join('\n');
}
export function VersionNotice({ connection, blocked, refresh }: { connection: string; blocked: boolean; refresh: () => void }) {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const baseline = entryScripts(document.documentElement.outerHTML, location.href);
    if (!baseline) return;
    let active: AbortController | undefined;
    const check = async () => {
      if (active || document.visibilityState === 'hidden') return;
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/index.html', { cache: 'no-store', signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
        const latest = entryScripts(await response.text(), location.href);
        if (latest && latest !== baseline && !controller.signal.aborted) setUpdated(true);
      } catch { /* 更新检查失败不阻断当前操作。 */ }
      finally { clearTimeout(timeout); if (active === controller) active = undefined; }
    };
    void check();
    document.addEventListener('visibilitychange', check); window.addEventListener('online', check);
    return () => { active?.abort(); document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); };
  }, [connection]);
  return updated ? <div className="notice version-notice" role="status">系统已更新，保存后刷新。{blocked && <span>请先完成当前保存、图片处理或取消未保存的编辑。</span>}<button type="button" className="secondary" disabled={blocked} onClick={refresh}>刷新页面</button></div> : null;
}
