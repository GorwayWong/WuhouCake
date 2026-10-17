import type { Activity, Page } from './types.ts';

export function uniqueActivities(pages: Pick<Page<Activity>, 'items'>[]): Activity[] {
  const seen = new Set<number>();
  return pages.flatMap(page => page.items).filter(activity => {
    if (seen.has(activity.id)) return false;
    seen.add(activity.id); return true;
  });
}
