import type { ZipcodeResult } from './search'

export interface SearchRecord {
  keyword: string
  results: ZipcodeResult[]
  lastTargetRow: number
  hasMore: boolean
  updatedAt: number
}

const DB_NAME = 'postal'
const STORE_SEARCHES = 'searches'
const STORE_COPIED = 'copied'
const DB_VERSION = 2

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_SEARCHES)) {
        const store = db.createObjectStore(STORE_SEARCHES, { keyPath: 'keyword' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_COPIED)) {
        db.createObjectStore(STORE_COPIED, { keyPath: 'zipcode' })
      }
    }

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror = () => reject(req.error)
  })
}

// ─── searches store ───────────────────────────────────────────────────────────

export async function saveSearch(record: SearchRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SEARCHES, 'readwrite')
    const store = tx.objectStore(STORE_SEARCHES)
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function getSearch(keyword: string): Promise<SearchRecord | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SEARCHES, 'readonly')
    const store = tx.objectStore(STORE_SEARCHES)
    const req = store.get(keyword)
    req.onsuccess = () => resolve(req.result as SearchRecord | undefined)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function listRecent(limit = 8): Promise<string[]> {
  const records = await listRecentFull(limit)
  return records.map((r) => r.keyword)
}

export async function listRecentFull(limit = 8): Promise<SearchRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SEARCHES, 'readonly')
    const store = tx.objectStore(STORE_SEARCHES)
    const index = store.index('updatedAt')
    const req = index.openCursor(null, 'prev')
    const records: SearchRecord[] = []
    const seen = new Set<string>()
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
      if (cursor && records.length < limit) {
        const record = cursor.value as SearchRecord
        if (!seen.has(record.keyword)) {
          seen.add(record.keyword)
          records.push(record)
        }
        cursor.continue()
      } else {
        resolve(records)
      }
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function clearAll(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SEARCHES, STORE_COPIED], 'readwrite')
    tx.objectStore(STORE_SEARCHES).clear()
    tx.objectStore(STORE_COPIED).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
}

export async function pruneOld(max = 50): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SEARCHES, 'readwrite')
    const store = tx.objectStore(STORE_SEARCHES)
    const index = store.index('updatedAt')
    const countReq = store.count()
    countReq.onsuccess = () => {
      const total = countReq.result
      if (total <= max) {
        resolve()
        db.close()
        return
      }
      const toDelete = total - max
      let deleted = 0
      const cursorReq = index.openCursor(null, 'next')
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
        if (cursor && deleted < toDelete) {
          cursor.delete()
          deleted++
          cursor.continue()
        } else {
          resolve()
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    }
    countReq.onerror = () => reject(countReq.error)
    tx.oncomplete = () => db.close()
  })
}

// ─── copied store ─────────────────────────────────────────────────────────────

export async function markCopied(zipcode: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COPIED, 'readwrite')
    const store = tx.objectStore(STORE_COPIED)
    const req = store.put({ zipcode })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function getCopiedZipcodes(): Promise<Set<string>> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COPIED, 'readonly')
    const store = tx.objectStore(STORE_COPIED)
    const req = store.getAllKeys()
    req.onsuccess = () => resolve(new Set(req.result as string[]))
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}
