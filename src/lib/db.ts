import type { LearnedRecord } from './learn'
import type { SearchPage, Source, ZipcodeResult } from './search'

export interface SearchRecord {
  keyword: string
  results: ZipcodeResult[]
  lastTargetRow: number
  hasMore: boolean
  /** 결과를 가져온 조회처(더 보기가 같은 곳에서 이어지도록). 없으면 epost */
  source?: Source
  updatedAt: number
}

const DB_NAME = 'postal'
const STORE_SEARCHES = 'searches'
const STORE_COPIED = 'copied'
const STORE_LEARNED = 'learned'
const STORE_PAGES = 'pages'
const DB_VERSION = 5

/** 검색 이력(최근 검색 목록)의 캐시 결과를 그대로 쓰는 기간. 지나면 다시 조회한다 */
export const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const isFresh = (updatedAt: number, now = Date.now(), ttl = HISTORY_TTL_MS): boolean => now - updatedAt < ttl

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      // v3: 조회처가 바뀌어(페이지 번호 체계·결과 형식 변경) 기존 검색 캐시를 폐기한다
      if ((e.oldVersion ?? 0) < 3 && db.objectStoreNames.contains(STORE_SEARCHES)) {
        db.deleteObjectStore(STORE_SEARCHES)
      }
      if (!db.objectStoreNames.contains(STORE_SEARCHES)) {
        const store = db.createObjectStore(STORE_SEARCHES, { keyPath: 'keyword' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
      // v3: 복사 기록 키를 우편번호 단독에서 우편번호+도로명으로 변경 (기존 기록은 초기화)
      if ((e.oldVersion ?? 0) < 3 && db.objectStoreNames.contains(STORE_COPIED)) {
        db.deleteObjectStore(STORE_COPIED)
      }
      if (!db.objectStoreNames.contains(STORE_COPIED)) db.createObjectStore(STORE_COPIED, { keyPath: 'key' })
      // v4: 사용자가 확정해 기억한 주소(검색 이력 지우기와 별개로 유지)
      if (!db.objectStoreNames.contains(STORE_LEARNED)) db.createObjectStore(STORE_LEARNED, { keyPath: 'key' })
      // v5: 조회처 페이지 응답 캐시(팝업 검색과 앱 lookup 이 함께 쓴다)
      if (!db.objectStoreNames.contains(STORE_PAGES)) db.createObjectStore(STORE_PAGES, { keyPath: 'key' }).createIndex('at', 'at')
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
    const tx = db.transaction([STORE_SEARCHES, STORE_COPIED, STORE_PAGES], 'readwrite')
    tx.objectStore(STORE_SEARCHES).clear()
    tx.objectStore(STORE_COPIED).clear()
    tx.objectStore(STORE_PAGES).clear()
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

export function copiedKey(r: ZipcodeResult): string {
  return [r.zipcode, r.roadAddress, r.jibunAddress, r.detail ?? ''].join('|')
}

export async function markCopied(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COPIED, 'readwrite')
    const store = tx.objectStore(STORE_COPIED)
    const req = store.put({ key })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function getCopiedKeys(): Promise<Set<string>> {
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

// ─── learned store (사용자가 확정해 기억한 주소) ────────────────────────────────

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_LEARNED, mode)
    const req = work(tx.objectStore(STORE_LEARNED))
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

export const getLearned = (key: string): Promise<LearnedRecord | undefined> => run('readonly', (s) => s.get(key))
export const putLearned = (rec: LearnedRecord): Promise<IDBValidKey> => run('readwrite', (s) => s.put(rec))
export const deleteLearned = (key: string): Promise<undefined> => run('readwrite', (s) => s.delete(key))
export const clearLearned = (): Promise<undefined> => run('readwrite', (s) => s.clear())
export const listLearned = (): Promise<LearnedRecord[]> => run('readonly', (s) => s.getAll())

/** 가져온 기록을 합친다: 같은 키는 확정 횟수가 많은 쪽(같으면 최근 사용한 쪽)을 남긴다. 반영한 건수를 돌려준다 */
export async function importLearned(records: LearnedRecord[]): Promise<number> {
  const existing = new Map((await listLearned()).map((r) => [r.key, r]))
  let n = 0
  for (const rec of records) {
    const cur = existing.get(rec.key)
    if (cur && (cur.hits > rec.hits || (cur.hits === rec.hits && cur.lastUsedAt >= rec.lastUsedAt))) continue
    await putLearned(rec)
    n++
  }
  return n
}

// ─── pages store (조회처 응답 캐시) ─────────────────────────────────────────────

export interface PageCacheRecord { key: string; page: SearchPage; at: number }

function pagesTx<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, mode)
    const req = work(tx.objectStore(STORE_PAGES))
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

export const getPageCache = (key: string): Promise<PageCacheRecord | undefined> => pagesTx('readonly', (s) => s.get(key))
export const putPageCache = (rec: PageCacheRecord): Promise<IDBValidKey> => pagesTx('readwrite', (s) => s.put(rec))
export const clearPageCache = (): Promise<undefined> => pagesTx('readwrite', (s) => s.clear())

/** 오래된 순으로 지워 max 건만 남긴다 */
export async function prunePageCache(max = 300): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readwrite')
    const store = tx.objectStore(STORE_PAGES)
    const countReq = store.count()
    countReq.onsuccess = () => {
      let toDelete = countReq.result - max
      if (toDelete <= 0) return
      const cur = store.index('at').openCursor(null, 'next')
      cur.onsuccess = () => {
        const c = cur.result
        if (c && toDelete-- > 0) { c.delete(); c.continue() }
      }
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
