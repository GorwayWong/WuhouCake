import type { SubmissionContent } from './customerSubmission.ts';

export type PendingSubmission = { key: string; content: SubmissionContent };
const storageKey = (token: string) => `wuhou:public-submission:v1:${token}`;
const nullableText = (value: unknown) => value === null || typeof value === 'string';

export function readPendingSubmission(token: string): PendingSubmission | null {
  return inspectPendingSubmission(token) ?? null;
}

function inspectPendingSubmission(token: string): PendingSubmission | null | undefined {
  let stored: string | null;
  try { stored = sessionStorage.getItem(storageKey(token)); }
  catch { return undefined; }
  try {
    const pending = JSON.parse(stored ?? 'null');
    const content = pending?.content;
    if (typeof pending?.key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.key)
        || typeof content?.phone !== 'string' || !nullableText(content.memberPhone) || !nullableText(content.address)
        || (content.fulfillmentType !== 'PICKUP' && content.fulfillmentType !== 'DELIVERY')
        || typeof content.requestedReceiveAt !== 'string' || !Number.isFinite(Date.parse(content.requestedReceiveAt))
        || !Array.isArray(content.items) || !content.items.length || content.items.length > 30
        || !content.items.every((item: SubmissionContent['items'][number]) => item && typeof item.name === 'string' &&
          typeof item.productType === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 &&
          item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes) &&
          Object.values(item.attributes).every(value => typeof value === 'string'))) return null;
    return { key: pending.key, content };
  } catch { return null; }
}

export function storePendingSubmission(token: string, pending: PendingSubmission): 'saved' | 'unavailable' | PendingSubmission {
  const current = inspectPendingSubmission(token);
  if (current === undefined) return 'unavailable';
  if (current && current.key !== pending.key) return current;
  try {
    sessionStorage.setItem(storageKey(token), JSON.stringify(pending));
    return 'saved';
  } catch { return 'unavailable'; }
}

export function clearPendingSubmission(token: string, key: string): boolean {
  try {
    if (JSON.parse(sessionStorage.getItem(storageKey(token)) ?? 'null')?.key === key) sessionStorage.removeItem(storageKey(token));
    return true;
  } catch { return false; }
}
