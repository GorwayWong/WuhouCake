import type { DraftImage } from './draftImages.ts';

export const imagesPerItem = 5;
export function validDraftImages(value: unknown): value is DraftImage[] {
  if (!Array.isArray(value) || value.length > imagesPerItem) return false;
  const ids = new Set<string>();
  return value.every(image => {
    if (!image || typeof image !== 'object' || typeof image.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(image.id)
      || ids.has(image.id) || typeof image.name !== 'string' || !['image/jpeg', 'image/png'].includes(image.type)
      || !Number.isSafeInteger(image.size) || image.size < 1 || image.size > 5 * 1024 * 1024) return false;
    ids.add(image.id); return true;
  });
}
