/* Offline outbox — field actions taken with no connection are queued in
   IndexedDB (survives the app being closed) and replayed in order when the
   connection comes back. Server state always wins: a queued check-out whose
   shift was already auto-closed server-side is dropped, never forced. */

import { useEffect, useState } from "react";
import { api, type ApiRequest } from "./api";

export type OutboxItem =
  | { kind: "checkIn"; args: ApiRequest<typeof api, "checkIn"> }
  | { kind: "checkOut"; args: ApiRequest<typeof api, "checkOut"> & { employeeId: number } }
  | { kind: "taskStatus"; args: ApiRequest<typeof api, "setTaskStatus"> }
  | { kind: "taskPhoto"; args: ApiRequest<typeof api, "addTaskPhoto"> }
  | { kind: "progress"; args: ApiRequest<typeof api, "createProgress"> };

type StoredItem = OutboxItem & { queuedAt: number };

const DB_NAME = "smartbuilder-outbox";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = await fn(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---- tiny pub/sub so the header banner and field screens stay in sync ---- */
const listeners = new Set<() => void>();
function emitOutboxChanged() {
  for (const fn of listeners) fn();
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const stored: StoredItem = { ...item, queuedAt: Date.now() };
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.add(stored));
  });
  emitOutboxChanged();
}

export async function listOutbox(): Promise<(StoredItem & { id: number })[]> {
  try {
    const rows = await withStore("readonly", async (store) => requestToPromise(store.getAll() as IDBRequest<(StoredItem & { id: number })[]>));
    return rows.sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}

async function removeOutbox(id: number): Promise<void> {
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(id));
  });
  emitOutboxChanged();
}

/* ---- replay ---- */
let syncing = false;
let syncedHandler: (() => void) | null = null;
export function setOutboxSyncedHandler(fn: () => void) {
  syncedHandler = fn;
}

async function replayOne(item: StoredItem & { id: number }): Promise<void> {
  switch (item.kind) {
    case "checkIn":
      await api.checkIn(item.args);
      return;
    case "checkOut": {
      const { employeeId, ...args } = item.args;
      let sheetId = args.sheetId;
      if (!sheetId) {
        // Queued right after a queued check-in: resolve the sheet that the
        // check-in replay just created. If the server already closed it
        // (auto-close), server state wins and this check-out is dropped.
        const active = await api.getActiveSheet({ companyId: args.companyId, employeeId });
        if (!active.sheet) return;
        sheetId = active.sheet.id;
      }
      await api.checkOut({ ...args, sheetId });
      return;
    }
    case "taskStatus":
      await api.setTaskStatus(item.args);
      return;
    case "taskPhoto":
      await api.addTaskPhoto(item.args);
      return;
    case "progress":
      await api.createProgress(item.args);
      return;
  }
}

/* Replays the queue oldest-first. Stops at the first failure and keeps the
   rest queued for the next attempt (order is never broken). */
export async function syncOutbox(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const items = await listOutbox();
    let sent = 0;
    for (const item of items) {
      try {
        await replayOne(item);
        await removeOutbox(item.id);
        sent += 1;
      } catch {
        break; // retry later, in order
      }
    }
    if (sent > 0) syncedHandler?.();
  } finally {
    syncing = false;
    emitOutboxChanged();
  }
}

let autoSyncStarted = false;
export function startOutboxAutoSync(): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  window.addEventListener("online", () => { void syncOutbox(); });
  window.setInterval(() => { void syncOutbox(); }, 30000);
  void syncOutbox();
}

/* ---- React hooks ---- */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useOutboxItems(): (StoredItem & { id: number })[] {
  const [items, setItems] = useState<(StoredItem & { id: number })[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void listOutbox().then((rows) => { if (alive) setItems(rows); }); };
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return items;
}

export function isOffline(): boolean {
  return !navigator.onLine;
}
