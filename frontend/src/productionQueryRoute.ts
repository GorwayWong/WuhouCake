import { shiftDate, today, workbenchDate } from './dates.ts';
import { productionStatuses } from './orderStates.ts';

export interface ProductionQueryRoute {
  from: string;
  through: string;
  stage: string;
  bucket: string;
  page: number;
}

export function productionPreset(days: 7 | 30) {
  const from = today();
  return { from, through: shiftDate(from, days - 1) };
}

export function validProductionRange(from: string, through: string) {
  return Boolean(workbenchDate(`#/?date=${from}`) && workbenchDate(`#/?date=${through}`)
    && from >= '0001-01-01' && through < '9999-12-31' && from <= through
    && (Date.parse(through) - Date.parse(from)) / 86_400_000 < 42);
}

export function readProductionQuery(hash: string): ProductionQueryRoute | null {
  const [path, search] = hash.split('?');
  if (path !== '#/production-query') return null;
  if (!search) return { ...productionPreset(7), stage: '', bucket: '', page: 1 };
  const params = new URLSearchParams(search);
  const from = params.get('from') || '', through = params.get('through') || '';
  const stage = params.get('stage') || '', bucket = params.get('bucket') || '';
  const page = Number(params.get('page') ?? '1');
  if (!validProductionRange(from, through) || (stage && !productionStatuses.includes(stage))
      || (bucket && bucket !== 'unscheduled' && (!workbenchDate(`#/?date=${bucket}`) || bucket < from || bucket > through))
      || !Number.isInteger(page) || page < 1 || page > 2_147_483_647) return null;
  return { from, through, stage, bucket, page: bucket ? page : 1 };
}

export function productionQueryHref({ from, through, stage, bucket, page }: ProductionQueryRoute) {
  const params = new URLSearchParams({ from, through });
  if (stage) params.set('stage', stage);
  if (bucket) {
    params.set('bucket', bucket);
    if (page > 1) params.set('page', String(page));
  }
  return `#/production-query?${params}`;
}
