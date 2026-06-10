import type { SDKEvent } from "./types";

export const OFFLINE_STORE_KEY = "__custom_sdk_offline_events__";

interface StoredEvent {
  id: string;
  event: SDKEvent;
}

export class OfflineEventStore {
  private dbPromise?: Promise<IDBDatabase | undefined>;

  constructor(
    private readonly appId: string,
    private readonly maxEvents = 1000
  ) {}

  async append(events: SDKEvent[]): Promise<void> {
    if (!events.length) return;
    if (await this.appendIndexedDB(events)) return;
    const existing = this.readLocalStorage();
    const next = [...existing, ...events].slice(-this.maxEvents);
    localStorage.setItem(this.storageKey(), JSON.stringify(next));
    localStorage.setItem(OFFLINE_STORE_KEY, JSON.stringify(next));
  }

  async drain(): Promise<SDKEvent[]> {
    const indexed = await this.drainIndexedDB();
    if (indexed) return indexed;
    const events = this.readLocalStorage();
    localStorage.removeItem(this.storageKey());
    localStorage.removeItem(OFFLINE_STORE_KEY);
    return events;
  }

  async clear(): Promise<void> {
    await this.clearIndexedDB();
    localStorage.removeItem(this.storageKey());
    localStorage.removeItem(OFFLINE_STORE_KEY);
  }

  private async appendIndexedDB(events: SDKEvent[]) {
    const db = await this.openDb();
    if (!db) return false;
    await txDone(db, "readwrite", (store) => {
      for (const event of events) {
        store.put({
          id: `${this.appId}:${event.event_id}`,
          event
        } satisfies StoredEvent);
      }
    });
    return true;
  }

  private async drainIndexedDB() {
    const db = await this.openDb();
    if (!db) return undefined;
    const events = await new Promise<SDKEvent[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const store = tx.objectStore("events");
      const req = store.getAll();
      req.onsuccess = () => {
        resolve((req.result as StoredEvent[])
          .filter((item) => item.id.startsWith(`${this.appId}:`))
          .map((item) => item.event));
      };
      req.onerror = () => reject(req.error);
    });
    await this.clearIndexedDB();
    return events;
  }

  private async clearIndexedDB() {
    const db = await this.openDb();
    if (!db) return;
    await txDone(db, "readwrite", (store) => store.clear());
  }

  private openDb() {
    if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
    this.dbPromise ??= new Promise((resolve) => {
      const req = indexedDB.open("custom-analytics-sdk", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("events")) {
          db.createObjectStore("events", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      req.onblocked = () => resolve(undefined);
    });
    return this.dbPromise;
  }

  private readLocalStorage() {
    const raw = localStorage.getItem(this.storageKey()) || localStorage.getItem(OFFLINE_STORE_KEY);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value as SDKEvent[] : [];
    } catch {
      return [];
    }
  }

  private storageKey() {
    return `${OFFLINE_STORE_KEY}:${this.appId}`;
  }
}

function txDone(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  apply: (store: IDBObjectStore) => void
) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("events", mode);
    apply(tx.objectStore("events"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
