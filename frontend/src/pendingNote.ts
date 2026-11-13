export interface PendingNote {
  requestId: string;
  itemId: string | null;
  content: string;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function readPendingNote(key: string): PendingNote | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const note = JSON.parse(raw);
    return typeof note.requestId === 'string' && uuid.test(note.requestId)
      && (note.itemId === null || typeof note.itemId === 'string' && uuid.test(note.itemId))
      && typeof note.content === 'string' && note.content.trim() ? note : null;
  } catch { return null; }
}

export function readPendingNotes(key: string): PendingNote[] {
  if (!key) return [];
  const notes = new Map<string, PendingNote>();
  const legacy = readPendingNote(key);
  if (legacy) notes.set(legacy.requestId.toLowerCase(), legacy);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const entryKey = localStorage.key(i);
      if (!entryKey?.startsWith(key + ':')) continue;
      const note = readPendingNote(entryKey);
      if (note && entryKey === key + ':' + note.requestId.toLowerCase()) notes.set(note.requestId.toLowerCase(), note);
    }
  } catch { /* 单条旧版记录仍可恢复。 */ }
  return [...notes.values()];
}

export function savePendingNote(key: string, note: PendingNote): boolean {
  if (!key) return false;
  try { localStorage.setItem(key + ':' + note.requestId.toLowerCase(), JSON.stringify(note)); return true; }
  catch { return false; }
}

export function clearPendingNote(key: string, requestId: string) {
  if (!key) return;
  const id = requestId.toLowerCase();
  try {
    localStorage.removeItem(key + ':' + id);
    if (readPendingNote(key)?.requestId.toLowerCase() === id) localStorage.removeItem(key);
  }
  catch { /* 后续重试仍使用同一发布标识。 */ }
}
