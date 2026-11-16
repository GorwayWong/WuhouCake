import { exactYuan } from './money.ts';
import { packageDraft } from './orderPackages.ts';
import type { OrderPackage, PackageRow } from './orderPackages.ts';

export interface PackageDraftValues {
  name: string;
  original: string;
  member: string;
  items: PackageRow[];
}
export type ConflictChoice = 'local' | 'remote';
export type PackageConflict =
  | { key: string; label: string; kind: 'text'; local: string; remote: string }
  | { key: string; label: string; kind: 'image' | 'row'; local: PackageRow | null; remote: PackageRow | null };

export function editablePackage(value: OrderPackage): PackageDraftValues {
  return {
    name: value.name,
    original: value.originalAmountCents == null ? '' : exactYuan(value.originalAmountCents),
    member: value.memberAmountCents == null ? '' : exactYuan(value.memberAmountCents),
    items: packageDraft(value),
  };
}

const itemFields = {
  name: '名称', specification: '商品备注', quantity: '数量',
  unitPrice: '单价（元）', memberPrice: '会员价（元）',
} as const;
const textFields = Object.keys(itemFields) as (keyof typeof itemFields)[];
function sameItem(a: PackageRow, b: PackageRow) {
  return a.imageId === b.imageId && textFields.every(field => a[field] === b[field]);
}

/** Resolve independent edits and keep both choices for changes to the same field. */
export function mergePackageDraft(base: PackageDraftValues, local: PackageDraftValues, remote: PackageDraftValues,
  choices: Readonly<Record<string, ConflictChoice>>) {
  const conflicts: PackageConflict[] = [];
  const restored = new Set<string>();
  function takeText(key: string, label: string, before: string, mine: string, theirs: string) {
    if (mine === before) return theirs;
    if (theirs === before || mine === theirs) return mine;
    conflicts.push({ key, label, kind: 'text', local: mine, remote: theirs });
    return choices[key] === 'remote' ? theirs : mine;
  }
  const values: PackageDraftValues = {
    name: takeText('name', '套餐名称', base.name, local.name, remote.name),
    original: takeText('original', '套餐原价（元）', base.original, local.original, remote.original),
    member: takeText('member', '套餐会员价（元）', base.member, local.member, remote.member),
    items: [],
  };
  const byId = (items: PackageRow[]) => new Map(items.map(item => [item.itemId, item]));
  const baseRows = byId(base.items), localRows = byId(local.items), remoteRows = byId(remote.items);
  // Keep server order, then append local-only items in their draft order.
  for (const id of new Set([...remoteRows.keys(), ...localRows.keys()])) {
    const before = baseRows.get(id), mine = localRows.get(id), theirs = remoteRows.get(id);
    const label = (mine?.name || theirs?.name || before?.name || '未命名商品');
    if (!before) {
      if (mine && theirs && !sameItem(mine, theirs)) {
        const key = `${id}:row`;
        conflicts.push({ key, label: `${label} · 新增商品`, kind: 'row', local: mine, remote: theirs });
        values.items.push(choices[key] === 'remote' ? theirs : mine);
      } else {
        const added = theirs ?? mine;
        if (added) values.items.push(added);
      }
      continue;
    }
    if (!mine || !theirs) {
      const surviving = mine ?? theirs;
      if (!surviving || sameItem(before, surviving)) continue;
      const key = `${id}:row`;
      conflicts.push({ key, label: `${label} · 删除与编辑`, kind: 'row', local: mine ?? null, remote: theirs ?? null });
      const chosen = choices[key] === 'remote' ? theirs : mine;
      if (chosen) {
        if (!theirs) restored.add(id);
        values.items.push(chosen);
      }
      continue;
    }

    let image = mine;
    if (mine.imageId === before.imageId || mine.imageId === theirs.imageId) image = theirs;
    else if (theirs.imageId !== before.imageId) {
      const key = `${id}:image`;
      conflicts.push({ key, label: `${label} · 图片`, kind: 'image', local: mine, remote: theirs });
      if (choices[key] === 'remote') image = theirs;
    }
    const row = { ...image };
    for (const field of textFields)
      row[field] = takeText(`${id}:${field}`, `${label} · ${itemFields[field]}`, before[field], mine[field], theirs[field]);
    values.items.push(row);
  }
  return { values, conflicts, restored, resolved: conflicts.every(entry => choices[entry.key] !== undefined) };
}
