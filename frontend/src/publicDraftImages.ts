import { ApiError, fetchPackageImage, uploadSubmissionImage } from './api';
import type { SubmissionDraft } from './customerSubmission';

const stagingLifetime = 48 * 60 * 60 * 1000;

export function publicDraftImages(draft: SubmissionDraft) {
  return draft.items.flatMap(item => (item.imageIds ?? []).map(id => ({ item: item.key, id })));
}

function imagePath(base: string, item: string, id: string) {
  return `${base}/items/${item}/images/${id}`;
}

export async function copyLegacyDraftImages(base: string, draft: SubmissionDraft, files: ReadonlyMap<string, File>,
  signal: AbortSignal) {
  const copies = new Map<string, File>();
  for (const { item, id } of publicDraftImages(draft)) {
    if (files.has(id)) continue;
    try {
      const blob = await fetchPackageImage(imagePath(base, item, id), signal, true);
      signal.throwIfAborted();
      copies.set(id, new File([blob], blob.type === 'image/png' ? 'reference.png' : 'reference.jpg', { type: blob.type }));
    } catch (failure) {
      if (signal.aborted) throw failure;
    }
  }
  return copies;
}

export function replaceDraftImageIds(draft: SubmissionDraft, replacements: ReadonlyMap<string, string>) {
  if (!replacements.size) return draft;
  return { ...draft, items: draft.items.map(item => ({
    ...item, imageIds: item.imageIds?.map(id => replacements.get(id) ?? id),
  })) };
}

function waitForRetry(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    function abort() { clearTimeout(timer); reject(signal.reason); }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, seconds * 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function stagePublicDraftImages(base: string, draft: SubmissionDraft, files: ReadonlyMap<string, File>,
  stagedAt: Record<string, number>, signal: AbortSignal, waiting: { used: boolean },
  target: { missing: ReadonlySet<string> } | { skip: ReadonlySet<string> },
  onProgress: (completed: number, total: number, waiting?: boolean) => void,
  onStaged: (id: string, startedAt: number) => Promise<void>) {
  const images = publicDraftImages(draft).filter(({ id }) => 'missing' in target ? target.missing.has(id)
    : !target.skip.has(id) && (!stagedAt[id] || Date.now() - stagedAt[id] < 0 || Date.now() - stagedAt[id] >= stagingLifetime));
  for (const [index, { item, id }] of images.entries()) {
    signal.throwIfAborted();
    const file = files.get(id);
    if (!file) throw new ApiError(404, 'IMAGE_NOT_FOUND');
    const path = imagePath(base, item, id);
    onProgress(index, images.length);
    const startedAt = Date.now();
    let result: string;
    try {
      result = await uploadSubmissionImage(path, file, signal, true);
    } catch (failure) {
      const delay = failure instanceof ApiError && (failure.status === 429 || failure.status === 503)
        && failure.retryAfter && /^\d+$/.test(failure.retryAfter) ? Number(failure.retryAfter) : 0;
      if (waiting.used || delay <= 0 || delay > 60) throw failure;
      waiting.used = true;
      onProgress(index, images.length, true);
      await waitForRetry(delay, signal);
      onProgress(index, images.length);
      result = await uploadSubmissionImage(path, file, signal, true);
    }
    signal.throwIfAborted();
    if (result !== id) throw new ApiError(502, 'SERVICE_UNAVAILABLE');
    await onStaged(id, startedAt);
    onProgress(index + 1, images.length);
  }
}
