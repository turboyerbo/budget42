/**
 * Local receipt vault (IndexedDB).
 *
 * The point: a photo of a receipt is a tax record. It must never be lost
 * because the network blipped, the tab crashed, or Storage was
 * misconfigured. So the very first thing that happens to a receipt photo
 * is that it gets written here, on the device, BEFORE any network call is
 * attempted. Everything after that (upload, AI reading, the database row)
 * can fail and be retried without the original ever being at risk.
 *
 * IndexedDB rather than localStorage because localStorage holds strings
 * only (~5MB, and photos would blow past it) and iOS Safari's tracking
 * prevention evicts it after ~7 days. IndexedDB holds real Blobs and is
 * far more durable — though not permanent either, which is why the goal
 * is always to get a copy up to Supabase Storage and then keep the local
 * one until that's confirmed.
 */

const DB_NAME = 'b42_receipts';
const DB_VERSION = 1;
const STORE = 'photos';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('uploaded', 'uploaded', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the local receipt vault'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Local vault transaction aborted'));
  });
}

/** Store the original photo locally. Called before anything touches the
 *  network, so from this moment the receipt cannot be lost. */
export async function stashReceiptPhoto(id, blob, meta = {}) {
  const db = await openDb();
  await tx(db, 'readwrite', store => store.put({
    id, blob,
    name: meta.name || '', type: blob?.type || meta.type || '',
    size: blob?.size || 0,
    stashedAt: new Date().toISOString(),
    uploaded: 0,           // 0 = still only on this device
    remoteUrl: null,
    attempts: 0,
    lastError: null,
    ...meta,
  }));
  db.close();
  return id;
}

/** Mark a receipt as safely uploaded, recording where it landed. The local
 *  copy is deliberately KEPT — two copies of a tax record is the point. */
export async function markReceiptUploaded(id, remoteUrl) {
  const db = await openDb();
  await tx(db, 'readwrite', store => {
    const get = store.get(id);
    get.onsuccess = () => {
      const row = get.result;
      if (row) store.put({ ...row, uploaded: 1, remoteUrl, uploadedAt: new Date().toISOString(), lastError: null });
    };
  });
  db.close();
}

export async function recordUploadFailure(id, message) {
  const db = await openDb();
  await tx(db, 'readwrite', store => {
    const get = store.get(id);
    get.onsuccess = () => {
      const row = get.result;
      if (row) store.put({ ...row, attempts: (row.attempts || 0) + 1, lastError: String(message || '') });
    };
  });
  db.close();
}

/** Everything still waiting to reach the server — the retry queue. */
export async function getPendingReceipts() {
  const db = await openDb();
  const rows = await tx(db, 'readonly', store => store.getAll());
  db.close();
  return (rows || []).filter(r => !r.uploaded);
}

export async function getAllStashedReceipts() {
  const db = await openDb();
  const rows = await tx(db, 'readonly', store => store.getAll());
  db.close();
  return rows || [];
}

export async function getStashedReceipt(id) {
  const db = await openDb();
  const row = await tx(db, 'readonly', store => store.get(id));
  db.close();
  return row;
}

/** Only ever called deliberately — never as automatic cleanup. Local
 *  copies are kept even after a successful upload, on purpose. */
export async function deleteStashedReceipt(id) {
  const db = await openDb();
  await tx(db, 'readwrite', store => store.delete(id));
  db.close();
}

export async function vaultSummary() {
  try {
    const rows = await getAllStashedReceipts();
    const pending = rows.filter(r => !r.uploaded);
    return {
      available: true,
      total: rows.length,
      pending: pending.length,
      bytes: rows.reduce((a, r) => a + (r.size || 0), 0),
    };
  } catch {
    return { available: false, total: 0, pending: 0, bytes: 0 };
  }
}
