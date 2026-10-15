// 조회처 응답 캐시 계층: 팝업 검색과 앱 lookup 이 같은 Fetchers 를 거치므로 한 곳에서 처리한다.
// 성공한 응답 중 결과가 있는 것만 저장한다(빈 응답·오류는 일시적일 수 있어 저장하지 않는다).
import { isBlocked } from './errors'
import type { Fetchers } from './provider'
import type { SearchPage, Source } from './search'

export const PAGE_TTL_MS = 24 * 60 * 60 * 1000

export interface PageStore {
  get(key: string): Promise<{ page: SearchPage; at: number } | undefined>
  put(key: string, page: SearchPage, at: number): Promise<void>
}

export interface CacheHooks {
  /** 조회처가 접근을 막았을 때(true)와 정상 응답이 돌아왔을 때(false) */
  onBlocked?: (blocked: boolean) => void
  now?: () => number
  ttlMs?: number
}

export const pageKey = (source: Source, keyword: string, pageIdx: number, pageSize: number): string =>
  `${source}|${keyword.trim()}|${pageIdx}|${pageSize}`

export function withPageCache(inner: Fetchers, store: PageStore, hooks: CacheHooks = {}): Fetchers {
  const now = hooks.now ?? Date.now
  const ttl = hooks.ttlMs ?? PAGE_TTL_MS

  const wrap = (source: Source): Fetchers[Source] => async (keyword, pageIdx, pageSize, signal) => {
    const key = pageKey(source, keyword, pageIdx, pageSize)
    const hit = await store.get(key).catch(() => undefined)
    if (hit && now() - hit.at < ttl) return hit.page

    let page: SearchPage
    try {
      page = await inner[source](keyword, pageIdx, pageSize, signal)
    } catch (err) {
      if (isBlocked(err)) hooks.onBlocked?.(true)
      throw err
    }
    hooks.onBlocked?.(false)
    if (page.results.length > 0) await store.put(key, page, now()).catch(() => undefined)
    return page
  }

  return { epost: wrap('epost'), juso: wrap('juso') }
}
