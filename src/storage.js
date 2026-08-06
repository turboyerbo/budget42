/**
 * Storage adapter for the household budget app.
 *
 * Mirrors the window.storage API used in the Claude artifact prototype,
 * so App.jsx can work unchanged.
 *
 * Personal data  (shared=false) → localStorage with "hb_local_" prefix
 * Household data (shared=true)  → localStorage with "hb_shared_" prefix
 *
 * Because localStorage is device-local, syncing between one partner's phone
 * and the other's requires the manual Export / Import flow in the Sync tab.
 * See App.jsx → SyncTab for the UI.
 */

const L = 'hb_local_';
const S = 'hb_shared_';

export const storage = {
  async get(key, shared = false) {
    try {
      const val = localStorage.getItem((shared ? S : L) + key);
      return val != null ? { value: val } : null;
    } catch {
      return null;
    }
  },

  async set(key, value, shared = false) {
    try {
      localStorage.setItem((shared ? S : L) + key, value);
      return { value };
    } catch {
      return null;
    }
  },

  /** Serialise ALL shared keys into one JSON string the other person can paste. */
  exportAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(S)) out[k] = localStorage.getItem(k);
    }
    return JSON.stringify(out, null, 2);
  },

  /**
   * Merge an exported JSON string into this device's localStorage.
   * Imported values win over locally-stored ones (last-write wins).
   * Returns the number of keys merged, or throws on bad JSON.
   */
  importAll(jsonString) {
    const obj = JSON.parse(jsonString);
    let count = 0;
    Object.entries(obj).forEach(([k, v]) => {
      if (k.startsWith(S)) {
        localStorage.setItem(k, v);
        count++;
      }
    });
    return count;
  },

  /** Wipe all shared (household) data — irreversible. */
  clearShared() {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(S)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  },
};
